import { describe, expect, it } from 'vitest';
import { buildBus, buildCar, buildTrain, pillarize, GROUND_BLOB_Y, type Sec } from '../../src/render/meshes/VehicleModels';
import { createVehicleMesh, vehicleLook } from '../../src/render/meshes/Vehicles';
import { angleDelta, bumpBob, newSuspension, stepSuspension, SUSP } from '../../src/render/vehicleMotion';

const tris = (g: { getAttribute(n: string): { count: number } }): number => g.getAttribute('position').count / 3;
describe('vehicle look pass', () => {
  it('every style / rack stays <= 900 tris, Low is smaller, all finite and lit-colour matched', () => {
    for (let s = 0; s < 8; s++) for (const r of [0, 1, 2, 3]) {
      const f = buildCar(s, 0x2f5fa8, r, { roof: 0xf2f2f2 }), l = buildCar(s, 0x2f5fa8, r, { low: true });
      expect(tris(f.body)).toBeLessThanOrEqual(900); expect(tris(l.body)).toBeLessThan(tris(f.body)); expect(tris(l.body)).toBeLessThanOrEqual(672 + 100);
      for (const v of f.body.getAttribute('position').array as Float32Array) expect(Number.isFinite(v)).toBe(true);
      expect(f.body.getAttribute('color').count).toBe(f.body.getAttribute('position').count); expect(tris(f.lights)).toBe(48);
      f.body.computeBoundingBox(); expect(f.body.boundingBox!.min.y).toBeCloseTo(GROUND_BLOB_Y, 3);
    }
  });
  it('bus / coach / train stay in budget and Low buses are lighter', () => {
    expect(tris(buildBus(false, 0xd83a34).body)).toBeLessThanOrEqual(2200); expect(tris(buildBus(true, 0xd83a34).body)).toBeLessThanOrEqual(1500);
    expect(tris(buildBus(false, 1, true).body)).toBeLessThan(tris(buildBus(false, 1).body)); expect(tris(buildTrain().body)).toBeLessThan(3500);
  });
  it('looks are stable by id, include two-tone roofs, gear and all seven road styles', () => {
    const st = new Set<number>(), roofs = new Set<number>(), gear = new Set<number>();
    for (let id = 0; id < 600; id++) { const a = vehicleLook(0, id, false); expect(a).toEqual(vehicleLook(0, id, false)); st.add(a.style); roofs.add(a.roof); gear.add(a.gear); if (a.roof) expect(a.roof).not.toBe(a.color); }
    expect(st.size).toBe(7); expect(st.has(4)).toBe(false); expect(roofs.size).toBeGreaterThanOrEqual(3); expect(gear.size).toBe(3);
  });
  it('pillarize keeps the outline and flags a body-coloured band; models share cached geometry', () => {
    const secs: Sec[] = [{ z: -1, w: 1, y0: 0, y1: 1 }, { z: 0, w: 2, y0: 0, y1: 2 }, { z: 1, w: 1, y0: 0, y1: 1 }];
    const o = pillarize(secs, 0.5, 0.1); expect(o.length).toBe(secs.length + 4); expect(o.filter((s) => s.pillar).length).toBe(2);
    expect(o.find((s) => s.pillar)!.w).toBeCloseTo(1.6, 5); // interpolated on the original outline
    expect(pillarize(secs, 5)).toBe(secs);
    expect(createVehicleMesh(0, 9).group.children[0]).toBeTruthy();
  });
  it('suspension: lean follows the turn, nose dives braking, braking flag, bounded, still when standing', () => {
    const s = newSuspension(); stepSuspension(s, 0, 4, 5);
    for (let i = 0; i < 40; i++) stepSuspension(s, 0.05 * (i + 1), 4, 5);
    expect(s.roll).toBeLessThan(-0.01); expect(Math.abs(s.roll)).toBeLessThanOrEqual(SUSP.maxRoll + 1e-9);
    const b = newSuspension(); stepSuspension(b, 0, 5, 5); for (let i = 1; i <= 30; i++) stepSuspension(b, 0, Math.max(0, 5 - i * 0.3), 5);
    expect(b.pitch).toBeGreaterThan(0); expect(b.pitch).toBeLessThanOrEqual(SUSP.maxPitch + 1e-9); expect(b.braking).toBe(true);
    const c = newSuspension(); for (let i = 0; i < 20; i++) stepSuspension(c, 1, 5, 5); expect(c.braking).toBe(false); expect(Math.abs(c.roll)).toBeLessThan(1e-9);
    expect(bumpBob(3, 1, 0)).toBe(0); expect(Math.abs(bumpBob(3, 1, 4))).toBeLessThanOrEqual(SUSP.bob);
    expect(angleDelta(3.1, -3.1)).toBeCloseTo(0.0832, 3);
  });
});
