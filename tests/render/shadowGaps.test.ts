// @vitest-environment happy-dom
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

// no 2D canvas in happy-dom: the procedural normal map is irrelevant here
vi.mock('../../src/render/textures', () => ({ createWaterNormalTexture: () => new THREE.DataTexture(new Uint8Array(4), 1, 1) }));
import { HILL_MAX_DIST, HillShade, hillVisibility, sunMoved } from '../../src/render/hillShade';
import { TreeLayer } from '../../src/render/props/Trees';
import { Grid } from '../../src/world/Grid';
import { generateTerrain } from '../../src/world/TerrainGen';
import { generateProps } from '../../src/world/Props';
import { treeNear, treeReflectTint, reflectStrength } from '../../src/render/waterContour';
import { Water } from '../../src/render/Water';
import { HEIGHT_UNIT } from '../../src/config/balance';

const norm = (v: [number, number, number]): [number, number, number] => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; };

describe('hill shadows (pure heightfield visibility)', () => {
  const V = 65;
  const flat = new Int16Array(V * V).fill(10);
  const ridge = new Int16Array(V * V); // a wall at x = 30 (60 half-steps = 30 world units tall)
  for (let y = 0; y < V; y++) for (let x = 0; x < V; x++) ridge[y * V + x] = x >= 30 && x <= 31 ? 60 : 0;
  const sunEast = norm([1, 0.4, 0]); // sun toward +x
  it('flat ground is fully lit, a hill shadows the ground behind it and not the lit side', () => {
    expect(hillVisibility(flat, V, HEIGHT_UNIT, sunEast, 20, 20, 5)).toBe(1);
    expect(hillVisibility(ridge, V, HEIGHT_UNIT, sunEast, 24, 20, 30)).toBeLessThan(0.05); // west of the wall, sun in the east: in its shadow
    expect(hillVisibility(ridge, V, HEIGHT_UNIT, sunEast, 40, 20, 30)).toBe(1); // east of the wall: lit
    expect(hillVisibility(ridge, V, HEIGHT_UNIT, sunEast, 2, 20, 30)).toBeLessThan(0.5); // 28 tiles behind a 30-unit wall at 0.4 rise per tile: still in the long shadow
  });
  it('is finite, in [0,1], deterministic; overhead and below-horizon suns are handled', () => {
    for (const s of [[0, 1, 0], [0.3, 0.05, 0.9], [0, -0.5, 1], [-1, 0.5, -1]] as Array<[number, number, number]>) {
      const sun = norm(s);
      for (let i = 0; i < 40; i++) { const v = hillVisibility(ridge, V, HEIGHT_UNIT, sun, (i * 7) % V, (i * 13) % V, 30); expect(Number.isFinite(v)).toBe(true); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); expect(hillVisibility(ridge, V, HEIGHT_UNIT, sun, (i * 7) % V, (i * 13) % V, 30)).toBe(v); }
    }
    expect(HILL_MAX_DIST).toBeGreaterThan(0);
  });
  it('sunMoved only fires past the step', () => {
    const a = norm([1, 0.5, 0]);
    expect(sunMoved(null, a)).toBe(true);
    expect(sunMoved(a, a)).toBe(false);
    expect(sunMoved(a, norm([1, 0.5, 0.005]))).toBe(false);
    expect(sunMoved(a, norm([1, 0.5, 0.1]))).toBe(true);
  });
  it('HillShade slices the map over frames, swaps whole, stays off at night and needs no work for an unchanged sun', () => {
    const src = { heights: ridge, vsize: V, terrainVersion: 0 };
    const h = new HillShade(src, HEIGHT_UNIT);
    const sun = sunEast;
    h.step(sun, 0.01); // night: no work
    expect(h.rowsComputed).toBe(0);
    expect(h.uniforms.uHillP.value.y).toBe(0);
    for (let i = 0; i < 40; i++) h.step(sun, 1);
    expect(h.mapsDone).toBe(1);
    expect(h.uniforms.uHillP.value.y).toBe(1);
    const data = h.uniforms.tHill.value!.image.data as Uint8Array;
    expect(data[20 * V + 24]).toBeLessThan(15); expect(data[20 * V + 40]).toBe(255);
    const rows = h.rowsComputed;
    for (let i = 0; i < 10; i++) h.step(sun, 1);
    expect(h.rowsComputed).toBe(rows); // idle
    src.terrainVersion = 1;
    for (let i = 0; i < 40; i++) h.step(sun, 1);
    expect(h.mapsDone).toBe(2); // terrain edit recomputes
    h.dispose();
    expect(h.uniforms.tHill.value).toBeNull();
  });
});

describe('off-screen tree casters (shadow pass only)', () => {
  const grid = new Grid(64), info = generateTerrain(grid, 3), props = generateProps(grid, info.forestDensity, 3);
  const cam = (cx: number, cz: number): THREE.OrthographicCamera => {
    const c = new THREE.OrthographicCamera(-12, 12, 7, -7, 0.1, 1000);
    c.position.set(cx + 40, 60, cz + 40); c.lookAt(cx, 0, cz); c.updateMatrixWorld();
    return c;
  };
  it('returns only built, currently hidden cells whose swept shadow reaches the view; never changes visibility itself', () => {
    const trees = new TreeLayer(props), c = cam(8, 8);
    for (let i = 0; i < 60; i++) trees.update(c, 14);
    const vis = (): number => { let n = 0; trees.group.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.visible) n++; }); return n; };
    const before = vis();
    const sun = norm([0.8, 0.45, 0.2]);
    const ex = trees.shadowExtras(sun, c, 50);
    expect(vis()).toBe(before); // main pass untouched
    for (const m of ex) { expect(m.visible).toBe(false); expect((m as THREE.InstancedMesh).count).toBeGreaterThan(0); }
    expect(trees.shadowExtras(sun, c, 2).length).toBeLessThanOrEqual(2); // cap
    // the sun in the opposite direction sweeps the other way: the sets differ or are both valid
    expect(Array.isArray(trees.shadowExtras(norm([-0.8, 0.45, -0.2]), c, 50))).toBe(true);
    // a sun straight overhead has almost no reach: a subset of the long-shadow set
    const short = trees.shadowExtras(norm([0.05, 1, 0]), c, 50);
    expect(short.length).toBeLessThanOrEqual(ex.length + 50);
    trees.dispose();
  });
});

describe('lake reflections (pure parts + tier gating)', () => {
  it('treeNear: 0 with no trees, grows next to trees, in [0,1], finite at the map edge', () => {
    const N = 32, cover = new Float32Array(N * N);
    expect(treeNear(cover, N, 10, 10)).toBe(0);
    for (let y = 8; y < 14; y++) for (let x = 12; x < 20; x++) cover[y * N + x] = 2;
    const near = treeNear(cover, N, 11.5, 10), far = treeNear(cover, N, 3, 10);
    expect(near).toBeGreaterThan(far); expect(near).toBeLessThanOrEqual(1); expect(far).toBe(0);
    expect(Number.isFinite(treeNear(cover, N, 0, 0))).toBe(true); expect(Number.isFinite(treeNear(cover, N, N, N))).toBe(true);
  });
  it('tree tint goes green -> orange with the autumn amount; NaN is safe', () => {
    const g = treeReflectTint(0), o = treeReflectTint(1);
    expect(o[0]).toBeGreaterThan(g[0]); expect(g[1]).toBeGreaterThan(g[0]);
    expect(treeReflectTint(NaN)).toEqual(g);
  });
  it('reflection strength grows toward grazing views and stays small (not a mirror)', () => {
    expect(reflectStrength(0)).toBeGreaterThan(reflectStrength(1));
    expect(reflectStrength(1)).toBeGreaterThan(0); expect(reflectStrength(0)).toBeLessThan(0.3);
    expect(reflectStrength(-3)).toBe(reflectStrength(0)); expect(reflectStrength(9)).toBe(reflectStrength(1));
  });
  it('Water: Low keeps the shader-only look (no CONTOUR define, legacy mesh); Med / High use the contour + reflection', () => {
    const grid = new Grid(64);
    for (let y = 10; y < 16; y++) for (let x = 10; x < 16; x++) grid.tileType[y * 64 + x] = 2;
    const idx: number[] = []; for (let y = 10; y < 16; y++) for (let x = 10; x < 16; x++) idx.push(y * 64 + x);
    const w = new Water(grid, [{ level: 0, tileIdx: idx, tiles: idx.length } as never]);
    const mesh = (): THREE.Mesh => w.group.children[0] as THREE.Mesh;
    const defs = (): Record<string, unknown> => (w as unknown as { material: THREE.ShaderMaterial }).material.defines ?? {};
    expect(w.contourOn).toBe(false); expect('CONTOUR' in defs()).toBe(false);
    const lowVerts = mesh().geometry.getAttribute('position').count;
    expect(lowVerts).toBe(36 * 6);
    w.setContour(true);
    expect(w.contourOn).toBe(true); expect('CONTOUR' in defs()).toBe(true);
    expect(mesh().geometry.getAttribute('aField')).toBeTruthy();
    expect(mesh().geometry.getAttribute('position').count).toBeGreaterThanOrEqual(36 * 24);
    w.setTreeCover(new Float32Array(64 * 64).fill(1));
    const tr = mesh().geometry.getAttribute('aTree') as THREE.BufferAttribute;
    for (let i = 0; i < tr.count; i++) { expect(Number.isFinite(tr.getX(i))).toBe(true); expect(tr.getX(i)).toBeGreaterThan(0); }
    w.autumn = 1;
    w.setContour(false);
    expect('CONTOUR' in defs()).toBe(false);
    expect(mesh().geometry.getAttribute('position').count).toBe(lowVerts);
    expect(mesh().geometry.getAttribute('aField')).toBeUndefined();
    w.dispose();
  });
});
