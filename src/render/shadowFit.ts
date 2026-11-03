/**
 * Pure maths of the High-tier sun shadow map (M8, docs/shadows.md). No three.js: tested headless.
 *
 * The shadow camera is an orthographic camera looking along -sunDir. Its window is a square of side 2 * half, centred on a point that is snapped to whole
 * texels in light space (and `half` is quantised to a geometric ladder), so a camera pan / rotate / small zoom never moves a shadow texel relative to the
 * world: no swimming, no shimmering edges. The sun direction itself is quantised (`quantiseSun`) so the light basis changes in small discrete steps.
 */
type V3 = [number, number, number];

export const SHADOW_MAP_SIZE = 2048;
/** Shadow window half sizes (world units) are `HALF_BASE * HALF_STEP^k`. */
export const HALF_BASE = 10;
export const HALF_STEP = 1.12;
/** Beyond this window half size the shadows switch off (a 2048 map spreads thinner than a screen pixel over ~400 world units: far zoom-out on 256 maps). */
export const MAX_HALF = 200;
/** The re-centre grid, in texels: the window only moves in multiples of this (and only when the view leaves it). */
export const SNAP_TEXELS = 8;
/** Sun direction quantisation (degrees of angle); keeps the light basis stable while the sun creeps. */
export const SUN_STEP_DEG = 0.25;

const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Quantises a unit sun direction to a grid in (azimuth, elevation) of `SUN_STEP_DEG`. Idempotent; returns a unit vector. */
export function quantiseSun(d: V3, stepDeg = SUN_STEP_DEG): V3 {
  const n = norm(d);
  const st = (stepDeg * Math.PI) / 180;
  const el = Math.asin(Math.min(1, Math.max(-1, n[1]))), az = Math.atan2(n[2], n[0]);
  const qe = Math.round(el / st) * st, qa = Math.round(az / st) * st;
  const c = Math.cos(qe);
  return [c * Math.cos(qa), Math.sin(qe), c * Math.sin(qa)];
}

/**
 * The direction the shadows are cast along: the real sun, lowered a little (elevation x ~0.7). Like the terrain's relief light (TerrainMesh `L`) this keeps a high
 * summer sun from tucking every shadow under its caster, so the shadows read from the iso camera; the lowering is the same at every hour (it is a look, not physics).
 */
export function shadowSunDir(d: V3, lower = SHADOW_SUN_LOWER): V3 {
  const h = Math.hypot(d[0], d[2]);
  return norm([d[0], Math.max(d[1] * lower, h * SHADOW_MIN_SLOPE), d[2]]); // never flatter than ~22 deg: a grazing dawn / dusk sun would comb the whole map with 10x-long fingers
}
export const SHADOW_MIN_SLOPE = 0.4; // ~22 deg: dawn / dusk fingers at most ~2.5x the caster (was 0.3 = 3.3x, a busy comb)
export const SHADOW_SUN_LOWER = 0.6;

/** Smallest ladder size >= `need` (never below HALF_BASE). */
export function quantiseHalf(need: number): number {
  const k = Math.max(0, Math.ceil(Math.log(Math.max(need, HALF_BASE) / HALF_BASE) / Math.log(HALF_STEP) - 1e-9));
  return HALF_BASE * Math.pow(HALF_STEP, k);
}

/** Light basis for a unit sun direction: x = right, y = up, z = toward the sun (the shadow camera's own axes). */
export function lightBasis(sunDir: V3): { right: V3; up: V3; z: V3 } {
  const z = norm(sunDir);
  const right = norm(cross([0, 1, 0], z));
  const up = cross(z, right);
  return { right, up, z };
}

export interface ShadowWindow {
  sunDir: V3; right: V3; up: V3;
  /** Window centre in light space (u along right, v along up), a multiple of `texel * SNAP_TEXELS`. */
  u: number; v: number;
  half: number; texel: number;
  /** Height of the centre point along the sun axis (rounded), the camera sits `dist` further toward the sun. */
  w: number;
}

/** True when a view footprint (circle of `radius` around `focus`) still fits in the window with `slack` world units to spare. */
export function windowCovers(win: ShadowWindow, focus: V3, radius: number, slack = 0): boolean {
  const du = Math.abs(dot(focus, win.right) - win.u), dv = Math.abs(dot(focus, win.up) - win.v);
  return Math.max(du, dv) + radius + slack <= win.half;
}

/**
 * Fits a (new) window around `focus` / `radius` for the quantised sun direction. `radius` is rotation invariant (a circle), so a camera yaw never refits.
 * Returns null when the needed window exceeds MAX_HALF (shadows off at this zoom).
 */
export function fitShadowWindow(sunDir: V3, focus: V3, radius: number, mapSize = SHADOW_MAP_SIZE): ShadowWindow | null {
  const half = quantiseHalf(radius * 1.2 + 2);
  if (half > MAX_HALF) return null;
  const { right, up, z } = lightBasis(sunDir);
  const texel = (2 * half) / mapSize, cell = texel * SNAP_TEXELS;
  const u = Math.round(dot(focus, right) / cell) * cell, v = Math.round(dot(focus, up) / cell) * cell;
  return { sunDir, right, up, u, v, half, texel, w: Math.round(dot(focus, z)) };
}

/** Depth range (near, far) of the shadow camera placed `dist` along the sun axis: covers casters up to `maxHeight` above and the terrain down to `minHeight`. */
export function shadowDepthRange(win: ShadowWindow, minHeight: number, maxHeight: number): { dist: number; near: number; far: number } {
  const R = Math.hypot(win.half * 1.5, Math.max(Math.abs(maxHeight), Math.abs(minHeight)) + 40);
  return { dist: R * 1.2, near: R * 0.2, far: R * 2.2 };
}

/** Strength 0..1 of the sun shadow from the day factor (`night` 0 day .. 1 night) and weather: fades through dusk, gone at night, softer under cloud. */
export function shadowStrength(night: number, overcast = 0, sunElevation = 1): number {
  const day = Math.min(1, Math.max(0, (1 - night) * 1.25 - 0.1));
  const low = 0.3 + 0.7 * Math.min(1, Math.max(0, sunElevation * 4)); // a grazing sun gives much fainter shadows (callers pass the REAL sun elevation): long dusk fingers fade instead of combing the map
  return Math.min(1, Math.max(0, day * low * (1 - 0.6 * Math.min(1, Math.max(0, overcast)))));
}

/** Perspective views (ride / photo / walk): shadow radius (world units) around the camera. Grows with the eye height above the ground (a gondola sees farther than a walker); the half-size ladder quantises it. Capped so a window stays <= ~120 (texel ~0.12). */
export const PERSP_RADIUS_BASE = 52;
export function perspectiveRadius(eyeHeight: number): number {
  const h = Number.isFinite(eyeHeight) ? Math.max(0, eyeHeight) : 0;
  return Math.min(90, PERSP_RADIUS_BASE + 0.8 * h);
}

/** Window for a perspective camera: centred on the camera's ground position (rotation invariant: yaw / pitch never move it), texel-snapped like the iso fit. Null beyond MAX_HALF. */
export function fitPerspectiveWindow(sunDir: V3, camPos: V3, groundY: number, mapSize = SHADOW_MAP_SIZE): ShadowWindow | null {
  return fitShadowWindow(sunDir, [camPos[0], groundY, camPos[2]], perspectiveRadius(camPos[1] - groundY), mapSize);
}
