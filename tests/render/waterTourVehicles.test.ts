/** Phase 6 Task 24: rafts, canyoners and the raft splash (docs/water-tours.md). Pure geometry / instancing checks (no WebGL). */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TourVehicles, canyonerGeometry, raftGeometry } from '../../src/render/TourVehicles';
import { RapidsSplash, SPLASH } from '../../src/render/Smoke';
import { TOURS } from '../../src/config/tours';
import type { Carrier } from '../../src/sim/attractions/Tour';

const tris = (g: THREE.BufferGeometry): number => (g.index ? g.index.count : g.attributes.position!.count) / 3;
const mk = (list: Carrier[]) => new TourVehicles((x) => 2 + x * 0.1, (_t, out, max) => { out.length = 0; for (const c of list) if (out.length < max) out.push(c); return out; });

describe('raft + canyoner geometry', () => {
  it('stay within a small triangle budget, vertex coloured, no uvs (instanced, one draw call per kind)', () => {
    const r = raftGeometry(), c = canyonerGeometry();
    expect(tris(r)).toBeLessThan(450); expect(tris(c)).toBeLessThan(200);
    for (const g of [r, c]) { expect(g.attributes.color).toBeDefined(); expect(g.attributes.uv).toBeUndefined(); }
    r.computeBoundingBox();
    expect(r.boundingBox!.max.x).toBeLessThan(0.45); // fits a river tile
    expect(r.boundingBox!.max.z).toBeLessThan(0.45);
  });
});

describe('water carriers in TourVehicles', () => {
  it('a raft sits on the water (a little above the surface), a canyoner leans with the slope, kinds are separate instanced meshes', () => {
    const v = mk([{ kind: 'raft', x: 10, y: 3, heading: 0, seats: 4, back: 3 }, { kind: 'canyoner', x: 12, y: 3, heading: 0, seats: 1, back: 3 }]);
    v.update(1);
    expect(v.meshes.get('raft')!.count).toBe(1); expect(v.meshes.get('canyoner')!.count).toBe(1);
    const m = new THREE.Matrix4();
    v.meshes.get('raft')!.getMatrixAt(0, m);
    expect(m.elements[13]).toBeCloseTo(3 + 0.05, 5);
    v.meshes.get('canyoner')!.getMatrixAt(0, m);
    const e = new THREE.Euler().setFromRotationMatrix(m, 'YZX');
    expect(Math.abs(e.z)).toBeGreaterThan(0.05); // pitched along the slope (the test ground rises 0.1 per tile)
    expect(v.dust.count).toBe(0); // no dust behind rafts
  });
  it('rafts on rapids tiles are offered to the splash (at most 8), others are not; capped overall', () => {
    const list: Carrier[] = Array.from({ length: 30 }, (_, k) => ({ kind: 'raft', x: 3 + k, y: 3, heading: 0, seats: 4, back: 3, splash: k % 2 === 0 }));
    const v = mk(list);
    v.update(1);
    expect(v.count).toBeLessThanOrEqual(TOURS.maxCarriers);
    expect(v.splashSpots.length).toBe(8);
    expect(v.splashSpots.every((s) => Number.isFinite(s.x + s.y + s.z))).toBe(true);
    v.update(2);
    expect(v.splashSpots.length).toBe(8); // rebuilt, not accumulated
  });
});

describe('RapidsSplash with rafts', () => {
  it('rafts splash first, the spot count never exceeds SPLASH.spots (the puff cap is unchanged)', () => {
    const s = new RapidsSplash();
    const rapids = Array.from({ length: 40 }, (_, i) => ({ x: i, y: 1, z: 0 }));
    const extra = Array.from({ length: 4 }, (_, i) => ({ x: 100 + i, y: 1, z: 0 }));
    const cam = new THREE.PerspectiveCamera();
    s.update(0.5, cam, 20, rapids, 0, extra);
    const spots = (s as unknown as { spots: Array<{ x: number }> }).spots;
    expect(spots.length).toBeLessThanOrEqual(SPLASH.spots);
    expect(spots.slice(0, 4).map((p) => p.x)).toEqual([100, 101, 102, 103]);
    s.update(0.5, cam, 20, rapids, 0, []);
    expect((s as unknown as { spots: unknown[] }).spots.length).toBe(SPLASH.spots);
    s.update(0.5, cam, 20, [], 0, []);
    expect(s.mesh.visible).toBe(false); // nothing to splash, nothing drawn
    s.update(0.5, cam, 20, [], 0, extra);
    expect(s.mesh.visible).toBe(true); // a raft alone on a (natural) rapid still splashes
  });
});
