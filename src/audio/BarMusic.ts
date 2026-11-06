import { Rng } from '../core/Rng';
import { BAR_AUDIO, BAR_PLAYLIST, HANDOFF, MUSIC_PLAY } from '../config/audioMusic';
import { PROX } from '../config/audioProximity';
import type { GainLike } from './backend';
import { busGains } from './AudioSettings';
import type { AudioEngine } from './AudioEngine';
import { MusicHandoff, type HoldPhase } from './musicHold';
import { nextInPlaylist, playedLongEnough, trackTitle } from './musicPlaylist';
import { TrackPlayer, type PlayerDeps, type Prepared } from './TrackPlayer';

const A = PROX.apres;

/** Cutoff (Hz) of the bar-music low-pass for a level 0..1 (near = bright, far = muffled). */
export function apresCutoff(level: number): number { return A.cutoffFar + (A.cutoffNear - A.cutoffFar) * Math.pow(Math.min(1, Math.max(0, level)), 0.8); }
/** Level gain (0..1) for a bar proximity level 0..1. */
export function barLevelGain(level: number): number { return BAR_AUDIO.minGain + (1 - BAR_AUDIO.minGain) * Math.min(1, Math.max(0, level)); }

/**
 * Music next to an open Apres-Ski Bar or Schirmbar: a rotating playlist of owner-provided mp3 songs (`BAR_PLAYLIST`), never the same one twice in a row.
 * While it is audible the GAME music is stopped (`MusicHandoff`, shared with Music.ts): the game music fades out first, the bar music starts after, and on leaving
 * the bar music fades out before the game music returns. Own gain chain: track -> low-pass (opens with proximity) -> level gain -> fade gate -> ambience bus
 * (the Ambience slider governs it, `BAR_AUDIO.busBoost` makes up for the quieter default bus). `update(level)` at ~10 Hz from Ambience.
 * Back at the bar within `restartAfterSec` the same song resumes where it stopped; after longer the next song of the rotation plays.
 */
export class BarMusic {
  readonly handoff: MusicHandoff;
  readonly player: TrackPlayer;
  stats = { started: 0, failures: 0 };
  /** Track ids played, oldest first (capped at 12). */
  history: string[] = [];
  private fade: GainLike | null = null;
  private lv: GainLike | null = null;
  private lp: { frequency: { setTargetAtTime(v: number, t: number, tc: number): unknown } } | null = null;
  private fadePhase: HoldPhase = 'main';
  private active = false;
  private lastActiveAt = -1e9;
  private starting = false;
  private idleSince = -1;
  private failed: string[] = [];
  private queued: string | null = null;
  private rand: () => number;

  constructor(private engine: AudioEngine, handoff?: MusicHandoff, o: { rand?: () => number; player?: Partial<Pick<PlayerDeps, 'createMedia' | 'resolve' | 'release' | 'base'>> } = {}) {
    this.handoff = handoff ?? new MusicHandoff();
    if (o.rand) this.rand = o.rand; else { const r = new Rng((Date.now() ^ 0x4a9e5) >>> 0); this.rand = () => r.next(); }
    this.player = new TrackPlayer({ engine, dest: () => this.lp as never, dir: 'audio/', label: 'bar music', ...(o.player ?? {}) });
  }
  get isActive(): boolean { return this.active; }
  get currentTrack(): string | null { return this.player.cur?.track.id ?? null; }
  get currentTitle(): string { return trackTitle(this.currentTrack); }
  /** Target of the fade gate (1 while the bar music is meant to be heard). */
  get gateValue(): number { return this.handoff.phase === 'apres' ? 1 : 0; }

  private build(): boolean {
    const e = this.engine, b = e.backend, bus = e.busNode('ambience');
    if (!b || !bus) return false;
    if (this.fade) return true;
    const fade = b.createGain(); fade.gain.value = 0; fade.connect(bus);
    const lv = b.createGain(); lv.gain.value = 0; lv.connect(fade);
    const lp = b.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = A.cutoffFar; lp.Q.value = 0; lp.connect(lv);
    this.fade = fade; this.lv = lv; this.lp = lp;
    return true;
  }

  update(level: number): void {
    const e = this.engine;
    if (!e.running) { this.active = false; return; }
    const g = busGains(e.settings.get()), audible = g.ambience * g.master >= 1e-4;
    const now = e.now();
    const lvl = audible ? level : 0; // ambience slider at 0 / muted: the bar is silent, so the game music must not be stopped for it
    const phase = this.handoff.update(lvl, now);
    if (!this.build()) return;
    this.player.reap();
    this.applyFade(phase, now);
    if (lvl > 0 && phase !== 'apres' && this.player.supported && !this.player.cur && !this.starting) { // an open bar is in reach: fetch the first song now so the hand-off does not wait for the download
      this.queued ??= nextInPlaylist(BAR_PLAYLIST, this.history[this.history.length - 1] ?? null, this.rand, this.failed);
      void this.player.prepare(this.queued);
    }
    if (phase !== 'apres' || !audible) {
      if (this.active) this.lastActiveAt = now;
      this.active = false;
      if (this.idleSince < 0) this.idleSince = now;
      if (now - this.idleSince >= MUSIC_PLAY.holdAfter + HANDOFF.apresFadeOut) this.player.setHold(true); // faded out: pause, position kept
      return;
    }
    this.idleSince = -1;
    const eff = Math.max(level, HANDOFF.exitLevel); // inside the hysteresis band the bar keeps its (quiet) level
    this.lv!.gain.setTargetAtTime(barLevelGain(eff) * BAR_AUDIO.busBoost, now, 0.4); this.lp!.frequency.setTargetAtTime(apresCutoff(eff), now, 0.4);
    if (!this.active) {
      this.active = true;
      if (now - this.lastActiveAt > BAR_AUDIO.restartAfterSec && this.player.cur && playedLongEnough(this.player.position)) this.player.stop(0.05); // away for a while: the next song of the rotation (a song that has not had its minimum airtime yet resumes instead)
    }
    this.player.setHold(false);
    if (this.starting || !this.player.supported) return;
    if (!this.player.cur) void this.begin(0.05);
    else if (this.player.remaining <= BAR_AUDIO.crossfade + 0.1) void this.begin(Math.min(BAR_AUDIO.crossfade, Math.max(0.3, this.player.remaining)));
  }

  private applyFade(phase: HoldPhase, now: number): void {
    if (phase === this.fadePhase) return;
    const g = this.fade!.gain, cur = g.value;
    g.cancelScheduledValues(now);
    if (phase === 'apres') { g.setValueAtTime(0, now); g.linearRampToValueAtTime(1, now + HANDOFF.apresFadeIn); }
    else if (phase === 'toMain') { g.setValueAtTime(cur, now); g.linearRampToValueAtTime(0, Math.max(now + 0.05, this.handoff.since + HANDOFF.apresFadeOut)); }
    else g.setValueAtTime(0, now);
    this.fadePhase = phase;
  }

  private async begin(fade: number): Promise<void> {
    this.starting = true;
    try {
      const last = this.currentTrack ?? this.history[this.history.length - 1] ?? null;
      let id = this.queued && this.queued !== last ? this.queued : nextInPlaylist(BAR_PLAYLIST, last, this.rand, this.failed);
      let prep: Prepared | null = null;
      for (let tries = 0; tries < BAR_PLAYLIST.length && !prep; tries++) {
        prep = await this.player.prepare(id);
        if (!prep) { this.stats.failures++; this.failed.push(id); id = nextInPlaylist(BAR_PLAYLIST, last, this.rand, this.failed); }
      }
      if (!prep) { this.failed = []; return; } // everything failed (offline, nothing cached): silent; the next try is after the next track-less update
      if (!this.engine.running || this.handoff.phase !== 'apres') return;
      this.failed = [];
      this.player.play(prep, fade, 1, () => { this.player.stop(0.05); });
      this.stats.started++;
      this.history.push(prep.track.id); if (this.history.length > 12) this.history.shift();
      this.queued = nextInPlaylist(BAR_PLAYLIST, prep.track.id, this.rand);
      this.player.keepOnly([prep.track.id, this.queued]);
      void this.player.prepare(this.queued);
    } finally { this.starting = false; }
  }

  dispose(): void { this.player.dispose(); }
}
