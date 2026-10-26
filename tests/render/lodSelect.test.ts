import { describe, expect, it } from 'vitest';
import { advanceFade, buildOrder, fadeWeight, inNewLevel, instanceHash, lodSelect, schmitt } from '@/render/lodSelect';

const TH = [28, 90];

describe('lodSelect (hysteresis)', () => {
  it('matches the plain threshold test on the first call', () => {
    expect(lodSelect(-1, 10, TH)).toBe(0);
    expect(lodSelect(-1, 28, TH)).toBe(0);
    expect(lodSelect(-1, 28.01, TH)).toBe(1);
    expect(lodSelect(-1, 500, TH)).toBe(2);
  });
  it('is stable under jitter around a threshold', () => {
    let l = lodSelect(-1, 27.9, TH), flips = 0;
    for (let i = 0; i < 1000; i++) {
      const v = 28 + Math.sin(i * 1.7) * 0.8; // +-3 % jitter
      const n = lodSelect(l, v, TH); if (n !== l) flips++; l = n;
    }
    expect(flips).toBe(0);
  });
  it('still switches once the value really crosses the band, and back again', () => {
    let l = lodSelect(-1, 20, TH);
    l = lodSelect(l, 29, TH); expect(l).toBe(0);      // inside the band: stays
    l = lodSelect(l, 30, TH); expect(l).toBe(1);      // beyond +6 %
    l = lodSelect(l, 27, TH); expect(l).toBe(1);      // inside the band on the way back
    l = lodSelect(l, 26, TH); expect(l).toBe(0);      // below -6 %
  });
  it('can skip levels in one call and never returns an invalid level', () => {
    expect(lodSelect(0, 1e6, TH)).toBe(2);
    expect(lodSelect(2, 0.1, TH)).toBe(0);
    expect(lodSelect(99, 50, TH)).toBe(1);
  });
  it('schmitt trigger', () => {
    expect(schmitt(false, 99, 90, 100)).toBe(false);
    expect(schmitt(false, 101, 90, 100)).toBe(true);
    expect(schmitt(true, 95, 90, 100)).toBe(true);
    expect(schmitt(true, 89, 90, 100)).toBe(false);
  });
});

describe('cross-fade maths', () => {
  it('weight is continuous, monotonic, 0..1', () => {
    let prev = 0;
    for (let i = 0; i <= 200; i++) {
      const w = fadeWeight(i / 200, 0.2, 0.8);
      expect(w).toBeGreaterThanOrEqual(prev - 1e-12); expect(w - prev).toBeLessThan(0.04); prev = w;
    }
    expect(fadeWeight(0, 0.2, 0.8)).toBe(0); expect(fadeWeight(1, 0.2, 0.8)).toBe(1);
  });
  it('per-instance masks are complementary and each instance switches once', () => {
    const seeds = Array.from({ length: 500 }, (_, i) => i * 0.0173 + 0.001);
    for (const s of seeds) {
      let switches = 0, was = inNewLevel(s, 0);
      for (let k = 1; k <= 100; k++) { const now = inNewLevel(s, k / 100); if (now !== was) switches++; was = now; }
      expect(switches).toBeLessThanOrEqual(1);
    }
    expect(seeds.filter((s) => inNewLevel(s, 0)).length).toBe(0);
    const half = seeds.filter((s) => inNewLevel(s, 0.5)).length / seeds.length;
    expect(half).toBeGreaterThan(0.4); expect(half).toBeLessThan(0.6);
    expect(seeds.every((s) => inNewLevel(s, 1.0001))).toBe(true);
  });
  it('instance hash depends on the seed only (not on any camera state)', () => {
    expect(instanceHash(0.37)).toBe(instanceHash(0.37));
    expect(instanceHash(0.37)).not.toBe(instanceHash(0.38));
    const v = instanceHash(123.456); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1);
  });
  it('the fade clock waits for the incoming level and never runs backwards', () => {
    expect(advanceFade(0, 0.1, 0.3, false)).toBe(0);
    expect(advanceFade(0, 0.1, 0.3, true)).toBeCloseTo(1 / 3, 6);
    expect(advanceFade(0.9, 1, 0.3, true)).toBe(1);
    expect(advanceFade(0.5, 0.1, 0.3, false)).toBe(0.5);
  });
});

describe('buildOrder', () => {
  it('orders by distance to the target, ties by index', () => {
    const pts = [10, 10, 0, 0, 5, 5, 5, 5];
    expect(buildOrder(pts, 0, 0)).toEqual([1, 2, 3, 0]);
    expect(buildOrder(pts, 10, 10)).toEqual([0, 2, 3, 1]);
  });
});
