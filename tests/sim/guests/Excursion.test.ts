import { describe, expect, it } from 'vitest';
import { Excursions, EXC, plannedHours, type ExcHost } from '../../../src/sim/guests/Excursion';
import { GuestStore } from '../../../src/sim/guests/Guest';
import { Layer } from '../../../src/world/Networks';
import { budget } from '../../perfMode';
import { TICKS_PER_DAY } from '../../../src/config/balance';

/** A fake 64x64 world: one straight trail along row 5 (x 2..61). */
function fixture(o: { hour?: number; leave?: number; avoid?: (t: number) => number } = {}) {
  const n = 64, hikeOk = new Uint8Array(n * n), layers = new Uint8Array(n * n), kind = new Uint8Array(n * n);
  for (let x = 2; x < 62; x++) { hikeOk[5 * n + x] = 1; layers[5 * n + x] = Layer.Hike; }
  const st = new GuestStore(2000);
  const state = { hour: o.hour ?? 9, finished: [] as Array<[number, boolean, boolean]>, reached: 0 };
  const host: ExcHost = {
    graph: () => ({ size: n, world: { hikeOk, layers, kind }, isStation: () => false }) as never,
    groundAt: () => 0,
    moveSlot: (s, x, y, z) => { st.x[s] = x; st.y[s] = y; st.z[s] = z; },
    hour: () => state.hour, leaveHour: () => o.leave ?? 19,
    avoid: o.avoid ?? (() => 0),
    reachedGoal: () => { state.reached++; },
    foodNear: () => false, lunch: () => {},
    finished: (s, ok, trek) => { state.finished.push([s, ok, trek]); },
  };
  const ex = new Excursions(st, host);
  const add = (): number => st.add({ x: 2.5, y: 5.5, z: 0, type: 0, skill: 1, budget: 100, group: 0, mode: 0, overnight: false, leaveDay: 0, tick: 0 });
  const route = (from = 2, to = 61): Int32Array => Int32Array.from({ length: to - from + 1 }, (_, i) => 5 * n + from + i);
  return { n, hikeOk, layers, st, state, ex, add, route };
}

describe('excursion ETA', () => {
  it('hiker duration stays in 1.5-4.5 h for any map size and route length', () => {
    for (const size of [64, 128, 256]) for (const tiles of [12, 40, 100, 250, 600, 1500]) {
      const h = plannedHours(tiles, size, 0, 1);
      expect(h).toBeGreaterThanOrEqual(EXC.minH - 1e-9); expect(h).toBeLessThanOrEqual(EXC.maxH + 1e-9);
    }
  });
  it('is independent of the map scale for the same relative route', () => {
    expect(plannedHours(100, 64, 0, 1)).toBeCloseTo(plannedHours(200, 128, 0, 1), 6);
    expect(plannedHours(100, 64, 0, 1)).toBeCloseTo(plannedHours(400, 256, 0, 1), 6);
  });
  it('bikers are faster than hikers on the same route', () => { expect(plannedHours(150, 64, 1, 1)).toBeLessThan(plannedHours(150, 64, 0, 1)); });
});

describe('excursion progress', () => {
  it('walks out, stops at the goal, comes back and finishes at the start within D + S hours', () => {
    const f = fixture(), s = f.add();
    expect(f.ex.begin(s, f.route(), 0, 1, 64, false)).toBe(true);
    const x = f.ex.map.get(s)!;
    const ticks = Math.ceil((x.D + x.S) / EXC.hourPerTick) + 2;
    let maxX = 0;
    for (let t = 0; t < ticks && f.ex.has(s); t++) { f.ex.step(s); maxX = Math.max(maxX, f.st.x[s]!); }
    expect(f.ex.has(s)).toBe(false);
    expect(maxX).toBeGreaterThan(55);
    expect(f.st.x[s]).toBeLessThan(4);
    expect(f.state.reached).toBe(1);
    expect(f.state.finished).toEqual([[s, true, false]]);
  });
  it('refuses a plan that does not fit before the day guests leave; shortens one that half fits', () => {
    const late = fixture({ hour: 17, leave: 18 });
    expect(late.ex.begin(late.add(), late.route(), 0, 1, 64, false)).toBe(false);
    const f = fixture({ hour: 14, leave: 18 }), s = f.add();
    expect(f.ex.begin(s, f.route(), 0, 1, 64, false)).toBe(true);
    const x = f.ex.map.get(s)!;
    expect(14 + x.D + x.S).toBeLessThanOrEqual(18 - EXC.duskMargin + 1e-6);
    expect(x.route.length).toBeLessThan(60);
  });
  it('rejects short routes (NavMovement handles them)', () => {
    const f = fixture(); expect(f.ex.begin(f.add(), f.route(2, 10), 0, 1, 64, false)).toBe(false);
  });
  it('turns back when a trail tile ahead closes (snow) and returns to the start', () => {
    const f = fixture(), s = f.add();
    f.ex.begin(s, f.route(), 0, 1, 64, false);
    for (let i = 0; i < 12; i++) f.ex.step(s);
    const before = f.st.x[s]!;
    for (let x = 2; x < 62; x++) if (x > before + 1) f.hikeOk[5 * 64 + x] = 0;
    for (let i = 0; i < 12; i++) f.ex.step(s);
    expect(f.ex.map.get(s)?.turned).toBe(true);
    for (let i = 0; i < 80 && f.ex.has(s); i++) f.ex.step(s);
    expect(f.ex.has(s)).toBe(false);
    expect(f.st.x[s]).toBeLessThan(before + 1);
    expect(f.state.reached).toBe(0);
  });
  it('flees a bear threat field: turn back out, end in place on the way home', () => {
    let bear = false;
    const f = fixture({ avoid: (t) => (bear && t % 64 > 20 ? 1 : 0) }), s = f.add();
    f.ex.begin(s, f.route(), 0, 1, 64, false);
    for (let i = 0; i < 20; i++) f.ex.step(s);
    bear = true;
    for (let i = 0; i < 20 && !f.ex.map.get(s)?.turned && f.ex.has(s); i++) f.ex.step(s);
    expect(f.ex.turnedBack + f.ex.aborted).toBeGreaterThan(0);
  });
  it('turnBack mirrors the position (no teleport)', () => {
    const f = fixture(), s = f.add();
    f.ex.begin(s, f.route(), 0, 1, 64, false);
    for (let i = 0; i < 10; i++) f.ex.step(s);
    const x0 = f.st.x[s]!;
    f.ex.turnBack(s); f.ex.step(s);
    expect(Math.abs(f.st.x[s]! - x0)).toBeLessThan(3.5);
  });
  it('shares identical routes and round-trips through save/load', () => {
    const f = fixture(), a = f.add(), b = f.add();
    f.ex.begin(a, f.route(), 0, 3, 64, false); f.ex.begin(b, f.route(), 0, 3, 64, false);
    expect(f.ex.map.get(a)!.route).toBe(f.ex.map.get(b)!.route);
    for (let i = 0; i < 20; i++) { f.ex.step(a); f.ex.step(b); }
    const dump = JSON.parse(JSON.stringify(f.ex.serialize()));
    const g = new Excursions(f.st, (f.ex as unknown as { h: ExcHost }).h);
    g.load(dump);
    expect(JSON.stringify(g.serialize())).toBe(JSON.stringify(f.ex.serialize()));
    expect(dump.routes.length).toBe(1);
  });
  it('trek legs end on arrival and are never truncated', () => {
    const f = fixture({ hour: 9, leave: 19 }), s = f.add();
    expect(f.ex.begin(s, f.route(), 0, 1, 64, true, true, true)).toBe(true);
    for (let i = 0; i < 80 && f.ex.has(s); i++) f.ex.step(s);
    expect(f.state.finished).toEqual([[s, true, true]]);
    expect(f.st.x[s]).toBeGreaterThan(58);
    const tooLate = fixture({ hour: 18.5, leave: 19 });
    expect(tooLate.ex.begin(tooLate.add(), tooLate.route(), 0, 1, 64, true, true, true)).toBe(false);
  });
});

describe('excursion performance', () => {
  it('[perf] 1000 excursionists cost well under 0.5 ms per tick', () => {
    let best = Infinity;
    for (let trial = 0; trial < 5; trial++) { // best of N: robust to CPU contention
      const f = fixture(), slots: number[] = [];
      for (let i = 0; i < 1000; i++) { const s = f.add(); f.ex.begin(s, f.route(), 0, 1, 64, false); slots.push(s); }
      const t0 = performance.now(); let ticks = 0;
      for (let t = 0; t < 40; t++, ticks++) for (const s of slots) f.ex.step(s);
      best = Math.min(best, (performance.now() - t0) / ticks);
    }
    expect(best).toBeLessThan(budget(0.5));
    void TICKS_PER_DAY;
  });
});
