import { ATMOS } from '../../config/atmosphere';
import { LightingParams } from '../Lighting';
import type { DayContext } from './FogState';
import { isWetKind } from './FogState';
import { clamp01, dayHash, smoothstep } from './hash';

export interface SpecialSky { dawn: number; dusk: number }

/** Pure: how special are today's sunrise / sunset? 0 = plain (most days), 0.6..1 = a beautiful one. Hash of (seed, day) + weather only. */
export function specialSky(c: DayContext): SpecialSky {
  const S = ATMOS.special;
  if (c.weather === 'storm' || c.weather === 'heavySnow' || c.weather === 'rain') return { dawn: 0, dusk: 0 };
  const mod = (c.weather === 'cloudy' ? S.cloudy : 0) + (c.prevWet ? S.afterRain : 0);
  const mult = c.weather === 'clear' ? S.clear : 1;
  const one = (base: number, salt: number): number => {
    const p = (base + mod) * mult;
    return dayHash(c.seed, c.dayKey, salt) < p ? S.minQuality + (1 - S.minQuality) * dayHash(c.seed, c.dayKey, salt + 1) : 0;
  };
  return { dawn: one(S.dawn[c.season], 21), dusk: one(S.dusk[c.season], 31) };
}

/** Pure: 0..1 glow weight at `hour` (the side of the day is chosen by the nearer horizon crossing), scaled by the special quality. */
export function glowWeight(hour: number, sunrise: number, sunset: number, sky: SpecialSky): number {
  const w = (dt: number, q: number): number => (q <= 0 ? 0 : q * (1 - smoothstep(ATMOS.alpenglow.fullH, ATMOS.alpenglow.windowH, Math.abs(dt))));
  return Math.max(w(hour - sunrise, sky.dawn), w(hour - sunset, sky.dusk));
}
/** Pure: the alpenglow weight on summit snow (same window as the glow; its own name so tests pin the +-40 min rule). */
export const alpenglowWeight = glowWeight;

type V3 = [number, number, number];
const mix = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** Pure: the lighting params with the sky / sun graded toward the glow colours. weight 0 returns the input object unchanged. */
export function gradeLighting(p: LightingParams, weight: number): LightingParams {
  const t = clamp01(weight) * ATMOS.special.gradeStrength;
  if (t <= 0) return p;
  const S = ATMOS.special;
  return {
    ...p,
    background: mix(p.background, S.glowSky, t),
    sunColor: mix(p.sunColor, S.glowSun, t * 0.7),
    shaderSun: mix(p.shaderSun, [S.glowSun[0] * 0.95, S.glowSun[1] * 0.62, S.glowSun[2] * 0.4], t * 0.7),
    shaderSky: mix(p.shaderSky, [0.62, 0.52, 0.6], t * 0.5),
  };
}
export { isWetKind };
