import { describe, expect, it } from 'vitest';
import { envelope, onsets, planSplice, windowCorr } from '../../scripts/promo/music';

describe('promo music splice', () => {
  // a synthetic 60 s "song": a beat every 0.5 s (envelope spikes), the last 8 s a decaying tail
  const hz = 100, dur = 60; const env = new Float32Array(dur * hz);
  for (let i = 0; i < env.length; i++) { const t = i / hz; const ph = (t % 0.5); env[i] = (0.2 + 0.8 * Math.exp(-ph * 12)) * (t > 52 ? Math.exp(-(t - 52) * 0.5) : 1); }
  it('envelope + onsets', () => {
    const e = envelope(new Float32Array(8000).fill(0.5), 8000); expect(e.length).toBe(100); expect(e[0]).toBeCloseTo(0.5, 6);
    expect(onsets(new Float32Array([0, 1, 0.5, 2])).join()).toBe('0,1,0,1.5');
  });
  it('windowCorr is 1 for identical windows', () => { const o = onsets(env); expect(windowCorr(o, 1000, 1000, 200)).toBeCloseTo(1, 6); });
  it('planSplice keeps the running time exact and lands on the beat grid', () => {
    const total = 40, xf = 1.5, s = planSplice(env, dur, 0, total, xf, 8, 14);
    expect((s.p - s.start) + (dur - s.q) - xf).toBeCloseTo(total, 9);
    expect(s.q).toBeGreaterThanOrEqual(dur - 14 - 1e-9); expect(s.q).toBeLessThanOrEqual(dur - 8 + 1e-9);
    const off = ((s.q - s.p) % 0.5 + 0.5) % 0.5; expect(Math.min(off, 0.5 - off)).toBeLessThan(0.06); // same beat phase at both seam ends
    expect(s.score).toBeGreaterThan(0.5);
  });
});
