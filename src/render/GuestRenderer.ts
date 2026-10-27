import * as THREE from 'three';
import { isPerspective } from './view/cameraMath';
import { GROUND_CAPS, NEAR_CAPS, nearLod } from './lod/nearLod';
import type { GuestStore } from '@/sim/guests/Guest';
import { GState, WP_MAX } from '@/sim/guests/Guest';
import { pathPoint, type Pt2 } from './guestPath';
import {
  appearanceOf, BOTTOM_COLORS, CLOTH_COLORS, Gear, GEAR_COUNT, gearFor, typeGearOf, typeOutfitOf, HAIR_COLORS, outfitFor, POSE, rand01, SKIN_TONES, UsingKind, type Appearance,
} from './guestAppearance';
import { coreOf, extraDef } from '../config/guestTypes';
import { LOD_HYSTERESIS, schmitt } from './lodSelect';
import { ARM_PIVOT_Y, BIKE_WHEEL_R, BIKE_WHEEL_Z, buildGearGeometry, HIP_PIVOT } from './meshes/Figures';

/** Colour by guest type: solo, couple, family, VIP, budget, adventure (impostor points / legend). */
export const GUEST_COLORS = [0x4a90d9, 0xf06292, 0x5cb85c, 0xf2c14e, 0x8a9099, 0xf08a24] as const;
/** Visible world height (camera top-bottom) above which guests are drawn as impostor points. */
export const GUEST_FAR_VIEW_HEIGHT = 70;
/** Game speed multiplier from which guests are drawn as impostor points in the iso view (at 10x a walker covers 50+ tiles/s: figures only blur). */
export const GUEST_IMPOSTOR_MIN_SPEED = 10;
/** Pure: impostor (points) rendering decision. `speedMul` = SPEED_MULTIPLIERS[speed] (0 paused counts as slow). Perspective views keep figures (they are real-time ground views). */
export function useGuestImpostor(opts: { persp: boolean; viewHeight: number; farScale: number; speedMul: number }): boolean {
  if (opts.persp) return false;
  return opts.viewHeight > GUEST_FAR_VIEW_HEIGHT * opts.farScale || opts.speedMul >= GUEST_IMPOSTOR_MIN_SPEED;
}
/** Pure: figure -> impostor switch with hysteresis (a camera that jitters around the threshold keeps its mode). */
export function guestFarByView(prev: boolean, viewHeight: number, farScale: number): boolean {
  const lim = GUEST_FAR_VIEW_HEIGHT * farScale;
  return schmitt(prev, viewHeight, lim * (1 - LOD_HYSTERESIS), lim * (1 + LOD_HYSTERESIS));
}
/** Gait phase units per real second per (capped) tile/tick of displacement: walking = 0.5 x GAIT_RATE x FREQ(20) = 16 rad/s (~2.5 strides/s), independent of the game speed. */
export const GAIT_RATE = 1.6;
/** Phase units per real second of the 'animate when still' poses (sit, idle). */
export const STILL_RATE = 0.5;
/** Draw-call budget of the whole guest layer (gear batches + the far impostor). */
export const GUEST_DRAW_CALLS = GEAR_COUNT + 1;

/* ------------------------------------------------------------------ shader (Lambert + per-instance appearance + vertex animation) */
const VS_COMMON = /* glsl */ `
attribute vec4 aTag; attribute vec4 iA; attribute vec4 iB; attribute vec4 iC;
uniform vec3 uSkin[8]; uniform vec3 uHairC[8]; uniform vec3 uCloth[16]; uniform vec3 uBot[8];
varying vec3 vCol; varying vec3 vCol2; varying float vT; varying float vSplit;
float gLeg, gArm, gSway, gBob, gWheel, gVis;
vec3 rotX(vec3 v, float a, vec2 piv, float isPos) {
  v.yz -= piv * isPos; float c = cos(a), s = sin(a);
  v = vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c); v.yz += piv * isPos; return v;
}
vec3 animV(vec3 v, float isPos) {
  float j = aTag.y;
  if (isPos > 0.5) {
    if (aTag.x < 2.5) { v.xz *= iC.z; if (aTag.x < 0.5 && mod(floor(iB.w / 2.0), 2.0) > 0.5) v.x *= 0.93; }
    else if (j > 8.5) v = (v - vec3(0.0, 0.43, 0.0)) * iC.w + vec3(0.0, 0.43, 0.0);
  }
  if (j > 0.5 && j < 2.5) v = rotX(v, (j < 1.5 ? 1.0 : -1.0) * gLeg, HIP_PIV, isPos);
  else if (j > 2.5 && j < 4.5) v = rotX(v, (j < 3.5 ? -1.0 : 1.0) * gArm, vec2(ARM_Y, 0.0), isPos);
  else if (j > 5.5 && j < 7.5) v = rotX(v, gWheel, vec2(WHEEL_R, j < 6.5 ? WHEEL_Z : -WHEEL_Z), isPos);
  float cs = cos(gSway), sn = sin(gSway);
  v = vec3(v.x * cs - v.y * sn, v.x * sn + v.y * cs, v.z);
  v.y += isPos * gBob;
  return v;
}
`;
const VS_NORMAL = /* glsl */ `
#include <beginnormal_vertex>
{
  float kind = floor(aTag.z / 16.0), idv = mod(aTag.z, 16.0);
  gVis = (kind < 0.5 || (kind < 1.5 && abs(idv - iB.x) < 0.5) || (kind > 1.5 && mod(iB.w, 2.0) > 0.5)) ? 1.0 : 0.0;
  float mv = STILL > 0.5 ? 1.0 : clamp(iC.y / 0.04, 0.0, 1.0);
  float ph = iC.x * FREQ;
  gLeg = LEGA * sin(ph) * mv; gArm = ARMA * sin(ph) * mv; gSway = SWAY * sin(ph * 0.7 + 1.0) * mv;
  gBob = BOB * abs(sin(ph)) * mv; gWheel = iC.x * WHEELK;
  objectNormal = animV(objectNormal, 0.0);
}
`;
const VS_BEGIN = /* glsl */ `
vec3 transformed = animV(vec3(position), 1.0) * gVis;
{
  float outfit = floor(iB.w / 4.0);
  vec3 skin = uSkin[int(iA.x)], top = uCloth[int(iA.z)], bot = uBot[int(iA.w)];
  float part = aTag.x;
  vT = aTag.w; vSplit = -1.0;
  vec3 c = vec3(0.5);
  if (part < 0.5) { c = outfit > 1.5 ? skin : top; vCol2 = bot; vSplit = 0.26; }
  else if (part < 1.5) { c = bot; vCol2 = outfit < 0.5 ? bot : skin; vSplit = outfit < 0.5 ? -1.0 : (outfit > 1.5 ? 0.8 : 0.62); }
  else if (part < 2.5) { c = outfit > 1.5 ? skin : top; vCol2 = outfit < 0.5 ? vec3(0.015, 0.015, 0.02) : skin; vSplit = outfit > 1.5 ? 2.0 : (outfit < 0.5 ? 0.16 : 0.58); }
  else if (part < 3.5) c = vec3(0.012, 0.009, 0.007);
  else if (part < 4.5) c = skin;
  else if (part < 5.5) c = uHairC[int(iA.y)];
  else if (part < 6.5) c = uCloth[int(iB.y)];
  else if (part < 7.5) c = uCloth[int(iB.z)];
  else if (part < 8.5) c = vec3(0.012);
  else c = vec3(0.6, 0.62, 0.66);
  vCol = c;
  if (vSplit < -0.5) vCol2 = c;
}
`;
const FS_COMMON = 'varying vec3 vCol; varying vec3 vCol2; varying float vT; varying float vSplit;\n';
const FS_DIFFUSE = 'vec4 diffuseColor = vec4( (vT < vSplit ? vCol2 : vCol) * diffuse, opacity );';

interface Palette { uSkin: { value: THREE.Vector3[] }; uHairC: { value: THREE.Vector3[] }; uCloth: { value: THREE.Vector3[] }; uBot: { value: THREE.Vector3[] } }
function makePalette(): Palette {
  const v = (hexes: readonly number[]): THREE.Vector3[] => hexes.map((h) => { const c = new THREE.Color(h); return new THREE.Vector3(c.r, c.g, c.b); });
  return { uSkin: { value: v(SKIN_TONES) }, uHairC: { value: v(HAIR_COLORS) }, uCloth: { value: v(CLOTH_COLORS) }, uBot: { value: v(BOTTOM_COLORS) } };
}

/** Lambert material for one gear batch: scene lights (day/night/season already consistent), per-instance colours + animation in the vertex shader. */
export function createFigureMaterial(gear: number, pal: Palette): THREE.MeshLambertMaterial {
  const P = POSE[gear]!, hip = HIP_PIV(gear);
  const f = (n: number): string => (Number.isInteger(n) ? `${n}.0` : String(n));
  const defs = `#define LEGA ${f(P.leg)}\n#define ARMA ${f(P.arm)}\n#define SWAY ${f(P.sway)}\n#define BOB ${f(P.bob)}\n#define WHEELK ${f(P.wheel)}\n#define FREQ ${f(P.freq)}\n#define STILL ${f(P.still)}\n`
    + `#define HIP_PIV vec2(${f(hip[0])}, ${f(hip[1])})\n#define ARM_Y ${f(ARM_PIVOT_Y)}\n#define WHEEL_R ${f(BIKE_WHEEL_R)}\n#define WHEEL_Z ${f(BIKE_WHEEL_Z)}\n`;
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  mat.name = `guest-figure-${gear}`;
  mat.onBeforeCompile = (s): void => {
    Object.assign(s.uniforms, pal);
    s.vertexShader = defs + s.vertexShader
      .replace('#include <common>', `#include <common>\n${VS_COMMON}`)
      .replace('#include <beginnormal_vertex>', VS_NORMAL)
      .replace('#include <begin_vertex>', VS_BEGIN);
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>\n${FS_COMMON}`).replace('vec4 diffuseColor = vec4( diffuse, opacity );', FS_DIFFUSE);
  };
  mat.customProgramCacheKey = (): string => `guest-figure-${gear}`;
  return mat;
}
const HIP_PIV = (gear: number): [number, number] => HIP_PIVOT[gear] ?? [0.215, 0];

interface Batch { mesh: THREE.InstancedMesh; a: Float32Array; b: Float32Array; c: Float32Array; attrs: THREE.InstancedBufferAttribute[]; n: number }

/**
 * Instanced guest rendering: one InstancedMesh per gear/pose batch (walk, hike, ski, board, bike, lift seat, skate, lying), each a merged low-poly human
 * (~120-250 triangles) whose colours (skin/hair/clothes/gear), body build, head-wear and limb animation come from per-instance attributes + the vertex
 * shader, plus a Points impostor used when zoomed far out. Appearance is derived from the guest id (see guestAppearance.ts); no sim state is added.
 * Per frame CPU work per visible guest: view cull, a few multiply-adds for heading/speed/animation phase, and ~28 float writes; no allocations.
 */
export class GuestRenderer {
  readonly group = new THREE.Group();
  private batches: Batch[] = [];
  /** Close-up (> detail, <= 400 tris) variants of every gear batch: ground cameras only, at most NEAR_CAPS.figuresTotal guests within NEAR_TILES. */
  private nearBatches: Batch[] = [];
  private readonly nearFlag: Uint8Array;
  /** Guests drawn with the near mesh last update (diagnostics / tests). */
  nearDrawn = 0;
  /** Triangles per near gear geometry. */
  readonly nearGearTriangles: number[] = [];
  private points: THREE.Points;
  private pointPos: Float32Array;
  private pointCol: Float32Array;
  private colors: THREE.Color[] = GUEST_COLORS.map((c) => new THREE.Color(c));
  /** Impostor / legend colour of an extra guest type (look hook, else its fallback core type's colour); cached in `colors`. */
  private extraColour(type: number): THREE.Color {
    const d = extraDef(type);
    const c = new THREE.Color(d?.look?.colour ?? GUEST_COLORS[coreOf(type)] ?? GUEST_COLORS[0]);
    this.colors[type] = c;
    return c;
  }
  /** Slots currently drawn (index -> slot), for picking. */
  private drawn: Int32Array;
  drawnCount = 0;
  far = false;
  private farByView = false;
  /** Slot not drawn (the guest the ride camera sits in), -1 = none. */
  hideSlot = -1;
  /** Perspective views: figures are drawn full-detail up to this camera distance (tiles), nobody beyond. */
  perspectiveRange = 120;
  /** Multiplier on GUEST_FAR_VIEW_HEIGHT (graphics quality). */
  farScale = 1;
  /** Current game speed multiplier (1 / 3 / 8, 0 paused): >= GUEST_IMPOSTOR_MIN_SPEED draws impostor points in the iso view. */
  speedMul = 1;
  /** Real seconds of the current frame (gait phase is real-time based, so it never slows with the 150 s day). */
  frameSeconds = 1 / 60;
  /** Guests drawn along their real path (not the chord) last update (diagnostics / tests). */
  pathDrawn = 0;
  private readonly tmpPt: Pt2 = { x: 0, y: 0 };
  /** Guests submitted last update / skipped by view culling (diagnostics). */
  culled = 0;
  /** Winter clothing + head-wear (set from the season). */
  private _winter = false;
  get winter(): boolean { return this._winter; }
  set winter(v: boolean) { if (v !== this._winter) { this._winter = v; this.appVer++; this.lastCount = -1; } }
  /** Optional host hooks: kid status from the family system, and what a 'Using' guest is doing (UsingKind). */
  isKid: ((slot: number) => boolean) | null = null;
  usingKind: ((slot: number) => number) | null = null;
  private readonly pv = new THREE.Matrix4();
  private readonly lastPv = new Float64Array(16);
  private lastAlpha = -1;
  private lastTick = -1;
  private lastFar = false;
  private lastScale = 1;
  private lastCount = -1;
  private lastHide = -1;
  private lastTime = -1;
  private appVer = 1;
  // per-slot caches
  private readonly appId: Int32Array; private readonly appV: Int32Array;
  private readonly app: Float32Array; // 12 per slot: skin,hair,top,bottom, hairStyle,hat,gearCol,flags(pack+2*female), build, head, scale, age
  private readonly jit: Float32Array; // 0..1 smoothed 'standing' factor: render-only spread of waiting guests
  private readonly hs: Float32Array; private readonly hc: Float32Array; // heading sin/cos
  private readonly dist: Float32Array; // accumulated animation distance
  private readonly tmpApp = {} as Appearance;
  /** Triangles per gear geometry (diagnostics). */
  readonly gearTriangles: number[] = [];

  constructor(private store: GuestStore) {
    const n = store.capacity;
    const pal = makePalette();
    for (let g = 0; g < GEAR_COUNT; g++) {
      const geo = buildGearGeometry(g);
      this.gearTriangles.push(geo.getAttribute('position').count / 3);
      const a = new Float32Array(n * 4), b = new Float32Array(n * 4), c = new Float32Array(n * 4);
      const attrs = [a, b, c].map((arr, k) => { const at = new THREE.InstancedBufferAttribute(arr, 4).setUsage(THREE.DynamicDrawUsage); geo.setAttribute(['iA', 'iB', 'iC'][k]!, at); return at; });
      const fmat = createFigureMaterial(g, pal);
      const mesh = new THREE.InstancedMesh(geo, fmat, n);
      mesh.name = `guests-${g}`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.batches.push({ mesh, a, b, c, attrs, n: 0 });
      this.group.add(mesh);
      // near variant: same material (same per-instance attributes + animation), richer geometry, tiny instance capacity
      const ng = buildGearGeometry(g, true);
      this.nearGearTriangles.push(ng.getAttribute('position').count / 3);
      const cap = NEAR_CAPS.figuresPerBatch;
      const na = new Float32Array(cap * 4), nb = new Float32Array(cap * 4), nc = new Float32Array(cap * 4);
      const nattrs = [na, nb, nc].map((arr, k) => { const at = new THREE.InstancedBufferAttribute(arr, 4).setUsage(THREE.DynamicDrawUsage); ng.setAttribute(['iA', 'iB', 'iC'][k]!, at); return at; });
      const nmesh = new THREE.InstancedMesh(ng, fmat, cap);
      nmesh.name = `guests-near-${g}`;
      nmesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      nmesh.frustumCulled = false;
      nmesh.count = 0; nmesh.visible = false;
      this.nearBatches.push({ mesh: nmesh, a: na, b: nb, c: nc, attrs: nattrs, n: 0 });
    }
    this.nearFlag = new Uint8Array(n);
    this.pointPos = new Float32Array(n * 3);
    this.pointCol = new Float32Array(n * 3);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.pointPos, 3).setUsage(THREE.DynamicDrawUsage));
    pg.setAttribute('color', new THREE.BufferAttribute(this.pointCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(pg, new THREE.PointsMaterial({ size: 4, sizeAttenuation: false, vertexColors: true }));
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.drawn = new Int32Array(n);
    this.appId = new Int32Array(n); this.appV = new Int32Array(n); this.app = new Float32Array(n * 12);
    this.jit = new Float32Array(n); this.hs = new Float32Array(n); this.hc = new Float32Array(n); this.dist = new Float32Array(n);
    this.group.add(this.points);
    for (const nb of this.nearBatches) this.group.add(nb.mesh); // after the points so the base children order (gear batches, points) is unchanged
  }

  /** Meshes (one per gear batch) for diagnostics/tests. */
  get meshes(): THREE.InstancedMesh[] { return this.batches.map((b) => b.mesh); }
  /** Instances per gear batch from the last non-far update. */
  batchCounts(): number[] { return this.batches.map((b) => b.mesh.count); }

  private refreshApp(slot: number): void {
    const s = this.store, id = s.id[slot]!;
    const kid = this.isKid ? this.isKid(slot) : undefined;
    const a = appearanceOf(id, s.type[slot]!, this._winter, kid, this.tmpApp);
    const o = slot * 12, A = this.app;
    A[o] = a.skin; A[o + 1] = a.hair; A[o + 2] = a.top; A[o + 3] = a.bottom; A[o + 4] = a.hairStyle; A[o + 5] = a.hat; A[o + 6] = a.gearColor;
    A[o + 7] = (a.pack ? 1 : 0) + (a.female ? 2 : 0);
    A[o + 8] = [0.88, 1, 1.15][a.build]!; A[o + 9] = 1 + (1 - a.scale) * 0.75; A[o + 10] = a.scale; A[o + 11] = a.age;
    if (this.appId[slot] !== id) {
      const ang = rand01(id, 31) * Math.PI * 2;
      this.hs[slot] = Math.sin(ang); this.hc[slot] = Math.cos(ang); this.dist[slot] = rand01(id, 32) * 6;
      this.appId[slot] = id;
    }
    this.appV[slot] = this.appVer;
  }

  /**
   * `viewHeight` = camera.top - camera.bottom. With a `camera`, guests outside the view (+margin) are skipped (no matrix writes, fewer
   * instances drawn); with `tick` the whole update is skipped while nothing changed (paused game, static camera).
   */
  update(alpha: number, viewHeight: number, camera?: THREE.Camera, tick?: number): void {
    const s = this.store;
    const persp = !!camera && isPerspective(camera);
    this.farByView = guestFarByView(this.farByView, viewHeight, this.farScale);
    this.far = useGuestImpostor({ persp, viewHeight: this.farByView ? Infinity : 0, farScale: this.farScale, speedMul: this.speedMul });
    let e: ArrayLike<number> | null = null;
    if (camera) {
      camera.updateMatrixWorld();
      this.pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      e = this.pv.elements;
      if (tick !== undefined && tick === this.lastTick && alpha === this.lastAlpha && this.far === this.lastFar && this.farScale === this.lastScale && s.count === this.lastCount && this.hideSlot === this.lastHide) {
        let same = true;
        for (let k = 0; k < 16; k++) if (e[k] !== this.lastPv[k]) { same = false; break; }
        if (same) return; // nothing moved: the instance buffers are already current
      }
      for (let k = 0; k < 16; k++) this.lastPv[k] = e[k]!;
      this.lastTick = tick ?? -1; this.lastAlpha = alpha; this.lastFar = this.far; this.lastScale = this.farScale; this.lastCount = s.count; this.lastHide = this.hideSlot;
    }
    // animation clock: real seconds, but only while the sim clock advances (tick + alpha changes; it freezes while paused)
    const now = (tick ?? 0) + alpha;
    const adv = this.lastTime < 0 ? 0 : now - this.lastTime;
    const dt = adv > 1e-9 ? Math.min(0.1, Math.max(0, this.frameSeconds)) : 0;
    this.lastTime = now;
    let pathN = 0;
    let skipped = 0;
    const far = this.far, winter = this._winter, B = this.batches;
    const NB = this.nearBatches;
    for (let g = 0; g < GEAR_COUNT; g++) { B[g]!.n = 0; NB[g]!.n = 0; }
    let nearTotal = 0;
    const cp = persp ? camera!.position : null;
    let n = 0;
    for (let i = 0; i < s.limit; i++) {
      if (!s.alive[i] || s.state[i] === GState.Sleeping || i === this.hideSlot) continue;
      let x: number, y: number;
      const wn = s.wpN[i]!;
      if (wn > 0) { const p = pathPoint(s.px[i]!, s.py[i]!, s.x[i]!, s.y[i]!, s.wp, i * WP_MAX * 2, wn, alpha, this.tmpPt); x = p.x; y = p.y; pathN++; }
      else { x = s.px[i]! + (s.x[i]! - s.px[i]!) * alpha; y = s.py[i]! + (s.y[i]! - s.py[i]!) * alpha; }
      const z = s.pz[i]! + (s.z[i]! - s.pz[i]!) * alpha;
      if (e) { // view culling (generic over ortho/perspective); margin covers figure size and one frame of camera lag
        const X = x, Y = z + 0.3, Z = y;
        const cw = e[3]! * X + e[7]! * Y + e[11]! * Z + e[15]!;
        const cx = e[0]! * X + e[4]! * Y + e[8]! * Z + e[12]!, cy = e[1]! * X + e[5]! * Y + e[9]! * Z + e[13]!;
        const m = cw * 1.12;
        if (cx > m || cx < -m || cy > m || cy < -m || (persp && (cw > this.perspectiveRange || cw < -1))) { skipped++; continue; }
      }
      if (far) {
        const c = this.colors[s.type[i]!] ?? this.extraColour(s.type[i]!);
        this.pointPos[n * 3] = x; this.pointPos[n * 3 + 1] = z + 0.3; this.pointPos[n * 3 + 2] = y;
        this.pointCol[n * 3] = c.r; this.pointCol[n * 3 + 1] = c.g; this.pointCol[n * 3 + 2] = c.b;
        this.drawn[n++] = i;
        continue;
      }
      if (this.appV[i] !== this.appVer || this.appId[i] !== s.id[i]) this.refreshApp(i);
      // heading + speed from this tick's movement
      const dx = s.x[i]! - s.px[i]!, dy = s.y[i]! - s.py[i]!, l2 = dx * dx + dy * dy;
      let spd = 0;
      if (l2 > 1e-8) {
        const inv = 1 / Math.sqrt(l2);
        let hx = this.hs[i]! + (dx * inv - this.hs[i]!) * 0.35, hz = this.hc[i]! + (dy * inv - this.hc[i]!) * 0.35;
        const hl = Math.sqrt(hx * hx + hz * hz);
        if (hl < 1e-3) { hx = dx * inv; hz = dy * inv; } else { hx /= hl; hz /= hl; }
        this.hs[i] = hx; this.hc[i] = hz;
        spd = l2 > 0.25 ? 0.5 : Math.sqrt(l2);
      }
      const state = s.state[i]!;
      const uk = state === GState.Using && this.usingKind ? this.usingKind(i) : UsingKind.Other;
      const gear = gearFor(state, s.moveMode[i]!, s.id[i]!, uk, typeGearOf(s.type[i]!));
      const P = POSE[gear]!;
      this.dist[i] = this.dist[i]! + (spd * GAIT_RATE + (P.still ? STILL_RATE : 0)) * dt;
      let bt = B[gear]!;
      if (cp) { // close-up variant for the nearest guests (distance band with hysteresis; capped per batch and in total)
        const ddx = x - cp.x, ddy = z + 0.3 - cp.y, ddz = y - cp.z;
        const want = nearLod('perspective', Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz), this.nearFlag[i] ? 'near' : 'mid') === 'near';
        const nbt = NB[gear]!;
        if (want && nearTotal < GROUND_CAPS.figures && nbt.n < NEAR_CAPS.figuresPerBatch) { bt = nbt; nearTotal++; this.nearFlag[i] = 1; } else this.nearFlag[i] = 0;
      }
      const k = bt.n++;
      const sc = this.app[i * 12 + 10]!, c = this.hc[i]!, sn = this.hs[i]!;
      const arr = bt.mesh.instanceMatrix.array as Float32Array, o = k * 16;
      arr[o] = c * sc; arr[o + 1] = 0; arr[o + 2] = -sn * sc; arr[o + 3] = 0;
      arr[o + 4] = 0; arr[o + 5] = sc; arr[o + 6] = 0; arr[o + 7] = 0;
      arr[o + 8] = sn * sc; arr[o + 9] = 0; arr[o + 10] = c * sc; arr[o + 11] = 0;
      { // standing walkers (queues, waiting) spread out a little: deterministic per-guest offset, eased in / out so nothing pops when they set off
        const want = gear === Gear.Walk && spd === 0 ? 1 : 0;
        const jf = this.jit[i]! + (want - this.jit[i]!) * Math.min(1, dt * 4);
        this.jit[i] = jf;
        if (jf > 0.01) { x += (rand01(s.id[i]!, 41) - 0.5) * 0.34 * jf; y += (rand01(s.id[i]!, 42) - 0.5) * 0.34 * jf; }
      }
      arr[o + 12] = x; arr[o + 13] = z; arr[o + 14] = y; arr[o + 15] = 1;
      const q = k * 4, ap = i * 12;
      bt.a[q] = this.app[ap]!; bt.a[q + 1] = this.app[ap + 1]!; bt.a[q + 2] = this.app[ap + 2]!; bt.a[q + 3] = this.app[ap + 3]!;
      const flags = this.app[ap + 7]!;
      const outfit = outfitFor(gear, winter, uk === UsingKind.Beach, typeOutfitOf(s.type[i]!));
      const pack = gear === Gear.Hike || gear === Gear.Bike ? 1 : gear === Gear.Lie || gear === Gear.Sit ? 0 : flags % 2;
      bt.b[q] = this.app[ap + 4]!; bt.b[q + 1] = this.app[ap + 5]!; bt.b[q + 2] = this.app[ap + 6]!; bt.b[q + 3] = pack + (flags >= 2 ? 2 : 0) + outfit * 4;
      bt.c[q] = this.dist[i]!; bt.c[q + 1] = spd; bt.c[q + 2] = this.app[ap + 8]!; bt.c[q + 3] = this.app[ap + 9]!;
      this.drawn[n++] = i;
    }
    this.pathDrawn = pathN;
    this.drawnCount = n;
    this.nearDrawn = nearTotal;
    this.culled = skipped;
    this.points.visible = far;
    if (far) {
      for (const bt of B) { bt.mesh.visible = false; bt.mesh.count = 0; }
      for (const bt of NB) { bt.mesh.visible = false; bt.mesh.count = 0; }
      this.points.geometry.setDrawRange(0, n);
      (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (this.points.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    } else {
      for (const bt of B) this.flushBatch(bt);
      for (const bt of NB) this.flushBatch(bt);
    }
  }

  private flushBatch(bt: Batch): void {
    bt.mesh.visible = bt.n > 0; bt.mesh.count = bt.n;
    if (!bt.n) return;
    const im = bt.mesh.instanceMatrix;
    im.clearUpdateRanges(); im.addUpdateRange(0, bt.n * 16); im.needsUpdate = true;
    for (const at of bt.attrs) { at.clearUpdateRanges(); at.addUpdateRange(0, bt.n * 4); at.needsUpdate = true; }
  }

  /** Head-top anchor (x, up, z) of a guest slot for floating effects (emotes); false when the guest isn't alive. */
  anchor(slot: number, out: THREE.Vector3, alpha = 1): boolean {
    const s = this.store;
    if (!s.alive[slot]) return false;
    const sc = this.appId[slot] === s.id[slot] ? this.app[slot * 12 + 10]! : 1;
    const wn = s.wpN[slot]!;
    if (wn > 0) pathPoint(s.px[slot]!, s.py[slot]!, s.x[slot]!, s.y[slot]!, s.wp, slot * WP_MAX * 2, wn, alpha, this.tmpPt);
    else { this.tmpPt.x = s.px[slot]! + (s.x[slot]! - s.px[slot]!) * alpha; this.tmpPt.y = s.py[slot]! + (s.y[slot]! - s.py[slot]!) * alpha; }
    out.set(this.tmpPt.x, s.pz[slot]! + (s.z[slot]! - s.pz[slot]!) * alpha + 1.15 * sc + 0.35, this.tmpPt.y);
    return true;
  }

  /** Nearest drawn guest within `maxPx` of the pointer (screen-space pick), or -1. Returns the store slot. */
  pick(clientX: number, clientY: number, dom: HTMLElement, camera: THREE.Camera, maxPx = 14): number {
    const r = dom.getBoundingClientRect();
    const v = new THREE.Vector3();
    const s = this.store;
    let best = -1, bd = maxPx * maxPx;
    for (let k = 0; k < this.drawnCount; k++) {
      const i = this.drawn[k]!;
      v.set(s.x[i]!, s.z[i]! + 0.3, s.y[i]!).project(camera);
      if (v.z > 1) continue;
      const dx = r.left + ((v.x + 1) / 2) * r.width - clientX, dy = r.top + ((1 - v.y) / 2) * r.height - clientY;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  dispose(): void {
    for (const b of this.batches) { b.mesh.geometry.dispose(); (b.mesh.material as THREE.Material).dispose(); }
    this.points.geometry.dispose(); (this.points.material as THREE.Material).dispose();
  }
}
