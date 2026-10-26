import { describe, it, expect } from 'vitest';
import { Grid, TileType } from '../../src/world/Grid';
import { generateTerrain, altitudeZone } from '../../src/world/TerrainGen';
import { PRESET_IDS, TERRAIN_PRESETS } from '../../src/world/TerrainPresets';
import { skiableStats } from '../../src/world/Skiable';

const hash = (a: Int16Array): number => { let x = 2166136261; for (let i = 0; i < a.length; i++) x = Math.imul(x ^ (a[i]! & 0xffff), 16777619); return x >>> 0; };

describe('terrain presets', () => {
  it("'balanced' is the identity: explicit preset == default (existing determinism holds)", () => {
    for (const n of [64, 128] as const) {
      const a = new Grid(n), b = new Grid(n);
      generateTerrain(a, 42); generateTerrain(b, 42, 'balanced');
      expect(hash(a.heights)).toBe(hash(b.heights));
    }
  });

  it('parameter ranges are within the documented valid bounds', () => {
    for (const id of PRESET_IDS) {
      const p = TERRAIN_PRESETS[id];
      expect(p.relief).toBeGreaterThanOrEqual(0.8); expect(p.relief).toBeLessThanOrEqual(1.2);
      expect(p.talus).toBeGreaterThanOrEqual(0.7); expect(p.talus).toBeLessThanOrEqual(1.3);
      expect(p.smooth).toBeGreaterThanOrEqual(-1); expect(p.smooth).toBeLessThanOrEqual(2);
      expect(p.extraLakes).toBeGreaterThanOrEqual(0); expect(p.extraLakes).toBeLessThanOrEqual(3);
      expect(p.forest).toBeGreaterThanOrEqual(0.6); expect(p.forest).toBeLessThanOrEqual(1.5);
    }
  });

  for (const n of [64, 128, 256] as const) {
    for (const id of PRESET_IDS) {
      it(`${id} x ${n}: invariants, village, zones, deterministic`, () => {
        for (const seed of n === 256 ? [3] : [3, 61]) {
          const g = new Grid(n), g2 = new Grid(n);
          const r = generateTerrain(g, seed, id);
          generateTerrain(g2, seed, id);
          expect(hash(g.heights), 'deterministic').toBe(hash(g2.heights));
          expect(g.checkInvariants(), `${id} ${n} seed ${seed}`).toEqual([]);
          const zones = new Set<number>();
          for (const h of g.heights) zones.add(altitudeZone(n, h));
          expect(zones.size).toBeGreaterThanOrEqual(3);
          const a = r.villageAnchor, c = g.getCorners(a.x, a.y);
          expect(Math.max(...c) - Math.min(...c)).toBe(0);
          expect(r.lakes.length).toBeGreaterThan(0);
          expect(g.tileType.includes(TileType.Water)).toBe(true);
          expect(r.forestDensity.some((v) => v > 60)).toBe(true);
          expect(skiableStats(g).skiableFrac, `skiable ${id} ${n}`).toBeGreaterThan(0.04);
        }
      });
    }
  }

  it('presets do what they say (64, seeds 1-6 averaged)', () => {
    const stat = (id: (typeof PRESET_IDS)[number]): { lakes: number; forest: number; skiable: number; relief: number } => {
      let lakes = 0, forest = 0, skiable = 0, relief = 0;
      for (let seed = 1; seed <= 6; seed++) {
        const g = new Grid(64), r = generateTerrain(g, seed, id);
        lakes += r.lakes.length; forest += r.forestDensity.reduce((s, v) => s + v, 0) / r.forestDensity.length;
        skiable += skiableStats(g).skiableFrac; let hi = 0; for (const h of g.heights) hi = Math.max(hi, h); relief += hi;
      }
      return { lakes: lakes / 6, forest: forest / 6, skiable: skiable / 6, relief: relief / 6 };
    };
    const bal = stat('balanced'), lake = stat('lakeland'), forest = stat('forested'), peaks = stat('peaks'), gentle = stat('gentle');
    expect(lake.lakes).toBeGreaterThanOrEqual(bal.lakes);
    expect(forest.forest).toBeGreaterThan(bal.forest);
    expect(peaks.relief).toBeGreaterThan(gentle.relief);
  });
});
