import type { SeasonId, WeatherKind } from '../core/events';
import { BAR_PLAYLIST, FALLBACK, MENU_PLAYLIST, MUSIC, PLAYLISTS, SITUATION, TRACK_BY_ID, type SituationId } from '../config/audioMusic';

/** Pure selection logic of the in-game music (docs/audio.md "Music"): situation from the game state, playlist rotation, hysteresis, fade envelopes, loudness trim. No audio, no DOM. */

export interface MusicInput {
  season: SeasonId; weather: WeatherKind;
  /** Fractional hour 0..24. */
  hour: number;
  /** Today's sunrise / sunset (default 6.5 / 18.5): the day-part hours shift with them. */
  sunrise?: number; sunset?: number;
  /** Game speed (0 = paused). */
  speed: number;
  /** Resort busy-ness 0..1 (guests / 300). */
  busy?: number;
  /** A festival is on. */
  festival?: boolean;
}
export type DayPart = 'night' | 'dawn' | 'day' | 'dusk';

export function dayPart(hour: number): DayPart {
  const H = SITUATION.hours, h = ((hour % 24) + 24) % 24;
  if (h < H.dawnStart || h >= H.nightStart) return 'night';
  if (h < H.dawnEnd) return 'dawn';
  return h >= H.duskStart ? 'dusk' : 'day';
}

/** Hour shifted so that today's sunrise / sunset line up with the default 6.5 / 18.5 day-part table. */
export function shiftedHour(c: Pick<MusicInput, 'hour' | 'sunrise' | 'sunset'>): number {
  const shift = c.sunrise === undefined ? 0 : c.hour < 13 ? c.sunrise - 6.5 : (c.sunset ?? 18.5) - 18.5;
  return (((c.hour - shift) % 24) + 24) % 24;
}

/** Busy flag with hysteresis: pass the previous flag. */
export function busyFlag(busy: number | undefined, prev: boolean): boolean {
  const b = busy ?? 0;
  return prev ? b >= SITUATION.busyOff : b >= SITUATION.busyOn;
}

/** The situation for a game state. Pure; `busy` is the (hysteresis-filtered) busy flag. Every input maps to exactly one situation. */
export function situationFor(c: MusicInput, busy: boolean): SituationId {
  const h = shiftedHour(c), dp = dayPart(h);
  if (c.weather === 'storm' || c.weather === 'heavySnow') return 'storm';
  if (dp === 'night') return 'night';
  if (c.festival) return 'festival';
  if (c.weather === 'snow' && (dp === 'dawn' || dp === 'day')) return 'snow';
  if (c.season === 'autumn') return 'autumn';
  if (dp === 'dusk') return 'dusk';
  if (c.season === 'winter') return dp === 'day' && h >= SITUATION.lateMorning && busy ? 'winter-day' : 'winter-morning';
  return 'summer'; // spring and summer days
}

/** Candidate list for the next track: the situation's playlist without `last`; when that is empty (a one-track playlist), the fallback situation's playlist. Never empty, never `last` (unless nothing else exists). */
export function candidates(sit: SituationId, last: string | null): string[] {
  const own = PLAYLISTS[sit].filter((id) => id !== last);
  if (own.length) return [...own];
  const fb = PLAYLISTS[FALLBACK[sit]].filter((id) => id !== last);
  return fb.length ? [...fb] : [...PLAYLISTS[sit]];
}

/** Next track id: uniform among the candidates, preferring ones not played in the last two picks (`recent`, oldest first); `exclude` also excluded when possible. `rand` in [0,1). */
export function pickNext(sit: SituationId, recent: readonly string[], rand: () => number, exclude: readonly string[] = []): string {
  const last = recent[recent.length - 1] ?? null, prev = recent[recent.length - 2];
  let list = candidates(sit, last);
  const narrow = (f: (id: string) => boolean): void => { const n = list.filter(f); if (n.length) list = n; };
  narrow((id) => !exclude.includes(id)); narrow((id) => id !== prev);
  return list[Math.min(list.length - 1, Math.floor(rand() * list.length))]!;
}

/** Rotating playlist (menu, bar): next index, never the previous one when there are two or more; `prev < 0` = the first start (index 0 unless `randomStart`). */
export function nextInPlaylist(playlist: readonly string[], last: string | null, rand: () => number, failed: readonly string[] = []): string {
  const ok = (id: string): boolean => !failed.includes(id);
  let list = playlist.filter((id) => id !== last && ok(id));
  if (!list.length) list = playlist.filter((id) => id !== last);
  if (!list.length) list = [...playlist];
  return list[Math.min(list.length - 1, Math.floor(rand() * list.length))]!;
}
export const menuFirst = (): string => MENU_PLAYLIST[0]!;
export const barPlaylist = (): readonly string[] => BAR_PLAYLIST;

/** Situation tracker with hysteresis: a new raw situation must hold `settleSec` before it is committed; `busy` has its own on / off thresholds. */
export class SituationTracker {
  committed: SituationId | null = null;
  /** Time of the last commit (s on the caller's clock). */
  changedAt = -Infinity;
  raw: SituationId | null = null;
  private rawSince = 0;
  private busy = false;
  constructor(private settle: number = SITUATION.settleSec) {}
  /** Returns true when the committed situation changed (the first call commits at once). */
  update(c: MusicInput, now: number): boolean {
    this.busy = busyFlag(c.busy, this.busy);
    const r = situationFor(c, this.busy);
    if (this.committed === null) { this.committed = this.raw = r; this.rawSince = now; this.changedAt = now; return true; }
    if (r !== this.raw) { this.raw = r; this.rawSince = now; }
    if (r !== this.committed && now - this.rawSince >= this.settle) { this.committed = r; this.changedAt = now; return true; }
    return false;
  }
}

/** True for situations that cut in with a crossfade instead of waiting for the track to end. */
export const isUrgent = (s: SituationId): boolean => (SITUATION.urgent as readonly SituationId[]).includes(s);

/** True once a track has really played `MUSIC.minPlaySec` seconds (media time): until then no situation change may replace it. "Next track" and the track's own end ignore this. */
export const playedLongEnough = (positionSec: number): boolean => positionSec >= MUSIC.minPlaySec;
/**
 * Pure: may a situation-driven crossfade (storm / night / festival cut-in) replace the playing track now? The situation must differ from the playing track's, be urgent,
 * the last cut-in must be `SITUATION.minChangeGapSec` ago and the track must have played `MUSIC.minPlaySec`. A change that is refused now stays pending (the committed situation still differs) and applies later.
 */
export function mayCutIn(o: { situation: SituationId; playingSituation: SituationId | null; now: number; lastChangeAt: number; positionSec: number }): boolean {
  return o.playingSituation !== o.situation && isUrgent(o.situation) && o.now - o.lastChangeAt >= SITUATION.minChangeGapSec && playedLongEnough(o.positionSec);
}

/** Equal-power fade gain at progress p (0..1): `in` rises 0 -> 1, `out` falls 1 -> 0; in^2 + out^2 = 1 for a click-free crossfade. */
export function fadeIn(p: number): number { return Math.sin(Math.min(1, Math.max(0, p)) * Math.PI / 2); }
export function fadeOut(p: number): number { return Math.cos(Math.min(1, Math.max(0, p)) * Math.PI / 2); }

/** Gain trim that moves a track measured at `lufs` to `target` LUFS. */
export function trimFor(lufs: number, target: number): number { return 10 ** ((target - lufs) / 20); }

/** Seconds into the playing track at which the next one must start so the crossfade ends exactly at the track end. */
export function nextStartAt(duration: number, crossfade: number): number { return Math.max(0, duration - Math.min(crossfade, duration / 2)); }

export const trackTitle = (id: string | null): string => (id ? TRACK_BY_ID.get(id)?.title ?? '' : '');
