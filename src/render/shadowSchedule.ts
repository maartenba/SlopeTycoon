/**
 * Pure scheduling / caching rules of the High-tier sun shadow map (docs/shadows.md "Static cache + dynamic pass"). No three.js: tested headless.
 *
 * The depth map is split in two: STATIC casters (buildings, towers, trees, rocks ...) are rendered into a cached depth target only when something about them
 * changed; DYNAMIC casters (guests, lift carriers, vehicles, animals ...) are drawn on top of a copy of the static depth EVERY frame, so they never lag the 60 fps
 * main pass. Only the static refresh is ever throttled (under load), never the dynamic pass.
 */

/** Static refresh rates (Hz) at full speed: sun-direction steps, and changes of the static set / camera-dependent tree LOD / cast density. A window re-fit is never throttled. */
export const STATIC_SUN_HZ = 20;
export const STATIC_SET_HZ = 8;
/** Under load only the STATIC refresh slows down: scale by smoothed frame time (s). */
export function staticLoadScale(smoothDt: number): number {
  return smoothDt > 0.034 ? 0.35 : smoothDt > 0.022 ? 0.6 : 1;
}

export interface StaticState {
  /** Whether a static map exists for the current window. */
  hasStatic: boolean;
  windowChanged: boolean;
  /** Seconds since the last static render. */
  age: number;
  sunChanged: boolean;
  setChanged: boolean;
  densityChanged: boolean;
  /** Perspective views: the camera moved more than the LOD-band slack since the static render. */
  cameraMoved: boolean;
}

/**
 * Whether the static depth map must be re-rendered now. A new window (re-fit) always renders at once (the map and its matrix must agree); a sun step, a change
 * of the static set (a building, a cell of trees entering the view), of the tree cast density or (perspective views) the camera, wait for their own rate.
 */
export function needsStaticRender(s: StaticState, load = 1): boolean {
  if (!s.hasStatic || s.windowChanged) return true;
  if (s.sunChanged && s.age >= 1 / (STATIC_SUN_HZ * load)) return true;
  if ((s.setChanged || s.densityChanged || s.cameraMoved) && s.age >= 1 / (STATIC_SET_HZ * load)) return true;
  return false;
}

/** Tree cast density 0..1 from the previous main pass's triangle count: 1 up to 50 % of the budget, falling linearly to 0 at the budget (the old hard cut-off point, so the pass never costs more than before; it used to switch from 1 to 0 in one step). */
export function castDensityTarget(mainTris: number, budget: number): number {
  const lo = budget * 0.5, hi = budget;
  if (!(mainTris > lo)) return 1;
  return Math.min(1, Math.max(0, 1 - (mainTris - lo) / (hi - lo)));
}

/** Slews the density toward its target at most `rate` per second (no jump), then quantises it to 1/DENSITY_STEPS so the static map only re-renders on a step. */
export const DENSITY_STEPS = 16;
export function slewDensity(cur: number, target: number, dt: number, rate = 0.25): number {
  const d = Math.min(Math.max(dt, 0), 0.25) * rate;
  return Math.min(1, Math.max(0, cur + Math.min(d, Math.max(-d, target - cur))));
}
export const quantiseDensity = (d: number): number => Math.round(Math.min(1, Math.max(0, d)) * DENSITY_STEPS) / DENSITY_STEPS;

/** Mirror of the shader's per-tree test (`shDropTree` in shadowChunk.ts): a stable hash of the instance seed. */
export function castHash(seed: number): number {
  const x = Math.sin(seed * 53.3 + 1.7) * 43758.5453;
  return x - Math.floor(x);
}
/** True when a tree with this seed casts a shadow at the given density. Nested: a tree that casts at density d also casts at every d' > d (so a density step only adds or removes the trees between two hashes: no pop of the rest). */
export const treeCasts = (seed: number, density: number): boolean => castHash(seed) < density;

/** FNV-style mixing for the static-set signature (32 bit). */
export function mixSig(h: number, v: number): number {
  return Math.imul((h ^ (v | 0)) >>> 0, 16777619) >>> 0;
}
export const SIG_SEED = 2166136261;

/** Slightly larger than the largest LOD-band slack: a perspective camera that moved this far since the static render refreshes it (tree bands are measured from the camera). */
export const PERSP_CAMERA_SLACK = 3;
