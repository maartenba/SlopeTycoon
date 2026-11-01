import * as THREE from 'three';
import { ATMOS } from '../../config/atmosphere';
import { HEIGHT_UNIT } from '../../config/balance';
import { isWaterType, type Grid } from '../../world/Grid';
import { dayHash } from './hash';

const VERT = /* glsl */ `
attribute vec3 aOrigin; attribute float aSeed;
uniform float uTime; uniform vec2 uWind; uniform float uAmount; uniform float uScale;
varying vec2 vUv; varying float vAlpha;
void main(){
  float ph = fract(uTime * 0.035 + aSeed);
  vec3 p = aOrigin;
  p.y += ph * 0.9;
  p.xz += uWind * ph * 3.0 + vec2(sin(aSeed * 40.0 + ph * 2.0), cos(aSeed * 31.0 + ph * 1.7)) * 0.6;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  mv.xy += position.xy * (3.2 + 2.2 * ph) * uScale;
  gl_Position = projectionMatrix * mv;
  vUv = position.xy * 2.0;
  vAlpha = uAmount * smoothstep(0.0, 0.25, ph) * (1.0 - smoothstep(0.55, 1.0, ph)) * 0.5;
}`;
const FRAG = /* glsl */ `
uniform vec3 uColor;
varying vec2 vUv; varying float vAlpha;
void main(){
  float d = length(vUv);
  if (d > 1.0 || vAlpha <= 0.002) discard;
  gl_FragColor = vec4(uColor, vAlpha * (1.0 - d * d));
}`;

/** Pure: pick up to `max` water tiles near (cx, cz) in a deterministic order (hash of the tile), one per `stride` cell so the puffs spread out. */
export function pickMistTiles(tileType: ArrayLike<number>, size: number, cx: number, cz: number, radius: number, max: number, seed: number): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const x0 = Math.max(0, Math.floor(cx - radius)), x1 = Math.min(size - 1, Math.ceil(cx + radius));
  const z0 = Math.max(0, Math.floor(cz - radius)), z1 = Math.min(size - 1, Math.ceil(cz + radius));
  const cand: { x: number; z: number; h: number }[] = [];
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    if (!isWaterType(tileType[z * size + x]!)) continue;
    const h = dayHash(seed, z * size + x, 91);
    if (h < 0.35) cand.push({ x, z, h });
  }
  cand.sort((a, b) => a.h - b.h || a.x - b.x || a.z - b.z);
  for (const c of cand) { out.push({ x: c.x, z: c.z }); if (out.length >= max) break; }
  return out;
}

/** Dawn mist over lakes and rivers: ONE instanced draw call, capped puffs, low and wide; hidden (0 draw calls) when the amount is 0. */
export class MistLayer {
  readonly group = new THREE.Group();
  readonly mesh: THREE.Mesh;
  readonly capacity = ATMOS.mist.maxPuffs;
  private origin = new Float32Array(this.capacity * 3);
  private seedA = new Float32Array(this.capacity);
  private geo = new THREE.InstancedBufferGeometry();
  private mat: THREE.ShaderMaterial;
  private refresh = 0;
  private lastKey = '';
  constructor() {
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    for (let i = 0; i < this.capacity; i++) this.seedA[i] = (i * 0.6180339) % 1;
    this.geo.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(this.origin, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(this.seedA, 1));
    this.geo.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uWind: { value: new THREE.Vector2(0.2, 0.1) }, uAmount: { value: 0 }, uScale: { value: 1 }, uColor: { value: new THREE.Color(0.9, 0.93, 0.97) } },
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 4; this.mesh.visible = false;
    this.group.add(this.mesh);
  }
  /** `time` is frozen by the caller under reduced motion (static mist). `focus` = the view centre in tiles. */
  update(dt: number, time: number, amount: number, grid: Grid, seed: number, focus: { x: number; z: number }, viewHeight: number, wind: number, color: readonly [number, number, number]): void {
    this.mesh.visible = amount > 0.01;
    if (!this.mesh.visible) return;
    const u = this.mat.uniforms;
    u.uTime!.value = time; u.uAmount!.value = amount; u.uScale!.value = Math.max(0.7, Math.min(2.2, viewHeight / 45));
    u.uWind!.value.set(wind * 0.8, wind * 0.4);
    (u.uColor!.value as THREE.Color).setRGB(color[0], color[1], color[2]);
    this.refresh -= dt;
    const key = `${Math.round(focus.x / 8)},${Math.round(focus.z / 8)}`;
    if (this.refresh > 0 && key === this.lastKey) return;
    this.refresh = 2; this.lastKey = key;
    const tiles = pickMistTiles(grid.tileType, grid.size, focus.x, focus.z, Math.max(30, viewHeight * 0.9), this.capacity, seed);
    let n = 0;
    for (const t of tiles) {
      const y = grid.getCorner(t.x, t.z) * HEIGHT_UNIT + 0.35;
      this.origin[n * 3] = t.x + 0.5; this.origin[n * 3 + 1] = y; this.origin[n * 3 + 2] = t.z + 0.5; n++;
    }
    this.geo.instanceCount = n;
    (this.geo.getAttribute('aOrigin') as THREE.InstancedBufferAttribute).needsUpdate = true;
  }
  dispose(): void { this.geo.dispose(); this.mat.dispose(); }
}
