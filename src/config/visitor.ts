/** Rare high-country visitor (winter only, harmless, observer-only state). Numbers only; the logic is `src/sim/nature/Visitor.ts`. */
export const VISITOR = {
  /** Chance that a given sim year has a visit (winter days are 60 of 180, so ~1 per 2 years). */
  yearChance: 0.5,
  /** First / last day-of-year a visit may start (winter; the first days of a new game stay quiet). */
  dayMin: 130, dayMax: 175,
  /** Start hour range and visible time (sim hours). A sim hour is ~6 s at 1x, so the visit has to last long enough to be found. */
  hourMin: 7, hourMax: 9, durMinH: 7, durMaxH: 10,
  /** The ranger follow-up news comes this many sim hours after the visitor has gone. */
  followUpH: 3,
  /** Footprints stay (fading in the last quarter) for this many sim days. */
  trackDays: 2,
  /** Ground rules: height share of the map's range, snow depth, empty radius (tiles) around buildings / lifts / pistes by map size. */
  altFrac: 0.55, altFracLow: 0.4, minSnow: 0.05, emptyR: { 64: 6, 128: 10, 256: 12 } as Record<number, number>,
  attempts: 700, wanderR: 4, steps: 12, stepMin: 2, stepMax: 4, leadIn: 8,
  /** One footfall every `stepLen` tiles (two steps = one gait cycle; at ~0.4 tiles/s that is about a step a second at 1x). Footprints sit at the footfalls, alternating left / right. */
  stepLen: 0.3,
  /** Walking pace (tiles per sim minute; a sim minute is ~0.1 s at 1x => 0.3 tiles/s, one step a second). The path is made long enough to fill about `walkShare` of the visit at this pace; a longer path is walked faster, never slower. */
  pace: 0.03, walkShare: 0.7, printAhead: 0.1,
  /** Plodding: it stops at these waypoints (indices into the path) for `pauseMin` sim minutes to look around, and waves once (`waveMin`, the same as the fade-out) before it goes. */
  pauseAt: [2, 4] as readonly number[], pauseMin: 36, waveMin: 45,
  /** 'Show me' camera offset ring (tiles) from where the visitor was first seen. */
  showMe: { min: 6, max: 12 },
  /** Guests within this many tiles of the visitor react once (most: a small mood bump, some: a brief fright; nobody is hurt). */
  reactR: 14, cheer: 0.05, fright: 0.06,
  /**
   * Mountain buzz: a sighting brings +10 % arrivals for ONE in-game month (a game month is 15 sim days: 12 months = 180-day year), counted from the start
   * of the sighting. One window per sighting (a second visit inside it neither extends nor stacks it). Applied multiplicatively in the same
   * arrival-rate hook as the Tourist Office (createSim `setAttractiveness`), so a stacked boost stays bounded by that product.
   */
  buzz: { mult: 1.1, days: 15 },
  /** Fade in / out (sim minutes). */
  fadeIn: 20, fadeOut: 45,
} as const;
