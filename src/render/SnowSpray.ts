import * as THREE from 'three';

/** Snowmaking cannon spray: one instanced-billboard draw call; each running cannon near the camera throws a looping fan of snow particles. */
export const SPRAY = {
  /** Hard cap of simultaneously sprayed cannons and particles per cannon. */
  maxCannons: 12, particles: 40,
  /** Particle flight time (s) and horizontal throw (tiles). */
  life: 1.5, throw: 5,
  /** Only cannons within this many tiles of the view centre spray; above this camera view height (tiles) nothing sprays. */
  radius: 70, lodFar: 110,
} as const;

export interface SprayCandidate { id: number; x: number; y: number }

/** Pure: which running cannons spray: nearest to the view centre first (ties by id), within `SPRAY.radius`, at most `cap`. Deterministic. */
export function selectSprayers(cands: readonly SprayCandidate[], running: ReadonlySet<number>, cx: number, cy: number, cap: number = SPRAY.maxCannons, radius: number = SPRAY.radius): number[] {
  const out: Array<{ id: number; d: number }> = [];
  for (const c of cands) {
    if (!running.has(c.id)) continue;
    const d = Math.hypot(c.x - cx, c.y - cy);
    if (d <= radius) out.push({ id: c.id, d });
  }
  out.sort((a, b) => a.d - b.d || a.id - b.id);
  return out.slice(0, Math.max(0, cap)).map((o) => o.id);
}

/** Pure LOD: the sprayer cap from the camera view height (tiles tall). */
export function sprayCapForZoom(viewHeight: number): number {
  if (viewHeight >= SPRAY.lodFar) return 0;
  if (viewHeight >= 70) return 4;
  if (viewHeight >= 45) return 8;
  return SPRAY.maxCannons;
}

const VERT = `
attribute vec3 aOrigin; attribute vec2 aDir; attribute float aSeed; attribute float aOn;
uniform float uTime; uniform float uLife; uniform float uThrow; uniform float uScale;
varying vec2 vUv; varying float vAlpha;
void main(){
  if (aOn < 0.5) { gl_Position = vec4(2.0,2.0,2.0,1.0); vUv = vec2(0.0); vAlpha = 0.0; return; }
  float t = fract(uTime / uLife + aSeed);
  float a = t * uLife;
  float spread = (fract(aSeed * 17.0) - 0.5) * 0.9;
  float c = cos(spread), s = sin(spread);
  vec2 d = vec2(aDir.x * c - aDir.y * s, aDir.x * s + aDir.y * c);
  float speed = uThrow / uLife * (0.7 + 0.45 * fract(aSeed * 7.3));
  float vy = 2.0 + 0.8 * fract(aSeed * 3.7);
  vec3 p = aOrigin;
  p.xz += d * speed * a;
  p.y += vy * a - 0.5 * 3.2 * a * a;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float size = (0.2 + 0.4 * t) * uScale;
  mv.xy += position.xy * size;
  gl_Position = projectionMatrix * mv;
  vUv = position.xy * 2.0;
  vAlpha = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.55, 1.0, t)) * 0.95;
}`;
const FRAG = `
uniform vec3 uColor; uniform float uNight;
varying vec2 vUv; varying float vAlpha;
void main(){
  float d = length(vUv);
  if (d > 1.0 || vAlpha <= 0.0) discard;
  float a = vAlpha * (1.0 - d * d);
  gl_FragColor = vec4(mix(uColor, uColor * vec3(0.7, 0.78, 1.0), uNight), a);
}`;

/** Instanced snow-spray plumes (1 draw call). Slots are re-assigned ~2x/s from the running cannons; the animation runs in the vertex shader. */
export class SnowSprayView {
  readonly group = new THREE.Group();
  readonly mesh: THREE.Mesh;
  readonly capacity = SPRAY.maxCannons * SPRAY.particles;
  /** Cannon ids currently spraying (debug/tests). */
  active: number[] = [];
  private geo = new THREE.InstancedBufferGeometry();
  private mat: THREE.ShaderMaterial;
  private origin = new Float32Array(this.capacity * 3);
  private dir = new Float32Array(this.capacity * 2);
  private seed = new Float32Array(this.capacity);
  private on = new Float32Array(this.capacity);
  private time = 0;
  private selTimer = 0;

  constructor(nightUniform: { value: number } = { value: 0 }) {
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    for (let i = 0; i < this.capacity; i++) this.seed[i] = (i % SPRAY.particles) / SPRAY.particles + ((i * 0.6180339) % 1) * 0.02;
    this.geo.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(this.origin, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aDir', new THREE.InstancedBufferAttribute(this.dir, 2).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(this.seed, 1));
    this.geo.setAttribute('aOn', new THREE.InstancedBufferAttribute(this.on, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.instanceCount = this.capacity;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uLife: { value: SPRAY.life }, uThrow: { value: SPRAY.throw }, uScale: { value: 1 }, uColor: { value: new THREE.Color(0.96, 0.98, 1) }, uNight: nightUniform },
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 6; this.mesh.visible = false;
    this.group.add(this.mesh);
  }

  /**
   * Per frame. `nozzle(id, origin, dir)` writes the nozzle's world position and the horizontal heading (unit x/z) of cannon `id`;
   * returns false when the cannon has no mesh.
   */
  update(dt: number, viewHeight: number, centre: { x: number; y: number }, cands: readonly SprayCandidate[], running: ReadonlySet<number>, nozzle: (id: number, origin: THREE.Vector3, dir: THREE.Vector2) => boolean): void {
    this.time += dt;
    this.mat.uniforms.uTime!.value = this.time;
    this.mat.uniforms.uScale!.value = Math.max(0.6, viewHeight / 45);
    this.selTimer -= dt;
    if (this.selTimer > 0) return;
    this.selTimer = 0.5;
    const ids = selectSprayers(cands, running, centre.x, centre.y, sprayCapForZoom(viewHeight));
    this.on.fill(0);
    const o = new THREE.Vector3(), d = new THREE.Vector2();
    const used: number[] = [];
    for (const id of ids) {
      if (!nozzle(id, o, d)) continue;
      const slot = used.length; used.push(id);
      for (let k = 0; k < SPRAY.particles; k++) {
        const i = slot * SPRAY.particles + k;
        this.origin[i * 3] = o.x; this.origin[i * 3 + 1] = o.y; this.origin[i * 3 + 2] = o.z;
        this.dir[i * 2] = d.x; this.dir[i * 2 + 1] = d.y; this.on[i] = 1;
      }
    }
    this.active = used;
    this.mesh.visible = used.length > 0;
    for (const n of ['aOrigin', 'aDir', 'aOn']) (this.geo.getAttribute(n) as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void { this.geo.dispose(); this.mat.dispose(); }
}
