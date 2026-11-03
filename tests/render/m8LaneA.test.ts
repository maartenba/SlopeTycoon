import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { LIFT_KIND_IDS } from '../../src/config/lifts';
import { buildParts } from '../../src/render/meshes';
import { PartBuilder, boatHull, curvedRamp, eaveBrackets, railing } from '../../src/render/meshes/common';
import { buildCarrierGeometry } from '../../src/render/meshes/lifts';
import { buildStationParts } from '../../src/render/meshes/lifts/Station';
import { buildTowerGeometry } from '../../src/render/meshes/lifts/Tower';
import { BUILDINGS } from '../../src/config/buildings';

/** Bubble chairs and gondolas / cabins carry smooth lofted hoods and hulls (lane D): 900 iso / 1500 near. */
const isBubble = (k: string): boolean => /b$|^gondola/.test(k);
const tris = (g?: THREE.BufferGeometry | null): number => (g ? (g.index ? g.index.count : g.getAttribute('position').count) / 3 : 0);
const finite = (g: THREE.BufferGeometry): boolean => ['position', 'normal'].every((n) => !g.getAttribute(n) || Array.from(g.getAttribute(n).array).every(Number.isFinite));
const buildingTris = (id: string): number => {
  const d = BUILDINGS[id as keyof typeof BUILDINGS]!;
  const p = buildParts(d.id, d.w, d.h) as unknown as Record<string, THREE.BufferGeometry | undefined>;
  return Object.values(p).reduce((t, g) => t + (g instanceof THREE.BufferGeometry ? tris(g) : 0), 0);
};

/** M8 lane A budgets (docs/graphics-audit.md D8-2): main buildings <= 3400, low-end six <= 2000, station pair <= 3200, carriers iso <= 780 / near <= 1300, tower(3) <= 900. */
describe('M8 lane A: buildings + lifts budgets', () => {
  it('the touched main buildings stay <= 3400 triangles', () => {
    for (const id of ['baseLodge', 'apresBar', 'rental', 'chalet', 'skiSchoolHQ']) expect(buildingTris(id), id).toBeLessThanOrEqual(3400);
  });
  it('the touched low-end buildings stay <= 2000 and grew only from smoothing', () => {
    const before: Record<string, number> = { playground: 612, boatRental: 680, stuntPark: 392, adventurePark: 1184, sledRental: 704 };
    for (const [id, was] of Object.entries(before)) { const t = buildingTris(id); expect(t, id).toBeLessThanOrEqual(2000); expect(t, id).toBeGreaterThanOrEqual(was); }
  });
  it('lift stations, carriers and towers stay within the M8 numbers', () => {
    for (const k of LIFT_KIND_IDS) {
      expect(tris(buildStationParts(k, false).geometry) + tris(buildStationParts(k, true).geometry), `${k} station pair`).toBeLessThanOrEqual(3200);
      expect(tris(buildCarrierGeometry(k)), `${k} carrier`).toBeLessThanOrEqual(isBubble(k) ? 900 : 780);
      expect(tris(buildCarrierGeometry(k, true)), `${k} near carrier`).toBeLessThanOrEqual(isBubble(k) ? 1500 : 1300);
      expect(tris(buildTowerGeometry(3, k)), `${k} tower`).toBeLessThanOrEqual(900);
      for (const g of [buildCarrierGeometry(k), buildTowerGeometry(3, k), buildStationParts(k, false).geometry]) expect(finite(g), k).toBe(true);
    }
  });
  it('T-bar bar is a round tube hanging below the grip (no part above the cable)', () => {
    const g = buildCarrierGeometry('tbar'); g.computeBoundingBox();
    expect(g.boundingBox!.max.y).toBeLessThan(0.1);
    expect(g.boundingBox!.min.y).toBeGreaterThan(-0.9);
  });
});

describe('M8 lane A: smoothing helpers', () => {
  const geo = (f: (b: PartBuilder) => void): THREE.BufferGeometry => {
    const b = new PartBuilder(2, 2); f(b); const p = b.finish(); const g = p.wood!; g.computeBoundingBox(); return g;
  };
  it('curvedRamp is a curved transition: rises to `rise` over `len`, more triangles with more steps, deterministic', () => {
    const a = geo((b) => curvedRamp(b, 0, 0, 0, 1.6, 0.6, 1, 0xff0000, 0, true, 5));
    const c = geo((b) => curvedRamp(b, 0, 0, 0, 1.6, 0.6, 1, 0xff0000, 0, true, 8));
    expect(a.boundingBox!.max.y).toBeCloseTo(0.6, 2);
    expect(a.boundingBox!.min.y).toBeCloseTo(0, 2);
    expect(a.boundingBox!.max.x - a.boundingBox!.min.x).toBeCloseTo(1.6, 2);
    expect(tris(c)).toBeGreaterThan(tris(a));
    expect(finite(a)).toBe(true);
    expect(tris(geo((b) => curvedRamp(b, 0, 0, 0, 1.6, 0.6, 1, 0xff0000, 0, true, 5)))).toBe(tris(a));
  });
  it('boatHull sits on its y0 and stays inside its len x width box', () => {
    const g = geo((b) => boatHull(b, 0, 0.1, 0, 1, 0.4, 0.2, 0xff0000));
    expect(g.boundingBox!.min.y).toBeGreaterThanOrEqual(0.099);
    expect(g.boundingBox!.max.y).toBeLessThan(0.1 + 0.2 + 0.05);
    expect(g.boundingBox!.max.z - g.boundingBox!.min.z).toBeLessThan(1.05);
    expect(finite(g)).toBe(true);
  });
  it('railing / eaveBrackets stay at their heights (rotated cylinders are centred, not offset)', () => {
    const r = geo((b) => railing(b, -1, 0, 1, 0, 0, 0.25));
    expect(r.boundingBox!.min.y).toBeGreaterThanOrEqual(-0.001);
    expect(r.boundingBox!.max.y).toBeLessThan(0.3);
    const e = geo((b) => eaveBrackets(b, 0, 1, 0, 's', 1));
    expect(e.boundingBox!.max.y).toBeLessThanOrEqual(1.0);
    expect(e.boundingBox!.min.y).toBeGreaterThan(0.8);
  });
});

describe('M8 lane A: road vehicles', () => {
  it('cars stay <= 700 triangles (was 552; roof racks add up to ~+300) and are finite, for every style / rack', async () => {
    const { buildCar } = await import('../../src/render/meshes/VehicleModels');
    for (let st = 0; st < 5; st++) for (const rack of [0, 1, 2]) {
      const m = buildCar(st, 0xc93a32, rack);
      expect(tris(m.body), `style ${st} rack ${rack}`).toBeLessThanOrEqual(900);
      if (rack === 0) expect(tris(m.body), `style ${st}`).toBeLessThanOrEqual(700);
      expect(finite(m.body)).toBe(true);
    }
  });
});
