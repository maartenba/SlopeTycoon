import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TourVehicles } from '../../src/render/TourVehicles';
import { TOURS } from '../../src/config/tours';
import type { Carrier } from '../../src/sim/attractions/Tour';

describe('TourVehicles (cosmetic carriers)', () => {
  const mk = (list: Carrier[]) => new TourVehicles(() => 2, (_t, out, max) => { out.length = 0; for (const c of list) if (out.length < max) out.push(c); return out; });
  it('draws nothing without rides and one instanced mesh per vehicle kind (5 draw calls at most)', () => {
    const v = mk([]);
    v.update(0);
    expect(v.count).toBe(0);
    expect(v.meshes.size).toBe(5);
    expect(v.group.children.length).toBe(5);
  });
  it('places carriers on the ground, per kind, capped at TOURS.maxCarriers; view only (no sim access)', () => {
    const list: Carrier[] = Array.from({ length: 200 }, (_, k) => ({ kind: k % 2 ? 'sleigh' : 'quad', x: k, y: 3, heading: 0, seats: 2 }));
    const v = mk(list);
    v.update(1);
    expect(v.count).toBeLessThanOrEqual(TOURS.maxCarriers);
    expect(v.meshes.get('sleigh')!.count + v.meshes.get('quad')!.count).toBe(v.count);
    expect(v.meshes.get('raft')!.count).toBe(0);
    const m = v.meshes.get('quad')!, mat = new THREE.Matrix4();
    m.getMatrixAt(0, mat);
    expect(mat.elements[13]).toBeCloseTo(2, 5); // y = ground height
  });
});
