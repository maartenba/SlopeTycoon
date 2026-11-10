import { describe, expect, it } from 'vitest';
import { lookAngles, sampleC2, sampleScalar, samplePath, smoothGround, type CamKey } from '../../src/render/PromoCamera';

const keys: CamKey[] = [{ t: 0, v: [0, 0, 1] }, { t: 2, v: [10, 4, 3], ease: 'smooth' }, { t: 4, v: [10, 8, 5] }];
describe('PromoCamera', () => {
  it('is a pure function of time and hits the keys', () => {
    expect(samplePath(keys, 0)).toEqual([0, 0, 1]); expect(samplePath(keys, 2)).toEqual([10, 4, 3]); expect(samplePath(keys, 9)).toEqual([10, 8, 5]);
    expect(samplePath(keys, 1.3)).toEqual(samplePath(keys, 1.3));
  });
  it('is continuous and monotone along a straight run', () => {
    let prev = -1; for (let i = 0; i <= 40; i++) { const v = samplePath(keys.slice(0, 2), i * 0.05, false)[0]!; expect(v).toBeGreaterThanOrEqual(prev); prev = v; }
  });
  it('look angles and scalar timelines', () => {
    expect(lookAngles([0, 0, 0], [0, 0, -5]).yaw).toBeCloseTo(0); expect(lookAngles([0, 0, 0], [0, 5, -5]).pitch).toBeCloseTo(Math.PI / 4);
    expect(sampleScalar([[0, 5], [10, 15]], 5)).toBe(10); expect(sampleScalar([[0, 5], [10, 15]], 99)).toBe(15);
  });
  it('sampleC2 hits the keys, rests at both ends and has continuous velocity + acceleration through the keys', () => {
    const ks: CamKey[] = [{ t: 0, v: [0] }, { t: 1.5, v: [5] }, { t: 5, v: [6] }, { t: 8, v: [20] }];
    for (const k of ks) expect(sampleC2(ks, k.t)[0]).toBeCloseTo(k.v[0]!, 9);
    const e = 1e-4; const f = (t: number): number => sampleC2(ks, t)[0]!;
    const vel = (t: number): number => (f(t + e) - f(t - e)) / (2 * e), acc = (t: number): number => (f(t + e) - 2 * f(t) + f(t - e)) / (e * e);
    expect(Math.abs(vel(e * 2))).toBeLessThan(0.02); expect(Math.abs(vel(8 - e * 2))).toBeLessThan(0.02);
    for (const t of [1.5, 5]) { expect(vel(t - 2 * e)).toBeCloseTo(vel(t + 2 * e), 2); expect(acc(t - 3 * e)).toBeCloseTo(acc(t + 3 * e), 1); }
    expect(sampleC2(ks, -1)[0]).toBe(0); expect(sampleC2(ks, 99)[0]).toBe(20);
  });
  it('smoothGround removes tile-edge kinks (second difference far below the raw height) and keeps a plane exactly', () => {
    const raw = (x: number, z: number): number => 3 * Math.abs(((x * 0.12) % 2) - 1) + 0.1 * z; // triangle ridge every ~8 tiles + a slope
    const plane = (x: number, z: number): number => 2 + 0.3 * x - 0.2 * z;
    expect(smoothGround(plane, 10, 20)).toBeCloseTo(plane(10, 20), 6);
    const d2 = (g: (x: number, z: number) => number): number => { let m = 0; for (let x = 10; x < 20; x += 0.1) m = Math.max(m, Math.abs(g(x + 0.1, 5) - 2 * g(x, 5) + g(x - 0.1, 5))); return m; };
    expect(d2((x, z) => smoothGround(raw, x, z))).toBeLessThan(d2(raw) * 0.25);
  });
});
