import { DAYS_PER_YEAR } from '@/config/balance';
import { describe, expect, it, vi } from 'vitest';
import { createSim } from '../../src/game/createSim';
import { Bot } from '../../src/game/bot';
import { scanProblems } from './harness';

/**
 * Soak: a bot-driven resort runs for N in-game days at max catch-up (no rendering, no real time) with a console.error / warn spy, NaN scans
 * every 15 days and a heap-growth bound. Default run: 64 map, 1 year (~8 s). BALANCE=1: 3 in-game years on all three sizes
 * (the headless equivalent of a 30 minute session at 4x speed = 30 x 60 x 10 x 4 ticks = 72 000 ticks = 300 days; 3 years is 3.6x that).
 */
const FULL = !!process.env.BALANCE || !!process.env.BENCH;
const gc = (globalThis as { gc?: () => void }).gc;

function soak(size: 64 | 128 | 256, days: number): void {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {}), warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const sim = createSim({ size, seed: 21, now: () => 0 });
  const bot = new Bot(sim, { starterLoan: size === 256 });
  sim.bus.on('finance:monthClosed', () => bot.snapshotMonth());
  const problems: string[] = [];
  let heap0 = 0;
  for (let d = 0; d < days; d++) {
    bot.daily();
    sim.tick(240);
    if (d % 15 === 0) problems.push(...scanProblems(sim));
    if (d === Math.floor(days / 3)) { gc?.(); heap0 = process.memoryUsage().heapUsed; }
  }
  gc?.();
  const growthMb = (process.memoryUsage().heapUsed - heap0) / 1048576;
  problems.push(...scanProblems(sim));
  expect(problems.slice(0, 5)).toEqual([]);
  expect(err.mock.calls.map((c) => String(c[0]))).toEqual([]);
  expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([]);
  expect(Number.isFinite(sim.game.money)).toBe(true);
  expect(sim.finance.ended).toBe(false);
  // bounded growth: without --expose-gc heapUsed is noisy, so the bound is generous (histories are capped rings, guests recycle)
  expect(growthMb, 'heap growth MB over the last two thirds').toBeLessThan(gc ? 60 : 250);
  err.mockRestore(); warn.mockRestore();
}

describe('soak (headless, max catch-up)', () => {
  it('64 map, bot, 1 in-game year: no exceptions, no NaN, no console.error, bounded heap', () => { soak(64, DAYS_PER_YEAR); }, 120_000);
  describe.skipIf(!FULL)('[balance] 3 in-game years', () => {
    for (const size of [64, 128, 256] as const) it(`${size}: 1080 days`, () => { soak(size, 1080); }, 900_000);
  });
});
