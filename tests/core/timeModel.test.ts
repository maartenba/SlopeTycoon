import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  CAL, DAYS_PER_MONTH, DAYS_PER_YEAR, REAL_SECONDS_PER_DAY_1X, SEASON_MONTHS, SNOWLINE_KEYS, SPEED_MULTIPLIERS, TICKS_PER_DAY, TICKS_PER_SECOND, WALK_SPEED_BY_SIZE,
  NAV_SPEED, walkSizeScale, walkSpeedFor, oldDays, snowlineFraction,
} from '../../src/config/balance';
import { nightWarp, realMinutesForDays, realSecondsForDays, seasonRealMinutes } from '../../src/core/pacing';
import { TickLoop } from '../../src/core/TickLoop';
import { easeRideFactor, rideTimeFactor, RIDE_MIN_TIME_SCALE, RIDE_TARGET_TILES_PER_S } from '../../src/render/view/RideAlong';
import { GAIT_RATE, GuestRenderer, GUEST_IMPOSTOR_MIN_SPEED, useGuestImpostor } from '../../src/render/GuestRenderer';
import { maxChordDeviation, pathPoint } from '../../src/render/guestPath';
import { chaseK } from '../../src/render/chase';
import { Gear } from '../../src/render/guestAppearance';
import { GState, GuestStore, WP_MAX } from '../../src/sim/guests/Guest';
import { NavMode } from '../../src/sim/guests/NavGraph';
import { VEHICLE_SPEED } from '../../src/sim/guests/Arrivals';
import { seasonOf } from '../../src/sim/Clock';

describe('time model constants (150 s day, [0,1,3,8], 15-day months)', () => {
  it('pacing', () => {
    expect(REAL_SECONDS_PER_DAY_1X).toBe(150);
    expect(TICKS_PER_SECOND).toBeCloseTo(1.6, 9);
    expect([...SPEED_MULTIPLIERS]).toEqual([0, 1, 3, 10]);
    expect(REAL_SECONDS_PER_DAY_1X / SPEED_MULTIPLIERS[2]!).toBeCloseTo(50, 9);
    expect(REAL_SECONDS_PER_DAY_1X / SPEED_MULTIPLIERS[3]!).toBeCloseTo(15, 9);
    expect(TICKS_PER_DAY).toBe(240);
  });
  it('calendar: 15-day months, 180-day year, seasons 30 / 60 / 30 / 60 days (spring, summer, autumn, winter)', () => {
    expect(DAYS_PER_MONTH).toBe(15); expect(DAYS_PER_YEAR).toBe(180); expect(CAL).toBe(0.5);
    expect(SEASON_MONTHS.map((m) => m * DAYS_PER_MONTH)).toEqual([30, 60, 30, 60]);
    expect(seasonOf({ day: 29 })).toBe('spring'); expect(seasonOf({ day: 30 })).toBe('summer'); expect(seasonOf({ day: 89 })).toBe('summer');
    expect(seasonOf({ day: 90 })).toBe('autumn'); expect(seasonOf({ day: 120 })).toBe('winter'); expect(seasonOf({ day: 179 })).toBe('winter');
  });
  it('day-keyed curves keep their shape by year fraction (snowline keys are authored in old days x CAL)', () => {
    expect(SNOWLINE_KEYS[SNOWLINE_KEYS.length - 1]![0]).toBe(180);
    expect(snowlineFraction(oldDays(60))).toBeCloseTo(0.95, 9); expect(snowlineFraction(oldDays(130))).toBeCloseTo(1.3, 9); expect(snowlineFraction(oldDays(300))).toBeCloseTo(-0.4, 9);
  });
  it('walk speed per map size: 2.5 / 3.4 / 5.0 tiles per tick (4 / 5.5 / 8 tiles/s at 1x), interpolated for odd sizes', () => {
    expect(walkSpeedFor(64)).toBeCloseTo(2.5, 9); expect(walkSpeedFor(128)).toBeCloseTo(3.4, 9); expect(walkSpeedFor(256)).toBeCloseTo(5, 9);
    expect(WALK_SPEED_BY_SIZE[64]! * TICKS_PER_SECOND).toBeCloseTo(4, 9); expect(WALK_SPEED_BY_SIZE[256]! * TICKS_PER_SECOND).toBeCloseTo(8, 9);
    expect(walkSizeScale(128)).toBe(1); expect(walkSpeedFor(96)).toBeGreaterThan(2.5); expect(walkSpeedFor(96)).toBeLessThan(3.4);
  });
  it('per-tick speeds from the time-flow table', () => {
    expect(NAV_SPEED).toMatchObject({ hike: 1.9, bike: 3.1, skiBase: 6.25, skiFlat: 1.4 });
    expect([...VEHICLE_SPEED]).toEqual([5, 3.75, 7.5, 12.5]);
  });
  it('a TickLoop at 1x runs 1.6 ticks/s, at 10x 16 ticks/s; night warp stays x3', () => {
    for (const [speed, tps] of [[1, 1.6], [2, 4.8], [3, 16]] as const) {
      const loop = new TickLoop({ visibility: null, maxCatchUp: 100000, onTick: () => {} });
      loop.setSpeed(speed);
      expect(loop.advance(10)).toBe(Math.floor(tps * 10 + 1e-9));
    }
    expect(nightWarp(2)).toBe(3);
  });
});

describe('seasons are reachable in reasonable real time', () => {
  it('real minutes per season at each speed button (no fast nights = worst case)', () => {
    const t = [1, 2, 3].map((s) => seasonRealMinutes(s));
    // 1x: winter 150 min, year 7.5 h; 3x: winter 50, year 150; 10x: winter 15, year 45
    expect(t[0]!.winter).toBeCloseTo(150, 6); expect(t[0]!.year).toBeCloseTo(450, 6);
    expect(t[1]!.winter).toBeCloseTo(50, 6); expect(t[1]!.summer).toBeCloseTo(50, 6); expect(t[1]!.spring).toBeCloseTo(25, 6);
    expect(t[2]!.winter).toBeCloseTo(15, 6); expect(t[2]!.year).toBeCloseTo(45, 6); expect(t[2]!.spring).toBeCloseTo(7.5, 6);
    expect(t[2]!.winter).toBeLessThanOrEqual(25); // acceptance: winter <= 25 min at the fastest button
    expect(t[2]!.spring + t[2]!.autumn).toBeLessThan(20);
    expect(realSecondsForDays(1, 1)).toBe(150); expect(realMinutesForDays(DAYS_PER_YEAR, 3)).toBeCloseTo(45, 6);
  });
});

describe('ride-along slow motion is target-speed based', () => {
  it('1x blue run ~ target: 1.0; 3x and 10x slow it down; extremes clamp', () => {
    const tpt = 5.0; // typical blue-run skier (the measured p95 on-screen speed at 1x is 8.1 tiles/s)
    expect(rideTimeFactor(tpt, TICKS_PER_SECOND * SPEED_MULTIPLIERS[1]!)).toBe(1);
    expect(rideTimeFactor(tpt, TICKS_PER_SECOND * SPEED_MULTIPLIERS[2]!)).toBeCloseTo(RIDE_TARGET_TILES_PER_S / (tpt * TICKS_PER_SECOND * 3), 9);
    expect(rideTimeFactor(tpt, TICKS_PER_SECOND * SPEED_MULTIPLIERS[3]!)).toBeLessThan(0.2);
    for (const s of [1, 2, 3]) { const f = rideTimeFactor(tpt, TICKS_PER_SECOND * SPEED_MULTIPLIERS[s]!); expect(tpt * TICKS_PER_SECOND * SPEED_MULTIPLIERS[s]! * f).toBeLessThanOrEqual(RIDE_TARGET_TILES_PER_S + 1e-9); }
    expect(rideTimeFactor(100, 100)).toBe(RIDE_MIN_TIME_SCALE);
    expect(rideTimeFactor(0, 12.8)).toBe(1);
    expect(rideTimeFactor(NaN, 12.8)).toBe(1);
  });
  it('easing moves towards the desired factor, faster downwards, framerate independent-ish', () => {
    const down = easeRideFactor(1, 0.2, 0.1), up = easeRideFactor(0.2, 1, 0.1);
    expect(down).toBeLessThan(1); expect(down).toBeGreaterThan(0.2);
    expect(1 - down).toBeGreaterThan(up - 0.2); // slowing down is quicker (relative to the gap, down: 0.8 gap)
    let f = 1; for (let i = 0; i < 600; i++) f = easeRideFactor(f, 0.25, 1 / 60);
    expect(f).toBeCloseTo(0.25, 3);
    let a = 1, b = 1; for (let i = 0; i < 60; i++) a = easeRideFactor(a, 0.25, 1 / 60); b = easeRideFactor(b, 0.25, 1);
    expect(Math.abs(a - b)).toBeLessThan(0.02);
  });
});

describe('impostor rendering at 10x', () => {
  it('iso view: points when zoomed out OR at speed >= 10x; perspective views keep figures', () => {
    const base = { persp: false, viewHeight: 30, farScale: 1 };
    expect(useGuestImpostor({ ...base, speedMul: 1 })).toBe(false);
    expect(useGuestImpostor({ ...base, speedMul: 3 })).toBe(false);
    expect(useGuestImpostor({ ...base, speedMul: 0 })).toBe(false);
    expect(useGuestImpostor({ ...base, speedMul: GUEST_IMPOSTOR_MIN_SPEED })).toBe(true);
    expect(useGuestImpostor({ ...base, viewHeight: 200, speedMul: 1 })).toBe(true);
    expect(useGuestImpostor({ persp: true, viewHeight: 200, farScale: 1, speedMul: 10 })).toBe(false);
    expect(GUEST_IMPOSTOR_MIN_SPEED).toBe(SPEED_MULTIPLIERS[3]);
  });
  it('GuestRenderer switches to the point cloud at 10x and back', () => {
    const st = new GuestStore(50);
    const i = st.add({ x: 10, y: 10, z: 0, type: 0, skill: 1, budget: 1, group: 0, mode: 0, overnight: false, leaveDay: 1, tick: 0 });
    st.state[i] = GState.Walking; st.px[i] = 9; st.py[i] = 10;
    const r = new GuestRenderer(st);
    r.speedMul = 1; r.update(0.5, 30); expect(r.far).toBe(false); expect(r.batchCounts().reduce((a, b) => a + b, 0)).toBe(1);
    r.speedMul = 10; r.update(0.5, 30); expect(r.far).toBe(true); expect(r.drawnCount).toBe(1); expect(r.batchCounts().reduce((a, b) => a + b, 0)).toBe(0);
    r.speedMul = 3; r.update(0.5, 30); expect(r.far).toBe(false);
  });
});

describe('gait phase is real-time based (does not slow with the 150 s day, freezes while paused)', () => {
  const phaseAfter = (ticksPerSecond: number, seconds: number, frame = 1 / 60): number => {
    const st = new GuestStore(10);
    const i = st.add({ x: 10, y: 10, z: 0, type: 0, skill: 1, budget: 1, group: 0, mode: 0, overnight: false, leaveDay: 1, tick: 0 });
    st.state[i] = GState.Walking; st.moveMode[i] = NavMode.Walk;
    const r = new GuestRenderer(st);
    r.frameSeconds = frame;
    const attr = r.meshes[Gear.Walk]!.geometry.getAttribute('iC') as THREE.InstancedBufferAttribute;
    let t = 0, tick = 0;
    r.update(0, 30, undefined, tick);
    const start = attr.getX(0);
    while (t < seconds) {
      t += frame; const a = (t * ticksPerSecond) % 1; tick = Math.floor(t * ticksPerSecond);
      st.px[i] = 10 + tick * 3; st.x[i] = st.px[i]! + 3; // 3 tiles per tick
      r.update(a, 30, undefined, tick);
    }
    return attr.getX(0) - start;
  };
  it('same phase advance per real second at 1x (1.6 ticks/s), 3x and 10x', () => {
    const p1 = phaseAfter(1.6, 4), p3 = phaseAfter(4.8, 4), p8 = phaseAfter(12.8, 4);
    expect(p1).toBeGreaterThan(2);
    expect(p3 / p1).toBeCloseTo(1, 1); expect(p8 / p1).toBeCloseTo(1, 1);
    expect(p1 / 4).toBeCloseTo(0.5 * GAIT_RATE, 1); // capped 0.5 tile/tick x GAIT_RATE per second
  });
  it('is frame-rate independent and frozen when the sim clock does not advance (paused)', () => {
    const a = phaseAfter(1.6, 3, 1 / 30), b = phaseAfter(1.6, 3, 1 / 120);
    expect(a / b).toBeCloseTo(1, 1);
    const st = new GuestStore(10);
    const i = st.add({ x: 10, y: 10, z: 0, type: 0, skill: 1, budget: 1, group: 0, mode: 0, overnight: false, leaveDay: 1, tick: 0 });
    st.state[i] = GState.Walking; st.px[i] = 7;
    const r = new GuestRenderer(st), attr = r.meshes[Gear.Walk]!.geometry.getAttribute('iC') as THREE.InstancedBufferAttribute;
    r.update(0.5, 30, undefined, 5); r.update(0.6, 30, undefined, 5); const p = attr.getX(0);
    for (let k = 0; k < 30; k++) r.update(1, 30, undefined, 5 + 1e-3 * 0); // alpha pinned (paused): no advance
    expect(attr.getX(0)).toBeCloseTo(p + 0, 1);
  });
});

describe('guests are drawn along their real path, not the chord', () => {
  // Fixture: an L-shaped corner around a 4x4 building at tiles [2..5] x [2..5]; the guest walks (1,1) -> (1,7) -> (7,7) in one tick.
  const wp = [1.5, 1.5, 1.5, 6.5, 1.5, 7.5, 6.5, 7.5];
  const inBuilding = (x: number, y: number): boolean => x >= 2 && x < 6 && y >= 2 && y < 6;
  it('the polyline never enters the building; the chord does', () => {
    const out = { x: 0, y: 0 };
    let hitsPath = 0, hitsChord = 0;
    for (let k = 0; k <= 200; k++) {
      const a = k / 200;
      pathPoint(1.5, 1.5, 7.5, 7.5, wp, 0, 4, a, out); if (inBuilding(out.x, out.y)) hitsPath++;
      if (inBuilding(1.5 + 6 * a, 1.5 + 6 * a)) hitsChord++;
    }
    expect(hitsPath).toBe(0); expect(hitsChord).toBeGreaterThan(50);
    expect(maxChordDeviation(1.5, 1.5, 7.5, 7.5, wp, 0, 4)).toBeGreaterThan(3);
  });
  it('arc-length parametrisation: endpoints exact, uniform speed, monotone progress', () => {
    const o = { x: 0, y: 0 };
    expect(pathPoint(0, 0, 10, 0, wp, 0, 0, 0.3, o)).toEqual({ x: 3, y: 0 }); // no waypoints = chord
    pathPoint(1.5, 1.5, 7.5, 7.5, wp, 0, 4, 0, o); expect(o).toEqual({ x: 1.5, y: 1.5 });
    pathPoint(1.5, 1.5, 7.5, 7.5, wp, 0, 4, 1, o); expect(o).toEqual({ x: 7.5, y: 7.5 });
    // total length 12 (5 + 1 + 5 + 1)
    pathPoint(1.5, 1.5, 7.5, 7.5, wp, 0, 4, 0.5, o); expect(o.x).toBeCloseTo(1.5, 6); expect(o.y).toBeCloseTo(7.5, 6); // halfway (6 of 12) = the corner
    // uniform speed: equal alpha steps cover equal path length (checked on the first straight leg, 5 of 12 tiles)
    pathPoint(1.5, 1.5, 7.5, 7.5, wp, 0, 4, 2.5 / 12, o); expect(o.y).toBeCloseTo(4, 6); expect(o.x).toBeCloseTo(1.5, 6);
  });
  it('the sim records the tile centres a guest passes in a tick (store.wp), reset each tick', () => {
    const st = new GuestStore(4);
    expect(WP_MAX).toBeGreaterThanOrEqual(8);
    expect(st.wp.length).toBe(4 * WP_MAX * 2);
    const i = st.add({ x: 1, y: 1, z: 0, type: 0, skill: 1, budget: 1, group: 0, mode: 0, overnight: false, leaveDay: 1, tick: 0 });
    expect(st.wpN[i]).toBe(0);
  });
});

describe('render chase smoothing is tick-rate aware', () => {
  it('chaseK: time constant ~1 tick, frame independent', () => {
    const k60 = chaseK(1 / 60, 1.6), k30 = chaseK(1 / 30, 1.6);
    expect(k60).toBeGreaterThan(0); expect(k60).toBeLessThan(0.05); // slow chase at 1.6 ticks/s (the old fixed 0.25 per frame made it stop-and-go)
    expect((1 - k60) ** 2).toBeCloseTo(1 - k30, 6);
    expect(chaseK(1 / 60, 12.8)).toBeGreaterThan(k60 * 5);
    expect(chaseK(0, 10)).toBe(0);
  });
});

import { deadlineRealTimeText, fastNightsFactor, formatRealMinutes, realMinutesWithNights, realSecondsPerDay } from '../../src/core/pacing';
describe('scenario deadline real-time estimates (with fast nights)', () => {
  it('fast nights shorten the average day to roughly 65-75 % (about 11 s at 10x, 110 s at 1x)', () => {
    const f = fastNightsFactor();
    expect(f).toBeGreaterThan(0.55); expect(f).toBeLessThan(0.8);
    expect(realSecondsPerDay(3, false)).toBeCloseTo(15, 9);
    expect(realSecondsPerDay(3, true)).toBeCloseTo(15 * f, 9);
    expect(realSecondsPerDay(3, true)).toBeGreaterThan(9); expect(realSecondsPerDay(3, true)).toBeLessThan(12.5);
  });
  it('a 180-day year takes about 33 min at 10x with fast nights, 45 min without', () => {
    expect(realMinutesWithNights(180, 3, false)).toBeCloseTo(45, 6);
    expect(realMinutesWithNights(180, 3, true)).toBeGreaterThan(28); expect(realMinutesWithNights(180, 3, true)).toBeLessThan(35);
  });
  it('formats minutes / hours and lists all three speeds', () => {
    expect(formatRealMinutes(0.5)).toBe('under a minute'); expect(formatRealMinutes(25)).toBe('about 25 min'); expect(formatRealMinutes(150)).toBe('about 2.5 h'); expect(formatRealMinutes(450)).toBe('about 7.5 h');
    const t = deadlineRealTimeText(180);
    expect(t).toContain('at 1×'); expect(t).toContain('at 3×'); expect(t).toContain('at 10×'); expect(t).toContain('fast nights on');
    expect(deadlineRealTimeText(180, false)).not.toContain('fast nights');
  });
});
