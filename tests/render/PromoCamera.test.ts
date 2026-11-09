import { describe, expect, it } from 'vitest';
import { lookAngles, sampleScalar, samplePath, type CamKey } from '../../src/render/PromoCamera';

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
});
