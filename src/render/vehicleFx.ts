import * as THREE from 'three';
/**
 * Vehicle ground effects (render only): a SOFT contact shadow under every road vehicle and (at night, near the camera) a quiet warm headlight pool in front of it.
 * ONE instanced layer, ONE draw call: premultiplied blending (shadow = black with alpha, light = colour with alpha 0 = additive). The pure falloff functions are the
 * single source of truth; `VEHICLE_FX_FRAG` repeats them. Never a sim input; reduced motion only freezes the easing, not the look.
 */
export const VEHICLE_FX = {
  /** Base darkness of the soft contact shadow (0..1) and how much of it survives at full night (the night sky is dark already). */
  shadow: 0.5, shadowNight: 0.45,
  /** Headlight pool: peak strength, length / width in tiles, how far ahead of the nose it starts, nearest-N cap and the per-frame fade step. */
  pool: { peak: 0.34, length: 1.35, width: 0.62, lead: 0.0, cap: 12, /** rank margin before a vehicle loses its pool (see `nearestStable`) */ hysteresis: 3, ease: 0.08, nightOn: 0.28 },
  /** Instance capacity of the layer. */
  capacity: 224,
} as const;
const sstep = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** Soft shadow alpha at (u, v) in -1..1 across the footprint: a rounded-box (super-ellipse) distance with a long smooth falloff, so there is no hard edge. */
export function softShadow(u: number, v: number, strength: number): number {
  const d = Math.pow(Math.pow(Math.abs(u), 4) + Math.pow(Math.abs(v), 4), 0.25);
  return strength * Math.pow(1 - sstep(0.25, 1, d), 1.5);
}
/** Headlight pool intensity at lateral x in -1..1 and forward t in 0..1 (0 = the nose): widens with distance, fades out, ramps in over the first 12 %. */
export function headPool(x: number, t: number, strength: number): number {
  const hw = 0.4 + 0.6 * t;
  return strength * (1 - sstep(0, 1, Math.abs(x) / hw)) * (1 - sstep(0, 1, t)) * sstep(0, 0.12, t);
}
/** Night strength of the shadow: it eases to `shadowNight` of its day value in the dark. */
export const shadowStrength = (night: number): number => VEHICLE_FX.shadow * (1 - (1 - VEHICLE_FX.shadowNight) * Math.min(1, Math.max(0, night)));
/** Pool strength by night factor: 0 in the day, ramps in from `nightOn`. */
export const poolStrength = (night: number): number => VEHICLE_FX.pool.peak * sstep(VEHICLE_FX.pool.nightOn, 0.85, night);
/** Picks (at most `cap`) the indexes of the points nearest to (fx, fz): stable ties by index. */
export function nearestN(xs: ArrayLike<number>, zs: ArrayLike<number>, fx: number, fz: number, cap: number): number[] {
  const idx: number[] = []; for (let i = 0; i < xs.length; i++) idx.push(i);
  const d = (i: number): number => (xs[i]! - fx) ** 2 + (zs[i]! - fz) ** 2;
  idx.sort((a, b) => d(a) - d(b) || a - b);
  return idx.slice(0, cap);
}

/**
 * Same as `nearestN` but with hysteresis: a point that is already in `prev` keeps its place until its rank falls beyond `cap + margin`, and a newcomer needs a rank inside `cap`
 * (and a free slot) to get in. Vehicles trading places around the cap-th / (cap+1)-th rank therefore no longer fade a pool in and out back and forth. At most `cap` indexes.
 */
export function nearestStable(xs: ArrayLike<number>, zs: ArrayLike<number>, fx: number, fz: number, cap: number, prev: ReadonlySet<number>, margin: number = VEHICLE_FX.pool.hysteresis): number[] {
  const order = nearestN(xs, zs, fx, fz, xs.length), out: number[] = [];
  order.forEach((i, rank) => { if (out.length < cap && prev.has(i) && rank < cap + margin) out.push(i); });
  order.forEach((i, rank) => { if (out.length < cap && rank < cap && !out.includes(i)) out.push(i); });
  return out;
}

const VERT = `attribute float aKind; attribute float aStr; varying vec2 vP; varying float vK; varying float vS;
void main(){ vP = position.xz * 2.0; vK = aKind; vS = aStr; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`;
export const VEHICLE_FX_FRAG = `varying vec2 vP; varying float vK; varying float vS;
float st(float a, float b, float x){ float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
void main(){
  if (vK < 0.5) {
    float d = pow(pow(abs(vP.x), 4.0) + pow(abs(vP.y), 4.0), 0.25);
    float a = vS * pow(1.0 - st(0.25, 1.0, d), 1.5);
    gl_FragColor = vec4(0.0, 0.0, 0.0, a);
  } else {
    float x = vP.x, t = vP.y * 0.5 + 0.5, hw = 0.4 + 0.6 * t;
    float a = vS * (1.0 - st(0.0, 1.0, abs(x) / hw)) * (1.0 - st(0.0, 1.0, t)) * st(0.0, 0.12, t);
    gl_FragColor = vec4(vec3(1.0, 0.9, 0.66) * a, 0.0);
  }
}`;

/** The one layer: `begin()`, then `shadow(...)` / `pool(...)` per vehicle, then `end()`. Matrices are composed from the vehicle's world position + orientation (pitched to the terrain). */
export class VehicleFxLayer {
  readonly mesh: THREE.InstancedMesh;
  private kind = new Float32Array(VEHICLE_FX.capacity); private str = new Float32Array(VEHICLE_FX.capacity);
  private n = 0; private m = new THREE.Matrix4(); private t = new THREE.Matrix4(); private s = new THREE.Matrix4(); private k = new THREE.Matrix4(); private one = new THREE.Vector3(1, 1, 1);
  constructor() {
    const g = new THREE.InstancedBufferGeometry(); const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    g.index = plane.index; g.setAttribute('position', plane.getAttribute('position'));
    const ka = new THREE.InstancedBufferAttribute(this.kind, 1), sa = new THREE.InstancedBufferAttribute(this.str, 1);
    ka.setUsage(THREE.DynamicDrawUsage); sa.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aKind', ka); g.setAttribute('aStr', sa);
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: VEHICLE_FX_FRAG, transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.mesh = new THREE.InstancedMesh(g as unknown as THREE.BufferGeometry, mat, VEHICLE_FX.capacity);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.name = 'vehicle:fx'; this.mesh.renderOrder = 2;
  }
  begin(): void { this.n = 0; }
  /** Adds one quad: centred at `pos` + `q` * (0, ly, lz), sized (w, d) in the vehicle's frame. */
  add(kind: 0 | 1, pos: THREE.Vector3, q: THREE.Quaternion, ly: number, lz: number, w: number, d: number, strength: number): void {
    if (this.n >= VEHICLE_FX.capacity || strength < 0.004) return;
    this.t.compose(pos, q, this.one); this.s.makeTranslation(0, ly, lz).multiply(this.k.makeScale(w, 1, d));
    this.m.multiplyMatrices(this.t, this.s); this.mesh.setMatrixAt(this.n, this.m);
    this.kind[this.n] = kind; this.str[this.n] = strength; this.n++;
  }
  end(): void {
    this.mesh.count = this.n; this.mesh.instanceMatrix.needsUpdate = true;
    const g = this.mesh.geometry as unknown as THREE.BufferGeometry; (g.getAttribute('aKind') as THREE.BufferAttribute).needsUpdate = true; (g.getAttribute('aStr') as THREE.BufferAttribute).needsUpdate = true;
    this.mesh.visible = this.n > 0;
  }
  get count(): number { return this.n; }
}
