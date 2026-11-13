import type { Grid } from '@/world/Grid';
import { TileType } from '@/world/Grid';
import { diagonalNS } from './TerrainGeometry';

/**
 * Smooth shoreline for the DRAWN water (M8 water banks, docs/graphics-m8.md): a marching-squares-style contour of the blurred water mask.
 * Pure + WebGL-free; sim tiles are untouched. The field is the water mask blurred with a quadratic B-spline (`fieldAt`, global grid: identical at every chunk border),
 * sampled at `CONTOUR_SUB` cells per tile. The water surface mesh carries the field per vertex; the fragment shader
 * keeps the pixels where it is >= `CONTOUR_LEVEL`, so the drawn shoreline is one smooth curve (round lake corners, rounded river bends) instead of tile squares.
 * World-space only (no screen-space noise): stable under camera motion.
 */

/** Cells per tile edge in the contour mesh (2 => 8 triangles per tile). */
export const CONTOUR_SUB = 2;
/** Field value of the drawn waterline (0.5 = a straight shore sits on the tile edge). */
export const CONTOUR_LEVEL = 0.5;
/** Field slope across a straight shore, per tile (the shader turns the field into a distance with it). */
export const CONTOUR_SLOPE = 1;
/** Quadratic B-spline weight of a tile centre at signed distance `t` (tiles): C1, support +-1.5, partition of unity over whole-tile shifts. */
export function kernel(t: number): number {
  const a = Math.abs(t);
  return a < 0.5 ? 0.75 - a * a : a < 1.5 ? 0.5 * (1.5 - a) * (1.5 - a) : 0;
}

/**
 * Water field at tile-space position (px, py): the water / stream tile mask convolved with a separable quadratic B-spline. Continuous and C1 (so the 0.5 contour
 * is a smooth curve), exactly 0.5 on a straight shore and on both banks of a one-tile river (its centre line reads 0.75), 0.25 at a convex square corner,
 * ~1 deep in a lake. Reads the global tile grid only: identical at every chunk border. Pure, finite, in [0, 1].
 */
export function fieldAt(grid: Grid, px: number, py: number): number {
  const N = grid.size, bx = Math.floor(px), by = Math.floor(py);
  let f = 0;
  for (let ty = by - 1; ty <= by + 1; ty++) {
    if (ty < 0 || ty >= N) continue;
    const ky = kernel(py - (ty + 0.5));
    for (let tx = bx - 1; tx <= bx + 1; tx++) {
      if (tx < 0 || tx >= N) continue;
      const tt = grid.tileType[ty * N + tx];
      if (tt === TileType.Water || tt === TileType.Stream) f += ky * kernel(px - (tx + 0.5));
    }
  }
  return Math.min(1, Math.max(0, f));
}

/** The field at a tile corner (integer position). */
export function cornerField(grid: Grid, vx: number, vy: number): number { return fieldAt(grid, vx, vy); }

/** `corner(vx, vy)` and `at(px, py)` bound to one grid. */
export function makeField(grid: Grid): { corner: (vx: number, vy: number) => number; at: (px: number, py: number) => number } {
  return { corner: (vx, vy) => fieldAt(grid, vx, vy), at: (px, py) => fieldAt(grid, px, py) };
}

/** Height of the drawn terrain triangle (the same split `diagonalNS` picks) at tile-local (u, v), corners [n, e, s, w]. Exact on the terrain surface. */
export function triangleHeight(hs: readonly [number, number, number, number], u: number, v: number): number {
  const [n, e, s, w] = hs;
  if (diagonalNS(n, e, s, w)) return u <= v ? n + u * (s - w) + v * (w - n) : n + u * (e - n) + v * (s - e);
  return u + v <= 1 ? n + u * (e - n) + v * (w - n) : s + (1 - u) * (w - s) + (1 - v) * (e - s);
}

/**
 * The 2 x 2 x 2 triangles of a tile as 24 (u, v) pairs, each split along the tile's own diagonal so every vertex lies on the terrain triangle planes
 * (the water never twists through the bank). Stable count: always `CONTOUR_SUB^2 * 6`.
 */
export function tileCells(ns: boolean): Array<[number, number]> {
  const out: Array<[number, number]> = [], st = 1 / CONTOUR_SUB;
  for (let j = 0; j < CONTOUR_SUB; j++) for (let i = 0; i < CONTOUR_SUB; i++) {
    const p00: [number, number] = [i * st, j * st], p10: [number, number] = [(i + 1) * st, j * st], p11: [number, number] = [(i + 1) * st, (j + 1) * st], p01: [number, number] = [i * st, (j + 1) * st];
    if (ns) out.push(p00, p01, p11, p00, p11, p10);
    else out.push(p00, p01, p10, p01, p11, p10);
  }
  return out;
}

/** Concave wedge: a land tile next to water whose strongest corner field is above the waterline by this much gets a (hidden-where-terrain-is-higher) water patch. */
export const FRINGE_MIN = 0.6;

/** Same for a river bend: a land tile is added when one of its corners is above the waterline by this much (a straight bank sits at exactly 0.5). */
export const STREAM_FRINGE_MIN = 0.56;

/**
 * Tree line near a water vertex for the fake reflection (docs/graphics-m8.md "Lake reflections"): the tree cover of the tiles within `radius` tiles of (px, py),
 * weighted by a linear falloff, 0..1. `cover` is the sim's per-tile tree cover (`ForestCover.cover`, growth-weighted tree count). Pure, finite.
 */
export function treeNear(cover: ArrayLike<number>, N: number, px: number, py: number, radius = 3): number {
  let sum = 0, wsum = 0;
  const x0 = Math.floor(px - radius), x1 = Math.ceil(px + radius), y0 = Math.floor(py - radius), y1 = Math.ceil(py + radius);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    const r = Math.hypot(px - (tx + 0.5), py - (ty + 0.5)), w = Math.max(0, 1 - r / (radius + 0.5));
    if (w <= 0) continue;
    wsum += w;
    if (tx >= 0 && ty >= 0 && tx < N && ty < N) sum += w * Math.min(1, (cover[ty * N + tx] ?? 0) * 0.8);
  }
  return wsum > 0 ? Math.min(1, Math.max(0, (sum / wsum) * 1.6)) : 0;
}

/** Tree colour the reflection fades to: summer green -> autumn orange (`autumn` 0..1). Linear-ish sRGB triplet. */
export function treeReflectTint(autumn: number): [number, number, number] {
  const a = Math.min(1, Math.max(0, Number.isFinite(autumn) ? autumn : 0));
  return [0.10 + 0.50 * a, 0.22 + 0.10 * a, 0.10 - 0.02 * a];
}

/** Reflection strength 0..1 from the view's grazing term (cos of the angle between normal and view): grazing views reflect more. Art-directed (iso views are ~35-55 deg from vertical). */
export function reflectStrength(ndv: number): number {
  const c = Math.min(1, Math.max(0, ndv)), g = Math.pow(1 - c, 2);
  return 0.04 + 0.16 * g;
}
