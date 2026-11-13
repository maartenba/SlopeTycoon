import { describe, expect, it } from 'vitest';
import { Grid, TileType } from '../../src/world/Grid';
import { CONTOUR_LEVEL, CONTOUR_SUB, cornerField, kernel, makeField, tileCells, triangleHeight } from '../../src/render/waterContour';
import { buildWaterData } from '../../src/render/Water';
import { diagonalNS } from '../../src/render/TerrainGeometry';

function pond(shape: 'L' | 'square'): { grid: Grid; idx: number[] } {
  const g = new Grid(64);
  const idx: number[] = [];
  const put = (x: number, y: number): void => { g.tileType[y * 64 + x] = TileType.Water; idx.push(y * 64 + x); };
  if (shape === 'square') for (let y = 8; y < 16; y++) for (let x = 8; x < 16; x++) put(x, y);
  else { for (let y = 8; y < 16; y++) for (let x = 8; x < 11; x++) put(x, y); for (let y = 13; y < 16; y++) for (let x = 11; x < 16; x++) put(x, y); }
  return { grid: g, idx };
}

describe('water contour (pure maths)', () => {
  it('field is finite, in [0,1], 0.5 on a straight shore, ~1 deep inside, 0 far away', () => {
    const { grid } = pond('square');
    const f = makeField(grid);
    expect(f.corner(8, 12)).toBeCloseTo(0.5, 5); // straight west shore
    expect(f.corner(12, 12)).toBeGreaterThan(0.95);
    expect(f.corner(1, 1)).toBe(0);
    expect(kernel(0.5) + kernel(-0.5) + kernel(1.5) + kernel(-1.5)).toBeCloseTo(1, 6); // partition of unity
    for (let y = 0; y <= 32; y++) for (let x = 0; x <= 32; x++) { const v = f.corner(x, y); expect(Number.isFinite(v)).toBe(true); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    expect(f.at(8, 12)).toBeCloseTo(f.corner(8, 12), 6);
    expect(f.at(8.25, 12.5)).toBeGreaterThan(0.5); // monotone into the water
    expect(f.at(7.75, 12.5)).toBeLessThan(0.5);
  });
  it('rounds a convex corner (contour cuts inside) and fills a concave corner of an L pond', () => {
    const { grid } = pond('L');
    expect(cornerField(grid, 8, 8)).toBeLessThan(CONTOUR_LEVEL); // convex outer corner: dropped below the waterline
    expect(cornerField(grid, 11, 13)).toBeGreaterThan(0.6); // concave inner corner vertex: well inside
  });
  it('a one-tile river tile stays above the waterline along its centre', () => {
    const g = new Grid(64);
    for (let x = 4; x < 28; x++) g.tileType[10 * 64 + x] = TileType.Stream;
    const f = makeField(g);
    expect(f.at(14.5, 10.5)).toBeCloseTo(0.75, 5);
    expect(f.at(14.5, 10)).toBeCloseTo(CONTOUR_LEVEL, 5); // the bank is the tile edge
    expect(f.at(14.5, 9)).toBeLessThan(CONTOUR_LEVEL + 0.1);
  });
  it('tileCells: stable 24 vertices per tile, inside the tile, both diagonals', () => {
    for (const ns of [true, false]) { const c = tileCells(ns); expect(c.length).toBe(CONTOUR_SUB * CONTOUR_SUB * 6); for (const [u, v] of c) { expect(u).toBeGreaterThanOrEqual(0); expect(u).toBeLessThanOrEqual(1); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); } }
  });
  it('triangleHeight is exact at the corners and on the shared diagonal', () => {
    for (const hs of [[0, 0, 4, 2], [3, 1, 1, 6], [2, 2, 2, 2]] as Array<[number, number, number, number]>) {
      const [n, e, s, w] = hs;
      expect(triangleHeight(hs, 0, 0)).toBeCloseTo(n); expect(triangleHeight(hs, 1, 0)).toBeCloseTo(e);
      expect(triangleHeight(hs, 1, 1)).toBeCloseTo(s); expect(triangleHeight(hs, 0, 1)).toBeCloseTo(w);
      const mid = diagonalNS(n, e, s, w) ? (n + s) / 2 : (e + w) / 2;
      expect(triangleHeight(hs, 0.5, 0.5)).toBeCloseTo(mid);
    }
  });
});

describe('contour water geometry', () => {
  const lakeOf = (g: Grid, idx: number[]) => ({ level: 0, tileIdx: idx, tiles: idx.length } as never);
  it('is deterministic, finite, 24 vertices per water tile + only wedge fringe, legacy path untouched', () => {
    const { grid, idx } = pond('L');
    const lake = lakeOf(grid, idx);
    const a = buildWaterData(grid, [lake], [], [], { contour: true }), b = buildWaterData(grid, [lake], [], [], { contour: true });
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(a.field.length).toBe(a.vertexCount);
    for (const v of a.positions) expect(Number.isFinite(v)).toBe(true);
    for (const v of a.field) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    const legacy = buildWaterData(grid, [lake], []);
    expect(legacy.vertexCount).toBe(idx.length * 6);
    expect(a.vertexCount % 24).toBe(0);
    expect(a.vertexCount / 24).toBeGreaterThanOrEqual(idx.length);
    expect(a.vertexCount / 24).toBeLessThanOrEqual(idx.length + 4); // the L has a single concave wedge
    // triangle budget: a water-only layer; +300 % of a ~tiny layer is <= 5 % of any real scene (docs/graphics-m8.md)
    expect(a.vertexCount / 3).toBe((a.vertexCount / 24) * 8);
  });
  it('water-free grids build nothing in either mode', () => {
    const g = new Grid(64);
    expect(buildWaterData(g, [], [], [], { contour: true }).vertexCount).toBe(0);
  });
});
