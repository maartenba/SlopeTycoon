import { ATMOS } from '../../config/atmosphere';
import type { SeasonId, WeatherKind } from '../../core/events';
import { clamp01, dayHash, smoothstep } from './hash';

export const isWetKind = (k: WeatherKind | undefined): boolean => k === 'rain' || k === 'snow' || k === 'heavySnow' || k === 'storm';

export interface DayContext { seed: number; dayKey: number; season: SeasonId; weather: WeatherKind; /** The previous day was wet (render-side memory; false when unknown). */ prevWet?: boolean; /** Daily mean valley temperature, deg C. */ valleyT?: number }

export interface FogDay {
  /** 0 = no fog today, otherwise 0.55..1 (how thick the bank gets at its peak). */
  strength: number;
  /** Inversion morning: deeper, higher bank; summits stay clear and bright. */
  inversion: boolean;
}

/** Pure: does today have a valley fog morning, and how strong? A function of (seed, day, weather, season) only. */
export function fogDay(c: DayContext): FogDay {
  if (c.weather === 'rain' || c.weather === 'storm' || c.weather === 'heavySnow' || c.weather === 'snow') return { strength: 0, inversion: false };
  const F = ATMOS.fog;
  let p = F.chance[c.season];
  if (c.prevWet) p += F.afterRain;
  if (c.valleyT !== undefined && c.valleyT < 3 && c.weather === 'clear') p += F.coldClear;
  if (dayHash(c.seed, c.dayKey, 11) >= p) return { strength: 0, inversion: false };
  const inversion = c.weather === 'clear' && dayHash(c.seed, c.dayKey, 12) < F.inversionShare;
  return { strength: 0.55 + 0.45 * dayHash(c.seed, c.dayKey, 13), inversion };
}

/** Pure: 0..1 factor over the hours of a fog day: builds before sunrise, holds, burns off by ~11:00. */
export function fogHourFactor(hour: number, sunrise: number): number {
  const F = ATMOS.fog;
  const build = smoothstep(sunrise - F.buildLead - 1, sunrise - 0.3, hour);
  const holdUntil = Math.max(F.holdUntil, sunrise + 0.5);
  const burn = 1 - smoothstep(holdUntil, Math.max(F.burnEnd, holdUntil + 1.5), hour);
  return build * burn;
}

export interface FogNow {
  /** 0..1 opacity driver (0 = no fog). */
  amount: number;
  /** Fog line as a share of the terrain height range (the bank's top; it sinks while it burns off). */
  lineFrac: number;
}
/** Pure: the fog right now. `level` (0..1) is the Atmosphere setting multiplier. */
export function fogAt(c: DayContext, hour: number, sunrise: number, level = 1): FogNow {
  const d = fogDay(c);
  if (d.strength === 0 || level <= 0) return { amount: 0, lineFrac: ATMOS.fog.lineFrac };
  const f = fogHourFactor(hour, sunrise);
  const base = d.inversion ? ATMOS.fog.inversionLineFrac : ATMOS.fog.lineFrac;
  return { amount: clamp01(d.strength * f * level), lineFrac: base * (0.55 + 0.45 * f) };
}
