/**
 * Promo camera keyframes (M7.6, docs/promo-video.md): a camera path as a PURE function of the virtual clock, so a re-shot scene gets the same frames.
 * A key is `{ t, v, ease? }` (t = seconds into the scene, v = a fixed-length number vector, ease = easing of the segment that STARTS at this key).
 * The vector layout is the caller's (iso: [x, z, zoom, yawDeg]; free: [px, py, pz, lx, ly, lz, fov]). Between keys the vector follows a
 * Catmull-Rom spline through the neighbouring keys (`spline: true`, the default) or a straight line; `ease` shapes the time inside one segment.
 * No DOM, no three.js.
 */
export type Ease = 'linear' | 'smooth' | 'in' | 'out' | 'inout';
export interface CamKey { t: number; v: number[]; ease?: Ease }

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export function applyEase(e: Ease | undefined, u: number): number {
  const c = clamp01(u);
  switch (e) {
    case 'smooth': return c * c * (3 - 2 * c);
    case 'in': return c * c;
    case 'out': return 1 - (1 - c) * (1 - c);
    case 'inout': return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
    default: return c;
  }
}

/** Catmull-Rom (uniform) between p1 and p2 with neighbours p0 / p3. */
export function catmull(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const u2 = u * u, u3 = u2 * u;
  return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
}

/** Sample the path at `t` seconds (clamped to the first / last key). Keys must be sorted by `t`. */
export function samplePath(keys: readonly CamKey[], t: number, spline = true): number[] {
  if (keys.length === 0) return [];
  if (t <= keys[0]!.t || keys.length === 1) return keys[0]!.v.slice();
  const last = keys[keys.length - 1]!;
  if (t >= last.t) return last.v.slice();
  let i = 0;
  while (i < keys.length - 2 && t >= keys[i + 1]!.t) i++;
  const a = keys[i]!, b = keys[i + 1]!, u = applyEase(a.ease, (t - a.t) / Math.max(1e-9, b.t - a.t));
  const p0 = keys[Math.max(0, i - 1)]!, p3 = keys[Math.min(keys.length - 1, i + 2)]!;
  return a.v.map((x, k) => (spline ? catmull(p0.v[k]!, x, b.v[k]!, p3.v[k]!, u) : x + (b.v[k]! - x) * u));
}

/** Free-camera yaw / pitch (radians, yaw 0 = looking toward -z like the ride rig's rotation order 'YXZ') for a position and a look-at point. */
export function lookAngles(p: readonly number[], l: readonly number[]): { yaw: number; pitch: number } {
  const dx = l[0]! - p[0]!, dy = l[1]! - p[1]!, dz = l[2]! - p[2]!;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

/** Piecewise-linear scalar timeline (hour of day, weather intensity...): `[[t, value], ...]`. */
export function sampleScalar(pts: ReadonlyArray<readonly [number, number]>, t: number): number {
  if (pts.length === 0) return 0;
  if (t <= pts[0]![0]) return pts[0]![1];
  for (let i = 0; i < pts.length - 1; i++) { const a = pts[i]!, b = pts[i + 1]!; if (t <= b[0]) return a[1] + (b[1] - a[1]) * ((t - a[0]) / Math.max(1e-9, b[0] - a[0])); }
  return pts[pts.length - 1]![1];
}
