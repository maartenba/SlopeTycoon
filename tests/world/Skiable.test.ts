import { describe, it, expect } from 'vitest';
import { Grid } from '../../src/world/Grid';
import { generateTerrain } from '../../src/world/TerrainGen';
import { skiableStats } from '../../src/world/Skiable';

describe('skiable terrain', () => {
  for (const size of [64, 128, 256] as const) {
    it(`size ${size}: little rock, plenty of skiable slope, long skiable run (seeds 1-20)`, () => {
      const rock: number[] = [], ski: number[] = [];
      for (let seed = 1; seed <= 20; seed++) {
        const g = new Grid(size);
        generateTerrain(g, seed);
        const s = skiableStats(g);
        rock.push(s.rockFrac); ski.push(s.skiableFrac);
        expect(s.rockFrac, `seed ${seed} rock`).toBeLessThanOrEqual(0.2);
        expect(s.skiableFrac, `seed ${seed} skiable`).toBeGreaterThanOrEqual(0.2);
        expect(s.dropFrac, `seed ${seed} drop`).toBeGreaterThanOrEqual(0.35);
        expect(s.bestRegionLength, `seed ${seed} length`).toBeGreaterThanOrEqual(12);
      }
      const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;
      expect(mean(rock)).toBeLessThanOrEqual(0.15);
      expect(mean(ski)).toBeGreaterThanOrEqual(0.3);
    });
  }
});
