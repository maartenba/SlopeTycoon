import { describe, expect, it } from 'vitest';
import { absoluteDay, EVENT_STOPS, FastForward, ffProgress, ffTargetDay, FF_BUDGET_MS, FF_MIN_TICKS, FF_SLOW_FRAMES_MAX, type FfDeps, type FfStop } from '@/core/FastForward';
import { GAME_EVENT_NAMES, type GameEventName, type GameEvents } from '@/core/events';
import { seasonProgress } from '@/sim/Clock';
import type { GameDate } from '@/core/GameState';
import { DAYS_PER_MONTH, DAYS_PER_YEAR, TICKS_PER_DAY } from '@/config/balance';

/** Fake world: one tick = 6 game minutes; every tick costs `msPerTick` of fake wall time. */
function world(o: { msPerTick?: number; blocked?: string | null; hidden?: boolean; date?: Partial<GameDate> } = {}) {
  const date: GameDate = { year: 0, day: 0, minute: 0, tick: 0, ...o.date };
  const w = { date, clock: 0, ticks: 0, blocked: o.blocked ?? null as string | null, hidden: o.hidden ?? false, msPerTick: o.msPerTick ?? 0.5 };
  const deps: FfDeps = {
    now: () => w.clock,
    step: () => {
      w.clock += w.msPerTick; w.ticks++; date.tick++; date.minute += 6;
      if (date.minute >= 1440) { date.minute = 0; date.day++; if (date.day >= DAYS_PER_YEAR) { date.day = 0; date.year++; } }
    },
    date: () => date, blocked: () => w.blocked, hidden: () => w.hidden,
  };
  return { w, deps, ff: new FastForward(deps) };
}
const runAll = (ff: FastForward, max = 100000): number => { let f = 0; while (ff.active && f++ < max) ff.frame(); return f; };

describe('targets', () => {
  it('next month / next season land on the exact boundary day', () => {
    expect(ffTargetDay('month', { year: 0, day: 0, minute: 0 })).toBe(DAYS_PER_MONTH);
    expect(ffTargetDay('month', { year: 0, day: 14, minute: 700 })).toBe(DAYS_PER_MONTH);
    expect(ffTargetDay('month', { year: 1, day: 165, minute: 0 })).toBe(2 * DAYS_PER_YEAR);
    for (let day = 0; day < DAYS_PER_YEAR; day++) {
      const p = seasonProgress({ day });
      expect(ffTargetDay('season', { year: 0, day, minute: 0 }) - day, `day ${day}`).toBe(p.daysLeft);
    }
    expect(ffTargetDay('event', { year: 0, day: 10, minute: 0 })).toBe(10 + DAYS_PER_YEAR);
  });
  it('progress maths: fraction, days left and ETA', () => {
    const p = ffProgress('season', 100, 160, 130, 6);
    expect(p.fraction).toBeCloseTo(0.5, 9); expect(p.daysLeft).toBe(30); expect(p.etaSeconds).toBeCloseTo(5, 9);
    expect(ffProgress('month', 0, 15, 0, 0).etaSeconds).toBeNull();
    expect(ffProgress('month', 0, 15, 99, 1).fraction).toBe(1);
  });
});

describe('FastForward controller', () => {
  it('runs a month in budgeted batches: >= min ticks, <= budget (+1 tick) per frame', () => {
    const { w, ff } = world({ msPerTick: 0.5 });
    expect(ff.start('month')).toEqual({ ok: true });
    const stops: FfStop[] = []; ff.onStop((s) => stops.push(s));
    const n = ff.frame();
    expect(n).toBeGreaterThanOrEqual(FF_MIN_TICKS);
    expect(n).toBeLessThanOrEqual(Math.ceil(FF_BUDGET_MS / 0.5) + 1);
    runAll(ff);
    expect(w.ticks).toBe(DAYS_PER_MONTH * TICKS_PER_DAY);
    expect(stops).toHaveLength(1); expect(stops[0]!.reason).toBe('target'); expect(Math.round(stops[0]!.days)).toBe(DAYS_PER_MONTH);
  });
  it('always runs at least the minimum ticks even when ticks are very slow, then reports slow after a streak', () => {
    const { ff } = world({ msPerTick: 40 });
    const stops: FfStop[] = []; ff.onStop((s) => stops.push(s));
    ff.start('season');
    expect(ff.frame()).toBe(FF_MIN_TICKS);
    for (let i = 0; i < FF_SLOW_FRAMES_MAX + 2 && ff.active; i++) ff.frame();
    expect(stops.map((s) => s.reason)).toEqual(['slow']);
  });
  it('a stop-class event ends the run after the current tick; routine events do not', () => {
    const { w, ff } = world();
    ff.start('season');
    ff.frame();
    ff.notify('guest:arrived', { id: 1 }); ff.notify('month:changed', { year: 0, month: 1 });
    expect(ff.active).toBe(true);
    const before = w.ticks;
    ff.notify('finance:bankruptcyWarning', { money: -1, daysLeft: 5 });
    const stops: FfStop[] = []; ff.onStop((s) => stops.push(s));
    ff.frame();
    expect(ff.active).toBe(false); expect(w.ticks).toBe(before); // stopped before the next tick
    expect(stops[0]).toMatchObject({ reason: 'event', detail: 'a bankruptcy warning' });
  });
  it('an event raised during a tick (inside the batch) stops within that frame', () => {
    const { deps, ff } = world();
    let n = 0; const orig = deps.step;
    deps.step = () => { orig(); if (++n === 7) ff.notify('year:report', { year: 0 }); };
    ff.start('event');
    const stops: FfStop[] = []; ff.onStop((s) => stops.push(s));
    ff.frame();
    expect(n).toBe(7); expect(stops[0]!.reason).toBe('event');
  });
  it("'event' mode ends by itself after a quiet year", () => {
    const { w, ff } = world({ msPerTick: 0.05 });
    const stops: FfStop[] = []; ff.onStop((s) => stops.push(s));
    ff.start('event'); runAll(ff);
    expect(stops[0]!.reason).toBe('limit'); expect(w.ticks).toBe(DAYS_PER_YEAR * TICKS_PER_DAY);
  });
  it('cancel stops immediately and is idempotent', () => {
    const { w, ff } = world();
    const stops: FfStop[] = []; ff.onStop((s) => stops.push(s));
    ff.start('month'); ff.frame(); const t = w.ticks;
    ff.cancel(); ff.cancel();
    expect(ff.active).toBe(false); expect(stops).toHaveLength(1); expect(stops[0]!.reason).toBe('cancel');
    expect(ff.frame()).toBe(0); expect(w.ticks).toBe(t);
  });
  it('refuses to start in blocked contexts and when already running (no double start)', () => {
    const b = world({ blocked: 'Not available in ride-along, walk or photo mode' });
    expect(b.ff.start('month')).toEqual({ ok: false, reason: 'Not available in ride-along, walk or photo mode' });
    expect(b.ff.active).toBe(false);
    const { ff } = world();
    expect(ff.start('month').ok).toBe(true);
    expect(ff.start('season')).toEqual({ ok: false, reason: 'Already fast-forwarding' });
    expect(ff.currentKind).toBe('month');
  });
  it('stops when the context becomes blocked mid-run (modal opens, ride starts, game over)', () => {
    const { w, ff } = world();
    const stops: FfStop[] = []; ff.onStop((s) => stops.push(s));
    ff.start('season'); ff.frame();
    w.blocked = 'Close the open dialog first';
    const t = w.ticks; ff.frame();
    expect(w.ticks).toBe(t); expect(stops[0]).toMatchObject({ reason: 'blocked', detail: 'Close the open dialog first' });
  });
  it('a hidden tab pauses (no ticks, no stop, no catch-up) and resumes', () => {
    const { w, ff } = world();
    ff.start('month'); ff.frame();
    w.hidden = true; const t = w.ticks;
    for (let i = 0; i < 20; i++) expect(ff.frame()).toBe(0);
    expect(w.ticks).toBe(t); expect(ff.active).toBe(true);
    w.hidden = false;
    expect(ff.frame()).toBeGreaterThan(0);
  });
  it('progress() is live and null when idle', () => {
    const { ff } = world({ msPerTick: 0.5 });
    expect(ff.progress()).toBeNull();
    ff.start('month'); ff.frame(); ff.frame();
    const p = ff.progress()!;
    expect(p.fraction).toBeGreaterThan(0); expect(p.fraction).toBeLessThan(1);
    expect(p.daysLeft).toBeCloseTo(DAYS_PER_MONTH - (absoluteDay({ year: 0, day: 0, minute: 0 }) + p.day), 5);
    expect(p.daysPerSecond).toBeGreaterThan(0); expect(p.etaSeconds).not.toBeNull();
  });
});

describe('event -> stop mapping covers every GameEvent', () => {
  it('has an entry for every event name (compile-time + runtime)', () => {
    for (const n of GAME_EVENT_NAMES) expect(typeof EVENT_STOPS[n], n).toBe('function');
    expect(Object.keys(EVENT_STOPS).sort()).toEqual([...GAME_EVENT_NAMES].sort());
  });
  const stop = <K extends GameEventName>(n: K, p: GameEvents[K]): string | null => (EVENT_STOPS[n] as (p: GameEvents[K]) => string | null)(p);
  it('important / critical events stop', () => {
    expect(stop('year:report', { year: 1 })).toBeTruthy();
    expect(stop('scenario:finished', { id: 'a', result: 'won', medal: 'gold', score: 1, reason: '' })).toBeTruthy();
    expect(stop('finance:bankruptcyWarning', { money: -5, daysLeft: 3 })).toBeTruthy();
    expect(stop('finance:debtWarning', { money: -5, negDays: 8, level: 2 })).toBeTruthy();
    expect(stop('finance:bankrupt', { money: -5, day: 3 })).toBeTruthy();
    expect(stop('finance:declaredBankrupt', { money: -5, day: 3, reason: 'auto' })).toBeTruthy();
    expect(stop('incident:created', { id: 1, kind: 'buried', severity: 2, x: 0, y: 0, guestId: 1 })).toBeTruthy();
    expect(stop('incident:avalanche', { x: 0, y: 0, severity: 1, buried: 2 })).toBeTruthy();
    expect(stop('incident:stranded', { liftId: 1, guests: 3, x: 0, y: 0 })).toBeTruthy();
    expect(stop('lift:broken', { id: 1, kind: 'chair', stranded: 4 })).toBeTruthy();
    expect(stop('milestone', { id: 'level-4', title: 'Level 4', major: true })).toBeTruthy();
    expect(stop('incident:escalated', { id: 1, to: 'heli' })).toBeTruthy();
  });
  it('routine events never stop', () => {
    expect(stop('milestone', { id: 'x', title: 'x', major: false })).toBeNull();
    expect(stop('incident:avalanche', { x: 0, y: 0, severity: 1, buried: 0, controlled: true })).toBeNull();
    expect(stop('lift:broken', { id: 1, kind: 'chair', stranded: 0 })).toBeNull();
    expect(stop('incident:created', { id: 1, kind: 'injury', severity: 0, x: 0, y: 0, guestId: 1 })).toBeNull();
    for (const n of ['guest:arrived', 'guest:left', 'money:changed', 'weather:changed', 'month:changed', 'season:changed', 'day:changed', 'finance:monthClosed', 'rating:changed', 'time:hour'] as const) expect(EVENT_STOPS[n](undefined as never), n).toBeNull();
  });
});
