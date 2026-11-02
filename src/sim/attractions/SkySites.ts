import { SKY, GLIDE } from '../../config/sky';
import type { DayWeather } from '../Weather';

interface Site { type: string; x: number; y: number; w: number; h: number; active: boolean }

/** Weather verdict shared by every sky activity: rain / snow / storm, thick fog or a strong wind close it. Undefined = fine. */
export function skyWeatherReason(w: Pick<DayWeather, 'kind' | 'fog' | 'wind'>): string | undefined {
  if (w.kind === 'rain' || w.kind === 'storm' || w.kind === 'snow' || w.kind === 'heavySnow') return 'Closed: the weather is not clear enough to fly';
  if (w.fog >= SKY.maxFog) return 'Closed: fog';
  if (w.wind > SKY.maxWind) return 'Closed: too windy to fly';
  return undefined;
}

const cx = (b: Site): number => b.x + b.w / 2, cy = (b: Site): number => b.y + b.h / 2;

/** The active Landing Field a launch ramp flies to: within `GLIDE.radius` tiles and at least `GLIDE.minDrop` lower (nearest first). Null = none. */
export function landingFor(ramp: Site, sites: Iterable<Site>, ground: (x: number, y: number) => number): Site | null {
  let best: Site | null = null, bd = Infinity;
  const hz = ground(cx(ramp), cy(ramp));
  for (const s of sites) {
    if (s.type !== 'landingField' || !s.active) continue;
    const d = Math.hypot(cx(s) - cx(ramp), cy(s) - cy(ramp));
    if (d > GLIDE.radius || hz - ground(cx(s), cy(s)) < GLIDE.minDrop) continue;
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

/** Why a sky activity cannot run now, from the page's data (pure: weather, the buildings and the ground height). */
export function skyClosedReason(kind: 'skydive' | 'glide', b: Site, weather: Pick<DayWeather, 'kind' | 'fog' | 'wind'>, sites: Iterable<Site>, ground: (x: number, y: number) => number): string | undefined {
  const list = [...sites];
  if (kind === 'skydive' && !list.some((s) => s.type === 'grassStrip' && s.active)) return 'Closed: no grass strip for the plane';
  if (kind === 'glide' && !landingFor(b, list, ground)) return `Closed: no Landing Field within ${GLIDE.radius} tiles and lower down`;
  return skyWeatherReason(weather);
}
