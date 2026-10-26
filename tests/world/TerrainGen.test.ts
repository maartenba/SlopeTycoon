import { describe, it, expect } from 'vitest';
import { Grid, TileType } from '../../src/world/Grid';
import { generateTerrain, altitudeZone } from '../../src/world/TerrainGen';
import { budget } from '../perfMode';

function hash(a: Int16Array): number {
  let x = 2166136261;
  for (let i = 0; i < a.length; i++) x = Math.imul(x ^ (a[i]! & 0xffff), 16777619);
  return x >>> 0;
}

const sizes = [64, 128, 256] as const;
const limits = { 64: 250, 128: 500, 256: 1500 };
const mins: Record<number, number> = {};

describe('generateTerrain', () => {
  for (const n of sizes) {
    it(`[perf] size ${n}: invariants, zones, benchmark`, () => {
      const g = new Grid(n);
      const t0 = performance.now();
      const r = generateTerrain(g, 1234);
      const ms = performance.now() - t0;
      console.log(`terrain gen ${n}: ${ms.toFixed(0)} ms, lakes=${r.lakes.length}`);
      expect(ms).toBeLessThan(budget(limits[n])); // strict in test:perf, 5x in default
      expect(g.checkInvariants()).toEqual([]);
      const zones = new Set<number>();
      for (const h of g.heights) zones.add(altitudeZone(n, h));
      expect(zones.size).toBeGreaterThanOrEqual(3);
      expect(r.lakes.length).toBeGreaterThan(0);
      expect(g.tileType.includes(TileType.Water)).toBe(true);
      expect(g.tileType.includes(TileType.Rock)).toBe(true);
      expect(r.forestDensity.some((v) => v > 100)).toBe(true);
      expect(r.roadEntry.y).toBe(n - 1);
      expect(r.railEntry.y).toBe(n - 1);
      // village area is flat
      const a = r.villageAnchor;
      const c = g.getCorners(a.x, a.y);
      expect(Math.max(...c) - Math.min(...c)).toBe(0);
    });
  }

  it('is deterministic', () => {
    const a = new Grid(128), b = new Grid(128), c = new Grid(128);
    generateTerrain(a, 42);
    generateTerrain(b, 42);
    generateTerrain(c, 43);
    expect(hash(a.heights)).toBe(hash(b.heights));
    expect(hash(a.heights)).not.toBe(hash(c.heights));
  });

  const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  for (const n of sizes) {
    it(`size ${n}: 10 seeds satisfy invariants, village, zones, lakes, smoothness`, () => {
      for (const seed of seeds) {
        const g = new Grid(n);
        const r = generateTerrain(g, seed);
        expect(g.checkInvariants(), `seed ${seed}`).toEqual([]);
        const zones = new Set<number>();
        for (const h of g.heights) zones.add(altitudeZone(n, h));
        expect(zones.size, `zones seed ${seed}`).toBeGreaterThanOrEqual(3);
        expect(r.lakes.length, `lakes seed ${seed}`).toBeGreaterThan(0);
        for (const e of [r.roadEntry, r.railEntry, r.villageAnchor]) expect(g.inBounds(e.x, e.y)).toBe(true);
        const a = r.villageAnchor;
        for (let dy = -3; dy <= 3; dy++)
          for (let dx = -3; dx <= 3; dx++) {
            const c = g.getCorners(a.x + dx, a.y + dy);
            expect(Math.max(...c) - Math.min(...c), `village flat seed ${seed}`).toBe(0);
          }
        let flatish = 0, total = 0;
        for (let y = 0; y < n; y++)
          for (let x = 0; x < n; x++) {
            if (g.tileType[y * n + x] === TileType.Rock) continue;
            total++;
            const c = g.getCorners(x, y); // [nw, ne, se, sw]
            const e = [c[0]! - c[1]!, c[1]! - c[2]!, c[3]! - c[2]!, c[0]! - c[3]!];
            if (e.every((d) => Math.abs(d) <= 1)) flatish++;
          }
        mins[n] = Math.min(mins[n] ?? 1, flatish / total);
        expect(flatish / total, `smooth seed ${seed}`).toBeGreaterThan(n === 64 ? 0.45 : 0.6);
        if (seed === 10) console.log(`min smooth fraction ${n}: ${mins[n]!.toFixed(2)}`);
      }
    });
  }

  it('different seeds produce measurably different maps', () => {
    const n = 128;
    const maps = seeds.map((s) => { const g = new Grid(n); generateTerrain(g, s); return g; });
    const hashes = new Set(maps.map((g) => hash(g.heights)));
    expect(hashes.size).toBe(seeds.length);
    const peak = (g: Grid): { x: number; y: number } => {
      let best = -1, bx = 0, by = 0;
      for (let y = 0; y < g.vsize; y++) for (let x = 0; x < g.vsize; x++) {
        const v = g.heights[y * g.vsize + x]!;
        if (v > best) { best = v; bx = x; by = y; }
      }
      return { x: bx, y: by };
    };
    const mean = (g: Grid): number => { let s = 0; for (const v of g.heights) s += v; return s / g.heights.length; };
    let diffPairs = 0, pairs = 0;
    for (let i = 0; i < maps.length; i++) for (let j = i + 1; j < maps.length; j++) {
      let d = 0; const a = maps[i]!.heights, b = maps[j]!.heights;
      for (let k = 0; k < a.length; k++) d += Math.abs(a[k]! - b[k]!);
      pairs++;
      if (d / a.length > 4) diffPairs++;
    }
    expect(diffPairs / pairs).toBeGreaterThan(0.9);
    const peaks = new Set(maps.map((g) => { const p = peak(g); return `${Math.round(p.x / 16)},${Math.round(p.y / 16)}`; }));
    expect(peaks.size).toBeGreaterThanOrEqual(4);
    const means = maps.map(mean);
    const mu = means.reduce((a, b) => a + b, 0) / means.length;
    const sd = Math.sqrt(means.reduce((a, b) => a + (b - mu) ** 2, 0) / means.length);
    expect(sd).toBeGreaterThan(1.5);
  });
});
