// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import * as THREE0 from 'three';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { Grid } from '../../src/world/Grid';
import { buildWaterData, Water } from '../../src/render/Water';
import { RapidsSplash, SPLASH } from '../../src/render/Smoke';
import type { Stream } from '../../src/world/Streams';

// no 2D canvas in happy-dom: the procedural normal map is irrelevant here
vi.mock('../../src/render/textures', () => ({ createWaterNormalTexture: () => new THREE0.DataTexture(new Uint8Array(4), 1, 1) }));

const row = (y: number, x0: number, n: number): Array<{ x: number; y: number }> => Array.from({ length: n }, (_, i) => ({ x: x0 + i, y }));
function mkGrid(): { grid: Grid; streams: Stream[] } {
  const grid = new Grid(64);
  for (let i = 0; i < grid.heights.length; i++) grid.heights[i] = 20;
  const streams: Stream[] = [{ path: row(10, 5, 6), level: Array(6).fill(20), end: 'edge' }];
  for (const p of [...streams[0]!.path, ...row(20, 5, 8)]) grid.tileType[grid.tileIndex(p.x, p.y)] = 6;
  return { grid, streams };
}
const flowOf = (n: number, cls: number, speed: number, frozen = false) => ({ speed: Array(n).fill(speed), cls: Array(n).fill(cls), frozen });

describe('water mesh with dug rivers', () => {
  it('ranges: natural n0 then dug r<id>; 6 vertices per tile; default info (1, 0, -1)', () => {
    const { grid, streams } = mkGrid();
    const d = buildWaterData(grid, [], streams, [{ id: 'r1', path: row(20, 5, 8) }]);
    expect(d.ranges.map((r) => [r.id, r.dug, r.tiles])).toEqual([['n0', false, 6], ['r1', true, 8]]);
    expect(d.vertexCount).toBe((6 + 8) * 6);
    expect(d.ranges[1]!.first).toBe(36);
    expect(d.info.length).toBe(d.vertexCount * 3);
    expect([d.info[0], d.info[1], d.info[2]]).toEqual([1, 0, -1]);
  });

  it('a dug river stays in the SAME single mesh (no extra draw call); flow lands per tile; rapids are listed; ice eases in and out', () => {
    const { grid, streams } = mkGrid();
    const w = new Water(grid, [], streams);
    const before = w.group.children.length;
    w.setRivers([{ id: 'r1', path: row(20, 5, 8) }]);
    expect(w.group.children.length).toBe(before);
    expect(w.group.children.length).toBe(1);
    const tbl: Record<string, ReturnType<typeof flowOf>> = { n0: flowOf(6, 0, 0.5), r1: { speed: [0.4, 0.4, 1.8, 1.8, 1.8, 0.4, 0.4, 0.4], cls: [0, 0, 2, 2, 2, 0, 0, 0], frozen: false } };
    w.applyFlow((id) => tbl[id]);
    const info = (w.group.children[0] as THREE.Mesh).geometry.getAttribute('aInfo') as THREE.BufferAttribute;
    const at = (tile: number, k: number): number => info.array[(36 + tile * 6) * 3 + k]!;
    expect(at(0, 0)).toBeCloseTo(0.4); expect(at(2, 0)).toBeCloseTo(1.8); expect(at(2, 1)).toBe(1); expect(at(2, 2)).toBe(0);
    expect(info.array[0]).toBeCloseTo(0.5); expect(info.array[2]).toBe(-1); // natural: global freeze
    expect(w.rapids.length).toBe(3);
    // freeze: eases to 1 over ~1.5 s, speed keeps a base so it decelerates
    tbl.r1 = { speed: Array(8).fill(0), cls: Array(8).fill(0), frozen: true };
    w.applyFlow((id) => tbl[id]);
    w.update(0); w.update(0.2);
    const mid = info.array[(36) * 3 + 2]!;
    expect(mid).toBeGreaterThan(0); expect(mid).toBeLessThan(1);
    for (let t = 0.4; t < 3; t += 0.2) w.update(t);
    expect(info.array[36 * 3 + 2]).toBe(1);
    expect(w.rapids.length).toBe(0);
    tbl.r1 = flowOf(8, 0, 0.5); w.applyFlow((id) => tbl[id]);
    for (let t = 3; t < 6; t += 0.2) w.update(t);
    expect(info.array[36 * 3 + 2]).toBe(0);
    w.dispose();
  });

  it('rebuilding the mesh (pond dug) keeps the flow of the rivers', () => {
    const { grid, streams } = mkGrid();
    const w = new Water(grid, [], streams);
    w.setRivers([{ id: 'r1', path: row(20, 5, 8) }]);
    w.applyFlow((id) => (id === 'r1' ? flowOf(8, 1, 1.0) : flowOf(6, 0, 0.5)));
    w.setLakes([]);
    const info = (w.group.children[0] as THREE.Mesh).geometry.getAttribute('aInfo') as THREE.BufferAttribute;
    expect(info.array[36 * 3]).toBeCloseTo(1.0); expect(info.array[36 * 3 + 1]).toBeCloseTo(0.5);
  });

  it('the water shader never uses gl_FragCoord (flicker rule) and rapids foam is world-space', () => {
    const src = readFileSync('src/render/Water.ts', 'utf8');
    expect(src).not.toMatch(/gl_FragCoord/);
    expect(src).toMatch(/whitewater/);
  });
});

describe('rapids splash', () => {
  it('picks evenly spaced spots, capped; spawns never exceed the slot cap; hidden when zoomed out or without rapids', () => {
    const list = Array.from({ length: 100 }, (_, i) => ({ x: i, y: 1, z: 0 }));
    expect(RapidsSplash.pick(list, SPLASH.spots)).toHaveLength(SPLASH.spots);
    expect(RapidsSplash.pick(list.slice(0, 5), SPLASH.spots)).toHaveLength(5);
    const s = new RapidsSplash();
    const cam = new THREE.PerspectiveCamera();
    s.update(0.5, cam, 30, [], 0);
    expect(s.mesh.visible).toBe(false);
    s.update(0.5, cam, 30, list, 0);
    expect(s.mesh.visible).toBe(true);
    for (let i = 0; i < 40; i++) s.update(0.31, cam, 30, list, 0);
    const born = (s.mesh.geometry.getAttribute('aBirth') as THREE.BufferAttribute).array as Float32Array;
    expect(born.length).toBe(SPLASH.cap);
    expect((s.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(SPLASH.cap);
    s.update(0.5, cam, 200, list, 0);
    expect(s.mesh.visible).toBe(false);
    expect(s.group.children.length).toBe(1); // one draw call
  });
});
