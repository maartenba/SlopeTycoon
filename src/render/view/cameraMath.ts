import * as THREE from 'three';

/** Equivalent "visible world height" (tiles) used for LOD decisions that cannot be derived from distance (animals, attraction crowds, smoke caps) while a perspective camera is active: close-range detail. */
export const PERSPECTIVE_LOD_HEIGHT = 30;
/** Terrain far-LOD switch value in perspective mode on macro-capable maps (> TERRAIN_MACRO_VIEW_HEIGHT): near chunks are protected full-res, the rest is merged. */
export const PERSPECTIVE_TERRAIN_FAR_HEIGHT = 140;
/** Full-resolution terrain radius around the ride camera (150 m = 15 tiles) on macro-capable maps. */
export const RIDE_NEAR_TERRAIN_TILES = 15;

export const isPerspective = (c: THREE.Camera): c is THREE.PerspectiveCamera => (c as THREE.PerspectiveCamera).isPerspectiveCamera === true;

/** Visible world height (tiles) of a camera: orthographic = top - bottom (unchanged iso behaviour); perspective = a constant near-LOD stand-in. */
export function lodHeightFor(camera: THREE.Camera): number {
  if (isPerspective(camera)) return PERSPECTIVE_LOD_HEIGHT;
  const o = camera as THREE.OrthographicCamera;
  return o.top - o.bottom;
}
export const getViewHeight = lodHeightFor;

/** Terrain LOD height: orthographic = lodHeightFor; perspective = far (merged macros + protected near chunks) on macro-capable maps, otherwise near. */
export function terrainLodHeightFor(camera: THREE.Camera, mapSize: number): number {
  if (isPerspective(camera)) return mapSize >= 256 ? PERSPECTIVE_TERRAIN_FAR_HEIGHT : PERSPECTIVE_LOD_HEIGHT;
  return lodHeightFor(camera);
}

const tmp = new THREE.Vector3();
/**
 * World point -> CSS pixels in `rect` (null when behind the camera / far outside the view). `scale` is a px-per-world-unit style factor:
 * orthographic = rect.height / viewHeight / 18 (the legacy float-text scale); perspective = 0.6 constant-ish (shrinks with distance, clamped).
 */
export function projectToScreen(camera: THREE.Camera, x: number, y: number, z: number, rect: { left: number; top: number; width: number; height: number }): { x: number; y: number; scale: number } | null {
  tmp.set(x, y, z).project(camera);
  if (tmp.z > 1 || (isPerspective(camera) && tmp.z < -1) || Math.abs(tmp.x) > 1.1 || Math.abs(tmp.y) > 1.1) return null;
  let scale: number;
  if (isPerspective(camera)) { const d = camera.position.distanceTo(tmp.set(x, y, z)); scale = Math.min(1.2, Math.max(0.3, 8 / Math.max(1, d))); } else {
    const o = camera as THREE.OrthographicCamera;
    scale = rect.height / (o.top - o.bottom) / 18;
  }
  tmp.set(x, y, z).project(camera);
  return { x: rect.left + (tmp.x * 0.5 + 0.5) * rect.width, y: rect.top + (-tmp.y * 0.5 + 0.5) * rect.height, scale };
}

/** Fraction of the screen height (from the top) where the horizon line sits for a camera pitch (radians, + = looking up) and vertical FOV (degrees). */
export function horizonFraction(pitchRad: number, fovDeg: number): number {
  const t = Math.tan((fovDeg * Math.PI) / 360);
  return 0.5 + Math.tan(pitchRad) / (2 * t);
}
