import { createSim, type Sim } from '../../src/game/createSim';
import { Cross, NetKind, lineTiles } from '../../src/world/Networks';
import { placeBuilding } from '../../src/sim/PlaceBuilding';
import { defaultMarketing } from '../../src/sim/guests/Spawner';

/**
 * Crossing fixture on the 64 / seed-61 starter: the rail stub (x 38, y 58..63) is extended north to a Train Station (37,50); a footpath from the
 * road at (27,60) via (36,57) runs east across the rail at (38,57) to a Café at (41,58) (the only place east of the line), so every café visitor crosses.
 */
export function crossingWorld(opts: { footbridge?: boolean; bias?: number; road?: boolean } = {}): Sim {
  const sim = createSim({ size: 64, seed: 61, now: () => 0, money: 900000 });
  addCrossingLayout(sim, opts);
  const bias = opts.bias ?? 0.9;
  sim.guestSim.spawner.marketingFn = () => ({ ...defaultMarketing(), railBias: bias });
  return sim;
}

/** Builds the layout described above into an existing 64 / seed-61 starter sim. */
export function addCrossingLayout(sim: Sim, opts: { footbridge?: boolean; road?: boolean } = {}): void {
  const n = sim.networks;
  n.buildSegment(NetKind.Rail, lineTiles({ x: 38, y: 57 }, { x: 38, y: 50 }));
  placeBuilding(sim.env, sim.props, 'trainStation', 37, 50, 1, true, true);
  placeBuilding(sim.env, sim.props, 'shuttleDepot', 27, 57, 0, true, true);
  n.buildSegment(NetKind.Path, lineTiles({ x: 27, y: 60 }, { x: 36, y: 60 }));
  n.buildSegment(NetKind.Path, lineTiles({ x: 36, y: 59 }, { x: 36, y: 52 }));
  n.buildSegment(NetKind.Path, lineTiles({ x: 34, y: 54 }, { x: 36, y: 54 }));
  n.buildSegment(NetKind.Path, lineTiles({ x: 36, y: 57 }, { x: 42, y: 57 }), opts.footbridge === true);
  placeBuilding(sim.env, sim.props, 'cafe', 41, 58, 0, true, true);
  if (opts.road) { // a road across the line at (38,62) to a car park on the far side: cars wait at the crossing
    n.buildSegment(NetKind.Road, lineTiles({ x: 26, y: 62 }, { x: 50, y: 62 }));
    placeBuilding(sim.env, sim.props, 'parking', 47, 58, 0, true, true);
  }
  sim.buildings.reevaluate();
}

export const CROSS_TILE = (sim: Sim): number => 57 * sim.size + 38;
export const crossKindAt = (sim: Sim): number => sim.networks.cross[CROSS_TILE(sim)]!;
export { Cross };

export const ROAD_TILE = (sim: Sim): number => 62 * sim.size + 38;
