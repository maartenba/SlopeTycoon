import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cutClips, cutTotal, parseCuts } from '../../scripts/promo/cuts';

const film = JSON.parse(readFileSync('promo/scenes.json', 'utf8')).film;

describe('promo cut argument', () => {
  it('90 / 30 / both, default 90, anything else throws (the old parser turned unknown values into 90)', () => {
    expect(parseCuts(undefined)).toEqual(['90']);
    expect(parseCuts('90')).toEqual(['90']);
    expect(parseCuts('30')).toEqual(['30']);
    expect(parseCuts('both')).toEqual(['90', '30']);
    expect(parseCuts('BOTH')).toEqual(['90', '30']);
    expect(() => parseCuts('60')).toThrow(/must be 90, 30 or both/);
    expect(() => parseCuts('')).toThrow();
  });
});

describe('promo cut lengths are exact', () => {
  it('the 90 s cut sums to exactly 90 s (shots + the end card hold)', () => { expect(cutTotal(film, '90')).toBeCloseTo(90, 9); });
  it('the 30 s teaser sums to exactly 30 s', () => { expect(cutTotal(film, '30')).toBeCloseTo(30, 9); });
  it('the end card is last, every clip stays inside its shot, every used shot exists', () => {
    for (const cut of ['90', '30'] as const) {
      const cl = cutClips(film, cut);
      expect(cl[cl.length - 1]!.endCard).toBe(true);
      expect(cl.filter((c) => c.endCard)).toHaveLength(1);
      for (const c of cl) if (!c.endCard) expect(c.from + c.len).toBeLessThanOrEqual(c.shot.len + 1e-9);
    }
  });
  it('shot lengths are whole frames at the film fps (no fractional-frame drift)', () => {
    for (const s of film.shots) expect(Number.isInteger(Math.round(s.len * film.fps)) && Math.abs(s.len * film.fps - Math.round(s.len * film.fps)) < 1e-9).toBe(true);
  });
  it('autumn gets about 16 s of the 90 s cut (five s09 shots) and one beat of the teaser (owner request: more fall, then the first snow)', () => {
    const aut = cutClips(film, '90').filter((c) => c.id.startsWith('s09'));
    expect(aut.map((c) => c.id)).toEqual(['s09a-larch', 's09b-village', 's09c-pond', 's09d-walk', 's09e-first-snow']);
    expect(aut.reduce((a, c) => a + c.len, 0)).toBeCloseTo(16, 9);
    expect(cutClips(film, '30').filter((c) => c.id.startsWith('s09')).map((c) => c.id)).toEqual(['s09a-larch']);
  });
  it('every crossfade is shorter than the shortest clip of its cut', () => {
    for (const cut of ['90', '30'] as const) expect(Math.min(...cutClips(film, cut).map((c) => c.len))).toBeGreaterThan(film.cuts[`c${cut}`].xfade);
  });
});
