import { Rng } from '../core/Rng';
import { MENU_MUSIC } from '../config/audioMusic';
import type { AudioEngine } from './AudioEngine';
import type { AudioSettings } from './AudioSettings';
import type { BufferLike, GainLike, ParamLike, SourceLike } from './backend';
import { fadeIn, fadeOut, nextStartAt, nextTrackIndex } from './menuPlaylist';

type Cfg = typeof MENU_MUSIC;
type Decoded = BufferLike & { duration: number };
export interface MenuMusicDeps {
  engine: AudioEngine;
  settings: AudioSettings;
  /** Fetches the encoded bytes of a track URL (the service worker runtime-caches them). */
  load: (url: string) => Promise<ArrayBuffer>;
  /** Base URL the track files are resolved against (default: the page). */
  base?: string;
  /** UI-only randomness (not the sim's). */
  rand?: () => number;
  cfg?: Cfg;
  /** false = the caller drives `tick()` (tests). */
  autoTick?: boolean;
}
interface Playing { idx: number; src: SourceLike; gain: GainLike; startedAt: number; endsAt: number; dur: number }

const STEPS = 12;
/** Equal-power ramp built from linear segments (the param interface has no value curve). */
function ramp(p: ParamLike, from: number, to: number, t0: number, dur: number, curve: (x: number) => number): void {
  p.cancelScheduledValues(t0);
  p.setValueAtTime(from, t0);
  for (let i = 1; i <= STEPS; i++) p.linearRampToValueAtTime(to < from ? to + (from - to) * curve(i / STEPS) : from + (to - from) * curve(i / STEPS), t0 + dur * i / STEPS); // fadeOut curves run 1 -> 0, fadeIn curves 0 -> 1
}

/**
 * Title-screen music: two owner-provided tracks, shuffled without an immediate repeat, crossfaded, looping as a playlist.
 * Graph: source -> track gain (trim x fade) -> out gain -> the engine's MUSIC bus, so the Music slider, mute (M), ambience-only and the
 * engine's tab-hidden suspend all apply. Starts once the engine is running (first user gesture); the files are fetched after that, never
 * during boot. `fadeOut()` ends it before a game starts (the in-game music is a different page load and takes over from there).
 */
export class MenuMusic {
  private readonly cfg: Cfg;
  private readonly rand: () => number; // set in the constructor
  private out: GainLike | null = null;
  private cur: Playing | null = null;
  private fading: Playing[] = [];
  private decoded = new Map<number, Decoded>();
  private pending = new Map<number, Promise<Decoded | null>>();
  private last = -1;
  private starting = false;
  private ended = false;
  private failed = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private offs: Array<() => void> = [];
  /** Counters for tests / debug. */
  stats = { started: 0, loaded: 0, errors: 0 };

  constructor(private d: MenuMusicDeps) {
    this.cfg = d.cfg ?? MENU_MUSIC;
    if (d.rand) this.rand = d.rand; else { const r = new Rng(Date.now() >>> 0); this.rand = () => r.next(); } // UI-only: the first track differs between visits
    this.offs.push(d.engine.onState(() => this.arm()), d.settings.subscribe(() => this.arm()));
    if (d.autoTick !== false && typeof setInterval === 'function') this.timer = setInterval(() => this.tick(), this.cfg.tickMs);
    this.arm();
  }

  get playing(): boolean { return !!this.cur && !this.ended; }
  get currentTrack(): number { return this.cur?.idx ?? -1; }
  private get wanted(): boolean { return this.cfg.enabled && this.cfg.tracks.length > 0 && !this.ended && this.d.settings.get().musicOn; }

  private url(i: number): string { return new URL(this.cfg.dir + this.cfg.tracks[i]!.file, this.d.base ?? (typeof document !== 'undefined' ? document.baseURI : 'http://localhost/')).href; }

  /** (Re)evaluate: begin playing once the engine runs and the music setting is on; fade the whole thing with the setting. */
  private arm(): void {
    if (this.ended) return;
    const e = this.d.engine, b = e.backend;
    if (this.out && b) this.out.gain.setTargetAtTime(this.d.settings.get().musicOn ? 1 : 0, b.now(), 0.25);
    if (!this.cur && !this.starting && this.wanted && e.running && b?.decode) { this.starting = true; void this.begin(); }
  }

  private fetchTrack(i: number): Promise<Decoded | null> {
    const have = this.decoded.get(i); if (have) return Promise.resolve(have);
    let p = this.pending.get(i);
    if (!p) {
      p = (async () => {
        try {
          const dec = await this.d.engine.backend!.decode!(await this.d.load(this.url(i)));
          this.decoded.set(i, dec); this.stats.loaded++; return dec;
        } catch (err) { this.stats.errors++; if (!this.failed) { this.failed = true; console.warn('[menu music] unavailable:', err); } return null; }
        finally { this.pending.delete(i); }
      })();
      this.pending.set(i, p);
    }
    return p;
  }

  private async begin(): Promise<void> {
    const idx = nextTrackIndex(-1, this.cfg.tracks.length, this.rand);
    const dec = await this.fetchTrack(idx);
    this.starting = false;
    if (!dec || !this.wanted || !this.d.engine.running || this.cur) return;
    this.play(idx, dec, this.cfg.fadeIn);
  }

  private play(idx: number, dec: Decoded, fade: number): void {
    const b = this.d.engine.backend, bus = this.d.engine.busNode('music');
    if (!b || !bus) return;
    if (!this.out) { this.out = b.createGain(); this.out.gain.value = this.d.settings.get().musicOn ? 1 : 0; this.out.connect(bus); }
    const now = b.now(), trim = this.cfg.tracks[idx]!.trim;
    const gain = b.createGain(); gain.gain.value = 0; gain.connect(this.out);
    const src = b.createBufferSource(); src.buffer = dec; src.loop = false; src.connect(gain);
    ramp(gain.gain, 0, trim, now, fade, fadeIn);
    src.start(now);
    if (this.cur) this.retire(this.cur, now, fade);
    this.cur = { idx, src, gain, startedAt: now, endsAt: now + dec.duration, dur: dec.duration };
    this.last = idx; this.stats.started++;
    const nxt = nextTrackIndex(idx, this.cfg.tracks.length, this.rand);
    this.nextIdx = nxt; void this.fetchTrack(nxt); // preload the next one while this plays
  }
  private nextIdx = -1;

  private retire(p: Playing, now: number, fade: number): void {
    const cur = p.gain.gain.value;
    ramp(p.gain.gain, cur, 0, now, fade, fadeOut);
    p.src.stop(now + fade + 0.05);
    p.endsAt = now + fade + 0.05;
    this.fading.push(p);
  }

  /** Scheduler step (every `tickMs`): crossfade into the next track near the end of this one, free finished sources. */
  tick(): void {
    const b = this.d.engine.backend;
    if (!b || this.ended || !this.d.engine.running) return;
    const now = b.now();
    for (let i = this.fading.length - 1; i >= 0; i--) { const p = this.fading[i]!; if (now >= p.endsAt) { try { p.src.disconnect(); p.gain.disconnect(); } catch { /* ignore */ } this.fading.splice(i, 1); } }
    const c = this.cur;
    if (!c || !this.wanted) { if (!c) this.arm(); return; }
    const startNext = nextStartAt(c.startedAt, c.dur, this.cfg.crossfade);
    if (now < startNext - 0.001) return;
    const i = this.nextIdx >= 0 ? this.nextIdx : nextTrackIndex(c.idx, this.cfg.tracks.length, this.rand);
    const dec = this.decoded.get(i);
    if (!dec) { void this.fetchTrack(i); return; } // not decoded yet: try again next tick (the current track just ends meanwhile)
    if (now >= c.endsAt + 0.02) { this.cur = null; this.play(i, dec, this.cfg.fadeIn); return; } // it already ended: plain fade-in
    this.play(i, dec, Math.min(this.cfg.crossfade, c.dur / 2));
  }

  /** Fade everything out (default `cfg.fadeOut` s) and stop for good. Returns the fade time in ms (0 when nothing was playing). */
  fadeOut(sec = this.cfg.fadeOut): number {
    const b = this.d.engine.backend;
    const was = this.playing;
    this.ended = true;
    if (!b || !was || !this.out) { this.dispose(); return 0; }
    const now = b.now();
    ramp(this.out.gain, this.out.gain.value, 0, now, sec, fadeOut);
    for (const p of [this.cur!, ...this.fading]) p.src.stop(now + sec + 0.05);
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    return Math.round(sec * 1000);
  }

  dispose(): void {
    this.ended = true;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    for (const o of this.offs.splice(0)) o();
    for (const p of [...(this.cur ? [this.cur] : []), ...this.fading]) { try { p.src.stop(); p.src.disconnect(); p.gain.disconnect(); } catch { /* ignore */ } }
    this.cur = null; this.fading = [];
  }
}

/** Fetches a file's bytes (a plain 200 GET: the service worker can runtime-cache it, unlike the 206 range requests of an <audio> element). */
export function loadBytes(url: string): Promise<ArrayBuffer> {
  return fetch(url).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`); return r.arrayBuffer(); });
}
