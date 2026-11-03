/**
 * Schirmbar (M7.8, docs/schirmbar.md): a domed umbrella bar on the slopes. Every number lives here; the sim, the render and the docs read it.
 * Winter only, opens in good weather, a quick drink for skiers passing mid-descent (like the Coffee Stand, `SNACK` in guests/Decision.ts).
 */
export const SCHIRMBAR = {
  /** Serving hours [from, to): a daytime slope bar (its music plays only while it serves). */
  hours: [10, 17.5] as readonly [number, number],
  /** Closed when the day's wind is above this (calm days draw 0..0.35, a storm is 1) or the fog at least `maxFog`. */
  maxWind: 0.3, maxFog: 0.5,
  /** Mid-descent stop: a skier within `passRadius` tiles of an open bar's centre (about 2 tiles from its walls), with a budget of at least `minBudget`, takes it on 1 pass in `oneIn` (stateless hash of guest id and runs: no RNG, nothing stored). */
  passRadius: 3, oneIn: 4, minBudget: 8,
  /** Places at the bar, ticks a drink takes, guests per day (the bar runs out of glasses: a hard daily cap, then "turned away"). */
  slots: 8, serviceTicks: 3, dailyCap: 90,
  /** What a drink does: mood up, hunger down a little (a snack with it), tiredness down (a rest in the warm). */
  happiness: 0.08, hungerBy: 0.08, fatigue: -0.12,
  /** Longest resort name (characters). */
  nameMax: 24,
} as const;

/** Why the Schirmbar is shut: the strings the inspector shows. */
export const SCHIRMBAR_REASON = {
  season: 'Closed for the season (winter only)',
  player: 'Closed by you',
  storm: 'Closed: storm', heavySnow: 'Closed: heavy snow', rain: 'Closed: rain', wind: 'Closed: high wind', fog: 'Closed: fog',
} as const;
