import { describe, expect, it } from 'vitest';
import { headPool, nearestN, nearestStable, poolStrength, shadowStrength, softShadow, VEHICLE_FX, VehicleFxLayer } from '../../src/render/vehicleFx';
import { brakeLight, meltFactor, newSuspension, snowLevel, SNOW_COVER, startCover, stepSnowCover, stepSuspension, SUSP } from '../../src/render/vehicleMotion';
import { buildBus, buildCar, snowMask } from '../../src/render/meshes/VehicleModels';
import * as THREE from 'three';

const tris = (g: THREE.BufferGeometry): number => g.getAttribute('position').count / 3;
describe('soft vehicle shadow + headlight pool', () => {
  it('shadow is strongest in the middle, falls off smoothly to exactly 0 at the rim (no hard edge)', () => {
    const c = softShadow(0, 0, 0.5); expect(c).toBeCloseTo(0.5, 5);
    let prev = c; for (let r = 0.1; r <= 1.0001; r += 0.05) { const a = softShadow(r, 0, 0.5); expect(a).toBeLessThanOrEqual(prev + 1e-9); prev = a; }
    expect(softShadow(1, 0, 0.5)).toBeCloseTo(0, 6); expect(softShadow(0, 1, 0.5)).toBeCloseTo(0, 6);
    // no step: neighbouring samples near the rim differ by little
    for (let r = 0; r < 1; r += 0.02) expect(Math.abs(softShadow(r + 0.02, 0, 0.5) - softShadow(r, 0, 0.5))).toBeLessThan(0.06);
  });
  it('night keeps the shadow at the configured share; the pool only shows at night', () => {
    expect(shadowStrength(0)).toBeCloseTo(VEHICLE_FX.shadow, 6); expect(shadowStrength(1)).toBeCloseTo(VEHICLE_FX.shadow * VEHICLE_FX.shadowNight, 6);
    expect(poolStrength(0)).toBe(0); expect(poolStrength(0.2)).toBe(0); expect(poolStrength(1)).toBeCloseTo(VEHICLE_FX.pool.peak, 6);
  });
  it('headlight pool is bright near the nose axis, fades to 0 at the far end and the sides, and is quiet', () => {
    expect(headPool(0, 0.3, 0.3)).toBeGreaterThan(headPool(0.8, 0.3, 0.3)); expect(headPool(0, 1, 0.3)).toBeCloseTo(0, 6); expect(headPool(0, 0, 0.3)).toBeCloseTo(0, 6);
    for (let t = 0; t <= 1; t += 0.1) for (let x = -1; x <= 1; x += 0.2) expect(headPool(x, t, VEHICLE_FX.pool.peak)).toBeLessThanOrEqual(VEHICLE_FX.pool.peak + 1e-9);
  });
  it('nearestN picks the nearest, capped, stable', () => {
    expect(nearestN([0, 10, 3, 1], [0, 0, 0, 0], 0, 0, 2)).toEqual([0, 3]); expect(nearestN([5, 5], [0, 0], 0, 0, 5)).toEqual([0, 1]);
  });
  it('the layer is one instanced mesh and caps its capacity', () => {
    const l = new VehicleFxLayer(); l.begin(); const q = new THREE.Quaternion(), p = new THREE.Vector3();
    for (let i = 0; i < VEHICLE_FX.capacity + 20; i++) l.add(i % 2 as 0 | 1, p, q, 0, 0, 1, 1, 0.5);
    l.add(0, p, q, 0, 0, 1, 1, 0); l.end(); expect(l.count).toBe(VEHICLE_FX.capacity); expect(l.mesh.count).toBe(VEHICLE_FX.capacity);
  });
});

describe('brake lights: speed drop with hold, never while cruising slowly', () => {
  const run = (speeds: number[], max = 5): boolean[] => { const s = newSuspension(); return speeds.map((v) => stepSuspension(s, 0, v, max).braking); };
  it('cruising slowly (constant, 30 % of max) never lights', () => { expect(run(Array(200).fill(1.5)).some(Boolean)).toBe(false); });
  it('a tick-stepped slow-down stays lit between steps (no toggling), then goes off after the hold', () => {
    const v: number[] = []; for (let i = 0; i < 20; i++) v.push(4);
    for (let k = 0; k < 4; k++) for (let i = 0; i < 37; i++) v.push(4 - (k + 1) * 0.5); // drops every 37 frames
    for (let i = 0; i < 100; i++) v.push(2);
    const b = run(v), from = 20, last = 20 + 3 * 37;
    for (let i = from; i < last + 37; i++) expect(b[i]).toBe(true);
    expect(b[b.length - 1]).toBe(false);
    let flips = 0; for (let i = 1; i < b.length; i++) if (b[i] !== b[i - 1]) flips++; expect(flips).toBe(2);
  });
  it('standing still (junction) is lit; pulling away releases it after the hold', () => {
    const b = run([...Array(10).fill(0), ...Array(120).fill(3)]); expect(b[5]).toBe(true); expect(b[b.length - 1]).toBe(false);
  });
  it('brakeLight helper has hysteresis', () => {
    const s = { braking: false, quiet: 99 }; expect(brakeLight(s, -0.01, false)).toBe(true); s.braking = true;
    for (let i = 0; i < SUSP.holdFrames - 1; i++) expect(brakeLight(s, 0, false)).toBe(true);
    expect(brakeLight(s, 0, false)).toBe(false);
  });
});

describe('roof snow: melts parked in the sun, shed when driving', () => {
  it('parked in the sun melts slowly to 0, at night / in shade it keeps its snow', () => {
    let c = 1; for (let i = 0; i < 60 * 80; i++) c = stepSnowCover(c, 1 / 60, 0, 1); expect(c).toBeCloseTo(0, 1);
    let n = 1; for (let i = 0; i < 60 * 600; i++) n = stepSnowCover(n, 1 / 60, 0, 0); expect(n).toBe(1);
  });
  it('driving sheds faster than melting; slower driving sheds slower; cover stays in 0..1', () => {
    const fast = stepSnowCover(1, 10, 1, 1), slow = stepSnowCover(1, 10, 0.3, 1), park = stepSnowCover(1, 10, 0, 1);
    expect(fast).toBeLessThan(slow); expect(slow).toBeLessThan(park); expect(stepSnowCover(0.01, 100, 1, 1)).toBe(0);
  });
  it('levels are quantised 0..levels; start cover / melt factor are stable per id and bounded', () => {
    expect(snowLevel(0)).toBe(0); expect(snowLevel(1)).toBe(SNOW_COVER.levels); expect(snowLevel(0.5)).toBe(Math.round(SNOW_COVER.levels / 2));
    for (let id = 0; id < 50; id++) { expect(startCover(id)).toBe(startCover(id)); expect(startCover(id)).toBeGreaterThanOrEqual(0.75); expect(startCover(id)).toBeLessThanOrEqual(1); expect(meltFactor(id)).toBeGreaterThanOrEqual(0.8); expect(meltFactor(id)).toBeLessThanOrEqual(1.2); }
  });
  it('the snow mask covers the roof and the boot lid but never the bonnet', () => {
    for (let style = 0; style < 8; style++) {
      const g = buildCar(style, 0x2f5fa8, 0).body, pos = g.getAttribute('position'), nor = g.getAttribute('normal'), a = g.getAttribute('aSnow');
      let roof = 0; for (let i = 0; i < pos.count; i++) if (a.getX(i) > 0) { roof++; expect(nor.getY(i)).toBeGreaterThan(0.6); if (pos.getY(i) < 0.3 && pos.getZ(i) > 0.3) throw new Error(`bonnet snow style ${style}`); }
      expect(roof).toBeGreaterThan(0);
    }
    const bus = buildBus(false, 0xd83a34).body; expect(bus.getAttribute('aSnow')).toBeTruthy(); expect(snowMask(new THREE.BoxGeometry(1, 1, 1).toNonIndexed(), 0.2).getAttribute('aSnow').count).toBe(36);
  });
});

describe('bus interior', () => {
  it('the full bus has seats behind open windows and stays <= 2200 triangles; Low keeps the closed shell', () => {
    const full = buildBus(false, 0xd83a34), mini = buildBus(true, 0xd83a34), low = buildBus(false, 0xd83a34, true);
    expect(tris(full.body)).toBeLessThanOrEqual(2200); expect(tris(mini.body)).toBeLessThanOrEqual(1500); expect(tris(low.body)).toBeLessThan(tris(full.body) + 1);
    const col = full.body.getAttribute('color'); let seat = 0; const sc = new THREE.Color(0xd9893a);
    for (let i = 0; i < col.count; i++) if (Math.abs(col.getZ(i) - sc.b) < 0.01 && Math.abs(col.getX(i) - sc.r) < 0.01 && Math.abs(col.getY(i) - sc.g) < 0.01) seat++;
    expect(seat).toBeGreaterThan(100);
  });
});

describe('headlight pool selection hysteresis', () => {
  it('equals nearestN without history, keeps members inside cap + margin, never exceeds cap', () => {
    const xs = [1, 2, 3, 4, 5, 6], zs = [0, 0, 0, 0, 0, 0];
    expect(nearestStable(xs, zs, 0, 0, 3, new Set())).toEqual(nearestN(xs, zs, 0, 0, 3));
    // vehicle 3 (rank 3, just outside cap 3) was a member: it stays; the nearest newcomer waits for a free slot
    const out = nearestStable(xs, zs, 0, 0, 3, new Set([0, 1, 3]), 2); expect(out.length).toBe(3); expect(out).toContain(3); expect(out).not.toContain(2);
    // far beyond the margin it is dropped
    expect(nearestStable(xs, zs, 0, 0, 3, new Set([5]), 1)).not.toContain(5);
  });
  it('two vehicles swapping ranks around the cap boundary cause no selection change after the first', () => {
    const zs = [0, 0, 0, 0, 0]; let prev = new Set<number>(), changes = 0, last: string | null = null;
    for (let f = 0; f < 60; f++) {
      const xs = [1, 2, 3, 4.0 + 0.3 * Math.sin(f / 3), 4.0 - 0.3 * Math.sin(f / 3)]; // vehicles 3 and 4 trade rank 3 / 4 around cap 4
      const sel = nearestStable(xs, zs, 0, 0, 4, prev); prev = new Set(sel); const key = [...sel].sort().join(',');
      if (last !== null && key !== last) changes++; last = key;
    }
    expect(changes).toBe(0);
    let c2 = 0, p2 = new Set<number>(), l2: string | null = null;
    for (let f = 0; f < 60; f++) { const xs = [1, 2, 3, 4.0 + 0.3 * Math.sin(f / 3), 4.0 - 0.3 * Math.sin(f / 3)]; const k = nearestN(xs, zs, 0, 0, 4).sort().join(','); if (l2 !== null && k !== l2) c2++; l2 = k; void p2; }
    expect(c2).toBeGreaterThan(3); // the plain nearest-N ping-pongs
  });
});
