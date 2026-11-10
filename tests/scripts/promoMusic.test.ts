import { describe, expect, it } from 'vitest';
import { envelope, naturalBaseline, onsets, planEdit, refineSeam, type SongFeatures } from '../../scripts/promo/music';

/** A synthetic click-track song: 0.5 s beats, 4-beat bars, a chord (chroma one-hot) per bar from a repeating 4-bar progression with a 'verse' (bars 0-15) that repeats as bars 24-39;
 *  bars 16-23 are an unrelated bridge; the song ends with a 4 s decay. 120 s total. */
function song(): SongFeatures {
  const beats: number[] = [], chroma: number[][] = [], rmsDb: number[] = [], novelty: number[] = [];
  for (let i = 0; i < 240; i++) { beats.push(0.25 + i * 0.5); const bar = Math.floor(i / 4); const chord = bar >= 16 && bar < 24 ? 7 + (bar % 3) : [0, 5, 7, 9][bar % 4]!; const c = new Array(12).fill(0.05); c[chord] = 1; chroma.push(c); rmsDb.push(bar >= 16 && bar < 24 ? -12 : -20); novelty.push(0); }
  return { dur: 120, ending: 115, beats, chroma, rmsDb, novelty };
}
describe('promo music edit', () => {
  it('envelope + onsets', () => {
    const e = envelope(new Float32Array(8000).fill(0.5), 8000); expect(e.length).toBe(100); expect(e[0]).toBeCloseTo(0.5, 6);
    expect(onsets(new Float32Array([0, 1, 0.5, 2])).join()).toBe('0,1,0,1.5');
  });
  it('planEdit cuts a whole number of bars between identical chords and hits the exact running time', () => {
    const f = song(); const [e] = planEdit(f, { total: 90, endCard: 7, xf: 0.1, maxRate: 0.03 });
    expect(e!.cut).toBe(true); expect(e!.start).toBe(0);
    expect(((e!.b - e!.a) / 2) % 4).toBeCloseTo(0, 9); // whole bars (2 s each)
    expect(e!.cosAt).toBeGreaterThan(0.99); expect(e!.cosPre).toBeGreaterThan(0.9); expect(e!.dDb).toBeLessThan(1);
    expect(((e!.a - e!.start) + (f.dur - e!.b)) / e!.rate).toBeCloseTo(90, 9); expect(Math.abs(e!.rate - 1)).toBeLessThanOrEqual(0.03 + 1e-9);
    expect(e!.b).toBeGreaterThan(e!.a); expect(f.dur - e!.b).toBeGreaterThan(4); // the real ending is kept
  });
  it('a teaser may start at a section start; the natural baseline is reported', () => {
    const f = song(); f.novelty[64] = 0.9; const best = planEdit(f, { total: 30, endCard: 4, xf: 0.1, startSections: true }, 20);
    expect(best.length).toBeGreaterThan(0); for (const e of best) expect(Math.abs(e.rate - 1)).toBeLessThanOrEqual(0.03 + 1e-9);
    const nb = naturalBaseline(f); expect(nb.cos.length).toBeGreaterThan(100);
  });
  it('refineSeam moves B so its attack lines up with the attack at A', () => {
    const rate = 8000, sig = new Float32Array(rate * 4); const burst = (t0: number, amp: number): void => { for (let i = 0; i < 0.12 * rate; i++) { const j = Math.round(t0 * rate) + i; if (j < sig.length) sig[j]! += amp * Math.exp(-i / (0.03 * rate)) * Math.sin(i * 0.9); } };
    burst(0.7, 0.4); burst(1.0, 1); burst(2.0 + 0.017, 1); burst(1.717, 0.4); // B's beat is tracked 17 ms early: its attack is really at 2.017 (the beat before it, 0.3 s earlier at 1.717)
    const r = refineSeam(sig, rate, 1.0, 2.0, 0.04); expect(r.corr).toBeGreaterThan(0.8); expect(Math.abs(r.b - 2.017)).toBeLessThan(0.003);
  });
});
