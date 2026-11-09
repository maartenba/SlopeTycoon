import { describe, expect, it } from 'vitest';
import { FrameClock, installVirtualNow } from '../../src/core/frameStep';
import { TickLoop } from '../../src/core/TickLoop';

describe('frame-step virtual clock', () => {
  it('advances by exact dt and stays continuous with the real clock', () => {
    const c = new FrameClock(); c.begin(1000);
    for (let i = 0; i < 30; i++) c.step(1 / 30);
    expect(c.frame).toBe(30); expect(c.t).toBeCloseTo(1, 9); expect(c.nowMs()).toBeCloseTo(2000, 6);
  });
  it('replaces and restores performance.now (idempotent)', () => {
    const fake = { now: () => 5 }; const c = new FrameClock(); c.begin(5);
    const restore = installVirtualNow(c, fake);
    c.step(0.5); expect(fake.now()).toBeCloseTo(505, 6);
    restore(); restore(); expect(fake.now()).toBe(5);
  });
  it('two runs with the same dt list tick the sim loop identically (any dt / rate)', () => {
    const run = (dt: number, n: number, ts: number): number[] => {
      const ticks: number[] = []; const l = new TickLoop({ onTick: (t) => { ticks.push(t); }, visibility: null }); l.timeScale = ts;
      for (let i = 0; i < n; i++) l.advance(dt); return [l.tickCount, ...ticks.slice(-2)];
    };
    expect(run(1 / 12, 30, 3)).toEqual(run(1 / 12, 30, 3));
    expect(run(1 / 30, 30, 1)[0]).toBe(run(1 / 30, 30, 1)[0]);
  });
});
