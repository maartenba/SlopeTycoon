import { HEIGHT_UNIT } from '@/config/balance';
import type { Grid } from '@/world/Grid';

export interface Vec3 { x: number; y: number; z: number }

export interface PickResult {
  /** Hit point in world space (x = tile-x, z = tile-y, y = height). */
  point: Vec3;
  tileX: number;
  tileY: number;
  /** Nearest vertex to the hit point. */
  vx: number;
  vy: number;
}

/** Bilinear surface height (world units) at tile-space (x, z). */
export function heightAt(grid: Grid, x: number, z: number): number {
  const tx = Math.min(grid.size - 1, Math.max(0, Math.floor(x)));
  const ty = Math.min(grid.size - 1, Math.max(0, Math.floor(z)));
  const u = Math.min(1, Math.max(0, x - tx)), v = Math.min(1, Math.max(0, z - ty));
  const [n, e, s, w] = grid.getCorners(tx, ty);
  return (n * (1 - u) * (1 - v) + e * u * (1 - v) + s * u * v + w * (1 - u) * v) * HEIGHT_UNIT;
}

/** Ray-march a ray against the grid heightfield (uses grid data, independent of LOD meshes). */
export function pickHeightfield(grid: Grid, origin: Vec3, dir: Vec3, step = 0.2): PickResult | null {
  const len = Math.hypot(dir.x, dir.y, dir.z);
  if (len === 0 || dir.y >= 0) return null; // must descend
  const d = { x: dir.x / len, y: dir.y / len, z: dir.z / len };
  let maxH = 0;
  for (let i = 0; i < grid.heights.length; i++) if (grid.heights[i]! > maxH) maxH = grid.heights[i]!;
  const topY = maxH * HEIGHT_UNIT + 0.01;
  let t = origin.y > topY ? (topY - origin.y) / d.y : 0;
  const tEnd = (0 - origin.y) / d.y; // reaches y = 0 (heights >= 0)
  let prevT = t;
  const above = (tt: number): boolean => {
    const x = origin.x + d.x * tt, z = origin.z + d.z * tt;
    return origin.y + d.y * tt > heightAt(grid, x, z);
  };
  const inside = (tt: number): boolean => {
    const x = origin.x + d.x * tt, z = origin.z + d.z * tt;
    return x >= 0 && z >= 0 && x <= grid.size && z <= grid.size;
  };
  if (!above(t) && inside(t)) return build(grid, origin, d, t);
  for (; t <= tEnd + step; t += step) {
    if (!inside(t)) { prevT = t; continue; }
    if (!above(t)) {
      let lo = prevT, hi = t;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (above(mid) || !inside(mid)) lo = mid; else hi = mid;
      }
      return build(grid, origin, d, hi);
    }
    prevT = t;
  }
  return null;
}

function build(grid: Grid, o: Vec3, d: Vec3, t: number): PickResult | null {
  const x = Math.min(grid.size, Math.max(0, o.x + d.x * t));
  const z = Math.min(grid.size, Math.max(0, o.z + d.z * t));
  return {
    point: { x, y: heightAt(grid, x, z), z },
    tileX: Math.min(grid.size - 1, Math.floor(x)),
    tileY: Math.min(grid.size - 1, Math.floor(z)),
    vx: Math.min(grid.size, Math.round(x)),
    vy: Math.min(grid.size, Math.round(z)),
  };
}
