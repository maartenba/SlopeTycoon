import * as THREE from 'three';
import type { GameBus } from '../../core/events';
import { confettiAllowed, feedbackPolicy, loadIntensity, saveIntensity, type FeedbackIntensity, type FeedbackPolicy, type FxStorage } from './feedbackPolicy';
import { FloatText } from './FloatText';
import { MoneyAggregator } from './MoneyAggregator';
import type { Particles } from './Particles';

export * from './feedbackPolicy';
export { FloatText } from './FloatText';
export { MoneyAggregator, type Popup } from './MoneyAggregator';
export { Particles, renderRng } from './Particles';
export { Emotes, EMOTE_LIFE_S } from './Emotes';
export { WildlifeSight, type SightAnimal } from './wildlifeSight';
export { pickEmote, coldness, clusterRepresentatives, EMOTES, EMOTE_T, wildlifeAllowed, type EmoteKind, type EmoteNeeds } from './emotePick';

/** Where a sale shows up: a stable per-building key + world position (x, ground height, z). */
export interface MoneySource { key: number; x: number; y: number; z: number }

export interface FeedbackDeps {
  bus: GameBus;
  floatText: FloatText;
  particles: Particles;
  /** Current reduced-motion preference (ui/accessibility). */
  reducedMotion: () => boolean;
  storage?: FxStorage | null;
  /** Source of an income category (a representative building); null = no popup. */
  locate: (category: string) => MoneySource | null;
  /** World position of a freshly placed building. */
  placedAt: (id: number, x: number, y: number) => { x: number; y: number; z: number };
  /** What the camera is looking at (confetti burst point). */
  focus: () => { x: number; y: number; z: number };
  winter: () => boolean;
  /** Plays a sound (no-op when audio is off). Gains here are final recipe gains. */
  play: (sfx: 'kaching', opts?: { gain?: number }) => void;
  /** Light camera kick (Lively only). */
  kick?: () => void;
  fmt?: (n: number) => string;
}

const INCOME_REASONS = new Set<string | undefined>([undefined, 'earn']);

/**
 * The restrained feedback layer: significant +$ popups, quiet build puffs, confetti for major milestones only. Render-side only:
 * it listens to the bus, never writes to the sim and uses its own RNG. All limits live in `feedbackPolicy`.
 */
export class Feedback {
  readonly agg = new MoneyAggregator();
  private clock = 0;
  private lastKaching = -Infinity;
  private _intensity: FeedbackIntensity;
  private offs: Array<() => void> = [];
  /** Counters for tests / the harness. */
  readonly stats = { popups: 0, puffs: 0, confetti: 0, kachings: 0 };

  get floatText(): FloatText { return this.d.floatText; }
  get particles(): Particles { return this.d.particles; }

  constructor(private d: FeedbackDeps) {
    this._intensity = loadIntensity(d.storage ?? null);
    const bus = d.bus;
    this.offs.push(bus.on('money:changed', (e) => {
      if (!(e.delta > 0) || !INCOME_REASONS.has(e.reason) || e.category === 'loan') return;
      const s = d.locate(e.category ?? 'other');
      if (s) this.agg.add(s.key, e.delta, s.x, s.z, this.clock, s.y);
      else this.agg.noteIncome(e.delta);
    }));
    this.offs.push(bus.on('day:changed', () => this.agg.rollDay()));
    this.offs.push(bus.on('building:placed', (e) => this.puff(d.placedAt(e.id, e.x, e.y))));
    this.offs.push(bus.on('milestone', (e) => this.milestone(e.major)));
  }

  get intensity(): FeedbackIntensity { return this._intensity; }
  setIntensity(v: FeedbackIntensity): void {
    this._intensity = v; saveIntensity(this.d.storage ?? null, v);
    if (v === 'off') { this.d.floatText.clear(); this.d.particles.clear(); this.agg.clear(); }
  }
  /** Effective policy (reduced motion applied). */
  /** Fast-forward: transient 'off' (nothing persisted, restored exactly); pending popups / particles are cleared. */
  private _suspended = false;
  get suspended(): boolean { return this._suspended; }
  suspend(on: boolean): void {
    if (on === this._suspended) return;
    this._suspended = on;
    if (on) { this.d.floatText.clear(); this.d.particles.clear(); this.agg.clear(); }
  }
  policy(): FeedbackPolicy { return feedbackPolicy(this._suspended ? 'off' : this._intensity, { reducedMotion: this.d.reducedMotion() }); }

  /** A quiet puff (snow in winter, dust in summer). */
  puff(at: { x: number; y: number; z: number }): boolean {
    const p = this.policy();
    if (p.puffScale <= 0) return false;
    this.d.particles.emit({ x: at.x, y: at.y, z: at.z, count: Math.round(5 + 4 * p.puffScale), kind: 'puff', scale: p.puffScale, color: this.d.winter() ? 0xf1f5fa : 0xb9aa8c });
    this.stats.puffs++;
    return true;
  }

  /** Confetti only for major milestones (and never with reduced motion / Off). Minor milestones do nothing here. */
  milestone(major: boolean): boolean {
    const p = this.policy();
    if (!confettiAllowed(p, major)) return false;
    const f = this.d.focus();
    this.d.particles.emit({ x: f.x, y: f.y + 2, z: f.z, count: 36, kind: 'confetti' });
    this.stats.confetti++;
    if (p.cameraKick) this.d.kick?.();
    return true;
  }

  /** Per rendered frame (dt seconds). */
  update(dt: number, camera: THREE.Camera): void {
    this.clock += dt;
    const p = this.policy(), ft = this.d.floatText;
    for (const pop of this.agg.flush(this.clock, p, p.maxPopups - ft.count)) {
      if (!ft.spawn(`+${(this.d.fmt ?? defaultFmt)(pop.amount)}`, pop.x, pop.y, pop.z, p)) continue;
      this.stats.popups++;
      if (this.clock - this.lastKaching >= p.kachingGapS) { this.lastKaching = this.clock; this.stats.kachings++; this.d.play('kaching', { gain: 0.4 }); }
    }
    ft.update(dt);
    this.d.particles.update(dt, camera);
  }

  /**
   * Visual-QA scene: a few significant sales + one build puff at the focus point, lingering long enough to be photographed.
   * Goes through the same policy gates as the real thing (Off => nothing at all).
   */
  demo(): { popups: number; puffs: number } {
    const p = this.policy(), f = this.d.focus(), ft = this.d.floatText;
    let popups = 0, puffs = 0;
    const amounts = [1850, 720, 4200];
    for (const [i, a] of amounts.entries()) {
      if (a < this.agg.threshold(p)) continue;
      if (ft.spawn(`+${(this.d.fmt ?? defaultFmt)(a)}`, f.x + (i - 1) * 3.2, f.y + 3, f.z + (i % 2) * 2, { ...p, popupLifeS: 8 })) popups++;
    }
    if (p.puffScale > 0) {
      this.d.particles.emit({ x: f.x + 0.5, y: f.y, z: f.z + 3, count: Math.round(5 + 4 * p.puffScale), kind: 'puff', scale: p.puffScale, color: this.d.winter() ? 0xf1f5fa : 0xb9aa8c, lifeScale: 8 });
      puffs++;
    }
    return { popups, puffs };
  }

  dispose(): void { for (const o of this.offs.splice(0)) o(); }
}
const defaultFmt = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;
