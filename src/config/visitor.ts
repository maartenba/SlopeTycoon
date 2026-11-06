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
  attempts: 700, wanderR: 4, steps: 6, stepMin: 2, stepMax: 4, leadIn: 8, printGap: 1.1,
  /** 'Show me' camera offset ring (tiles) from where the visitor was first seen. */
  showMe: { min: 6, max: 12 },
  /** Guests within this many tiles of the visitor react once (most: a small mood bump, some: a brief fright; nobody is hurt). */
  reactR: 14, cheer: 0.05, fright: 0.06,
  /** Fade in / out (sim minutes). */
  fadeIn: 20, fadeOut: 45,
} as const;
