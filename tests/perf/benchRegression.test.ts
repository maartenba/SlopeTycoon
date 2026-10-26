import { describe, expect, it } from 'vitest';
import { runBench, type BenchResult } from './bench';
import { budget } from '../perfMode';

/**
 * Always-on perf regression guard with GENEROUS margins (the real numbers are ~5-10x below the acceptance targets, see docs/perf.md).
 * Timing tests are flaky under parallel load, so each size takes the best of N runs and asserts only the acceptance targets.
 */
const TARGETS = {
  64: { tickAvg: 4, tickP95: 16 },
  128: { tickAvg: 6, tickP95: 16 },
  256: { tickAvg: 8, tickP95: 16 },
} as const;

const best = (size: 64 | 128 | 256, n: number): BenchResult => {
  let b: BenchResult | null = null;
  for (let i = 0; i < n; i++) { const r = runBench({ size, days: 1 }); if (!b || r.tickAtCap.avg < b.tickAtCap.avg) b = r; }
  return b!;
};

describe('perf regression (guests at cap)', () => {
  for (const size of [64, 128, 256] as const) {
    it(`[perf] size ${size}: tick avg/p95, generation time and heap stay within the acceptance targets`, () => {
      const r = best(size, 3);
      expect(r.guestsPeak, 'resort must fill to the guest cap').toBeGreaterThanOrEqual(r.guestCap * 0.9);
      expect(r.ticksAtCap).toBeGreaterThan(30);
      expect(r.tickAtCap.avg).toBeLessThan(budget(TARGETS[size].tickAvg));
      expect(r.tickAtCap.p95).toBeLessThan(budget(TARGETS[size].tickP95));
      if (size === 256) expect(r.genMs).toBeLessThan(budget(1500));
      expect(r.heapMB).toBeLessThan(450);
    }, 120000);
  }
});
