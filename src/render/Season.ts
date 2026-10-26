/** Seasonal helpers shared by trees, terrain and the debug panel. Year position t in [0,1): spring .125, summer .375, autumn .625, winter .875 (centres). */
export interface SeasonWeights { spring: number; summer: number; autumn: number; winter: number }

export const SEASON_CENTERS = { spring: 0.125, summer: 0.375, autumn: 0.625, winter: 0.875 } as const;

/** Triangular crossfade; weights always sum to 1. */
export function seasonWeights(t: number): SeasonWeights {
  const f = ((t % 1) + 1) % 1;
  const w = (c: number): number => {
    let d = Math.abs(f - c);
    d = Math.min(d, 1 - d);
    return Math.max(0, 1 - d / 0.25);
  };
  return { spring: w(0.125), summer: w(0.375), autumn: w(0.625), winter: w(0.875) };
}

export interface SeasonTerrain { autumn: number; springBloom: number; snowline: number }

/** Terrain parameters for a year position. snowline: summer above the peaks (maxWorld+1), winter low. */
export function seasonTerrain(t: number, maxWorld: number): SeasonTerrain {
  const s = seasonWeights(t);
  const cold = Math.min(1, s.winter + 0.4 * s.autumn + 0.4 * s.spring);
  const hi = maxWorld + 1, lo = Math.max(1, maxWorld * 0.3);
  return {
    autumn: Math.min(1, s.autumn + 0.6 * s.winter),
    springBloom: s.spring,
    snowline: hi - (hi - lo) * cold,
  };
}

/** Terrain parameters driven by the SIM: weights from the year position, snowline (world y) from sim/Weather (altitude-dependent). */
export function seasonTerrainSim(t: number, simSnowline: number): SeasonTerrain {
  const s = seasonWeights(t);
  return { autumn: Math.min(1, s.autumn + 0.6 * s.winter), springBloom: s.spring, snowline: simSnowline };
}

export const SEASON_NAMES = ['spring', 'summer', 'autumn', 'winter'] as const;
export type SeasonName = (typeof SEASON_NAMES)[number];

/** Season whose quarter of the year contains t (spring starts at 0). */
export function seasonName(t: number): SeasonName {
  const f = ((t % 1) + 1) % 1;
  return SEASON_NAMES[Math.min(3, Math.floor(f * 4))]!;
}

/** Advance the year position by dt seconds at `yearsPerMinute`; wraps to [0,1). */
export function advanceYear(t: number, dtSec: number, yearsPerMinute: number): number {
  const n = t + (dtSec * yearsPerMinute) / 60;
  return ((n % 1) + 1) % 1;
}

/** 0..1 water freeze from the seasonal snowline (same mapping as seasonTerrain: cold = how far the snowline dropped). */
export function freezeFromSnowline(snowline: number, maxWorld: number): number {
  const hi = maxWorld + 1, lo = Math.max(1, maxWorld * 0.3);
  const cold = hi > lo ? (hi - snowline) / (hi - lo) : 0;
  return Math.min(1, Math.max(0, (cold - 0.6) / 0.35));
}
