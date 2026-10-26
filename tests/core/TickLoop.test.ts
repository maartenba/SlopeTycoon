import { describe, expect, it } from 'vitest';
import { TickLoop, type VisibilitySource } from '@/core/TickLoop';
import { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { createGameState } from '@/core/GameState';
import { TICKS_PER_DAY, REAL_SECONDS_PER_DAY_1X } from '@/config/balance';
import { createDefaultRegistry, stateHash, SystemRegistry, type SimSystem } from '@/sim/Systems';

/** One fixed tick at 1x, in real seconds. */
const STEP = REAL_SECONDS_PER_DAY_1X / TICKS_PER_DAY;

function fakeVisibility(): VisibilitySource & { set(h: boolean): void } {
  let hidden = false;
  const subs = new Set<() => void>();
  return {
    isHidden: () => hidden,
    subscribe: (cb) => { subs.add(cb); return () => subs.delete(cb); },
    set(h) { hidden = h; for (const s of subs) s(); },
  };
}

const makeRngSystem = (): SimSystem => {
  let n = 0;
  return {
    id: 'guests',
    update: (s) => { n++; s.money += Math.floor(s.rng.next() * 100); },
    serialize: () => ({ n }),
    load: (d) => { n = (d as { n: number }).n; },
  };
};

function run(dts: number[], seed = 7, speed: 1 | 2 | 3 = 1): string {
  const state = createGameState(seed, 64);
  const reg = createDefaultRegistry();
  reg.replace(makeRngSystem());
  const loop = new TickLoop({ visibility: null, maxCatchUp: 100000, onTick: (t) => reg.update(state, t) });
  loop.setSpeed(speed);
  for (const dt of dts) loop.advance(dt);
  return `${loop.tickCount}:${stateHash(state, reg)}`;
}

describe('TickLoop', () => {
  it('speed 0 produces no ticks', () => {
    let n = 0;
    const loop = new TickLoop({ visibility: null, onTick: () => { n++; } });
    loop.setSpeed(0);
    expect(loop.advance(10)).toBe(0);
    expect(n).toBe(0);
    loop.setSpeed(1);
    expect(loop.advance(STEP * 5)).toBe(5);
  });

  it('speeds scale the tick rate (1x, 3x, 10x)', () => {
    const count = (speed: 1 | 2 | 3): number => {
      const loop = new TickLoop({ visibility: null, maxCatchUp: 1000, onTick: () => {} });
      loop.setSpeed(speed);
      return loop.advance(STEP * 10);
    };
    expect([count(1), count(2), count(3)]).toEqual([10, 30, 100]);
  });

  it('a day lasts 150 s / 50 s / 15 s of real time at 1x / 3x / 10x', () => {
    for (const [speed, secs] of [[1, 150], [2, 50], [3, 15]] as const) {
      const loop = new TickLoop({ visibility: null, maxCatchUp: 100000, onTick: () => {} });
      loop.setSpeed(speed);
      expect(loop.advance(secs)).toBe(TICKS_PER_DAY);
    }
  });

  it('is deterministic and independent of frame timing', () => {
    const one = run([STEP * 100]); // 100 ticks in one big dt
    const many = run(Array.from({ length: 1000 }, () => STEP / 10));
    const odd = run([STEP * 2.5, STEP * 5, STEP * 1.25, STEP * 1.25, STEP * 90]);
    expect(one).toBe(many);
    expect(one).toBe(odd);
    expect(run([STEP * 100], 8)).not.toBe(one); // different seed => different hash
    expect(run([STEP * 100])).toBe(one); // same seed repeats
  });

  it('caps catch-up steps and drops the backlog', () => {
    let n = 0;
    const loop = new TickLoop({ visibility: null, maxCatchUp: 8, onTick: () => { n++; } });
    expect(loop.advance(100)).toBe(8);
    expect(n).toBe(8);
    expect(loop.droppedBacklog).toBeGreaterThan(0);
    expect(loop.advance(STEP)).toBe(1); // no spiral: next frame is normal
  });

  it('pauses while hidden and resumes without a time jump', () => {
    const vis = fakeVisibility();
    let n = 0;
    const loop = new TickLoop({ visibility: vis, onTick: () => { n++; } });
    loop.advance(STEP / 2);
    vis.set(true);
    expect(loop.advance(5)).toBe(0);
    vis.set(false);
    expect(n).toBe(0);
    expect(loop.advance(STEP)).toBe(1); // only the new step counts; stale accumulator was discarded
    loop.dispose();
  });

  it('emits speed:changed, toggles pause and restores speed', () => {
    const bus = new EventBus<GameEvents>();
    const got: Array<[number, number]> = [];
    bus.on('speed:changed', (e) => got.push([e.speed, e.previous]));
    const loop = new TickLoop({ visibility: null, bus, onTick: () => {} });
    loop.setSpeed(2);
    loop.togglePause();
    loop.togglePause();
    loop.setSpeed(2); // no-op
    expect(got).toEqual([[2, 1], [0, 2], [2, 0]]);
    loop.changeSpeed(1);
    expect(loop.speed).toBe(3);
    loop.changeSpeed(1);
    expect(loop.speed).toBe(3);
  });

  it('serialises tick count and speed only', () => {
    const loop = new TickLoop({ visibility: null, maxCatchUp: 100, onTick: () => {} });
    loop.setSpeed(3);
    loop.advance((STEP * 14.5) / 10);
    const d = loop.serialize();
    expect(d).toEqual({ tick: 14, speed: 3 });
    const l2 = new TickLoop({ visibility: null, onTick: () => {} });
    l2.load(d);
    expect(l2.tickCount).toBe(14);
    expect(l2.speed).toBe(3);
  });
});

describe('SystemRegistry', () => {
  it('runs systems in the fixed order regardless of registration order', () => {
    const order: string[] = [];
    const mk = (id: string): SimSystem => ({ id, update: () => { order.push(id); } });
    const reg = new SystemRegistry(() => 0);
    for (const id of ['economy', 'clock', 'guests', 'season']) reg.register(mk(id));
    reg.update(createGameState(1, 64), 1);
    expect(order).toEqual(['clock', 'season', 'guests', 'economy']);
    expect(() => reg.register(mk('bogus'))).toThrow();
  });

  it('profiles per system (avg / p95 / budget)', () => {
    let t = 0;
    const reg = new SystemRegistry(() => t, 1);
    reg.register({ id: 'ops', update: () => { t += 3; } });
    for (let i = 0; i < 10; i++) reg.update(createGameState(1, 64), i);
    const s = reg.stats()[0]!;
    expect(s.avgMs).toBe(3);
    expect(s.p95Ms).toBe(3);
    expect(s.overBudget).toBe(true);
  });
});
