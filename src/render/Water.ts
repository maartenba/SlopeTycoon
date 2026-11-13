import * as THREE from 'three';
import { FOG_FRAG, FOG_PARS_FRAG, FOG_PARS_VERT, fogUniforms, fogVert } from './Fog';
import type { Grid } from '@/world/Grid';
import { TileType } from '@/world/Grid';
import type { Lake, Stream } from '@/world/TerrainGen';
import { HEIGHT_UNIT, TEXTURE_SEED } from '@/config/balance';
import { diagonalNS } from './TerrainGeometry';
import { riverEdges } from '@/world/RiverPlanner';
import { createWaterNormalTexture } from './textures';
import { treeNear, treeReflectTint, FRINGE_MIN, STREAM_FRINGE_MIN, makeField, tileCells, triangleHeight } from './waterContour';

const LIFT = 0.04;

export interface WaterGeometryData {
  positions: Float32Array;
  /** tile-local 0..1 */
  local: Float32Array;
  /** per vertex: 1 where the side (n, e, s, w) of the tile borders non-water => shoreline foam */
  sides: Float32Array;
  /** per vertex (nw, ne, se, sw): 1 where that diagonal neighbour is land while both tile sides next to it are water (a concave shoreline corner, rounded in the shader) */
  corners: Float32Array;
  /** per vertex water field (contour mode only; empty otherwise): the blurred water mask, the shader draws the waterline at 0.5 */
  field: Float32Array;
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
export interface WaterRange { id: string; dug: boolean; first: number; tiles: number; /** vertices per tile: 6, or 24 in contour mode */ vpt: number; /** contour mode: owner path-tile index of each land fringe tile appended after the way's tiles (round bends) */ fringe: number[] }
/** The part of the sim's `WayFlow` the mesh reads (structural, no sim import). */
export interface WayFlowLike { speed: number[]; cls: number[]; frozen: boolean }
/** A dug river as the mesh needs it (ids 'r<id>', same vocabulary as `waterways()`). */
export interface DugWay { id: string; path: Array<{ x: number; y: number }> }
/** Flow of one tile as the mesh needs it. */
export interface TileFlowInfo { speed: number; rapids: number; ice: number }

/**
 * Unit flow direction (x, z) of tile `i` of a waterway path: toward the next tile (the last tile keeps the direction it was entered with, a one-tile way points +z).
 * Always source -> sink, whatever the orientation of the way (the shader scrolls the texture along +flow, i.e. downstream).
 */
export function wayFlowDir(path: ReadonlyArray<{ x: number; y: number }>, i: number): [number, number] {
  const last = i === path.length - 1, p = path[i]!;
  const q = last ? path[Math.max(0, i - 1)]! : p;
  const nx = last ? p : path[i + 1]!;
  const dx = nx.x - q.x, dz = nx.y - q.y;
  const l = Math.hypot(dx, dz) || 1;
  return [dx / l, dz / l];
}

/**
 * Water surface of a dug-river tile (n, e, s, w): the two corners of its entry edge and of its exit edge keep the carved bed height (a clean ramp down the
 * flow); the outer corner of a bend never rises above the entry level, so the surface is never a sheet that climbs the bank. Pure.
 */
export function riverTileSurface(grid: Grid, p: { x: number; y: number }, entry: readonly [number, number], exit: readonly [number, number]): [number, number, number, number] {
  const V = grid.vsize, raw = grid.getCorners(p.x, p.y);
  const vi = [p.y * V + p.x, p.y * V + p.x + 1, (p.y + 1) * V + p.x + 1, (p.y + 1) * V + p.x];
  const lvl = Math.min(grid.heights[entry[0]]!, grid.heights[entry[1]]!);
  return raw.map((h, k) => (entry.includes(vi[k]!) || exit.includes(vi[k]!) ? h : Math.min(h, lvl))) as [number, number, number, number];
}

/** Pure builder: flat quads at lake level over lake tiles + terrain-draped decals over stream tiles. */
export function buildWaterData(grid: Grid, lakes: Lake[], streams: Stream[], dug: ReadonlyArray<DugWay> = [], opts: { contour?: boolean } = {}): WaterGeometryData {
  const contour = opts.contour === true, fld = contour ? makeField(grid) : null;
  const fieldOut: number[] = [];
  const N = grid.size;
  const T = grid.tileType;
  const isW = (x: number, y: number): boolean => {
    if (!grid.inBounds(x, y)) return false;
    const t = T[y * N + x];
    return t === TileType.Water || t === TileType.Stream;
  };
  const isLakeT = (x: number, y: number): boolean => grid.inBounds(x, y) && T[y * N + x] === TileType.Water;
  const pos: number[] = [], loc: number[] = [], sid: number[] = [], cor: number[] = [], flw: number[] = [], dep: number[] = [], inf: number[] = [];
  const ranges: WaterRange[] = [];
  // quad corner order n(0,0) w(0,1) e(1,0) s(1,1) -> two triangles
  const emit = (
    x: number, y: number, hs: [number, number, number, number], fx: number, fz: number, lake: boolean, bed?: number[],
  ): void => {
    if (fld) { // contour mode: 2 x 2 cells per tile (24 vertices), the field per vertex drives the drawn waterline
      const ns = diagonalNS(hs[0], hs[1], hs[2], hs[3]);
      for (const [u, v] of tileCells(ns)) {
        pos.push(x + u, triangleHeight(hs, u, v) * HEIGHT_UNIT + LIFT, y + v);
        loc.push(u, v); sid.push(0, 0, 0, 0); cor.push(0, 0, 0, 0); flw.push(fx, fz);
        const bd = lake && bed ? Math.min(1, Math.max(0, (bed[0]! * (1 - u) * (1 - v) + bed[1]! * u * (1 - v) + bed[2]! * u * v + bed[3]! * (1 - u) * v) / 2)) : 0.4;
        dep.push(bd); inf.push(1, 0, -1); fieldOut.push(fld.at(x + u, y + v));
      }
      return;
    }
    // foam only on edges that border land (not other water)
    const sides = [isW(x, y - 1) ? 0 : 1, isW(x + 1, y) ? 0 : 1, isW(x, y + 1) ? 0 : 1, isW(x - 1, y) ? 0 : 1];
    const cc = [!isW(x - 1, y - 1) && !sides[0] && !sides[3], !isW(x + 1, y - 1) && !sides[0] && !sides[1], !isW(x + 1, y + 1) && !sides[2] && !sides[1], !isW(x - 1, y + 1) && !sides[2] && !sides[3]].map((q) => (q ? 1 : 0));
    const cn = [[0, 0], [1, 0], [1, 1], [0, 1]] as const; // n e s w
    const vdepth = (k: number): number => (lake && bed ? Math.min(1, Math.max(0, bed[k]! / 2)) : 0.4);
    const v = (k: number): void => {
      const [cx, cy] = cn[k]!;
      pos.push(x + cx, hs[k]! * HEIGHT_UNIT + LIFT, y + cy);
      loc.push(cx, cy);
      sid.push(sides[0]!, sides[1]!, sides[2]!, sides[3]!);
      cor.push(cc[0]!, cc[1]!, cc[2]!, cc[3]!);
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
  if (fld) { // concave wedges: land tiles beside a lake whose corner field is well above the waterline get a patch (the terrain hides it where it is higher), so the lake outline has no square notch
    const seen = new Set<number>();
    for (const lake of lakes) for (const ti of lake.tileIdx) {
      const tx = ti % N, ty = (ti - tx) / N;
      if (!isLakeT(tx, ty)) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const ax = tx + dx, ay = ty + dy, k = ay * N + ax;
        if (!grid.inBounds(ax, ay) || isW(ax, ay) || seen.has(k)) continue;
        seen.add(k);
        if (Math.max(fld.corner(ax, ay), fld.corner(ax + 1, ay), fld.corner(ax, ay + 1), fld.corner(ax + 1, ay + 1)) < FRINGE_MIN) continue;
        emit(ax, ay, [lake.level, lake.level, lake.level, lake.level], 0, 0, true, [0, 0, 0, 0]);
      }
    }
  }
  const emitWay = (id: string, isDug: boolean, path: Array<{ x: number; y: number }>): void => {
    ranges.push({ id, dug: isDug, first: pos.length / 3, tiles: path.length, vpt: contour ? 24 : 6, fringe: [] });
    const range = ranges[ranges.length - 1]!;
    const edges = isDug ? riverEdges(path, grid.vsize) : [];
    for (let i = 0; i < path.length; i++) {
      const p = path[i]!;
      const [fx, fz] = wayFlowDir(path, i);
      let hs = grid.getCorners(p.x, p.y);
      if (isDug) hs = riverTileSurface(grid, p, edges[i]!, edges[i + 1]!);
      emit(p.x, p.y, hs, fx, fz, false);
    }
    if (fld) { // fringe: land tiles beside a bend whose corner field is above the waterline (the contour leaves the tile there): drawn on the terrain, owned by the way (flow + ice)
      const seen = new Set<number>();
      path.forEach((p, i) => {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const ax = p.x + dx, ay = p.y + dy, k = ay * N + ax;
          if (!grid.inBounds(ax, ay) || isW(ax, ay) || seen.has(k)) continue;
          seen.add(k);
          if (Math.max(fld.corner(ax, ay), fld.corner(ax + 1, ay), fld.corner(ax, ay + 1), fld.corner(ax + 1, ay + 1)) < STREAM_FRINGE_MIN) continue;
          const [fx, fz] = wayFlowDir(path, i);
          emit(ax, ay, grid.getCorners(ax, ay), fx, fz, false);
          range.fringe.push(i);
        }
      });
    }
  };
  streams.forEach((s, i) => emitWay(`n${i}`, false, s.path));
  for (const r of dug) emitWay(r.id, true, r.path);
  return {
    positions: new Float32Array(pos), local: new Float32Array(loc), sides: new Float32Array(sid), corners: new Float32Array(cor),
    field: new Float32Array(fieldOut), flow: new Float32Array(flw), depth: new Float32Array(dep), info: new Float32Array(inf), ranges, vertexCount: pos.length / 3,
  };
}

const VERT = /* glsl */ `
attribute vec2 aLocal;
attribute vec4 aSides;
attribute vec4 aCorners;
attribute vec2 aFlow;
attribute float aDepth;
attribute vec3 aInfo;
#ifdef CONTOUR
attribute float aField;
attribute float aTree;
varying float vField;
varying float vTree;
#endif
varying vec3 vInfo;
varying vec3 vWorld;
varying vec2 vLocal;
varying vec4 vSides;
varying vec4 vCorners;
varying vec2 vFlow;
varying float vDepth;
${FOG_PARS_VERT}
void main() {
  vWorld = position;
  vLocal = aLocal;
  vSides = aSides;
  vCorners = aCorners;
  vFlow = aFlow;
  vDepth = aDepth;
  vInfo = aInfo;
#ifdef CONTOUR
  vField = aField;
  vTree = aTree;
#endif
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
varying vec4 vCorners;
varying vec2 vFlow;
varying float vDepth;
varying vec3 vInfo;
#ifdef CONTOUR
varying float vField;
varying float vTree;
uniform vec3 uTreeTint;
#endif

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
#ifdef CONTOUR
  { // lake / river reflections (Med / High, no extra pass: docs/graphics-m8.md): sky gradient mirrored by the rippled normal, a soft mirrored-sun glint, and a broken
    // reflection of the tree line near wooded shores (autumn tint). Everything is world-space + the view vector (no screen-space noise): stable under camera motion.
    vec3 Rv = reflect(-V, n);
    float ndv = max(dot(n, V), 0.0);
    float up = clamp(Rv.y, 0.0, 1.0);
    vec3 horizon = mix(uSkyColor, vec3(0.80, 0.87, 0.94), 0.3);
    vec3 skyR = mix(horizon, uSkyColor * 0.82, smoothstep(0.05, 0.85, up));
    float rs = (0.04 + 0.16 * pow(1.0 - ndv, 2.0)) * mix(0.55, 1.0, smoothstep(0.0, 1.0, vDepth)) * (1.0 - fl * 0.5) * (1.0 - uFreezeL);
    col = mix(col, skyR, rs);
    float trn = vnoise(vWorld.xz * vec2(3.1, 3.1) + nt * 6.0) * 0.6 + vnoise(vWorld.xz * 7.3 + 9.0) * 0.4;
    float tr = vTree * smoothstep(0.2, 0.75, trn + vTree * 0.35) * (1.0 - fl * 0.6) * (1.0 - uFreezeL);
    col = mix(col, uTreeTint * (0.55 + 0.45 * diff), tr * 0.5 * (0.5 + rs));
    float sg = max(dot(Rv, uSunDir), 0.0);
    col += uSunColor * (pow(sg, 380.0) * 1.1 + pow(sg, 36.0) * 0.1) * (1.0 - uFreezeL) * (1.0 - fl * 0.5);
  }
#endif
  col *= 0.6 + 0.5 * diff;
  col += uSunColor * spec * 0.8 * (1.0 - uFreezeL * 0.6);
  // shoreline (M8): the DRAWN edge only (sim tiles are untouched): distance to the nearest land side, with convex corners rounded and a slow world-space wobble,
  // so shores read as organic curves instead of tile squares. d = 0 at the (wobbled) waterline, grows into the water.
#ifdef CONTOUR
  // contour mode (Med / High): the waterline is the 0.5 contour of the blurred water mask carried per vertex (marching squares on a 2 x 2 refined grid), so lake corners
  // and river bends are smooth curves; the field is world-space data, so nothing moves with the camera. dm = distance (tiles) inside the contour.
  float dm = (vField - 0.5) + 8.0 * smoothstep(0.8, 0.97, vField); // deep interior: d saturates like the tile-side version (full depth tone + alpha)
#else
  float dN = mix(9.0, vLocal.y, vSides.x), dE = mix(9.0, 1.0 - vLocal.x, vSides.y), dS = mix(9.0, 1.0 - vLocal.y, vSides.z), dW = mix(9.0, vLocal.x, vSides.w);
  const float R = 0.5;
  float dm = min(min(dN, dE), min(dS, dW));
  dm = min(dm, mix(9.0, R - length(max(vec2(R - dN, R - dE), 0.0)), vSides.x * vSides.y));
  dm = min(dm, mix(9.0, R - length(max(vec2(R - dE, R - dS), 0.0)), vSides.y * vSides.z));
  dm = min(dm, mix(9.0, R - length(max(vec2(R - dS, R - dW), 0.0)), vSides.z * vSides.w));
  dm = min(dm, mix(9.0, R - length(max(vec2(R - dW, R - dN), 0.0)), vSides.w * vSides.x));
  // concave corners (land only on the diagonal): the land pokes in as a rounded quarter disc, so a pond's staircase outline reads as a smooth curve
  const float RC = 0.34;
  dm = min(dm, mix(9.0, length(vLocal - vec2(0.0, 0.0)) - RC, vCorners.x));
  dm = min(dm, mix(9.0, length(vLocal - vec2(1.0, 0.0)) - RC, vCorners.y));
  dm = min(dm, mix(9.0, length(vLocal - vec2(1.0, 1.0)) - RC, vCorners.z));
  dm = min(dm, mix(9.0, length(vLocal - vec2(0.0, 1.0)) - RC, vCorners.w));
#endif
  // free-form outline (M8 lane I): two world-space noise octaves push the waterline in and out by up to ~0.2 tile, so the staircase of tiles reads as a hand-drawn curve
  float sw = vnoise(vWorld.xz * 0.9 + 3.0) * 0.5 + vnoise(vWorld.xz * 2.3 + 11.0) * 0.3 + vnoise(vWorld.xz * 5.1 + 29.0) * 0.2;
#ifdef CONTOUR
  float d = dm - 0.02 - (sw - 0.5) * 0.14; // the contour is already smooth: only a faint organic wobble is left
#else
  float d = dm - 0.04 - (sw - 0.5) * 0.36;
#endif
  float e = 1.0 - smoothstep(0.0, 0.22, d);
  e *= step(dm, 8.0);
  float wob = vnoise(vWorld.xz * 3.0 + uTime * vec2(0.4, 0.3));
  float foam = e * (0.45 + 0.55 * wob) * (1.0 - fl * 0.7);
  // depth gradient (M8 lane I): sandy shallows at the waterline -> clear turquoise -> darker, bluer water inside; a wet-sand edge and a thin soft foam line.
  // d is the distance to the (wobbled) waterline; it saturates by ~0.9 so it is continuous across tile borders. World-space only.
  float shoreK = smoothstep(0.0, 0.6, d);
  float vary = 0.85 + 0.3 * vnoise(vWorld.xz * 1.3 + 5.0);
  vec3 sandy = vec3(0.74, 0.70, 0.52) * (0.65 + 0.35 * diff);
  col = mix(col, sandy, (1.0 - smoothstep(0.0, 0.42 * vary, d)) * 0.5 * (1.0 - uFreezeL));
  col = mix(col, col * vec3(0.78, 0.9, 1.0), smoothstep(0.2, 0.6, d) * 0.5 * (1.0 - fl));
  float aaD = 1.0 - smoothstep(0.1, 0.35, fwidth(d) * 6.0);
  float line = (1.0 - smoothstep(0.0, 0.07, abs(d - 0.07))) * aaD * step(dm, 8.0);
  col = mix(col, vec3(0.95, 0.98, 1.0), (line * 0.45 + foam * 0.3) * (1.0 - uFreezeL * 0.5));
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
  float alpha = mix(0.55, 0.9, smoothstep(0.0, 1.0, vDepth)) + foam * 0.2;
  alpha = clamp(mix(alpha, 0.96, uFreezeL), 0.0, 1.0);
  alpha = mix(alpha * 0.8, alpha, shoreK);
  alpha *= smoothstep(-0.015, 0.05, d); // soft rounded waterline
  if (alpha < 0.01) discard;
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
  private contour = false;
  private treeCover: ArrayLike<number> | null = null;

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
        uTreeTint: { value: new THREE.Color(0.1, 0.22, 0.1) },
      },
    });
    this.grid = grid; this.streams = streams;
    this.setLakes(lakes);
  }

  /** (Re)build the water mesh: natural lakes + ponds the player dug (+ streams). Called again whenever a pond is dug / filled in / undone. */
  setLakes(lakes: Lake[]): void {
    this.lakes = lakes;
    if (this.mesh) { this.group.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null; }
    const d = buildWaterData(this.grid, lakes, this.streams, this.dug, { contour: this.contour });
    this.ranges = d.ranges; this.info = d.info;
    if (d.vertexCount === 0) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(d.positions, 3));
    g.setAttribute('aLocal', new THREE.BufferAttribute(d.local, 2));
    g.setAttribute('aSides', new THREE.BufferAttribute(d.sides, 4));
    g.setAttribute('aCorners', new THREE.BufferAttribute(d.corners, 4));
    g.setAttribute('aFlow', new THREE.BufferAttribute(d.flow, 2));
    g.setAttribute('aDepth', new THREE.BufferAttribute(d.depth, 1));
    if (this.contour) {
      g.setAttribute('aField', new THREE.BufferAttribute(d.field, 1));
      g.setAttribute('aTree', new THREE.BufferAttribute(new Float32Array(d.vertexCount), 1).setUsage(THREE.DynamicDrawUsage));
    }
    g.setAttribute('aInfo', new THREE.BufferAttribute(d.info, 3).setUsage(THREE.DynamicDrawUsage));
    g.computeBoundingSphere();
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.renderOrder = 1;
    this.group.add(this.mesh);
    this.refreshTrees();
    if (this.flowLookup) this.applyFlow(this.flowLookup);
  }

  /** Per-tile tree cover (the sim's `ForestCover.cover`): drives the tree-line part of the reflection. Call every few seconds (cheap: water vertices only); no-op without the contour. */
  setTreeCover(cover: ArrayLike<number> | null): void { this.treeCover = cover; this.refreshTrees(); }

  private refreshTrees(): void {
    const g = this.mesh?.geometry, a = g?.getAttribute('aTree') as THREE.BufferAttribute | undefined;
    if (!g || !a) return;
    const pos = g.getAttribute('position') as THREE.BufferAttribute, N = this.grid.size, c = this.treeCover;
    for (let i = 0; i < a.count; i++) a.setX(i, c ? treeNear(c, N, pos.getX(i), pos.getZ(i)) : 0);
    a.needsUpdate = true;
  }

  /** Autumn amount 0..1: the reflected tree line turns orange with the leaves. */
  set autumn(v: number) { const t = treeReflectTint(v); (this.material.uniforms.uTreeTint!.value as THREE.Color).setRGB(t[0], t[1], t[2]); }

  /** Smooth contour shoreline (Med / High; Low keeps the cheaper shader-only outline). Rebuilds the mesh when it changes. */
  setContour(on: boolean): void {
    if (on === this.contour) return;
    this.contour = on;
    this.material.defines = on ? { CONTOUR: '' } : {};
    this.material.needsUpdate = true;
    this.setLakes(this.lakes);
  }
  get contourOn(): boolean { return this.contour; }

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
        for (let k = 0; k < r.vpt; k++) { const o = (r.first + t * r.vpt + k) * 3; info[o] = speed; info[o + 1] = cl / 2; info[o + 2] = ice; }
        r.fringe.forEach((owner, fi) => { if (owner !== t) return; for (let k = 0; k < r.vpt; k++) { const o = (r.first + (r.tiles + fi) * r.vpt + k) * 3; info[o] = speed; info[o + 1] = cl / 2; info[o + 2] = ice; } });
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
      for (let v = 0; v < (r.tiles + r.fringe.length) * r.vpt; v++) this.info[(r.first + v) * 3 + 2] = e.cur;
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
