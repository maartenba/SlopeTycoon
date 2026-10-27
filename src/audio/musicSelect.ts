import { MUSIC, TRACK_IDS, type MusicStyle, type TrackId } from './musicThemes';
import { dayPart, type MusicInput } from './musicState';

/** Pure track selection: which of the procedural tracks fits the game state, and a seeded, never-immediately-repeating choice. */

/** How well a track suits the context, 0 (never) .. 1 (ideal). Pure. */
export function trackFit(id: TrackId, c: MusicInput): number {
  if (c.menu) return id === 'title' ? 1 : 0;
  if (id === 'title') return 0;
  const shift = c.sunrise === undefined ? 0 : c.hour < 13 ? c.sunrise - 6.5 : (c.sunset ?? 18.5) - 18.5;
  const h = (((c.hour - shift) % 24) + 24) % 24, dp = dayPart(h);
  const dawn = dp === 'dawn', night = dp === 'night', dusk = dp === 'dusk';
  const morning = dawn || (dp === 'day' && h < 11), noon = dp === 'day' && h >= 11 && h < 16.5, late = dp === 'day' && h >= 16.5;
  const bad = c.weather === 'storm' || c.weather === 'heavySnow';
  const wet = c.weather === 'rain', snowy = c.weather === 'snow';
  const s = c.season, busy = c.busy ?? 0;
  if (id === 'blizzard') return bad ? 1 : snowy ? 0.1 : wet ? 0.06 : 0;
  if (bad) return 0;
  const calm = wet ? 0.8 : 1;
  let f = 0;
  switch (id) {
    case 'festival': f = c.festival ? 1 : busy > 0.7 && (dp === 'day' || dusk) ? 0.45 : 0; break;
    case 'starlight': f = night ? 1 : dusk ? 0.25 : dawn ? 0.1 : 0; break;
    case 'apres': f = dusk ? 0.95 : night ? 0.45 : late ? 0.35 : noon ? 0.08 : morning ? 0.04 : 0; break;
    case 'morningSnow': f = night ? 0 : morning ? (s === 'winter' ? 1 : 0.7) : noon ? (s === 'winter' ? 0.25 : 0.1) : late ? 0.1 : 0; break;
    case 'alpineNoon': f = night ? 0 : noon ? (s === 'winter' ? 0.8 : s === 'spring' ? 0.7 : s === 'autumn' ? 0.6 : 0.5) : late ? 0.5 : morning ? 0.25 : dusk ? 0.1 : 0; break;
    case 'summerMeadow': f = s === 'summer' ? (noon || morning ? 0.95 : late ? 0.8 : dusk ? 0.3 : 0) : s === 'spring' ? (noon || morning ? 0.8 : late ? 0.5 : 0) : s === 'autumn' ? (noon ? 0.1 : 0) : 0; break;
    case 'autumnGold': f = s === 'autumn' ? (night ? 0 : dusk ? 0.6 : 0.95) : 0; break;
    default: f = 0;
  }
  return f * calm;
}

/** Normalised-ish weights for every track (0 = excluded). */
export function trackWeights(c: MusicInput): Record<TrackId, number> {
  const w = {} as Record<TrackId, number>;
  for (const id of TRACK_IDS) w[id] = trackFit(id, c) ** 2;
  return w;
}

/**
 * Picks the next track. `style` locks one track; in auto it draws from the fit weights with the most recent tracks excluded
 * (never the same track twice in a row unless it is the only one that fits, e.g. a long storm). `rng` is the caller's seeded PRNG (deterministic).
 */
export function chooseTrack(c: MusicInput, rng: () => number, recent: readonly TrackId[], style: MusicStyle = 'auto', exclude?: TrackId): TrackId {
  if (style !== 'auto') return style;
  const w = trackWeights(c);
  const last = recent[recent.length - 1], prev = recent[recent.length - 2];
  const cands = TRACK_IDS.filter((id) => w[id] > 0.0025);
  const pool = (extra: (id: TrackId) => boolean): TrackId[] => cands.filter((id) => id !== exclude && extra(id));
  let list = pool((id) => id !== last && id !== prev);
  if (list.length === 0) list = pool((id) => id !== last);
  if (list.length === 0) list = pool(() => true);
  if (list.length === 0) list = cands.length ? [...cands] : ['alpineNoon'];
  let tot = 0; for (const id of list) tot += w[id] || 0.01;
  let r = rng() * tot;
  for (const id of list) { r -= w[id] || 0.01; if (r <= 0) return id; }
  return list[list.length - 1]!;
}

/** True when the running track no longer suits the context and may be swapped (caller also enforces `MUSIC.minPlaySec`). */
export const shouldSwap = (current: TrackId, c: MusicInput): boolean => trackFit(current, c) < MUSIC.swapBelow;
