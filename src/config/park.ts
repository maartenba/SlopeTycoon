/**
 * Snow park and Freestylers (0.9.0, docs/snow-park.md). A RUN (docs/runs.md) is marked as a snow park by the player (level 3, no building); the features (kickers, boxes, rails)
 * are placed automatically along its centre line; the snowcat SHAPES it (a groom pass on its tiles) and the riders wear it. A Halfpipe building beside a park run adds a pipe.
 * All numbers live here.
 */
export type ParkReason = 'shape' | 'difficulty' | 'length' | 'tooMany' | 'noGroomer' | 'gone';
export type FeatureKind = 'kickerS' | 'kickerM' | 'kickerL' | 'box' | 'rail';

export const PARK = {
  /** Run difficulty 1 green .. 4 black: blue or harder. */
  minDifficulty: 2,
  /** Minimum length of the run in metres. */
  minLengthM: 100,
  /** Parks that count (more can be marked: the extra ones are refused). */
  maxParks: 2,
  /** A snowcat garage must exist (shaping needs a groomer). */
  needsGarage: true,
  /** Features: centre-line tiles between two features by run difficulty, the first tiles / last tiles left clear, the cycle of kinds by difficulty. */
  spacing: { 2: 4, 3: 3, 4: 3 } as Record<number, number>,
  clearStart: 2, clearEnd: 2,
  cycle: {
    2: ['kickerS', 'box', 'kickerS', 'rail'],
    3: ['kickerM', 'rail', 'kickerM', 'box', 'kickerL'],
    4: ['kickerL', 'rail', 'kickerM', 'kickerL', 'box'],
  } as Record<number, readonly FeatureKind[]>,
  /** Air of a kicker (world units, peak height) and the half-spin turns a rider throws on it; a box / rail is a short slide with a small hop. Render only. */
  air: { kickerS: 0.5, kickerM: 0.9, kickerL: 1.3, box: 0.16, rail: 0.18 } as Record<FeatureKind, number>,
  spin: { kickerS: 0, kickerM: 1, kickerL: 2, box: 0, rail: 0 } as Record<FeatureKind, number>,
  /** A feature affects a rider within this many tiles (render airs). */
  reach: 1.6,
  /** Shape 0..1: the start value of a fresh park, the daily decay, the wear of a lap, the gain of one groomed tile is `1 / (shapeShare x tiles)`. */
  shape: { start: 0.6, daily: 0.06, lap: 0.004, shapeShare: 0.6, worn: 0.4 },
  /** Dollars per Freestyler and day (first lap of the day) and per lap through a Halfpipe beside the park. */
  fee: 16, pipeFee: 4,
  /** Freestylers alive at once per park, and the laps they train (inclusive range, seeded per guest). */
  maxPerPark: 10,
  laps: [4, 8] as readonly [number, number],
  /** Arrival demand: `quality = floor + (1 - floor) x shape`, halved while worn; a Halfpipe adds this much. */
  qualityFloor: 0.35, wornDemand: 0.5, pipeDemand: 0.25,
  /** Injury roll multiplier of a Freestyler (airs are risky): base, plus this much x (1 - shape) (so a worn park is rougher). Never deaths. */
  injury: { base: 1.5, worn: 1.6 },
  /** Snowboarders prefer a park run a little when one is open (a via score bonus; 0 without a park, nothing changes). */
  boarderBonus: 0.45,
  /** The Halfpipe building counts for a park when its footprint is within this many tiles of one of the park's tiles. */
  pipeReach: 3,
  /** Share of the park's own shaping a Halfpipe shares: it is cut by the same groomer pass (a pipe beside a worn park is worn too). */
  pipeTricks: 2,
  /** Pseudo building id the spawner computes (an open, valid park). */
  cond: '@snowPark',
  typeId: 'freestyler',
  /** Achievement threshold: tricks thrown (each lap counts the features of its park, at most 6). */
  tricksAchievement: 100,
  maxTricksPerLap: 6,
  reasons: {
    shape: 'Needs a single clear run, not a loop',
    difficulty: 'Needs a blue, red or black run',
    length: 'Needs a run of at least 100 m',
    tooMany: 'Two snow parks is the limit',
    noGroomer: 'Needs a Groomer Garage to shape it',
    gone: 'The run is gone',
  } as Record<ParkReason, string>,
} as const;
