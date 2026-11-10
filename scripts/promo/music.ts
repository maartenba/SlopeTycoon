/** Pure music helpers for the promo assembler (docs/promo-video.md "Round 3: the music edit"): a MUSICALLY CLEAN edit of the song to the film length.
 *  The cut plays the song from `start` (its natural beginning, or a bar-aligned section start for the teaser) to a beat A, jumps (ONE equal-power crossfade of ~100 ms that ends
 *  exactly on the beat) to the same position in a later bar B and plays on to the REAL end of the song (final cadence + ring-out). A and B are chosen from beat-level features
 *  (promo/music-*.json, made by scripts/promo/musicFeatures.py): same bar position (B - A a whole number of bars), similar chroma before / at / after the seam, similar level,
 *  a whole-cut speed change of at most 3 % (pitch-preserving atempo in the assembler) so the natural ending lands on time. No node / DOM imports (unit tested). */
export function envelope(samples: Float32Array, rate: number, hz = 100): Float32Array {
  const hop = Math.max(1, Math.round(rate / hz)); const n = Math.floor(samples.length / hop); const e = new Float32Array(n);
  for (let i = 0; i < n; i++) { let a = 0; for (let j = 0; j < hop; j++) { const v = samples[i * hop + j]!; a += v * v; } e[i] = Math.sqrt(a / hop); }
  return e;
}
/** Onset strength: the positive rises of the envelope. */
export function onsets(env: Float32Array): Float32Array { const o = new Float32Array(env.length); for (let i = 1; i < env.length; i++) o[i] = Math.max(0, env[i]! - env[i - 1]!); return o; }

export interface SongFeatures { dur: number; ending: number; beats: number[]; chroma: number[][]; rmsDb: number[]; novelty: number[]; timbre?: number[][] }
export interface EditOpts { total: number; endCard: number; xf: number; barBeats?: number; maxRate?: number; minBody?: number; startSections?: boolean; tailMin?: number }
export interface Edit {
  start: number; a: number; b: number; xf: number; rate: number; cut: boolean; ai: number; bi: number; si: number; score: number;
  cosPre: number; cosPost: number; cosAt: number; cosAcross: number; cosTimbre: number; dDb: number; landing: number; bodyDb: number; parts: { pre: number; post: number; at: number; energy: number; rate: number; landing: number; start: number };
}
const dot = (x: number[], y: number[]): number => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i]! * y[i]!; return s; };
const cosv = (x: number[], y: number[]): number => { const d = Math.sqrt(dot(x, x) * dot(y, y)); return d > 1e-12 ? dot(x, y) / d : 0; };
/** Mean chroma of beats [i, j). */
/** (also used for the timbre vectors: any per-beat vector, summed) */
export function meanChroma(c: number[][], i: number, j: number): number[] { const o = new Array<number>(c[0]?.length ?? 12).fill(0); const lo = Math.max(0, i), hi = Math.min(c.length, j); for (let k = lo; k < hi; k++) for (let m = 0; m < o.length; m++) o[m]! += c[k]![m]!; return o; }
const meanDb = (r: number[], i: number, j: number): number => { let s = 0, n = 0; for (let k = Math.max(0, i); k < Math.min(r.length, j); k++) { s += r[k]!; n++; } return n ? s / n : 0; };

/** Natural baseline: for every bar line i of the song, how different the bar before is from the bar after (chroma cosine, level difference in dB). A seam should look like these. */
export function naturalBaseline(f: SongFeatures, bar = 4): { cos: number[]; dDb: number[] } {
  const cos: number[] = [], dDb: number[] = [];
  for (let i = bar; i + bar <= f.beats.length; i += 1) { cos.push(cosv(meanChroma(f.chroma, i - bar, i), meanChroma(f.chroma, i, i + bar))); dDb.push(Math.abs(meanDb(f.rmsDb, i - bar, i) - meanDb(f.rmsDb, i, i + bar))); }
  return { cos, dDb };
}
export const pct = (v: number[], p: number): number => { const s = [...v].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]!; };

/** All edits the features allow, best first. Output length = (a - start) + (dur - b) = total * rate with |rate - 1| <= maxRate (rate > 1 = the whole cut is sped up by atempo). */
export function planEdit(f: SongFeatures, o: EditOpts, top = 5): Edit[] {
  const bar = o.barBeats ?? 4, maxRate = o.maxRate ?? 0.03, minBody = o.minBody ?? 8, n = f.beats.length, out: Edit[] = [];
  const starts: number[] = [-1]; // -1 = the very beginning of the file (its natural intro)
  if (o.startSections) for (let i = 4; i < n - 8; i++) if (f.novelty[i]! >= 0.45 && f.novelty[i]! >= f.novelty[i - 1]! && f.novelty[i]! >= f.novelty[i + 1]!) starts.push(i);
  const landTarget = o.total - o.endCard; const med = pct(f.rmsDb, 0.5);
  const consider = (si: number, ai: number, bi: number): void => {
    const start = si < 0 ? 0 : f.beats[si]!; const cut = ai >= 0; const a = cut ? f.beats[ai]! : start; const b = cut ? f.beats[bi]! : start;
    const len = cut ? (a - start) + (f.dur - b) : f.dur - start; const rate = len / o.total; if (Math.abs(rate - 1) > maxRate) return;
    if (cut && a - start < minBody) return;
    const landing = ((f.ending - start) - (cut ? b - a : 0)) / rate; // where the song's final cadence ends up in the film
    let pre = 1, post = 1, at = 1, energy = 1, across = 1, tim = 1, dDb = 0;
    if (cut) {
      pre = cosv(meanChroma(f.chroma, ai - bar, ai), meanChroma(f.chroma, bi - bar, bi)); post = cosv(meanChroma(f.chroma, ai, ai + bar), meanChroma(f.chroma, bi, bi + bar));
      at = cosv(f.chroma[ai]!, f.chroma[bi]!); across = cosv(meanChroma(f.chroma, ai - bar, ai), meanChroma(f.chroma, bi, bi + bar));
      if (f.timbre) tim = cosv(meanChroma(f.timbre, ai - bar, ai), meanChroma(f.timbre, bi, bi + bar)); // do the bar before the seam and the bar after it sound alike (texture, not just notes)
      dDb = Math.abs(meanDb(f.rmsDb, ai - 2, ai + 2) - meanDb(f.rmsDb, bi - 2, bi + 2)); energy = 1 - Math.min(1, dDb / 6);
    }
    const body = meanDb(f.rmsDb.map((v, i) => (f.beats[i]! >= start && f.beats[i]! <= a ? v : NaN)).filter((v) => !Number.isNaN(v)), 0, 1e9) ; // mean level of the part before the cut (a teaser should start strong)
    const parts = { pre, post, at, energy, rate: Math.abs(rate - 1) / maxRate, landing: Math.min(1, Math.abs(landing - landTarget) / 3), start: si < 0 ? 0 : 1 };
    const score = 0.2 * pre + 0.2 * post + 0.1 * at + 0.3 * across + 0.2 * energy - 0.12 * parts.rate - 0.15 * parts.landing - 0.15 * parts.start - 0.08 * Math.max(0, med - body);
    out.push({ start, a, b, xf: o.xf, rate, cut, ai, bi, si, score, cosPre: pre, cosPost: post, cosAt: at, cosAcross: across, cosTimbre: tim, dDb, landing, bodyDb: body, parts });
  };
  for (const si of starts) {
    const s0 = si < 0 ? 0 : si; consider(si, -1, -1);
    for (let ai = s0 + 1; ai < n - bar; ai++) for (let bi = ai + bar; bi < n; bi += bar) consider(si, ai, bi);
  }
  return out.sort((x, y) => y.score - x.score).slice(0, top);
}

/** Seam alignment: the beat tracker is only good to ~20 ms, so shift B by up to +/- maxShift s until the amplitude envelope (rectified, ~12 ms smoothing) around B's beat matches the one around A's beat
 *  (normalised cross correlation over `win` s before and 0.15 s after the beat): the attack lands where the listener expects it. (Two different bars of a recording never agree sample by sample, so a waveform
 *  correlation would only chase noise.) Returns the refined b and the envelope correlation. */
export function refineSeam(sig: Float32Array, rate: number, a: number, b: number, maxShift = 0.04, win = 0.25): { b: number; corr: number } {
  const k = Math.max(1, Math.round(0.006 * rate)); const ab = new Float32Array(sig.length); const cs = new Float64Array(sig.length + 1);
  for (let i = 0; i < sig.length; i++) cs[i + 1] = cs[i]! + Math.abs(sig[i]!);
  for (let i = 0; i < sig.length; i++) { const lo = Math.max(0, i - k), hi = Math.min(sig.length, i + k + 1); ab[i] = (cs[hi]! - cs[lo]!) / (hi - lo); }
  const A0 = Math.round((a - win) * rate), L = Math.round((win + 0.15) * rate), ms = Math.round(maxShift * rate); let best = { d: 0, c: -2 };
  for (let d = -ms; d <= ms; d++) {
    const B0 = Math.round((b - win) * rate) + d; let sa = 0, sb = 0; for (let i = 0; i < L; i++) { sa += ab[A0 + i] ?? 0; sb += ab[B0 + i] ?? 0; } sa /= L; sb /= L;
    let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < L; i++) { const x = (ab[A0 + i] ?? 0) - sa, y = (ab[B0 + i] ?? 0) - sb; sab += x * y; saa += x * x; sbb += y * y; }
    const c = saa > 1e-14 && sbb > 1e-14 ? sab / Math.sqrt(saa * sbb) : 0; if (c > best.c) best = { d, c };
  }
  return { b: b + best.d / rate, corr: best.c };
}
