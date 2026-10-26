import * as THREE from 'three';
import { isPerspective } from '../view/cameraMath';

/**
 * Close-up LOD selection (M5.2 Task 11). PURE: a function of camera type + distance (+ the previous band for hysteresis).
 * Orthographic cameras (iso) ALWAYS get the base level at every zoom, so iso renders exactly like before the near variants existed.
 * 1 world unit = 1 tile = 10 m.
 */
export type NearBand = 'base' | 'near' | 'mid' | 'far';
export type CameraKind = 'ortho' | 'perspective';

/** Ground cameras: 'near' < 6 tiles (60 m), 'mid' < 20 tiles, 'far' beyond. */
export const NEAR_TILES = 6;
export const MID_TILES = 20;
/** Hysteresis (tiles): a band is only left once the distance is this far past its edge, so objects at an edge never flicker. */
export const NEAR_HYSTERESIS = 0.75;

/** Instance caps of the near variants (all bounded; the rest use the standard meshes). */
export const NEAR_CAPS = {
  /** Near-LOD figures (nearest first-come within NEAR_TILES) per gear batch / in total. */
  figuresPerBatch: 40,
  figuresTotal: 40,
  /** Near tree instances per near cell (1 chunk). */
  treesPerCell: 70,
  /** Near rock instances per cell. */
  rocksPerCell: 40,
} as const;

/** Live ground-level caps (set from the graphics preset by main.ts; defaults = the 'med' preset = the constants above). */
export const GROUND_CAPS = { nearTiles: NEAR_TILES as number, figures: NEAR_CAPS.figuresTotal as number };
export function setGroundCaps(c: { nearTiles: number; figures: number }): void { GROUND_CAPS.nearTiles = Math.max(0, c.nearTiles); GROUND_CAPS.figures = Math.max(0, Math.min(NEAR_CAPS.figuresTotal, c.figures)); }
const ORDER: NearBand[] = ['near', 'mid', 'far'];

export const cameraKindOf = (c: THREE.Camera): CameraKind => (isPerspective(c) ? 'perspective' : 'ortho');

/** Band for a camera type and a distance in tiles. `prev` (optional) applies hysteresis. */
export function nearLod(kind: CameraKind, dist: number, prev?: NearBand): NearBand {
  if (kind === 'ortho') return 'base';
  const d = Number.isFinite(dist) ? Math.max(0, dist) : Infinity;
  const e0 = GROUND_CAPS.nearTiles;
  if (e0 <= 0) return d < MID_TILES ? 'mid' : 'far'; // near LOD off (low quality)
  const edge = (i: number): number => (i === 0 ? e0 : MID_TILES);
  let idx = d < e0 ? 0 : d < MID_TILES ? 1 : 2;
  if (prev && prev !== 'base') {
    const p = ORDER.indexOf(prev);
    if (p >= 0 && p !== idx) {
      // keep the previous band while within the hysteresis margin of its boundary
      if (idx > p) { if (d < edge(p) + NEAR_HYSTERESIS) idx = p; } // moving outward: leave late
      else if (d >= edge(p - 1) - NEAR_HYSTERESIS) idx = p; // moving inward: leave late
    }
  }
  return ORDER[idx]!;
}

/** Convenience: pick by camera object. */
export function nearLodFor(camera: THREE.Camera, dist: number, prev?: NearBand): NearBand {
  return nearLod(cameraKindOf(camera), dist, prev);
}

export const isNear = (b: NearBand): boolean => b === 'near';

/** Distance fade weights for cross-fading two bands: 0 below (edge - w), 1 above (edge + w). Same maths as the tree shader (`uLodFade`). */
export function fadeWeight(dist: number, edge: number, w: number): number {
  if (w <= 0) return dist >= edge ? 1 : 0;
  const t = Math.min(1, Math.max(0, (dist - (edge - w)) / (2 * w)));
  return t * t * (3 - 2 * t);
}

/** Draw-call budget of a ride-along frame (renderer.info.render.calls) on a 128 map with hundreds of guests at 'med' quality; checked by `npm run perf:ground`. */
export const RIDE_DRAW_BUDGET_128 = 350;
