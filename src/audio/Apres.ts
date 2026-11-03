import { APRES_SONG, HANDOFF } from '../config/audioMusic';
import { PROX } from '../config/audioProximity';
import type { GainLike, NodeLike } from './backend';
import { apresPlan, apresStep, hash01, STEPS_PER_BAR } from './apresSong';
import { busGains } from './AudioSettings';
import type { AudioEngine } from './AudioEngine';
import { playNote, type InstCtx, type InstVoice } from './instruments';
import { MusicHandoff, type HoldPhase } from './musicHold';

export { hash01 };
const A = PROX.apres, S = APRES_SONG;

/** Cutoff (Hz) of the bar-music low-pass for a level 0..1 (near = bright, far = muffled). */
export function apresCutoff(level: number): number { return A.cutoffFar + (A.cutoffNear - A.cutoffFar) * Math.pow(Math.min(1, Math.max(0, level)), 0.8); }

/**
 * Apres-Ski Bar music: the party groove from `apresSong.ts` (four-on-the-floor, clap, off-beat hats, driving bass, accordion + brass hooks, build-ups and drops), scheduled a sixteenth step at a time
 * `S.lookahead` seconds ahead. While it is audible the GAME music is stopped (`MusicHandoff`, shared with Music.ts): the game music fades out first, the bar music starts after, and on leaving
 * the bar music fades out before the game music returns. Own gain chain: voices -> low-pass (opens with proximity) -> level gain -> fade gate -> ambience bus. `update(level)` at ~10 Hz.
 */
export class ApresMusic {
  readonly handoff: MusicHandoff;
  /** Sixteenth steps scheduled since creation (tests). */
  scheduled = 0;
  stats = { hits: 0, dropped: 0 };
  private next = 0;
  private step = 0;
  private active = false;
  private lastActiveAt = -1e9;
  private voices: InstVoice[] = [];
  private ctx: InstCtx | null = null;
  private lp: { frequency: { setTargetAtTime(v: number, t: number, tc: number): unknown } } | null = null;
  private lv: GainLike | null = null;
  private fade: GainLike | null = null;
  private fadePhase: HoldPhase = 'main';

  constructor(private engine: AudioEngine, private seed: number = A.seed, handoff?: MusicHandoff) { this.handoff = handoff ?? new MusicHandoff(); }
  get isActive(): boolean { return this.active; }
  get liveVoices(): number { return this.voices.length; }
  get plan(): ReturnType<typeof apresPlan> { return apresPlan(this.seed); }
  /** Position in the song (bar index, 0 = first bar). */
  get bar(): number { return Math.floor(this.step / STEPS_PER_BAR); }
  /** Target of the fade gate (1 while the bar music is meant to be heard). */
  get gateValue(): number { return this.handoff.phase === 'apres' ? 1 : 0; }

  private build(): boolean {
    const e = this.engine, b = e.backend, bus = e.busNode('ambience'), noise = e.noise;
    if (!b || !bus || !noise) return false;
    if (this.ctx) return true;
    const fade = b.createGain(); fade.gain.value = 0; fade.connect(bus);
    const lv = b.createGain(); lv.gain.value = 0; lv.connect(fade);
    const lp = b.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = A.cutoffFar; lp.Q.value = 0; lp.connect(lv);
    const mix = b.createGain(); mix.gain.value = 1; mix.connect(lp);
    this.fade = fade; this.lv = lv; this.lp = lp; this.ctx = { b, noise, dest: mix, reverb: null as NodeLike | null };
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
    this.reap(now);
    this.applyFade(phase, now);
    if (phase !== 'apres' || !audible) { if (this.active) this.lastActiveAt = now; this.active = false; return; }
    const eff = Math.max(level, HANDOFF.exitLevel); // inside the hysteresis band the bar keeps its (quiet) level
    this.lv!.gain.setTargetAtTime(S.outGain * eff, now, 0.4); this.lp!.frequency.setTargetAtTime(apresCutoff(eff), now, 0.4);
    const sec = 60 / this.plan.bpm / 4;
    if (!this.active || this.next < now - 0.05) {
      if (!this.active && now - this.lastActiveAt > S.restartAfterSec) this.step = 0; // away for a while: the song starts over from its intro (build-ups and drops are the point)
      else if (this.step % STEPS_PER_BAR) this.step += STEPS_PER_BAR - (this.step % STEPS_PER_BAR); // (re)start on a bar line
      this.active = true; this.next = now + 0.05;
    }
    while (this.next < now + S.lookahead) {
      for (const h of apresStep(this.seed, this.step)) this.play(h, this.next, sec);
      this.step++; this.next += sec; this.scheduled++;
    }
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

  private play(h: ReturnType<typeof apresStep>[number], t: number, sec: number): void {
    if (this.voices.length >= S.maxVoices) { this.stats.dropped++; return; }
    const v = playNote(this.ctx!, h.inst, h.midi, t, h.steps * sec, h.vel, h.pan);
    if (v) { this.voices.push(v); this.stats.hits++; }
  }

  private reap(now: number): void {
    for (let i = this.voices.length - 1; i >= 0; i--) { const v = this.voices[i]!; if (v.end <= now) { v.scope.dispose(); this.voices.splice(i, 1); } }
  }

  dispose(): void { for (const v of this.voices.splice(0)) v.scope.dispose(); }
}
