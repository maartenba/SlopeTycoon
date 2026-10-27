import type { SeasonId, WeatherKind } from '../core/events';
import { DAY, DUSK, HOURS, LAYERS, MUSIC, NIGHT, THEMES, WEATHER_LAYERS, type Layer, type Theme, type TrackId } from './musicThemes';

export interface MusicInput { season: SeasonId; weather: WeatherKind; /** Fractional hour 0..24. */ hour: number; /** Today's sunrise/sunset (default 6.5/18.5): the day-part hours shift with them. */ sunrise?: number; sunset?: number; speed: number; /** Crisis tension 0..1. */ tension: number; /** Resort busy-ness 0..1 (guest count); lets light percussion in. */ busy?: number; /** A festival is on. */ festival?: boolean; /** The main menu / title context. */ menu?: boolean }
export interface MusicParams { /** Combined time-of-day * game-speed tempo factor. */ tempoMul: number; /** Per-layer weight 0..1; an event plays when its rank < weight. */ layers: Record<Layer, number>; tension: number }
export type DayPart = 'night' | 'dawn' | 'day' | 'dusk';

export function dayPart(hour: number): DayPart {
  const h = ((hour % 24) + 24) % 24;
  if (h < HOURS.dawnStart || h >= HOURS.nightStart) return 'night';
  if (h < HOURS.dawnEnd) return 'dawn';
  return h >= HOURS.duskStart ? 'dusk' : 'day';
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
function timeFactors(hour: number): { tempo: number; layers: Record<Layer, number> } {
  const part = dayPart(hour);
  if (part === 'night') return NIGHT;
  if (part === 'day') return DAY;
  if (part === 'dusk') return DUSK;
  const t = (hour - HOURS.dawnStart) / (HOURS.dawnEnd - HOURS.dawnStart); // gentle build: night -> day over the dawn hours
  const layers = {} as Record<Layer, number>;
  for (const l of LAYERS) layers[l] = lerp(NIGHT.layers[l], DAY.layers[l], t);
  return { tempo: lerp(NIGHT.tempo, DAY.tempo, t), layers };
}

/** Unsmoothed target parameters for a game state. Pure. */
export function targetParams(i: MusicInput, th: Theme = THEMES.alpineNoon): MusicParams {
  const shift = i.sunrise === undefined ? 0 : i.hour < 13 ? i.sunrise - 6.5 : (i.sunset ?? 18.5) - 18.5;
  const tf = timeFactors(i.hour - shift), w = WEATHER_LAYERS[i.weather], t = Math.max(0, Math.min(1, i.tension));
  const layers = {} as Record<Layer, number>;
  for (const l of LAYERS) layers[l] = tf.layers[l] * w[l] * th.bias[l];
  // Percussion is a detail: only when the resort is busy (or the track is a jazzy / lively one with a baseline).
  layers.perc *= Math.max(th.percBase, Math.min(1, Math.max(0, i.busy ?? 0) * 1.2));
  layers.melody *= 1 - 0.5 * t; layers.perc *= 1 - t; layers.arp *= 1 - 0.3 * t;
  return { tempoMul: tf.tempo * (MUSIC.speedMul[Math.max(0, Math.min(3, Math.round(i.speed)))] ?? 1), layers, tension: t };
}

/** Exponential smoothing of `prev` toward `target` over `dt` seconds (time constant `tc`). Season switches immediately (crossfade handled by the scheduler). */
export function smoothParams(prev: MusicParams | null, target: MusicParams, dt: number, tc = 3): MusicParams {
  if (!prev) return { ...target, layers: { ...target.layers } };
  const k = 1 - Math.exp(-Math.max(0, dt) / tc);
  const layers = {} as Record<Layer, number>;
  for (const l of LAYERS) layers[l] = lerp(prev.layers[l], target.layers[l], k);
  return { tempoMul: lerp(prev.tempoMul, target.tempoMul, k), layers, tension: lerp(prev.tension, target.tension, k) };
}

export const bpmFor = (track: TrackId, tempoMul: number): number => THEMES[track].bpm * tempoMul;
