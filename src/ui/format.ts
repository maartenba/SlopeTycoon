import type { GameDate } from '@/core/GameState';

export function formatMoney(n: number): string {
  const r = Math.round(n);
  return (r < 0 ? '-$' : '$') + Math.abs(r).toLocaleString('en-US');
}
export function formatDate(d: GameDate): string {
  return `Year ${d.year}, Day ${d.day + 1}`;
}
export function nextFps(frames: number, ms: number): number {
  return ms > 0 ? (frames * 1000) / ms : 0;
}

export function parseSeed(s: string): number {
  const t = s.trim();
  if (t === '') return Math.floor(Math.random() * 1_000_000);
  const n = Number(t);
  if (Number.isFinite(n)) return Math.trunc(n);
  let h = 0; // hash text seeds
  for (let i = 0; i < t.length; i++) h = (Math.imul(h, 31) + t.charCodeAt(i)) | 0;
  return Math.abs(h);
}


/** 'Y1 · Day 12 · 14:30' (day is 1-based in the label). */
export function formatClock(d: GameDate): string {
  const h = Math.floor(d.minute / 60), m = d.minute % 60;
  return `Y${d.year} · Day ${d.day + 1} · ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export type WeatherKindName = 'clear' | 'cloudy' | 'snow' | 'heavySnow' | 'rain' | 'storm';
const WEATHER_ICONS: Record<WeatherKindName, string> = { clear: '☀', cloudy: '☁', snow: '🌨', heavySnow: '❄', rain: '🌧', storm: '⛈' };
export const weatherIcon = (k: WeatherKindName): string => WEATHER_ICONS[k];

export interface WeatherHudInfo { season: string; kind: WeatherKindName; tempC: number; snowlineM: number; summerDiscount: boolean; /** Season progress text, see formatSeasonProgress. */ progress?: string; /** Sunrise/sunset tooltip text, e.g. 'Sunrise 07:45 · sunset 16:45 (9.0 h of daylight)'. */ daylight?: string }
/** HUD text: '❄ Winter  -4°C  ⛰ snow above 1,150 m'. */
export function formatWeatherLine(i: WeatherHudInfo): string {
  return `${weatherIcon(i.kind)} ${i.season}  ${Math.round(i.tempC)}°C  snowline ${Math.round(i.snowlineM).toLocaleString('en-US')} m`;
}

/** 'Winter · day 23/90 · next: Spring in 67 days'. */
export function formatSeasonProgress(p: { season: string; day: number; length: number; next: string; daysLeft: number }): string {
  return `${p.season} · day ${p.day}/${p.length} · next: ${p.next} in ${p.daysLeft} day${p.daysLeft === 1 ? '' : 's'}`;
}
