import * as THREE from 'three';
import { FOG_FRAG, FOG_PARS_FRAG, FOG_PARS_VERT, fogUniforms, fogVert } from './Fog';
import type { Grid } from '@/world/Grid';
import { TileType } from '@/world/Grid';
import type { Lake, Stream } from '@/world/TerrainGen';
import { HEIGHT_UNIT, TEXTURE_SEED } from '@/config/balance';
import { diagonalNS } from './TerrainGeometry';
import { createWaterNormalTexture } from './textures';

const LIFT = 0.04;

export interface WaterGeometryData {
  positions: Float32Array;
  /** tile-local 0..1 */
  local: Float32Array;
  /** per vertex: 1 where the side (n, e, s, w) of the tile borders non-water => shoreline foam */
  sides: Float32Array;
  /** per vertex flow direction in (x, z); zero for lakes */
  flow: Float32Array;
  /** 0 shallow .. 1 deep */
  depth: Float32Array;
  /** per vertex (speed multiplier, rapids foam 0..1, river ice -1 = global freeze / 0..1). Natural streams + lakes: (1, 0, -1) unless a flow lookup says otherwise. */
  info: Float32Array;
  /** Tile ranges of every flowing waterway (6 vertices per tile), for per-tile flow updates. */
  ranges: WaterRange[];
  vertexCount: number;
}

/** A waterway's vertices: tile i owns vertices `first + 6 i .. first + 6 i + 5`. `dug` rivers own their ice (the global freeze does not apply). */
export interface WaterRange { id: string; dug: boolean; first: number; tiles: number }
/** The part of the sim's `WayFlow` the mesh reads (structural, no sim import). */
export interface WayFlowLike { speed: number[]; cls: number[]; frozen: boolean }
/** A dug river as the mesh needs it (ids 'r<id>', same vocabulary as `waterways()`). */
export interface DugWay { id: string; path: Array<{ x: number; y: number }> }
/** Flow of one tile as the mesh needs it. */
export interface TileFlowInfo { speed: number; rapids: number; ice: number }

/** Pure builder: flat quads at lake level over lake tiles + terrain-draped decals over stream tiles. */
export function buildWaterData(grid: Grid, lakes: Lake[], streams: Stream[], dug: ReadonlyArray<DugWay> = []): WaterGeometryData {
  const N = grid.size;
  const T = grid.tileType;
  const isW = (x: number, y: number): boolean => {
    if (!grid.inBounds(x, y)) return false;
    const t = T[y * N + x];
    return t === TileType.Water || t === TileType.Stream;
  };
  const isLakeT = (x: number, y: number): boolean => grid.inBounds(x, y) && T[y * N + x] === TileType.Water;
  const pos: number[] = [], loc: number[] = [], sid: number[] = [], flw: number[] = [], dep: number[] = [], inf: number[] = [];
  const ranges: WaterRange[] = [];
  // quad corner order n(0,0) w(0,1) e(1,0) s(1,1) -> two triangles
  const emit = (
    x: number, y: number, hs: [number, number, number, number], fx: number, fz: number, lake: boolean, bed?: number[],
  ): void => {
    // foam only on edges that border land (not other water)
    const sides = [isW(x, y - 1) ? 0 : 1, isW(x + 1, y) ? 0 : 1, isW(x, y + 1) ? 0 : 1, isW(x - 1, y) ? 0 : 1];
    const cn = [[0, 0], [1, 0], [1, 1], [0, 1]] as const; // n e s w
    const vdepth = (k: number): number => (lake && bed ? Math.min(1, Math.max(0, bed[k]! / 2)) : 0.25);
    const v = (k: number): void => {
      const [cx, cy] = cn[k]!;
      pos.push(x + cx, hs[k]! * HEIGHT_UNIT + LIFT, y + cy);
      loc.push(cx, cy);
      sid.push(sides[0]!, sides[1]!, sides[2]!, sides[3]!);
      flw.push(fx, fz);
      dep.push(vdepth(k));
      inf.push(1, 0, -1);
    };
    const order = diagonalNS(hs[0], hs[1], hs[2], hs[3]) ? [0, 3, 2, 0, 2, 1] : [0, 3, 1, 3, 2, 1];
    for (const k of order) v(k);
  };
  for (const lake of lakes) {
    for (const ti of lake.tileIdx) {
      const tx = ti % N, ty = (ti - tx) / N;
      if (!isLakeT(tx, ty)) continue;
      const c = grid.getCorners(tx, ty);
      if (c.some((h) => h > lake.level)) continue; // never over (or above) terrain higher than the surface
      emit(tx, ty, [lake.level, lake.level, lake.level, lake.level], 0, 0, true, c.map((h) => lake.level - h));
    }
  }
  const emitWay = (id: string, isDug: boolean, path: Array<{ x: number; y: number }>): void => {
    ranges.push({ id, dug: isDug, first: pos.length / 3, tiles: path.length });
    for (let i = 0; i < path.length; i++) {
      const p = path[i]!;
      const last = i === path.length - 1;
      const q = last ? path[Math.max(0, i - 1)]! : p;
      const nx = last ? p : path[i + 1]!;
      const dx = nx.x - q.x, dz = nx.y - q.y;
      const l = Math.hypot(dx, dz) || 1;
      emit(p.x, p.y, grid.getCorners(p.x, p.y), dx / l, dz / l, false);
    }
  };
  streams.forEach((s, i) => emitWay(`n${i}`, false, s.path));
  for (const r of dug) emitWay(r.id, true, r.path);
  return {
    positions: new Float32Array(pos), local: new Float32Array(loc), sides: new Float32Array(sid),
    flow: new Float32Array(flw), depth: new Float32Array(dep), info: new Float32Array(inf), ranges, vertexCount: pos.length / 3,
  };
}

const VERT = /* glsl */ `
attribute vec2 aLocal;
attribute vec4 aSides;
attribute vec2 aFlow;
attribute float aDepth;
attribute vec3 aInfo;
varying vec3 vInfo;
varying vec3 vWorld;
varying vec2 vLocal;
varying vec4 vSides;
varying vec2 vFlow;
varying float vDepth;
${FOG_PARS_VERT}
void main() {
  vWorld = position;
  vLocal = aLocal;
  vSides = aSides;
  vFlow = aFlow;
  vDepth = aDepth;
  vInfo = aInfo;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  ${fogVert('(modelViewMatrix * vec4(position, 1.0))')}
}`;

const FRAG = /* glsl */ `
uniform sampler2D tNormal;
uniform float uTime, uTimeR, uFreeze;
uniform vec3 uSunDir, uSunColor, uSkyColor;
${FOG_PARS_FRAG}
varying vec3 vWorld;
varying vec2 vLocal;
varying vec4 vSides;
varying vec2 vFlow;
varying float vDepth;
varying vec3 vInfo;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  float fl = clamp(length(vFlow), 0.0, 1.0);
  // dug rivers own their ice (vInfo.z >= 0) and their own never-frozen clock; lakes / natural streams follow the global freeze
  bool own = vInfo.z > -0.5;
  float uFreezeL = own ? vInfo.z : uFreeze;
  float tm = own ? uTimeR : uTime;
  // streams scroll along their flow direction at the model speed (world-space UVs: flicker-safe), lakes drift slowly
  float sp = vInfo.x * (1.0 - (own ? vInfo.z : 0.0));
  vec2 uvA = vWorld.xz * 0.3 - vFlow * tm * 0.5 * sp + (1.0 - fl) * vec2(0.02, 0.013) * tm;
  vec2 uvB = vWorld.xz * 0.47 + 7.0 - vFlow * tm * 0.8 * sp + (1.0 - fl) * vec2(-0.015, 0.021) * tm;
  vec3 nA = texture2D(tNormal, uvA).xyz * 2.0 - 1.0;
  vec3 nB = texture2D(tNormal, uvB).xyz * 2.0 - 1.0;
  vec2 nt = (nA.xy + nB.xy) * 0.5 * mix(0.9, 0.1, uFreezeL) * (1.0 + 0.5 * vInfo.y);
  vec3 n = normalize(vec3(nt.x, 1.0, nt.y));
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 H = normalize(uSunDir + V);
  float spec = pow(max(dot(n, H), 0.0), 90.0);
  float diff = max(dot(n, uSunDir), 0.0);
  vec3 deep = vec3(0.04, 0.27, 0.45);
  vec3 shallow = vec3(0.17, 0.60, 0.70);
  vec3 col = mix(shallow, deep, smoothstep(0.2, 1.0, vDepth));
  float fr = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  col = mix(col, uSkyColor, fr * 0.45);
  col *= 0.6 + 0.5 * diff;
  col += uSunColor * spec * 0.8 * (1.0 - uFreezeL * 0.6);
  // shoreline foam: along tile sides that border land
  float e = 0.0;
  e = max(e, vSides.x * (1.0 - smoothstep(0.0, 0.2, vLocal.y)));
  e = max(e, vSides.y * (1.0 - smoothstep(0.0, 0.2, 1.0 - vLocal.x)));
  e = max(e, vSides.z * (1.0 - smoothstep(0.0, 0.2, 1.0 - vLocal.y)));
  e = max(e, vSides.w * (1.0 - smoothstep(0.0, 0.2, vLocal.x)));
  float wob = vnoise(vWorld.xz * 3.0 + uTime * vec2(0.4, 0.3));
  float foam = e * (0.45 + 0.55 * wob) * (1.0 - fl * 0.7);
  col = mix(col, vec3(0.93, 0.97, 1.0), foam * 0.55 * (1.0 - uFreezeL * 0.5));
  // rapids: white water streaks = world-space noise advected with the flow (no screen-space noise), only on rapids / brisk tiles
  float rap = vInfo.y * (1.0 - uFreezeL);
  vec2 rp = vWorld.xz * 5.0 - vFlow * tm * 1.6 * sp;
  float rn = vnoise(rp) * 0.6 + vnoise(rp * 2.1 + 3.7) * 0.4;
  float whitewater = rap * smoothstep(0.5, 0.78, rn) * fl;
  col = mix(col, vec3(0.95, 0.98, 1.0), whitewater * 0.75);
  foam += whitewater * 0.5;
  // winter ice
  vec3 ice = vec3(0.82, 0.90, 0.96) * (0.9 + 0.1 * vnoise(vWorld.xz * 1.5)) + uSunColor * spec * 0.25;
  col = mix(col, ice, uFreezeL);
  float alpha = mix(0.42, 0.88, smoothstep(0.0, 1.0, vDepth)) + foam * 0.2;
  alpha = clamp(mix(alpha, 0.96, uFreezeL), 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
  ${FOG_FRAG}
  #include <colorspace_fragment>
}`;

export class Water {
  readonly group = new THREE.Group();
  private readonly normalMap: THREE.CanvasTexture;
  private readonly material: THREE.ShaderMaterial;
  private mesh: THREE.Mesh | null = null;
  private readonly grid: Grid;
  private readonly streams: Stream[];
  private clock = 0;
  /** Never-frozen clock for dug rivers (they own their ice). */
  private rclock = 0;
  private dug: DugWay[] = [];
  private lakes: Lake[] = [];
  private ranges: WaterRange[] = [];
  private info: Float32Array | null = null;
  private flowLookup: ((id: string) => WayFlowLike | undefined) | null = null;
  /** Per dug river: current / target ice 0..1 (eased so rivers ice over instead of popping). */
  private ice = new Map<string, { cur: number; target: number }>();
  /** Tiles whose flow class is rapids (x, y, z world), for the splash emitter. */
  rapids: Array<{ x: number; y: number; z: number }> = [];
  private lastT: number | null = null;

  constructor(grid: Grid, lakes: Lake[], streams: Stream[] = [], sun?: THREE.DirectionalLight) {
    this.normalMap = createWaterNormalTexture(TEXTURE_SEED);
    const sunDir = sun ? sun.position.clone().normalize() : new THREE.Vector3(0.5, 1, 0.3).normalize();
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      uniforms: {
        tNormal: { value: this.normalMap },
        ...fogUniforms,
        uTime: { value: 0 },
        uTimeR: { value: 0 },
        uFreezeL: { value: 0 },
        uSunDir: { value: sunDir },
        uSunColor: { value: new THREE.Color(0.85, 0.76, 0.58) },
        uSkyColor: { value: new THREE.Color(0.46, 0.54, 0.68) },
      },
    });
    this.grid = grid; this.streams = streams;
    this.setLakes(lakes);
  }

  /** (Re)build the water mesh: natural lakes + ponds the player dug (+ streams). Called again whenever a pond is dug / filled in / undone. */
  setLakes(lakes: Lake[]): void {
    this.lakes = lakes;
    if (this.mesh) { this.group.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null; }
    const d = buildWaterData(this.grid, lakes, this.streams, this.dug);
    this.ranges = d.ranges; this.info = d.info;
    if (d.vertexCount === 0) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(d.positions, 3));
    g.setAttribute('aLocal', new THREE.BufferAttribute(d.local, 2));
    g.setAttribute('aSides', new THREE.BufferAttribute(d.sides, 4));
    g.setAttribute('aFlow', new THREE.BufferAttribute(d.flow, 2));
    g.setAttribute('aDepth', new THREE.BufferAttribute(d.depth, 1));
    g.setAttribute('aInfo', new THREE.BufferAttribute(d.info, 3).setUsage(THREE.DynamicDrawUsage));
    g.computeBoundingSphere();
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.renderOrder = 1;
    this.group.add(this.mesh);
    if (this.flowLookup) this.applyFlow(this.flowLookup);
  }

  /** Dug rivers drawn by the same mesh (one draw call). Call `setLakes` (or this, which rebuilds) after the list changed. */
  setRivers(dug: DugWay[]): void {
    this.dug = dug;
    const keep = new Set(dug.map((d) => d.id));
    for (const id of [...this.ice.keys()]) if (!keep.has(id)) this.ice.delete(id);
    this.setLakes(this.lakes);
  }

  /**
   * Per-tile flow of every waterway (speed, rapids, river ice) from the sim's flow table: rewrites the `aInfo` attribute in place (no geometry rebuild,
   * no extra draw call). Natural streams keep the global freeze (`ice -1`); dug rivers ease toward their frozen state in `update`.
   */
  applyFlow(lookup: (id: string) => WayFlowLike | undefined): void {
    this.flowLookup = lookup;
    this.rapids = [];
    const info = this.info;
    if (!info || !this.mesh) return;
    for (const r of this.ranges) {
      const f = lookup(r.id);
      if (!f) continue;
      if (r.dug) { const e = this.ice.get(r.id); if (e) e.target = f.frozen ? 1 : 0; else this.ice.set(r.id, { cur: f.frozen ? 1 : 0, target: f.frozen ? 1 : 0 }); }
      const ice = r.dug ? this.ice.get(r.id)!.cur : -1;
      const path = r.dug ? this.dug.find((d) => d.id === r.id)?.path : this.streams[Number(r.id.slice(1))]?.path;
      for (let t = 0; t < r.tiles; t++) {
        const sp = f.speed[t] ?? 1, cl = f.cls[t] ?? 0;
        const speed = r.dug ? Math.max(sp, f.frozen ? 0.4 : 0) : (sp > 0 ? sp : 1); // frozen: the shader scales by (1 - ice); keep a nonzero base so easing looks right
        for (let k = 0; k < 6; k++) { const o = (r.first + t * 6 + k) * 3; info[o] = speed; info[o + 1] = cl / 2; info[o + 2] = ice; }
        if (cl === 2 && !f.frozen && path) {
          const p = path[t]!, c = this.grid.getCorners(p.x, p.y);
          this.rapids.push({ x: p.x + 0.5, y: ((c[0]! + c[1]! + c[2]! + c[3]!) / 4) * HEIGHT_UNIT + 0.1, z: p.y + 0.5 });
        }
      }
    }
    (this.mesh.geometry.getAttribute('aInfo') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** 0..1: water ices over (white tint, still surface, no flow). */
  /** Shader uniforms (lighting is driven through uSunDir/uSunColor/uSkyColor). */
  get uniforms(): Record<string, THREE.IUniform> { return this.material.uniforms; }
  set freeze(v: number) { (this.material.uniforms.uFreezeL as THREE.IUniform<number>).value = Math.min(1, Math.max(0, v)); }
  get freeze(): number { return (this.material.uniforms.uFreezeL as THREE.IUniform<number>).value; }

  /** Animation clock slows to a halt as the water freezes. */
  update(timeSeconds: number): void {
    const dt = this.lastT === null ? 0 : Math.min(0.25, Math.max(0, timeSeconds - this.lastT));
    this.lastT = timeSeconds;
    this.clock += dt * (1 - this.freeze);
    this.rclock += dt;
    (this.material.uniforms.uTime as THREE.IUniform<number>).value = this.clock;
    (this.material.uniforms.uTimeR as THREE.IUniform<number>).value = this.rclock;
    this.easeIce(dt);
  }

  /** Ease each dug river's ice toward its target (about 1.5 s) and write it into the vertices of that river. */
  private easeIce(dt: number): void {
    if (!this.info || !this.mesh || this.ice.size === 0) return;
    let dirty = false;
    for (const r of this.ranges) {
      if (!r.dug) continue;
      const e = this.ice.get(r.id);
      if (!e || e.cur === e.target) continue;
      const step = dt / 1.5;
      e.cur = e.cur < e.target ? Math.min(e.target, e.cur + step) : Math.max(e.target, e.cur - step);
      for (let v = 0; v < r.tiles * 6; v++) this.info[(r.first + v) * 3 + 2] = e.cur;
      dirty = true;
    }
    if (dirty) (this.mesh.geometry.getAttribute('aInfo') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.mesh?.geometry.dispose();
    this.material.dispose();
    this.normalMap.dispose();
  }
}
