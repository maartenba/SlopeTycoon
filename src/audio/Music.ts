import { Rng } from '../core/Rng';
import { HANDOFF, MUSIC_PLAY, SITUATION, type SituationId } from '../config/audioMusic';
import type { AudioEngine } from './AudioEngine';
import type { GainLike } from './backend';
import { MusicHandoff, type HoldPhase } from './musicHold';
import { isUrgent, pickNext, SituationTracker, trackTitle, type MusicInput } from './musicPlaylist';
import { TrackPlayer, type PlayerDeps, type Prepared } from './TrackPlayer';

export type { MusicInput };
const P = MUSIC_PLAY;

export interface MusicOpts {
  /** Shared with the bar music (BarMusic.ts): near an open Apres-Ski Bar the game music stops. Default: a private one that never leaves `main`. */
  handoff?: MusicHandoff;
  /** UI-only randomness (not the sim's). */
  rand?: () => number;
  /** Test hooks for the player (media element factory, URL resolver, base URL). */
  player?: Partial<Pick<PlayerDeps, 'createMedia' | 'resolve' | 'release' | 'base'>>;
}

/**
 * The in-game music: owner-provided mp3 files (docs/audio.md "Music") chosen by situation (season, time of day, weather, festival, busy resort, night alternative;
 * `musicPlaylist.ts` + the PLAYLISTS table) and played by a `TrackPlayer`. Track changes are conservative: a new situation must hold for a while (`SituationTracker`),
 * most changes wait for the playing track to end, only a storm, nightfall or a festival cut in with a crossfade (and not more often than `SITUATION.minChangeGapSec`).
 * Pause / mute / speed 0 / the hand-off to the bar music fade the gain, then pause the element (position kept); the music resumes exactly where it stopped.
 * Graph: track gain -> hold (hand-off) -> gate (pause / mute fade) -> the engine's music bus (Music slider, Master, mute, ambience-only apply).
 */
export class Music {
  readonly input: MusicInput = { season: 'winter', weather: 'clear', hour: 12, speed: 1 };
  stats = { started: 0, crossfades: 0, failures: 0 };
  /** Track ids played, oldest first (capped at 12). */
  history: string[] = [];
  readonly tracker = new SituationTracker();
  readonly handoff: MusicHandoff;
  readonly player: TrackPlayer;
  private gate: GainLike | null = null;
  private hold: GainLike | null = null;
  private holdPhase: HoldPhase = 'main';
  private gateTarget = -1;
  private curSituation: SituationId | null = null;
  private queued: string | null = null;
  private queuedFor: SituationId | null = null;
  private starting = false;
  private skipRequested = false;
  private previewUntil = -1;
  private lastChangeAt = -Infinity;
  private runningSince = -1;
  private idleSince = -1;
  private backoffUntil = -1;
  private failed = new Set<string>();
  private warnedAll = false;
  private rand: () => number;

  constructor(private engine: AudioEngine, o: MusicOpts = {}) {
    this.handoff = o.handoff ?? new MusicHandoff();
    if (o.rand) this.rand = o.rand; else { const r = new Rng(Date.now() >>> 0); this.rand = () => r.next(); }
    this.player = new TrackPlayer({ engine, dest: () => this.hold, dir: 'audio/', label: 'music', ...(o.player ?? {}) });
  }

  get isPlaying(): boolean { return this.player.playing && this.gateTarget === 1; }
  get gateValue(): number { return this.gateTarget; }
  /** Target of the hand-off hold gain (1 = game music may be heard, 0 = stopped for the bar music). */
  get holdValue(): number { return this.handoff.phase === 'main' ? 1 : 0; }
  /** Track id playing now (null before the first track / between failures). */
  get currentTrack(): string | null { return this.player.cur?.track.id ?? null; }
  get currentTitle(): string { return trackTitle(this.currentTrack); }
  get situation(): SituationId | null { return this.tracker.committed; }
  get trackCount(): number { return this.player.active.length; }

  setInputs(p: Partial<MusicInput>): void { Object.assign(this.input, p); }
  /** Skip to another track of the situation (crossfade). Keeps the music audible for a while when the game is paused (Settings preview). */
  next(): void { this.skipRequested = true; this.previewUntil = this.engine.now() + P.previewSec; }

  private build(): boolean {
    const b = this.engine.backend, bus = this.engine.busNode('music');
    if (!b || !bus) return false;
    if (this.hold) return true;
    const gate = b.createGain(); gate.gain.value = 0; gate.connect(bus); this.gate = gate;
    const hold = b.createGain(); hold.gain.value = 1; hold.connect(gate); this.hold = hold;
    return true;
  }

  /** Scheduler pass (every `MUSIC_PLAY.tickMs`). Safe at any rate; does nothing until the engine is running. */
  tick(): void {
    if (!this.engine.running || !this.build()) { this.runningSince = -1; return; }
    const now = this.engine.now(), st = this.engine.settings.get();
    if (this.runningSince < 0) this.runningSince = now;
    this.player.reap();
    this.applyHold(now);
    const want = st.musicOn && !st.muted && !st.ambienceOnly && this.handoff.mainScheduling && !(st.pauseMusicAtZero && this.input.speed === 0 && now > this.previewUntil);
    const target = want ? 1 : 0;
    if (target !== this.gateTarget) {
      this.gate!.gain.cancelScheduledValues(now);
      this.gate!.gain.setTargetAtTime(target, now, want ? P.resumeFadeTc : P.pauseFadeTc);
      this.gateTarget = target;
    }
    if (!want) { // silent: pause the element once the fade is done (position kept)
      if (this.idleSince < 0) this.idleSince = now;
      if (now - this.idleSince >= P.holdAfter) this.player.setHold(true);
      return;
    }
    this.idleSince = -1; this.player.setHold(false);
    this.tracker.update(this.input, now);
    if (!this.player.supported) return;
    this.decide(now);
  }

  /** Follows the hand-off phase: the game music fades out (linear, mainFadeOut) before the bar music starts, and back in (mainFadeIn) after it left. */
  private applyHold(now: number): void {
    const ph = this.handoff.phase;
    if (ph === this.holdPhase) return;
    const g = this.hold!.gain, cur = g.value;
    g.cancelScheduledValues(now);
    if (ph === 'toApres') { g.setValueAtTime(cur, now); g.linearRampToValueAtTime(0, Math.max(now + 0.05, this.handoff.since + HANDOFF.mainFadeOut)); }
    else if (ph === 'main') { g.setValueAtTime(0, now); g.linearRampToValueAtTime(1, now + HANDOFF.mainFadeIn); }
    else g.setValueAtTime(0, now);
    this.holdPhase = ph;
  }

  private decide(now: number): void {
    const sit = this.tracker.committed; if (!sit || this.starting) return;
    const cur = this.player.cur;
    if (!cur) {
      if (now < this.backoffUntil || now - this.runningSince < P.startDelay) return;
      void this.begin(sit, P.introFade);
      return;
    }
    if (this.queuedFor !== sit) this.preloadNext(sit);
    if (this.skipRequested) { this.skipRequested = false; void this.begin(sit, P.skipCrossfade, cur.track.id); return; }
    if (this.curSituation !== sit && isUrgent(sit) && now - this.lastChangeAt >= SITUATION.minChangeGapSec) { this.lastChangeAt = now; void this.begin(sit, P.situationCrossfade, cur.track.id); return; }
    if (this.player.remaining <= P.trackCrossfade + 0.1) void this.begin(sit, Math.min(P.trackCrossfade, Math.max(0.3, this.player.remaining)));
  }

  private preloadNext(sit: SituationId): void {
    const cur = this.player.cur?.track.id ?? null;
    this.queued = pickNext(sit, cur ? [...this.history.slice(0, -1), cur] : this.history, this.rand, [...this.failed]);
    this.queuedFor = sit;
    this.player.keepOnly([cur, this.queued].filter((x): x is string => !!x));
    void this.player.prepare(this.queued);
  }

  /** Load and start a track for `sit` (crossfading from the playing one); a track that fails to load is skipped for the next candidate. */
  private async begin(sit: SituationId, fade: number, avoid?: string): Promise<void> {
    this.starting = true;
    try {
      let id = this.queuedFor === sit && this.queued && this.queued !== avoid ? this.queued : pickNext(sit, this.history, this.rand, [...this.failed, ...(avoid ? [avoid] : [])]);
      let prep: Prepared | null = null;
      for (let tries = 0; tries < 4 && !prep; tries++) {
        prep = await this.player.prepare(id);
        if (!prep) { this.stats.failures++; this.failed.add(id); id = pickNext(sit, this.history, this.rand, [...this.failed]); }
      }
      if (!prep) {
        this.backoffUntil = this.engine.now() + P.failBackoffSec; this.failed.clear();
        if (!this.warnedAll) { this.warnedAll = true; console.warn('[music] no track could be loaded (offline without a cached copy?): staying silent'); }
        return;
      }
      if (!this.engine.running) return; // the engine stopped while loading: the next tick tries again
      this.failed.delete(prep.track.id);
      const first = !this.player.cur;
      const p = this.player.play(prep, fade, 1, () => { this.player.stop(0.05); });
      if (!p) return;
      if (!first) this.stats.crossfades++;
      this.stats.started++; this.curSituation = sit; this.queuedFor = null;
      this.history.push(prep.track.id); if (this.history.length > 12) this.history.shift();
      this.preloadNext(sit);
    } finally { this.starting = false; }
  }

  dispose(): void { this.player.dispose(); }
}


