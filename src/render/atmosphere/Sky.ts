import { ATMOS } from '../../config/atmosphere';
import type { WeatherKind } from '../../core/events';
import { clamp01, dayHash, smoothstep } from './hash';

/** Pure: moon phase 0..1 (0 = new, 0.5 = full) from the absolute sim day (29.53-day cycle). */
export function moonPhase(simDay: number): number {
  const p = ((simDay - ATMOS.moon.newMoonDay) / ATMOS.moon.synodic) % 1;
  return p < 0 ? p + 1 : p;
}
/** Pure: lit fraction 0..1 of the disc. */
export const moonIllumination = (phase: number): number => (1 - Math.cos(phase * Math.PI * 2)) / 2;
export const moonPhaseName = (phase: number): string => {
  const i = Math.round(phase * 8) % 8;
  return ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'][i]!;
};
/** Pure: star visibility 0..1 from the night factor (1 - day) and cloud cover. */
export function starAlpha(night: number, weather: WeatherKind): number {
  const cover = weather === 'clear' ? 0 : weather === 'cloudy' ? 0.7 : 1;
  return smoothstep(0.55, 0.95, night) * (1 - cover);
}
/** Pure: cloud-shadow strength 0..1 for a day (some fair days show more cumulus). Shadows need light, so they fade with the night. */
export function cloudShadowAmount(seed: number, dayKey: number, weather: WeatherKind, night: number): number {
  const C = ATMOS.clouds;
  const base = weather === 'cloudy' ? C.cloudy : weather === 'clear' ? C.clear * (dayHash(seed, dayKey, 41) < C.fairChance ? 2.2 : 0.6) : C.wet;
  return clamp01(base * (1 - smoothstep(0.2, 0.7, night)));
}
/** Pure: cloud drift speed (tiles / s) from the wind 0..1. */
export const cloudDrift = (wind: number): number => ATMOS.clouds.driftSlow + (ATMOS.clouds.driftFast - ATMOS.clouds.driftSlow) * clamp01(wind);
/** Deterministic star field (x, y in 0..1, size 0..1) for a seed. */
export function starField(n: number, seed = 1): { x: number; y: number; s: number }[] {
  const out: { x: number; y: number; s: number }[] = [];
  for (let i = 0; i < n; i++) out.push({ x: dayHash(seed, i, 51), y: dayHash(seed, i, 52), s: dayHash(seed, i, 53) });
  return out;
}
