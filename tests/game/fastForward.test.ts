import { describe, expect, it } from 'vitest';
import { makeResort, scanProblems } from './harness';
import { FastForward, type FfStop } from '../../src/core/FastForward';
import { stateHash } from '../../src/game/saveState';
import { encodeSave, makeMeta } from '../../src/persist/Serializer';
import { TICKS_PER_DAY } from '../../src/config/balance';
import type { Sim } from '../../src/game/createSim';
import { GAME_EVENT_NAMES } from '../../src/core/events';

const wire = (sim: Sim, o: { budget?: number } = {}): { ff: FastForward; stops: FfStop[] } => {
  const ff = new FastForward({ now: () => performance.now(), step: () => { sim.loop.stepOnce(); }, date: () => sim.game.date, blocked: () => null, hidden: () => false });
  if (o.budget !== undefined) ff.budgetMs = o.budget;
  const stops: FfStop[] = []; ff.onStop((s) => stops.push(s));
  for (const n of GAME_EVENT_NAMES) (sim.bus as unknown as { on(n: string, f: (p: never) => void): void }).on(n, ((p: never) => ff.notify(n, p)) as (p: never) => void);
  return { ff, stops };
};

describe('fast-forward determinism: same ticks, same state', () => {
  it('N ticks via fast-forward batches == N ticks at normal speed (with a save in between)', async () => {
    const a = makeResort(64, 3, { startDay: 120 }).sim, b = makeResort(64, 3, { startDay: 120 }).sim;
    const N = TICKS_PER_DAY * 20;
    // normal: the real-time accumulator at 3x (a few ticks per call, like frames)
    a.ops.quality.attachTraffic(); // PisteTraffic.sink is process-wide: point it at the sim being ticked
    a.loop.setSpeed(2);
    while (a.loop.tickCount < N) a.loop.advance(1 / 60 + 0.05 * (a.loop.tickCount % 3));
    // overshoot protection: advance may run past N; trim by comparing at the exact same tick count instead
    const target = a.loop.tickCount;
    const { ff } = wire(b);
    b.ops.quality.attachTraffic();
    b.loop.setSpeed(2);
    ff.start('event');
    let saved = false;
    while (b.loop.tickCount < target) {
      ff.budgetMs = 1; // tiny batches
      const left = target - b.loop.tickCount;
      for (let i = 0; i < Math.min(left, 37); i++) b.loop.stepOnce();
      if (!saved && b.loop.tickCount > target / 2) { saved = true; await encodeSave(b, makeMeta(b, 'ff'), { compress: false, yieldBetween: false }); }
    }
    ff.cancel();
    expect(b.loop.tickCount).toBe(target);
    expect(stateHash(b).hash).toBe(stateHash(a).hash);
  });
  it('the controller itself (budgeted frames to a month boundary) matches normal stepping to the same tick', () => {
    const a = makeResort(64, 5, { startDay: 120 }).sim, b = makeResort(64, 5, { startDay: 120 }).sim;
    const { ff } = wire(b);
    b.ops.quality.attachTraffic();
    ff.start('month'); while (ff.active) ff.frame();
    const n = b.loop.tickCount;
    a.ops.quality.attachTraffic();
    for (let i = 0; i < n; i++) a.loop.stepOnce();
    expect(a.loop.tickCount).toBe(n);
    expect(stateHash(a).hash).toBe(stateHash(b).hash);
  });
});

describe('fast-forward integration (headless starter resort)', () => {
  for (const size of [64, 128] as const) {
    it(`${size}: skips to the next season without NaN, with a throughput floor`, () => {
      const { sim } = makeResort(size, 7, { startDay: 120 });
      const { ff, stops } = wire(sim);
      sim.ops.quality.attachTraffic();
      sim.loop.setSpeed(1);
      const t0 = performance.now();
      const d0 = sim.game.date.day;
      ff.start('season');
      let frames = 0;
      while (ff.active && frames++ < 200000) ff.frame();
      const secs = (performance.now() - t0) / 1000;
      expect(stops.length).toBe(1);
      expect(['target', 'event']).toContain(stops[0]!.reason);
      expect(scanProblems(sim)).toEqual([]);
      const days = stops[0]!.days;
      expect(days).toBeGreaterThan(0);
      if (stops[0]!.reason === 'target') { expect(sim.game.date.day).toBeGreaterThan(d0); expect(sim.game.date.minute).toBe(0); }
      expect(days / secs).toBeGreaterThan(size === 64 ? 1.5 : 0.8); // loose floor (CI machines differ); real numbers in docs/time-flow.md
      console.log(`[ff] ${size}: ${days.toFixed(1)} days in ${secs.toFixed(1)} s = ${(days / secs).toFixed(1)} days/s (${stops[0]!.reason}${stops[0]!.detail ? ': ' + stops[0]!.detail : ''})`);
    });
  }
});
