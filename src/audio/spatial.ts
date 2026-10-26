export interface Listener { x: number; z: number; /** Camera yaw (radians; same convention as CameraController.panBasis). */ yaw: number }
export interface SpatialResult { gain: number; pan: number; dist: number }

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));

/** Camera-relative gain/pan for a world-positioned source. `ref` = distance (tiles) at which gain halves-ish; pan uses the camera's screen-right axis. */
export function spatialParams(l: Listener, sx: number, sz: number, ref = 14): SpatialResult {
  const dx = sx - l.x, dz = sz - l.z, d = Math.hypot(dx, dz);
  const right = [Math.cos(l.yaw), -Math.sin(l.yaw)] as const;
  const side = d > 1e-6 ? (dx * right[0] + dz * right[1]) / d : 0;
  const q = d / Math.max(1e-6, ref);
  return { gain: 1 / (1 + q * q), pan: clamp(side * Math.min(1, d / Math.max(1, ref * 0.5)) * 0.85, -0.85, 0.85), dist: d };
}

/** 1 at the listener, 0 beyond `reach` tiles (linear). */
export function proximity(d: number, reach: number): number { return clamp(1 - d / Math.max(1e-6, reach), 0, 1); }

export interface Located { x: number; y: number }

/** Nearest of a set of tile-positioned sources (x,y = tile coords; the listener's z is the world z = tile y). */
export function nearestSource<T extends Located>(l: Listener, items: Iterable<T>): { item: T; dist: number } | null {
  let best: T | null = null, bd = Infinity;
  for (const it of items) { const d = Math.hypot(it.x - l.x, it.y - l.z); if (d < bd) { bd = d; best = it; } }
  return best ? { item: best, dist: bd } : null;
}
