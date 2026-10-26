import { describe, it, expect } from 'vitest';
import { SpatialHash } from '../../../src/sim/guests/SpatialHash';
import { Rng } from '../../../src/core/Rng';
import { minRatio } from '../../perfMode';

function setup(n: number, size = 128, seed = 5) {
  const rng = new Rng(seed);
  const xs = new Float32Array(n), ys = new Float32Array(n);
  const h = new SpatialHash(size, n);
  for (let i = 0; i < n; i++) { xs[i] = rng.next() * size; ys[i] = rng.next() * size; h.insert(i, xs[i]!, ys[i]!); }
  return { rng, xs, ys, h };
}
const brute = (xs: Float32Array, ys: Float32Array, x: number, y: number, r: number): number[] => {
  const out: number[] = [];
  for (let i = 0; i < xs.length; i++) { const dx = xs[i]! - x, dy = ys[i]! - y; if (dx * dx + dy * dy <= r * r) out.push(i); }
  return out;
};

describe('SpatialHash', () => {
  it('queries equal brute force, including after incremental moves and removals', () => {
    const { rng, xs, ys, h } = setup(1500);
    for (let k = 0; k < 3000; k++) {
      const i = rng.int(0, 1499);
      xs[i] = Math.min(127.9, Math.max(0, xs[i]! + (rng.next() - 0.5) * 6)); ys[i] = Math.min(127.9, Math.max(0, ys[i]! + (rng.next() - 0.5) * 6));
      h.move(i, xs[i]!, ys[i]!);
    }
    const removed = new Set<number>();
    for (let k = 0; k < 100; k++) { const i = rng.int(0, 1499); removed.add(i); h.remove(i); }
    for (let q = 0; q < 200; q++) {
      const x = rng.next() * 128, y = rng.next() * 128, r = 1 + rng.next() * 12;
      const got = h.query(x, y, r, xs, ys).sort((a, b) => a - b);
      const want = brute(xs, ys, x, y, r).filter((i) => !removed.has(i));
      expect(got).toEqual(want);
    }
  });

  it('[perf] is >=10x faster than brute force at 4,000 guests (logged)', () => {
    const { rng, xs, ys, h } = setup(4000, 256);
    const Q = 4000, R = 4;
    const qs = Array.from({ length: Q }, () => [rng.next() * 256, rng.next() * 256] as const);
    const buf: number[] = [];
    const timeHash = (): number => { let n = 0; const t = performance.now(); for (const [x, y] of qs) n += h.query(x, y, R, xs, ys, buf).length; return n * 0 + (performance.now() - t); };
    const timeBrute = (): number => { const t = performance.now(); for (const [x, y] of qs) brute(xs, ys, x, y, R); return performance.now() - t; };
    timeHash(); timeBrute(); // warm-up (JIT)
    const hashMs = Math.min(timeHash(), timeHash(), timeHash());
    const bruteMs = Math.min(timeBrute(), timeBrute(), timeBrute());
    let a = 0, b = 0;
    for (const [x, y] of qs) { a += h.query(x, y, R, xs, ys, buf).length; b += brute(xs, ys, x, y, R).length; }
    expect(a).toBe(b);
    console.log(`[perf] spatial hash 4000 guests x ${Q} queries r=${R}: hash ${hashMs.toFixed(2)} ms, brute ${bruteMs.toFixed(2)} ms, speedup ${(bruteMs / hashMs).toFixed(0)}x`);
    expect(bruteMs / hashMs).toBeGreaterThanOrEqual(minRatio(10));
  });

  it('countAt reflects cell occupancy and updates on move', () => {
    const h = new SpatialHash(64, 4);
    h.insert(0, 1, 1); h.insert(1, 2, 2); h.insert(2, 20, 20);
    expect(h.countAt(3, 3)).toBe(2);
    h.move(1, 30, 30);
    expect(h.countAt(3, 3)).toBe(1);
    expect(h.countAt(31, 31)).toBe(1);
  });
});
