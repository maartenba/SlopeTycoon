import { describe, expect, it } from 'vitest';
import { SPONSORS, SPONSOR_DENYLIST } from '../../src/config/raceSponsors';

describe('race sponsors (owner decision 2026-11-16: a pool of made-up, harmless names)', () => {
  it('is a pool of about ten, unique ids and names, board-sized, with small sums and a bounded rating bonus', () => {
    expect(SPONSORS.length).toBeGreaterThanOrEqual(8); expect(SPONSORS.length).toBeLessThanOrEqual(12);
    expect(new Set(SPONSORS.map((s) => s.id)).size).toBe(SPONSORS.length);
    expect(new Set(SPONSORS.map((s) => s.name.toLowerCase())).size).toBe(SPONSORS.length);
    for (const s of SPONSORS) { expect(s.name.length).toBeLessThanOrEqual(28); expect(s.pay).toBeLessThanOrEqual(600); expect(s.rating).toBeGreaterThan(0); expect(s.rating).toBeLessThanOrEqual(1); }
  });
  it('no name contains a token of the real-brand denylist (and the list itself is lower-case and non-trivial)', () => {
    expect(SPONSOR_DENYLIST.length).toBeGreaterThan(50);
    for (const t of SPONSOR_DENYLIST) expect(t).toBe(t.toLowerCase());
    for (const s of SPONSORS) for (const t of SPONSOR_DENYLIST) {
      const hay = `${s.name} ${s.line ?? ''}`.toLowerCase();
      expect(hay.includes(t), `"${s.name}" contains the denylisted token "${t}"`).toBe(false);
    }
  });
  it('flavour lines are rare (at most a third of the pool) and short', () => {
    const lines = SPONSORS.filter((s) => s.line);
    expect(lines.length).toBeLessThanOrEqual(Math.ceil(SPONSORS.length / 3));
    for (const s of lines) expect(s.line!.length).toBeLessThanOrEqual(80);
  });
});
