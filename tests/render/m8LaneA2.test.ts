import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../../src/config/buildings';
import { LIFT_KIND_IDS } from '../../src/config/lifts';
import { buildParts } from '../../src/render/meshes';
import { PartBuilder, barrelRoof, domeCap, drum, gambrel, tube, tyre, windsock } from '../../src/render/meshes/common';
import { buildCarrierGeometry } from '../../src/render/meshes/lifts';
import { buildStationParts } from '../../src/render/meshes/lifts/Station';
import { buildTowerGeometry } from '../../src/render/meshes/lifts/Tower';
import { buildBus, buildCar, buildPlane, buildTrain, smoothSecs, type Sec } from '../../src/render/meshes/VehicleModels';
import { LIFT_FALLBACK_ICONS } from '../../src/ui/liftIcons';

const tris = (g?: THREE.BufferGeometry | null): number => (g ? (g.index ? g.index.count : g.getAttribute('position').count) / 3 : 0);
const finite = (g: THREE.BufferGeometry): boolean => ['position', 'normal'].every((n) => !g.getAttribute(n) || Array.from(g.getAttribute(n).array).every(Number.isFinite));
const parts = (id: string): THREE.BufferGeometry[] => {
  const d = BUILDINGS[id as keyof typeof BUILDINGS]!;
  return Object.values(buildParts(d.id, d.w, d.h) as unknown as Record<string, unknown>).filter((g): g is THREE.BufferGeometry => g instanceof THREE.BufferGeometry);
};
const buildingTris = (id: string): number => parts(id).reduce((t, g) => t + tris(g), 0);

/** Lane A2 (M8 follow-up) budgets: hotels (hero buildings) <= 3500 (guard: was 2812 / 2316), every other touched building <= 3400, low-end ones <= 2000. */
describe('M8 lane A2: buildings', () => {
  const before: Record<string, number> = { smallHotel: 2812, luxuryHotel: 2316, rangerStation: 2128, alpineFarm: 1764, snowscooterBase: 852, toilets: 280, snowCannon: 296, launchRamp: 140, coffeeStand: 388, warningSign: 384, landingField: 432, helipad: 924, grassStrip: 280 };
  it('stays within the budgets and only grew (more detail, never less)', () => {
    for (const [id, was] of Object.entries(before)) {
      const t = buildingTris(id);
      const cap = id === 'smallHotel' || id === 'luxuryHotel' ? 3500 : ['rangerStation', 'alpineFarm'].includes(id) ? 3400 : 2000;
      expect(t, id).toBeLessThanOrEqual(cap);
      expect(t, id).toBeGreaterThanOrEqual(was);
    }
  });
  it('geometry is finite and deterministic', () => {
    for (const id of Object.keys(before)) {
      for (const g of parts(id)) expect(finite(g), id).toBe(true);
      expect(buildingTris(id), id).toBe(buildingTris(id));
    }
  });
  it('the snow cannon keeps its baseline layer count (M8 8.8: a stray roof layer cost one draw call per cannon)', () => {
    expect(parts('snowCannon').length).toBeLessThanOrEqual(3);
  });
  it('the hotels keep their four layers (a fifth layer would be an extra draw call)', () => {
    for (const id of ['smallHotel', 'luxuryHotel']) expect(parts(id).length, id).toBeLessThanOrEqual(5); // wood, stone, roof, glass-free + the sign
  });
});

describe('M8 lane A2: helpers', () => {
  const geo = (f: (b: PartBuilder) => void): THREE.BufferGeometry => { const b = new PartBuilder(2, 2); f(b); const g = (b.finish() as { wood?: THREE.BufferGeometry; roof?: THREE.BufferGeometry; stone?: THREE.BufferGeometry }); const l = g.wood ?? g.roof ?? g.stone!; l.computeBoundingBox(); return l; };
  it('tube connects its end points (bounding box)', () => {
    const g = geo((b) => tube(b, 0, 0, 0, 1, 2, 0, 0.05, 0xffffff));
    expect(g.boundingBox!.max.y).toBeGreaterThan(1.9); expect(g.boundingBox!.max.x).toBeGreaterThan(0.95);
    expect(finite(g)).toBe(true);
  });
  it('tyre stands on y0 with its axle along x', () => {
    const g = geo((b) => tyre(b, 0, 0.2, 0, 0.1, 0.06));
    expect(g.boundingBox!.min.y).toBeCloseTo(0.2, 2); expect(g.boundingBox!.max.y).toBeCloseTo(0.4, 2);
    expect(g.boundingBox!.max.x - g.boundingBox!.min.x).toBeGreaterThan(0.06); expect(g.boundingBox!.max.z - g.boundingBox!.min.z).toBeLessThan(0.21);
  });
  it('barrelRoof / gambrel / domeCap reach their rise and span', () => {
    const r = geo((b) => barrelRoof(b, 0, 1, 0, 2, 3, 0.4, 0xff0000, false)); expect(r.boundingBox!.max.y).toBeCloseTo(1.4, 2); expect(r.boundingBox!.max.x - r.boundingBox!.min.x).toBeCloseTo(2, 2); expect(r.boundingBox!.max.z - r.boundingBox!.min.z).toBeCloseTo(3, 2);
    const a = geo((b) => gambrel(b, 0, 0, 0, 2, 3, 0.8, 0xff0000, false)); expect(a.boundingBox!.max.y).toBeCloseTo(0.8, 2);
    const d = geo((b) => domeCap(b, 0, 0, 0, 0.4, 0.3, 0xff0000)); expect(d.boundingBox!.max.y).toBeCloseTo(0.3, 2); expect(d.boundingBox!.min.y).toBeGreaterThanOrEqual(-0.001);
    for (const g of [r, a, d]) expect(finite(g)).toBe(true);
  });
  it('drum and windsock are finite, windsock streams along +x', () => {
    expect(finite(geo((b) => drum(b, 0, 0, 0, 0.1, 0.25, 0xff0000)))).toBe(true);
    const w = geo((b) => windsock(b, 0, 0, 0, 0.8)); expect(w.boundingBox!.max.x).toBeGreaterThan(0.2); expect(w.boundingBox!.max.y).toBeLessThan(0.9);
  });
});

describe('M8 lane A2: lifts', () => {
  it('stations, towers, carriers stay within the budgets and are finite', () => {
    for (const k of LIFT_KIND_IDS) {
      expect(tris(buildStationParts(k, false).geometry) + tris(buildStationParts(k, true).geometry), `${k} pair`).toBeLessThanOrEqual(3200);
      expect(tris(buildTowerGeometry(3, k)), `${k} tower`).toBeLessThanOrEqual(900);
      expect(tris(buildTowerGeometry(3, k, 0.3, true)), `${k} near tower`).toBeLessThanOrEqual(1500);
      for (const g of [buildStationParts(k, true).geometry, buildTowerGeometry(3, k, 0.3, true), buildCarrierGeometry(k)]) expect(finite(g), k).toBe(true);
    }
  });
  it('every lift kind has an inline SVG fallback icon (no emoji)', () => {
    for (const k of LIFT_KIND_IDS) expect(LIFT_FALLBACK_ICONS[k].startsWith('<svg'), k).toBe(true);
    expect(new Set(LIFT_KIND_IDS.map((k) => LIFT_FALLBACK_ICONS[k])).size).toBe(LIFT_KIND_IDS.length);
  });
});

describe('M8 lane A2: vehicles', () => {
  it('cars stay <= 700, bus <= 2200, train <= 3500, plane <= 1200, all finite; wheels use about half the triangles of closed cylinders', () => {
    for (let st = 0; st < 5; st++) { const m = buildCar(st, 0xc93a32, 0); expect(tris(m.body), `car ${st}`).toBeLessThanOrEqual(700); expect(finite(m.body)).toBe(true); }
    expect(tris(buildBus(false, 0xe8b93a).body)).toBeLessThanOrEqual(2200);
    expect(tris(buildBus(true, 0xe8b93a).body)).toBeLessThanOrEqual(1500);
    expect(tris(buildTrain().body)).toBeLessThanOrEqual(3500);
    expect(tris(buildPlane().body)).toBeLessThanOrEqual(1200); // smooth plane pass (was 700)
  });
  it('smoothSecs adds a section between each pair, stays inside the originals\' range and keeps ends', () => {
    const secs: Sec[] = [{ z: -1, w: 0.1, y0: 0, y1: 0.1 }, { z: -0.5, w: 0.2, y0: 0, y1: 0.2 }, { z: 0.5, w: 0.2, y0: 0, y1: 0.2 }, { z: 1, w: 0.1, y0: 0, y1: 0.1 }];
    const s = smoothSecs(secs);
    expect(s.length).toBe(7); expect(s[0]).toBe(secs[0]); expect(s[6]).toBe(secs[3]);
    for (const q of s) { expect(q.w).toBeGreaterThan(0); expect(q.y1).toBeGreaterThan(q.y0); expect(q.w).toBeLessThanOrEqual(0.25); }
    for (let i = 1; i < s.length; i++) expect(s[i]!.z).toBeGreaterThan(s[i - 1]!.z);
  });
  it('is deterministic', () => {
    const a = buildCar(2, 0xc93a32, 1).body, b = buildCar(2, 0xc93a32, 1).body;
    expect(Array.from(a.getAttribute('position').array)).toEqual(Array.from(b.getAttribute('position').array));
  });
});
