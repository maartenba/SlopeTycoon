import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Grid } from '../../src/world/Grid';
import { generateTerrain } from '../../src/world/TerrainGen';
import { generateProps } from '../../src/world/Props';
import { TreeLayer, TREE_FULL_MAX_VIEW } from '../../src/render/props/Trees';
import { GuestRenderer } from '../../src/render/GuestRenderer';
import { GuestStore } from '../../src/sim/guests/Guest';
import { AttractionActivity, type ActivityView } from '../../src/render/AttractionActivity';
import { CoverageOverlay } from '../../src/render/CoverageOverlay';
import { Coverage } from '../../src/sim/Coverage';

const cam = (n: number, h = 30): THREE.OrthographicCamera => {
  const c = new THREE.OrthographicCamera(-h, h, h / 2, -h / 2, 0.1, 1000);
  c.position.set(n / 2 + 40, 60, n / 2 + 40); c.lookAt(n / 2, 0, n / 2); c.updateMatrixWorld();
  return c;
};

describe('tree layer quality + per-frame skipping', () => {
  const grid = new Grid(64);
  const info = generateTerrain(grid, 3);
  const props = generateProps(grid, info.forestDensity, 3);

  it('a static camera costs no per-frame pass; changes (camera, stale chunks) wake it up', () => {
    const trees = new TreeLayer(props);
    const c = cam(64);
    for (let i = 0; i < 40; i++) trees.update(c, 20); // lets the build budget finish
    const l = trees.layers[0]!;
    const p0 = l.passes;
    for (let i = 0; i < 100; i++) trees.update(c, 20);
    expect(l.passes).toBe(p0);
    trees.refreshChunks([0]);
    trees.update(c, 20);
    expect(l.passes).toBe(p0 + 1);
    c.position.x += 3; c.lookAt(32, 0, 32); c.updateMatrixWorld();
    trees.update(c, 20);
    expect(l.passes).toBe(p0 + 2);
  });

  it('lodScale moves the LOD switch; density thins the drawn instances deterministically', () => {
    const trees = new TreeLayer(props);
    const l = trees.layers[0]!;
    expect(l.levelFor(TREE_FULL_MAX_VIEW + 2)).toBe(1);
    trees.setQuality(0.7, 1);
    expect(l.levelFor(TREE_FULL_MAX_VIEW * 0.9)).toBe(1); // cheaper LOD sooner
    trees.setQuality(1.25, 1);
    expect(l.levelFor(TREE_FULL_MAX_VIEW + 2)).toBe(0);
    const count = (d: number): number => {
      const t = new TreeLayer(props);
      t.setQuality(1, d);
      const c = cam(64, 40);
      for (let i = 0; i < 60; i++) t.update(c, 20);
      let n = 0;
      t.group.traverse((o) => { const m = o as THREE.InstancedMesh; if (m.isInstancedMesh && m.visible) n += m.count; });
      return n;
    };
    const full = count(1), half = count(0.5), again = count(0.5);
    expect(full).toBeGreaterThan(50);
    expect(half).toBe(again);
    expect(half).toBeLessThan(full * 0.75);
    expect(half).toBeGreaterThan(full * 0.25);
  });
});

describe('GuestRenderer culling + static skip', () => {
  const mk = (): { st: GuestStore; r: GuestRenderer } => {
    const st = new GuestStore(500);
    for (let i = 0; i < 300; i++) st.add({ x: i < 150 ? 32 + (i % 10) : 5, y: i < 150 ? 32 + ((i / 10) | 0) % 10 : 5, z: 0, type: 0, skill: 0, budget: 1, group: 0, mode: 0, overnight: false, leaveDay: 1, tick: 0 });
    return { st, r: new GuestRenderer(st) };
  };
  it('only guests in view are drawn when a camera is given', () => {
    const { r } = mk();
    const c = cam(64, 14);
    r.update(1, 14, c, 1);
    expect(r.drawnCount).toBeGreaterThan(100); // the guests near the target (a few at the view corners are cut too)
    expect(r.drawnCount).toBeLessThanOrEqual(150);
    expect(r.culled).toBeGreaterThanOrEqual(150); // all 150 far away ones
    expect(r.drawnCount + r.culled).toBe(300);
    const { r: r2 } = mk();
    r2.update(1, 14); // no camera: everything
    expect(r2.drawnCount).toBe(300);
  });
  it('skips the whole update when nothing changed (paused + static camera)', () => {
    const { st, r } = mk();
    const c = cam(64, 14);
    r.update(1, 14, c, 7);
    const arr = (r.group.children[0] as THREE.InstancedMesh).instanceMatrix.array as Float32Array;
    const snap = arr.slice(0, 16);
    st.x[0] = 33.5; // would change matrix 0 if the update ran
    r.update(1, 14, c, 7);
    expect(Array.from(arr.slice(0, 16))).toEqual(Array.from(snap));
    r.update(1, 14, c, 8); // new tick -> runs
    expect(arr[12]).not.toBe(snap[12]);
  });
  it('quality scale moves the impostor switch', () => {
    const { r } = mk();
    r.farScale = 0.5;
    r.update(1, 40);
    expect(r.far).toBe(true);
    r.farScale = 1.25;
    r.update(1, 40);
    expect(r.far).toBe(false);
  });
});

describe('attraction activity + coverage overlay throttling', () => {
  it('poses are not recomputed while the tick is unchanged', () => {
    let calls = 0;
    const view: ActivityView = { id: 1, type: 'iceRink', x: 3, y: 3, w: 5, h: 4, users: 4, open: true };
    const a = new AttractionActivity(() => { calls++; return [view]; }, () => 0);
    a.update(100, 20); a.update(100, 20); a.update(100, 20);
    expect(calls).toBe(1);
    a.update(100.4, 20);
    expect(calls).toBe(2);
    a.update(100.4, 200); a.update(100.4, 20); // far then near again at the same tick -> recompute
    expect(calls).toBe(3);
  });
  it('coverage overlay coalesces bursts of invalidations', () => {
    const grid = new Grid(64);
    const ov = new CoverageOverlay(grid, new Coverage(64), () => [], () => ({ getPisteDifficultyAt: () => 0, isConnectedBuilding: () => true }));
    ov.setMode('snow');
    ov.minRepaintMs = 1e9;
    ov.update(); // first paint is immediate (setMode resets the throttle)
    expect(ov.repaints).toBe(1);
    for (let i = 0; i < 20; i++) { ov.invalidate(); ov.update(); }
    expect(ov.repaints).toBe(1);
    ov.minRepaintMs = 0;
    ov.update();
    expect(ov.repaints).toBe(2);
  });
});
