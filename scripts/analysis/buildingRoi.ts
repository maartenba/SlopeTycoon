/**
 * Per-building ROI sandbox (M7.1 Task 7.1.3, docs/economy-audit.md): `npm run analysis:roi [-- --days 180 --quick 1 --only a,b]`.
 *
 * For every building: a standard resort (the pre-built sandbox starter resort, createSim defaults = the real game, nothing opted out) is run for one full year
 * (180 days: winter, spring, summer, autumn) twice per seed, once as the BASELINE and once with the building added on day 0 (placed with the real rules,
 * linked by road / footpath like the Bot does). Both runs share the seed, so the difference is the building. Averaged over up to three seeds where a site exists.
 *  - capex      = price + levelling + the road / path built to connect it;
 *  - net/yr     = (income - expenses excluding construction) of the run WITH the building minus the baseline;
 *  - payback    = capex / (net per day), 'never' when net <= 0; only ACTIVE (connected) buildings count: candidate sites are tried until one is connected;
 *  - noise      = the standard error of the mean over the seeds (the guest stream is chaotic: any added building reshuffles the Rng streams).
 * Flags: never profitable (excluding the intentional cost centres), absurdly profitable (payback < 40 days), dominated (a cheaper-or-equal, same-role building with
 * higher net and no higher upkeep). The table is written between the `gen:roi` markers of docs/economy-audit.md and as JSON to .weave/analysis/roi.json.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createSim, type Sim } from '../../src/game/createSim';
import { Bot } from '../../src/game/bot';
import { BUILDINGS } from '../../src/config/buildings';
import { placeBuilding, validatePlacement } from '../../src/sim/PlaceBuilding';
import { autoFlattenDefault } from '../../src/sim/PlacementRules';
import { NetKind } from '../../src/world/Networks';
import { DAYS_PER_YEAR } from '../../src/config/balance';

const argv = process.argv.slice(2);
const arg = (k: string, d: string): string => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1]! : d; };
const DAYS = Number(arg('days', String(DAYS_PER_YEAR)));
const ONLY = arg('only', '').split(',').filter(Boolean);
const SEEDS: Array<[64 | 128, number]> = arg('quick', '0') === '1' ? [[64, 61]] : [[64, 61], [64, 5], [64, 7], [64, 23], [64, 42], [128, 1], [128, 4], [128, 6]];
const WANT = arg('quick', '0') === '1' ? 1 : 5;

/** Intentional cost centres: safety, comfort and operations buildings are not meant to pay for themselves (they protect revenue / ratings). */
export const COST_CENTRES = new Set(['patrolHub', 'firstAid', 'helipad', 'rangerStation', 'warningSign', 'toilets', 'liftWorkshop', 'groomerGarage', 'snowcatOutpost', 'reservoir', 'snowCannon', 'shuttleDepot', 'parking', 'treeNursery', 'recyclingCentre', 'ecoCentre', 'ticketOffice', 'fishingPier', 'trainStation', 'altiport']);
/** Roles used for the dominance check (same job, same season). */
export const ROLES: Record<string, string[]> = {
  lodging: ['chalet', 'apartment', 'campground', 'smallHotel', 'luxuryHotel'],
  food: ['cafe', 'mountainHut', 'coffeeStand', 'apresBar', 'lodge', 'heatedTerrace'],
  winterFun: ['iceRink', 'stuntPark', 'kidsGround', 'sleighStable', 'snowshoeHut', 'snowscooterBase'],
  summerFun: ['adventurePark', 'alpineFarm', 'pettingZoo', 'beach', 'boatRental', 'viewpoint', 'treehouse', 'crag', 'quadBase', 'raftingBase', 'canyoningBase', 'tackleHut', 'playground'],
  energy: ['solarArray', 'solarPlant', 'windTurbine', 'smallHydro', 'biomassHeating'],
};

interface Totals { income: number; expense: number; construction: number; happiness: number; rating: number; arrivals: number; money: number }
function runYear(sim: Sim, days: number): Totals {
  const t: Totals = { income: 0, expense: 0, construction: 0, happiness: 0, rating: 0, arrivals: 0, money: 0 };
  let months = 0, arr = 0;
  sim.bus.on('guest:arrived', () => { arr++; });
  sim.bus.on('finance:monthClosed', () => {
    const r = sim.economy.lastReport();
    if (!r) return;
    t.income += r.incomeTotal; t.expense += r.expenseTotal - (r.expense.construction ?? 0); t.construction += r.expense.construction ?? 0;
    t.happiness += r.happiness; t.rating += sim.rating.stars; months++;
  });
  for (let d = 0; d < days; d++) sim.tick(240);
  t.arrivals = arr; t.happiness /= Math.max(1, months); t.rating /= Math.max(1, months); t.money = sim.game.money;
  return t;
}

const mkSim = (size: 64 | 128, seed: number): Sim => createSim({ size, seed, starterResort: true, mode: 'sandbox', now: () => 0, money: 5e6 } as never);

interface Cand { x: number; y: number; rot: number }
/** Candidate sites (real rules, funds ignored) in rings around the village, nearest first. `wide` = the whole map (lake shore, rock face, river bank, forest). */
function candidates(id: string, size: 64 | 128, seed: number, wide: boolean): Cand[] {
  const probe = mkSim(size, seed), def = BUILDINGS[id]!, c = probe.terrainInfo.villageAnchor;
  const out: Cand[] = [];
  const rmax = wide ? size : Math.min(30, Math.round(size * 0.45));
  for (let r = 2; r <= rmax && out.length < 40; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    for (let rot = 0; rot < (def.w === def.h ? 1 : 2); rot++) {
      const fw = rot % 2 ? def.h : def.w, fh = rot % 2 ? def.w : def.h;
      const x = Math.round(c.x) - (fw >> 1) + dx, y = Math.round(c.y) - (fh >> 1) + dy;
      const chk = validatePlacement(probe.env, id, x, y, rot, autoFlattenDefault(id));
      if (!chk.reasons.some((q) => !q.startsWith('Not enough funds'))) out.push({ x, y, rot });
    }
  }
  return out;
}

/** Place `id` at `at` and connect it like a player would; returns the capex, or null when it would not be connected / active. */
function addBuilding(sim: Sim, id: string, at: Cand): number | null {
  const bot = new Bot(sim, { starter: false, expand: false, marketing: false, green: false });
  const priv = bot as unknown as { ensure(k: number, r: unknown, from: Array<{ x: number; y: number }>): boolean };
  const def = BUILDINGS[id]!;
  const before = sim.game.money;
  for (const r of def.requires) if (!sim.buildings.all().some((b) => b.type === r)) {
    const pre = candidates(r, sim.size as 64 | 128, sim.seed, true)[0];
    if (!pre || addBuilding(sim, r, pre) === null) return null;
  }
  const out = placeBuilding(sim.env, sim.props, id, at.x, at.y, at.rot, autoFlattenDefault(id), false);
  if (!out.ok || !out.building) return null;
  const b = out.building;
  sim.refreshCoverage(b, out.changed.length > 0);
  const lodge = sim.buildings.all().find((x) => x.type === 'baseLodge')!;
  const ring = [{ x: lodge.x - 1, y: lodge.y + 1 }, { x: lodge.x + lodge.w, y: lodge.y + 1 }, { x: lodge.x + 1, y: lodge.y + lodge.h }];
  const kinds = [def.access, ...(def.altAccess ?? [])];
  sim.buildings.reevaluate();
  if (!sim.buildings.all().find((x) => x.id === b.id)!.active) {
    if (kinds.includes('road')) priv.ensure(NetKind.Road, b, [sim.networks.roadEntry ?? { x: -1, y: -1 }]);
    if (!kinds.includes('road') || !sim.buildings.all().find((x) => x.id === b.id)!.active) if (kinds.includes('path') || kinds.includes('trail') || kinds.includes('pisteEdge')) priv.ensure(NetKind.Path, b, ring);
    sim.buildings.reevaluate(); sim.refreshCoverage(undefined, true);
  }
  return sim.buildings.all().find((x) => x.id === b.id)!.active ? before - sim.game.money : null;
}

export interface RoiRow {
  id: string; name: string; seeds: number; capex: number; upkeepDay: number; netYear: number; se: number; incomeYear: number; expenseYear: number; paybackDays: number | null;
  happiness: number; rating: number; arrivals: number; active: boolean; flags: string[]; role: string;
}

function measure(id: string, base: Map<string, Totals>): RoiRow | null {
  const nets: number[] = [];
  const acc = { capex: 0, inc: 0, exp: 0, hap: 0, rat: 0, arr: 0, n: 0 };
  const def = BUILDINGS[id]!;
  const wide = !!(def.site.nearRock || def.site.nearWaterway || def.site.forest || def.site.onWater !== 'never' || def.streamAdjacent || def.waterSource);
  for (const [size, seed] of SEEDS) {
    if (acc.n >= WANT) break;
    let sim: Sim | null = null, capex: number | null = null;
    const cands = candidates(id, size, seed, wide);
    for (const cand of cands.slice(0, 14)) {
      const s = mkSim(size, seed);
      const c = addBuilding(s, id, cand);
      if (c !== null) { sim = s; capex = c; break; }
    }
    if (!sim || capex === null) continue;
    const key = `${size}/${seed}`;
    let b = base.get(key);
    if (!b) { b = runYear(mkSim(size, seed), DAYS); base.set(key, b); }
    const t = runYear(sim, DAYS);
    acc.capex += capex; acc.inc += t.income - b.income; acc.exp += t.expense - b.expense; nets.push((t.income - t.expense) - (b.income - b.expense));
    acc.hap += t.happiness - b.happiness; acc.rat += t.rating - b.rating; acc.arr += t.arrivals - b.arrivals; acc.n++;
  }
  if (!acc.n) return null;
  const n = acc.n;
  const netYear = nets.reduce((a, v) => a + v, 0) / n, capex = acc.capex / n;
  const sd = n > 1 ? Math.sqrt(nets.reduce((a, v) => a + (v - netYear) ** 2, 0) / (n - 1)) : 0;
  const perDay = netYear / DAYS;
  return {
    id, name: def.name, seeds: n, capex: Math.round(capex), upkeepDay: def.upkeep, netYear: Math.round(netYear), se: Math.round(sd / Math.sqrt(n)), incomeYear: Math.round(acc.inc / n), expenseYear: Math.round(acc.exp / n),
    paybackDays: perDay > 0 ? Math.round(capex / perDay) : null, happiness: +(acc.hap / n).toFixed(3), rating: +(acc.rat / n).toFixed(2), arrivals: Math.round(acc.arr / n), active: true, flags: [],
    role: Object.entries(ROLES).find(([, ids]) => ids.includes(id))?.[0] ?? (COST_CENTRES.has(id) ? 'cost centre' : '-'),
  };
}

const money = (n: number): string => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

export function flagRows(rows: RoiRow[]): void {
  for (const r of rows) {
    const centre = COST_CENTRES.has(r.id);
    const lo = r.netYear - 1.5 * r.se, hi = r.netYear + 1.5 * r.se; // a ~87 % interval on the mean over the seeds
    if (!centre && hi < 0) r.flags.push('never profitable');
    else if (!centre && r.paybackDays !== null && r.paybackDays > 3 * DAYS && lo > -1e9) r.flags.push('slow payback (> 3 years)');
    else if (!centre && r.netYear <= 0) r.flags.push('no measurable profit (within noise)');
    if (r.paybackDays !== null && r.paybackDays < 40 && lo > 0) r.flags.push('absurdly profitable');
  }
  for (const ids of Object.values(ROLES)) for (const a of rows.filter((r) => ids.includes(r.id))) for (const b of rows.filter((r) => ids.includes(r.id) && r.id !== a.id)) {
    // b is dominated by a: cheaper or equal to build, no higher upkeep, and clearly more net per year (beyond both standard errors)
    if (a.capex <= b.capex && a.upkeepDay <= b.upkeepDay && a.netYear - 1.5 * a.se > b.netYear + 1.5 * b.se && b.netYear < a.netYear * 0.5) { if (!b.flags.includes(`dominated by ${a.name}`)) b.flags.push(`dominated by ${a.name}`); }
  }
}

export function roiTable(rows: RoiRow[]): string {
  const head = `Year = ${DAYS} days from 1 December in the sandbox starter resort (all defaults on), averaged over up to 5 seeds where the building can be placed and connected; **±** is one standard error of that mean (the guest stream is chaotic: a change of less than ~2 × ± is noise).\n\n| Building | Role | Seeds | Capex | Upkeep/day | Income Δ/yr | Expense Δ/yr | **Net Δ/yr** | Payback (days) | Happiness Δ | Stars Δ | Flags |\n|---|---|---|---|---|---|---|---|---|---|---|---|`;
  const body = rows.map((r) => `| ${r.name} | ${r.role} | ${r.seeds} | ${money(r.capex)} | ${money(r.upkeepDay)} | ${money(r.incomeYear)} | ${money(r.expenseYear)} | **${money(r.netYear)}** ±${money(r.se)} | ${r.paybackDays ?? 'never'} | ${r.happiness >= 0 ? '+' : ''}${r.happiness} | ${r.rating >= 0 ? '+' : ''}${r.rating} | ${r.flags.join('; ') || '–'} |`);
  return `${head}\n${body.join('\n')}`;
}

function main(): void {
  const t0 = Date.now();
  const base = new Map<string, Totals>();
  const ids = ONLY.length ? ONLY : Object.keys(BUILDINGS);
  const rows: RoiRow[] = [];
  const skipped: string[] = [];
  for (const id of ids) {
    const r = measure(id, base);
    if (!r) { skipped.push(id); continue; }
    rows.push(r);
    console.log(`${id.padEnd(16)} capex ${money(r.capex).padStart(8)}  net/yr ${money(r.netYear).padStart(9)}  payback ${String(r.paybackDays ?? 'never').padStart(6)}  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
  flagRows(rows);
  mkdirSync('.weave/analysis', { recursive: true });
  writeFileSync('.weave/analysis/roi.json', JSON.stringify({ days: DAYS, rows, skipped }, null, 1));
  const table = roiTable(rows.sort((a, b) => b.netYear - a.netYear));
  const note = skipped.length ? `\n\nNo valid site on any ROI-sandbox map (measured in the contract suite instead): ${skipped.join(', ')}.` : '';
  const doc = 'docs/economy-audit.md';
  if (!ONLY.length && existsSync(doc)) {
    const s = readFileSync(doc, 'utf8'), a = s.indexOf('<!-- gen:roi -->'), b = s.indexOf('<!-- /gen:roi -->');
    if (a >= 0 && b >= 0) writeFileSync(doc, `${s.slice(0, a + 16)}\n${table}${note}\n${s.slice(b)}`);
  } else console.log(table + note);
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s: ${rows.length} rows, ${skipped.length} skipped`);
}
main();
