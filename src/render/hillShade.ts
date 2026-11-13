import * as THREE from 'three';

/**
 * Hill shadows (High tier, docs/shadows.md "Hill shadows"): the terrain casting onto itself at a low sun. Terrain is not a caster in the shadow-map pass (it would
 * shadow itself everywhere), so a separate heightfield term is precomputed on the CPU: for every height-grid corner a short ray marches toward the sun and the
 * amount the terrain rises above it becomes a 0..1 visibility (soft penumbra that widens with distance). The result is ONE small R8 texture over the whole map
 * (world-space, bilinear): the terrain shader multiplies its sun term by it (scaled by the shadow strength, which fades with sun elevation, night and cloud).
 * Refreshed only when the (quantised) sun moves by `HILL_SUN_STEP_DEG` or the terrain changed, time-sliced over frames, swapped in whole: no pop, no per-frame cost.
 * Pure compute + a tiny texture holder; WebGL-free apart from `THREE.DataTexture`.
 */

/** Refresh when the sun (azimuth / elevation) moved by more than this many degrees since the last complete map. */
export const HILL_SUN_STEP_DEG = 0.75;
/** Longest ray in tiles. */
export const HILL_MAX_DIST = 72;
/** Rows computed per `step` call (a 257-row map finishes in ~33 frames; one row of 257 corners x <= 72 steps is ~18 k samples). */
export const HILL_ROWS_PER_STEP = 8;

type V3 = [number, number, number];

/**
 * Visibility 0..1 of the sun (1 = fully lit) at corner (vx, vy) of a (V x V) height grid (`heights` in half-steps, `unit` world units per step) for the unit
 * direction toward the sun `sun`. Bilinear height samples along the ray every 1 tile; the shortfall of the ray over the terrain, divided by a penumbra that
 * grows with distance, drives a smooth falloff. Pure, deterministic, finite.
 */
export function hillVisibility(heights: ArrayLike<number>, V: number, unit: number, sun: V3, vx: number, vy: number, maxH: number): number {
  const hz = Math.hypot(sun[0], sun[2]);
  if (hz < 1e-4 || sun[1] <= 0) return sun[1] <= 0 ? 0 : 1; // sun straight overhead: nothing shadows; below the horizon: all dark (strength is 0 then anyway)
  const dx = sun[0] / hz, dz = sun[2] / hz, rise = sun[1] / hz; // horizontal step per tile, ray rise per tile
  const N = V - 1;
  const h0 = heights[vy * V + vx]! * unit;
  let worst = 0;
  for (let k = 1; k <= HILL_MAX_DIST; k++) {
    const px = vx + dx * k, pz = vy + dz * k;
    if (px < 0 || pz < 0 || px > N || pz > N) break;
    const ray = h0 + rise * k + 0.12;
    if (ray > maxH) break; // the ray left the highest terrain
    const x0 = Math.min(N - 1, Math.floor(px)), z0 = Math.min(N - 1, Math.floor(pz)), fx = px - x0, fz = pz - z0;
    const a = heights[z0 * V + x0]!, b = heights[z0 * V + x0 + 1]!, c = heights[(z0 + 1) * V + x0]!, d = heights[(z0 + 1) * V + x0 + 1]!;
    const th = ((a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz) * unit;
    const over = (th - ray) / (0.5 + 0.16 * k); // soft edge: wider penumbra the farther the occluder
    if (over > worst) { worst = over; if (worst >= 1) break; }
  }
  const t = Math.min(1, Math.max(0, worst));
  return 1 - t * t * (3 - 2 * t);
}

/** True when the sun moved enough (angular distance between unit vectors above `stepDeg`) to warrant a new map. Pure. */
export function sunMoved(a: V3 | null, b: V3, stepDeg = HILL_SUN_STEP_DEG): boolean {
  if (!a) return true;
  const d = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  return Math.acos(d) * 180 / Math.PI > stepDeg;
}

export interface HillUniforms { tHill: { value: THREE.DataTexture | null }; /** x = 1 / (V - 1) (world -> uv), y = strength 0..1 (0 until the first map is complete) */ uHillP: { value: THREE.Vector2 } }

export interface HeightSource { readonly heights: ArrayLike<number>; readonly vsize: number; readonly terrainVersion: number }

/** The texture + the per-frame slicer. `uniforms` are merged into the receivers' shared uniforms by `ShadowRig`. */
export class HillShade {
  readonly uniforms: HillUniforms;
  private tex: THREE.DataTexture | null = null;
  private work: Uint8Array | null = null;
  private row = 0;
  private target: V3 | null = null;
  private done: V3 | null = null;
  private doneVersion = -1; private targetVersion = -1;
  private maxH = 0;
  /** Sliced work done so far (rows), for tests / stats. */
  private lastSun: V3 | null = null; private lastStrength = 0;
  /** QA / tests: finish the current (or a due) map right now, synchronously. */
  flush(): void { if (!this.lastSun) return; let guard = 0; do { this.step(this.lastSun, Math.max(this.lastStrength, 0.05)); } while (this.work !== null && ++guard < 10000); }
  rowsComputed = 0; mapsDone = 0; lastMapMs = 0; private t0 = 0;

  constructor(private readonly src: HeightSource, private readonly unit: number, uniforms?: HillUniforms) {
    this.uniforms = uniforms ?? { tHill: { value: null }, uHillP: { value: new THREE.Vector2(0, 0) } };
  }

  /** Free the texture (High off). */
  dispose(): void { this.tex?.dispose(); this.tex = null; this.work = null; this.uniforms.tHill.value = null; this.uniforms.uHillP.value.set(0, 0); this.done = null; this.target = null; this.doneVersion = -1; }

  /** Call every frame while High is on. `sun` = the unit direction the shadows are cast FROM (toward the sun), quantised; `strength` 0..1 is the global shadow strength. */
  step(sun: V3, strength: number): void {
    this.lastSun = sun; this.lastStrength = strength;
    const V = this.src.vsize;
    if (!this.tex) {
      const data = new Uint8Array(V * V).fill(255);
      this.tex = new THREE.DataTexture(data, V, V, THREE.RedFormat, THREE.UnsignedByteType);
      this.tex.minFilter = THREE.LinearFilter; this.tex.magFilter = THREE.LinearFilter;
      this.tex.wrapS = THREE.ClampToEdgeWrapping; this.tex.wrapT = THREE.ClampToEdgeWrapping;
      this.tex.generateMipmaps = false; this.tex.needsUpdate = true;
      this.uniforms.tHill.value = this.tex;
      this.uniforms.uHillP.value.x = 1 / (V - 1);
    }
    if (strength < 0.02) return; // sun down / night: nothing to compute, the term is off anyway
    const ver = this.src.terrainVersion;
    if (this.work === null) { // idle: start a new map when the sun or the terrain changed
      if (!sunMoved(this.done, sun) && ver === this.doneVersion) return;
      this.work = new Uint8Array(V * V); this.row = 0; this.target = sun; this.targetVersion = ver; this.t0 = performance.now();
      let m = -1e9; for (let i = 0; i < this.src.heights.length; i++) { const h = this.src.heights[i]!; if (h > m) m = h; }
      this.maxH = m * this.unit;
    }
    const end = Math.min(V, this.row + HILL_ROWS_PER_STEP), t = this.target!;
    for (let y = this.row; y < end; y++) for (let x = 0; x < V; x++) this.work[y * V + x] = Math.round(hillVisibility(this.src.heights, V, this.unit, t, x, y, this.maxH) * 255);
    this.rowsComputed += end - this.row; this.row = end;
    if (this.row >= V) { // complete: swap in whole
      (this.tex!.image.data as Uint8Array).set(this.work);
      this.tex!.needsUpdate = true;
      this.done = t; this.doneVersion = this.targetVersion; this.work = null; this.mapsDone++; this.lastMapMs += performance.now() - this.t0;
      this.uniforms.uHillP.value.y = 1;
    }
  }
}
