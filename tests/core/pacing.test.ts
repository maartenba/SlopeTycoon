import { describe, expect, it } from 'vitest';
import { TickLoop } from '@/core/TickLoop';
import { NIGHT_WARP_MAX, nightWarp, warpIndicator } from '@/core/pacing';
import { createGameState, type GameState } from '@/core/GameState';
import { hourOfDay } from '@/sim/Clock';
import { createDefaultRegistry, stateHash, type SimSystem } from '@/sim/Systems';
import { TICKS_PER_DAY, REAL_SECONDS_PER_DAY_1X } from '@/config/balance';

const STEP = REAL_SECONDS_PER_DAY_1X / TICKS_PER_DAY;

describe('nightWarp (pure)', () => {
  it('is x1 at midday and the x3 plateau at night', () => {
    for (const h of [6.5, 8, 12, 16, 20, 20.5]) expect(nightWarp(h), String(h)).toBe(1);
    for (const h of [21.5, 22, 0, 2, 4, 5.5]) expect(nightWarp(h), String(h)).toBe(NIGHT_WARP_MAX);
  });
  it('is >= 1, <= cap and continuous (also across 24h)', () => {
    let prev = nightWarp(0);
    for (let h = 0.001; h <= 48; h += 0.001) {
      const w = nightWarp(h);
      expect(w).toBeGreaterThanOrEqual(1);
      expect(w).toBeLessThanOrEqual(NIGHT_WARP_MAX);
      expect(Math.abs(w - prev)).toBeLessThan(0.01);
      prev = w;
    }
    expect(nightWarp(24)).toBeCloseTo(nightWarp(0), 12);
    expect(nightWarp(-1)).toBeCloseTo(nightWarp(23), 12);
  });
  it('eases in over dusk and out over dawn', () => {
    expect(nightWarp(21)).toBeGreaterThan(1.5);
    expect(nightWarp(21)).toBeLessThan(2.5);
    expect(nightWarp(6)).toBeGreaterThan(1.5);
    expect(nightWarp(6)).toBeLessThan(2.5);
  });
  it('formats the HUD indicator', () => {
    expect(warpIndicator(1)).toBe('');
    expect(warpIndicator(1.04)).toBe('');
    expect(warpIndicator(2)).toBe('🌙»');
    expect(warpIndicator(3)).toBe('🌙»»');
  });
});

describe('TickLoop with fast nights', () => {
  const mk = (hour: number, fast = true): { loop: TickLoop; n: () => number } => {
    let n = 0;
    const loop = new TickLoop({ visibility: null, maxCatchUp: 100000, onTick: () => { n++; }, warp: () => nightWarp(hour) });
    loop.fastNights = fast;
    return { loop, n: () => n };
  };
  it('runs x3 faster at night, x1 at midday, x1 when disabled, nothing when paused', () => {
    const night = mk(0), day = mk(12), off = mk(0, false), paused = mk(0);
    night.loop.advance(STEP * 10); day.loop.advance(STEP * 10); off.loop.advance(STEP * 10);
    paused.loop.setSpeed(0); paused.loop.advance(100);
    expect([night.n(), day.n(), off.n(), paused.n()]).toEqual([30, 10, 10, 0]);
  });
  it('respects the catch-up cap', () => {
    let n = 0;
    const loop = new TickLoop({ visibility: null, maxCatchUp: 5, onTick: () => { n++; }, warp: () => 3 });
    loop.advance(100);
    expect(n).toBe(5);
  });
  it('a game night passes ~3x faster in real time', () => {
    const state = createGameState(1, 64);
    state.date.minute = 22 * 60;
    const loop = new TickLoop({ visibility: null, maxCatchUp: 1e6, onTick: () => { state.date.minute += 6; }, warp: () => nightWarp(hourOfDay(state.date)) });
    let real = 0;
    while (state.date.minute < 24 * 60 && real < 1000) { loop.advance(0.01); real += 0.01; }
    const twoHours = 20 * STEP; // 20 ticks = 2 game hours at x1
    expect(real).toBeLessThan(twoHours / 2.9);
    expect(real).toBeGreaterThan(twoHours / 3.1);
  });

  const mkSystem = (): SimSystem => {
    let h = 17;
    return { id: 'guests', update: (s: GameState, tick: number) => { h = (h * 31 + tick) >>> 0; s.date.minute += 6; if (s.date.minute >= 1440) { s.date.minute = 0; s.date.day++; } }, hash: () => h } as unknown as SimSystem;
  };
  /** State hash at tick N for a frame sequence (state depends only on ticks, never on frame timing or warp). */
  const hashAt = (N: number, dts: () => Iterable<number>, warp: boolean): string => {
    const state = createGameState(5, 64);
    state.date.minute = 19 * 60; // runs through dusk and night
    const reg = createDefaultRegistry();
    reg.replace(mkSystem());
    let out = '';
    const loop = new TickLoop({
      visibility: null, maxCatchUp: 1e6, warp: () => nightWarp(hourOfDay(state.date)),
      onTick: (t) => { reg.update(state, t); if (t === N) out = stateHash(state, reg); },
    });
    loop.fastNights = warp;
    for (const dt of dts()) { loop.advance(dt); if (out) break; }
    return out;
  };
  it('is deterministic: same state after N ticks with/without warp, 1 big dt or many small', () => {
    const N = 120;
    const big = hashAt(N, () => [1000], true);
    const small = hashAt(N, function* () { for (let i = 0; i < 100000; i++) yield 0.013; }, true);
    const noWarp = hashAt(N, () => [1000], false);
    const noWarpSmall = hashAt(N, function* () { for (let i = 0; i < 100000; i++) yield 0.07; }, false);
    expect(big).not.toBe('');
    expect(small).toBe(big);
    expect(noWarp).toBe(big);
    expect(noWarpSmall).toBe(big);
  });
});

import { sunTimes, nightWindow } from '@/sim/Daylight';
import { DAYLIGHT } from '@/config/balance';

describe('nightWarp aligned to the actual night (sunset + 45 min .. sunrise - 45 min)', () => {
  for (const [name, day] of [['winter solstice', DAYLIGHT.winterSolsticeDay], ['summer solstice', DAYLIGHT.summerSolsticeDay], ['spring equinox', 30]] as const) {
    it(`${name}: 1x in daylight and through dusk, full warp in the dark, back to 1x by sunrise - 45 min; continuous`, () => {
      const sun = sunTimes(day), win = nightWindow(day);
      for (const h of [sun.sunrise + 0.1, 12, sun.sunset - 0.5, sun.sunset, sun.sunset + 0.7]) expect(nightWarp(h, sun), `${name} ${h}`).toBe(1);
      for (const h of [win.start + 1.1, 0, 1.5, win.end - 24 - 1.1]) { if (h > win.start + 1 || h < win.end - 24 - 1) expect(nightWarp(h, sun), `${name} ${h}`).toBe(NIGHT_WARP_MAX); }
      expect(nightWarp(sun.sunrise - 0.75, sun)).toBe(1);
      expect(nightWarp(sun.sunrise, sun)).toBe(1);
      let prev = nightWarp(0, sun);
      for (let h = 0; h <= 24.0001; h += 0.01) { const w = nightWarp(h, sun); expect(Math.abs(w - prev)).toBeLessThan(0.08); prev = w; }
      expect(nightWarp(24, sun)).toBeCloseTo(nightWarp(0, sun), 12);
    });
  }
  it('summer nights are short and winter nights long, both warped', () => {
    const warped = (day: number): number => { const s = sunTimes(day); let n = 0; for (let h = 0; h < 24; h += 0.05) if (nightWarp(h, s) > 1.5) n += 0.05; return n; };
    expect(warped(DAYLIGHT.summerSolsticeDay)).toBeGreaterThan(2);
    expect(warped(DAYLIGHT.summerSolsticeDay)).toBeLessThan(warped(DAYLIGHT.winterSolsticeDay) - 4);
  });
  it('without sun times the legacy hours still apply', () => { expect(nightWarp(2)).toBe(NIGHT_WARP_MAX); expect(nightWarp(12)).toBe(1); });
});
