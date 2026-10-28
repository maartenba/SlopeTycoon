import { createSim, type Sim } from '../../src/game/createSim';
import { TileType } from '../../src/world/Grid';
import { OccFlag } from '../../src/world/Occupancy';
import { NetKind, lineTiles } from '../../src/world/Networks';
import { placeBuilding } from '../../src/sim/PlaceBuilding';

/**
 * Bridge fixture on the 64 / seed-61 starter: x 34..53 / y 38..52 is levelled to height 8 and a 1-tile stream runs down x = 40 (y 38..52). West of it a road from a
 * moved road entry (35,46), footpaths on y 47 / 49 and a parking lot east of the stream.
 */
export function bridgeWorld(opts: { summer?: boolean } = {}): Sim {
  const sim = createSim({ size: 64, seed: 61, now: () => 0, money: 900000, ...(opts.summer ? { startSeason: 'summer' as const } : {}) });
  const g = sim.grid;
  for (let vy = 38; vy <= 53; vy++) for (let vx = 34; vx <= 54; vx++) g.setCornerUnchecked(vx, vy, 8);
  for (let y = 38; y <= 52; y++) { g.tileType[g.tileIndex(40, y)] = TileType.Stream; g.occupancy.set(40, y, OccFlag.Water); }
  const n = sim.networks;
  n.roadEntry = { x: 35, y: 46 };
  n.buildSegment(NetKind.Road, lineTiles({ x: 35, y: 46 }, { x: 39, y: 46 }));
  n.buildSegment(NetKind.Path, lineTiles({ x: 35, y: 47 }, { x: 39, y: 47 }));
  n.buildSegment(NetKind.Path, lineTiles({ x: 35, y: 49 }, { x: 39, y: 49 }));
  return sim;
}

/** Bridges + the east-side network for the tests that need guests / cars to get across. */
export const eastSide = (sim: Sim): void => {
  const n = sim.networks;
  n.buildSegment(NetKind.Road, lineTiles({ x: 41, y: 46 }, { x: 52, y: 46 }));
  n.buildSegment(NetKind.Path, lineTiles({ x: 41, y: 47 }, { x: 46, y: 47 }));
  placeBuilding(sim.env, sim.props, 'parking', 47, 42, 0, true, true);
  sim.buildings.reevaluate();
};
