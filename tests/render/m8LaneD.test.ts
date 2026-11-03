import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../../src/config/buildings';
import { LIFT_KIND_IDS, LIFTS } from '../../src/config/lifts';
import { PartBuilder } from '../../src/render/meshes/common';
import { buildParts } from '../../src/render/meshes';
import { createCostumeFigureGeometry, createRacerGeometry } from '../../src/render/meshes/Animals';
import { buildCarrierGeometry } from '../../src/render/meshes/lifts';
import { geometryHash, finishGeometry } from '../../src/render/meshes/lifts/geo';
import { addHood, addHull, curveTube, hullHalfWidth } from '../../src/render/meshes/lifts/loft';
import { buildStationParts } from '../../src/render/meshes/lifts/Station';

const tris = (g?: THREE.BufferGeometry | null): number => (g ? (g.index ? g.index.count : g.getAttribute('position').count) / 3 : 0);
const finite = (g: THREE.BufferGeometry): boolean => ['position', 'normal'].every((n) => !g.getAttribute(n) || Array.from(g.getAttribute(n).array).every(Number.isFinite));
const bubbleOrGondola = LIFT_KIND_IDS.filter((k) => (LIFTS[k].family === 'chair' && LIFTS[k].bubble) || LIFTS[k].family === 'gondola');
const bboxOf = (g: THREE.BufferGeometry): THREE.Box3 => new THREE.Box3().setFromBufferAttribute(g.getAttribute('position') as THREE.BufferAttribute);

/** M8 lane D (smooth bubble hoods + gondola hulls, building weak-spot pass): budgets, finite, deterministic, no extra draw calls (glass stays the 2nd group). */
describe('M8 lane D: smooth carriers', () => {
  it('bubble chairs and gondolas stay <= 900 triangles (near <= 1500), finite, with exactly an opaque + a glass group', () => {
    expect(bubbleOrGondola.length).toBeGreaterThanOrEqual(4);
    for (const k of bubbleOrGondola) {
      for (const near of [false, true]) {
        const g = buildCarrierGeometry(k, near);
        expect(tris(g), `${k} near=${near}`).toBeLessThanOrEqual(near ? 1500 : 900);
        expect(finite(g), k).toBe(true);
        expect(g.groups.length, k).toBe(2); // opaque + translucent glass: same two material slots as before, no new draw call
      }
    }
  });
  it('is deterministic and the near mesh is a superset of the iso one', () => {
    for (const k of bubbleOrGondola) {
      expect(geometryHash(buildCarrierGeometry(k)), k).toBe(geometryHash(buildCarrierGeometry(k)));
      expect(tris(buildCarrierGeometry(k, true)), k).toBeGreaterThan(tris(buildCarrierGeometry(k)) * 0.95);
    }
  });
  it('open chairs, T-bar, cable car and funicular keep their old budgets (<= 780 / near 1300)', () => {
    for (const k of LIFT_KIND_IDS) if (!bubbleOrGondola.includes(k)) {
      expect(tris(buildCarrierGeometry(k)), k).toBeLessThanOrEqual(780);
      expect(tris(buildCarrierGeometry(k, true)), k).toBeLessThanOrEqual(1300);
    }
  });
  it('the carrier still hangs below the cable and never reaches below the old drop (gondola 0.94, chair 0.6)', () => {
    for (const k of bubbleOrGondola) {
      const box = bboxOf(buildCarrierGeometry(k, true));
      expect(box.max.y, k).toBeLessThan(0.1);
      expect(box.min.y, k).toBeGreaterThan(-1.0);
    }
  });
  it('the hood and hull use smooth, outward normals (hood top faces up, hull side faces out)', () => {
    const b = new PartBuilder(1, 1);
    addHood(b, 0, 0, 0, 0.5, 0.3, 0.3, 0xffffff, 6, 12);
    const hood = b.finish().glass!, p = hood.getAttribute('position'), n = hood.getAttribute('normal');
    let up = 0, top = 0;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0.25) { top++; if (n.getY(i) > 0) up++; }
    expect(top).toBeGreaterThan(0);
    expect(up / top).toBeGreaterThan(0.95);
    const h = new PartBuilder(1, 1);
    addHull(h, 0, 0, 0, { L: 0.8, W: 0.5, H: 0.44 }, [{ lo: -2, hi: 2, color: 0xffffff, layer: 'wood' }]);
    const hull = finishGeometry(h), hp = hull.getAttribute('position'), hn = hull.getAttribute('normal');
    let out = 0, side = 0;
    for (let i = 0; i < hp.count; i++) if (Math.abs(hp.getX(i)) > 0.2 && Math.abs(hp.getZ(i)) < 0.2 && Math.abs(hp.getY(i)) < 0.1) { side++; if (hn.getX(i) * Math.sign(hp.getX(i)) > 0) out++; }
    expect(side).toBeGreaterThan(0);
    expect(out / side).toBeGreaterThan(0.95);
    expect(hullHalfWidth(0.5, 0.8, 0)).toBeCloseTo(0.25, 5);
    expect(hullHalfWidth(0.5, 0.8, 0.4)).toBeCloseTo(0, 5);
  });
  it('curveTube is finite and stays near its points', () => {
    const b = new PartBuilder(1, 1);
    curveTube(b, [[0, 0, 0], [0, 0.3, 0.05], [0, 0.6, 0]], 0.02, 0xffffff);
    const g = finishGeometry(b);
    expect(finite(g)).toBe(true);
    const box = bboxOf(g);
    expect(box.max.y).toBeGreaterThan(0.58);
    expect(box.max.y).toBeLessThan(0.65);
  });
  it('lift stations with the new chair6 / 6b / 8b bullwheel hoods stay within the station pair budget (3200)', () => {
    for (const k of ['chair6', 'chair6b', 'chair8b'] as const) expect(tris(buildStationParts(k, false).geometry) + tris(buildStationParts(k, true).geometry), k).toBeLessThanOrEqual(3200);
  });
});

describe('M8 lane D: building weak spots', () => {
  const was: Record<string, number> = { altiport: 1488, beach: 762, kidsGround: 1094, reservoir: 1252, iceRink: 1596, touristOffice: 376 };
  for (const [id, before] of Object.entries(was)) {
    it(`${id} is smoother (grew from ${before}) and stays <= 3400 triangles, finite`, () => {
      const d = BUILDINGS[id as keyof typeof BUILDINGS]!;
      const parts = buildParts(d.id, d.w, d.h) as unknown as Record<string, THREE.BufferGeometry | undefined>;
      let t = 0;
      for (const g of Object.values(parts)) if (g instanceof THREE.BufferGeometry) { t += tris(g); expect(finite(g), id).toBe(true); }
      expect(t, id).toBeGreaterThanOrEqual(before);
      expect(t, id).toBeLessThanOrEqual(3400);
    });
  }
  it('costume figure and racer are finite, small and deterministic', () => {
    for (const make of [createCostumeFigureGeometry, createRacerGeometry]) {
      const g = make();
      expect(finite(g)).toBe(true);
      expect(tris(g)).toBeLessThanOrEqual(1200);
      expect(geometryHash(g)).toBe(geometryHash(make()));
    }
  });
});
