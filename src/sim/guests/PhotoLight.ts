import { PHOTO } from '../../config/photographers';
import type { SeasonId, WeatherKind } from '../../core/events';
import { fogDay } from '../../render/atmosphere/FogState';
import { specialSky } from '../../render/atmosphere/SunFx';
import { smoothstep } from '../../render/atmosphere/hash';
import { sunrise, sunset } from '../Daylight';

/** Today's light for photographers: pure of (seed, dayKey, season, weather). Reads the Atmosphere layer's own day rolls (docs/photographers.md "Light"). */
export interface PhotoDay { dawn: number; dusk: number; fog: number; inversion: boolean; sunrise: number; sunset: number; weather: WeatherKind | 'clear' }
export const NO_PHOTO_DAY: PhotoDay = { dawn: 0, dusk: 0, fog: 0, inversion: false, sunrise: 8, sunset: 17, weather: 'clear' };

const blocked = (w: WeatherKind): boolean => w === 'storm' || w === 'heavySnow' || w === 'rain';

export function photoDay(seed: number, dayKey: number, dayOfYear: number, season: SeasonId, weather: WeatherKind): PhotoDay {
  const ctx = { seed, dayKey, season, weather } as const;
  const sky = specialSky(ctx), fg = fogDay(ctx);
  return { dawn: sky.dawn, dusk: sky.dusk, fog: fg.strength, inversion: fg.inversion, sunrise: sunrise(dayOfYear), sunset: sunset(dayOfYear), weather };
}

export interface PhotoLight { /** 0..1 quality of the light to shoot in right now (0 = none). */ q: number; /** Bit of the session slot (1 = morning, 2 = evening) stored in `GuestStore.eve`. */ bit: 1 | 2 }
const NONE: PhotoLight = { q: 0, bit: 1 };
const plain = (d: PhotoDay): number => (blocked(d.weather) ? 0 : d.weather === 'snow' ? PHOTO.plainLight * 0.5 : PHOTO.plainLight);

/** The light a photographer would shoot in at `hour` (the best of the evening glow, the morning glow and an inversion morning). */
export function lightAt(d: PhotoDay, hour: number): PhotoLight {
  if (blocked(d.weather)) return NONE;
  let best: PhotoLight = NONE;
  const [db, da] = PHOTO.duskShoot;
  if (hour >= d.sunset - db && hour <= d.sunset + da) { const q = d.dusk > 0 ? d.dusk : plain(d); if (q > best.q) best = { q, bit: 2 }; }
  const [rb, ra] = PHOTO.dawnShoot;
  if (hour >= d.sunrise - rb && hour <= d.sunrise + ra) { const q = d.dawn > 0 ? d.dawn : plain(d); if (q > best.q) best = { q, bit: 1 }; }
  if (d.inversion && d.fog > 0 && hour >= d.sunrise + 0.25 && hour <= PHOTO.fogUntil) { const q = 0.6 + 0.4 * d.fog; if (q > best.q) best = { q, bit: 1 }; }
  return best;
}

/** Arrival light 0..1 at `hour`: the windows before / around the glow, so photographers arrive in time for it. */
export function arrivalLight(d: PhotoDay, hour: number): number {
  if (blocked(d.weather)) return 0;
  const win = (h: number, a: number, b: number): number => smoothstep(a - 0.5, a, h) * (1 - smoothstep(b, b + 0.5, h));
  let q = 0;
  const dq = d.dusk > 0 ? d.dusk : plain(d);
  q = Math.max(q, dq * win(hour, d.sunset - PHOTO.duskLead[0], d.sunset - PHOTO.duskLead[1]));
  const rq = d.dawn > 0 ? d.dawn : plain(d);
  q = Math.max(q, rq * win(hour, d.sunrise - PHOTO.dawnWindow[0], d.sunrise + PHOTO.dawnWindow[1]));
  if (d.inversion && d.fog > 0) q = Math.max(q, (0.6 + 0.4 * d.fog) * win(hour, d.sunrise, 9));
  return q;
}
/** Arrival weight multiplier of the Photographer type from `arrivalLight`. */
export const arrivalMult = (light: number): number => PHOTO.arrivalFloor + (1 - PHOTO.arrivalFloor) * Math.min(1, 2 * light);
