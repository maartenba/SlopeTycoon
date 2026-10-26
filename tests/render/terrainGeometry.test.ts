import { describe, expect, it } from 'vitest';
import { Grid, CHUNK_SIZE } from '@/world/Grid';
import { generateTerrain } from '@/world/TerrainGen';
import { buildTerrainGeometry, diagonalNS, fillSnow } from '@/render/TerrainGeometry';
import { generateTexturePixels, TERRAIN_TEX_KINDS } from '@/render/textures';
import { budget } from '../perfMode';

describe('terrain geometry', () => {
  const grid = new Grid(128);
  generateTerrain(grid, 42);

  it('vertex heights match grid corners and counts are right', () => {
    const d = buildTerrainGeometry(grid, 32, 64, CHUNK_SIZE, CHUNK_SIZE, 1);
    expect(d.tileVertexCount).toBe(32 * 32 * 6);
    const valid = new Set<string>();
    for (let vy = 64; vy <= 96; vy++) for (let vx = 32; vx <= 64; vx++) valid.add(`${vx},${grid.getCorner(vx, vy) * 0.5},${vy}`);
    for (let i = 0; i < d.tileVertexCount; i++) {
      expect(valid.has(`${d.positions[i * 3]},${d.positions[i * 3 + 1]},${d.positions[i * 3 + 2]}`)).toBe(true);
    }
    // normals face up for tile triangles
    for (let i = 0; i < d.tileVertexCount; i++) expect(d.normals[i * 3 + 1]).toBeGreaterThanOrEqual(0);
  });

  it('chooses diagonal by corner heights', () => {
    expect(diagonalNS(2, 0, 0, 0)).toBe(false); // corner up at n -> e-w diagonal
    expect(diagonalNS(0, 2, 0, 0)).toBe(true);
    expect(diagonalNS(2, 0, 2, 0)).toBe(true); // tie / ridge n-s
    expect(diagonalNS(0, 1, 2, 1)).toBe(false);
  });

  it('diagonal is used in geometry', () => {
    const g = new Grid(128);
    g.setCornerUnchecked(0, 0, 2); // tile (0,0) n corner high
    const d = buildTerrainGeometry(g, 0, 0, 4, 4, 1);
    // first tile uses e-w diagonal: tri0 = n,w,e -> vertex 2 is e = (1, 0, 0)
    expect([d.positions[6], d.positions[7], d.positions[8]]).toEqual([1, 0, 0]);
    expect([d.positions[0], d.positions[1], d.positions[2]]).toEqual([0, 1, 0]);
  });

  it('adds skirts only on map edges and bounds contain geometry', () => {
    const inner = buildTerrainGeometry(grid, 32, 32, 32, 32, 1);
    expect(inner.vertexCount).toBe(inner.tileVertexCount);
    const edge = buildTerrainGeometry(grid, 0, 0, 32, 32, 1);
    expect(edge.vertexCount).toBe(edge.tileVertexCount + 2 * 32 * 6);
    expect(edge.min[1]).toBeLessThan(0);
  });

  it('macro LOD yields fewer vertices', () => {
    const d = buildTerrainGeometry(grid, 0, 0, 128, 128, 4);
    expect(d.tileVertexCount).toBe(32 * 32 * 6);
  });

  it('provides smoothed steepness and smooth normals', () => {
    const g = new Grid(128);
    g.setCornerUnchecked(10, 10, 6);
    const d = buildTerrainGeometry(g, 0, 0, 32, 32, 1);
    expect(d.steep.length).toBe(d.vertexCount);
    expect(d.smoothNormals.length).toBe(d.vertexCount * 3);
    let maxS = 0;
    for (let i = 0; i < d.tileVertexCount; i++) {
      maxS = Math.max(maxS, d.steep[i]!);
      expect(Math.hypot(d.smoothNormals[i * 3]!, d.smoothNormals[i * 3 + 1]!, d.smoothNormals[i * 3 + 2]!)).toBeCloseTo(1, 4);
    }
    expect(maxS).toBeGreaterThan(2); // spike corner averaged over 4 tiles of height 6
    expect(maxS).toBeLessThan(6.01);
    // flat far-away vertices have no steepness
    expect(d.steep[(30 * 32 + 30) * 6]).toBe(0);
  });

  it('fillSnow only rewrites snow', () => {
    grid.setSnow(33, 65, 0.7);
    const d = buildTerrainGeometry(grid, 32, 64, 32, 32, 1);
    const out = new Float32Array(d.snow.length);
    const n = fillSnow(grid, 32, 64, 32, 32, 1, out);
    expect(n).toBe(d.tileVertexCount);
    expect(Array.from(out)).toEqual(Array.from(d.snow));
    expect(out[(1 * 32 + 1) * 6]).toBeCloseTo(0.7);
  });

  it('[perf] chunk rebuild is fast (<5ms median)', () => {
    for (let i = 0; i < 5; i++) buildTerrainGeometry(grid, 0, 0, 64, 64, 1);
    const times: number[] = [];
    for (let i = 0; i < 30; i++) {
      const t = performance.now();
      buildTerrainGeometry(grid, 32, 32, 32, 32, 1);
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    expect(times[15]!).toBeLessThan(budget(5));
  });
});

describe('procedural textures', () => {
  it('[perf] are deterministic, tileable-sized and fast', () => {
    const t = performance.now();
    const a = TERRAIN_TEX_KINDS.map((k) => generateTexturePixels(k, 1337));
    const ms = performance.now() - t;
    const b = TERRAIN_TEX_KINDS.map((k) => generateTexturePixels(k, 1337));
    a.forEach((p, i) => expect(Array.from(p.slice(0, 2000))).toEqual(Array.from(b[i]!.slice(0, 2000))));
    expect(a[0]!.length).toBe(128 * 128 * 4);
    expect(ms).toBeLessThan(budget(300));
  });
});

import { LOD_BIAS, SKIRT_KIND } from '@/render/TerrainGeometry';
import { generateTerrain as genT } from '@/world/TerrainGen';
import { Grid as G2 } from '@/world/Grid';
import { surfaceHeightAt } from '@/render/meshes/Paths';

describe('far LOD never rises above the fine surface (roads/buildings stay visible)', () => {
  it('coarse triangle heights <= fine surface heights at every sampled point', () => {
    const grid = new G2(64);
    genT(grid, 11);
    const d = buildTerrainGeometry(grid, 0, 0, 64, 64, 4);
    let worst = -Infinity;
    for (let i = 0; i < d.tileVertexCount; i += 3) { // sample the centroid of every coarse triangle
      const cx = (d.positions[i * 3]! + d.positions[i * 3 + 3]! + d.positions[i * 3 + 6]!) / 3;
      const cy = (d.positions[i * 3 + 1]! + d.positions[i * 3 + 4]! + d.positions[i * 3 + 7]!) / 3;
      const cz = (d.positions[i * 3 + 2]! + d.positions[i * 3 + 5]! + d.positions[i * 3 + 8]!) / 3;
      worst = Math.max(worst, cy - surfaceHeightAt(grid, cx, cz));
    }
    expect(worst).toBeLessThanOrEqual(0.05);
    expect(LOD_BIAS).toBeGreaterThan(0);
  });
  it('skirts use the constant SKIRT_KIND (no xz-sampled texture on vertical walls)', () => {
    const grid = new G2(64);
    genT(grid, 5);
    const d = buildTerrainGeometry(grid, 0, 0, 64, 64, 1);
    expect(d.vertexCount).toBeGreaterThan(d.tileVertexCount);
    for (let i = d.tileVertexCount; i < d.vertexCount; i++) expect(d.kind[i]).toBe(SKIRT_KIND);
  });
});
