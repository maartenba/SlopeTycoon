/**
 * Snow park ROI (0.9.0, docs/snow-park.md, docs/balance.md "0.9.0"): `npm run analysis:park [-- --days 180 --seeds 61,5,23,42]`.
 * Per seed the real resort runs a year three ways (same seed => the difference is the park): BASELINE, a PARK (the main run marked, the resort's own snowcats shape it) and a PARK + HALFPIPE.
 * Reports capex, income / expense difference per year, freestylers, laps, and the payback next to the generic table (docs/economy-audit.md).
 */
import { createSim, type Sim } from '../../src/game/createSim';
import { placeBuilding } from '../../src/sim/PlaceBuilding';
import { Layer } from '../../src/world/Networks';
import { FREESTYLER_TYPE } from '../../src/config/guestTypes';
import { DAYS_PER_YEAR } from '../../src/config/balance';

const argv = process.argv.slice(2);
const arg = (k: string, d: string): string => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1]! : d; };
const DAYS = Number(arg('days', String(DAYS_PER_YEAR)));
const SEEDS = arg('seeds', '61,5,23,42').split(',').map(Number);
const mk = (seed: number): Sim => createSim({ size: 64, seed, starterResort: true, mode: 'sandbox', now: () => 0, money: 5e6 } as never);
const main = (s: Sim) => [...s.runIndex.runs()].sort((a, b) => b.dropM - a.dropM)[0]!;

function setup(s: Sim, pipe: boolean): { ok: boolean; capex: number } {
  const n = s.size, run = main(s);
  s.networks.paint(Layer.Ski, run.tiles.map((t) => ({ x: t % n, y: (t / n) | 0 })), 2); // red
  s.tick(1);
  const before = s.game.money;
  s.progression.unlockAll = true;
  const set = s.setRunPark(s.names.pisteId(main(s)), true);
  let ok = set.ok;
  if (ok && pipe) {
    ok = false;
    for (const t of main(s).poly) { for (let k = 1; k <= 5 && !ok; k++) for (let dy = -k; dy <= k && !ok; dy++) for (let dx = -k; dx <= k && !ok; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== k) continue;
      for (const rot of [0, 1]) { const o = placeBuilding(s.env, s.props, 'halfpipe', (t % n) + dx, ((t / n) | 0) + dy, rot, true, false); if (o.ok) { s.buildings.reevaluate(); s.refreshCoverage(undefined, true); if (o.building!.active) { ok = true; break; } s.buildings.remove(o.building!.id); } }
    } if (ok) break; }
  }
  s.tick(1);
  return { ok, capex: before - s.game.money };
}
function year(s: Sim): { income: number; expense: number; arrivals: number; laps: number } {
  const t = { income: 0, expense: 0, arrivals: 0 };
  s.bus.on('finance:monthClosed', () => { const r = s.economy.lastReport(); if (r) { t.income += r.incomeTotal; t.expense += r.expenseTotal - (r.expense.construction ?? 0); } });
  s.bus.on('guest:arrived', (e) => { const sl = s.guestSim.store.slotOf(e.id); if (sl >= 0 && s.guestSim.store.type[sl] === FREESTYLER_TYPE) t.arrivals++; });
  for (let d = 0; d < DAYS; d++) s.tick(240);
  return { ...t, laps: s.park.total };
}
const money = (n: number): string => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

let sumPark = 0, sumPipe = 0, cnt = 0;
for (const seed of SEEDS) {
  const base = mk(seed); base.progression.unlockAll = true; const b = year(base);
  const a = mk(seed), sa = setup(a, false), pa = sa.ok ? year(a) : null;
  const c = mk(seed), sc = setup(c, true), pc = sc.ok ? year(c) : null;
  const d1 = pa ? pa.income - pa.expense - (b.income - b.expense) : NaN, d2 = pc ? pc.income - pc.expense - (b.income - b.expense) : NaN;
  console.log(`seed ${seed}: park ${pa ? `${money(d1)}/yr, ${pa.arrivals} freestylers, ${pa.laps} laps` : 'not possible'} | park + halfpipe ${pc ? `${money(d2)}/yr (capex ${money(sc.capex)}), ${pc.arrivals} freestylers, ${pc.laps} laps` : 'no site'}`);
  if (pa && pc) { sumPark += d1; sumPipe += d2; cnt++; }
}
if (cnt) console.log(`mean over ${cnt} seeds: park ${money(sumPark / cnt)} a year (no capex: a run + the snowcat), park + halfpipe ${money(sumPipe / cnt)} a year (halfpipe capex $12,000, upkeep $22 a day)`);
