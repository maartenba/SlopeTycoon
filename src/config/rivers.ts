/** Dug rivers + springs (Phase 6 M6.2, docs/rivers.md). Owner decisions R2-2 / R2-3: 1 tile wide, max carve 6 height steps per tile, no upkeep, springs cost a small fee. */
export const RIVER = {
  /** Deepest cut (half-steps) of ONE channel tile below the ground it was dug into. */
  maxCarve: 6,
  /** Longest stroke (tiles). */
  maxTiles: 400,
  /** Shortest sensible river (tiles). */
  minTiles: 3,
  /** Per channel tile (clearing, lining); earthworks are charged on top at the terrain's half-step price. */
  costPerTile: 30,
  /** Search weights: a carved half-step counts as this many tiles of walking. */
  carveWeight: 3,
  /** Ripple of the ground around a deep cut: gentle edge delta keeps the banks soft. */
  maxEdgeDelta: 2 as 1 | 2,
  /** Node budget of one search (keeps the planner under a few ms on 256 maps). */
  maxExpand: 40000,
} as const;

export const SPRING = {
  /** Player-placed spring ($, x construction multiplier). Bulldozing refunds nothing. */
  cost: 250,
  /** A site needs this many strictly higher 4-neighbours. */
  minHigherNeighbours: 2,
  /** Natural sites: how many (1..3), distance (tiles) to a lake tile / stream head, map-edge margin, spacing. */
  naturalMin: 1,
  naturalMax: 3,
  nearMin: 2,
  nearMax: 6,
  edgeMargin: 3,
  spacing: 10,
  /** Version of the derivation: bump only with a migration note (saved in the `rivers` module). */
  sitesVersion: 1,
} as const;
