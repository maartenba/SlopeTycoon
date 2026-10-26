import * as THREE from 'three';
import { BUILDINGS, type ChimneySpec } from '../config/buildings';

/** Wood-fire chimney smoke: pure emitter selection + one instanced-billboard draw call (puff animation runs in the vertex shader). */
export const SMOKE = {
  /** Smoke below this outside temperature (°C), full strength at TEMP_FULL. */
  tempMax: 8, tempFull: -2,
  /** Hard cap of simultaneous emitters (LOD lowers it with zoom). */
  maxEmitters: 16, puffsPerEmitter: 10, life: 6,
  /** Camera view-height (tiles) thresholds: below near = full cap, above far = no smoke. */
  lodNear: 45, lodMid: 80, lodFar: 130,
} as const;

export interface SmokeCandidate {
  id: number; type: string; active: boolean;
  /** Footprint centre (tiles), used for culling/sort tie-breaks. */
  cx: number; cy: number;
}
export interface SmokeCtx {
  /** Outside temperature at the building's altitude (°C). */
  tempAt: (c: SmokeCandidate) => number;
  hour: number;
  /** 0..1 share of lodging capacity used overnight. */
  overnight: number;
  /** 0..1 how busy food venues are (open guests). */
  dining?: number;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
export type SmokeKind = 'lodging' | 'dining' | 'farm' | 'terrace';
const KIND: Record<string, SmokeKind> = {
  chalet: 'lodging', apartment: 'lodging', baseLodge: 'dining', lodge: 'dining', cafe: 'dining', mountainHut: 'dining', heatedTerrace: 'terrace', apresBar: 'dining', alpineFarm: 'farm', rangerStation: 'farm',
};
export const smokeKindOf = (type: string): SmokeKind | null => KIND[type] ?? null;
const inHours = (h: number, a: number, b: number): boolean => (a <= b ? h >= a && h < b : h >= a || h < b);

/** Pure: 0..1 chimney strength of one building. 0 = no smoke. */
export function smokeIntensity(type: string, active: boolean, temp: number, hour: number, overnight: number, dining = 0.5): number {
  const kind = smokeKindOf(type);
  if (!kind || !active || !BUILDINGS[type]?.chimney) return 0;
  const cold = clamp01((SMOKE.tempMax - temp) / (SMOKE.tempMax - SMOKE.tempFull));
  if (cold <= 0) return 0;
  const night = inHours(hour, 22, 6), morning = inHours(hour, 6, 9), evening = inHours(hour, 16, 22);
  let t: number;
  switch (kind) {
    case 'lodging': // chalets/apartments: guests sleeping there light the stove at night, morning and evening
      t = (night ? 0.9 : morning ? 0.8 : evening ? 1 : 0.2) * (0.25 + 0.75 * clamp01(overnight)); break;
    case 'dining': // restaurants: lunch and dinner rushes
      t = inHours(hour, 11, 14.5) ? 0.8 + 0.2 * dining : evening ? 0.7 + 0.3 * dining : morning ? 0.45 : 0.1; break;
    case 'terrace': t = evening || inHours(hour, 10, 16) ? 0.8 : 0.3; break;
    default: t = morning || evening ? 0.8 : 0.3; // farm
  }
  return clamp01(t * cold);
}

export interface SmokeEmitter { id: number; intensity: number }

/** Pure: pick the strongest emitters (ties by id), at least `minIntensity`, at most `cap`. Deterministic. */
export function selectEmitters(cands: readonly SmokeCandidate[], ctx: SmokeCtx, cap: number = SMOKE.maxEmitters, minIntensity = 0.15): SmokeEmitter[] {
  const out: SmokeEmitter[] = [];
  for (const c of cands) {
    const k = smokeKindOf(c.type);
    const v = smokeIntensity(c.type, c.active, ctx.tempAt(c), ctx.hour, k === 'lodging' ? ctx.overnight : 1, ctx.dining ?? 0.5);
    if (v >= minIntensity) out.push({ id: c.id, intensity: v });
  }
  out.sort((a, b) => b.intensity - a.intensity || a.id - b.id);
  return out.slice(0, Math.max(0, cap));
}

/** LOD: emitter cap from the camera view height (tiles tall). */
export function smokeCapForZoom(viewHeight: number, max: number = SMOKE.maxEmitters): number {
  if (viewHeight >= SMOKE.lodFar) return 0;
  if (viewHeight >= SMOKE.lodMid) return Math.min(max, 4);
  if (viewHeight >= SMOKE.lodNear) return Math.min(max, 8);
  return max;
}

const VERT = `
attribute vec3 aOrigin; attribute float aBirth; attribute float aSeed;
uniform float uTime; uniform vec2 uWind; uniform float uLife; uniform float uScale;
varying vec2 vUv; varying float vAlpha;
void main(){
  float age = uTime - aBirth;
  float t = age / uLife;
  if (aBirth < 0.0 || t < 0.0 || t > 1.0) { gl_Position = vec4(2.0,2.0,2.0,1.0); vUv = vec2(0.0); vAlpha = 0.0; return; }
  vec3 p = aOrigin;
  p.y += age * 0.55;
  p.xz += uWind * (age * age * 0.12 + age * 0.15) + vec2(sin(aSeed * 40.0 + age * 0.9), cos(aSeed * 31.0 + age * 0.7)) * 0.08 * age;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float size = (0.18 + 0.55 * t) * uScale;
  mv.xy += position.xy * size;
  gl_Position = projectionMatrix * mv;
  vUv = position.xy * 2.0;
  vAlpha = smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(0.35, 1.0, t)) * 0.55;
}`;
const FRAG = `
uniform vec3 uColor; uniform float uNight;
varying vec2 vUv; varying float vAlpha;
void main(){
  float d = length(vUv);
  if (d > 1.0 || vAlpha <= 0.0) discard;
  float a = vAlpha * (1.0 - d * d);
  vec3 warm = vec3(1.0, 0.62, 0.36);
  gl_FragColor = vec4(mix(uColor, uColor * warm * 0.9, uNight), a);
}`;

interface EmitterState { id: number; slot: number; nextAt: number; ring: number; intensity: number; origin: THREE.Vector3 }

export interface SmokeSource { id: number; type: string; active: boolean; x: number; y: number; w: number; h: number }

/** Instanced puffs: one draw call. Per-frame CPU = a handful of spawn writes. Origins come from `worldPos` (chimney top in world space). */
export class SmokeView {
  readonly group = new THREE.Group();
  readonly mesh: THREE.Mesh;
  private geo = new THREE.InstancedBufferGeometry();
  private mat: THREE.ShaderMaterial;
  private origin: Float32Array; private birth: Float32Array; private seed: Float32Array;
  private emitters = new Map<number, EmitterState>();
  private free: number[] = [];
  private time = 0;
  private frustum = new THREE.Frustum(); private pm = new THREE.Matrix4(); private tmp = new THREE.Vector3();
  private selTimer = 0;
  readonly capacity = SMOKE.maxEmitters * SMOKE.puffsPerEmitter;
  /** Last selection (for debug/tests). */
  active: SmokeEmitter[] = [];

  constructor(nightUniform: { value: number } = { value: 0 }) {
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    this.origin = new Float32Array(this.capacity * 3);
    this.birth = new Float32Array(this.capacity).fill(-1);
    this.seed = new Float32Array(this.capacity);
    for (let i = 0; i < this.capacity; i++) this.seed[i] = ((i * 0.6180339) % 1);
    this.geo.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(this.origin, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aBirth', new THREE.InstancedBufferAttribute(this.birth, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(this.seed, 1));
    this.geo.instanceCount = this.capacity;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      uniforms: {
        uTime: { value: 0 }, uWind: { value: new THREE.Vector2(0.4, 0.2) }, uLife: { value: SMOKE.life }, uScale: { value: 1 },
        uColor: { value: new THREE.Color(0.86, 0.88, 0.92) }, uNight: nightUniform,
      },
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 5; this.mesh.visible = false;
    this.group.add(this.mesh);
  }

  /** Wind in tiles/sec-ish units along world x/z. */
  setWind(x: number, z: number): void { this.mat.uniforms.uWind!.value.set(x, z); }

  /**
   * Per frame. `sources`: chimney-bearing buildings; `worldPos(src, spec, out)` writes the chimney-top world position;
   * `ctx`: sim context. Selection runs ~2×/s; spawning each frame; offscreen emitters do not spawn.
   */
  update(dt: number, camera: THREE.Camera, viewHeight: number, sources: readonly SmokeSource[], ctx: SmokeCtx, worldPos: (s: SmokeSource, spec: ChimneySpec, out: THREE.Vector3) => void): void {
    this.time += dt;
    this.mat.uniforms.uTime!.value = this.time;
    this.mat.uniforms.uScale!.value = Math.max(0.6, viewHeight / 40);
    const cap = smokeCapForZoom(viewHeight);
    this.mesh.visible = cap > 0 || this.emitters.size > 0;
    this.selTimer -= dt;
    if (this.selTimer <= 0) {
      this.selTimer = 0.5;
      const cands: SmokeCandidate[] = [];
      const byId = new Map<number, SmokeSource>();
      for (const s of sources) { if (!BUILDINGS[s.type]?.chimney) continue; cands.push({ id: s.id, type: s.type, active: s.active, cx: s.x + s.w / 2, cy: s.y + s.h / 2 }); byId.set(s.id, s); }
      this.active = selectEmitters(cands, ctx, cap);
      const keep = new Set(this.active.map((e) => e.id));
      for (const [id, st] of this.emitters) if (!keep.has(id)) { this.free.push(st.slot); this.emitters.delete(id); }
      for (const e of this.active) {
        let st = this.emitters.get(e.id);
        if (!st) {
          const slot = this.free.pop() ?? this.emitters.size;
          if (slot >= SMOKE.maxEmitters) continue;
          st = { id: e.id, slot, nextAt: this.time + (e.id % 5) * 0.1, ring: 0, intensity: e.intensity, origin: new THREE.Vector3() };
          this.emitters.set(e.id, st);
        }
        st.intensity = e.intensity;
        const s = byId.get(e.id)!, spec = BUILDINGS[s.type]!.chimney!;
        worldPos(s, spec, st.origin);
      }
    }
    camera.updateMatrixWorld();
    this.pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pm);
    let dirty = false;
    for (const st of this.emitters.values()) {
      if (this.time < st.nextAt) continue;
      st.nextAt = this.time + SMOKE.life / SMOKE.puffsPerEmitter / (0.3 + st.intensity);
      if (!this.frustum.containsPoint(this.tmp.copy(st.origin))) continue; // offscreen: don't spawn
      const idx = st.slot * SMOKE.puffsPerEmitter + (st.ring++ % SMOKE.puffsPerEmitter);
      this.origin[idx * 3] = st.origin.x; this.origin[idx * 3 + 1] = st.origin.y; this.origin[idx * 3 + 2] = st.origin.z;
      this.birth[idx] = this.time;
      dirty = true;
    }
    if (dirty) {
      (this.geo.getAttribute('aOrigin') as THREE.BufferAttribute).needsUpdate = true;
      (this.geo.getAttribute('aBirth') as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  get emitterCount(): number { return this.emitters.size; }
  dispose(): void { this.geo.dispose(); this.mat.dispose(); }
}
