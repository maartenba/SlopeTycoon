/**
 * Atmosphere (M7.0): the data table behind valley fog, special sunrises / sunsets, alpenglow, moon, frost, mist and rainbows.
 * RENDER ONLY: every value here is read by `src/render/atmosphere/*` and never by the simulation (no Rng draw, no stateHash change).
 * Everything is a deterministic hash of (seed, dayKey) so a day looks the same on every visit. See docs/atmosphere.md.
 */
import type { SeasonId } from '../core/events';

export const ATMOS_LEVELS = ['off', 'low', 'high'] as const;
export type AtmosLevel = (typeof ATMOS_LEVELS)[number];

/** What each level switches on. `off` = exactly the pre-M7.0 look (every uniform at its neutral value, no sky overlay). */
export interface LevelFeatures {
  /** 0..1 multiplier on the valley fog amount (0 = no fog). */
  fog: number; grade: boolean; alpenglow: boolean; stars: boolean; moon: boolean; cloudShadows: boolean;
  /** Frost twinkle, water mist, rainbow: the "flavour" layer (High only). */
  frost: boolean; mist: boolean; rainbow: boolean;
}
export const LEVEL_FEATURES: Record<AtmosLevel, LevelFeatures> = {
  off: { fog: 0, grade: false, alpenglow: false, stars: false, moon: false, cloudShadows: false, frost: false, mist: false, rainbow: false },
  low: { fog: 0.75, grade: true, alpenglow: true, stars: true, moon: true, cloudShadows: true, frost: false, mist: false, rainbow: false },
  high: { fog: 1, grade: true, alpenglow: true, stars: true, moon: true, cloudShadows: true, frost: true, mist: true, rainbow: true },
};

export const ATMOS = {
  /** "Special sky" days: the share of days with a beautiful sunrise / sunset (all others stay plain). */
  special: {
    /** Base chance by season for dawn / dusk (about 1 in 4 to 1 in 3 overall). */
    dawn: { winter: 0.3, spring: 0.32, summer: 0.28, autumn: 0.34 } as Record<SeasonId, number>,
    dusk: { winter: 0.28, spring: 0.3, summer: 0.28, autumn: 0.32 } as Record<SeasonId, number>,
    /** Added when the previous day was wet (clearing skies colour up). */
    afterRain: 0.16,
    /** Added for broken cloud (a 'cloudy' day) because clouds catch the colour. */
    cloudy: 0.1,
    /** Chance multiplier on clear days (a cloudless sky is plainer). */
    clear: 0.9,
    /** Special quality is 0.6..1 (never a weak "special"). */
    minQuality: 0.6,
    /** Grade strength: how far the sky / sun colours move toward the glow (subtle on purpose). */
    gradeStrength: 0.4,
    glowSky: [0.98, 0.56, 0.5] as [number, number, number],
    glowSun: [1.0, 0.5, 0.34] as [number, number, number],
  },
  /** Alpenglow on summit snow: window around the horizon crossing, in hours (40 minutes). */
  alpenglow: { windowH: 40 / 60, fullH: 20 / 60, colour: [1.0, 0.52, 0.5] as [number, number, number], strength: 0.55, /** share of the world height range above which snow catches it */ heightFrac: 0.58 },
  /** Valley fog / inversion mornings. */
  fog: {
    /** Chance of a fog morning by season (autumn mornings are the classic). */
    chance: { winter: 0.22, spring: 0.2, summer: 0.08, autumn: 0.34 } as Record<SeasonId, number>,
    afterRain: 0.2, coldClear: 0.18,
    /** The fog line (share of the height range) of a normal fog day and an inversion day (summits clear, deep bank). */
    lineFrac: 0.3, inversionLineFrac: 0.42, inversionShare: 0.8,
    /** Fog builds from sunrise - buildLead h to full at sunrise, holds until holdUntil, burns off by burnEnd (about 11:00). */
    buildLead: 1.5, holdUntil: 8.5, burnEnd: 11,
    /** Soft edge (world units) of the band and its maximum opacity. */
    soft: 5, maxOpacity: 0.7,
  },
  /** Moon: synodic month in sim days. */
  moon: { synodic: 29.53, newMoonDay: 3 },
  /** Cloud shadows: strength by weather (0..1) and drift speed (tiles / s at wind 0 and 1). */
  clouds: { clear: 0.08, cloudy: 0.26, wet: 0.16, driftSlow: 0.25, driftFast: 1.4, fairChance: 0.4 },
  /** Frost sparkle: cold clear mornings. */
  frost: { tempMax: 3, tempFull: -5, chance: 0.75, endAfterSunrise: 3.2 },
  /** Water mist at dawn over lakes and rivers (a capped puff layer). */
  mist: { tempMax: 9, chance: 0.5, maxPuffs: 48, window: 2.5 },
  /** Rainbow: the first clear spell after a wet day, sun low. */
  rainbow: { chance: 0.28, windowH: 2.6 },
} as const;
