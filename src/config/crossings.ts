/**
 * Rail level crossings (Phase 6, docs/crossings.md). Data only: the sim (`sim/RailCrossings.ts`), the placement rule
 * (`world/Networks.ts`), navigation and the renderer read these numbers.
 */
export const CROSSING = {
  /** Build cost per crossing tile ($), on top of nothing: the rail already exists (or the path does). Multiplied by the construction multiplier. */
  cost: { path: 150, road: 400 },
  /** Another crossing within this Manhattan distance blocks a new one (so two crossings are at least minSpacing + 1 tiles apart). */
  minSpacing: 2,
  /** The barriers close this many sim ticks before the train reaches the tile. Must exceed the longest time a guest or car needs to leave a tile (<= 1 tick). */
  leadTicks: 4,
  /** Tiles of train behind its nose that keep the crossing closed (the train model is ~2.4 tiles long) + a safety margin. */
  trainTailTiles: 3,
  /** Expected-wait cost added to a navigation step INTO a crossing tile (cost units ~ tiles; makes guests prefer a footbridge or another way when it is cheap). */
  waitCost: 3,
  /** Guests waiting this many ticks in total at crossings (per day) before the advisor suggests a footbridge. */
  advisorWaitTicksPerDay: 400,
  /** Footbridge over rail (Task 11). */
  /** MTB ramp bridge over rail: bikes cannot take stairs, so long ramps on both approach tiles (more expensive than the footbridge). */
  mtbBridge: { cost: 1100, steps: 10 },
  footbridge: { cost: 900, /** Deck height above the rail (world units; a train is ~0.6 tall). Guests climb the stairs on the approach tiles up to it. */ deck: 1.0, steps: 5 },
  /**
   * Road overpass over rail (docs/crossings.md). The deck is flat over the rail tile and ramps down `ramp` tiles each side (7 or 9 tiles in all).
   * `deck` = height of the road above the rail surface (world units; a train is ~0.6 tall, so 0.5 margin). `maxGrade` = steepest ramp (units of rise per tile).
   */
  overpass: { base: 900, perTile: 150, deck: 1.1, ramps: [3, 4] as readonly number[], maxGrade: 0.4, wall: 0.18 },
} as const;

export type CrossKind = 1 | 2;
