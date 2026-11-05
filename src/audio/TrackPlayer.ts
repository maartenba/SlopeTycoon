import { TRACK_BY_ID, type TrackDef } from '../config/audioMusic';
import type { AudioEngine } from './AudioEngine';
import type { GainLike, MediaLike, NodeLike, ParamLike } from './backend';
import { fadeIn, fadeOut } from './musicPlaylist';

/**
 * Plays the music mp3 files: one <audio> element per track, routed through the engine's Web Audio graph (MediaElementAudioSourceNode -> track gain -> `dest`),
 * so the Music slider, Master, mute, ambience-only and the tab-hidden suspend all apply. The bytes are fetched with a plain GET (a 200 the service worker can
 * runtime-cache; an <audio src=url> would send 206 range requests that cannot be cached) and played from a blob URL, so no file is ever decoded to PCM in memory.
 * Fades are equal-power ramps on the track gain (backend clock). Elements are paused (position kept) while the engine is not running (hidden tab, blocked) or
 * while `hold` is set, and continue exactly where they were. A track that fails to load resolves null (one console warning per player), never throws.
 */
export interface PlayerDeps {
  engine: AudioEngine;
  /** Where the track gains connect (resolved lazily: the bus only exists once the engine runs). */
  dest: () => NodeLike | null;
  /** Bytes -> a URL an <audio> element can play (default: fetch + blob URL). */
  resolve?: (url: string) => Promise<string>;
  release?: (src: string) => void;
  createMedia?: () => MediaLike;
  /** Base URL the track dir is resolved against (default: the page). */
  base?: string;
  dir: string;
  /** Label of the console warning. */
  label?: string;
}
export interface Prepared { track: TrackDef; el: MediaLike; src: string; duration: number }
export interface Playing { track: TrackDef; el: MediaLike; src: string; node: NodeLike; gain: GainLike; startedAt: number; duration: number; retiredAt: number; onEnd: () => void }

const STEPS = 12;
/** Equal-power ramp built from linear segments (the param interface has no value curve). `dir` = 'in' rises from -> to, 'out' falls. */
export function ramp(p: ParamLike, from: number, to: number, t0: number, dur: number): void {
  p.cancelScheduledValues(t0);
  p.setValueAtTime(from, t0);
  const curve = to >= from ? fadeIn : fadeOut;
  for (let i = 1; i <= STEPS; i++) p.linearRampToValueAtTime(to >= from ? from + (to - from) * curve(i / STEPS) : to + (from - to) * curve(i / STEPS), t0 + dur * i / STEPS);
}

/** fetch -> blob URL (plain 200 GET, cacheable by the service worker). */
export async function fetchBlobUrl(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return URL.createObjectURL(await r.blob());
}

export class TrackPlayer {
  cur: Playing | null = null;
  private fading: Playing[] = [];
  private prepared = new Map<string, Promise<Prepared | null>>();
  private ready = new Map<string, Prepared>();
  private hold = false;
  private warned = false;
  private offState: () => void;
  stats = { started: 0, loaded: 0, errors: 0 };

  constructor(private d: PlayerDeps) {
    this.offState = d.engine.onState(() => this.sync());
  }

  /** False where nothing can be played (no media-element routing in the backend, e.g. the offline renderer, or no Audio in the environment): callers then fetch nothing. */
  get supported(): boolean { return !!this.d.engine.backend?.createMediaElementSource && (!!this.d.createMedia || typeof Audio !== 'undefined'); }
  get playing(): boolean { return !!this.cur; }
  get active(): readonly Playing[] { return this.cur ? [this.cur, ...this.fading] : [...this.fading]; }
  get position(): number { return this.cur?.el.currentTime ?? 0; }
  /** Seconds left in the current track (Infinity when nothing plays). */
  get remaining(): number { const c = this.cur; return c ? Math.max(0, c.duration - c.el.currentTime) : Infinity; }
  get isHeld(): boolean { return this.hold; }

  private url(t: TrackDef): string {
    const base = this.d.base ?? (typeof document !== 'undefined' ? document.baseURI : 'http://localhost/');
    return new URL(this.d.dir + t.file, base).href;
  }
  private mkMedia(): MediaLike { return this.d.createMedia ? this.d.createMedia() : (new Audio() as unknown as MediaLike); }
  private warn(err: unknown): void { this.stats.errors++; if (!this.warned) { this.warned = true; console.warn(`[${this.d.label ?? 'music'}] unavailable:`, err); } }

  /** Fetch + ready one track (cached; resolves null on failure). */
  prepare(id: string): Promise<Prepared | null> {
    const have = this.ready.get(id); if (have) return Promise.resolve(have);
    let p = this.prepared.get(id);
    if (!p) {
      const track = TRACK_BY_ID.get(id);
      if (!track) return Promise.resolve(null);
      p = (async (): Promise<Prepared | null> => {
        let src = '';
        try {
          src = await (this.d.resolve ?? fetchBlobUrl)(this.url(track));
          const el = this.mkMedia(); el.preload = 'auto'; el.loop = false;
          await new Promise<void>((res, rej) => {
            const ok = (): void => { off(); res(); }, bad = (): void => { off(); rej(new Error(`cannot decode ${track.file}`)); };
            const off = (): void => { el.removeEventListener('loadedmetadata', ok); el.removeEventListener('error', bad); };
            el.addEventListener('loadedmetadata', ok); el.addEventListener('error', bad);
            el.src = src; el.load?.();
            if (el.duration > 0) ok();
          });
          const r: Prepared = { track, el, src, duration: el.duration }; this.ready.set(id, r); this.stats.loaded++; return r;
        } catch (err) { if (src) this.d.release?.(src); this.warn(err); return null; }
        finally { this.prepared.delete(id); }
      })();
      this.prepared.set(id, p);
    }
    return p;
  }

  /** Keep only these prepared tracks (frees the rest). */
  keepOnly(ids: readonly string[]): void {
    for (const [id, r] of [...this.ready]) if (!ids.includes(id) && !this.active.some((a) => a.el === r.el)) { this.free(r.el, r.src); this.ready.delete(id); }
  }

  private free(el: MediaLike, src: string): void { try { el.pause(); el.removeAttribute?.('src'); el.load?.(); } catch { /* ignore */ } this.d.release?.(src); }

  /**
   * Start a prepared track. The current track (if any) is crossfaded out over `fade` s; the new one fades in to `level` (its trim x `gainMul`).
   * `onEnd` fires once when it reaches its natural end while still the current track.
   */
  play(p: Prepared, fade: number, gainMul = 1, onEnd: () => void = () => {}): Playing | null {
    const b = this.d.engine.backend, dest = this.d.dest();
    if (!b || !dest || !b.createMediaElementSource) return null;
    this.ready.delete(p.track.id);
    const now = b.now(), level = p.track.trim * gainMul;
    const gain = b.createGain(); gain.gain.value = 0; gain.connect(dest);
    const node = b.createMediaElementSource(p.el); node.connect(gain);
    if (fade > 0) ramp(gain.gain, 0, level, now, fade); else gain.gain.value = level;
    p.el.currentTime = 0;
    const c: Playing = { track: p.track, el: p.el, src: p.src, node, gain, startedAt: now, duration: p.duration, retiredAt: Infinity, onEnd: () => {} };
    const ended = (): void => { if (this.cur === c) onEnd(); };
    p.el.addEventListener('ended', ended); c.onEnd = (): void => p.el.removeEventListener('ended', ended);
    if (this.cur) this.retire(this.cur, now, Math.max(fade, 0.05));
    this.cur = c; this.stats.started++;
    this.sync();
    return c;
  }

  private retire(p: Playing, now: number, fade: number): void {
    p.onEnd();
    ramp(p.gain.gain, p.gain.gain.value, 0, now, fade);
    p.retiredAt = now + fade + 0.05;
    this.fading.push(p);
    if (this.cur === p) this.cur = null;
  }

  /** Fade the current track out and drop it (a following `play` brings a new one in). */
  stop(fade: number): void {
    const b = this.d.engine.backend; const c = this.cur; if (!c) return;
    if (!b) { this.disposeOne(c); this.cur = null; return; }
    this.retire(c, b.now(), Math.max(fade, 0.05));
  }

  /** Pause / resume (position kept). */
  setHold(h: boolean): void { if (h === this.hold) return; this.hold = h; this.sync(); }

  /** Match the elements to engine state + hold. */
  sync(): void {
    const run = this.d.engine.running && !this.hold;
    for (const a of this.active) {
      try {
        if (run) { if (a.el.paused && !a.el.ended) { const r = a.el.play(); if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch((e: unknown) => this.warn(e)); } }
        else if (!a.el.paused) a.el.pause();
      } catch (e) { this.warn(e); }
    }
  }

  /** Free faded-out tracks (call every tick). */
  reap(): void {
    const b = this.d.engine.backend; if (!b) return;
    const now = b.now();
    for (let i = this.fading.length - 1; i >= 0; i--) { const p = this.fading[i]!; if (now >= p.retiredAt) { this.disposeOne(p); this.fading.splice(i, 1); } }
  }

  private disposeOne(p: Playing): void { try { p.onEnd(); p.node.disconnect(); p.gain.disconnect(); } catch { /* ignore */ } this.free(p.el, p.src); }

  dispose(): void {
    this.offState();
    for (const a of this.active) this.disposeOne(a);
    for (const r of this.ready.values()) this.free(r.el, r.src);
    this.cur = null; this.fading = []; this.ready.clear();
  }
}
