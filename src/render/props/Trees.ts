import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SUMMER_GLSL } from './treeTint';
import { PropKind, PropStore, growthFactor, surfaceHeight } from '@/world/Props';
import { CANOPY } from '@/world/TreeHeights';
import { seasonWeights } from '../Season';
import type { SeasonWeights } from '../Season';
import type { PropChunk } from '@/world/Props';
import { CHUNK_SIZE } from '@/world/Grid';
import { FOG_FRAG, FOG_PARS_FRAG, FOG_PARS_VERT, fogUniforms, fogVert } from '../Fog';
import { isPerspective } from '../view/cameraMath';
import { NEAR_CAPS } from '../lod/nearLod';
import { nearTreeGeometry } from './NearTrees';
import { advanceFade, lodSelect } from '../lodSelect';

const nearGeo = (kind: number): THREE.BufferGeometry | undefined => nearTreeGeometry(kind);

/**
 * Prop rendering. Draw-call budget (< 40 at any zoom; verified in tests/world/Props.test.ts):
 *  - one InstancedMesh per (kind, LOD level, cell); only ONE LOD level is active at a time (picked from the
 *    camera's visible world height), and only cells whose box intersects the camera frustum are visible.
 *  - cells are coarse (64 tiles for full-detail, 128 for low/billboard/rocks) so at most ~3x3 cells are
 *    on screen per kind at the zoom where their LOD is active; far zoom = 2 kinds x <=16 cells on a 256 map.
 *  - per-frame CPU is O(#cells) (box-vs-frustum); instance buffers are only rewritten when a chunk is
 *    refreshed (terraform/snow/removal) or a LOD level becomes active.
 */
export const TREE_FULL_MAX_VIEW = 28; // visible world height up to which full meshes are used
export const TREE_LOW_MAX_VIEW = 90; // up to which low-poly cones are used; beyond = billboards
export const ROCK_MAX_VIEW = 45;
/** Perspective (ride) views: camera distance (tiles) up to which trees use the full mesh / the low-poly cone; beyond = billboards. Rocks draw up to ROCK_RIDE_DIST. */
export const TREE_RIDE_FULL_DIST = 40;
/** Near (high-poly) tree band: < TREE_RIDE_NEAR_DIST tiles from a ground camera (NEAR_TILES + margin). */
export const TREE_RIDE_NEAR_DIST = 8;
/** Half-width (tiles) of the stipple cross-fade between two distance bands. */
export const TREE_FADE_W = 3;
export const TREE_RIDE_LOW_DIST = 100;
export const ROCK_RIDE_DIST = 90;
export const PROP_BUILD_BUDGET = 3; // cell (re)builds per frame
export const SNOW_FULL_DEPTH = 0.3;
const CELL_Y_MAX = 100;

export interface PropUniforms {
  uSunDir: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Color };
  uSkyColor: { value: THREE.Color };
  /** Season blend weights (x spring, y summer, z autumn, w winter; sum 1). Mutated in place, shared by all tree materials. */
  uSeason: { value: THREE.Vector4 };
}

export function createPropUniforms(sunPos?: THREE.Vector3): PropUniforms {
  return {
    uSunDir: { value: (sunPos ?? new THREE.Vector3(0.5, 1, 0.3)).clone().normalize() },
    uSunColor: { value: new THREE.Color(0.85, 0.76, 0.58) },
    uSkyColor: { value: new THREE.Color(0.46, 0.54, 0.68) },
    uSeason: { value: new THREE.Vector4(0, 1, 0, 0) }, // summer
  };
}

/** Species behaviour ids used by the season shader. */
export const SPECIES_EVERGREEN = 0, SPECIES_DECIDUOUS = 1, SPECIES_LARCH = 2;

/**
 * Season GLSL shared by mesh + billboard vertex shaders.
 * Foliage per tree is staggered by the per-instance seed h (0..1): leaf drop threshold, autumn colour and blossom all derive from it.
 * Evergreens (species 0) only get a faint spring brightening; deciduous (1) and larch (2) cycle colour and shed leaves.
 */
const SEASON_GLSL = /* glsl */ `
uniform vec4 uSeason;      // spring, summer, autumn, winter
uniform float uSpecies;    // 0 evergreen, 1 deciduous, 2 larch
uniform float uBlossom;    // fraction of trees that blossom in spring
uniform float uAutumnMax;  // 0..1 how far along yellow->orange->red the palette reaches
float leafScale(float h) {
  if (uSpecies < 0.5) return 1.0;
  float thr = 0.3 + 0.4 * h;
  float x = uSeason.w + uSeason.z * 0.5 + uSeason.x * 0.45;
  if (uSpecies > 1.5) x = uSeason.w + uSeason.z * 0.3 + uSeason.x * 0.45;
  return max(1.0 - smoothstep(thr, thr + 0.15, x), 0.001);
}
vec3 autumnPalette(float h) {
  float f = fract(h * 7.31) * uAutumnMax;
  vec3 g = vec3(0.98, 0.80, 0.12);   // gold
  vec3 a = vec3(0.98, 0.58, 0.08);   // amber
  vec3 o = vec3(0.95, 0.36, 0.06);   // orange
  vec3 r = vec3(0.80, 0.10, 0.14);   // crimson
  vec3 p = vec3(0.55, 0.16, 0.38);   // purple-ish maple
  vec3 c = mix(g, a, smoothstep(0.0, 0.25, f));
  c = mix(c, o, smoothstep(0.2, 0.45, f));
  c = mix(c, r, smoothstep(0.4, 0.7, f));
  c = mix(c, p, smoothstep(0.88, 1.0, f) * 0.4);
  return c * (0.9 + 0.3 * fract(h * 5.1));
}
${SUMMER_GLSL}
vec3 seasonColor(vec3 base, float h) {
  if (uSpecies < 0.5) return mix(base, base * vec3(1.1, 1.15, 0.9), uSeason.x * 0.4);
  // summer: broad hue spread from yellow-green to deep blue-green
  float hv = fract(h * 2.71);
  vec3 summer = summerColor(base, hv);
  vec3 fresh = mix(base, vec3(0.30, 0.62, 0.10), 0.6);
  float bl = step(1.0 - uBlossom, fract(h * 3.17));
  float k = fract(h * 11.3);
  vec3 bc = k < 0.4 ? vec3(0.98, 0.58, 0.76) : (k < 0.7 ? vec3(0.99, 0.96, 0.95) : vec3(0.78, 0.62, 0.95));
  vec3 spring = mix(fresh, bc, bl * 0.9 * smoothstep(0.55, 0.95, uSeason.x)); // blossom only in (nearly) pure spring, not in the spring/summer crossfade
  vec3 aut = autumnPalette(h);
  float sw = max(uSeason.x + uSeason.y + uSeason.z + uSeason.w, 0.001);
  return (uSeason.x * spring + uSeason.y * summer + (uSeason.z + uSeason.w) * aut) / sw;
}
`;

/**
 * Cross-fade between LOD bands (perspective views): uLodFade = (lo, hi, w). A level draws in [lo - w, hi + w); the incoming side (around lo) keeps a pixel
 * when its dither value n >= 1 - wIn, the outgoing side (around hi) when n < wOut, so the two levels have complementary stipple masks and never pop.
 * Iso: w = 0 and lo/hi = 0..1e9, so vLodW = (1, 1) and nothing is ever discarded.
 */
export const LODFADE_VERT_PARS = /* glsl */ `
uniform vec3 uLodFade;
varying vec2 vLodW;
vec2 lodFadeW(float d) {
  float w = max(uLodFade.z, 1e-4);
  float wi = uLodFade.x > 0.0 ? smoothstep(uLodFade.x - w, uLodFade.x + w, d) : 1.0;
  float wo = uLodFade.y < 1e8 ? 1.0 - smoothstep(uLodFade.y - w, uLodFade.y + w, d) : 1.0;
  return vec2(wi, wo);
}`;
export const LODFADE_FRAG_PARS = /* glsl */ `
varying vec2 vLodW;
void lodFadeDiscard() {
  float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (n < 1.0 - vLodW.x || n >= vLodW.y) discard;
}`;

/**
 * Iso LOD cross-fade (zoom crossing a level threshold): the outgoing and the incoming level draw at the same time and every INSTANCE belongs to exactly one of them,
 * decided by a stable per-instance hash of aSeed against the fade weight: uXf = (mode, w), mode 0 = off, 1 = incoming (keeps hash < w), 2 = outgoing (keeps hash >= w).
 * No screen-space noise: nothing crawls when the camera moves, and each tree swaps exactly once (mirror: instanceHash / inNewLevel in lodSelect.ts).
 */
export const XFADE_VERT_PARS = /* glsl */ `
uniform vec2 uXf;
bool xfadeDrop(float seed) {
  float h = fract(sin(seed * 91.7 + 3.1) * 43758.5453);
  return uXf.x > 0.5 && (uXf.x < 1.5 ? h >= uXf.y : h < uXf.y);
}`;

const MESH_VERT = /* glsl */ `
attribute vec4 aBase;   // rgb colour, a = foliage weight (1 = seasonal foliage, 0 = trunk/branch/rock)
attribute vec4 aTint;   // per instance: rgb jitter, a = snow cover 0..1
attribute float aSeed;  // per instance 0..1
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform float uCrownY;  // crown centre (local units): foliage shrinks towards it when leaves drop
uniform float uMoss;    // rocks: summer moss on upward faces
uniform vec2 uLodRange; // perspective views: draw only instances with camera distance in [x, y) (iso: 0..1e9)
${LODFADE_VERT_PARS}
${XFADE_VERT_PARS}
${SEASON_GLSL}
${FOG_PARS_VERT}
varying vec3 vColor;
void main() {
  mat4 im = modelMatrix * instanceMatrix;
  vec3 pos = position;
  vec3 base = aBase.rgb * aTint.rgb;
  if (aBase.a > 0.5) {
    float ls = leafScale(aSeed);
    vec3 cc = vec3(0.0, uCrownY, 0.0);
    pos = cc + (position - cc) * ls;
    base = seasonColor(base, aSeed);
    // crown shading: darker underside / lighter top, plus ambient-occlusion-like darkening at the base
    base *= (1.0 + 0.24 * clamp((position.y - uCrownY) / 0.7, -1.0, 1.0)) * mix(0.72, 1.0, smoothstep(0.1, 0.7, position.y));
  } else {
    base *= mix(0.68, 1.0, smoothstep(0.0, 0.45, position.y));
  }
  vec4 wp = im * vec4(pos, 1.0);
  vec3 n = normalize(mat3(im) * normal);
  if (uMoss > 0.0) {
    float mossSeason = uSeason.x * 0.6 + uSeason.y * 0.95 + uSeason.z * 0.5;
    float up = smoothstep(0.3, 0.75, clamp(n.y, 0.0, 1.0));
    base = mix(base, vec3(0.045, 0.12, 0.03) * (0.8 + 0.5 * fract(aSeed * 3.3)), up * mossSeason * (0.3 + 0.7 * fract(aSeed * 5.7)));
  }
  float cap = clamp(aTint.a * 1.7, 0.0, 1.0) * smoothstep(0.2, 0.64, clamp(n.y, 0.0, 1.0)); // smooth normals: a higher threshold keeps the tier / lobe structure readable under snow
  base = mix(base, vec3(0.92, 0.95, 1.0), cap);
  float ndl = max(dot(n, uSunDir), 0.0);
  vColor = base * (uSkyColor + uSunColor * ndl);
  vec4 vp = viewMatrix * wp;
  ${fogVert('vp')}
  gl_Position = projectionMatrix * vp;
  float dCam = distance(cameraPosition, wp.xyz);
  if (dCam < uLodRange.x || dCam >= uLodRange.y || xfadeDrop(aSeed)) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vLodW = lodFadeW(dCam);
}`;

const MESH_FRAG = /* glsl */ `
${FOG_PARS_FRAG}
${LODFADE_FRAG_PARS}
varying vec3 vColor;
void main() {
  lodFadeDiscard();
  gl_FragColor = vec4(vColor, 1.0);
  ${FOG_FRAG}
  #include <colorspace_fragment>
}`;

const ATLAS_STATES = 3; // normal, snow, bare
const BB_VERT = /* glsl */ `
attribute vec4 aTint;
attribute float aSeed;
uniform float uSlot;     // species column in the atlas
uniform float uSlots;    // number of species columns
uniform vec2 uSize;      // billboard width/height at instance scale 1
uniform vec3 uLeaf;      // base foliage colour (atlas is painted with it)
uniform vec2 uLodRange;
${LODFADE_VERT_PARS}
${XFADE_VERT_PARS}
${SEASON_GLSL}
${FOG_PARS_VERT}
varying vec2 vUv;
varying vec3 vTint;
void main() {
  mat4 im = modelMatrix * instanceMatrix;
  vec3 c = im[3].xyz;
  float sc = length(im[0].xyz);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  right.y = 0.0;
  right = normalize(right);
  vec3 wp = c + right * (position.x * uSize.x * sc) + vec3(0.0, 1.0, 0.0) * (position.y * uSize.y * sc);
  float snow = step(0.3, aTint.a);
  float ls = leafScale(aSeed);
  float bare = (uSpecies > 0.5 && ls < 0.5) ? 1.0 : 0.0;
  float state = bare > 0.5 ? 2.0 : snow;
  vUv = vec2((uSlot * ${ATLAS_STATES}.0 + state + uv.x) / (uSlots * ${ATLAS_STATES}.0), uv.y);
  vec3 seasonal = bare > 0.5 ? vec3(1.0) : seasonColor(uLeaf, aSeed) / uLeaf;
  vTint = aTint.rgb * seasonal * 0.9;
  vec4 vp = viewMatrix * vec4(wp, 1.0);
  ${fogVert('vp')}
  gl_Position = projectionMatrix * vp;
  float dCam = distance(cameraPosition, wp);
  if (dCam < uLodRange.x || dCam >= uLodRange.y || xfadeDrop(aSeed)) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vLodW = lodFadeW(dCam);
}`;

const BB_FRAG = /* glsl */ `
${FOG_PARS_FRAG}
${LODFADE_FRAG_PARS}
uniform sampler2D tAtlas;
varying vec2 vUv;
varying vec3 vTint;
void main() {
  lodFadeDiscard();
  vec4 t = texture2D(tAtlas, vUv);
  if (t.a < 0.5) discard;
  gl_FragColor = vec4(t.rgb * vTint, 1.0);
  ${FOG_FRAG}
  #include <colorspace_fragment>
}`;

// ---------- geometry ----------

/**
 * Minimum world thickness (diameter) of any non-foliage prop part (branch tip, twig, post, rail, pole ...). At the default iso zoom 1 tile is ~40-60 px,
 * so 0.03 units = 1.2-1.8 px: thinner parts alias and shimmer when the camera rotates (docs/flicker.md, cause 5). `tests/render/softLook.test.ts` guards it.
 */
export const MIN_PART_THICKNESS = 0.03;

export interface Part {
  geo: THREE.BufferGeometry; color: THREE.Color; foliage: number;
  /** Weld coincident vertices and average their normals (rounded, lumpy crowns); default: flat facets. */
  smooth?: boolean;
  /** Declared minimum thickness (diameter) of a tube-like part, checked by the thickness guard. */
  minThick?: number;
}

/** Merge parts into one non-indexed geometry with aBase colour attribute (flat facets, or smooth normals for `smooth` parts). `userData.minThick` = thinnest declared tube. */
export function mergeParts(parts: Part[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], col: number[] = [];
  let minThick = Infinity;
  for (const p of parts) {
    let g: THREE.BufferGeometry;
    if (p.smooth) {
      const w = new THREE.BufferGeometry();
      const src = p.geo.index ? p.geo.toNonIndexed() : p.geo;
      w.setAttribute('position', src.getAttribute('position').clone());
      g = mergeVertices(w, 1e-4);
      g.computeVertexNormals();
      g = g.toNonIndexed();
      if (src !== p.geo) src.dispose();
      w.dispose();
    } else {
      g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
      g.deleteAttribute('normal');
      g.computeVertexNormals();
    }
    if (p.minThick !== undefined) minThick = Math.min(minThick, p.minThick);
    const pa = g.getAttribute('position'), na = g.getAttribute('normal');
    for (let i = 0; i < pa.count; i++) {
      pos.push(pa.getX(i), pa.getY(i), pa.getZ(i));
      nor.push(na.getX(i), na.getY(i), na.getZ(i));
      col.push(p.color.r, p.color.g, p.color.b, p.foliage);
    }
    g.dispose();
    p.geo.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('aBase', new THREE.Float32BufferAttribute(col, 4));
  out.userData.minThick = minThick;
  return out;
}

const TRUNK = new THREE.Color(0x5a4030);
const BIRCH_TRUNK = new THREE.Color(0xe6e2d6);
const SNAG_TRUNK = new THREE.Color(0x6e665e);
const PINE = new THREE.Color(0x2f6b3a);
const PINE_TALL = new THREE.Color(0x3f7440);
const LARCH = new THREE.Color(0x6f9a3c);
const LEAF = new THREE.Color(0x5b8c3a);
const BIRCH_LEAF = new THREE.Color(0x93b955);
const OAK_LEAF = new THREE.Color(0x4a7a2c);
const SHRUB_LEAF = new THREE.Color(0x4d8035);

/**
 * Shrink a tree mesh uniformly (only when too big) so its bounding box stays inside the sim's canopy table (`world/TreeHeights.ts`: lift clearance and planting
 * rules read it and are part of the deterministic sim, so the rounder crowns must fit it, not the other way round).
 */
function fit(g: THREE.BufferGeometry, kind: number): THREE.BufferGeometry {
  const c = CANOPY[kind];
  if (!c) return g;
  g.computeBoundingBox();
  const b = g.boundingBox!, r = Math.max(b.max.x, -b.min.x, b.max.z, -b.min.z);
  const kr = Math.min(1, (c.radius + 0.01) / r), kh = Math.min(1, c.height / b.max.y);
  if (kr < 1 || kh < 1) g.scale(kr, kh, kr);
  g.computeBoundingBox();
  return g;
}

/** Deterministic hash in [0,1) of a position (shared vertices of a welded mesh move together). */
export function hash3(x: number, y: number, z: number, k: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + k * 19.19) * 43758.5453;
  return h - Math.floor(h);
}

/**
 * Drooping, scalloped conifer tier: apex -> shoulder ring -> hem ring (`seg` radial segments, per-vertex radius noise, every other hem vertex hangs lower).
 * `skirt` adds the shoulder ring (more rounded profile, 3 x seg triangles instead of seg). Returns the smooth-shaded sides and, when `cap`, the flat underside.
 */
export function tier(r: number, h: number, y: number, seg: number, k: number, skirt = true, cap = false): Part[] {
  const pos: number[] = [0, y + h, 0];
  const idx: number[] = [];
  const nRings = skirt ? 2 : 1;
  const ringStart = (ri: number): number => 1 + ri * seg;
  for (let ri = 0; ri < nRings; ri++) {
    const last = ri === nRings - 1;
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const noise = 1 + (hash3(i, k, ri, 7) - 0.5) * 0.2;
      const sc = last ? (i % 2 ? 1.08 : 0.97) : 0.74;
      const rr = r * noise * sc * (last ? 1 : 1);
      const yy = last ? y - (i % 2 ? 0.07 : 0.0) * h : y + h * 0.3;
      pos.push(Math.cos(a) * rr, yy, Math.sin(a) * rr);
    }
  }
  for (let i = 0; i < seg; i++) idx.push(0, ringStart(0) + ((i + 1) % seg), ringStart(0) + i);
  if (skirt) {
    for (let i = 0; i < seg; i++) {
      const a = ringStart(0) + i, b = ringStart(0) + ((i + 1) % seg), c = ringStart(1) + i, d = ringStart(1) + ((i + 1) % seg);
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const out: Part[] = [{ geo: g, color: PINE, foliage: 1, smooth: true }];
  if (cap) {
    const hem = ringStart(nRings - 1);
    const cp: number[] = [], ci: number[] = [];
    cp.push(0, y, 0);
    for (let i = 0; i < seg; i++) cp.push(pos[(hem + i) * 3]!, pos[(hem + i) * 3 + 1]!, pos[(hem + i) * 3 + 2]!);
    for (let i = 0; i < seg; i++) ci.push(0, 1 + i, 1 + ((i + 1) % seg));
    const c = new THREE.BufferGeometry();
    c.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
    c.setIndex(ci);
    out.push({ geo: c, color: PINE, foliage: 1 });
  }
  return out;
}
function tiers(list: Array<[r: number, h: number, y: number]>, seg: number, color: THREE.Color, skirt: boolean, kBase: number, capLast = false): Part[] {
  const out: Part[] = [];
  list.forEach(([r, h, y], i) => { for (const p of tier(r, h, y, seg, kBase + i, skirt, capLast && i === 0)) out.push({ ...p, color }); });
  return out;
}
function trunk(r0: number, r1: number, h: number, open = true): Part {
  // tapered, 6 radial segments; r0 (top) >= 0.5 * MIN_PART_THICKNESS
  const top = Math.max(r0, MIN_PART_THICKNESS / 2 + 0.005);
  return { geo: new THREE.CylinderGeometry(top, r1, h, 6, 1, open).translate(0, h / 2, 0), color: TRUNK, foliage: 0, minThick: top * 2 };
}
function withColor(p: Part, c: THREE.Color): Part { return { ...p, color: c }; }
/** Branch starting at (0,y,0), tilted `tilt` rad from vertical, azimuth `az`: tip diameter >= MIN_PART_THICKNESS (4 radial segments). */
function branch(y: number, len: number, tilt: number, az: number): { geo: THREE.BufferGeometry; thick: number } {
  const rt = MIN_PART_THICKNESS / 2 + 0.008;
  const g = new THREE.CylinderGeometry(rt, rt * 2, len, 4, 1, true).translate(0, len / 2, 0);
  g.rotateZ(-tilt);
  g.rotateY(az);
  return { geo: g.translate(0, y, 0), thick: rt * 2 };
}
function branches(y: number, len: number, tilt: number, n: number, color: THREE.Color, phase = 0): Part[] {
  const out: Part[] = [];
  for (let i = 0; i < n; i++) {
    const b = branch(y + (i % 2) * 0.12, len * 0.85, tilt + (i % 3) * 0.12, phase + (i / n) * Math.PI * 2);
    out.push({ geo: b.geo, color, foliage: 0, minThick: b.thick });
  }
  return out;
}
/** Lumpy ellipsoid lobe: icosphere with per-vertex radial noise (position hashed, so welded vertices stay together), smooth-shaded. */
function lobe(r: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, detail: number, k: number, amp = 0.14): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const px = p.getX(i), py = p.getY(i), pz = p.getZ(i);
    const f = 1 + (hash3(Math.round(px * 400) / 400, Math.round(py * 400) / 400, Math.round(pz * 400) / 400, k) - 0.5) * 2 * amp;
    p.setXYZ(i, px * f, py * f, pz * f);
  }
  return g.scale(sx, sy, sz).translate(x, y, z);
}
type Lobe = [r: number, x: number, y: number, z: number, sx: number, sy: number, sz: number];
/** Crown = cluster of overlapping lobes (3-5), smooth normals + vertex noise. */
function crown(lobes: Lobe[], color: THREE.Color, detail: number, k: number): Part[] {
  return lobes.map(([r, x, y, z, sx, sy, sz], i) => ({ geo: lobe(r, x, y, z, sx, sy, sz, detail, k + i), color, foliage: 1, smooth: true }));
}

const DECID_LOBES: Lobe[] = [[0.44, 0, 1.02, 0, 1, 0.95, 1], [0.32, 0.3, 0.86, 0.14, 1, 0.9, 1], [0.3, -0.28, 0.94, -0.12, 1, 0.9, 1], [0.27, 0.02, 1.3, -0.12, 1, 0.9, 1]];
const BIRCH_LOBES: Lobe[] = [[0.27, 0, 1.45, 0, 1, 1.35, 1], [0.2, 0.12, 1.05, 0.06, 1, 1.1, 1], [0.18, -0.12, 1.2, -0.05, 1, 1.1, 1]];
const OAK_LOBES: Lobe[] = [[0.42, 0, 0.98, 0, 1.45, 0.82, 1.45], [0.3, 0.42, 0.82, 0.22, 1.2, 0.85, 1.2], [0.28, -0.4, 0.86, -0.2, 1.2, 0.85, 1.2], [0.24, 0.05, 1.2, 0.05, 1.2, 0.8, 1.2]];

export function conifer(full: boolean): THREE.BufferGeometry {
  if (!full) {
    return fit(mergeParts(tiers([[0.52, 1.25, 0.2], [0.3, 1.0, 1.2]], 7, PINE, false, 10)), PropKind.Conifer);
  }
  return fit(mergeParts([
    trunk(0.07, 0.1, 0.45),
    ...tiers([[0.56, 0.8, 0.3], [0.5, 0.74, 0.66], [0.42, 0.66, 1.0], [0.33, 0.58, 1.36], [0.22, 0.56, 1.72]], 10, PINE, false, 20, true),
  ]), PropKind.Conifer);
}

export function deciduous(full: boolean): THREE.BufferGeometry {
  if (!full) return fit(mergeParts([trunk(0.07, 0.1, 0.7), ...crown([DECID_LOBES[0]!, DECID_LOBES[2]!], LEAF, 0, 30)]), PropKind.Deciduous);
  return fit(mergeParts([trunk(0.07, 0.1, 0.8), ...crown(DECID_LOBES, LEAF, 0, 30), ...branches(0.6, 0.5, 0.7, 5, TRUNK)]), PropKind.Deciduous);
}

/** Tall pine: long bare trunk, layered tufts. */
export function pine(full: boolean): THREE.BufferGeometry {
  if (!full) return fit(mergeParts([trunk(0.06, 0.09, 1.2), ...tiers([[0.42, 0.7, 1.1], [0.28, 0.6, 1.6]], 6, PINE_TALL, false, 40)]), PropKind.Pine);
  return fit(mergeParts([
    trunk(0.05, 0.09, 1.7),
    ...tiers([[0.46, 0.5, 0.9], [0.4, 0.46, 1.25], [0.33, 0.44, 1.6], [0.25, 0.42, 1.9], [0.16, 0.44, 2.15]], 8, PINE_TALL, false, 50, true),
  ]), PropKind.Pine);
}

/** Larch/fir: slender, light needles; gold in autumn, bare in winter (shows trunk + twigs). */
export function larch(full: boolean): THREE.BufferGeometry {
  if (!full) return fit(mergeParts([trunk(0.05, 0.07, 0.6), ...tiers([[0.38, 1.0, 0.3], [0.24, 0.9, 0.9]], 6, LARCH, false, 60)]), PropKind.Larch);
  return fit(mergeParts([
    trunk(0.05, 0.08, 1.9),
    ...tiers([[0.38, 0.7, 0.4], [0.33, 0.62, 0.8], [0.27, 0.58, 1.15], [0.2, 0.55, 1.5], [0.11, 0.5, 1.9]], 8, LARCH, false, 70, true),
    ...branches(0.5, 0.35, 1.0, 4, TRUNK),
    ...branches(1.0, 0.28, 1.0, 4, TRUNK, 0.6),
  ]), PropKind.Larch);
}

/** Birch: white trunk, light lumpy crown. */
export function birch(full: boolean): THREE.BufferGeometry {
  const t = trunk(0.045, 0.07, full ? 1.3 : 1.1);
  const bt = withColor(t, BIRCH_TRUNK);
  if (!full) return fit(mergeParts([bt, ...crown(BIRCH_LOBES.slice(0, 2), BIRCH_LEAF, 0, 80)]), PropKind.Birch);
  return fit(mergeParts([bt, ...crown(BIRCH_LOBES, BIRCH_LEAF, 0, 80), ...branches(0.8, 0.4, 0.55, 4, BIRCH_TRUNK)]), PropKind.Birch);
}

/** Oak: short thick trunk, wide lumpy crown. */
export function oak(full: boolean): THREE.BufferGeometry {
  if (!full) {
    return fit(mergeParts([trunk(0.1, 0.14, 0.6), ...crown([OAK_LOBES[0]!, OAK_LOBES[1]!], OAK_LEAF, 0, 90)]), PropKind.Oak);
  }
  return fit(mergeParts([trunk(0.1, 0.16, 0.65), ...crown(OAK_LOBES, OAK_LEAF, 0, 90), ...branches(0.55, 0.7, 1.0, 6, TRUNK)]), PropKind.Oak);
}

export function shrub(full: boolean): THREE.BufferGeometry {
  const lobes: Lobe[] = [[0.26, 0, 0.22, 0, 1.1, 0.75, 1.1], [0.2, 0.2, 0.18, 0.12, 1, 0.8, 1], [0.18, -0.18, 0.17, -0.1, 1, 0.8, 1]];
  const parts: Part[] = crown(full ? lobes : lobes.slice(0, 2), SHRUB_LEAF, 0, 100);
  parts.push(...branches(0.02, 0.35, 0.5, full ? 5 : 2, TRUNK));
  return fit(mergeParts(parts), PropKind.Shrub);
}

/** Dead tree: grey trunk with bare limbs, no foliage. */
export function snag(full: boolean): THREE.BufferGeometry {
  const parts: Part[] = [withColor(trunk(0.05, 0.1, 1.6, false), SNAG_TRUNK)];
  parts.push(...branches(1.0, 0.45, 0.9, full ? 5 : 2, SNAG_TRUNK));
  if (full) parts.push(...branches(1.4, 0.3, 0.7, 3, SNAG_TRUNK, 1));
  return fit(mergeParts(parts), PropKind.Snag);
}

export function billboardQuad(): THREE.BufferGeometry {
  return new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
}

// ---------- species table ----------

/** Impostor drawing recipe in tree-local units (x centred, y up from the ground; same space as the meshes). */
interface Recipe {
  trunk: [w: number, h: number, color: string];
  tiers?: Array<[r: number, y: number, h: number]>;
  blobs?: Array<[cx: number, cy: number, rx: number, ry: number]>;
  /** Bare branches [x0,y0,x1,y1] drawn in the bare state (and for snags always). */
  twigs: Array<[number, number, number, number]>;
  leaf: string;
}

export interface TreeSpecies {
  kind: number;
  slot: number;
  species: number;
  crownY: number;
  blossom: number;
  autumnMax: number;
  leaf: THREE.Color;
  full: () => THREE.BufferGeometry;
  low: () => THREE.BufferGeometry;
  size: [number, number];
  recipe: Recipe;
}

/** Tree-ish species in atlas order. Rocks are not here. */
export const TREE_SPECIES: TreeSpecies[] = [
  { kind: PropKind.Conifer, slot: 0, species: SPECIES_EVERGREEN, crownY: 1, blossom: 0, autumnMax: 1, leaf: PINE, full: () => conifer(true), low: () => conifer(false), size: [1.15, 2.3],
    recipe: { trunk: [0.1, 0.45, '#5a4030'], tiers: [[0.56, 0.3, 0.8], [0.5, 0.66, 0.74], [0.42, 1.0, 0.66], [0.33, 1.36, 0.58], [0.22, 1.72, 0.56]], twigs: [], leaf: '#2f6b3a' } },
  { kind: PropKind.Deciduous, slot: 1, species: SPECIES_DECIDUOUS, crownY: 1.0, blossom: 0.6, autumnMax: 1, leaf: LEAF, full: () => deciduous(true), low: () => deciduous(false), size: [1.1, 1.6],
    recipe: { trunk: [0.12, 0.8, '#5a4030'], blobs: [[0, 1.02, 0.44, 0.42], [0.3, 0.86, 0.32, 0.29], [-0.28, 0.94, 0.3, 0.27], [0.02, 1.3, 0.27, 0.25]], twigs: [[0, 0.6, -0.4, 1.0], [0, 0.6, 0.4, 1.05], [0, 0.7, 0, 1.3], [0, 0.65, -0.2, 1.2]], leaf: '#5b8c3a' } },
  { kind: PropKind.Pine, slot: 2, species: SPECIES_EVERGREEN, crownY: 1.5, blossom: 0, autumnMax: 1, leaf: PINE_TALL, full: () => pine(true), low: () => pine(false), size: [0.95, 2.6],
    recipe: { trunk: [0.09, 1.7, '#5a4030'], tiers: [[0.46, 0.9, 0.5], [0.4, 1.25, 0.46], [0.33, 1.6, 0.44], [0.25, 1.9, 0.42], [0.16, 2.15, 0.44]], twigs: [], leaf: '#3f7440' } },
  { kind: PropKind.Larch, slot: 3, species: SPECIES_LARCH, crownY: 1.2, blossom: 0, autumnMax: 0.3, leaf: LARCH, full: () => larch(true), low: () => larch(false), size: [0.8, 2.4],
    recipe: { trunk: [0.08, 1.9, '#5a4030'], tiers: [[0.38, 0.4, 0.7], [0.33, 0.8, 0.62], [0.27, 1.15, 0.58], [0.2, 1.5, 0.55], [0.11, 1.9, 0.5]], twigs: [[0, 0.5, -0.3, 0.8], [0, 0.5, 0.3, 0.8], [0, 1.0, -0.25, 1.3], [0, 1.0, 0.25, 1.3]], leaf: '#6f9a3c' } },
  { kind: PropKind.Birch, slot: 4, species: SPECIES_DECIDUOUS, crownY: 1.3, blossom: 0.35, autumnMax: 0.45, leaf: BIRCH_LEAF, full: () => birch(true), low: () => birch(false), size: [0.8, 1.9],
    recipe: { trunk: [0.08, 1.3, '#e6e2d6'], blobs: [[0, 1.45, 0.27, 0.365], [0.12, 1.05, 0.2, 0.22], [-0.12, 1.2, 0.18, 0.2]], twigs: [[0, 0.8, -0.3, 1.2], [0, 0.8, 0.3, 1.2], [0, 1.1, 0, 1.7]], leaf: '#93b955' } },
  { kind: PropKind.Oak, slot: 5, species: SPECIES_DECIDUOUS, crownY: 0.95, blossom: 0.3, autumnMax: 0.8, leaf: OAK_LEAF, full: () => oak(true), low: () => oak(false), size: [1.7, 1.5],
    recipe: { trunk: [0.18, 0.65, '#5a4030'], blobs: [[0, 0.98, 0.61, 0.34], [0.42, 0.82, 0.36, 0.26], [-0.4, 0.86, 0.34, 0.24], [0.05, 1.2, 0.29, 0.19]], twigs: [[0, 0.55, -0.6, 1.0], [0, 0.55, 0.6, 1.0], [0, 0.6, 0, 1.3], [0, 0.55, 0.4, 1.2]], leaf: '#4a7a2c' } },
  { kind: PropKind.Shrub, slot: 6, species: SPECIES_DECIDUOUS, crownY: 0.22, blossom: 0.5, autumnMax: 1, leaf: SHRUB_LEAF, full: () => shrub(true), low: () => shrub(false), size: [0.8, 0.6],
    recipe: { trunk: [0.03, 0.05, '#5a4030'], blobs: [[0, 0.22, 0.29, 0.2], [0.2, 0.18, 0.2, 0.16], [-0.18, 0.17, 0.18, 0.14]], twigs: [[0, 0.02, -0.3, 0.4], [0, 0.02, 0.3, 0.4], [0, 0.02, 0, 0.45]], leaf: '#4d8035' } },
  { kind: PropKind.Snag, slot: 7, species: SPECIES_EVERGREEN, crownY: 1, blossom: 0, autumnMax: 1, leaf: SNAG_TRUNK, full: () => snag(true), low: () => snag(false), size: [0.9, 1.7],
    recipe: { trunk: [0.1, 1.6, '#6e665e'], twigs: [[0, 1.0, -0.4, 1.4], [0, 1.0, 0.4, 1.35], [0, 1.4, 0.25, 1.65], [0, 1.2, -0.3, 1.55]], leaf: '#6e665e' } },
];

// ---------- impostor atlas ----------

/** Atlas: TREE_SPECIES.length columns x (normal, snow, bare) cells, each 64x128. Generated once at startup on a canvas. */
export function createImpostorAtlas(): THREE.Texture {
  const W = 64, H = 128, S = TREE_SPECIES.length;
  let tex: THREE.Texture;
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  const ctx = canvas && typeof canvas.getContext === 'function' ? safeCtx(canvas) : null;
  if (!canvas || !ctx) {
    tex = new THREE.Texture();
  } else {
    canvas.width = W * S * ATLAS_STATES;
    canvas.height = H;
    for (const sp of TREE_SPECIES) {
      for (let state = 0; state < ATLAS_STATES; state++) {
        const [w, h] = sp.size;
        ctx.save();
        // tree-local units: origin at bottom centre of the cell, y up; matches the mesh dimensions
        ctx.translate((sp.slot * ATLAS_STATES + state) * W + W / 2, H);
        ctx.scale(W / w, -H / h);
        drawRecipe(ctx, sp.recipe, state === 1, state === 2 || sp.kind === PropKind.Snag);
        ctx.restore();
      }
    }
    tex = new THREE.CanvasTexture(canvas);
  }
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function drawRecipe(ctx: CanvasRenderingContext2D, r: Recipe, snow: boolean, bare: boolean): void {
  ctx.fillStyle = r.trunk[2];
  ctx.fillRect(-r.trunk[0] / 2, 0, r.trunk[0], r.trunk[1]);
  if (bare) {
    ctx.strokeStyle = r.trunk[2];
    ctx.lineWidth = 0.065;
    ctx.lineCap = 'round';
    for (const [x0, y0, x1, y1] of r.twigs) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); }
    return;
  }
  ctx.fillStyle = r.leaf;
  if (r.tiers) {
    for (const [rad, y, h] of r.tiers) {
      tri(ctx, 0, y, rad, y + h);
      if (snow) { ctx.fillStyle = '#eef3fb'; tri(ctx, 0, y + h * 0.55, rad * 0.55, y + h); ctx.fillStyle = r.leaf; }
    }
  }
  if (r.blobs) {
    for (const [cx, cy, rx, ry] of r.blobs) {
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
      if (snow) { ctx.fillStyle = '#eef3fb'; ctx.beginPath(); ctx.ellipse(cx, cy + ry * 0.25, rx * 0.7, ry * 0.7, 0, 0, Math.PI); ctx.fill(); ctx.fillStyle = r.leaf; }
    }
  }
}

function safeCtx(c: HTMLCanvasElement): CanvasRenderingContext2D | null {
  try { return c.getContext('2d'); } catch { return null; }
}

/** Drooping tier silhouette: apex at y=top, shoulders, scalloped hem around y=base (half-width hw), in local units. */
function tri(ctx: CanvasRenderingContext2D, cx: number, base: number, hw: number, top: number): void {
  const n = 3, h = top - base, sh = base + h * 0.3;
  ctx.beginPath();
  ctx.moveTo(cx, top);
  ctx.lineTo(cx + hw * 0.76, sh);
  ctx.quadraticCurveTo(cx + hw * 1.06, base + h * 0.05, cx + hw, base - h * 0.02);
  for (let i = 0; i < n; i++) {
    const x0 = cx + hw - (2 * hw * i) / n, x1 = cx + hw - (2 * hw * (i + 1)) / n;
    ctx.quadraticCurveTo((x0 + x1) / 2, base - h * 0.14, x1, base - h * 0.02);
  }
  ctx.quadraticCurveTo(cx - hw * 1.06, base + h * 0.05, cx - hw * 0.76, sh);
  ctx.closePath(); ctx.fill();
}

export function createMeshMaterial(u: PropUniforms, sp?: TreeSpecies): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: MESH_VERT,
    fragmentShader: MESH_FRAG,
    uniforms: {
      ...u,
      uSpecies: { value: sp?.species ?? SPECIES_EVERGREEN },
      uBlossom: { value: sp?.blossom ?? 0 },
      uAutumnMax: { value: sp?.autumnMax ?? 1 },
      uCrownY: { value: sp?.crownY ?? 1 },
      uMoss: { value: 0 },
      ...fogUniforms,
      uLodRange: { value: new THREE.Vector2(0, 1e9) },
      uLodFade: { value: new THREE.Vector3(0, 1e9, 0) },
      uXf: { value: new THREE.Vector2(0, 0) },
    },
  });
}

export function createBillboardMaterial(u: PropUniforms, atlas: THREE.Texture, sp: TreeSpecies): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: BB_VERT,
    fragmentShader: BB_FRAG,
    side: THREE.DoubleSide,
    uniforms: {
      tAtlas: { value: atlas },
      uSlot: { value: sp.slot },
      uSlots: { value: TREE_SPECIES.length },
      uSize: { value: new THREE.Vector2(sp.size[0], sp.size[1]) },
      uLeaf: { value: sp.leaf.clone() },
      uSeason: u.uSeason,
      uSpecies: { value: sp.species },
      uBlossom: { value: sp.blossom },
      uAutumnMax: { value: sp.autumnMax },
      ...fogUniforms,
      uLodRange: { value: new THREE.Vector2(0, 1e9) },
      uLodFade: { value: new THREE.Vector3(0, 1e9, 0) },
      uXf: { value: new THREE.Vector2(0, 0) },
    },
  });
}

// ---------- layered instancing ----------

export interface LodLevel {
  /** Active while visible world height <= maxView. */
  maxView: number;
  /** Perspective views: camera-distance band (tiles) in which this level draws (undefined = [0, Infinity)). */
  band?: [number, number];
  /** Ride views only (never chosen in iso): finer cells so the distance band also culls instances (vertex cost) instead of only discarding them in the shader. */
  perspectiveOnly?: boolean;
  /** Iso-only level (coarse cells): hidden while a perspective camera is active. */
  skipInPerspective?: boolean;
  /** Max instances written per cell (near levels): bounds vertex cost; extra props simply use the other bands. */
  maxPerCell?: number;
  /** Cell edge in chunks (cell = groupChunks x groupChunks chunks). */
  groupChunks: number;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** Instance scale multiplier (billboards pre-scaled by size uniform instead, so 1). */
  scaleMul?: number;
}

interface Cell {
  mesh: THREE.InstancedMesh | null;
  cap: number;
  stale: 0 | 1 | 2; // 1 = tint only (snow), 2 = full
  box: THREE.Box3;
  cx0: number; cy0: number; cx1: number; cy1: number; // chunk ranges inclusive
  /** Capped level whose cell has more props than the cap: instances are the NEAREST ones to the camera at `bx,bz` (rebuilt when the camera moves). */
  over?: boolean; bx?: number; bz?: number;
}

interface LevelState { spec: LodLevel; cells: Cell[]; perRow: number }

export class InstancedLayer {
  readonly group = new THREE.Group();
  private readonly levels: LevelState[] = [];
  private readonly cpr: number;
  private active = -1;
  private readonly frustum = new THREE.Frustum();
  private readonly pv = new THREE.Matrix4();
  rebuilds = 0;
  /** Graphics quality: LOD switch distances scale (viewHeight / lodScale) and the fraction of instances drawn. */
  private lodScale = 1;
  private density = 1;
  // update() is skipped while nothing changed (static camera, no stale cells): the per-frame cell loops are then pure overhead.
  private needsPass = true;
  private lastPv = new Float64Array(16);
  private lastLvl = -2;
  /** Number of per-frame passes actually executed (diagnostics / tests). */
  passes = 0;

  constructor(private readonly store: PropStore, private readonly kind: number, specs: LodLevel[]) {
    this.cpr = store.chunksPerRow;
    for (const spec of specs) {
      const g = Math.min(spec.groupChunks, this.cpr);
      const perRow = Math.ceil(this.cpr / g);
      const cells: Cell[] = [];
      for (let j = 0; j < perRow; j++) {
        for (let i = 0; i < perRow; i++) {
          const cx0 = i * g, cy0 = j * g;
          const cx1 = Math.min(this.cpr - 1, cx0 + g - 1), cy1 = Math.min(this.cpr - 1, cy0 + g - 1);
          cells.push({
            mesh: null, cap: 0, stale: 2, cx0, cy0, cx1, cy1,
            box: new THREE.Box3(
              new THREE.Vector3(cx0 * CHUNK_SIZE, -3, cy0 * CHUNK_SIZE),
              new THREE.Vector3((cx1 + 1) * CHUNK_SIZE, CELL_Y_MAX, (cy1 + 1) * CHUNK_SIZE),
            ),
          });
        }
      }
      this.levels.push({ spec: { ...spec, groupChunks: g }, cells, perRow });
    }
  }

  /** Index of the LOD level used for a given visible world height (-1 never; layer hidden). */
  levelFor(viewHeight: number): number {
    const vh = viewHeight / this.lodScale;
    for (let i = 0; i < this.levels.length; i++) if (vh <= this.levels[i]!.spec.maxView) return i;
    return -1;
  }

  /** LOD distance multiplier (> 1 keeps detailed meshes up to a higher zoom-out). */
  setLodScale(scale: number): void { this.lodScale = Math.max(0.1, scale); this.needsPass = true; }

  /** Fraction (0..1) of instances drawn; deterministic per instance (by seed), rewrites the buffers of every cell. */
  setDensity(d: number): void {
    const v = Math.max(0, Math.min(1, d));
    if (v === this.density) return;
    this.density = v;
    for (const lv of this.levels) for (const c of lv.cells) c.stale = 2;
    this.needsPass = true;
  }
  private keep(seed: number): boolean { return this.density >= 1 || (seed * 0.6180339887 % 1) < this.density; }

  /** Mark a chunk (index cy*chunksPerRow+cx) stale after terraform/removal; snowOnly rewrites tint only. */
  refreshChunk(chunkIdx: number, snowOnly = false): void {
    const cx = chunkIdx % this.cpr, cy = Math.floor(chunkIdx / this.cpr);
    for (const lv of this.levels) {
      const g = lv.spec.groupChunks;
      const cell = lv.cells[Math.floor(cy / g) * lv.perRow + Math.floor(cx / g)]!;
      const want = snowOnly ? 1 : 2;
      if (cell.stale < want) cell.stale = want;
    }
    this.needsPass = true;
  }

  refreshChunks(idxs: Iterable<number>, snowOnly = false): void {
    for (const i of idxs) this.refreshChunk(i, snowOnly);
  }

  /** Number of stale cells in the active level (for tests/diagnostics). */
  staleCount(level: number): number {
    return this.levels[level]!.cells.filter((c) => c.stale).length;
  }

  setFrustum(camera: THREE.Camera): void {
    this.pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pv);
  }

  private perspective = false;
  private camX = 0; private camZ = 0;
  /**
   * Change the instance cap of the capped (near) levels at runtime (graphics quality); cells rebuild. With cap 0 the near level is off and the level that
   * starts where it ends (the standard mesh) takes over from distance 0, so nothing disappears next to the camera.
   */
  setNearCap(n: number): void {
    for (let li = 0; li < this.levels.length; li++) {
      const lv = this.levels[li]!;
      if (lv.spec.maxPerCell === undefined || lv.spec.band === undefined) continue;
      if (lv.spec.maxPerCell !== n) { lv.spec.maxPerCell = n; for (const c of lv.cells) { c.stale = 2; c.over = undefined; } }
      const hi = lv.spec.band[1];
      const next = this.levels.find((o) => o !== lv && o.spec.maxPerCell === undefined && !o.spec.skipInPerspective && o.spec.band && (o.spec.band[0] === hi || (o.spec.band[0] === 0 && o.spec.band[1] > hi)));
      if (next?.spec.band) next.spec.band[0] = n === 0 ? 0 : hi;
    }
    this.nearUniformsDirty();
    this.needsPass = true;
  }

  private nearUniformsDirty(): void { if (this.perspective) { this.perspective = false; this.setPerspective(true); } }

  /** Switch the layer between the orthographic single-level LOD and the perspective distance bands (see LodLevel.band). */
  private setPerspective(on: boolean): void {
    if (on === this.perspective) return;
    this.perspective = on;
    for (const lv of this.levels) {
      const uni = (lv.spec.material as THREE.ShaderMaterial).uniforms;
      const u = uni?.uLodRange as THREE.IUniform<THREE.Vector2> | undefined;
      const uf = uni?.uLodFade as THREE.IUniform<THREE.Vector3> | undefined;
      if (u) {
        const b: [number, number] = on ? lv.spec.band ?? [0, 1e9] : [0, 1e9];
        const hi = b[1] === Infinity ? 1e9 : b[1], w = on && lv.spec.band ? TREE_FADE_W : 0;
        u.value.set(Math.max(0, b[0] - w), hi >= 1e8 ? hi : hi + w);
        uf?.value.set(b[0], hi, w);
      }
      if (!on) for (const c of lv.cells) if (c.mesh) c.mesh.visible = false;
    }
    this.needsPass = true; this.lastLvl = -2; this.active = -1;
  }

  /** Perspective pass: every level draws its distance band at once (cells outside the frustum or entirely beyond the band are hidden). */
  private updatePerspective(camera: THREE.Camera, budget: number): void {
    const cp = camera.position;
    this.camX = cp.x; this.camZ = cp.z;
    this.passes++;
    for (const lv of this.levels) {
      if (lv.spec.skipInPerspective) { for (const cell of lv.cells) if (cell.mesh) cell.mesh.visible = false; continue; }
      const band = lv.spec.band ?? [0, Infinity];
      for (const cell of lv.cells) {
        const vis = this.frustum.intersectsBox(cell.box) && cell.box.distanceToPoint(cp) < band[1] + TREE_FADE_W;
        if (vis && cell.over && cell.stale === 0 && (cp.x - cell.bx!) ** 2 + (cp.z - cell.bz!) ** 2 > 2.25) cell.stale = 2; // nearest-first selection follows the camera
        if (vis && cell.stale && budget > 0) { this.build(lv, cell); budget--; }
        if (cell.mesh) cell.mesh.visible = vis;
      }
    }
  }

  /** Iso levels (not ride-only) and their `maxView` thresholds, for the hysteresis selection. */
  private isoIdx: number[] | null = null;
  private isoThr: number[] = [];
  private hl = -1;
  /** Level currently drawn in full (iso); -2 = not initialised. `xf` = running cross-fade between two levels (-1 = nothing drawn). */
  private shown = -2;
  private xf: { from: number; to: number; t: number } | null = null;
  private clock = 0;
  private readonly pvPad = new THREE.Matrix4();
  private readonly padFrustum = new THREE.Frustum();
  private readonly tmpDir = new THREE.Vector3();
  /** Seconds a zoom-level cross-fade takes (clock only runs once the incoming level is built). */
  static readonly XFADE_S = 0.4;
  /** Build region = the view enlarged by this factor (cells just outside the screen are ready before a rotation / pan brings them in). */
  static readonly PAD = 0.78;

  /** Hysteresis version of levelFor (iso): a camera jittering around a threshold keeps its level; `activeLevel` reports it. */
  private levelForHyst(viewHeight: number): number {
    if (!this.isoIdx) {
      this.isoIdx = []; this.isoThr = [];
      this.levels.forEach((l, i) => { if (!l.spec.perspectiveOnly) { this.isoIdx!.push(i); this.isoThr.push(l.spec.maxView); } });
    }
    this.hl = lodSelect(this.hl, viewHeight / this.lodScale, this.isoThr);
    return this.hl < this.isoIdx.length ? this.isoIdx[this.hl]! : -1;
  }

  private setXf(level: number, mode: number, w: number): void {
    if (level < 0) return;
    const u = (this.levels[level]!.spec.material as THREE.ShaderMaterial).uniforms?.uXf as THREE.IUniform<THREE.Vector2> | undefined;
    u?.value.set(mode, w);
  }

  /** Ground point the camera looks at (XZ): builds nearest the view centre go first. */
  private lookTarget(camera: THREE.Camera): [number, number] {
    camera.getWorldDirection(this.tmpDir);
    const d = this.tmpDir, p = camera.position;
    if (d.y > -1e-3) return [p.x, p.z];
    const t = -p.y / d.y;
    return [p.x + d.x * t, p.z + d.z * t];
  }

  /** Build the stale cells of `lv` that touch the padded view, nearest the view centre first. Returns the remaining budget; `pending` = any stale padded cell left. */
  private buildNearestFirst(lv: LevelState, tx: number, tz: number, budget: number): { budget: number; pending: boolean } {
    const todo: Array<{ cell: Cell; d: number }> = [];
    for (const cell of lv.cells) {
      if (!cell.stale || !this.padFrustum.intersectsBox(cell.box)) continue;
      const cx = (cell.box.min.x + cell.box.max.x) / 2 - tx, cz = (cell.box.min.z + cell.box.max.z) / 2 - tz;
      todo.push({ cell, d: cx * cx + cz * cz });
    }
    todo.sort((a, b) => a.d - b.d);
    let pending = false;
    for (const t of todo) { if (budget > 0) { this.build(lv, t.cell); budget--; } else pending = true; }
    return { budget, pending };
  }

  /**
   * Per-frame: select LOD (hysteresis), cull cells, rebuild stale cells within the budget (view enlarged by PAD, nearest the centre first).
   * Zoom crossing a level threshold is a cross-fade: the incoming level is built first (the outgoing one stays visible, so there are never holes), then both
   * draw for XFADE_S seconds with complementary per-instance masks (`uXf`), and the outgoing one is hidden.
   */
  update(camera: THREE.Camera, viewHeight: number, budget = PROP_BUILD_BUDGET): void {
    this.setFrustum(camera);
    const persp = isPerspective(camera);
    this.setPerspective(persp);
    if (persp) { this.updatePerspective(camera, budget * 2); return; }
    const want = this.levelForHyst(viewHeight);
    this.active = want;
    if (this.shown === -2) this.shown = want;
    if (this.xf && this.xf.to !== want) { // target changed mid-fade: settle the old fade, start the next one
      this.shown = this.xf.to; this.setXf(this.xf.from, 0, 0); this.setXf(this.xf.to, 0, 0); this.xf = null;
    }
    if (!this.xf && want !== this.shown) { this.xf = { from: this.shown, to: want, t: 0 }; this.needsPass = true; }
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    const dt = this.clock ? Math.min(0.1, (now - this.clock) / 1000) : 0;
    this.clock = now;
    if (!this.needsPass && !this.xf && want === this.lastLvl) {
      let same = true;
      const e = this.pv.elements;
      for (let k = 0; k < 16; k++) if (e[k] !== this.lastPv[k]) { same = false; break; }
      if (same) return;
    }
    this.passes++;
    this.lastLvl = want;
    for (let k = 0; k < 16; k++) this.lastPv[k] = this.pv.elements[k]!;
    this.needsPass = false;
    this.pvPad.makeScale(InstancedLayer.PAD, InstancedLayer.PAD, 1).multiply(this.pv);
    this.padFrustum.setFromProjectionMatrix(this.pvPad);
    const [tx, tz] = this.lookTarget(camera);
    const drawn = this.xf ? [this.xf.to, this.xf.from] : [this.shown];
    for (let li = 0; li < this.levels.length; li++) {
      if (drawn.includes(li)) continue;
      for (const cell of this.levels[li]!.cells) if (cell.mesh) cell.mesh.visible = false;
    }
    let incomingReady = true;
    for (const li of drawn) {
      if (li < 0) continue;
      const lv = this.levels[li]!;
      const r = this.buildNearestFirst(lv, tx, tz, budget);
      budget = r.budget;
      if (r.pending) { this.needsPass = true; if (this.xf && li === this.xf.to) incomingReady = false; } // budget ran out: finish the remaining cells next frame
      for (const cell of lv.cells) if (cell.mesh) cell.mesh.visible = this.frustum.intersectsBox(cell.box);
    }
    if (this.xf) {
      this.needsPass = true;
      const x = this.xf;
      x.t = advanceFade(x.t, dt, InstancedLayer.XFADE_S, incomingReady);
      if (x.t >= 1) {
        this.setXf(x.from, 0, 0); this.setXf(x.to, 0, 0);
        if (x.from >= 0) for (const cell of this.levels[x.from]!.cells) if (cell.mesh) cell.mesh.visible = false;
        this.shown = x.to; this.xf = null;
      } else { this.setXf(x.to, 1, x.t); this.setXf(x.from, 2, x.t); }
    }
  }

  /** Number of meshes (= draw calls) that would be drawn for this camera/zoom. */
  countDraws(camera: THREE.Camera, viewHeight: number): number {
    this.setFrustum(camera);
    if (isPerspective(camera)) {
      let n = 0;
      for (const lv of this.levels) {
        if (lv.spec.skipInPerspective) continue;
        const band = lv.spec.band ?? [0, Infinity];
        for (const cell of lv.cells) if (this.frustum.intersectsBox(cell.box) && cell.box.distanceToPoint(camera.position) < band[1] + TREE_FADE_W && this.cellCount(cell) > 0) n++;
      }
      return n;
    }
    const lvl = this.levelFor(viewHeight);
    if (lvl < 0) return 0;
    let n = 0;
    for (const cell of this.levels[lvl]!.cells) {
      if (this.frustum.intersectsBox(cell.box) && this.cellCount(cell) > 0) n++;
    }
    return n;
  }

  private cellCount(cell: Cell): number {
    let n = 0;
    for (let cy = cell.cy0; cy <= cell.cy1; cy++) {
      for (let cx = cell.cx0; cx <= cell.cx1; cx++) {
        { const pc = this.store.propsInChunk(cx, cy); for (let i = 0; i < pc.kind.length; i++) if (pc.kind[i] === this.kind && this.keep(pc.seed[i]!)) n++; }
      }
    }
    return n;
  }

  get activeLevel(): number { return this.active; }

  private build(lv: LevelState, cell: Cell): void {
    this.rebuilds++;
    const total = this.cellCount(cell);
    const count = Math.min(total, lv.spec.maxPerCell ?? Infinity);
    const over = total > count;
    if (count === 0) {
      if (cell.mesh) { cell.mesh.count = 0; cell.mesh.visible = false; }
      cell.stale = 0;
      return;
    }
    if (!cell.mesh || count > cell.cap) {
      if (cell.mesh) { this.group.remove(cell.mesh); cell.mesh.geometry.dispose(); cell.mesh.dispose(); }
      const geo = new THREE.BufferGeometry();
      const base = lv.spec.geometry;
      for (const name of Object.keys(base.attributes)) geo.setAttribute(name, base.getAttribute(name));
      if (base.index) geo.setIndex(base.index);
      geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4));
      geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(count), 1));
      const mesh = new THREE.InstancedMesh(geo, lv.spec.material, count);
      mesh.frustumCulled = false; // culled per cell in update()
      cell.mesh = mesh;
      cell.cap = count;
      cell.stale = 2;
      this.group.add(mesh);
    }
    const mesh = cell.mesh;
    mesh.count = count;
    const writeMatrix = cell.stale === 2;
    const mat = mesh.instanceMatrix.array as Float32Array;
    const tint = (mesh.geometry.getAttribute('aTint') as THREE.InstancedBufferAttribute).array as Float32Array;
    const seedArr = (mesh.geometry.getAttribute('aSeed') as THREE.InstancedBufferAttribute).array as Float32Array;
    const sm = lv.spec.scaleMul ?? 1;
    let n = 0;
    if (over && this.perspective) { // too many props for the cap: keep the ones NEAREST to the camera (trees right next to the camera must never fall back to nothing)
      const sel = this.nearest(cell, count);
      for (let k = 0; k < sel.length; k++) n = this.fillOne(sel[k]!.c, sel[k]!.i, mat, tint, seedArr, n, sm, writeMatrix);
      cell.over = true; cell.bx = this.camX; cell.bz = this.camZ;
    } else {
      cell.over = undefined;
      for (let cy = cell.cy0; cy <= cell.cy1; cy++) {
        for (let cx = cell.cx0; cx <= cell.cx1; cx++) {
          n = this.fillChunk(this.store.propsInChunk(cx, cy), mat, tint, seedArr, n, sm, writeMatrix, count);
        }
      }
    }
    if (writeMatrix) mesh.instanceMatrix.needsUpdate = true;
    (mesh.geometry.getAttribute('aTint') as THREE.BufferAttribute).needsUpdate = true;
    (mesh.geometry.getAttribute('aSeed') as THREE.BufferAttribute).needsUpdate = true;
    cell.stale = 0;
  }

  /** The `count` props of this layer's kind in the cell that are nearest to the camera (XZ). */
  private nearest(cell: Cell, count: number): Array<{ c: PropChunk; i: number; d: number }> {
    const all: Array<{ c: PropChunk; i: number; d: number }> = [];
    for (let cy = cell.cy0; cy <= cell.cy1; cy++) {
      for (let cx = cell.cx0; cx <= cell.cx1; cx++) {
        const c = this.store.propsInChunk(cx, cy);
        for (let i = 0; i < c.kind.length; i++) {
          if (c.kind[i] !== this.kind || !this.keep(c.seed[i]!)) continue;
          const dx = c.tx[i]! + c.ox[i]! - this.camX, dz = c.ty[i]! + c.oy[i]! - this.camZ;
          all.push({ c, i, d: dx * dx + dz * dz });
        }
      }
    }
    all.sort((a, b) => a.d - b.d);
    all.length = Math.min(all.length, count);
    return all;
  }

  private fillChunk(c: PropChunk, mat: Float32Array, tint: Float32Array, seeds: Float32Array, n: number, sm: number, writeMatrix: boolean, limit = Infinity): number {
    for (let i = 0; i < c.kind.length; i++) {
      if (c.kind[i] !== this.kind || !this.keep(c.seed[i]!)) continue;
      if (n >= limit) break;
      n = this.fillOne(c, i, mat, tint, seeds, n, sm, writeMatrix);
    }
    return n;
  }

  private fillOne(c: PropChunk, i: number, mat: Float32Array, tint: Float32Array, seeds: Float32Array, n: number, sm: number, writeMatrix: boolean): number {
    const grid = this.store.grid;
    {
      const tx = c.tx[i]!, ty = c.ty[i]!;
      if (writeMatrix) {
        const wx = tx + c.ox[i]!, wz = ty + c.oy[i]!;
        const y = surfaceHeight(grid, wx, wz);
        const s = c.scale[i]! * (this.kind === PropKind.Rock ? 0.7 : 1) * sm * growthFactor(c.born[i]!, this.store.now), cs = Math.cos(c.rot[i]!) * s, sn = Math.sin(c.rot[i]!) * s;
        const o = n * 16;
        mat[o] = cs; mat[o + 1] = 0; mat[o + 2] = -sn; mat[o + 3] = 0;
        mat[o + 4] = 0; mat[o + 5] = s; mat[o + 6] = 0; mat[o + 7] = 0;
        mat[o + 8] = sn; mat[o + 9] = 0; mat[o + 10] = cs; mat[o + 11] = 0;
        mat[o + 12] = wx; mat[o + 13] = y; mat[o + 14] = wz; mat[o + 15] = 1;
      }
      const seed = c.seed[i]!;
      const j = 0.85 + (seed / 255) * 0.3;
      const h2 = ((seed * 0.618034) % 1);
      const t = n * 4;
      seeds[n] = ((seed * 0.754877666 + (tx * 7 + ty * 13) * 0.0618) % 1 + 1) % 1; // hash-staggered per tree
      const sp = this.kind === PropKind.Rock ? 0.2 : 0.1; // rocks get wider warm/cool tint variety
      tint[t] = j * (1 - sp * 0.5 + sp * h2);
      tint[t + 1] = j;
      tint[t + 2] = j * (1 + sp * 0.5 - sp * h2);
      tint[t + 3] = Math.min(1, grid.snowDepth[ty * grid.size + tx]! / SNOW_FULL_DEPTH);
      n++;
    }
    return n;
  }

    dispose(): void {
    for (const lv of this.levels) for (const c of lv.cells) if (c.mesh) { c.mesh.geometry.dispose(); c.mesh.dispose(); }
  }
}

/** All tree species (conifers, pine, larch, deciduous, birch, oak, shrubs, snags): full -> low-poly -> billboard impostors. */
export class TreeLayer {
  readonly group = new THREE.Group();
  readonly layers: InstancedLayer[];
  readonly uniforms: PropUniforms;
  private readonly atlas: THREE.Texture;
  private year = 0.375;

  constructor(store: PropStore, uniforms: PropUniforms = createPropUniforms()) {
    this.uniforms = uniforms;
    this.atlas = createImpostorAtlas();
    this.layers = TREE_SPECIES.map((sp) => {
      // one material per level: each carries its own perspective distance band (uLodRange); iso ignores it (0..1e9)
      return new InstancedLayer(store, sp.kind, [
        { maxView: TREE_FULL_MAX_VIEW, groupChunks: 4, geometry: sp.full(), material: createMeshMaterial(uniforms, sp), skipInPerspective: true },
        { maxView: TREE_LOW_MAX_VIEW, groupChunks: 8, geometry: sp.low(), material: createMeshMaterial(uniforms, sp), skipInPerspective: true },
        { maxView: Infinity, groupChunks: 8, geometry: billboardQuad(), material: createBillboardMaterial(uniforms, this.atlas, sp), band: [TREE_RIDE_LOW_DIST, Infinity] },
        // ride views: small cells (32 / 64 tiles) so only the trees near the camera are submitted at full / low-poly detail
        // near (< 8 tiles): high-poly crowns, bark trunks, branch bundles; capped instances per 16-tile cell. Cross-fades into the full level.
        ...(nearGeo(sp.kind) ? [{ maxView: -1, perspectiveOnly: true, groupChunks: 1, maxPerCell: NEAR_CAPS.treesPerCell, geometry: nearGeo(sp.kind)!, material: createMeshMaterial(uniforms, sp), band: [0, TREE_RIDE_NEAR_DIST] as [number, number] }] : []),
        { maxView: -1, perspectiveOnly: true, groupChunks: 1, geometry: sp.full(), material: createMeshMaterial(uniforms, sp), band: [TREE_RIDE_NEAR_DIST, TREE_RIDE_FULL_DIST] },
        { maxView: -1, perspectiveOnly: true, groupChunks: 2, geometry: sp.low(), material: createMeshMaterial(uniforms, sp), band: [TREE_RIDE_FULL_DIST, TREE_RIDE_LOW_DIST] },
      ]);
    });
    for (const l of this.layers) this.group.add(l.group);
  }

  /** Explicit season blend (weights are normalised). Uniform-only: no instance buffers are rewritten. */
  setSeason(w: SeasonWeights): void {
    const sum = Math.max(1e-6, w.spring + w.summer + w.autumn + w.winter);
    this.uniforms.uSeason.value.set(w.spring / sum, w.summer / sum, w.autumn / sum, w.winter / sum);
  }

  /** Year position 0..1 (spring .125, summer .375, autumn .625, winter .875 centres). */
  setSeasonYear(t: number): void {
    this.year = t;
    this.setSeason(seasonWeights(t));
  }

  get seasonYear(): number { return this.year; }

  /** Mark chunks stale (terrain height or snow changed). */
  refreshChunks(idxs: Iterable<number>, snowOnly = false): void {
    const arr = Array.from(idxs);
    for (const l of this.layers) l.refreshChunks(arr, snowOnly);
  }

  update(camera: THREE.Camera, viewHeight: number): void {
    for (const l of this.layers) l.update(camera, viewHeight);
  }

  /** Graphics quality: LOD distance scale + fraction of trees drawn. */
  setQuality(lodScale: number, density: number): void {
    for (const l of this.layers) { l.setLodScale(lodScale); l.setDensity(density); }
  }

  /** Ground-level cap on near (high-poly) tree instances per cell (0 = off). */
  setNearCap(n: number): void { for (const l of this.layers) l.setNearCap(n); }

  countDraws(camera: THREE.Camera, viewHeight: number): number {
    return this.layers.reduce((a, l) => a + l.countDraws(camera, viewHeight), 0);
  }

  dispose(): void {
    for (const l of this.layers) l.dispose();
    this.atlas.dispose();
  }
}
