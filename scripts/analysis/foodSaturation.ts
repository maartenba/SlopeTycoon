/**
 * Food saturation sweep (M7.2, docs/economy-audit.md "Food buildings"): `vite-node scripts/analysis/foodSaturation.ts [-- --types cafe,lodge --counts 0,1,2,3,5,8 --seeds 61,5,7]`.
 * The sandbox starter resort (createSim defaults) runs one year with N EXTRA buildings of one food type (placed one by one with the real rules, connected like the Bot does).
 * Prints the net (income - expenses without construction) per N, the marginal net of the last building, and capex, so spamming a food building can be judged.
 */
import { createSim, type Sim } from '../../src/game/createSim';
import { Bot } from '../../src/game/bot';
import { BUILDINGS } from '../../src/config/buildings';
import { placeBuilding, validatePlacement } from '../../src/sim/PlaceBuilding';
import { autoFlattenDefault } from '../../src/sim/PlacementRules';
import { NetKind } from '../../src/world/Networks';
import { DAYS_PER_YEAR } from '../../src/config/balance';

const argv = process.argv.slice(2).filter((a) => a !== '--');
const arg = (k: string, d: string): string => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1]! : d; };
const FROM_ZERO = arg('zero', '0') === '1';
const DAYS = Number(arg('days', String(DAYS_PER_YEAR)));
interface Totals { income: number; expense: number; construction: number; happiness: number; rating: number; arrivals: number; money: number }
export function runYear(sim: Sim, days: number): Totals {
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

export const mkSim = (size: 64 | 128, seed: number): Sim => createSim({ size, seed, starterResort: true, mode: 'sandbox', now: () => 0, money: 5e6 } as never);

interface Cand { x: number; y: number; rot: number }
/** Candidate sites (real rules, funds ignored) in rings around the village, nearest first. `wide` = the whole map (lake shore, rock face, river bank, forest). */
export function candidates(id: string, probe: Sim, wide: boolean): Cand[] {
  const size = probe.size as 64 | 128, def = BUILDINGS[id]!, c = probe.terrainInfo.villageAnchor;
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
export function addBuilding(sim: Sim, id: string, at: Cand): number | null {
  const bot = new Bot(sim, { starter: false, expand: false, marketing: false, green: false });
  const priv = bot as unknown as { ensure(k: number, r: unknown, from: Array<{ x: number; y: number }>): boolean };
  const def = BUILDINGS[id]!;
  const before = sim.game.money;
  for (const r of def.requires) if (!sim.buildings.all().some((b) => b.type === r)) {
    const pre = candidates(r, sim, true)[0];
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


/** One year of the sandbox starter resort with `n` EXTRA buildings of a food `type` (`zero`: the other food places removed first). Net = income - expenses without construction. */
export function foodYear(type: string, n: number, seed: number, size: 64 | 128 = 64, days = DAYS_PER_YEAR, zero = false): { net: number; income: number; expense: number; capex: number; placed: number } {
  const sim = mkSim(size, seed);
  if (zero) { for (const b of sim.buildings.all().slice()) if (['cafe', 'lodge', 'mountainHut', 'heatedTerrace', 'apresBar', 'coffeeStand'].includes(b.type)) sim.buildings.remove(b.id); sim.refreshCoverage(undefined, true); }
  let capex = 0, placed = 0;
  for (let i = 0; i < n; i++) {
    let ok = false;
    for (const cand of candidates(type, sim, false).slice(0, 25)) { const c = addBuilding(sim, type, cand); if (c !== null) { capex += c; placed++; ok = true; break; } }
    if (!ok) break;
  }
  const t = runYear(sim, days);
  return { net: t.income - t.expense, income: t.income, expense: t.expense, capex, placed };
}

export interface FoodRow { type: string; n: number; net: number; income: number; expense: number; capex: number; marginal: number; marginalIncome: number; marginalExpense: number; active: number }
const k = (n: number): string => `${n >= 0 ? '+' : ''}${(n / 1000).toFixed(1)}k`;
function main(): void {
  const types = arg('types', 'cafe,mountainHut,lodge,heatedTerrace').split(',');
  const counts = arg('counts', '0,1,2,3,5,8').split(',').map(Number);
  const seeds = arg('seeds', '61,5,7').split(',').map(Number);
  const size = Number(arg('size', '64')) as 64 | 128;
  const results: FoodRow[] = [];
  for (const type of types) {
    const per: Record<number, { net: number; inc: number; exp: number; capex: number; act: number }> = {};
    for (const n of counts) per[n] = { net: 0, inc: 0, exp: 0, capex: 0, act: 0 };
    for (const seed of seeds) for (const n of counts) {
      const sim = mkSim(size, seed);
      if (FROM_ZERO) { for (const b of sim.buildings.all().slice()) if (['cafe', 'lodge', 'mountainHut', 'heatedTerrace', 'apresBar', 'coffeeStand'].includes(b.type)) sim.buildings.remove(b.id); sim.refreshCoverage(undefined, true); }
      let capex = 0, act = 0;
      for (let i = 0; i < n; i++) {
        let placed = false;
        for (const cand of candidates(type, sim, false).slice(0, 25)) { const c = addBuilding(sim, type, cand); if (c !== null) { capex += c; act++; placed = true; break; } }
        if (!placed) break;
      }
      const t = runYear(sim, DAYS);
      if (arg('util', '0') === '1' && n > 0) console.log(`  seed ${seed} +${n} ${type} served/day: ${sim.attractions.all().filter((a) => a.b.type === type).sort((a, z) => a.b.id - z.b.id).map((a) => `${(a.stats.served / DAYS).toFixed(1)}/${a.capacity()}`).join(' ')}`);
      const p = per[n]!; p.net += (t.income - t.expense) / seeds.length; p.inc += t.income / seeds.length; p.exp += t.expense / seeds.length; p.capex += capex / seeds.length; p.act += act / seeds.length;
    }
    let prev = per[counts[0]!]!;
    for (const n of counts) {
      const p = per[n]!, dn = Math.max(1, n - counts[counts.indexOf(n) - 1]! || 1);
      const r: FoodRow = { type, n, net: Math.round(p.net), income: Math.round(p.inc), expense: Math.round(p.exp), capex: Math.round(p.capex), marginal: Math.round(n === counts[0] ? 0 : (p.net - prev.net) / dn), marginalIncome: Math.round(n === counts[0] ? 0 : (p.inc - prev.inc) / dn), marginalExpense: Math.round(n === counts[0] ? 0 : (p.exp - prev.exp) / dn), active: +p.act.toFixed(1) };
      results.push(r);
      console.log(`${type.padEnd(14)} +${n}: net ${k(r.net)} income ${k(r.income)} expense ${k(r.expense)} capex ${k(r.capex)} | marginal per building: net ${k(r.marginal)} (income ${k(r.marginalIncome)}, expense ${k(r.marginalExpense)}) placed ${r.active}`);
      prev = p;
    }
  }
  console.log(JSON.stringify(results));
}
if (process.argv.some((a) => a.includes('foodSaturation'))) main();
