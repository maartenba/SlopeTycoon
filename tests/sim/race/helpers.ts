import { createSim, type Sim } from '../../../src/game/createSim';
import { placeBuilding } from '../../../src/sim/PlaceBuilding';
import { Layer } from '../../../src/world/Networks';
import type { Run } from '../../../src/world/Runs';

export const mkWinter = (seed = 61): Sim => {
  const s = createSim({ size: 64, seed, starterResort: true, mode: 'sandbox', startSeason: 'winter', now: () => 0 } as never);
  s.tick(240 * 3 + 20);
  s.game.money = 5_000_000;
  s.progression.unlockAll = true;
  return s;
};
/** The run with the biggest drop. */
export const mainRun = (s: Sim): Run => [...s.runIndex.runs()].sort((a, b) => b.dropM - a.dropM)[0]!;
/** Repaint every tile of a run with a stored difficulty (0 green .. 3 black): the run reads 1..4. */
export function paintRun(s: Sim, run: Run, stored: number): void {
  const n = s.size;
  s.networks.paint(Layer.Ski, run.tiles.map((t) => ({ x: t % n, y: (t / n) | 0 })), stored);
}
/** Place a hut within `reach` tiles of a centre-line tile, trying a ring of offsets. Returns its id (or null). */
export function putHutNear(s: Sim, type: 'startHut' | 'timingHut', tile: number, reach = 2): number | null {
  const n = s.size, tx = tile % n, ty = (tile / n) | 0;
  for (let r = 1; r <= reach + 1; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const o = s.progression.withBypass(() => placeBuilding(s.env, s.props, type, tx + dx, ty + dy, 0, true, false));
    if (o.ok) { s.buildings.reevaluate(); s.refreshCoverage(undefined, true); return o.building!.id; }
  }
  return null;
}
export interface Fixture { s: Sim; run: Run; id: number }
/** A red (or black) course run with both huts, not yet marked. */
export function courseFixture(stored = 2, seed = 61): Fixture {
  const s = mkWinter(seed);
  const id = prepareCourse(s, stored);
  return { s, run: mainRun(s), id };
}
/** Repaint the main run, place both huts (not yet marked). Returns the persistent run id. */
export function prepareCourse(s: Sim, stored = 2): number {
  const run = mainRun(s);
  paintRun(s, run, stored);
  const r2 = mainRun(s);
  const first = (type: 'startHut' | 'timingHut', tiles: number[]): number | null => { for (const t of tiles) { const id = putHutNear(s, type, t); if (id !== null) return id; } return null; };
  const p = r2.poly, a = first('startHut', [p[1]!, p[0]!, p[2]!]), b = first('timingHut', [p[p.length - 2]!, p[p.length - 1]!, p[p.length - 3]!]);
  if (a === null || b === null) throw new Error('huts could not be placed');
  s.tick(1);
  return s.names.pisteId(mainRun(s));
}
