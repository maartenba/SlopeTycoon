import * as THREE from 'three';
import {
  SHADOW_MAP_SIZE, fitShadowWindow, quantiseHalf, quantiseSun, shadowSunDir, shadowDepthRange, shadowStrength, windowCovers, type ShadowWindow,
} from './shadowFit';

type V3 = [number, number, number];
/** Groups that never cast: flat draped decals (roads, rails, pistes) would shadow the ground they sit on. */
const NO_CAST_NAMES = new Set(['networks', 'springMarkers', 'emotes', 'railCrossings', 'model-gallery']);

/**
 * High-tier real sun shadows (M8 task 8.6, docs/shadows.md).
 *
 * Our own depth pass (not three's shadow system, which the custom prop / terrain shaders cannot sample): casters are rendered with THEIR OWN materials into a
 * depth-texture render target from an orthographic camera looking along the sun (colour output is discarded; because the materials are the real ones, custom
 * vertex shaders, instancing and billboards all land in the depth map correctly, and no extra shader programs are compiled). Receivers sample the depth
 * texture with hardware PCF: today only the terrain shader (`USE_SHADOWS` define), so tree / building / lift / guest shadows fall on the ground.
 *
 * Stable under camera motion: texel-snapped window with a quantised size and sun direction (shadowFit.ts); the pass is skipped while the sun is down.
 * Draw calls / triangles of this pass are counted separately (`stats`) and never show up in `renderer.info` of the main pass (it is reset by the main render).
 */
export class ShadowRig {
  private rt: THREE.WebGLRenderTarget | null = null;
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  private readonly receivers: THREE.ShaderMaterial[] = [];
  private win: ShadowWindow | null = null;
  private winKey = '';
  private sinceRender = 1;
  private hidden: THREE.Object3D[] = [];
  private readonly excluded = new Set<THREE.Object3D>();
  private on = false;
  /** Shared receiver uniforms (the same objects live in every receiver material). */
  readonly uniforms = {
    tShadow: { value: null as THREE.DepthTexture | null },
    uShadowM: { value: new THREE.Matrix4() },
    /** x strength 0..1, y depth bias, z 1 / map size, w normal offset (world units). */
    uShadowP: { value: new THREE.Vector4(0, 0, 1 / SHADOW_MAP_SIZE, 0) },
  };
  /** Max shadow-pass refresh rate (Hz) while only casters move (guests, vehicles); a re-fit or a sun step renders at once. */
  refreshHz = 10;
  /** Past this many triangles in the last main pass (a proxy for the shadow pass), roots marked `userData.shadowHeavy` (the tree layers) stop casting until it drops under 70 % of it (256-tile maps at wide zoom). */
  heavyTriBudget = 1_200_000;
  private skipHeavy = false;
  private smoothDt = 1 / 60;
  /** Last measured shadow pass: draw calls, triangles, ms, passes so far (docs/perf.md "Shadow pass"). */
  readonly stats = { calls: 0, triangles: 0, ms: 0, passes: 0, strength: 0, half: 0 };

  /** The renderer's own `render`, captured before any harness wraps it (the flicker / shot harnesses count wrapped calls as game frames; the shadow pass is not one). */
  private readonly render0: (scene: THREE.Scene, camera: THREE.Camera) => void;

  constructor(private readonly webgl: THREE.WebGLRenderer, private readonly scene: THREE.Scene, readonly mapSize = SHADOW_MAP_SIZE) {
    this.render0 = webgl.render.bind(webgl);
  }

  get enabled(): boolean { return this.on; }

  /** Roots never drawn into the shadow map (terrain, water, roads, overlays, particles ...). Transparent meshes, points, lines and sprites are skipped anyway. */
  exclude(...roots: THREE.Object3D[]): void { for (const r of roots) this.excluded.add(r); }

  /** Registers a material whose fragment shader has the `USE_SHADOWS` block; the define follows the tier. */
  addReceiver(m: THREE.ShaderMaterial): void {
    Object.assign(m.uniforms, this.uniforms);
    this.receivers.push(m);
    this.applyDefine(m);
  }

  private applyDefine(m: THREE.ShaderMaterial): void {
    const has = m.defines !== undefined && 'USE_SHADOWS' in m.defines;
    if (this.on && !has) { m.defines = { ...(m.defines ?? {}), USE_SHADOWS: '' }; m.needsUpdate = true; }
    else if (!this.on && has) { const d = { ...m.defines }; delete d.USE_SHADOWS; m.defines = d; m.needsUpdate = true; }
  }

  /** Tier switch. Off frees the render target and removes the define (the Low / Med shaders are byte-identical to before). */
  setEnabled(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    for (const m of this.receivers) this.applyDefine(m);
    if (on) this.ensureTarget();
    else { this.rt?.dispose(); this.rt?.depthTexture?.dispose(); this.rt = null; this.uniforms.tShadow.value = null; this.uniforms.uShadowP.value.x = 0; this.win = null; this.winKey = ''; this.stats.strength = 0; }
  }

  private ensureTarget(): THREE.WebGLRenderTarget {
    if (this.rt) return this.rt;
    const dt = new THREE.DepthTexture(this.mapSize, this.mapSize);
    dt.format = THREE.DepthFormat;
    dt.type = THREE.UnsignedIntType;
    dt.compareFunction = THREE.LessEqualCompare;
    dt.minFilter = THREE.LinearFilter; dt.magFilter = THREE.LinearFilter;
    this.rt = new THREE.WebGLRenderTarget(this.mapSize, this.mapSize, { depthBuffer: true, depthTexture: dt, format: THREE.RedFormat, type: THREE.UnsignedByteType, generateMipmaps: false });
    this.rt.texture.colorSpace = this.webgl.outputColorSpace; // same output colour space as the screen: the casters' shader programs are reused, not recompiled
    this.uniforms.tShadow.value = dt;
    return this.rt;
  }

  /**
   * Per frame, iso view only (`active`): fits the window around the view and refreshes the depth map when needed.
   * @param camera the iso camera, @param focus its target, @param sunDir unit vector toward the sun, @param night 0..1, @param overcast 0..1
   * @param heights world y range of terrain (+ tall casters): sets the shadow camera depth range
   */
  update(dt: number, active: boolean, camera: THREE.Camera, focus: THREE.Vector3, sunDir: V3, night: number, overcast: number, heights: [number, number]): void {
    if (!this.on) return;
    const q = quantiseSun(shadowSunDir(sunDir));
    const strength = active ? shadowStrength(night, overcast, sunDir[1] / Math.hypot(sunDir[0], sunDir[1], sunDir[2])) : 0;
    this.stats.strength = strength;
    if (strength < 0.02) { this.uniforms.uShadowP.value.x = 0; return; }
    const f: V3 = [focus.x, focus.y, focus.z];
    const radius = this.viewRadius(camera, focus) + 4;
    const need = quantiseHalf(radius * 1.2 + 2);
    const sunChanged = !this.win || this.win.sunDir[0] !== q[0] || this.win.sunDir[1] !== q[1] || this.win.sunDir[2] !== q[2];
    if (!this.win || sunChanged || !windowCovers(this.win, f, radius) || need < this.win.half / 1.3) {
      const w = fitShadowWindow(q, f, radius, this.mapSize);
      this.win = w;
      if (!w) { this.winKey = ''; this.uniforms.uShadowP.value.x = 0; this.stats.half = 0; return; }
    }
    const win = this.win;
    if (!win) return;
    const key = `${win.u.toFixed(4)}|${win.v.toFixed(4)}|${win.half}|${win.sunDir.join(',')}|${win.w}`;
    this.sinceRender += dt;
    this.smoothDt += (Math.min(dt, 0.25) - this.smoothDt) * 0.1;
    const hz = this.smoothDt > 0.034 ? Math.min(this.refreshHz, 3) : this.smoothDt > 0.022 ? Math.min(this.refreshHz, 6) : this.refreshHz; // a slow frame rate renders the map less often (never a re-fit: that is immediate)
    if (key !== this.winKey || this.sinceRender >= 1 / hz) {
      this.render(win, heights);
      this.winKey = key; this.sinceRender = 0;
    }
    this.stats.half = win.half;
    const P = this.uniforms.uShadowP.value;
    P.x = strength; P.z = 1 / this.mapSize; P.w = win.texel * 1.6; // y (bias) is set with the matrix, in render()
  }

  /** Radius (world units, on the ground plane through the focus) of the circle around the focus that contains the camera's whole view: rotation invariant. */
  private viewRadius(camera: THREE.Camera, focus: THREE.Vector3): number {
    camera.updateMatrixWorld();
    const inv = camera.projectionMatrixInverse;
    let r = 0;
    const o = new THREE.Vector3(), d = new THREE.Vector3();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
        o.set(sx, sy, -1).applyMatrix4(inv).applyMatrix4(camera.matrixWorld);
        d.set(0, 0, -1).transformDirection(camera.matrixWorld);
      } else {
        o.setFromMatrixPosition(camera.matrixWorld);
        d.set(sx, sy, 0.5).applyMatrix4(inv).applyMatrix4(camera.matrixWorld).sub(o).normalize();
      }
      if (Math.abs(d.y) < 1e-3) continue;
      const t = (focus.y - o.y) / d.y;
      r = Math.max(r, Math.hypot(o.x + d.x * t - focus.x, o.z + d.z * t - focus.z));
    }
    return r;
  }

  private render(win: ShadowWindow, heights: [number, number]): void {
    const rt = this.ensureTarget();
    const t0 = performance.now();
    const cam = this.cam, { right, up, sunDir } = win;
    const range = shadowDepthRange(win, heights[0], heights[1]);
    cam.left = -win.half; cam.right = win.half; cam.top = win.half; cam.bottom = -win.half; cam.near = range.near; cam.far = range.far;
    cam.updateProjectionMatrix();
    const cx = right[0] * win.u + up[0] * win.v + sunDir[0] * win.w, cy = right[1] * win.u + up[1] * win.v + sunDir[1] * win.w, cz = right[2] * win.u + up[2] * win.v + sunDir[2] * win.w;
    cam.position.set(cx + sunDir[0] * range.dist, cy + sunDir[1] * range.dist, cz + sunDir[2] * range.dist);
    cam.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...right), new THREE.Vector3(...up), new THREE.Vector3(...sunDir)));
    cam.updateMatrixWorld(true);
    const m = this.uniforms.uShadowM.value;
    m.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
    // depth bias in 0..1 depth units: ~0.14 world units
    this.uniforms.uShadowP.value.y = 0.14 / (range.far - range.near);
    // predictor: the main pass of the previous frame (still in `info`) has about the same triangle count as the shadow pass would
    const mainTris = this.webgl.info.render.triangles;
    this.skipHeavy = this.skipHeavy ? mainTris > this.heavyTriBudget * 0.7 : mainTris > this.heavyTriBudget;
    this.hide(this.scene);
    const bg = this.scene.background; this.scene.background = null;
    const prev = this.webgl.getRenderTarget(), ac = this.webgl.autoClear;
    this.webgl.setRenderTarget(rt);
    this.webgl.autoClear = true;
    this.render0(this.scene, cam);
    this.webgl.setRenderTarget(prev); this.webgl.autoClear = ac;
    this.scene.background = bg;
    for (const o of this.hidden) o.visible = true;
    this.hidden.length = 0;
    const info = this.webgl.info.render;
    this.stats.calls = info.calls; this.stats.triangles = info.triangles; this.stats.ms = performance.now() - t0; this.stats.passes++;
  }

  /** Hides everything that must not cast (excluded roots, transparent meshes, points / lines / sprites); restored right after the pass. */
  private hide(o: THREE.Object3D): void {
    if (!o.visible) return;
    if (o.userData.shadowHeavy && this.skipHeavy) { o.visible = false; this.hidden.push(o); return; }
    if (this.excluded.has(o) || o.userData.noShadow || NO_CAST_NAMES.has(o.name)) { o.visible = false; this.hidden.push(o); return; }
    const a = o as THREE.Object3D & { isMesh?: boolean; isPoints?: boolean; isLine?: boolean; isSprite?: boolean; material?: THREE.Material | THREE.Material[] };
    if (a.isPoints || a.isLine || a.isSprite) { o.visible = false; this.hidden.push(o); return; }
    if (a.isMesh) {
      const mats = Array.isArray(a.material) ? a.material : [a.material];
      if (mats.every((x) => !x || x.transparent)) { o.visible = false; this.hidden.push(o); return; }
    }
    for (const c of o.children) this.hide(c);
  }

  dispose(): void { this.setEnabled(false); }
}
