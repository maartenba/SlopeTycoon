import type { GameBus, Speed } from './events';
import { MAX_CATCHUP_STEPS, SPEED_MULTIPLIERS, TICKS_PER_SECOND } from '../config/balance';

export interface VisibilitySource {
  isHidden(): boolean;
  /** Subscribe to changes; returns unsubscribe. */
  subscribe(cb: () => void): () => void;
}

export function documentVisibility(): VisibilitySource | null {
  if (typeof document === 'undefined') return null;
  return {
    isHidden: () => document.hidden,
    subscribe: (cb) => { document.addEventListener('visibilitychange', cb); return () => document.removeEventListener('visibilitychange', cb); },
  };
}

export interface TickLoopOptions {
  /** Called once per fixed step with the new tick count. */
  onTick: (tick: number) => void;
  bus?: Pick<GameBus, 'emit'>;
  stepSeconds?: number;
  maxCatchUp?: number;
  /** null = ignore visibility. Defaults to the document. */
  visibility?: VisibilitySource | null;
  /** Optional pacing time-scale (>= 1), evaluated from sim state before every tick (e.g. fast nights). Real-time only: never touches the sim. */
  warp?: () => number;
}

const EPS = 1e-9;
const MAX_WARP = 4;

/** Fixed-step accumulator loop. Speed 0 = paused (no ticks); hidden tab = paused without a time jump on resume. */
export class TickLoop {
  readonly step: number;
  readonly maxCatchUp: number;
  /** Accumulated REAL seconds toward the next tick. */
  private acc = 0;
  /** Current pacing warp (diagnostics/HUD). */
  currentWarp = 1;
  /** Setting 'Fast nights': when false the warp option is ignored. */
  fastNights = true;
  /** Pacing multiplier of the tick rate (default 1; the title-screen demo uses < 1 for a ~100 s day). Real-time only: never touches the sim. */
  timeScale = 1;
  private ticks = 0;
  private _speed: Speed = 1;
  private lastRunning: Speed = 1;
  private hidden = false;
  private unsub: (() => void) | null = null;
  /** Fixed steps dropped by the catch-up cap (diagnostics). */
  droppedBacklog = 0;

  constructor(private o: TickLoopOptions) {
    this.step = o.stepSeconds ?? 1 / TICKS_PER_SECOND;
    this.maxCatchUp = o.maxCatchUp ?? MAX_CATCHUP_STEPS;
    const vis = o.visibility === undefined ? documentVisibility() : o.visibility;
    if (vis) {
      this.hidden = vis.isHidden();
      this.unsub = vis.subscribe(() => {
        this.hidden = vis.isHidden();
        this.acc = 0; // resume without a time jump
      });
    }
  }

  get speed(): Speed { return this._speed; }
  get tickCount(): number { return this.ticks; }
  get paused(): boolean { return this._speed === 0; }
  get isHidden(): boolean { return this.hidden; }
  /** Render interpolation factor 0..1 between the last and next tick. */
  get alpha(): number { return Math.min(1, Math.max(0, this.acc / this.cost())); }

  /** Real seconds one tick takes at the current speed and warp. */
  private cost(): number {
    const w = this.o.warp && this.fastNights ? this.o.warp() : 1;
    this.currentWarp = Math.min(MAX_WARP, Math.max(1, Number.isFinite(w) ? w : 1));
    return this.step / (SPEED_MULTIPLIERS[this._speed]! * this.currentWarp * Math.max(0.01, this.timeScale));
  }

  setSpeed(s: Speed): void {
    if (s === this._speed) return;
    const previous = this._speed;
    this._speed = s;
    if (s > 0) this.lastRunning = s;
    else this.acc = 0;
    this.o.bus?.emit('speed:changed', { speed: s, previous });
  }

  togglePause(): void { this.setSpeed(this._speed === 0 ? this.lastRunning : 0); }

  /** Step speed up/down (clamped to 1..3 while running; slower from 1× pauses). */
  changeSpeed(delta: 1 | -1): void {
    const next = Math.min(3, Math.max(0, this._speed + delta)) as Speed;
    this.setSpeed(next);
  }

  /** Feed real elapsed seconds; runs 0..maxCatchUp fixed steps. Returns steps run. */
  advance(dtSeconds: number): number {
    if (this.hidden || this._speed === 0 || !(dtSeconds > 0)) return 0;
    this.acc += dtSeconds;
    let n = 0;
    let c = this.cost();
    while (this.acc >= c - EPS && n < this.maxCatchUp) {
      this.acc -= c;
      this.ticks++;
      n++;
      this.o.onTick(this.ticks);
      c = this.cost(); // warp follows the (new) sim hour
    }
    if (this.acc < 0) this.acc = 0;
    if (this.acc >= c - EPS) { this.droppedBacklog += Math.floor((this.acc + EPS) / c); this.acc = 0; }
    return n;
  }

  /**
   * Run exactly ONE fixed tick right now, ignoring pause / visibility / real-time pacing (fast-forward). The same onTick path as `advance`,
   * so N ticks via this method leave the identical sim state as N ticks via `advance` (tests/core/FastForward.test.ts).
   */
  stepOnce(): number {
    this.ticks++;
    this.o.onTick(this.ticks);
    this.acc = 0;
    return this.ticks;
  }

  /** Persistence: tick count and speed (accumulator is intentionally excluded). */
  serialize(): { tick: number; speed: Speed } { return { tick: this.ticks, speed: this._speed }; }
  load(d: { tick: number; speed: Speed }): void { this.ticks = d.tick; this._speed = d.speed; if (d.speed > 0) this.lastRunning = d.speed; this.acc = 0; }

  dispose(): void { this.unsub?.(); this.unsub = null; }
}
