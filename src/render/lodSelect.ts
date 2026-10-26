/* Pure helpers for flicker-free LOD switching (docs/flicker.md). No three.js: unit-testable without WebGL. */

/** Relative width (each side) of the hysteresis band around every LOD threshold. */
export const LOD_HYSTERESIS = 0.06;

/**
 * Hysteresis LOD selection. Level `i` is active while `value <= thresholds[i]` (ascending); the last level is `thresholds.length`.
 * The previous level is kept until the value leaves its band by more than `hyst` (relative) on either side, so a camera that
 * jitters around a threshold (zoom wheel inertia, pixel-ratio rounding, tween overshoot) can not toggle the level every frame.
 * `prev < 0` (first call) uses the plain threshold test.
 */
export function lodSelect(prev: number, value: number, thresholds: readonly number[], hyst = LOD_HYSTERESIS): number {
  const n = thresholds.length;
  if (prev < 0 || prev > n) { let l = 0; while (l < n && value > thresholds[l]!) l++; return l; }
  let l = prev;
  while (l < n && value > thresholds[l]! * (1 + hyst)) l++;
  while (l > 0 && value <= thresholds[l - 1]! * (1 - hyst)) l--;
  return l;
}

/** Binary hysteresis: `on` flips to true above `hi` and back to false below `lo` (lo < hi). */
export function schmitt(on: boolean, value: number, lo: number, hi: number): boolean {
  return on ? value > lo : value > hi;
}

/** Smooth 0..1 cross-fade weight (continuous, monotonic): 0 at `t0`, 1 at `t1`. */
export function fadeWeight(t: number, t0: number, t1: number): number {
  if (t1 === t0) return t >= t1 ? 1 : 0;
  const k = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
  return k * k * (3 - 2 * k);
}

/** Stable per-instance hash in [0, 1): same seed -> same value, whatever the camera does (no screen-space noise). */
export function instanceHash(seed: number): number {
  const x = Math.sin(seed * 91.7 + 3.1) * 43758.5453; // same maths as XFADE_VERT in props/Trees.ts
  return x - Math.floor(x);
}

/**
 * Per-instance cross-fade between two LOD levels at fade weight `w` (0 = all old level, 1 = all new level):
 * every instance belongs to exactly ONE of the levels at any weight (complementary masks: never both, never neither), and an instance
 * switches only once while `w` sweeps 0..1. Matches the GLSL in Trees.ts (`XFADE_*`).
 */
export function inNewLevel(seed: number, w: number): boolean { return instanceHash(seed) < w; }

/** Indices of `points` ([x, z] pairs flattened) ordered by squared distance to (tx, tz): cells nearest the camera target are built first. */
export function buildOrder(points: ArrayLike<number>, tx: number, tz: number): number[] {
  const n = points.length >> 1, idx = Array.from({ length: n }, (_, i) => i);
  const d = (i: number): number => (points[i * 2]! - tx) ** 2 + (points[i * 2 + 1]! - tz) ** 2;
  return idx.sort((a, b) => d(a) - d(b) || a - b);
}

/** Cross-fade clock: advances `t` (0..1) by dt / duration only while `ready` (the incoming level is built); never goes back. */
export function advanceFade(t: number, dt: number, duration: number, ready: boolean): number {
  return ready ? Math.min(1, t + dt / Math.max(1e-3, duration)) : t;
}
