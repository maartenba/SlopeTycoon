import { Rng } from '../core/Rng';
import { MENU_MUSIC, MENU_PLAYLIST } from '../config/audioMusic';
import type { AudioEngine } from './AudioEngine';
import type { AudioSettings } from './AudioSettings';
import type { GainLike } from './backend';
import { nextInPlaylist } from './musicPlaylist';
import { ramp, TrackPlayer, type PlayerDeps, type Prepared } from './TrackPlayer';

type Cfg = typeof MENU_MUSIC;
export interface MenuMusicDeps {
  engine: AudioEngine;
  settings: AudioSettings;
  /** Test hooks for the player (media element factory, URL resolver, base URL). */
  player?: Partial<Pick<PlayerDeps, 'createMedia' | 'resolve' | 'release' | 'base'>>;
  /** UI-only randomness (not the sim's). */
  rand?: () => number;
  cfg?: Cfg;
  /** false = the caller drives `tick()` (tests). */
  autoTick?: boolean;
}

/**
 * Title-screen music: the two owner-provided tracks of `MENU_PLAYLIST` (Seasons of Management is the title theme and opens; the two alternate, crossfaded, never the same twice in a row).
 * Graph: track gain (trim x fade) -> out gain -> the engine's MUSIC bus, so the Music slider, mute (M), ambience-only and the engine's tab-hidden suspend all apply.
 * Starts once the engine is running (first user gesture); the files are fetched after that, never during boot. `fadeOut()` ends it before a game starts (the in-game
 * music is a different page load and takes over from there).
 */
export class MenuMusic {
  private readonly cfg: Cfg;
  private readonly rand: () => number;
  readonly player: TrackPlayer;
  private out: GainLike | null = null;
  private starting = false;
  private ended = false;
  private queued: string | null = null;
  private history: string[] = [];
  private failed: string[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private offs: Array<() => void> = [];
  /** Counters for tests / debug. */
  get stats(): { started: number; loaded: number; errors: number } { return this.player.stats; }

  constructor(private d: MenuMusicDeps) {
    this.cfg = d.cfg ?? MENU_MUSIC;
    if (d.rand) this.rand = d.rand; else { const r = new Rng(Date.now() >>> 0); this.rand = () => r.next(); }
    this.player = new TrackPlayer({ engine: d.engine, dest: () => this.out, dir: this.cfg.dir, label: 'menu music', ...(d.player ?? {}) });
    this.offs.push(d.engine.onState(() => this.arm()), d.settings.subscribe(() => this.arm()));
    if (d.autoTick !== false && typeof setInterval === 'function') this.timer = setInterval(() => this.tick(), this.cfg.tickMs);
    this.arm();
  }

  get playing(): boolean { return !!this.player.cur && !this.ended; }
  get currentTrack(): string | null { return this.player.cur?.track.id ?? null; }
  private get wanted(): boolean { return this.cfg.enabled && MENU_PLAYLIST.length > 0 && !this.ended && this.d.settings.get().musicOn; }

  /** (Re)evaluate: begin playing once the engine runs and the music setting is on; fade the whole thing with the setting. */
  private arm(): void {
    if (this.ended) return;
    const e = this.d.engine, b = e.backend;
    if (this.out && b) this.out.gain.setTargetAtTime(this.d.settings.get().musicOn ? 1 : 0, b.now(), 0.25);
    if (!this.player.cur && !this.starting && this.wanted && e.running && b?.createMediaElementSource) void this.begin(this.cfg.fadeIn);
  }

  private async begin(fade: number): Promise<void> {
    this.starting = true;
    try {
      const last = this.history[this.history.length - 1] ?? null;
      let id = last === null ? MENU_PLAYLIST[0]! : (this.queued && this.queued !== last ? this.queued : nextInPlaylist(MENU_PLAYLIST, last, this.rand, this.failed));
      let prep: Prepared | null = null;
      for (let tries = 0; tries < MENU_PLAYLIST.length && !prep; tries++) {
        prep = await this.player.prepare(id);
        if (!prep) { this.failed.push(id); id = nextInPlaylist(MENU_PLAYLIST, id, this.rand, this.failed); }
      }
      if (!prep || !this.wanted || !this.d.engine.running) return;
      this.failed = [];
      const b = this.d.engine.backend!, bus = this.d.engine.busNode('music');
      if (!bus) return;
      if (!this.out) { this.out = b.createGain(); this.out.gain.value = this.d.settings.get().musicOn ? 1 : 0; this.out.connect(bus); }
      this.player.play(prep, fade, 1, () => { this.player.stop(0.05); });
      this.history.push(prep.track.id);
      this.queued = nextInPlaylist(MENU_PLAYLIST, prep.track.id, this.rand);
      this.player.keepOnly([prep.track.id, this.queued]);
      void this.player.prepare(this.queued); // preload the next one while this plays
    } finally { this.starting = false; }
  }

  /** Scheduler step (every `tickMs`): crossfade into the next track near the end of this one, free finished tracks. */
  tick(): void {
    if (!this.d.engine.running) return;
    this.player.reap();
    if (this.ended) return;
    const c = this.player.cur;
    if (!c) { this.arm(); return; }
    if (!this.wanted || this.starting) return;
    if (this.player.remaining <= Math.min(this.cfg.crossfade, c.duration / 2) + 0.1) void this.begin(Math.min(this.cfg.crossfade, Math.max(0.3, this.player.remaining)));
  }

  /** Fade everything out (default `cfg.fadeOut` s) and stop for good. Returns the fade time in ms (0 when nothing was playing). */
  fadeOut(sec: number = this.cfg.fadeOut): number {
    const b = this.d.engine.backend;
    const was = this.playing;
    this.ended = true;
    if (!b || !was || !this.out) { this.dispose(); return 0; }
    ramp(this.out.gain, this.out.gain.value, 0, b.now(), sec);
    this.player.stop(sec);
    if (typeof setTimeout === 'function') setTimeout(() => this.dispose(), sec * 1000 + 500); // the ticker keeps freeing the faded track until then
    return Math.round(sec * 1000);
  }

  dispose(): void {
    this.ended = true;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    for (const o of this.offs.splice(0)) o();
    this.player.dispose();
  }
}
