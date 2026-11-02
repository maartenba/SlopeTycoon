/**
 * Sled runs and the alpine coaster (Phase 7 M7.3, docs/sled-runs.md). Two paintable single-tile layers (`Layer.Sled`, `Layer.Coaster`), ridden from a
 * Sled Rental / Coaster Station (a tour base, `config/tours.ts`). Config module: no sim / render imports.
 */
export type SledKind = 'sled' | 'coaster';

export const SLED = {
  /** Paint cost per tile: a packed, banked run is cheap; a steel coaster rail is not. */
  costPerTile: { sled: 22, coaster: 85 } as Readonly<Record<SledKind, number>>,
  /** Steepest single tile (`Grid.steepness`, half-steps per tile): beyond it the run is unsafe ("Too steep for sleds"). The coaster rail is braked and may be steeper. */
  maxSteep: { sled: 2.0, coaster: 2.6 } as Readonly<Record<SledKind, number>>,
  /** Mean drop per tile (half-steps) below which the sled stops: a run needs some fall ("Too flat: sleds stop"). The coaster is motor-assisted. */
  minMeanSteep: { sled: 0.3, coaster: 0 } as Readonly<Record<SledKind, number>>,
  /** The ride (tour route) is at least this many tiles. */
  minTiles: { sled: 8, coaster: 10 } as Readonly<Record<SledKind, number>>,
  /** A lift that carries sleds counts when its station anchor is within this many tiles (Chebyshev) of the end of the run. */
  liftReach: 3,
  /** With a carrying lift the ride is this much shorter (nobody walks up). */
  liftTimeMult: 0.5,
  /** Walking back up costs the ride this much extra (a parallel footpath is assumed). */
  walkUpMult: 1.0,
} as const;

export const SLED_MSG = {
  steep: 'Too steep for sleds: keep the run under a red gradient',
  steepCoaster: 'Too steep even for a coaster rail',
  flat: 'Too flat: sleds stop',
  orphan: 'Start the run next to its rental hut, a path, a lift station or an existing run',
  nothing: 'Blocked: nothing to paint here',
} as const;

export const SLED_LABEL: Readonly<Record<SledKind, string>> = { sled: 'Sled run', coaster: 'Alpine coaster' };
