import { HANDOFF } from '../config/audioMusic';

/**
 * Hand-off between the game music and the Apres-Ski Bar music (owner feedback: near the bar the game music must STOP, not just duck).
 *
 *   main --(level >= enter for enterDwell)--> toApres --(mainFadeOut s)--> apres --(level < exit for exitDwell, after minApresSec)--> toMain --(apresFadeOut s)--> main
 *
 * - `main`: the game music plays (fading in over mainFadeIn after a hold). `toApres`: the game music fades out and keeps scheduling until it is silent; the bar music is NOT started yet.
 * - `apres`: the game music holds its position (nothing scheduled); the bar music plays (fades in over apresFadeIn). `toMain`: the bar music stops scheduling and fades out; the game music waits.
 * The two gain envelopes are products of exclusive phases, so they never overlap (`mainEnvelope(t) * apresEnvelope(t) === 0` for every t, tested). Enter > exit thresholds plus dwell and minimum-time
 * rules make zooming in and out at the edge of the bar's reach harmless (no flip-flop). Pure apart from the clock values passed in; the audio nodes follow in Music.ts / Apres.ts.
 */
export type HoldPhase = 'main' | 'toApres' | 'apres' | 'toMain';
export type HandoffCfg = { readonly [K in keyof typeof HANDOFF]: (typeof HANDOFF)[K] };

export class MusicHandoff {
  phase: HoldPhase = 'main';
  /** Backend time the current phase began (-Infinity before the first transition). */
  since = -Infinity;
  /** True once the game music has been held at least once (its first fade-in is then a resume, not the intro). */
  held = false;
  transitions = 0;
  private beyond = -1;
  constructor(private cfg: HandoffCfg = HANDOFF) {}

  /** Feed the bar level (0..1; 0 when nothing audible) at `now` (backend seconds). Call at ~10 Hz. Returns the phase. */
  update(level: number, now: number): HoldPhase {
    const c = this.cfg;
    switch (this.phase) {
      case 'main':
        if (level >= c.enterLevel) { if (this.beyond < 0) this.beyond = now; if (now - this.beyond >= c.enterDwell && now - this.since >= c.minMainSec) this.go('toApres', now); }
        else this.beyond = -1;
        break;
      case 'toApres': if (now - this.since >= c.mainFadeOut) this.go('apres', now); break;
      case 'apres':
        if (level < c.exitLevel) { if (this.beyond < 0) this.beyond = now; if (now - this.beyond >= c.exitDwell && now - this.since >= c.minApresSec) this.go('toMain', now); }
        else this.beyond = -1;
        break;
      case 'toMain': if (now - this.since >= c.apresFadeOut) this.go('main', now); break;
    }
    return this.phase;
  }
  private go(p: HoldPhase, now: number): void { this.phase = p; this.since = now; this.beyond = -1; this.transitions++; if (p === 'apres') this.held = true; }

  /** The game music may schedule notes (main, and while it fades out). */
  get mainScheduling(): boolean { return this.phase === 'main' || this.phase === 'toApres'; }
  /** The bar music may schedule notes. */
  get apresScheduling(): boolean { return this.phase === 'apres'; }

  /** Nominal 0..1 envelope of the game music's hold gain at `now` (what Music.ts ramps to). */
  mainEnvelope(now: number): number {
    const c = this.cfg, dt = Math.max(0, now - this.since);
    switch (this.phase) {
      case 'main': return this.held ? Math.min(1, dt / c.mainFadeIn) : 1;
      case 'toApres': return Math.max(0, 1 - dt / c.mainFadeOut);
      default: return 0;
    }
  }
  /** Nominal 0..1 envelope of the bar music's output gain at `now`. */
  apresEnvelope(now: number): number {
    const c = this.cfg, dt = Math.max(0, now - this.since);
    switch (this.phase) {
      case 'apres': return Math.min(1, dt / c.apresFadeIn);
      case 'toMain': return Math.max(0, 1 - dt / c.apresFadeOut);
      default: return 0;
    }
  }
}
