import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('@/render/textures', () => ({
  createTerrainTextures: () => ({
    grass: new THREE.Texture(), meadow: new THREE.Texture(), blossom: new THREE.Texture(),
    dirt: new THREE.Texture(), snow: new THREE.Texture(), rock: new THREE.Texture(),
  }),
}));

import { createSim } from '../../src/game/createSim';
import { SnowFlush, collectSnowFlush } from '../../src/render/SnowFlush';
import { TerrainMesh } from '../../src/render/TerrainMesh';
import { CHUNK_SIZE, Grid } from '../../src/world/Grid';
import { generateTerrain } from '../../src/world/TerrainGen';

/** Fake terrain: records updateSnow calls and mirrors the per-tile attribute exactly like TerrainMesh.updateSnow does. */
class FakeTerrain {
  readonly calls: number[] = [];
  readonly attr: Float32Array;
  private cpr: number;
  constructor(private g: Grid) { this.attr = Float32Array.from(g.snowDepth); this.cpr = g.chunksPerRow; }
  updateSnow(c: number): void {
    this.calls.push(c);
    const x0 = (c % this.cpr) * CHUNK_SIZE, y0 = Math.floor(c / this.cpr) * CHUNK_SIZE, N = this.g.size;
    for (let y = y0; y < y0 + CHUNK_SIZE; y++) for (let x = x0; x < x0 + CHUNK_SIZE; x++) this.attr[y * N + x] = this.g.snowDepth[y * N + x]!;
  }
}

describe('snow flush (sim -> terrain aSnow)', () => {
  it('collectSnowFlush drains the grid dirty list', () => {
    const g = new Grid(64);
    g.setSnow(1, 1, 0.5); g.setSnow(40, 1, 0.5);
    const p = new Set<number>();
    collectSnowFlush(g, p);
    expect([...p].sort()).toEqual([0, 1]);
    collectSnowFlush(g, p);
    expect(p.size).toBe(2);
  });

  it('after a 200-day melt every changed tile reached the terrain attribute', () => {
    const sim = createSim({ size: 64, seed: 5, now: () => 0 });
    const g = sim.grid, ft = new FakeTerrain(g);
    const refreshed: number[] = [];
    const flush = new SnowFlush(g, ft, { refreshChunks: (l) => refreshed.push(...l) });
    sim.tick(1); flush.flushNow(); // drain the seed dirt
    for (let day = 0; day < 200; day++) {
      sim.tick(240);
      flush.step(1 / 30 * 240 / 4); // some frames worth of time per day
    }
    flush.flushNow();
    let worst = 0;
    for (let i = 0; i < g.snowDepth.length; i++) worst = Math.max(worst, Math.abs(ft.attr[i]! - g.snowDepth[i]!));
    expect(worst).toBeLessThan(1e-6);
    expect(ft.calls.length).toBeGreaterThan(0);
    expect(refreshed.length).toBeGreaterThan(0);
  }, 60000);

  it('a date jump to summer flushes every chunk and leaves the attribute snow-free', () => {
    const sim = createSim({ size: 64, seed: 5, now: () => 0 });
    const g = sim.grid, ft = new FakeTerrain(g);
    const flush = new SnowFlush(g, ft, null);
    sim.jumpToDay(65);
    flush.flushNow();
    expect(new Set(ft.calls).size).toBe(g.chunksPerRow ** 2);
    let lit = 0;
    for (const v of ft.attr) if (v > 0.05) lit++;
    expect(lit / ft.attr.length).toBeLessThan(0.01);
  });

  it('props refresh is not dropped when many chunks are pending', () => {
    const g = new Grid(256);
    const seen = new Set<number>();
    const f = new SnowFlush(g, { updateSnow: () => {} }, { refreshChunks: (l) => l.forEach((c) => seen.add(c)) });
    g.markAllSnowDirty();
    f.step(10);
    expect(seen.size).toBe(g.chunksPerRow ** 2);
  });
});

describe('TerrainMesh far-LOD snow (256 maps at default zoom only ever build macro meshes)', () => {
  it('updateSnow refreshes built macros even though no chunk was built', () => {
    const grid = new Grid(256);
    generateTerrain(grid, 7);
    grid.snowDepth.fill(1);
    const t = new TerrainMesh(grid);
    const vh = 256 * 0.75; // > macro threshold
    for (let i = 0; i < 40; i++) t.update(vh);
    expect(t.lodActive).toBe(true);
    const macroMeshes = t.group.children.filter((o) => (o as THREE.Mesh).visible) as THREE.Mesh[];
    expect(macroMeshes.length).toBeGreaterThan(0);
    const snowOf = (m: THREE.Mesh): Float32Array => (m.geometry.getAttribute('aSnow') as THREE.BufferAttribute).array as Float32Array;
    const total = (): number => macroMeshes.reduce((a, m) => a + snowOf(m).reduce((s, v) => s + v, 0), 0);
    expect(total()).toBeGreaterThan(0);
    grid.snowDepth.fill(0);
    grid.markAllSnowDirty();
    for (const c of grid.consumeSnowDirtyChunks()) t.updateSnow(c);
    t.update(vh);
    expect(total()).toBe(0);
    for (const m of macroMeshes) expect((m.geometry.getAttribute('aSnow') as THREE.BufferAttribute).version).toBeGreaterThan(0);
  });
});
