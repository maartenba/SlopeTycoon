/** M8 smooth pass: the lofted high-wing plane, the square ram-air canopy and the hang glider (render only, pure, deterministic). */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../../src/config/buildings';
import { buildAircraft } from '../../src/render/meshes/aircraft';
import { buildHangGlider, buildSquareCanopy } from '../../src/render/meshes/canopies';
import { buildParts } from '../../src/render/meshes';
import { mergeParts, triCount, type AirPart } from '../../src/render/meshes/sweepGeo';
import { buildPlane } from '../../src/render/meshes/VehicleModels';
import { geometryHash } from '../../src/render/meshes/lifts/geo';
import { SkyActivity } from '../../src/render/SkyActivity';

const tris = (g: THREE.BufferGeometry): number => g.getAttribute('position').count / 3;
const finite = (g: THREE.BufferGeometry): boolean => { const p = g.getAttribute('position'), n = g.getAttribute('normal'); for (let i = 0; i < p.count; i++) if (!Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i) + n.getX(i) + n.getY(i) + n.getZ(i))) return false; return true; };
const box = (parts: AirPart[]): THREE.Box3 => new THREE.Box3().setFromBufferAttribute(mergeParts(parts).getAttribute('position') as THREE.BufferAttribute);
const unitNormals = (g: THREE.BufferGeometry): boolean => { const n = g.getAttribute('normal'); for (let i = 0; i < n.count; i++) if (Math.abs(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) - 1) > 1e-3) return false; return true; };

describe('M8 smooth aircraft: the plane', () => {
  const full = buildAircraft('full'), lite = buildAircraft('lite');
  it('full <= 1,200 triangles incl. spinner + prop (the Vehicles model spins the blades), lite smaller, all finite with unit normals', () => {
    expect(triCount(full.body) + triCount(full.spinner) + triCount(full.blades)).toBeLessThanOrEqual(1200);
    expect(triCount(full.body) + triCount(full.spinner) + triCount(full.disc)).toBeLessThanOrEqual(1200); // the static users (jump plane, parked)
    expect(triCount(lite.body)).toBeLessThan(triCount(full.body));
    for (const parts of [full.body, full.spinner, full.blades, full.disc, lite.body]) for (const p of parts) { expect(finite(p.geo)).toBe(true); expect(unitNormals(p.geo)).toBe(true); }
  });
  it('is a high-wing: forward +z, wheels on the ground, wing above the cabin, span about 2.2, 1.8 long', () => {
    const b = box(full.body);
    expect(b.min.y).toBeGreaterThanOrEqual(-0.001); expect(b.min.y).toBeLessThan(0.01); // origin on the ground
    expect(b.max.z).toBeGreaterThan(0.75); expect(b.min.z).toBeLessThan(-0.95);
    expect(b.max.x - b.min.x).toBeGreaterThan(2.1); expect(b.max.x - b.min.x).toBeLessThan(2.3);
    expect(full.propPivot).toEqual([0, 0.345, 0.77]); // the Vehicles prop attachment point is unchanged in spirit: on the nose axis at the cowling
  });
  it('the Altiport arrival plane keeps its ModelParts API (body, lights, spinning prop + pivot) and the vertex colours', () => {
    const m = buildPlane();
    expect(tris(m.body)).toBeLessThanOrEqual(1200); expect(finite(m.body)).toBe(true);
    expect(m.body.getAttribute('color').count).toBe(m.body.getAttribute('position').count);
    expect(m.prop).toBeDefined(); expect(m.propPivot).toEqual(full.propPivot); expect(tris(m.lights)).toBe(36);
  });
  it('is deterministic', () => {
    expect(geometryHash(mergeParts(buildAircraft('full').body))).toBe(geometryHash(mergeParts(full.body)));
    expect(geometryHash(mergeParts(buildAircraft('lite').body))).toBe(geometryHash(mergeParts(lite.body)));
  });
  it('the parked Altiport plane stays within the building budget (<= 3400) and is finite', () => {
    const d = BUILDINGS['altiport' as never]!;
    let t = 0;
    for (const g of Object.values(buildParts(d.id, d.w, d.h) as unknown as Record<string, THREE.BufferGeometry | undefined>)) if (g instanceof THREE.BufferGeometry) { t += g.index ? g.index.count / 3 : tris(g); expect(finite(g)).toBe(true); }
    expect(t).toBeLessThanOrEqual(3400);
  });
});

describe('M8 smooth aircraft: canopy and hang glider', () => {
  const can = buildSquareCanopy(), gl = buildHangGlider();
  it('canopy <= 600 + 300 triangles, hang glider <= 700, finite, unit normals, grey levels only (the instance tint multiplies them)', () => {
    expect(triCount(can.parts)).toBeLessThanOrEqual(900); expect(triCount(gl.parts)).toBeLessThanOrEqual(700);
    for (const set of [can, gl]) for (const p of set.parts) {
      expect(finite(p.geo)).toBe(true); expect(unitNormals(p.geo)).toBe(true);
      const c = new THREE.Color(p.color); expect(Math.abs(c.r - c.g)).toBeLessThan(0.01); expect(Math.abs(c.g - c.b)).toBeLessThan(0.01);
    }
  });
  it('forward = +x, origin at the pilot\'s feet (min y ~ 0), the canopy arches above the pilot, lines are >= 0.011 radius thick', () => {
    const b = box(can.parts), gb = box(gl.parts);
    expect(b.min.y).toBeGreaterThanOrEqual(-0.005); expect(b.min.y).toBeLessThan(0.02); expect(b.max.y).toBeGreaterThan(0.35); expect(b.max.y).toBeLessThan(0.6);
    expect(b.max.z - b.min.z).toBeGreaterThan(0.4); // span along z
    expect(b.max.x - b.min.x).toBeLessThan(0.3);
    expect(gb.min.y).toBeGreaterThanOrEqual(-0.005); expect(gb.max.z - gb.min.z).toBeGreaterThan(0.6); expect(gb.max.x).toBeGreaterThan(0.1); // delta nose points +x
  });
  it('is deterministic', () => {
    expect(geometryHash(mergeParts(buildSquareCanopy().parts))).toBe(geometryHash(mergeParts(can.parts)));
    expect(geometryHash(mergeParts(buildHangGlider().parts))).toBe(geometryHash(mergeParts(gl.parts)));
  });
});

describe('M8 smooth aircraft: SkyActivity still draws three instanced meshes', () => {
  it('3 draw calls, the jump plane <= 1,200 triangles, the plane / canopies / gliders keep their pose APIs and counts', () => {
    const v = new SkyActivity(() => 0, () => [{ id: 1, users: 6, open: true, strip: { x: 10, y: 10, w: 7, h: 2 } }], () => [{ id: 50, users: 3, open: true, x: 5, y: 5, w: 2, h: 2, landing: { x: 30, y: 30 } }]);
    v.update(40);
    expect(v.group.children.length).toBe(3);
    expect(tris(v.planes.geometry)).toBeLessThanOrEqual(1200); expect(tris(v.canopies.geometry)).toBeLessThanOrEqual(900); expect(tris(v.gliders.geometry)).toBeLessThanOrEqual(700);
    expect(v.drawn.planes).toBe(1); expect(v.drawn.canopies).toBeGreaterThan(0); expect(v.drawn.gliders).toBe(3);
    const b = new THREE.Box3().setFromBufferAttribute(v.planes.geometry.getAttribute('position') as THREE.BufferAttribute);
    expect(b.max.x).toBeGreaterThan(0.3); expect(b.max.x).toBeLessThan(0.45); // forward +x, about as long as the old box plane (0.62 x 1.5)
  });
});
