import { describe, it, expect } from 'vitest';
import { seedsMean } from '../perf/terrainMetrics';

const seeds = Array.from({ length: 20 }, (_, i) => i + 1);

// Ski-friendly terrain: broad beginner/intermediate slopes, benches, steep only on cliff bands / summit cones.
describe('terrain slope distribution (seeds 1-20, non-water tiles above the village)', () => {
  for (const size of [64, 128, 256] as const) {
    it(`size ${size}: gentle, with benches and some steep summit`, () => {
      const { mean, worst } = seedsMean(size, seeds);
      expect(mean.median).toBeLessThanOrEqual(0.75);
      expect(worst.median!).toBeLessThanOrEqual(1);
      expect(mean.ge15).toBeLessThanOrEqual(0.2);
      expect(worst.ge15!).toBeLessThanOrEqual(0.3);
      expect(mean.eq2).toBeLessThanOrEqual(0.08);
      expect(worst.eq2!).toBeLessThanOrEqual(0.15);
      expect(mean.beginner + mean.intermediate).toBeGreaterThanOrEqual(0.55);
      expect(worst.flat!).toBeGreaterThanOrEqual(0.55);
      expect(worst.benches!).toBeGreaterThanOrEqual(2);
      expect(mean.ge15, 'still some steep summit/cliff terrain').toBeGreaterThanOrEqual(0.02);
    }, 60000);
  }
});
