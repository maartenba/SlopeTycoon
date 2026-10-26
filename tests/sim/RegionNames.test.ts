import { describe, expect, it } from 'vitest';
import { peakNamesOf, regionNameOf } from '../../src/sim/Names';
import { stateHash } from '../../src/game/saveState';
import { createSim } from '../../src/game/createSim';

describe('region / peak names (Task 27)', () => {
  it('is deterministic and varied', () => {
    for (const s of [1, 7, 61, 123456]) { expect(regionNameOf(s)).toBe(regionNameOf(s)); expect(peakNamesOf(s, 3)).toEqual(peakNamesOf(s, 3)); }
    const set = new Set(Array.from({ length: 200 }, (_, i) => regionNameOf(i)));
    expect(set.size).toBeGreaterThan(60);
  });
  it('peaks are distinct, counted, accept lists', () => {
    for (let s = 0; s < 100; s++) {
      const p = peakNamesOf(s, 3);
      expect(p).toHaveLength(3);
      expect(new Set(p.map((x) => x.split(' ').slice(0, 2).join(' '))).size).toBe(3);
    }
    expect(peakNamesOf(5, [1, 2])).toHaveLength(2);
    expect(peakNamesOf(5, 0)).toEqual([]);
  });
  it('humour is rare', () => {
    let q = 0; for (let s = 0; s < 400; s++) if (/the (Patient|Grumpy|Reliable)$/.test(peakNamesOf(s, 1)[0]!)) q++;
    expect(q).toBeGreaterThan(10); expect(q).toBeLessThan(120);
  });
  it('does not touch the sim: stateHash unaffected by calling names', () => {
    const a = createSim({ size: 64, seed: 5 }); const h1 = stateHash(a).hash;
    regionNameOf(5); peakNamesOf(5, 3);
    expect(stateHash(a).hash).toBe(h1);
    expect(stateHash(createSim({ size: 64, seed: 5 })).hash).toBe(h1);
  });
});

import { yearSubtitle } from '../../src/ui/yearReportFormat';
describe('year report subtitle region', () => {
  it('adds the region only when given', () => {
    const r = { name: 'Your resort', partial: false, days: 180 } as never;
    expect(yearSubtitle(r)).toBe('Your resort · a full year on the mountain');
    expect(yearSubtitle(r, 'Silver Basin')).toBe('Your resort · Silver Basin · a full year on the mountain');
  });
});
