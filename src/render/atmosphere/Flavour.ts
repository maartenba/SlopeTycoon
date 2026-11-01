import { ATMOS } from '../../config/atmosphere';
import type { WeatherKind } from '../../core/events';
import { isWetKind, type DayContext } from './FogState';
import { clamp01, dayHash, smoothstep } from './hash';

/** Pure: frost sparkle 0..1 on a cold clear morning (needs snow in the shader; only the amount lives here). */
export function frostAmount(c: DayContext, hour: number, sunrise: number): number {
  const F = ATMOS.frost;
  if (c.weather !== 'clear' || c.valleyT === undefined) return 0;
  if (dayHash(c.seed, c.dayKey, 61) >= F.chance) return 0;
  const cold = smoothstep(F.tempMax, F.tempFull, c.valleyT);
  const win = smoothstep(sunrise - 0.3, sunrise + 0.3, hour) * (1 - smoothstep(sunrise + 1.2, sunrise + F.endAfterSunrise, hour));
  return clamp01(cold * win);
}
/** Pure: water mist 0..1 at dawn (cold-ish, calm, not raining). */
export function mistAmount(c: DayContext, hour: number, sunrise: number, wind: number): number {
  const M = ATMOS.mist;
  if (isWetKind(c.weather) || c.valleyT === undefined || dayHash(c.seed, c.dayKey, 71) >= M.chance + (c.prevWet ? 0.2 : 0)) return 0;
  const cool = smoothstep(M.tempMax, M.tempMax - 10, c.valleyT);
  const win = smoothstep(sunrise - 1.2, sunrise - 0.2, hour) * (1 - smoothstep(sunrise + 1, sunrise + M.window + 1, hour));
  return clamp01(cool * win * (1 - 0.7 * clamp01(wind * 2)));
}
/** Pure: rainbow 0..1: a rare treat on the first clear spell after a wet day, sun low (morning or late afternoon). */
export function rainbowAmount(c: DayContext, hour: number, sunrise: number, sunset: number): number {
  const R = ATMOS.rainbow;
  if (!c.prevWet || c.weather === 'storm' || isWetKind(c.weather) || c.weather === 'cloudy') return 0;
  if (dayHash(c.seed, c.dayKey, 81) >= R.chance) return 0;
  const am = dayHash(c.seed, c.dayKey, 82) < 0.5;
  const at = am ? sunrise + 1.6 : sunset - 1.6;
  const d = Math.abs(hour - at);
  return clamp01(1 - smoothstep(R.windowH * 0.5, R.windowH, d));
}
export type { WeatherKind };
