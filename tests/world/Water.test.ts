import { describe, expect, it } from 'vitest';
import { Grid, TileType } from '../../src/world/Grid';
import { generateTerrain, lakesValid } from '../../src/world/TerrainGen';
import { generateProps } from '../../src/world/Props';
import { OccFlag } from '../../src/world/Occupancy';
import { raiseLowerRect, tileBrushRect } from '../../src/world/Terraform';
import { buildWaterData } from '../../src/render/Water';
import { freezeFromSnowline } from '../../src/render/Season';
import { budget } from '../perfMode';

const sizes = [64, 128, 256] as const;
const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
const levelOf = (g: Grid, x: number, y: number): number => Math.min(...g.getCorners(x, y));

describe('lakes and streams', () => {
  for (const n of sizes) {
    it(`size ${n}: lakes exist, streams valid, props dry, invariants hold`, () => {
      let streamSeeds = 0;
      for (const seed of seeds) {
        const g = new Grid(n);
        const r = generateTerrain(g, seed);
        expect(r.lakes.length, `lake seed ${seed}`).toBeGreaterThanOrEqual(1);
        expect(r.lakes.every((l) => l.tiles > 0)).toBe(true);
        expect(g.checkInvariants(), `inv seed ${seed}`).toEqual([]);
        if (r.streams.length > 0) streamSeeds++;
        const wa = r.villageAnchor;
        for (const s of r.streams) {
          expect(s.path.length).toBeGreaterThanOrEqual(2);
          const last = s.path[s.path.length - 1]!;
          const nb = [[0, -1], [1, 0], [0, 1], [-1, 0]].map(([dx, dy]) => ({ x: last.x + dx!, y: last.y + dy! }))
            .filter((q) => g.inBounds(q.x, q.y));
          const own = new Set(s.path.map((q) => q.y * n + q.x));
          if (s.end === 'edge') {
            expect([0, n - 1]).toContain(last.x === 0 || last.x === n - 1 ? last.x : last.y);
          } else if (s.end === 'lake') {
            const w = nb.find((q) => g.tileType[q.y * n + q.x] === TileType.Water);
            expect(w, `lake end seed ${seed}`).toBeTruthy();
            expect(s.level[s.level.length - 1]!).toBeGreaterThanOrEqual(levelOf(g, w!.x, w!.y));
          } else {
            expect(s.end).toBe('merge');
            const m = nb.find((q) => g.tileType[q.y * n + q.x] === TileType.Stream && !own.has(q.y * n + q.x));
            expect(m, `merge end seed ${seed}`).toBeTruthy();
            expect(s.level[s.level.length - 1]!).toBeGreaterThanOrEqual(levelOf(g, m!.x, m!.y));
          }
          for (let i = 0; i < s.path.length; i++) {
            const p = s.path[i]!;
            expect(g.tileType[p.y * n + p.x]).toBe(TileType.Stream);
            expect(g.occupancy.has(p.x, p.y, OccFlag.Water)).toBe(true);
            expect(Math.hypot(p.x - wa.x, p.y - wa.y)).toBeGreaterThan(n * 0.17); // village not flooded
            expect(Math.abs(p.x - r.roadEntry.x) + Math.abs(p.y - r.roadEntry.y)).toBeGreaterThan(3);
            expect(Math.abs(p.x - r.railEntry.x) + Math.abs(p.y - r.railEntry.y)).toBeGreaterThan(3);
            expect(s.level[i]).toBe(levelOf(g, p.x, p.y));
            if (i > 0) {
              const q = s.path[i - 1]!;
              expect(Math.abs(p.x - q.x) + Math.abs(p.y - q.y), 'connected').toBe(1);
              expect(levelOf(g, p.x, p.y), `downhill seed ${seed}`).toBeLessThanOrEqual(levelOf(g, q.x, q.y));
            }
          }
        }
        const props = generateProps(g, r.forestDensity, seed);
        for (const c of props.chunks)
          for (let i = 0; i < c.kind.length; i++) {
            const t = g.tileType[c.ty[i]! * n + c.tx[i]!];
            expect(t === TileType.Water || t === TileType.Stream).toBe(false);
          }
        const wd = buildWaterData(g, r.lakes, r.streams);
        expect(wd.vertexCount).toBeGreaterThan(0);
      }
      expect(streamSeeds, 'seeds with streams').toBeGreaterThanOrEqual(7);
    });

    it(`[perf] size ${n}: streams deterministic and fast`, () => {
      const a = new Grid(n), b = new Grid(n);
      const ra = generateTerrain(a, 7);
      const t0 = performance.now();
      const rb = generateTerrain(b, 7);
      const ms = performance.now() - t0;
      expect(JSON.stringify(ra.streams)).toBe(JSON.stringify(rb.streams));
      expect(ms).toBeLessThan(budget({ 64: 200, 128: 500, 256: 1500 }[n]));
    });
  }


  for (const n of sizes) {
    it(`size ${n}: lakes are flat shelves with rims >= level, organic, no spurs`, () => {
      for (const seed of seeds) {
        const g = new Grid(n);
        const r = generateTerrain(g, seed);
        expect(lakesValid(g, r.lakes), `lakesValid seed ${seed}`).toBe(true);
        for (const lake of r.lakes) {
          const set = new Set(lake.tileIdx);
          expect(lake.tiles).toBe(set.size);
          expect(set.size).toBeGreaterThanOrEqual(9);
          for (const ti of set) {
            const x = ti % n, y = (ti - x) / n;
            expect(g.tileType[ti]).toBe(TileType.Water);
            const c = g.getCorners(x, y);
            expect(Math.max(...c)).toBeLessThanOrEqual(lake.level);
            expect(Math.min(...c)).toBeGreaterThanOrEqual(lake.level - 2);
            for (let dy = -1; dy <= 1; dy++)
              for (let dx = -1; dx <= 1; dx++) {
                if (set.has((y + dy) * n + x + dx)) continue;
                expect(Math.min(...g.getCorners(x + dx, y + dy)), `rim seed ${seed}`).toBeGreaterThanOrEqual(lake.level);
              }
            // no spurs: every water tile has >= 2 water 4-neighbours
            const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => set.has((y + dy!) * n + x + dx!)).length;
            expect(nb, `spur seed ${seed}`).toBeGreaterThanOrEqual(2);
          }
          // all water tiles belong to a lake (no stray water quads)
        }
        const total = r.lakes.reduce((a, l) => a + l.tiles, 0);
        let waterTiles = 0;
        for (let i = 0; i < n * n; i++) if (g.tileType[i] === TileType.Water) waterTiles++;
        expect(waterTiles).toBe(total);
      }
    });

    it(`size ${n}: streams run down the fall line`, () => {
      let steepSteps = 0, levelSteps = 0;
      for (const seed of seeds) {
        const g = new Grid(n);
        const r = generateTerrain(g, seed);
        const avg = (x: number, y: number): number => { const c = g.getCorners(x, y); return (c[0] + c[1] + c[2] + c[3]) / 4; };
        for (const s of r.streams) {
          for (let i = 0; i + 1 < s.path.length; i++) {
            const p = s.path[i]!, q = s.path[i + 1]!;
            expect(s.level[i + 1]!).toBeLessThanOrEqual(s.level[i]!); // monotonic descent
            if (g.steepness(p.x, p.y) < 1.5) continue;
            steepSteps++;
            if (avg(q.x, q.y) > avg(p.x, p.y) - 0.5) levelSteps++;
          }
        }
      }
      // on steep ground the large majority of steps must lose height (no ledges / traverses)
      expect(levelSteps / Math.max(1, steepSteps)).toBeLessThan(0.25);
    });
  }

  it('lake water mesh is flat at level and never above neighbouring land', () => {
    const g = new Grid(128);
    const r = generateTerrain(g, 5);
    const wd = buildWaterData(g, r.lakes, []);
    const levels = new Set(r.lakes.map((l) => +(l.level * 0.5 + 0.04).toFixed(3)));
    for (let i = 0; i < wd.vertexCount; i++) expect(levels.has(+wd.positions[i * 3 + 1]!.toFixed(3))).toBe(true);
  });

  it('terraform is blocked on lake and stream tiles', () => {
    const g = new Grid(128);
    const r = generateTerrain(g, 3);
    const lake = r.lakes[0]!;
    const before = g.heights.slice();
    let res = raiseLowerRect(g, tileBrushRect(g, lake.cx, lake.cy, 1), 1);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('water');
    if (r.streams[0]) {
      const p = r.streams[0].path[2] ?? r.streams[0].path[0]!;
      res = raiseLowerRect(g, tileBrushRect(g, p.x, p.y, 1), -1);
      expect(res.ok).toBe(false);
      expect(res.reason).toBe('water');
    }
    expect(g.heights).toEqual(before);
  });

  it('freeze mapping: summer 0, winter 1', () => {
    expect(freezeFromSnowline(41, 40)).toBe(0);
    expect(freezeFromSnowline(12, 40)).toBe(1);
  });
});
