import * as THREE from 'three';
import {
  SHADOW_MAP_SIZE, fitShadowWindow, quantiseHalf, quantiseSun, shadowSunDir, shadowDepthRange, shadowStrength, windowCovers, perspectiveRadius, type ShadowWindow,
} from './shadowFit';
import { patchLambertReceiver, shadowPassUniforms } from './shadowChunk';
import { PERSP_CAMERA_SLACK, SIG_SEED, castDensityTarget, mixSig, needsStaticRender, quantiseDensity, slewDensity, staticLoadScale } from './shadowSchedule';

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
  /** Cached depth of the STATIC casters (re-rendered only when the window / sun / static set changes) and the FINAL map the receivers sample (a GPU copy of the static depth + the dynamic casters drawn on top, every frame). */
  private rtStatic: THREE.WebGLRenderTarget | null = null;
  private rt: THREE.WebGLRenderTarget | null = null;
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  private readonly receivers: THREE.ShaderMaterial[] = [];
  private win: ShadowWindow | null = null;
  private camWin: ShadowWindow | null = null;
  private hasStatic = false;
  private age = 99; // seconds since the last static render
  private sig = SIG_SEED; private staticSig = -1; private sinceScan = 99;
  private readonly dyn: THREE.Object3D[] = [];
  private readonly lights: THREE.Object3D[] = [];
  private finalDirty = false;
  private density = 1; private densityQ = 1;
  private staticCam = new THREE.Vector3(1e9, 0, 0);
  private heights: [number, number] = [0, 100];
  private hidden: THREE.Object3D[] = [];
  private inDyn = false;
  private readonly excluded = new Set<THREE.Object3D>();
  private on = false;
  /** Materials adopted as receivers (built-in Lambert patched by wrapping their onBeforeCompile; custom ShaderMaterials flagged `userData.shadowRecv`). Restored when High goes off. */
  private readonly adopted = new Map<THREE.Material, { had: boolean; obc: THREE.Material['onBeforeCompile']; key: THREE.Material['customProgramCacheKey'] | null; lambert: boolean }>();
  private sinceAdopt = 99;
  private dummy: THREE.DepthTexture | null = null;
  private readonly realCam = new THREE.Vector3();
  /** Shared receiver uniforms (the same objects live in every receiver material). */
  readonly uniforms = {
    tShadow: { value: null as THREE.DepthTexture | null },
    uShadowM: { value: new THREE.Matrix4() },
    /** x strength 0..1, y depth bias, z 1 / map size, w normal offset (world units). */
    uShadowP: { value: new THREE.Vector4(0, 0, 1 / SHADOW_MAP_SIZE, 0) },
  };
  /** Triangle budget of the last main pass (a proxy for the shadow pass): above 75 % of it roots marked `userData.shadowHeavy` (the tree layers) cast with a falling density (a stable per-tree hash, slewed and quantised: no pop), reaching 0 at 2 x the budget. */
  heavyTriBudget = 1_200_000;
  private smoothDt = 1 / 60;
  /** Benchmark switch (scripts/shadow-cost.ts): `finish()` after every pass so `stats.*Ms` are real GPU / rasteriser times instead of submit times. Never on in the game. */
  measureSync = false;
  /** Last measured shadow pass: draw calls, triangles, ms, passes so far (docs/perf.md "Shadow pass"). */
  readonly stats = { calls: 0, triangles: 0, ms: 0, passes: 0, strength: 0, half: 0, totalMs: 0, staticPasses: 0, dynPasses: 0, dynCalls: 0, dynTriangles: 0, dynMs: 0, copyMs: 0, staticMsTotal: 0, dynMsTotal: 0, copyMsTotal: 0, density: 1, dynRoots: 0, memMB: 0 };

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
    if (on) { this.ensureTarget(); this.adopt(); }
    else {
      this.release(); this.freeTargets(); this.uniforms.tShadow.value = null; this.dummy?.dispose(); this.dummy = null; this.uniforms.uShadowP.value.x = 0; this.win = null; this.camWin = null; this.hasStatic = false; this.stats.strength = 0; this.stats.memMB = 0; shadowPassUniforms.uShDens.value = 1; }
  }

  /**
   * Finds receivers in the scene (cheap traversal, at most once a second while High is on): opaque built-in Lambert materials (buildings, lift stations, vehicles,
   * guests, props) get the shared receiver patch chained after their own onBeforeCompile; custom ShaderMaterials with `userData.shadowRecv` (trees, rocks) get the
   * shared uniforms. Both get the `USE_SHADOWS` define. Nothing is touched on Low / Med.
   */
  private adopt(): void { this.adoptTree(this.scene); }

  private adoptTree(o: THREE.Object3D): void {
    if (o.userData.noShadow || this.excluded.has(o)) return; // whole subtree: terrain, water, overlays, particles ...
    const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (mat) for (const m of Array.isArray(mat) ? mat : [mat]) this.adoptOne(m);
    for (const c of o.children) this.adoptTree(c);
  }

  private adoptOne(m: THREE.Material): void {
    if (this.adopted.has(m)) return;
    const sm = m as THREE.ShaderMaterial;
    if (sm.isShaderMaterial) {
      if (!m.userData.shadowRecv) return;
      Object.assign(sm.uniforms, this.uniforms);
      this.adopted.set(m, { had: false, obc: m.onBeforeCompile, key: null, lambert: false });
      this.applyDefine(sm);
      return;
    }
    if (!(m as THREE.MeshLambertMaterial).isMeshLambertMaterial || m.transparent) return;
    const had = Object.prototype.hasOwnProperty.call(m, 'onBeforeCompile');
    const obc = m.onBeforeCompile, key = Object.prototype.hasOwnProperty.call(m, 'customProgramCacheKey') ? m.customProgramCacheKey : null;
    const baseKey = m.customProgramCacheKey(); // computed before wrapping: the default key is the onBeforeCompile source text
    const uniforms = this.uniforms;
    m.onBeforeCompile = (shader, r): void => {
      obc.call(m, shader, r);
      Object.assign(shader.uniforms, uniforms);
      patchLambertReceiver(shader);
    };
    m.customProgramCacheKey = (): string => `${baseKey}|sunrecv`;
    this.adopted.set(m, { had, obc, key, lambert: true });
    this.applyDefine(m as unknown as THREE.ShaderMaterial);
  }

  /** Undoes `adopt` (High off): the original onBeforeCompile / cache key / defines return, so Low and Med compile exactly the programs they did before. */
  private release(): void {
    for (const [m, a] of this.adopted) {
      if (a.lambert) {
        if (a.had) m.onBeforeCompile = a.obc; else delete (m as { onBeforeCompile?: unknown }).onBeforeCompile;
        if (a.key) m.customProgramCacheKey = a.key; else delete (m as { customProgramCacheKey?: unknown }).customProgramCacheKey;
      }
      const sm = m as THREE.ShaderMaterial;
      if (sm.defines && 'USE_SHADOWS' in sm.defines) { const d = { ...sm.defines }; delete d.USE_SHADOWS; sm.defines = Object.keys(d).length ? d : (undefined as never); m.needsUpdate = true; }
    }
    this.adopted.clear();
  }

  private freeTargets(): void {
    for (const t of [this.rt, this.rtStatic]) { t?.dispose(); t?.depthTexture?.dispose(); }
    this.rt = null; this.rtStatic = null;
  }

  /** 16-bit depth (2 x 8 MB + 2 x 4 MB colour = 24 MB, the old single 32-bit map was 20 MB): the bias is ~40 steps at the usual windows. */
  private makeTarget(): THREE.WebGLRenderTarget {
    const dt = new THREE.DepthTexture(this.mapSize, this.mapSize);
    dt.format = THREE.DepthFormat;
    dt.type = THREE.UnsignedShortType;
    dt.compareFunction = THREE.LessEqualCompare;
    dt.minFilter = THREE.LinearFilter; dt.magFilter = THREE.LinearFilter;
    const rt = new THREE.WebGLRenderTarget(this.mapSize, this.mapSize, { depthBuffer: true, depthTexture: dt, format: THREE.RedFormat, type: THREE.UnsignedByteType, generateMipmaps: false });
    rt.texture.colorSpace = this.webgl.outputColorSpace; // same output colour space as the screen: the casters' shader programs are reused, not recompiled
    return rt;
  }

  private ensureTarget(): THREE.WebGLRenderTarget {
    if (this.rt && this.rtStatic) return this.rt;
    this.rtStatic = this.makeTarget(); this.rt = this.makeTarget();
    this.uniforms.tShadow.value = this.rt.depthTexture;
    const prev = this.webgl.getRenderTarget(); // allocate + clear both depth textures now: a main pass before the first shadow pass would otherwise sample an unallocated texture, and the GPU copy needs both framebuffers
    for (const t of [this.rtStatic, this.rt]) { this.webgl.setRenderTarget(t); this.webgl.clear(); }
    this.webgl.setRenderTarget(prev);
    this.stats.memMB = 2 * (this.mapSize * this.mapSize * (2 + 1)) / 1048576;
    return this.rt;
  }

  /**
   * Per frame (iso and perspective views): fits the window, re-renders the STATIC depth only when needed (new window, sun step, changed static set, tree cast
   * density, perspective camera moved; the rates of the last four slow down under load) and ALWAYS draws the DYNAMIC casters (guests, carriers, vehicles,
   * animals: roots flagged `userData.shadowDynamic`) on top of a GPU copy of the static depth, so moving shadows are never a frame behind.
   * @param camera the active camera, @param focus its target, @param sunDir unit vector toward the sun, @param night 0..1, @param overcast 0..1
   * @param heights world y range of terrain (+ tall casters): sets the shadow camera depth range
   */
  update(dt: number, active: boolean, camera: THREE.Camera, focus: THREE.Vector3, sunDir: V3, night: number, overcast: number, heights: [number, number]): void {
    if (!this.on) return;
    const q = quantiseSun(shadowSunDir(sunDir));
    const strength = active ? shadowStrength(night, overcast, sunDir[1] / Math.hypot(sunDir[0], sunDir[1], sunDir[2])) : 0;
    this.stats.strength = strength;
    if (strength < 0.02) { this.uniforms.uShadowP.value.x = 0; return; }
    this.sinceAdopt += dt;
    if (this.sinceAdopt >= 1) { this.sinceAdopt = 0; this.adopt(); }
    this.age += dt; this.sinceScan += dt;
    this.smoothDt += (Math.min(dt, 0.25) - this.smoothDt) * 0.1;
    const load = staticLoadScale(this.smoothDt);
    this.heights = heights;
    // the previous main pass's triangle count (info is read before any shadow render resets it): the tree cast density falls gradually past 75 % of the budget
    this.density = slewDensity(this.density, castDensityTarget(this.webgl.info.render.triangles, this.heavyTriBudget), dt);
    const dq = quantiseDensity(this.density);
    const persp = !(camera as THREE.OrthographicCamera).isOrthographicCamera;
    // Perspective views (ride / photo / walk): one window around the CAMERA (not its look direction), so a yaw never moves it; radius grows with the eye height (docs/shadows.md)
    const f: V3 = persp ? [camera.position.x, focus.y, camera.position.z] : [focus.x, focus.y, focus.z];
    const radius = persp ? perspectiveRadius(Math.max(0, camera.position.y - focus.y)) : this.viewRadius(camera, focus) + 4;
    this.realCam.copy(camera.position);
    const need = quantiseHalf(radius * 1.2 + 2);
    const sunChanged = !!this.win && (this.win.sunDir[0] !== q[0] || this.win.sunDir[1] !== q[1] || this.win.sunDir[2] !== q[2]);
    const sunDue = sunChanged && this.age >= 1 / (20 * load); // a pure sun step is rate limited (STATIC only); every re-fit adopts the newest sun
    if (!this.win || sunDue || !windowCovers(this.win, f, radius) || need < this.win.half / 1.3) {
      const w = fitShadowWindow(q, f, radius, this.mapSize);
      this.win = w;
      if (!w) { this.uniforms.uShadowP.value.x = 0; this.stats.half = 0; this.camWin = null; this.hasStatic = false; return; }
    }
    const win = this.win;
    if (!win) return;
    if (this.sinceScan >= 0.05 || !this.hasStatic) { this.sinceScan = 0; this.scan(); }
    const windowChanged = win !== this.camWin;
    const state = {
      hasStatic: this.hasStatic, windowChanged, age: this.age, sunChanged: false, // (a pure sun step re-fitted the window above)
      setChanged: this.sig !== this.staticSig, densityChanged: dq !== this.densityQ,
      cameraMoved: persp && this.staticCam.distanceToSquared(camera.position) > PERSP_CAMERA_SLACK * PERSP_CAMERA_SLACK,
    };
    if (needsStaticRender(state, load)) {
      if (windowChanged) this.setupCamera(win);
      shadowPassUniforms.uShDens.value = this.densityQ = dq;
      this.renderStatic();
      this.staticSig = this.sig; this.staticCam.copy(camera.position); this.age = 0; this.hasStatic = true; this.finalDirty = true;
      this.stats.density = dq;
    }
    if (this.hasStatic && (this.dyn.length > 0 || this.finalDirty)) this.renderFinal();
    this.stats.half = win.half; this.stats.dynRoots = this.dyn.length;
    const P = this.uniforms.uShadowP.value;
    P.x = strength; P.z = 1 / this.mapSize; P.w = Math.max(win.texel * 2.2, 0.05); // y (bias) is set with the matrix, in setupCamera()
  }

  /** Walks the visible scene (cheap, <= 20 Hz): collects the dynamic roots and the lights, and a signature of everything static that would land in the depth map (mesh / geometry ids, instance counts and matrix versions, visibility). */
  private scan(): void {
    this.dyn.length = 0; this.lights.length = 0; this.sig = SIG_SEED;
    this.scanObj(this.scene);
  }

  private scanObj(o: THREE.Object3D): void {
    if (!o.visible) return;
    if ((o as THREE.Light).isLight) this.lights.push(o);
    const ud = o.userData;
    if (ud.shadowDynamic) { this.dyn.push(o); return; }
    if (this.excluded.has(o) || ud.noShadow || NO_CAST_NAMES.has(o.name)) return;
    if (ud.shadowHeavy && this.densityQ <= 0) return;
    const m = o as THREE.InstancedMesh;
    if (m.isMesh) {
      const g = m.geometry, pos = g.attributes.position;
      let h = mixSig(this.sig, o.id);
      h = mixSig(h, g.id); h = mixSig(h, pos ? ((pos as THREE.BufferAttribute).version ?? 0) + pos.count : 0);
      if (m.isInstancedMesh) { h = mixSig(h, m.count); h = mixSig(h, m.instanceMatrix.version); }
      this.sig = h;
    }
    for (const c of o.children) this.scanObj(c);
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

  private setupCamera(win: ShadowWindow): void {
    const cam = this.cam, { right, up, sunDir } = win;
    const range = shadowDepthRange(win, this.heights[0], this.heights[1]);
    cam.left = -win.half; cam.right = win.half; cam.top = win.half; cam.bottom = -win.half; cam.near = range.near; cam.far = range.far;
    cam.updateProjectionMatrix();
    const cx = right[0] * win.u + up[0] * win.v + sunDir[0] * win.w, cy = right[1] * win.u + up[1] * win.v + sunDir[1] * win.w, cz = right[2] * win.u + up[2] * win.v + sunDir[2] * win.w;
    cam.position.set(cx + sunDir[0] * range.dist, cy + sunDir[1] * range.dist, cz + sunDir[2] * range.dist);
    cam.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...right), new THREE.Vector3(...up), new THREE.Vector3(...sunDir)));
    cam.updateMatrixWorld(true);
    const m = this.uniforms.uShadowM.value;
    m.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
    this.uniforms.uShadowP.value.y = 0.14 / (range.far - range.near); // depth bias in 0..1 depth units: ~0.14 world units
    this.camWin = win;
  }

  /** Runs one depth pass of `this.scene` into `target` with the receivers' sampling switched off (feedback guard) and the real camera published for the tree LOD bands. */
  private pass(target: THREE.WebGLRenderTarget, clear: boolean): void {
    // receivers must not sample the texture they are being drawn into (WebGL feedback loop): bind a 1x1 stand-in and switch the sampling off for the pass
    const P = this.uniforms.uShadowP.value, strength = P.x, realMap = this.uniforms.tShadow.value;
    this.uniforms.tShadow.value = this.dummyTexture(); P.x = 0;
    shadowPassUniforms.uShCam.value.set(this.realCam.x, this.realCam.y, this.realCam.z, 1);
    const bg = this.scene.background; this.scene.background = null;
    const prev = this.webgl.getRenderTarget(), ac = this.webgl.autoClear;
    this.webgl.setRenderTarget(target);
    this.webgl.autoClear = clear;
    try { this.render0(this.scene, this.cam); }
    finally {
      this.webgl.setRenderTarget(prev); this.webgl.autoClear = ac;
      this.scene.background = bg;
      shadowPassUniforms.uShCam.value.w = 0;
      this.uniforms.tShadow.value = realMap; P.x = strength;
    }
  }

  private renderStatic(): void {
    this.ensureTarget();
    const rt = this.rtStatic!;
    const t0 = performance.now();
    this.hide(this.scene);
    try { this.pass(rt, true); }
    finally { for (const o of this.hidden) o.visible = true; this.hidden.length = 0; }
    if (this.measureSync) this.webgl.getContext().finish();
    const info = this.webgl.info.render, ms = performance.now() - t0;
    this.stats.calls = info.calls; this.stats.triangles = info.triangles; this.stats.ms = ms; this.stats.totalMs += ms; this.stats.staticMsTotal += ms; this.stats.passes++; this.stats.staticPasses++;
  }

  /** Final map = GPU copy of the static depth, then the dynamic casters drawn on top (the scene's children are swapped for the lights + dynamic roots for the call: same scene, fog, lights and programs, nothing else is traversed or drawn). */
  private renderFinal(): void {
    const t0 = performance.now();
    this.webgl.copyTextureToTexture(this.rtStatic!.depthTexture!, this.rt!.depthTexture!);
    if (this.measureSync) { this.webgl.getContext().finish(); this.stats.copyMs = performance.now() - t0; }
    this.finalDirty = false;
    let calls = 0, tris = 0;
    if (this.dyn.length > 0) {
      const saved = this.scene.children;
      this.scene.children = [...this.lights, ...this.dyn];
      this.inDyn = true; for (const d of this.dyn) this.hide(d); this.inDyn = false;
      try { this.pass(this.rt!, false); const i = this.webgl.info.render; calls = i.calls; tris = i.triangles; }
      finally { this.scene.children = saved; for (const o of this.hidden) o.visible = true; this.hidden.length = 0; }
      this.finalDirty = true; // the dynamic casters are in the final map now: the next frame starts again from the static copy
    }
    if (this.measureSync) this.webgl.getContext().finish();
    const ms = performance.now() - t0;
    this.stats.dynCalls = calls; this.stats.dynTriangles = tris; this.stats.dynMs = ms; this.stats.dynMsTotal += ms; this.stats.copyMsTotal += this.stats.copyMs; this.stats.totalMs += ms; this.stats.passes++; this.stats.dynPasses++;
  }

  private dummyTexture(): THREE.DepthTexture {
    if (!this.dummy) {
      const d = new THREE.DepthTexture(1, 1);
      d.format = THREE.DepthFormat; d.type = THREE.UnsignedIntType; d.compareFunction = THREE.LessEqualCompare;
      d.minFilter = THREE.LinearFilter; d.magFilter = THREE.LinearFilter; d.needsUpdate = true; // uploaded as a real (empty) shadow-sampler texture
      this.dummy = d;
    }
    return this.dummy;
  }

  /** Hides everything that must not cast (excluded roots, transparent meshes, points / lines / sprites); restored right after the pass. */
  private hide(o: THREE.Object3D): void {
    if (!o.visible) return;
    if (o.userData.shadowHeavy && this.densityQ <= 0) { o.visible = false; this.hidden.push(o); return; }
    if (o.userData.shadowDynamic && !this.inDyn) { o.visible = false; this.hidden.push(o); return; } // drawn by the per-frame dynamic pass instead
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
