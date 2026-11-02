/**
 * M7.4 sky activities (docs/m74-buildings.md). Owner decision: parachuting and hang gliding use a cheap GRASS STRIP / landing field, NOT the Altiport.
 * Skydive: Grass Strip (airfield, 1 per resort) + Skydive Centre (sells the jumps). Gliding: Launch Ramp (high ground) + a Landing Field (valley) within `radius` tiles and `minDrop` below.
 * Everything flies in daylight and clear weather only; nothing here can hurt a guest.
 */
export const SKY = {
  /** Daylight window (hours) in which jumps and flights run. */
  fromHour: 9, toHour: 17,
  /** Closed when the day's fog is at least this, or the wind above `maxWind` (storm days have wind 1), or it rains / snows. */
  maxFog: 0.5, maxWind: 0.3,
} as const;

export const GLIDE = {
  /** A launch ramp needs a landing field within this many tiles (centre to centre) ... */
  radius: 45,
  /** ... whose ground is at least this much lower (world units; a glider has to go somewhere downhill). */
  minDrop: 3,
} as const;

/** The view draws at most this many aircraft: planes (1 per open centre, max 2), canopies (6 per plane), gliders. */
export const SKY_VIEW = { planes: 2, canopiesPerPlane: 6, gliders: 6 } as const;
