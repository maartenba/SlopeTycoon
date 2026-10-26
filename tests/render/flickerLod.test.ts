import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/render/textures', () => ({
  createTerrainTextures: () => ({
    grass: new THREE.Texture(), meadow: new THREE.Texture(), blossom: new THREE.Texture(),
    dirt: new THREE.Texture(), snow: new THREE.Texture(), rock: new THREE.Texture(),
  }),
}));

import { TerrainMesh } from '@/render/TerrainMesh';
import { TreeLayer, TREE_FULL_MAX_VIEW, TREE_LOW_MAX_VIEW } from '@/render/props/Trees';
import { GUEST_FAR_VIEW_HEIGHT, guestFarByView } from '@/render/GuestRenderer';
import { Grid } from '@/world/Grid';
import { generateTerrain } from '@/world/TerrainGen';
import { generateProps } from '@/world/Props';
import { cameraOffset } from '@/render/CameraController';
import { CAMERA_PITCH } from '@/config/balance';

function camFor(size: number, zoom: number): THREE.OrthographicCamera {
  const vh = (size * 0.75) / zoom, aspect = 16 / 9;
  const c = new THREE.OrthographicCamera(-vh * aspect / 2, vh * aspect / 2, vh / 2, -vh / 2, 0.1, size * 4);
  c.position.copy(cameraOffset(Math.PI / 4, CAMERA_PITCH, size).add(new THREE.Vector3(size / 2, 0, size / 2)));
  c.lookAt(size / 2, 0, size / 2);
  c.updateMatrixWorld(true);
  return c;
}

describe('guest impostor switch has hysteresis', () => {
  it('jitter around GUEST_FAR_VIEW_HEIGHT never flips; a real change does', () => {
    let far = guestFarByView(false, GUEST_FAR_VIEW_HEIGHT * 0.9, 1), flips = 0;
    for (let i = 0; i < 400; i++) { const n = guestFarByView(far, GUEST_FAR_VIEW_HEIGHT * (1 + Math.sin(i) * 0.04), 1); if (n !== far) flips++; far = n; }
    expect(flips).toBe(0);
    expect(guestFarByView(false, GUEST_FAR_VIEW_HEIGHT * 1.1, 1)).toBe(true);
    expect(guestFarByView(true, GUEST_FAR_VIEW_HEIGHT * 0.9, 1)).toBe(false);
  });
});

describe('terrain far-LOD swap is atomic (no holes, no double draw)', () => {
  it('zooming in and out on a 256 map: every macro area is covered by exactly one resolution each frame', () => {
    const grid = new Grid(256);
    generateTerrain(grid, 7);
    const t = new TerrainMesh(grid);
    const any = t as unknown as { macros: Array<{ mesh: THREE.Mesh; built: boolean }>; chunks: Array<{ mesh: THREE.Mesh; built: boolean }>; macroChunkIds: number[][]; macroIndexOf(i: number): number; protectedChunks: Set<number> };
    const check = (): void => {
      any.macros.forEach((m, mi) => {
        const chunks = any.macroChunkIds[mi]!;
        const covered = chunks.every((ci) => any.chunks[ci]!.mesh.visible) || m.mesh.visible;
        expect(covered, `macro ${mi} area uncovered`).toBe(true);
        if (m.mesh.visible) for (const ci of chunks) if (!any.protectedChunks.has(ci)) expect(any.chunks[ci]!.mesh.visible, `chunk ${ci} drawn on top of macro ${mi}`).toBe(false);
      });
    };
    const far = camFor(256, 1), near = camFor(256, 4);
    for (let i = 0; i < 40; i++) t.update(far.top - far.bottom); // far LOD builds
    expect(t.lodActive).toBe(true); check();
    for (let i = 0; i < 40; i++) { t.update(near.top - near.bottom); if (t.lodActive === false && i < 30) { /* transition frames */ } check(); }
    expect(t.lodActive).toBe(false);
    for (let i = 0; i < 6; i++) { t.update(far.top - far.bottom); check(); }
  });
  it('macro LOD does not flip when the zoom jitters around the 100-tile threshold', () => {
    const grid = new Grid(256); generateTerrain(grid, 7);
    const t = new TerrainMesh(grid);
    let flips = 0, prev = t.lodActive;
    for (let i = 0; i < 200; i++) { t.update(100 * (1 + Math.sin(i * 1.3) * 0.04)); if (t.lodActive !== prev) flips++; prev = t.lodActive; }
    expect(flips).toBeLessThanOrEqual(1); // at most the initial settle
  });
});

describe('tree layer LOD in iso: hysteresis + cross-fade without holes', () => {
  const grid = new Grid(64);
  const info = generateTerrain(grid, 3);
  const props = generateProps(grid, info.forestDensity, 3);
  const cam = (): THREE.OrthographicCamera => {
    const c = new THREE.OrthographicCamera(-30, 30, 17, -17, 0.1, 1000);
    c.position.set(32 + 40, 60, 32 + 40); c.lookAt(32, 0, 32); c.updateMatrixWorld();
    return c;
  };
  const mode = (l: unknown, level: number): number => ((l as { levels: Array<{ spec: { material: THREE.ShaderMaterial } }> }).levels[level]!.spec.material.uniforms.uXf!.value as THREE.Vector2).x;
  const drawnInstances = (trees: TreeLayer): number => { let n = 0; trees.group.traverse((o) => { const m = o as THREE.InstancedMesh; if (m.isInstancedMesh && m.visible) n += m.count; }); return n; };

  it('jitter around the full->low threshold keeps the level; no fade ever starts', () => {
    const trees = new TreeLayer(props), c = cam(), l = trees.layers[0]!;
    for (let i = 0; i < 40; i++) trees.update(c, TREE_FULL_MAX_VIEW * 0.9);
    expect(l.activeLevel).toBe(0);
    for (let i = 0; i < 300; i++) { trees.update(c, TREE_FULL_MAX_VIEW * (1 + Math.sin(i * 1.9) * 0.04)); expect(l.activeLevel).toBe(0); expect(mode(l, 0)).toBe(0); expect(mode(l, 1)).toBe(0); }
    expect(TREE_LOW_MAX_VIEW).toBeGreaterThan(TREE_FULL_MAX_VIEW);
  });

  it('crossing the threshold cross-fades: the old level stays drawn until the new one is built, then both draw with complementary masks, then only the new one', () => {
    let clock = 1000;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => (clock += 16));
    try {
      const trees = new TreeLayer(props), c = cam(), l = trees.layers[0]!;
      for (let i = 0; i < 40; i++) trees.update(c, 20);
      const before = drawnInstances(trees);
      expect(before).toBeGreaterThan(50);
      let sawBoth = false, minDrawn = Infinity;
      for (let i = 0; i < 120; i++) {
        trees.update(c, TREE_FULL_MAX_VIEW * 1.3);
        minDrawn = Math.min(minDrawn, drawnInstances(trees));
        if (mode(l, 1) === 1 && mode(l, 0) === 2) sawBoth = true;
      }
      expect(l.activeLevel).toBe(1);
      expect(sawBoth).toBe(true);
      expect(minDrawn).toBeGreaterThan(0); // never an empty frame while crossing
      expect(mode(l, 0)).toBe(0); expect(mode(l, 1)).toBe(0); // fade finished, masks off
      let level0Visible = 0;
      for (const cell of (l as unknown as { levels: Array<{ cells: Array<{ mesh: THREE.Mesh | null }> }> }).levels[0]!.cells) if (cell.mesh?.visible) level0Visible++;
      expect(level0Visible).toBe(0);
    } finally { spy.mockRestore(); }
  });
});
