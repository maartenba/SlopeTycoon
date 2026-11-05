import { describe, it, expect } from 'vitest';
import { RESORT_NAMES, RESORT_NAME_MAX, defaultResortName, sanitizeResortName } from '../../src/sim/ResortName';

describe('curated resort names', () => {
  it('has about 120 names, unique, within the limit and unchanged by the sanitiser', () => {
    expect(RESORT_NAMES.length).toBeGreaterThanOrEqual(100);
    expect(new Set(RESORT_NAMES.map((n) => n.toLowerCase())).size).toBe(RESORT_NAMES.length);
    for (const n of RESORT_NAMES) {
      expect(n.length).toBeLessThanOrEqual(RESORT_NAME_MAX);
      expect(sanitizeResortName(n)).toBe(n);
      expect(n).not.toMatch(/undefined|NaN|null/i);
    }
  });
  it('is deterministic and spreads seeds 0..999 over many names', () => {
    const used = new Set<string>();
    for (let s = 0; s < 1000; s++) { const n = defaultResortName(s); expect(defaultResortName(s)).toBe(n); used.add(n); }
    expect(used.size).toBeGreaterThan(RESORT_NAMES.length * 0.9);
  });
  it('gives a real name for odd seeds', () => {
    for (const s of [-1, -987654321, 1.5, NaN, Infinity, -Infinity, 2 ** 53, 1e300, 0xffffffff * 7]) {
      expect(RESORT_NAMES).toContain(defaultResortName(s));
    }
  });
});
