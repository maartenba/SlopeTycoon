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
  courseFee: 20,
  /** Racers alive at once per valid course, and valid courses that count. */
  maxRacersPerCourse: 12,
  maxCourses: 3,
  /** Arrival share of the Racer type (a season share of the extra-type draw; scaled by the quality of the courses). */
  share: 0.06,
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
  /** Metres per second of a course time at a quality of 1 (timing board only; cosmetic, the sim never uses it). */
  boardMps: 9,
  /** Seconds every course time starts with (start gate, flat bits); a 120 m course reads about 0:45, a 600 m one about 1:35. */
  boardBaseS: 30,
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

/**
 * Race days (0.8.1, docs/race-course.md "Race days"): a Club Race the player books on a weekend, spectators, a sponsor, and the World Cup on the course.
 * Economy guard: a race day earns at most `earnCapVsSaturday` x a normal Saturday (checked by `npm run analysis:race`).
 */
export const RACE_DAY = {
  /** Booking: dollars, days of notice, the weekdays allowed (Clock weekday 5 = Saturday, 6 = Sunday), at most this many per calendar week (Monday to Sunday). */
  cost: 3_000, leadDays: 2, weekdays: [5, 6] as readonly number[], perWeek: 1, minLevel: 3,
  /** Refund share when cancelled before the day. */
  refund: 0.8,
  /** The course is closed to the public from `from` to `to` o'clock (reason "Race day"); spectators are called in at these hours (top-ups). */
  from: 10, to: 14, spectatorHours: [10, 11, 12] as readonly number[],
  /** Race field (inclusive range) of a club race and of a World Cup day. */
  field: [20, 30] as readonly [number, number], fieldWorldCup: [36, 48] as readonly [number, number],
  /** Entry fee per racer (dollars), income category `recreation`. */
  entryFee: 15, entryFeeWorldCup: 25,
  /** Extra arrivals on the race day itself (a club race is a small draw; the World Cup keeps its own festival multiplier). */
  arrivalMult: 1.1,
  /** Spectators (existing guests): cap per race, by course colour (a black course draws more). Hard ceiling 40. */
  spectators: { club: { 3: 18, 4: 28 }, worldCup: { 3: 32, 4: 40 } } as Record<'club' | 'worldCup', Record<number, number>>,
  maxSpectators: 40,
  /** Spectators sent per hour at most (the crowd builds up). */
  perWave: 16,
  /** Candidates must be within this many tiles of the Timing Hut. */
  radius: 40,
  /** Spectators who watched get this much hungry afterwards (they eat and drink at the nearby shops). */
  hungerAfter: 0.35,
  /** The sponsor rating bonus fades linearly over this many days. */
  bonusDays: 14,
  /** World Cup on a BLACK course draws a little more (festival arrival multiplier x). */
  worldCupBlackMult: 1.08,
  /** A race day earns (fees + sponsor + shop income of the day) at most this much more than a normal Saturday. */
  earnCapVsSaturday: 1.5,
  /** Results kept (latest first). */
  keepResults: 6,
  /** Fictional racer names (a first initial + one of these). */
  winners: ['Berger', 'Huber', 'Steiner', 'Moser-Alm', 'Kofler', 'Egger', 'Lindner', 'Vogl', 'Haas', 'Brandt', 'Wieser', 'Pichler'] as readonly string[],
  /** News texts. */
  reasons: { cancelled: 'Race day cancelled: the course is not ready' },
} as const;
export type RaceKind = 'club' | 'worldCup';

export type CourseReason = keyof typeof RACE.reasons;
