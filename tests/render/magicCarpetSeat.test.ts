import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Grid } from '@/world/Grid';
import { BuildingMeshes } from '@/render/meshes';
import { BuildingsView } from '@/render/BuildingsView';
import { gentleSeat } from '@/sim/PlaceBuilding';
import { HEIGHT_UNIT } from '@/config/balance';

/** Regression (owner screenshot, 0.6.0): the Magic Carpet was a rigid flat mesh on the LOWEST corner, so on a real slope (up to 6 half-steps over 6 tiles = 3 units) its high end sank into the snow and it looked like
 *  a blue trough / boat. It now lies on the footprint's best-fit plane (pitch + roll). */
function slopeGrid(axis: 'x' | 'y', perTile: number, rise = 0): Grid {
  const g = new Grid(64);
  for (let vy = 0; vy <= 64; vy++) for (let vx = 0; vx <= 64; vx++) g.setCornerUnchecked(vx, vy, 60 + Math.round((axis === 'x' ? vx : vy) * perTile) + rise);
  return g;
}
const make = (grid: Grid, x: number, y: number, w: number, h: number, rot: number) => {
  const b = { id: 1, type: 'magicCarpet', x, y, w, h, rot } as never;
  const scene = new THREE.Scene();
  const view = new BuildingsView(scene, new BuildingMeshes(), grid, { all: () => [b] } as never);
  view.sync();
  return view.get(1)!;
};
/** Terrain height at world (x, z) for the plane grid (linear, so bilinear == plane). */
const ground = (grid: Grid, x: number, z: number): number => {
  const tx = Math.min(62, Math.floor(x)), ty = Math.min(62, Math.floor(z)), u = x - tx, v = z - ty;
  const c = (a: number, b: number) => grid.getCorner(a, b);
  return ((c(tx, ty) * (1 - u) + c(tx + 1, ty) * u) * (1 - v) + (c(tx, ty + 1) * (1 - u) + c(tx + 1, ty + 1) * u) * v) * HEIGHT_UNIT;
};
const worldVerts = (g: THREE.Object3D): THREE.Vector3[] => {
  g.updateMatrixWorld(true); const out: THREE.Vector3[] = [];
  g.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh) return; const p = m.geometry.getAttribute('position'); for (let i = 0; i < p.count; i++) out.push(new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld)); });
  return out;
};

describe('Magic Carpet lies on the slope', () => {
  for (const rot of [0, 1, 2, 3]) for (const per of [1, -1]) it(`rot ${rot}, slope ${per} half-steps per tile: long axis follows the ground, nothing sinks, nothing hovers`, () => {
    const alongX = rot % 2 === 1; const grid = slopeGrid(alongX ? 'x' : 'y', per);
    const w = alongX ? 6 : 1, h = alongX ? 1 : 6, x = 20, y = 20;
    const g = make(grid, x, y, w, h, rot);
    const vs = worldVerts(g);
    // 1. no vertex of the belt (the lowest layer of the mesh) sinks below the terrain by more than 0.05 (the dark base slab is the lowest part), and the base is not above it by more than 0.2
    const rel = vs.map((v) => v.y - ground(grid, v.x, v.z));
    expect(Math.min(...rel)).toBeGreaterThan(-0.06);
    const lowest = vs.filter((v) => v.y - ground(grid, v.x, v.z) < 0.2);
    expect(lowest.length).toBeGreaterThan(20); // the base slab hugs the ground along its whole length, at both ends
    const axisOf = (v: THREE.Vector3): number => (alongX ? v.x : v.z);
    const lo = Math.min(...vs.map(axisOf)), hi = Math.max(...vs.map(axisOf));
    expect(Math.min(...lowest.map(axisOf))).toBeLessThan(lo + 1); expect(Math.max(...lowest.map(axisOf))).toBeGreaterThan(hi - 1);
    // 2. the long axis of the mesh follows the lift direction (its bounding box is long along the footprint axis and rises with the ground)
    const box = new THREE.Box3().setFromPoints(vs); const size = box.getSize(new THREE.Vector3());
    expect(alongX ? size.x : size.z).toBeGreaterThan(4.9); expect(alongX ? size.z : size.x).toBeLessThan(1.2);
    expect(size.y).toBeGreaterThan(Math.abs(per) * HEIGHT_UNIT * 5 - 0.05); // it rises with the ground: not a flat slab
    // 3. low: the part above the ground stays under the canopy height (0.95 + sign) at any point
    expect(Math.max(...rel)).toBeLessThan(1.8);
  });

  it('gentleSeat: centre height, flat ground gives no tilt, and the pitch follows the rise per tile', () => {
    const flat = slopeGrid('y', 0); const s0 = gentleSeat(flat, 10, 10, 1, 6, 0);
    expect(s0.pitch).toBeCloseTo(0); expect(s0.roll).toBeCloseTo(0); expect(s0.y).toBeCloseTo(60 * HEIGHT_UNIT);
    const up = slopeGrid('y', 1); const s = gentleSeat(up, 10, 10, 1, 6, 0);
    expect(s.pitch).toBeCloseTo(-Math.atan(HEIGHT_UNIT), 5); // +z end is higher: nose up = negative rotation.x
    expect(gentleSeat(up, 10, 10, 1, 6, 2).pitch).toBeCloseTo(Math.atan(HEIGHT_UNIT), 5); // rotated 180: the loading end is the low one
    expect(s.y).toBeCloseTo((60 + 10 + 3) * HEIGHT_UNIT, 5);
  });
});
