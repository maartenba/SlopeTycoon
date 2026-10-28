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
  footbridge: { cost: 900, span: 1 },
} as const;

export type CrossKind = 1 | 2;
