/**
 * Racers and the race course (0.8.0, docs/race-course.md). A RUN (docs/runs.md) is marked as a race course by the player; it is valid while it is a red or black run with a
 * real drop, a Start Hut beside its top and a Timing Hut beside its foot. A Racer guest trains on it. All numbers live here (nothing hand-tuned elsewhere).
 */
export const RACE = {
  /** Run difficulty 1 green .. 4 black: a course needs red (3) or black (4). */
  minDifficulty: 3,
  /** Minimum drop of the run in metres. */
  minDropM: 60,
  /** A hut counts when its footprint is within this many tiles of the top (Start Hut) / foot (Timing Hut) of the centre line. */
  hutReach: 2,
  /** Centre-line tiles inspected at each end of the run when looking for a hut. */
  endTiles: 3,
  /** Tiles between two gates, by run difficulty (red 2, black 1: a black course is tighter; the plan said 3 / 2, but runs on a 64 map are only ~10 tiles long). */
  gateSpacing: { 3: 2, 4: 1 } as Record<number, number>,
  /** Perpendicular offset of a gate from the centre line, in tiles. */
  gateOffset: 0.6,
  /** Dollars per racer and day (charged on the first lap of the day; a small steady income, never a money machine). */
  courseFee: 14,
  /** Racers alive at once per valid course, and valid courses that count. */
  maxRacersPerCourse: 12,
  maxCourses: 3,
  /** Arrival share of the Racer type (a season share of the extra-type draw; scaled by the quality of the courses). */
  share: 0.03,
  /** Downhill speed of a racer (a multiple of the normal ski speed). */
  speedMul: 1.4,
  /** A racer trains this many laps (inclusive range, seeded per guest) and then leaves. */
  laps: [3, 6] as readonly [number, number],
  /** Quality of a course: groomed within a day / two days / worse. */
  groomQuality: { fresh: 1.0, stale: 0.7, ungroomed: 0.4 },
  /** Black courses draw a little more than red ones. */
  diffQuality: { 3: 0.8, 4: 1.0 } as Record<number, number>,
  /** Pseudo building id the spawner computes (a valid, open course). */
  cond: '@raceCourse',
  /** Metres per second of a course time at a quality of 1 (timing board only; cosmetic). */
  boardMps: 21,
  /** The Racer type id (config/guestTypes.ts). */
  typeId: 'racer',
  /** Achievement threshold: racer laps. */
  lapsAchievement: 100,
  /** The reasons a run is not a (valid) course, as shown to the player. */
  reasons: {
    difficulty: 'Needs a red or black run',
    drop: 'Needs a drop of at least 60 m',
    shape: 'Needs a single clear run, not a loop',
    noStartHut: 'Needs a Start Hut at the top',
    noTimingHut: 'Needs a Timing Hut at the foot',
    tooMany: 'Three courses is the limit',
  },
} as const;
export type CourseReason = keyof typeof RACE.reasons;
