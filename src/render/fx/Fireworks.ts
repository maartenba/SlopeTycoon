import type { FeedbackPolicy } from './feedbackPolicy';
import { renderRng, type Particles } from './Particles';
import { EVENTS } from '../../config/festivals';

/**
 * Restrained fireworks (M5.4 Task 21): a short, modest show (a handful of single-colour shells, ~13 s real time) at New Year and festival finales,
 * at night only. Suppressed when Feedback intensity is Off (which includes fast-forward) or reduced motion is on. Render only: its own RNG, the
 * sim is never touched. Sparks go through the shared Particles pool (no extra draw call).
 */
export const FIREWORKS = { shells: 5, gapS: 2.4, sparks: 22, height: 7, spread: 4, colors: [0xffc04a, 0xff6a50, 0x6ab8ff, 0xfff2c0, 0x7de07a] as readonly number[] } as const;

/** Pure: may fireworks run under this feedback policy? (Off -> never; reduced motion -> never; Subtle and Lively -> yes). */
export function fireworksAllowed(p: Pick<FeedbackPolicy, 'intensity'>, reducedMotion: boolean): boolean { return p.intensity !== 'off' && !reducedMotion; }

/** Pure: may a show START now? Dark enough (night factor >= 0.6) and in the evening (after `fireworksFrom`). Once started a show runs to its end in real time (nights are fast-forwarded). */
export function showMayStart(hour: number, dark: number): boolean { return hour >= EVENTS.fireworksFrom && dark >= 0.6; }

export interface ShowFrame {
  /** Day key of today's show (e.g. `event@day`), or null when no show is scheduled today. */
  show: string | null;
  hour: number;
  /** Night factor 0..1 (1 = full night). */
  dark: number;
  allowed: boolean;
  /** Where the show is centred (ground height included). */
  origin: { x: number; y: number; z: number };
}

export class Fireworks {
  private rng: () => number;
  private done = new Set<string>();
  private running: { key: string; shell: number; wait: number } | null = null;
  /** Shells fired in total (tests / harness). */
  shells = 0;
  constructor(private particles: Particles, seed = 0xf17e) { this.rng = renderRng(seed); }

  get active(): boolean { return this.running !== null; }

  update(dt: number, f: ShowFrame): void {
    if (this.running && (!f.allowed || f.show !== this.running.key)) this.running = null;
    if (!this.running) {
      if (f.show && f.allowed && showMayStart(f.hour, f.dark) && !this.done.has(f.show)) { this.done.add(f.show); this.running = { key: f.show, shell: 0, wait: 0 }; if (this.done.size > 64) this.done.clear(); }
      else return;
    }
    const r = this.running!;
    r.wait -= dt;
    if (r.wait > 0) return;
    if (r.shell >= FIREWORKS.shells) { this.running = null; return; }
    const c = FIREWORKS.colors[(this.shells) % FIREWORKS.colors.length]!;
    this.particles.emit({ x: f.origin.x + (this.rng() - 0.5) * FIREWORKS.spread * 2, y: f.origin.y + FIREWORKS.height + this.rng() * 2, z: f.origin.z + (this.rng() - 0.5) * FIREWORKS.spread * 2, count: FIREWORKS.sparks, kind: 'spark', color: c });
    r.shell++; this.shells++; r.wait = FIREWORKS.gapS * (0.8 + this.rng() * 0.5);
  }
}
