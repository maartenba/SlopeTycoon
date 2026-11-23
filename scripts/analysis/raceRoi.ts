/**
 * Race course ROI (0.8.0, docs/race-course.md, docs/balance.md "0.8.0 racers"): `npm run analysis:race [-- --days 180 --seeds 61,5,7,23,42]`.
 * The generic `analysis:roi` places ONE building, so a lone Start / Timing Hut would only show its upkeep. This script runs the real resort for a year three ways per seed
 * (same seed => the difference is the course): BASELINE, a RED course and a BLACK course (the main run repainted, both huts placed beside its ends, the run marked, groomed
 * by the resort's own snowcats). Reports capex, income / expense difference per year, racers, laps and the payback, next to the generic table's rows.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createSim, type Sim } from '../../src/game/createSim';
import { BUILDINGS } from '../../src/config/buildings';
import { placeBuilding } from '../../src/sim/PlaceBuilding';
import { Layer } from '../../src/world/Networks';
import { DOWNHILLER_TYPE, RACER_TYPE } from '../../src/config/guestTypes';
import { RACE_DAY } from '../../src/config/race';
import { DAYS_PER_YEAR } from '../../src/config/balance';

const argv = process.argv.slice(2);
const arg = (k: string, d: string): string => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1]! : d; };
const DAYS = Number(arg('days', String(DAYS_PER_YEAR)));
const SEEDS = arg('seeds', '61,5,7,23,42').split(',').map(Number);
const mk = (seed: number): Sim => createSim({ size: 64, seed, starterResort: true, mode: 'sandbox', now: () => 0, money: 5e6 } as never);

function setup(s: Sim, stored: number): { ok: boolean; capex: number } {
  const run = [...s.runIndex.runs()].sort((a, b) => b.dropM - a.dropM)[0]!, n = s.size;
  s.networks.paint(Layer.Ski, run.tiles.map((t) => ({ x: t % n, y: (t / n) | 0 })), stored);
  const r = [...s.runIndex.runs()].sort((a, b) => b.dropM - a.dropM)[0]!, p = r.poly;
  const put = (type: 'startHut' | 'timingHut', tiles: number[]): boolean => {
    for (const t of tiles) for (let k = 1; k <= 3; k++) for (let dy = -k; dy <= k; dy++) for (let dx = -k; dx <= k; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== k) continue;
      const o = placeBuilding(s.env, s.props, type, (t % n) + dx, ((t / n) | 0) + dy, 0, true, false);
      if (o.ok) { s.buildings.reevaluate(); s.refreshCoverage(undefined, true); return true; }
    }
    return false;
  };
  const before = s.game.money;
  const ok = put('startHut', [p[1]!, p[0]!, p[2]!]) && put('timingHut', [p[p.length - 2]!, p[p.length - 1]!, p[p.length - 3]!]);
  s.tick(1);
  const id = s.names.pisteId([...s.runIndex.runs()].sort((a, b) => b.dropM - a.dropM)[0]!);
  const set = s.setRunCourse(id, true);
  return { ok: ok && set.ok, capex: before - s.game.money };
}

interface Tot { income: number; expense: number; racerArrivals: number }
function year(s: Sim): Tot & { laps: number } {
  const t = { income: 0, expense: 0, racerArrivals: 0 };
  s.bus.on('finance:monthClosed', () => { const r = s.economy.lastReport(); if (r) { t.income += r.incomeTotal; t.expense += r.expenseTotal - (r.expense.construction ?? 0); } });
  s.bus.on('guest:arrived', (e) => { const sl = s.guestSim.store.slotOf(e.id); if (sl >= 0 && s.guestSim.store.type[sl] === RACER_TYPE) t.racerArrivals++; });
  for (let d = 0; d < DAYS; d++) s.tick(240);
  return { ...t, laps: s.race.total };
}

const money = (n: number): string => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

/**
 * Race-day economy guard (0.8.1, docs/race-course.md "Race days"): `npm run analysis:race -- --raceday 1`. Per seed and colour, TWO identical resorts (same seed, a groomed course) run
 * to a winter Saturday; one books a Club Race there. The Saturday's income (every ledger category, the booking cost is an expense and is reported separately) is compared with the
 * control's: the guard is `RACE_DAY.earnCapVsSaturday` (1.5x).
 */
if (arg('raceday', '0') === '1') {
  const absDay = (s: Sim): number => s.game.date.year * DAYS_PER_YEAR + s.game.date.day;
  const incomeDay = (s: Sim, day: number): number => { while (absDay(s) < day) s.tick(1); const a = s.economy.lifetimeIncome(); while (absDay(s) === day) s.tick(1); return s.economy.lifetimeIncome() - a; };
  let worst = 0;
  for (const [name, stored] of [['red', 2], ['black', 3]] as const) for (const seed of SEEDS) {
    const mkRun = (book: boolean): { s: Sim; sat: number; id: number } | null => {
      const s = mk(seed); s.game.date.day = 120; // 1 Dec
      const st = setup(s, stored); if (!st.ok) return null;
      const id = s.names.pisteId([...s.runIndex.runs()].sort((a, b) => b.dropM - a.dropM)[0]!);
      s.tick(240 * 3); s.runSettings.noteGroomed(id, absDay(s));
      let d = absDay(s) + 3; while (((d % 7) + 7) % 7 !== 5) d++;
      if (book && s.bookRaceDay(id, d)) throw new Error('race day refused');
      return { s, sat: d, id };
    };
    const a = mkRun(false), b = mkRun(true);
    if (!a || !b) { console.log(`${name} seed ${seed}: course not possible`); continue; }
    // groom the course daily in both (the resort's own cats mostly do)
    const run = (r: { s: Sim; sat: number; id: number }): number => { while (absDay(r.s) < r.sat) { r.s.runSettings.noteGroomed(r.id, absDay(r.s)); r.s.tick(1); } return incomeDay(r.s, r.sat); };
    const normal = run(a), race = run(b), res = b.s.raceDay.results[0];
    const ratio = normal > 0 ? race / normal : 0; worst = Math.max(worst, ratio);
    console.log(`${name.padEnd(5)} seed ${seed}: normal Saturday ${money(normal)} race day ${money(race)} x${ratio.toFixed(2)} (fees+sponsor ${money(res?.earned ?? 0)}, spectators ${res?.spectators ?? 0}, field ${res?.field ?? 0}, cost -$3,000)`);
  }
  console.log(`\nWorst race day / Saturday ratio ${worst.toFixed(2)} (guard ${RACE_DAY.earnCapVsSaturday})`);
  process.exit(worst <= RACE_DAY.earnCapVsSaturday ? 0 : 1);
}
/**
 * Summer downhill economy (0.8.2, docs/race-course.md "Downhill course"): `npm run analysis:race -- --summer 1 [--days 60]`. Same resort + seed with and without a downhill course on
 * a MTB trail along the main run (both huts beside its ends, marked), a summer of `--days` days: income / expense difference, riders, laps; then a summer Saturday race-day guard (<= 1.5x).
 */
if (arg('summer', '0') === '1') {
  const SD = Number(arg('days', '60'));
  const mkS = (seed: number): Sim => createSim({ size: 64, seed, starterResort: true, mode: 'sandbox', startSeason: 'summer', now: () => 0, money: 5e6 } as never);
  const absDay = (s: Sim): number => s.game.date.year * DAYS_PER_YEAR + s.game.date.day;
  const setupS = (s: Sim, stored: number): { ok: boolean; capex: number; id: number } => {
    s.progression.unlockAll = true; s.tick(240 * 3);
    const n = s.size, ski = [...s.runIndex.runs()].sort((a, b) => b.dropM - a.dropM)[0]!;
    s.networks.paint(Layer.Mtb, ski.poly.map((t) => ({ x: t % n, y: (t / n) | 0 })), stored); s.tick(1);
    const tr = [...s.mtbRunIndex.runs()].sort((a, b) => b.dropM - a.dropM)[0]!, p = tr.poly;
    const put = (type: 'startHut' | 'timingHut', tiles: number[]): boolean => {
      for (const t of tiles) for (let k = 1; k <= 3; k++) for (let dy = -k; dy <= k; dy++) for (let dx = -k; dx <= k; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== k) continue;
        const o = s.progression.withBypass(() => placeBuilding(s.env, s.props, type, (t % n) + dx, ((t / n) | 0) + dy, 0, true, false));
        if (o.ok) { s.buildings.reevaluate(); s.refreshCoverage(undefined, true); return true; }
      }
      return false;
    };
    const before = s.game.money;
    const ok = put('startHut', [p[1]!, p[0]!, p[2]!]) && put('timingHut', [p[p.length - 2]!, p[p.length - 1]!, p[p.length - 3]!]);
    s.tick(1);
    const id = s.race.idOf([...s.mtbRunIndex.runs()].sort((a, b) => b.dropM - a.dropM)[0]!);
    return { ok: ok && s.setRunCourse(id, true).ok, capex: before - s.game.money, id };
  };
  const ledgerNet = (s: Sim): number => s.economy.lifetimeIncome() - s.economy.lifetimeExpense();
  let worst = 0;
  for (const [name, stored] of [['red', 2], ['black', 3]] as const) for (const seed of SEEDS) {
    const base = mkS(seed); base.progression.unlockAll = true; base.tick(240 * 3);
    const s = mkS(seed), st = setupS(s, stored);
    if (!st.ok) { console.log(`${name} seed ${seed}: downhill course not possible`); continue; }
    const b0 = ledgerNet(base), s0 = ledgerNet(s);
    let riders = 0; s.bus.on('guest:arrived', (e) => { const sl = s.guestSim.store.slotOf(e.id); if (sl >= 0 && s.guestSim.store.type[sl] === DOWNHILLER_TYPE) riders++; });
    for (let d = 0; d < SD; d++) { base.tick(240); s.tick(240); }
    const net = (ledgerNet(s) - s0) - (ledgerNet(base) - b0);
    console.log(`${name.padEnd(5)} seed ${seed}: capex ${money(st.capex)} net over ${SD} summer days ${money(net)} (${money(net * (DAYS_PER_YEAR / 4 / SD) * 4 / 4)} per summer-equivalent) riders ${riders} laps ${s.race.total}`);
  }
  for (const [name, stored] of [['red', 2], ['black', 3]] as const) for (const seed of SEEDS) {
    const mkRun = (book: boolean): { s: Sim; sat: number } | null => {
      const s = mkS(seed), st = setupS(s, stored); if (!st.ok) return null;
      s.tick(240 * 3);
      let d = absDay(s) + 3; while (((d % 7) + 7) % 7 !== 5) d++;
      if (book && s.bookRaceDay(st.id, d)) throw new Error('downhill race day refused');
      return { s, sat: d };
    };
    const a = mkRun(false), b = mkRun(true);
    if (!a || !b) continue;
    const incomeDay = (s: Sim, day: number): number => { while (absDay(s) < day) s.tick(1); const x = s.economy.lifetimeIncome(); while (absDay(s) === day) s.tick(1); return s.economy.lifetimeIncome() - x; };
    const normal = incomeDay(a.s, a.sat), race = incomeDay(b.s, b.sat), ratio = normal > 0 ? race / normal : 0; worst = Math.max(worst, ratio);
    console.log(`${name.padEnd(5)} seed ${seed}: normal summer Saturday ${money(normal)} downhill race day ${money(race)} x${ratio.toFixed(2)}`);
  }
  console.log(`\nWorst downhill race day / Saturday ratio ${worst.toFixed(2)} (guard ${RACE_DAY.earnCapVsSaturday})`);
  process.exit(worst <= RACE_DAY.earnCapVsSaturday ? 0 : 1);
}
const rows: Array<{ name: string; capex: number; net: number; income: number; expense: number; racers: number; laps: number; n: number }> = [];
for (const [name, stored] of [['red', 2], ['black', 3]] as const) {
  const acc = { capex: 0, net: 0, income: 0, expense: 0, racers: 0, laps: 0, n: 0 };
  for (const seed of SEEDS) {
    const base = year(mk(seed)), s = mk(seed), st = setup(s, stored);
    if (!st.ok) { console.log(`${name} seed ${seed}: course not possible`); continue; }
    const t = year(s);
    acc.capex += st.capex; acc.income += t.income - base.income; acc.expense += t.expense - base.expense; acc.net += (t.income - t.expense) - (base.income - base.expense); acc.racers += t.racerArrivals; acc.laps += t.laps; acc.n++;
    console.log(`${name} seed ${seed}: capex ${money(st.capex)} income ${money(t.income - base.income)} expense ${money(t.expense - base.expense)} net ${money((t.income - t.expense) - (base.income - base.expense))} racers ${t.racerArrivals} laps ${t.laps}`);
  }
  if (acc.n) rows.push({ name, capex: acc.capex / acc.n, net: acc.net / acc.n, income: acc.income / acc.n, expense: acc.expense / acc.n, racers: acc.racers / acc.n, laps: acc.laps / acc.n, n: acc.n });
}
console.log(`\n${DAYS}-day year, ${SEEDS.length} seeds (64 maps), hut pair (${money(BUILDINGS.startHut!.cost + BUILDINGS.timingHut!.cost)} capex + connection):`);
for (const r of rows) console.log(`${r.name.padEnd(6)} n=${r.n} capex ${money(r.capex)} income ${money(r.income)}/yr expense ${money(r.expense)}/yr NET ${money(r.net)}/yr racers ${Math.round(r.racers)} laps ${Math.round(r.laps)} payback ${r.net > 0 ? Math.round(r.capex / (r.net / DAYS)) + ' d' : 'never'}`);
if (existsSync('.weave/analysis/roi.json')) {
  const j = JSON.parse(readFileSync('.weave/analysis/roi.json', 'utf8')) as { rows: Array<{ id: string; name: string; netYear: number }> };
  const nets = j.rows.map((r) => r.netYear).sort((a, b) => b - a);
  for (const r of rows) console.log(`${r.name}: rank ${nets.filter((v) => v > r.net).length + 1} of ${nets.length + 1} against the generic ROI table (.weave/analysis/roi.json)`);
}
