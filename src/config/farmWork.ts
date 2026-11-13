/**
 * Summer farm vehicles (docs/farm-work.md): tractors that work the pastures around every Alpine Farm in summer. Render-only atmosphere: no sim state, nothing saved,
 * same seed + same day + same farm = the same trips (stable hash, never the sim Rng). Every number lives here.
 */
export const FARM_WORK = {
  /** Tractors per farm by graphics quality; Atmosphere Off = none, Atmosphere Low = at most 1. */
  perFarm: { low: 1, med: 2, high: 2 } as const,
  /** Farms that show tractors at once (the ones nearest to the camera target). */
  maxFarms: 6,
  /** Real-calendar summer is Jun-Sep (month indexes 5..8). The first / last `edgeDays` days of that window park the tractors (visible, no trips): they fade in / out by sitting in the farm. */
  summerMonths: [5, 8] as const, edgeDays: 2,
  /** Game-hour schedule. A tractor may leave in [depart[0], lunch[0]) or [lunch[1], lastDepart); it must be home at `home` (and from `earliest` on). Rain, storm and snow park it. */
  hours: { earliest: 7.5, lunch: [12, 13.5] as const, lastDepart: 13.8, home: 17.5, stagger: 1.4 },
  /** Trip pace in GAME time (docs/farm-work.md "Pace"): a trip lasts about `tripHours` game hours whatever the game speed (1x: a game hour = 6.25 s); the drive speed is scaled by the plan's natural
   * duration (`paceRate`, clamped to [1, maxRate] = at most ~1.3 tiles/s at 1x) and by the softened speed multiplier (`paceSpeed`). At 10x / fast-forward tractors stay parked. */
  pace: { tripHours: 3.4, secPerHour: 150 / 24, maxRate: 1.9, /** At 3x the tractor speeds up only by this share of the extra speed (1 + (speed - 1) * share): a calm ~2 tiles/s at most, never frantic. */ speedShare: 0.35 },
  /** Speeds (tiles per second, real time) and the in-place turn at the gate / the unload stop (seconds). */
  speed: { drive: 0.7, mow: 0.55, turn: 0.45 },
  turnSec: 1.2, patchStop: 1.2, unloadSec: 3.5,
  /** Pause at home between two trips (seconds, + a stable 0..jitter). */
  rest: 5, jitter: 6,
  /** Work spot: patch length / row spacing / margin (tiles), distance band from the farm gate, tries. */
  patch: { length: 3.6, rowGap: 0.72, rowWidth: 0.62, margin: 0.7, minDist: 4, maxDist: 13, nearDist: 8, tries: 16, maxPath: 36, avoid: 3, /** Patches stay within this many grid height units of the farm gate (no snowy high ground). */ maxClimb: 12 },
  /** Hay bales dropped behind the trailer on the second pass (round bales: radius / width in tiles). */
  bales: { perPatch: 3, radius: 0.09, width: 0.2, popSec: 0.45, /** Square bales dropped beside the round ones, and stacked on every other trailer (a pyramid of up to `stack`): length (along z), width, height in tiles. */ square: { perPatch: 2, len: 0.2, wid: 0.15, hgt: 0.09, stack: 6, cap: 90 } },
  /** Hay load on the trailer: fraction of the full heap reached after the second pass. */
  load: { max: 0.92, length: 0.56, width: 0.27, height: 0.17 },
  /** A finished patch stays `hold` seconds, then fades over `fade` seconds (real time). */
  patchHold: 50, patchFade: 40,
  /** Instance caps. */
  caps: { tractors: 12, patches: 18, stripes: 220 },
  /** Exhaust: puffs per tractor in the pool, seconds between puffs, life; Medium / High only. */
  exhaust: { pool: 9, every: 0.45, life: 2.5 },
  /** Show only when the camera is this close: full at <= near, gone at >= far (tiles tall, lodHeightFor). */
  view: { near: 60, far: 110 },
  /** Engine bed (audio layer `tractor`): only near a working tractor, zoomed in; reach in tiles. */
  audioReach: 16,
} as const;
