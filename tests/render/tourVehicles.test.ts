import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DUST, SPRAY, TourVehicles, sleighGeometry, walkerGeometry, scooterGeometry } from '../../src/render/TourVehicles';
import { TOURS } from '../../src/config/tours';
import type { Carrier } from '../../src/sim/attractions/Tour';

describe('TourVehicles (cosmetic carriers)', () => {
  const mk = (list: Carrier[]) => new TourVehicles(() => 2, (_t, out, max) => { out.length = 0; for (const c of list) if (out.length < max) out.push(c); return out; });
  it('draws nothing without rides and one instanced mesh per vehicle kind + a dust and a spray mesh (8 draw calls at most)', () => {
    const v = mk([]);
    v.update(0);
    expect(v.count).toBe(0);
    expect(v.meshes.size).toBe(6);
    expect(v.group.children.length).toBe(8);
    expect(v.dust.count).toBe(0);
    expect(v.spray.count).toBe(0);
  });
  it('places carriers on the ground, per kind, capped at TOURS.maxCarriers; view only (no sim access)', () => {
    const list: Carrier[] = Array.from({ length: 200 }, (_, k) => ({ kind: k % 2 ? 'sleigh' : 'quad', x: k, y: 3, heading: 0, seats: 2, back: 5 }));
    const v = mk(list);
    v.update(1);
    expect(v.count).toBeLessThanOrEqual(TOURS.maxCarriers);
    expect(v.meshes.get('sleigh')!.count + v.meshes.get('quad')!.count).toBe(v.count);
    expect(v.meshes.get('raft')!.count).toBe(0);
    const m = v.meshes.get('quad')!, mat = new THREE.Matrix4();
    m.getMatrixAt(0, mat);
    expect(mat.elements[13]).toBeCloseTo(2, 5); // y = ground height
  });
  it('trails dust puffs behind moving quads only, capped, on the ground', () => {
    const v = mk([{ kind: 'quad', x: 10, y: 3, heading: 0, seats: 2, back: 5 }, { kind: 'sleigh', x: 4, y: 3, heading: 0, seats: 2, back: 5 }]);
    v.update(1);
    expect(v.dust.count).toBe(DUST.perCarrier);
    const m = new THREE.Matrix4(); v.dust.getMatrixAt(0, m);
    expect(m.elements[12]).toBeLessThan(10); // behind (heading 0 = +x)
    expect(m.elements[13]).toBeGreaterThan(2);
    const many = mk(Array.from({ length: 200 }, (_, k) => ({ kind: 'quad', x: k, y: 3, heading: 1, seats: 2, back: 5 }) as Carrier));
    many.update(1);
    expect(many.dust.count).toBeLessThanOrEqual(TOURS.maxCarriers * DUST.perCarrier);
  });
  it('no dust behind the very start of the route (that would be inside the base)', () => {
    const v = mk([{ kind: 'quad', x: 3, y: 3, heading: 0, seats: 2, back: 0.15 }, { kind: 'quad', x: 6, y: 3, heading: 0, seats: 2, back: 0.5 }]);
    v.update(1);
    expect(v.dust.count).toBe(2); // 0 puffs for the first quad, 2 (0.2, 0.4) for the second
  });
  it('trails snow spray behind moving snowscooters only (never behind the route start), capped', () => {
    const v = mk([{ kind: 'scooter', x: 10, y: 3, heading: 0, seats: 1, back: 5 }, { kind: 'quad', x: 4, y: 3, heading: 0, seats: 2, back: 5 }, { kind: 'scooter', x: 3, y: 3, heading: 0, seats: 1, back: 0.1 }]);
    v.update(1);
    expect(v.spray.count).toBe(SPRAY.perCarrier);
    expect(v.dust.count).toBe(DUST.perCarrier);
    const m = new THREE.Matrix4(); v.spray.getMatrixAt(0, m);
    expect(m.elements[12]).toBeLessThan(10);
    const many = mk(Array.from({ length: 200 }, (_, k) => ({ kind: 'scooter', x: k, y: 3, heading: 1, seats: 1, back: 5 }) as Carrier));
    many.update(1);
    expect(many.spray.count).toBeLessThanOrEqual(TOURS.maxCarriers * SPRAY.perCarrier);
  });
  it('the winter carrier meshes stay inside the triangle budget', () => {
    const tris = (g: THREE.BufferGeometry): number => g.attributes.position!.count / 3;
    expect(tris(sleighGeometry())).toBeLessThan(520); // horse + sleigh + 6 guests
    expect(tris(walkerGeometry())).toBeLessThan(200);
    expect(tris(scooterGeometry())).toBeLessThan(200);
    const v = mk([{ kind: 'sleigh', x: 1, y: 1, heading: 0, seats: 6, back: 1 }, { kind: 'walkers', x: 2, y: 1, heading: 0, seats: 1, back: 1 }, { kind: 'scooter', x: 3, y: 1, heading: 0, seats: 1, back: 1 }]);
    v.update(1);
    expect(v.meshes.get('sleigh')!.count + v.meshes.get('walkers')!.count + v.meshes.get('scooter')!.count).toBe(3);
  });
});
