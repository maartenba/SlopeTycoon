/** Pure music helpers for the promo assembler (docs/promo-video.md): the 'rings out' ending. The cut is the song from `start` to a join point P, then an acrossfade into the song's own ending
 *  (from Q to the end of the file: the last chord and its decay), so the final chord rings out under the end card. P and Q are chosen so the running time is exact and the seam lands
 *  on a matching rhythmic position: the 100 Hz RMS envelopes around P and Q correlate best. No node / DOM imports (unit tested). */
export function envelope(samples: Float32Array, rate: number, hz = 100): Float32Array {
  const hop = Math.max(1, Math.round(rate / hz)); const n = Math.floor(samples.length / hop); const e = new Float32Array(n);
  for (let i = 0; i < n; i++) { let a = 0; for (let j = 0; j < hop; j++) { const v = samples[i * hop + j]!; a += v * v; } e[i] = Math.sqrt(a / hop); }
  return e;
}
/** Onset strength: the positive rises of the envelope. */
export function onsets(env: Float32Array): Float32Array { const o = new Float32Array(env.length); for (let i = 1; i < env.length; i++) o[i] = Math.max(0, env[i]! - env[i - 1]!); return o; }

/** Pearson correlation of two onset windows of `n` samples starting at a and b. */
export function windowCorr(o: Float32Array, a: number, b: number, n: number): number {
  let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += o[a + i] ?? 0; mb += o[b + i] ?? 0; } ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { const x = (o[a + i] ?? 0) - ma, y = (o[b + i] ?? 0) - mb; sab += x * y; saa += x * x; sbb += y * y; }
  return saa > 1e-12 && sbb > 1e-12 ? sab / Math.sqrt(saa * sbb) : 0;
}

export interface Splice { start: number; p: number; q: number; xf: number; tail: number; score: number }
/** Plan the splice: total running time `total` = (p - start) + (dur - q) - xf. Searches q in [dur - tailMax, dur - tailMin] on a 0.05 s grid and picks the best seam score
 *  (onset correlation of the 2 s before P with the 2 s before Q, plus the 0.5 s after each). */
export function planSplice(env: Float32Array, dur: number, start: number, total: number, xf: number, tailMin: number, tailMax: number, hz = 100): Splice {
  const o = onsets(env); let best: Splice | null = null;
  for (let q = dur - tailMax; q <= dur - tailMin + 1e-9; q += 0.05) {
    const p = total + start - (dur - q) + xf; if (p - start < total * 0.5 || p >= q - 4) continue;
    const L = Math.round(2 * hz), R = Math.round(0.5 * hz); const pi = Math.round(p * hz), qi = Math.round(q * hz);
    const score = windowCorr(o, pi - L, qi - L, L) * 0.7 + windowCorr(o, pi, qi, R) * 0.3;
    if (!best || score > best.score) best = { start, p, q, xf, tail: dur - q, score };
  }
  if (!best) throw new Error('no splice found');
  return best;
}
