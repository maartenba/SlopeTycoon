import type { GameEventName, GameEvents } from './events';
import type { GameDate } from './GameState';
import { DAYS_PER_MONTH, DAYS_PER_YEAR, SEASON_MONTHS } from '../config/balance';

/**
 * Fast-forward ("Skip to ..."): a main-loop controller that runs as many FIXED sim ticks per animation frame as fit a time budget instead of the
 * TickLoop's real-time pacing. It only changes how many ticks run per frame, never what a tick does, so N ticks via fast-forward leave the exact
 * same state as N ticks at normal speed (tests/core/FastForward.test.ts). Pure logic: the clock, the stepper and the context checks are injected.
 */
export type FfKind = 'month' | 'season' | 'event';
export const FF_KINDS: readonly FfKind[] = ['month', 'season', 'event'];
export const FF_LABELS: Record<FfKind, string> = { month: 'Next month', season: 'Next season', event: 'Next event' };
export type FfStopReason = 'target' | 'event' | 'cancel' | 'slow' | 'blocked' | 'limit';

/** Time budget per animation frame (ms) and the minimum ticks per frame (always run, so progress never stalls). */
export const FF_BUDGET_MS = 11;
export const FF_MIN_TICKS = 4;
/** A frame whose min-tick batch alone took longer than this counts as slow; this many in a row stops fast-forward gracefully. */
export const FF_SLOW_FRAME_MS = 80;
export const FF_SLOW_FRAMES_MAX = 25;
/** 'Next event' gives up after this many days (about a year) so it always ends. */
export const FF_EVENT_MAX_DAYS = DAYS_PER_YEAR;

/** Absolute game day (fractional) of a date: year * 180 + day + minute fraction. */
export const absoluteDay = (d: Pick<GameDate, 'year' | 'day' | 'minute'>): number => d.year * DAYS_PER_YEAR + d.day + d.minute / 1440;

/** Absolute (whole) day a skip kind ends on: the first day of the next month / season; 'event' = a one-year cap. */
export function ffTargetDay(kind: FfKind, d: Pick<GameDate, 'year' | 'day' | 'minute'>): number {
  const abs = d.year * DAYS_PER_YEAR + d.day;
  if (kind === 'month') return abs - (d.day % DAYS_PER_MONTH) + DAYS_PER_MONTH;
  if (kind === 'season') {
    let start = 0;
    for (const m of SEASON_MONTHS) {
      const end = start + m * DAYS_PER_MONTH;
      if (d.day < end) return d.year * DAYS_PER_YEAR + end;
      start = end;
    }
    return (d.year + 1) * DAYS_PER_YEAR;
  }
  return abs + FF_EVENT_MAX_DAYS;
}

/** Why a stop reads on the toast. */
export const FF_STOP_TEXT: Record<FfStopReason, string> = {
  target: 'Fast-forward finished', event: 'Fast-forward stopped', cancel: 'Fast-forward cancelled',
  slow: 'Fast-forward stopped: this resort is too heavy to skip quickly', blocked: 'Fast-forward stopped', limit: 'Fast-forward stopped: nothing important happened for a year',
};

/** Event -> stop decision. `null` = routine. Typed as a full mapped type so a new GameEvent cannot be forgotten (compile error). */
type Stopper<K extends GameEventName> = (p: GameEvents[K]) => string | null;
const never = (): null => null;
const always = (why: string) => (): string => why;
export const EVENT_STOPS: { [K in GameEventName]: Stopper<K> } = {
  'guest:arrived': never, 'guest:left': never, 'guest:review': never, 'story:resolved': never, 'building:placed': never, 'building:removed': never, 'path:drawn': never, 'piste:painted': never,
  'lift:built': never, 'lift:opened': never, 'lift:closed': never, 'attraction:opened': never, 'attraction:closed': never, 'weather:changed': never, 'piste:opened': never,
  'money:changed': never, 'loan:taken': never, 'speed:changed': never, 'season:changed': never,
  'incident:avalanche': (p) => (p.buried && p.buried > 0 && !p.controlled ? 'an avalanche caught guests' : null),
  'incident:wildlife': (p) => (p.outcome === 'attack' ? 'a wildlife attack' : null),
  'wildlife:scare': never, 'wildlife:hazed': never, 'wildlife:relocated': never, 'ops:grooming': never,
  'incident:injury': never,
  'incident:created': (p) => (p.severity >= 2 ? 'a critical incident' : null),
  'incident:resolved': never,
  'incident:escalated': always('a helicopter call-out'),
  'finance:bankruptcyWarning': always('a bankruptcy warning'),
  'finance:bankrupt': always('bankruptcy'),
  'finance:debtWarning': always('you are in debt'),
  'finance:declaredBankrupt': always('bankruptcy'),
  'lift:broken': (p) => (p.stranded > 0 ? 'a lift broke down with guests stranded' : null),
  'lift:repaired': never,
  'incident:stranded': always('guests are stranded on a lift'),
  'ops:schedule': never, 'finance:monthClosed': never, 'rating:changed': never, 'day:changed': never, 'month:changed': never, 'year:changed': never,
  'year:report': always('the year report is ready'),
  'time:hour': never, 'family:dropoff': never, 'family:regroup': never, 'lesson:started': never, 'lesson:finished': never,
  'marketing:started': never, 'marketing:ended': never, 'marketing:cancelled': never,
  'milestone': (p) => (p.major ? p.title : null),
  'scenario:objective': never,
  'scenario:finished': always('the scenario ended'),
};

export interface FfDeps {
  /** Monotonic milliseconds. */
  now(): number;
  /** Run exactly one fixed sim tick (TickLoop.stepOnce). */
  step(): void;
  date(): GameDate;
  /** Why fast-forward must not run right now (ride / walk / photo / tutorial / title demo / modal / game over), or null. */
  blocked(): string | null;
  hidden(): boolean;
}

export interface FfProgress {
  kind: FfKind; startDay: number; targetDay: number; day: number;
  /** 0..1 */
  fraction: number; daysLeft: number;
  /** Seconds left at the measured days/s (null until measured). */
  etaSeconds: number | null; daysPerSecond: number;
}

export interface FfStop { reason: FfStopReason; kind: FfKind; /** Short human cause for the toast (event reason / blocked reason). */ detail: string; days: number }

/** Progress maths (pure): fraction, days left and ETA at a measured days-per-second. */
export function ffProgress(kind: FfKind, startDay: number, targetDay: number, day: number, daysPerSecond: number): FfProgress {
  const span = Math.max(1e-9, targetDay - startDay);
  const done = Math.min(span, Math.max(0, day - startDay));
  const daysLeft = Math.max(0, targetDay - day);
  return { kind, startDay, targetDay, day, fraction: done / span, daysLeft, etaSeconds: daysPerSecond > 0.05 ? daysLeft / daysPerSecond : null, daysPerSecond };
}

export class FastForward {
  private _active = false;
  private kind: FfKind = 'month';
  private startDay = 0;
  private targetDay = 0;
  private pending: { reason: FfStopReason; detail: string } | null = null;
  private slowFrames = 0;
  private realMs = 0;
  private dayAtStart = 0;
  /** Days per real second over the run so far (ETA / diagnostics). */
  private dps = 0;
  /** Ticks run by the current / last run. */
  ticksRun = 0;
  budgetMs = FF_BUDGET_MS;
  minTicks = FF_MIN_TICKS;
  private stopCbs = new Set<(s: FfStop) => void>();
  private startCbs = new Set<(k: FfKind) => void>();
  last: FfStop | null = null;

  constructor(private d: FfDeps) {}

  get active(): boolean { return this._active; }
  get currentKind(): FfKind | null { return this._active ? this.kind : null; }
  get daysPerSecond(): number { return this.dps; }
  onStop(cb: (s: FfStop) => void): () => void { this.stopCbs.add(cb); return () => this.stopCbs.delete(cb); }
  onStart(cb: (k: FfKind) => void): () => void { this.startCbs.add(cb); return () => this.startCbs.delete(cb); }

  /** Can a run start now? `null` = yes. */
  canStart(): string | null { return this._active ? 'Already fast-forwarding' : this.d.blocked(); }

  /** Begin a run. Refuses (returns the reason) when blocked or already running: no double start. */
  start(kind: FfKind): { ok: true } | { ok: false; reason: string } {
    const why = this.canStart();
    if (why) return { ok: false, reason: why };
    const date = this.d.date();
    this._active = true; this.kind = kind; this.pending = null; this.slowFrames = 0; this.realMs = 0; this.ticksRun = 0; this.dps = 0;
    this.startDay = absoluteDay(date); this.dayAtStart = this.startDay;
    this.targetDay = ffTargetDay(kind, date);
    for (const cb of [...this.startCbs]) cb(kind);
    return { ok: true };
  }

  cancel(): void { if (this._active) this.finish('cancel', ''); }

  /** Feed a game event; a stop-class event ends the run at the end of the current tick. */
  notify<K extends GameEventName>(name: K, payload: GameEvents[K]): void {
    if (!this._active || this.pending) return;
    const why = (EVENT_STOPS[name] as Stopper<K>)(payload);
    if (why) this.pending = { reason: 'event', detail: why };
  }

  /** Live progress (null when idle). */
  progress(): FfProgress | null {
    return this._active ? ffProgress(this.kind, this.startDay, this.targetDay, absoluteDay(this.d.date()), this.dps) : null;
  }

  private finish(reason: FfStopReason, detail: string): void {
    if (!this._active) return;
    this._active = false;
    const s: FfStop = { reason, kind: this.kind, detail, days: Math.max(0, absoluteDay(this.d.date()) - this.dayAtStart) };
    this.last = s; this.pending = null;
    for (const cb of [...this.stopCbs]) cb(s);
  }

  /** Call once per animation frame INSTEAD of TickLoop.advance while active. Returns ticks run. */
  frame(): number {
    if (!this._active) return 0;
    const blocked = this.d.blocked();
    if (blocked) { this.finish('blocked', blocked); return 0; }
    if (this.d.hidden()) return 0; // paused while the tab is hidden (no stop, no catch-up on return)
    const t0 = this.d.now();
    let n = 0, slowCheckAt = 0;
    while (this._active) {
      if (this.pending) { const p = this.pending; this.finish(p.reason, p.detail); break; }
      if (absoluteDay(this.d.date()) >= this.targetDay - 1e-9) { this.finish(this.kind === 'event' ? 'limit' : 'target', ''); break; }
      this.d.step(); n++;
      if (n === this.minTicks) slowCheckAt = this.d.now() - t0;
      if (n >= this.minTicks && this.d.now() - t0 >= this.budgetMs) break;
    }
    if (this._active && this.pending) { const p = this.pending; this.finish(p.reason, p.detail); } // event from the batch's last tick
    this.ticksRun += n;
    const ms = this.d.now() - t0;
    if (n > 0 && ms > 0) {
      this.realMs += ms;
      this.dps = ((absoluteDay(this.d.date()) - this.dayAtStart) / Math.max(1, this.realMs)) * 1000;
    }
    if (this._active) {
      if (n >= this.minTicks && slowCheckAt > FF_SLOW_FRAME_MS) { if (++this.slowFrames >= FF_SLOW_FRAMES_MAX) this.finish('slow', ''); } else this.slowFrames = 0;
    }
    return n;
  }
}
