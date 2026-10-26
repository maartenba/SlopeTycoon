import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('@/render/textures', () => ({
  createTerrainTextures: () => ({
    grass: new THREE.Texture(), meadow: new THREE.Texture(), blossom: new THREE.Texture(),
    dirt: new THREE.Texture(), snow: new THREE.Texture(), rock: new THREE.Texture(),
  }),
}));

import { TerrainMesh } from '@/render/TerrainMesh';
import { cameraOffset } from '@/render/CameraController';
import { CAMERA_PITCH } from '@/config/balance';
import { Grid } from '@/world/Grid';
import { generateTerrain } from '@/world/TerrainGen';

function camFor(size: number, zoom: number): THREE.OrthographicCamera {
  const vh = (size * 0.75) / zoom, aspect = 16 / 9;
  const c = new THREE.OrthographicCamera(-vh * aspect / 2, vh * aspect / 2, vh / 2, -vh / 2, 0.1, size * 4);
  c.position.copy(cameraOffset(Math.PI / 4, CAMERA_PITCH, size).add(new THREE.Vector3(size / 2, 0, size / 2)));
  c.lookAt(size / 2, 0, size / 2);
  c.updateMatrixWorld(true);
  return c;
}

describe('TerrainMesh draw calls', () => {
  it('256 map at default zoom < 60 terrain draw calls (far LOD), and near zoom stays low', () => {
    const grid = new Grid(256);
    generateTerrain(grid, 7);
    const t = new TerrainMesh(grid);
    const cam = camFor(256, 1);
    t.update(cam.top - cam.bottom);
    expect(t.lodActive).toBe(true);
    const far = t.countVisible(cam);
    expect(far).toBeLessThan(60);
    // zoom in until near LOD kicks in; must also stay < 60
    for (const z of [3.9, 5, 8]) {
      const c = camFor(256, z);
      t.update(c.top - c.bottom);
      for (let i = 0; i < 20; i++) t.update(c.top - c.bottom); // finish budgeted builds
      console.log(`256 zoom ${z}: lod=${t.lodActive} visible=${t.countVisible(c)}`);
      expect(t.countVisible(c)).toBeLessThan(60);
    }
    console.log(`256 zoom 1 far-LOD visible meshes: ${far}`);
  });

  it('dirty chunk rebuild updates bounds', () => {
    const grid = new Grid(128);
    generateTerrain(grid, 3);
    const t = new TerrainMesh(grid);
    t.update(50);
    grid.setCornerUnchecked(10, 10, 200);
    t.update(50);
    const m = t.group.children[0] as THREE.Mesh;
    expect(m.geometry.boundingBox!.max.y).toBeGreaterThanOrEqual(100);
  });

  it('far LOD keeps protected (built-on) chunks at full resolution; forceFullRes disables the far LOD', () => {
    const grid = new Grid(256);
    generateTerrain(grid, 7);
    const t = new TerrainMesh(grid);
    const cam = camFor(256, 1), vh = cam.top - cam.bottom;
    t.setProtectedChunks([3 * 8 + 3]); // one chunk + 1-chunk margin = 9
    for (let i = 0; i < 5; i++) t.update(vh);
    expect(t.lodActive).toBe(true);
    const st = t.stats();
    expect(st.protectedChunks).toBe(9);
    expect(st.visibleFine).toBe(9);
    expect(st.visibleMacro).toBe(st.macrosTotal);
    expect(t.countVisible(cam)).toBeLessThan(60);
    t.forceFullRes = true;
    for (let i = 0; i < 30; i++) t.update(vh);
    expect(t.lodActive).toBe(false);
    expect(t.stats().visibleMacro).toBe(0);
  });
});
