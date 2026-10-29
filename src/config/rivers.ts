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

/** Flow model (Phase 6 Task 15, docs/rivers.md "Flow"). Q = relative discharge; speed / class drive rendering, tours and habitat. */
export const FLOW = {
  /** Source base discharge: natural stream head, placed / natural spring, lake outlet, branch = this share of the parent's Q at the branch tile. */
  base: { natural: 1, spring: 1, lake: 2, stream: 0.5 },
  /** Season factor on Q by SIM month (0 = April .. 11 = March): snowmelt in spring, low in late summer (Aug / Sep), a little down in autumn, winter normal. */
  monthFactor: [1.5, 1.5, 1, 1, 0.7, 0.7, 0.8, 0.8, 1, 1, 1, 1] as readonly number[],
  /** Slope window (tiles each side of a tile) used for the drop per tile. */
  window: 2,
  /** Speed v = (vBase + vSlope * slope) * sqrt(clamp(Q, qMin, qMax)); slope = half-steps of drop per tile. */
  vBase: 0.3, vSlope: 0.7, qMin: 0.25, qMax: 4,
  /** Class thresholds on v. */
  brisk: 0.7, rapids: 1.3,
  /** Render speed multiplier per class is `min(vMax, v)`. */
  vMax: 2.2,
  /** Sustainability: running water is wildlife habitat. +1 point per `perTiles` dug river tiles, at most `max` (0 without dug rivers). */
  habitat: { perTiles: 40, max: 2 },
} as const;

/** River ice (Phase 6 Task 17). Daily mean valley temperature, hysteresis. */
export const RIVER_ICE = {
  freezeBelow: -2, freezeDays: 3,
  thawAbove: 1, thawDays: 2,
} as const;
