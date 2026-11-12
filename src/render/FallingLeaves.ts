import * as THREE from 'three';
import { LEAVES } from '@/config/leaves';
import type { GraphicsQuality } from '@/config/balance';
import type { PropStore } from '@/world/Props';
import { PropKind, surfaceHeight } from '@/world/Props';
import { CHUNK_SIZE } from '@/world/Grid';
import { precipPixelScale } from '@/render/Precipitation';
import { hash01 } from '@/render/ApresNotes';

/**
 * Falling autumn leaves: ONE instanced quad layer (one draw call), a recycled pool of leaves around the view target. Each leaf is bound to a nearby deciduous / larch / birch
 * / oak tree when it spawns at the crown, falls with a slow sway, a screen-plane spin and a flip (width squash), drifts with the wind (gusts lift the drift) and lies on the ground for a moment, fading.
 * Render-only (no sim state, no Rng, stateHash untouched): the only clock is the layer's own `time` (accumulated frame dt, so `__slope.frameStep` reproduces it exactly), world-space motion only,
 * hashed per-leaf constants (`hash01`), no `gl_FragCoord`, depth-tested against terrain / trees (no depth write). Reduced motion: a still scatter on the ground, nothing falls.
 */
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smooth = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Leaves in the pool for a tier (Low 40, Medium 120, High 260). */
export const leafCountFor = (q: GraphicsQuality): number => LEAVES.counts[q];

/** Phase of autumn 0..1 for a render season position `t` (`seasonYear`: autumn = 0.5..0.75), or -1 outside autumn. */
export function autumnPhase(t: number): number {
  const f = ((t % 1) + 1) % 1;
  return f >= 0.5 && f < 0.75 ? (f - 0.5) / 0.25 : -1;
}
/** 0..1 seasonal strength: zero outside autumn, ramps up over the first `rise`, peaks mid-autumn, fades out as the snow arrives (late November). */
export function seasonLeafStrength(t: number): number {
  const p = autumnPhase(t);
  if (p < 0) return 0;
  return smooth(0, LEAVES.rise, p) * (1 - smooth(LEAVES.fadeFrom, 1, p));
}
/** Share of the pool that is alive (0..1): the season curve, damped by rain / snow (wet leaves), lifted by wind. */
export function leafDensity(t: number, precip: 'none' | 'rain' | 'snow', intensity: number, wind: number): number {
  const s = seasonLeafStrength(t);
  if (s <= 0) return 0;
  const wet = precip === 'none' ? 1 : lerp(1, precip === 'rain' ? LEAVES.rain : LEAVES.snow, Math.min(1, Math.max(0, intensity)));
  const w = 1 + LEAVES.windBoost * Math.min(1, Math.max(0, wind)) * s;
  return Math.min(1, s * wet * w);
}
/** Gust factor 0..1 of the wind at render time `t` (slow world-space wave). */
export const gust = (t: number): number => 0.5 + 0.5 * Math.sin(t * 0.37) * Math.sin(t * 0.91 + 1.3);
/** View fade for the iso camera: full when near, gone when the view is tall. */
export const leafViewFade = (viewHeight: number): number => Math.min(1, Math.max(0, (LEAVES.farView - viewHeight) / (LEAVES.farView - LEAVES.nearView)));

export interface LeafPose {
  /** Offset from the tree's spawn point (tiles); `up` = height above the ground (tiles). */
  dx: number; dz: number; up: number;
  /** Spin angle (rad), flip squash 0.15..1, world size (tiles), alpha 0..1, landed. */
  rot: number; squash: number; size: number; alpha: number; landed: boolean;
}
/** Seconds a leaf of index `i` falls from a crown `crownH` tiles up. */
export const fallTime = (i: number, crownH: number, wind: number): number => crownH / (lerp(LEAVES.fall[0], LEAVES.fall[1], hash01(i, 11)) * (1 + 0.5 * wind));
/**
 * Pure pose of leaf `i` `age` seconds after it spawned at the crown (height `crownH`), at render time `t` (for the gust) and wind 0..1. Same inputs => same pose.
 * Returns null once the leaf has finished lying on the ground (recycle it). Reduced motion: use `stillPose`.
 */
export function leafPose(age: number, i: number, crownH: number, t: number, wind: number): LeafPose | null {
  const fall = fallTime(i, crownH, wind), end = fall + LEAVES.groundTime;
  if (age < 0 || age >= end) return null;
  const hs = hash01(i, 12), hf = hash01(i, 13), hp = hash01(i, 14), hz = hash01(i, 15);
  const a = Math.min(age, fall), landed = age >= fall;
  const sw = lerp(LEAVES.swayHz[0], LEAVES.swayHz[1], hs);
  const drift = wind * (1 + 0.6 * gust(t)) * LEAVES.drift;
  const ph = (a * sw + hp) * Math.PI * 2;
  const stop = landed ? 1 : 0;
  const dx = LEAVES.sway * Math.sin(ph) + drift * a * (1 - 0.0 * stop), dz = LEAVES.sway * 0.6 * Math.cos(ph * 0.8 + hz * 6) + drift * LEAVES.driftZ * a;
  const spin = lerp(LEAVES.spin[0], LEAVES.spin[1], hf) * (hash01(i, 16) > 0.5 ? 1 : -1);
  const flip = 0.15 + 0.85 * Math.abs(Math.cos((a * lerp(LEAVES.flipHz[0], LEAVES.flipHz[1], hash01(i, 17)) + hz) * Math.PI));
  const fadeIn = smooth(0, 0.35, age), fadeOut = landed ? 1 - smooth(0, LEAVES.groundTime, age - fall) : 1;
  return {
    dx, dz, up: landed ? 0 : Math.max(0, crownH - a * (crownH / fall)),
    rot: landed ? hp * 6.283 : spin * a + hp * 6.283, squash: landed ? 0.5 : flip,
    size: lerp(LEAVES.size[0], LEAVES.size[1], hash01(i, 18)), alpha: LEAVES.alpha * fadeIn * fadeOut, landed,
  };
}
/** Reduced motion: leaf `i` lies still near its tree (offset, spin, size, alpha); constant in time. */
export function stillPose(i: number): LeafPose {
  const a = hash01(i, 21) * Math.PI * 2, r = Math.sqrt(hash01(i, 22)) * LEAVES.stillRadius;
  return { dx: Math.cos(a) * r, dz: Math.sin(a) * r, up: 0, rot: hash01(i, 23) * 6.283, squash: 0.5, size: lerp(LEAVES.size[0], LEAVES.size[1], hash01(i, 18)), alpha: LEAVES.alpha * 0.85, landed: true };
}
/** Palette colour of leaf `i` (stable per leaf). */
export function leafColour(i: number): readonly [number, number, number] { return LEAVES.palette[Math.floor(hash01(i, 31) * LEAVES.palette.length) % LEAVES.palette.length]!; }

export interface LeafSource { x: number; z: number; /** ground height (world units) at the tree */ y: number; /** crown height above the ground (tiles) */ h: number }
const SHEDDERS = new Set<number>([PropKind.Deciduous, PropKind.Birch, PropKind.Oak, PropKind.Larch]);
/** Shedding trees (deciduous, birch, oak, larch) within `radius` tiles of (cx, cz), nearest first, at most `max`. Mature crowns only (growth: sapling / young ones are skipped). */
export function collectSources(props: PropStore, cx: number, cz: number, radius: number, max: number): LeafSource[] {
  const g = props.grid, last = props.chunksPerRow - 1, CS = CHUNK_SIZE;
  const x0 = Math.max(0, Math.floor((cx - radius) / CS)), x1 = Math.min(last, Math.floor((cx + radius) / CS));
  const z0 = Math.max(0, Math.floor((cz - radius) / CS)), z1 = Math.min(last, Math.floor((cz + radius) / CS));
  const out: Array<LeafSource & { d: number }> = [], r2 = radius * radius;
  for (let ty = z0; ty <= z1; ty++) for (let tx = x0; tx <= x1; tx++) {
    const c = props.propsInChunk(tx, ty);
    for (let i = 0; i < c.kind.length; i++) {
      if (!SHEDDERS.has(c.kind[i]!)) continue;
      const wx = c.tx[i]! + c.ox[i]!, wz = c.ty[i]! + c.oy[i]!, d = (wx - cx) ** 2 + (wz - cz) ** 2;
      if (d > r2) continue;
      if (c.born[i]! >= 0 && props.now - c.born[i]! < 20) continue;
      out.push({ x: wx, z: wz, y: surfaceHeight(g, wx, wz), h: 1.0 * c.scale[i]! + 0.4, d });
    }
  }
  out.sort((a, b) => a.d - b.d);
  return out.slice(0, max);
}

const VERT = /* glsl */ `
attribute vec3 aPos;   // world position of the leaf centre
attribute vec4 aInfo;  // size (tiles), alpha, rotation, squash
attribute float aCol;  // palette index
uniform vec3 uPal[8];
uniform float uMin;    // minimum world size (tiles) = minPx in tiles for this view
uniform float uNight;
varying vec2 vUv; varying float vAlpha; varying vec3 vCol;
void main(){
  vAlpha = aInfo.y; vCol = uPal[int(aCol)] * mix(1.0, 0.45, uNight);
  if (aInfo.y <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vUv = vec2(0.0); return; }
  float s = max(aInfo.x, uMin);
  float c = cos(aInfo.z), sn = sin(aInfo.z);
  vec2 p = vec2(position.x * aInfo.w, position.y) * 2.0;           // flip squashes the width
  vec2 r = vec2(c * p.x - sn * p.y, sn * p.x + c * p.y);
  vec4 mv = modelViewMatrix * vec4(aPos, 1.0);
  mv.xy += r * s * 0.5;
  gl_Position = projectionMatrix * mv;
  vUv = position.xy * 2.0;
}`;
/** Leaf silhouette (a pointed ellipse with a short stalk) and a darker midrib, in quad space: no texture, no screen-space noise. */
const FRAG = /* glsl */ `
varying vec2 vUv; varying float vAlpha; varying vec3 vCol;
void main(){
  vec2 p = vUv;                                  // -1..1
  float t = (p.y + 0.9) / 1.7;                   // 0 at the stalk .. 1 at the tip
  float w = 0.62 * sin(3.14159 * clamp(t, 0.0, 1.0)) * (1.0 - 0.25 * t);
  if (t < 0.0 || t > 1.0 || abs(p.x) > max(w, 0.06 * step(t, 0.0))) discard;
  float rib = 1.0 - 0.28 * smoothstep(0.1, 0.0, abs(p.x));
  float rim = 1.0 - 0.32 * smoothstep(0.65, 1.0, abs(p.x) / max(w, 0.05)); // darker edge keeps it readable against warm foliage
  gl_FragColor = vec4(vCol * rib * rim, vAlpha);
}`;

interface Slot { cycle: number; bx: number; bz: number; by: number; bh: number }

/** One shared layer. `update(dt, ctx)`: see `LeafContext`. */
export interface LeafContext {
  /** Render season position (`seasonYear`). */
  season: number; precip: 'none' | 'rain' | 'snow'; intensity: number; wind: number;
  /** Atmosphere level is not 'off', and quality / demo gates: false hides everything. */
  enabled: boolean; reduced: boolean;
  /** Iso: tiles tall the view is; perspective: pass `perspective` instead. */
  viewHeight: number; perspective: boolean;
  /** View target / camera position (world x, z). */
  focus: { x: number; z: number };
  /** Drawing-buffer height (px). */
  bufferHeight: number;
  quality: GraphicsQuality;
  /** QA: force this many leaves regardless of season / weather (`__slope.atmos.force({leaves:n})`). */
  force?: number;
}
export class FallingLeaves {
  readonly group = new THREE.Group();
  readonly mesh: THREE.Mesh;
  readonly geo = new THREE.InstancedBufferGeometry();
  /** The render clock: accumulated frame seconds (the only time source). */
  time = 0;
  /** Leaves drawn last frame (tests / debug). */
  drawn = 0;
  /** Capture-only size multiplier (the promo film sets it like `Precipitation.sizeScale`); 1 in the game. */
  sizeScale = 1;
  private mat: THREE.ShaderMaterial;
  private pos: Float32Array; private info: Float32Array; private col: Float32Array;
  private slots: Slot[] = [];
  private sources: LeafSource[] = [];
  private srcAt = { x: 1e9, z: 1e9, r: 0, t: -1e9, reduced: false };
  readonly capacity = Math.max(...Object.values(LEAVES.counts));

  constructor(private readonly props: PropStore, nightUniform: { value: number } = { value: 0 }) {
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    this.pos = new Float32Array(this.capacity * 3); this.info = new Float32Array(this.capacity * 4); this.col = new Float32Array(this.capacity);
    for (let i = 0; i < this.capacity; i++) { this.col[i] = Math.floor(hash01(i, 31) * LEAVES.palette.length) % LEAVES.palette.length; this.slots.push({ cycle: -1, bx: 0, bz: 0, by: 0, bh: 1 }); }
    this.geo.setAttribute('aPos', new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(this.info, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aCol', new THREE.InstancedBufferAttribute(this.col, 1));
    this.geo.instanceCount = this.capacity;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      uniforms: { uPal: { value: LEAVES.palette.map((c) => new THREE.Vector3(c[0], c[1], c[2])) }, uMin: { value: 0 }, uNight: nightUniform },
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 7; this.mesh.visible = false;
    this.group.add(this.mesh);
  }

  /** Sources near the focus; rebuilt when the focus moved, the radius changed or every 2 s of clock (trees get felled). */
  private refresh(cx: number, cz: number, r: number, reduced: boolean): void {
    const s = this.srcAt, moved = Math.hypot(cx - s.x, cz - s.z);
    if (moved < (reduced ? 6 : 2.5) && Math.abs(r - s.r) < 3 && this.time - s.t < (reduced ? 1e9 : 2) && reduced === s.reduced) return;
    this.sources = collectSources(this.props, cx, cz, r, LEAVES.maxSources);
    this.srcAt = { x: cx, z: cz, r, t: this.time, reduced };
    if (reduced) for (const sl of this.slots) sl.cycle = -1;
  }

  update(dt: number, c: LeafContext): void {
    this.time += Math.min(dt, 0.1);
    const n = c.force !== undefined ? Math.min(this.capacity, c.force) : leafCountFor(c.quality);
    const dens = c.force !== undefined ? 1 : leafDensity(c.season, c.precip, c.intensity, c.wind);
    const vf = c.perspective ? 1 : leafViewFade(c.viewHeight);
    if (!c.enabled || dens <= 0 || vf <= 0 || n <= 0) { this.hide(); return; }
    const r = c.perspective ? LEAVES.nearRadius : Math.min(LEAVES.maxRadius, Math.max(LEAVES.minRadius, c.viewHeight * LEAVES.radiusPerView));
    this.refresh(c.focus.x, c.focus.z, r, c.reduced);
    const src = this.sources;
    if (src.length === 0) { this.hide(); return; }
    const gl = this.mat.uniforms.uMin as THREE.IUniform<number>;
    gl.value = c.perspective ? 0 : this.sizeScale * LEAVES.minPx * precipPixelScale(c.bufferHeight) * (c.viewHeight / Math.max(1, c.bufferHeight));
    let k = 0;
    for (let i = 0; i < n; i++) {
      const alive = smooth(0, 0.08, dens - hash01(i, 41));
      if (alive <= 0) continue;
      const sl = this.slots[i]!;
      let pose: LeafPose | null; let bx: number, bz: number, by: number;
      if (c.reduced) {
        const s0 = src[Math.floor(hash01(i, 42) * src.length) % src.length]!;
        pose = stillPose(i); bx = s0.x; bz = s0.z; by = s0.y;
      } else {
        // fixed per-leaf cycle length; the offset staggers the pool so it never spawns in a wave
        const len = LEAVES.cycle[0] + (LEAVES.cycle[1] - LEAVES.cycle[0]) * hash01(i, 47);
        const phase = this.time / len + hash01(i, 43) * 7, cyc = Math.floor(phase);
        if (cyc !== sl.cycle) { // spawn: bind to a tree near the focus
          const s0 = src[Math.floor(hash01(i, cyc + 44) * src.length) % src.length]!;
          sl.cycle = cyc; sl.bx = s0.x + (hash01(i, cyc + 45) - 0.5) * 0.6; sl.bz = s0.z + (hash01(i, cyc + 46) - 0.5) * 0.6; sl.by = s0.y; sl.bh = s0.h;
        }
        pose = leafPose((phase - cyc) * len, i, sl.bh, this.time, c.wind);
        bx = sl.bx; bz = sl.bz; by = sl.by;
      }
      if (!pose) continue;
      const x = bx + pose.dx, z = bz + pose.dz;
      const gy = c.reduced ? by : surfaceHeight(this.props.grid, x, z);
      const a = pose.alpha * alive * vf;
      if (a <= 0.01) continue;
      this.pos[k * 3] = x; this.pos[k * 3 + 1] = gy + pose.up + 0.04; this.pos[k * 3 + 2] = z;
      this.info[k * 4] = pose.size * this.sizeScale * (c.perspective ? LEAVES.perspectiveScale : 1); this.info[k * 4 + 1] = a; this.info[k * 4 + 2] = pose.rot; this.info[k * 4 + 3] = pose.squash;
      this.col[k] = Math.floor(hash01(i, 31) * LEAVES.palette.length) % LEAVES.palette.length;
      k++;
    }
    this.commit(k);
  }

  private hide(): void { if (this.drawn > 0 || this.mesh.visible) { this.drawn = 0; this.mesh.visible = false; } }
  private commit(k: number): void {
    for (let j = k; j < this.drawn; j++) this.info[j * 4 + 1] = 0;
    this.drawn = k;
    (this.geo.getAttribute('aPos') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aInfo') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aCol') as THREE.BufferAttribute).needsUpdate = true;
    this.mesh.visible = k > 0;
  }
  dispose(): void { this.geo.dispose(); this.mat.dispose(); }
}
