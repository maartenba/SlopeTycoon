import { mkWinter, mainRun, paintRun, absDay } from '../race/helpers';
import type { Sim } from '../../../src/game/createSim';

export { mkWinter, mainRun, paintRun, absDay };
/** A winter resort whose biggest run is repainted `stored` (0 green .. 3 black) and is long enough for a park; returns the persistent run id. */
export function parkFixture(stored = 1, seed = 61): { s: Sim; id: number } {
  const s = mkWinter(seed);
  paintRun(s, mainRun(s), stored);
  s.tick(1);
  return { s, id: s.names.pisteId(mainRun(s)) };
}

import { placeBuilding } from '../../../src/sim/PlaceBuilding';
/** Place a Halfpipe beside a park run (tries rings of offsets around the centre-line tiles, both rotations). Returns its building id or null. */
export function putPipeNear(s: Sim, tiles: readonly number[]): number | null {
  const n = s.size;
  for (const t of tiles) for (let r = 1; r <= 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    for (const rot of [0, 1]) {
      const o = s.progression.withBypass(() => placeBuilding(s.env, s.props, 'halfpipe', (t % n) + dx, ((t / n) | 0) + dy, rot, true, false));
      if (o.ok) { s.buildings.reevaluate(); s.refreshCoverage(undefined, true); if (o.building!.active) return o.building!.id; s.buildings.remove(o.building!.id); }
    }
  }
  return null;
}
/** Freestylers alive. */
export function freestylers(s: Sim): number { const st = s.guestSim.store; let c = 0; for (let i = 0; i < st.limit; i++) if (st.alive[i] && st.type[i] === 16) c++; return c; }
