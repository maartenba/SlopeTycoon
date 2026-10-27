/** Pure music theory helpers (no Web Audio). Scales are 7-note modes; "indices" are absolute scale-degree numbers (idx 0 = root, 7 = root + octave, -7 = root - octave). */
export const MODE_NAMES = ['ionian', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'aeolian'] as const;
export type ModeName = (typeof MODE_NAMES)[number];
export const MODES: Record<ModeName, readonly number[]> = {
  ionian: [0, 2, 4, 5, 7, 9, 11], dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10], aeolian: [0, 2, 3, 5, 7, 8, 10],
};
export const N = 7;

/** mulberry32 PRNG: deterministic, fast, good enough for composition. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** Mixes integers into one 32-bit seed. */
export function hashSeed(...xs: number[]): number {
  let h = 0x811c9dc5;
  for (const x of xs) { h ^= (x | 0) + 0x9e3779b9 + (h << 6) + (h >>> 2); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

const mod = (a: number, n: number): number => ((a % n) + n) % n;
/** MIDI note of scale index `idx` in the mode rooted at midi `root`. */
export function scaleNote(root: number, mode: ModeName, idx: number): number {
  const iv = MODES[mode];
  return root + 12 * Math.floor(idx / N) + iv[mod(idx, N)]!;
}
/** True when the midi note belongs to the mode (any octave). */
export function inScale(midi: number, root: number, mode: ModeName): boolean {
  const pc = mod(midi - root, 12);
  return MODES[mode].includes(pc);
}
/** Triad on scale degree `deg` built from stacked scale thirds: [deg, deg+2, deg+4] (absolute indices). */
export function chordIdx(deg: number): number[] { return [deg, deg + 2, deg + 4]; }
/** Seventh chord (adds deg+6). */
export function seventhIdx(deg: number): number[] { return [deg, deg + 2, deg + 4, deg + 6]; }
/** True if `idx` is one of the chord degrees (mod 7). */
export function isChordTone(idx: number, chord: readonly number[]): boolean { return chord.some((c) => mod(c - idx, N) === 0); }
/** Nearest scale index to `idx` that is a chord tone (ties go downward). */
export function nearestChordTone(idx: number, chord: readonly number[]): number {
  for (let d = 0; d <= 3; d++) { if (isChordTone(idx - d, chord)) return idx - d; if (isChordTone(idx + d, chord)) return idx + d; }
  return idx;
}
/** Voice leading: shift each chord tone by whole octaves so the voicing sits closest to `prev` (or to `center` when there is none). Sorted ascending. */
export function voiceLead(prev: readonly number[] | null, chord: readonly number[], center: number): number[] {
  const out = chord.map((c) => {
    const target = prev ? prev.reduce((a, b) => a + b, 0) / prev.length : center;
    return c + N * Math.round((target - c) / N);
  });
  out.sort((a, b) => a - b);
  // Keep the voicing compact (<= one octave + a third); fold the top note down if it strays.
  while (out[out.length - 1]! - out[0]! > N + 1) out[out.length - 1]! -= N;
  out.sort((a, b) => a - b);
  return out;
}
/** Beats -> seconds at `bpm`. */
export const beatsToSeconds = (beats: number, bpm: number): number => (beats * 60) / bpm;
export const secondsToBeats = (sec: number, bpm: number): number => (sec * bpm) / 60;
/** Tempo factor for game speed (notes are re-timed, pitch never changes). 0 (paused) counts as 1x. */
export function speedTempoMul(speed: number): number { return speed >= 3 ? 1.25 : speed >= 2 ? 1.12 : 1; }

/** Pentatonic subsets of each mode (scale degrees 0..6, no semitone clashes): major-ish modes drop degrees 4 and 7 (idx 3, 6), minor-ish modes drop 2 and 6 (idx 1, 5). */
export const PENTATONIC_DEGREES: Record<ModeName, readonly number[]> = {
  ionian: [0, 1, 2, 4, 5], lydian: [0, 1, 2, 4, 5], mixolydian: [0, 1, 2, 4, 5],
  dorian: [0, 2, 3, 4, 6], aeolian: [0, 2, 3, 4, 6], phrygian: [0, 2, 3, 4, 6],
};
/** Nearest scale index (ties go down) whose degree is in `allowed`. */
export function snapToDegrees(idx: number, allowed: readonly number[]): number {
  for (let d = 0; d <= 3; d++) { if (allowed.includes(mod(idx - d, N))) return idx - d; if (allowed.includes(mod(idx + d, N))) return idx + d; }
  return idx;
}
