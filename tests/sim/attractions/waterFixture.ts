/** Shared fixtures of the water tour tests (Phase 6 Task 24): a starter resort in summer, a steep dug river, a connected tour base beside it. */
import { createSim, type Sim } from '../../../src/game/createSim';
import { applySpring, applyRemoveSpring, planSpring } from '../../../src/world/Rivers';
import { applyRiver, planRiver } from '../../../src/world/RiverPlanner';
import { placeBuilding, validatePlacement } from '../../../src/sim/PlaceBuilding';
import { planPathTo, buildNetwork } from '../../../src/tutorial/suggest';
import { seasonStartDay } from '../../../src/sim/Clock';

export const SUMMER = seasonStartDay('summer') + 20;

export const mkSim = (seed = 61, size: 64 | 128 = 64): Sim => {
  const sim = createSim({ size, seed, starterResort: true, mode: 'sandbox', startSeason: 'summer', now: () => 0, money: 5_000_000 } as never);
  sim.progression.unlockAll = true;
  return sim;
};

/** Dig a river from a placed spring (default (20, 21) on seed 61 / 64: ~40 tiles, 6 brisk tiles, 5 steep ones). Returns the river path. */
export function digRiver(sim: Sim, from = { x: 20, y: 21 }): Array<{ x: number; y: number }> {
  const env = sim.riverEnv();
  const sp = planSpring(env as never, sim.rivers, from.x, from.y);
  if (!sp.ok) throw new Error(`spring: ${sp.reason}`);
  applySpring(env as never, sim.rivers, sp);
  const p = planRiver(env, from);
  if (!p.ok) { applyRemoveSpring(env as never, sim.rivers, from.x, from.y); throw new Error(`river: ${p.reason}`); }
  const r = applyRiver(env, sim.rivers, p);
  if (!r.ok) throw new Error('apply failed');
  return p.path;
}

/** Place `type` at the first site the real placement rules accept and a footpath can reach; connects it. Returns the building id. */
export function placeBase(sim: Sim, type: string, w: number, h: number, skip = 0): number {
  const n = sim.size;
  let seen = 0;
  for (let y = 3; y < n - 5; y++) for (let x = 3; x < n - 5; x++) {
    if (validatePlacement(sim.env, type, x, y, 0, true).reasons.length) continue;
    const path = planPathTo(sim, { x, y, w, h });
    if (!path) continue;
    if (seen++ < skip) continue;
    const o = placeBuilding(sim.env, sim.props, type, x, y, 0, true, true);
    if (!o.ok) continue;
    if (path.length) buildNetwork(sim, 1, path);
    sim.refreshCoverage(o.building!, true); sim.buildings.reevaluate();
    if (!sim.buildings.get(o.building!.id)!.active) { sim.buildings.remove(o.building!.id); continue; }
    return o.building!.id;
  }
  throw new Error(`no connectable ${type} site`);
}

export const setSummer = (sim: Sim, day = SUMMER): void => { sim.game.date.day = day; sim.tick(1); };
export const setHour = (sim: Sim, h: number): void => { sim.game.date.minute = Math.round(h * 60); };
