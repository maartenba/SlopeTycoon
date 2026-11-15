import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildAircraft } from './aircraft';
import { mergeParts, xformParts } from './sweepGeo';

/**
 * Procedural vehicle models: lofted (rounded cross-section) bodies with window bands, wheels, lights and roof gear, each merged into ONE
 * vertex-coloured body geometry + one tiny 'lights' geometry (head/tail lights, drawn unlit so they glow at night). Forward = +z, origin on the ground.
 */
type Rgb = [number, number, number];
const rgb = (hex: number): Rgb => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };

export interface Sec { z: number; w: number; y0: number; y1: number; /** colour 'glass' as 'body' (a window pillar). */ pillar?: boolean }
/** Ring entries (right side, bottom -> top): [x fraction of half width, y fraction of height, colour key]. The left side is mirrored. */
export type Ring = Array<[number, number, string]>;
export type Palette = Record<string, Rgb>;

/** Lofts rounded sections into a smooth vertex-coloured mesh (end caps use the first/last section's mid colour). */
export function loft(secs: Sec[], ring: Ring, pal: Palette, capKeyFront = 'glass', capKeyBack = 'body'): THREE.BufferGeometry {
  const right = ring, m = right.length, rn = m * 2;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const colorOf = (key: string, pillar: boolean | undefined): Rgb => pal[pillar && key === 'glass' ? 'body' : key] ?? pal.body!;
  const sectionVerts = (s: Sec): Array<[number, number, number, Rgb]> => {
    const out: Array<[number, number, number, Rgb]> = [];
    const h = s.y1 - s.y0;
    for (let k = 0; k < m; k++) { const [xf, yf, key] = right[k]!; out.push([s.w * xf, s.y0 + h * yf, s.z, colorOf(key, s.pillar)]); }
    for (let k = m - 1; k >= 0; k--) { const [xf, yf, key] = right[k]!; out.push([-s.w * xf, s.y0 + h * yf, s.z, colorOf(key, s.pillar)]); }
    return out;
  };
  const push = (v: [number, number, number, Rgb]): number => { pos.push(v[0], v[1], v[2]); col.push(...v[3]); return pos.length / 3 - 1; };
  const rings: number[][] = secs.map((s) => sectionVerts(s).map(push));
  for (let a = 0; a + 1 < rings.length; a++) {
    for (let k = 0; k < rn; k++) {
      const k2 = (k + 1) % rn, p = rings[a]!, q = rings[a + 1]!;
      // winding: outward normals for +z forward sections
      idx.push(p[k]!, q[k]!, p[k2]!, p[k2]!, q[k]!, q[k2]!);
    }
  }
  const cap = (s: Sec, front: boolean, key: string): void => {
    const vs = sectionVerts(s);
    const c = push([0, (s.y0 + s.y1) / 2, s.z, colorOf(key, false)]);
    const ids = vs.map((v) => push([v[0], v[1], v[2], colorOf(key, false)]));
    for (let k = 0; k < rn; k++) { const k2 = (k + 1) % rn; if (front) idx.push(c, ids[k]!, ids[k2]!); else idx.push(c, ids[k2]!, ids[k]!); }
  };
  cap(secs[secs.length - 1]!, true, capKeyFront); cap(secs[0]!, false, capKeyBack);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // fix winding if the lofted normals point inwards (check the first ring's top vertex)
  const n = g.getAttribute('normal');
  const topIdx = rings[0]![m - 1]!;
  if (n.getY(topIdx) < 0) { const ix = g.getIndex()!; for (let i = 0; i < ix.count; i += 3) { const a = ix.getX(i + 1), b = ix.getX(i + 2); ix.setX(i + 1, b); ix.setX(i + 2, a); } g.computeVertexNormals(); }
  return g.toNonIndexed();
}

/** Inserts one extra section between every pair (4-point cubic interpolation on z / w / y0 / y1): the lofted body reads rounder with the same ring profile. Pillar flags are copied from the lower section. */
export function smoothSecs(secs: Sec[]): Sec[] {
  if (secs.length < 3) return secs;
  const out: Sec[] = [];
  const at = (i: number): Sec => secs[Math.max(0, Math.min(secs.length - 1, i))]!;
  const f = (a: number, b: number, c: number, d: number): number => (-a + 9 * b + 9 * c - d) / 16;
  for (let i = 0; i < secs.length - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    out.push(p1);
    const y0 = f(p0.y0, p1.y0, p2.y0, p3.y0), y1 = f(p0.y1, p1.y1, p2.y1, p3.y1);
    out.push({ z: (p1.z + p2.z) / 2, w: Math.max(0.01, f(p0.w, p1.w, p2.w, p3.w)), y0: Math.min(y0, y1 - 0.01), y1: Math.max(y1, y0 + 0.01), pillar: p1.pillar });
  }
  out.push(secs[secs.length - 1]!);
  return out;
}

function paint(g: THREE.BufferGeometry, c: Rgb): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  geo.deleteAttribute('uv');
  const n = geo.getAttribute('position').count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2]; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}
const box = (w: number, h: number, d: number, c: Rgb, x: number, y: number, z: number, rx = 0): THREE.BufferGeometry => {
  const g = new THREE.BoxGeometry(w, h, d); if (rx) g.rotateX(rx); g.translate(x, y, z); return paint(g, c);
};
/** Disc facing +x (dir 1) or -x (dir -1) at (x,y,z). */
function disc(r: number, seg: number, x: number, y: number, z: number, dir: 1 | -1, c: Rgb, inner = 0, half = false): THREE.BufferGeometry {
  const g = inner > 0 ? new THREE.RingGeometry(inner, r, seg) : new THREE.CircleGeometry(r, seg, 0, half ? Math.PI : Math.PI * 2);
  g.rotateY(dir > 0 ? Math.PI / 2 : -Math.PI / 2); g.translate(x, y, z); return paint(g, c);
}
/** Wheel with a lighter hub; axis along x. M8: an open tyre band plus a sidewall ring + hub disc on the OUTER side(s) only (the inner faces are never seen): ~half the triangles of the closed cylinders. */
function wheel(r: number, w: number, x: number, y: number, z: number, tire: Rgb, hub: Rgb, seg = 10): THREE.BufferGeometry[] {
  const n = Math.max(10, seg);
  const t = new THREE.CylinderGeometry(r, r, w, n, 1, true); t.rotateZ(Math.PI / 2); t.translate(x, y, z);
  const out = [paint(t, tire)];
  const sides: Array<1 | -1> = x > 0.02 ? [1] : x < -0.02 ? [-1] : [1, -1];
  for (const d of sides) out.push(disc(r, n, x + d * (w / 2), y, z, d, tire, r * 0.56), disc(r * 0.56, 8, x + d * (w / 2 + 0.002), y, z, d, hub));
  return out;
}

const BASE_PAL = (body: number): Palette => ({
  body: rgb(body), glass: rgb(0x2b3d52), dark: rgb(0x1c1d20), trim: rgb(0x2c2f34), white: rgb(0xf0f2f4), stripe: rgb(0x3a78c2), roof: rgb(body),
});
export const CAR_COLORS = [0xf2f2f2, 0xb8bec6, 0x2a2d32, 0xc93a32, 0x2f5fa8, 0x3a7d4a, 0xe8b93a, 0xe0762c, 0x1f3b6e, 0x7a2330, 0x2f8f8a, 0xd8c9a8] as const;
/** Roof colours of the two-tone cars (about one in four): dark, white or red roof over the body colour. */
export const TWO_TONE_ROOFS = [0x2a2d32, 0xf2f2f2, 0xc93a32] as const;
export const SPORT_COLORS = [0xc93a32, 0xe8b93a, 0x2a2d32, 0xf2f2f2] as const;
export const CAR_STYLES = ['hatchback', 'sedan', 'suv', 'van', 'sports', 'pickup', 'estate', 'camper'] as const;
const CAR_RING_BODY: Ring = [[0.8, 0, 'trim'], [1, 0.28, 'body'], [1, 0.7, 'body'], [0.86, 1, 'body']];
const CAR_RING_CABIN: Ring = [[0.9, 0, 'glass'], [1, 0.2, 'glass'], [1, 0.82, 'glass'], [0.82, 0.95, 'roof'], [0.55, 1, 'roof']];

interface CarStyle { body: Sec[]; cabin: Sec[]; wheelR: number; wheelZ: number; wheelX: number; len: number; roofY: number; /** z of the B-pillar (a body-coloured band across the glasshouse). */ pillarZ: number }
const STYLES: CarStyle[] = [
  { // hatchback
    body: [{ z: -0.38, w: 0.17, y0: 0.07, y1: 0.16 }, { z: -0.32, w: 0.2, y0: 0.05, y1: 0.2 }, { z: 0.0, w: 0.2, y0: 0.05, y1: 0.215 }, { z: 0.3, w: 0.2, y0: 0.05, y1: 0.19 }, { z: 0.39, w: 0.17, y0: 0.07, y1: 0.14 }],
    cabin: [{ z: -0.31, w: 0.14, y0: 0.19, y1: 0.28 }, { z: -0.25, w: 0.175, y0: 0.2, y1: 0.33 }, { z: 0.03, w: 0.175, y0: 0.2, y1: 0.33 }, { z: 0.16, w: 0.15, y0: 0.2, y1: 0.27 }],
    wheelR: 0.072, wheelZ: 0.25, wheelX: 0.19, len: 0.78, roofY: 0.33, pillarZ: -0.08,
  },
  { // sedan
    body: [{ z: -0.44, w: 0.17, y0: 0.07, y1: 0.17 }, { z: -0.38, w: 0.2, y0: 0.05, y1: 0.21 }, { z: 0.0, w: 0.205, y0: 0.05, y1: 0.215 }, { z: 0.34, w: 0.2, y0: 0.05, y1: 0.19 }, { z: 0.44, w: 0.17, y0: 0.07, y1: 0.14 }],
    cabin: [{ z: -0.26, w: 0.15, y0: 0.2, y1: 0.28 }, { z: -0.18, w: 0.178, y0: 0.2, y1: 0.325 }, { z: 0.08, w: 0.178, y0: 0.2, y1: 0.325 }, { z: 0.2, w: 0.15, y0: 0.2, y1: 0.265 }],
    wheelR: 0.074, wheelZ: 0.28, wheelX: 0.19, len: 0.88, roofY: 0.325, pillarZ: -0.04,
  },
  { // SUV
    body: [{ z: -0.42, w: 0.2, y0: 0.09, y1: 0.24 }, { z: -0.38, w: 0.225, y0: 0.07, y1: 0.28 }, { z: 0.0, w: 0.225, y0: 0.07, y1: 0.29 }, { z: 0.34, w: 0.225, y0: 0.07, y1: 0.27 }, { z: 0.42, w: 0.2, y0: 0.09, y1: 0.22 }],
    cabin: [{ z: -0.38, w: 0.2, y0: 0.27, y1: 0.4 }, { z: -0.34, w: 0.21, y0: 0.28, y1: 0.43 }, { z: 0.14, w: 0.21, y0: 0.28, y1: 0.43 }, { z: 0.24, w: 0.185, y0: 0.28, y1: 0.36 }],
    wheelR: 0.09, wheelZ: 0.27, wheelX: 0.21, len: 0.84, roofY: 0.43, pillarZ: -0.1,
  },
  { // van
    body: [{ z: -0.44, w: 0.2, y0: 0.08, y1: 0.28 }, { z: -0.4, w: 0.215, y0: 0.06, y1: 0.33 }, { z: 0.1, w: 0.215, y0: 0.06, y1: 0.34 }, { z: 0.36, w: 0.2, y0: 0.07, y1: 0.28 }, { z: 0.45, w: 0.18, y0: 0.08, y1: 0.2 }],
    cabin: [{ z: -0.42, w: 0.2, y0: 0.31, y1: 0.43 }, { z: -0.38, w: 0.208, y0: 0.32, y1: 0.46 }, { z: 0.22, w: 0.208, y0: 0.32, y1: 0.46 }, { z: 0.36, w: 0.19, y0: 0.31, y1: 0.36 }],
    wheelR: 0.078, wheelZ: 0.28, wheelX: 0.2, len: 0.9, roofY: 0.46, pillarZ: -0.12,
  },
  { // sports
    body: [{ z: -0.43, w: 0.18, y0: 0.06, y1: 0.14 }, { z: -0.37, w: 0.21, y0: 0.045, y1: 0.17 }, { z: 0.0, w: 0.215, y0: 0.045, y1: 0.165 }, { z: 0.3, w: 0.21, y0: 0.045, y1: 0.15 }, { z: 0.44, w: 0.17, y0: 0.055, y1: 0.1 }],
    cabin: [{ z: -0.24, w: 0.15, y0: 0.15, y1: 0.21 }, { z: -0.12, w: 0.18, y0: 0.155, y1: 0.255 }, { z: 0.08, w: 0.18, y0: 0.155, y1: 0.255 }, { z: 0.22, w: 0.15, y0: 0.15, y1: 0.19 }],
    wheelR: 0.068, wheelZ: 0.29, wheelX: 0.2, len: 0.88, roofY: 0.255, pillarZ: -0.02,
  },
  { // pickup: short cab over a low open bed (the bed is added in buildCar)
    body: [{ z: -0.46, w: 0.18, y0: 0.08, y1: 0.2 }, { z: -0.4, w: 0.21, y0: 0.06, y1: 0.25 }, { z: -0.02, w: 0.215, y0: 0.06, y1: 0.25 }, { z: 0.12, w: 0.215, y0: 0.06, y1: 0.27 }, { z: 0.4, w: 0.2, y0: 0.07, y1: 0.21 }, { z: 0.46, w: 0.17, y0: 0.08, y1: 0.17 }],
    cabin: [{ z: 0.02, w: 0.16, y0: 0.25, y1: 0.33 }, { z: 0.07, w: 0.18, y0: 0.26, y1: 0.4 }, { z: 0.24, w: 0.18, y0: 0.26, y1: 0.4 }, { z: 0.35, w: 0.15, y0: 0.26, y1: 0.31 }],
    wheelR: 0.085, wheelZ: 0.3, wheelX: 0.21, len: 0.92, roofY: 0.4, pillarZ: 0.155,
  },
  { // estate: long glasshouse down to a near-vertical tailgate
    body: [{ z: -0.44, w: 0.17, y0: 0.07, y1: 0.2 }, { z: -0.38, w: 0.2, y0: 0.05, y1: 0.215 }, { z: 0.0, w: 0.205, y0: 0.05, y1: 0.215 }, { z: 0.34, w: 0.2, y0: 0.05, y1: 0.19 }, { z: 0.44, w: 0.17, y0: 0.07, y1: 0.14 }],
    cabin: [{ z: -0.41, w: 0.15, y0: 0.2, y1: 0.28 }, { z: -0.36, w: 0.178, y0: 0.2, y1: 0.335 }, { z: 0.06, w: 0.178, y0: 0.2, y1: 0.335 }, { z: 0.2, w: 0.15, y0: 0.2, y1: 0.265 }],
    wheelR: 0.074, wheelZ: 0.28, wheelX: 0.19, len: 0.9, roofY: 0.335, pillarZ: -0.12,
  },
  { // camper: tall box habitat, a window band along the side, cab-over nose
    body: [{ z: -0.47, w: 0.2, y0: 0.09, y1: 0.4 }, { z: -0.43, w: 0.22, y0: 0.07, y1: 0.46 }, { z: 0.12, w: 0.22, y0: 0.07, y1: 0.47 }, { z: 0.2, w: 0.21, y0: 0.07, y1: 0.4 }, { z: 0.38, w: 0.2, y0: 0.08, y1: 0.27 }, { z: 0.46, w: 0.17, y0: 0.09, y1: 0.2 }],
    cabin: [{ z: -0.36, w: 0.225, y0: 0.31, y1: 0.42 }, { z: -0.3, w: 0.226, y0: 0.31, y1: 0.43 }, { z: 0.08, w: 0.226, y0: 0.31, y1: 0.43 }, { z: 0.3, w: 0.19, y0: 0.28, y1: 0.33 }],
    wheelR: 0.085, wheelZ: 0.3, wheelX: 0.215, len: 0.94, roofY: 0.47, pillarZ: -0.12,
  },
];

/** Inserts a body-coloured pillar band (`half` each side of `z`) into a section list: the sections at the band edges are interpolated, so the glasshouse shape does not change. */
export function pillarize(secs: Sec[], z: number, half = 0.014): Sec[] {
  const at = (zz: number): Sec => {
    for (let i = 0; i < secs.length - 1; i++) { const a = secs[i]!, b = secs[i + 1]!; if (zz >= a.z && zz <= b.z) { const t = b.z > a.z ? (zz - a.z) / (b.z - a.z) : 0; return { z: zz, w: a.w + (b.w - a.w) * t, y0: a.y0 + (b.y0 - a.y0) * t, y1: a.y1 + (b.y1 - a.y1) * t }; } }
    return secs[zz < secs[0]!.z ? 0 : secs.length - 1]!;
  };
  if (z - half <= secs[0]!.z || z + half >= secs[secs.length - 1]!.z) return secs;
  const out: Sec[] = [], lo = at(z - half), hi = at(z + half);
  let done = false;
  for (const s of secs) {
    if (!done && s.z > z - half) { out.push({ ...lo }, { ...lo, pillar: true }, { ...hi, pillar: true }, { ...hi }); done = true; }
    if (s.z > z - half && s.z < z + half) continue;
    out.push(s);
  }
  return out;
}

export interface ModelParts { /** Half extents (x, z) of the soft contact shadow (tiles) and of the headlight reach: the nose z. */ foot?: [number, number]; body: THREE.BufferGeometry; lights: THREE.BufferGeometry; prop?: THREE.BufferGeometry; propPivot?: [number, number, number] }
const merge = (gs: THREE.BufferGeometry[]): THREE.BufferGeometry => {
  const m = mergeGeometries(gs, false)!;
  gs.forEach((g) => g.dispose());
  return m;
};
/**
 * Roof-snow mask (`aSnow` 0 / 1 per vertex, read by the vehicle body shader): up-facing surfaces above `roofY` (roof, roof gear) and, when `trunkZ` is given, the rear deck behind it
 * (boot lid); never the bonnet. Baked once per cached model: no per-frame cost.
 */
export function snowMask(g: THREE.BufferGeometry, roofY: number, trunkZ = -Infinity): THREE.BufferGeometry {
  const pos = g.getAttribute('position'), nor = g.getAttribute('normal'), a = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const up = nor.getY(i) > 0.6, y = pos.getY(i), z = pos.getZ(i);
    a[i] = up && (y > roofY || (z < trunkZ && y > 0.13)) ? 1 : 0;
  }
  g.setAttribute('aSnow', new THREE.BufferAttribute(a, 1));
  return g;
}
const lightGeo = (items: Array<[number, number, number, number, number, number, Rgb]>): THREE.BufferGeometry => merge(items.map(([w, h, d, x, y, z, c]) => box(w, h, d, c, x, y, z)));
const HEAD: Rgb = [1, 0.96, 0.8], TAIL: Rgb = [0.9, 0.08, 0.06], WHITE_GLOW: Rgb = [1, 1, 1];
void WHITE_GLOW;

/** Options of `buildCar`: `roof` = a two-tone roof colour (hex), `low` = the simpler Low-quality variant (no pillars, arches, seams or mirrors: fewer triangles than the full car). */
export interface CarOpts { roof?: number; low?: boolean }
/** Local y of the soft contact shadow quad (`vehicleFx.ts`): the vehicle group floats 0.05 above the ground (VehicleRenderer). */
export const GROUND_BLOB_Y = -0.046;

/** rack: 0 none, 1 skis (winter), 2 bike (summer), 3 ski box. style: 0..7 (`CAR_STYLES`), colour index into CAR_COLORS / SPORT_COLORS. */
export function buildCar(style: number, colorHex: number, rack: number, opts: CarOpts = {}): ModelParts {
  const st = STYLES[style % STYLES.length]!, low = opts.low === true;
  const pal: Palette = { ...BASE_PAL(colorHex), roof: rgb(opts.roof ?? colorHex) };
  const cabin = smoothSecs(st.cabin);
  const parts: THREE.BufferGeometry[] = [loft(smoothSecs(st.body), CAR_RING_BODY, pal, 'body', 'body'), loft(low ? cabin : pillarize(cabin, st.pillarZ), CAR_RING_CABIN, pal, 'glass', 'glass')];
  const tire = rgb(0x151618), hub = rgb(0x9aa0a8);
  for (const sx of [1, -1]) for (const sz of [1, -1]) parts.push(...wheel(st.wheelR, 0.055, sx * st.wheelX, st.wheelR, sz * st.wheelZ, tire, hub, low ? 8 : 10));
  const hw = st.body[st.body.length - 1]!.w, bw = st.body[2]!.w;
  if (!low) {
    // wheel arches (dark half discs on the body side, behind the wheel), door mirrors, door seams, antenna
    for (const sx of [1, -1]) for (const sz of [1, -1]) parts.push(disc(st.wheelR * 1.3, 10, sx * (bw + 0.003), st.wheelR + 0.005, sz * st.wheelZ, sx as 1 | -1, rgb(0x1c1d20), 0, true));
    for (const sx of [1, -1]) parts.push(box(0.03, 0.025, 0.04, rgb(0x2c2f34), sx * (st.cabin[1]!.w + 0.02), st.cabin[1]!.y0 + 0.03, st.cabin[1]!.z + 0.04));
    for (const sx of [1, -1]) parts.push(box(0.006, 0.09, 0.012, rgb(0x1c1d20), sx * (bw + 0.002), st.body[2]!.y0 + 0.09, st.cabin[1]!.z + 0.12), box(0.006, 0.09, 0.012, rgb(0x1c1d20), sx * (bw + 0.002), st.body[2]!.y0 + 0.09, st.cabin[2]!.z));
    if (rack === 0) parts.push(paint(new THREE.CylinderGeometry(0.004, 0.004, 0.14, 4).translate(0.1, st.roofY + 0.06, -0.12), rgb(0x2c2f34)));
    parts.push(box(hw * 1.1, 0.03, 0.012, rgb(0x1c1d20), 0, st.body[0]!.y0 + 0.07, st.len / 2 + 0.0)); // grille
  }
  parts.push(box(0.05, 0.025, 0.006, rgb(0xf0f2f4), 0, st.body[0]!.y0 + 0.06, -st.len / 2 - 0.002)); // number plate
  parts.push(box(hw * 1.9, 0.03, 0.02, rgb(0x2c2f34), 0, st.body[0]!.y0 + 0.02, st.len / 2 - 0.005), box(hw * 1.9, 0.03, 0.02, rgb(0x2c2f34), 0, st.body[0]!.y0 + 0.02, -st.len / 2 + 0.005)); // bumpers
  if (style === 5) { // pickup bed: dark liner + two rails + tailgate
    parts.push(box(0.3, 0.008, 0.38, rgb(0x1c1d20), 0, st.body[2]!.y1 + 0.003, -0.25));
    for (const sx of [1, -1]) parts.push(box(0.02, 0.035, 0.4, pal.body!, sx * 0.19, st.body[2]!.y1 - 0.005, -0.25));
    if (!low) parts.push(box(0.4, 0.035, 0.02, pal.body!, 0, st.body[2]!.y1 - 0.005, -0.45));
  } else if (style === 7 && !low) { // camper: roof AC pod + a stripe band along the habitat
    parts.push(box(0.14, 0.03, 0.2, rgb(0xe9edf0), 0, st.roofY + 0.003, -0.18));
    for (const sx of [1, -1]) parts.push(box(0.006, 0.03, 0.5, rgb(0x3a78c2), sx * (st.body[2]!.w + 0.003), 0.26, -0.18));
  }
  const rail = rgb(0x2c2f34), y = st.roofY + 0.012;
  if (rack === 1) {
    parts.push(box(0.3, 0.012, 0.015, rail, 0, y, -0.08), box(0.3, 0.012, 0.015, rail, 0, y, 0.06));
    parts.push(box(0.028, 0.016, 0.6, rgb(0xd83a34), -0.045, y + 0.014, 0), box(0.028, 0.016, 0.6, rgb(0x2f6fd0), 0.045, y + 0.014, 0));
  } else if (rack === 2) {
    const by = st.roofY + 0.07;
    parts.push(box(0.3, 0.012, 0.015, rail, 0, y, -0.08), box(0.3, 0.012, 0.015, rail, 0, y, 0.06));
    for (const z of [-0.14, 0.14]) parts.push(paint(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 8, 1, true).rotateZ(Math.PI / 2).translate(0, by, z), rgb(0x151618))); // bike wheels: open tyre bands
    parts.push(box(0.014, 0.014, 0.3, rgb(0xd83a34), 0, by + 0.03, 0));
  } else if (rack === 3) { // ski box: a long dark pod with a lighter lid line
    parts.push(box(0.3, 0.012, 0.015, rail, 0, y, -0.08), box(0.3, 0.012, 0.015, rail, 0, y, 0.06));
    parts.push(box(0.15, 0.05, 0.5, rgb(0x23272d), 0, y + 0.01, -0.01), box(0.15, 0.008, 0.5, rgb(0x6c727a), 0, y + 0.06, -0.01));
  }
  const z0 = st.len / 2 - 0.003, lw = hw * 0.72, ly = st.body[0]!.y1 - 0.012;
  const lights = lightGeo([
    [0.07, 0.035, 0.012, lw * 0.62, ly, z0, HEAD], [0.07, 0.035, 0.012, -lw * 0.62, ly, z0, HEAD],
    [0.06, 0.03, 0.012, lw * 0.62, ly + 0.0, -z0, TAIL], [0.06, 0.03, 0.012, -lw * 0.62, ly + 0.0, -z0, TAIL],
  ]);
  return { body: snowMask(merge(parts), Math.max(...st.body.map((b) => b.y1)) + 0.012, st.cabin[1]!.z), lights, foot: [bw + 0.05, st.len / 2 + 0.06] };
}

const BUS_RING: Ring = [[0.88, 0, 'dark'], [1, 0.07, 'stripe'], [1, 0.36, 'stripe'], [1, 0.4, 'glass'], [1, 0.82, 'glass'], [1, 0.86, 'body'], [0.88, 1, 'body'], [0.5, 1, 'body']];
function windowSecs(z0: number, z1: number, w: number, y0: number, y1: number, n: number): Sec[] {
  const out: Sec[] = [];
  const step = (z1 - z0) / n;
  for (let k = 0; k < n; k++) {
    const a = z0 + k * step, b = a + step;
    out.push({ z: a, w, y0, y1, pillar: true }, { z: a + 0.025, w, y0, y1, pillar: true }, { z: a + 0.025, w, y0, y1 }, { z: b, w, y0, y1 });
  }
  out.push({ z: z1, w, y0, y1, pillar: true });
  return out;
}
/** Drops the side window triangles (glass colour, facing sideways) so the cabin can be seen through the windows; the windscreen and the pillars stay solid. */
export function openWindows(g: THREE.BufferGeometry, glass: Rgb): THREE.BufferGeometry {
  const pos = g.getAttribute('position'), col = g.getAttribute('color'), nor = g.getAttribute('normal');
  const keep: number[] = [];
  const isGlass = (i: number): boolean => Math.abs(col.getX(i) - glass[0]) < 0.02 && Math.abs(col.getY(i) - glass[1]) < 0.02 && Math.abs(col.getZ(i) - glass[2]) < 0.02;
  for (let t = 0; t < pos.count; t += 3) {
    if (isGlass(t) && isGlass(t + 1) && isGlass(t + 2) && Math.abs(nor.getX(t) + nor.getX(t + 1) + nor.getX(t + 2)) / 3 > 0.7) continue;
    keep.push(t, t + 1, t + 2);
  }
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'color']) {
    const a = g.getAttribute(name), arr = new Float32Array(keep.length * 3);
    keep.forEach((v, k) => { arr[k * 3] = a.getX(v); arr[k * 3 + 1] = a.getY(v); arr[k * 3 + 2] = a.getZ(v); });
    out.setAttribute(name, new THREE.BufferAttribute(arr, 3));
  }
  g.dispose();
  return out;
}
/** Bus cabin seen through the open windows: an inward-facing liner (floor, walls, ceiling), seat rows each side of a centre aisle and two hand rails. ~180-260 triangles. */
export function busInterior(L: number, H: number, w: number, y0: number, mini: boolean): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [], iw = w - 0.015, z0 = -L / 2 + 0.03, z1 = L / 2 - 0.13, yb = y0 + 0.05, yt = y0 + H * 0.93;
  const liner = new THREE.BoxGeometry(iw * 2, yt - yb, z1 - z0).translate(0, (yt + yb) / 2, (z0 + z1) / 2);
  const ix = liner.getIndex()!; for (let i = 0; i < ix.count; i += 3) { const a = ix.getX(i + 1); ix.setX(i + 1, ix.getX(i + 2)); ix.setX(i + 2, a); } // faces point inwards
  liner.computeVertexNormals();
  out.push(paint(liner, rgb(0xc4cbd3))); // light cabin walls: the dark glass-side seats read against them at iso zoom (5-6)
  out.push(box(iw * 2 - 0.01, 0.01, z1 - z0 - 0.01, rgb(0x6c727a), 0, yb + 0.006, (z0 + z1) / 2)); // aisle floor
  const seat = rgb(0xd9893a), rail = rgb(0xc9ced4), n = mini ? 4 : 7, step = (z1 - z0 - 0.14) / n;
  for (let k = 0; k < n; k++) for (const sx of [1, -1]) out.push(box(0.11, 0.15, 0.075, seat, sx * (iw - 0.07), yb + 0.09, z0 + 0.1 + k * step));
  for (const sx of [1, -1]) out.push(box(0.008, 0.008, z1 - z0 - 0.1, rail, sx * 0.045, yt - 0.03, (z0 + z1) / 2));
  return out;
}
/** Coach / shuttle minibus. */
export function buildBus(mini: boolean, colorHex: number, low = false): ModelParts {
  const L = mini ? 1.0 : 1.55, H = mini ? 0.42 : 0.52, w = mini ? 0.21 : 0.24, y0 = 0.08;
  const pal: Palette = { ...BASE_PAL(0xf4f4f4), stripe: rgb(colorHex), body: rgb(0xf4f4f4) };
  const secs: Sec[] = [{ z: -L / 2, w: w * 0.9, y0: y0 + 0.01, y1: y0 + H * 0.97 }, ...windowSecs(-L / 2 + 0.01, L / 2 - 0.12, w, y0, y0 + H, low ? (mini ? 4 : 6) : mini ? 6 : 10), { z: L / 2 - 0.04, w: w * 0.98, y0, y1: y0 + H * 0.96 }, { z: L / 2, w: w * 0.88, y0: y0 + 0.02, y1: y0 + H * 0.78 }];
  let shell = loft(secs, BUS_RING, pal, 'glass', 'body');
  const parts: THREE.BufferGeometry[] = [];
  if (!low) { shell = openWindows(shell, pal.glass!); parts.push(...busInterior(L, H, w, y0, mini)); }
  parts.unshift(shell);
  if (!low) { // a driver at the wheel: head + shoulders painted on the windscreen (the loft is opaque), on the right-hand side of the nose
    const dx = w * 0.45;
    parts.push(box(0.07, 0.05, 0.004, rgb(0x35609a), dx, y0 + H * 0.5, L / 2 + 0.003), box(0.04, 0.04, 0.004, rgb(0xe3b896), dx, y0 + H * 0.5 + 0.045, L / 2 + 0.004), box(0.045, 0.014, 0.005, rgb(0x2c2f34), dx, y0 + H * 0.5 + 0.083, L / 2 + 0.004));
  }
  const r = 0.085, tire = rgb(0x151618), hub = rgb(0x9aa0a8);
  const zs = mini ? [0.3, -0.3] : [0.5, -0.45, -0.62];
  for (const z of zs) for (const sx of [1, -1]) {
    parts.push(...wheel(r, 0.07, sx * (w - 0.01), r, z, tire, hub));
    parts.push(disc(r * 1.28, 12, sx * (w + 0.003), r + 0.01, z, sx as 1 | -1, rgb(0x1c1d20), 0, true)); // wheel arch, upper half only (M8)
  }
  // coach details (M8): side mirrors, roof hatches, door outline, front bumper + grille, rear engine grille
  for (const sx of [1, -1]) {
    parts.push(box(0.03, 0.05, 0.02, rgb(0x2c2f34), sx * (w + 0.03), y0 + H * 0.78, L / 2 - 0.1), box(0.05, 0.004, 0.012, rgb(0x2c2f34), sx * (w + 0.015), y0 + H * 0.8, L / 2 - 0.1));
    parts.push(box(0.006, H * 0.6, mini ? 0.09 : 0.11, rgb(0x9aa3ad), sx * (w + 0.002), y0 + H * 0.38, L / 2 - (mini ? 0.2 : 0.26))); // door
  }
  for (const zz of mini ? [0.0] : [0.2, -0.25]) parts.push(box(0.16, 0.012, 0.14, rgb(0xc9ced4), 0, y0 + H + 0.004, zz)); // roof hatch
  parts.push(box(w * 1.7, 0.04, 0.03, rgb(0x2c2f34), 0, y0 + 0.03, L / 2 + 0.002), box(w * 1.0, 0.04, 0.012, rgb(0x1c1d20), 0, y0 + 0.14, L / 2 - 0.0), box(w * 1.2, 0.05, 0.015, rgb(0x1c1d20), 0, y0 + 0.2, -L / 2 - 0.002));
  const lights = lightGeo([[0.07, 0.04, 0.012, 0.13, y0 + 0.1, L / 2 - 0.0, HEAD], [0.07, 0.04, 0.012, -0.13, y0 + 0.1, L / 2 - 0.0, HEAD], [0.06, 0.04, 0.012, 0.14, y0 + 0.14, -L / 2 - 0.0, TAIL], [0.06, 0.04, 0.012, -0.14, y0 + 0.14, -L / 2 - 0.0, TAIL]]);
  return { body: snowMask(merge(parts), y0 + H * 0.9), lights, foot: [w + 0.06, L / 2 + 0.06] };
}

const TRAIN_RING: Ring = [[0.9, 0, 'dark'], [1, 0.1, 'body'], [1, 0.3, 'body'], [1, 0.34, 'glass'], [1, 0.74, 'glass'], [1, 0.78, 'body'], [0.84, 0.96, 'roofc'], [0.45, 1, 'roofc']];
function carriage(zc: number, len: number, loco: boolean): THREE.BufferGeometry[] {
  const w = 0.25, y0 = 0.12, H = 0.5;
  const pal: Palette = { ...BASE_PAL(loco ? 0xc93a32 : 0xf0f2f4), roofc: rgb(0x6c727a), body: rgb(loco ? 0xc93a32 : 0xf0f2f4), stripe: rgb(0xe8b93a) };
  const secs: Sec[] = loco
    ? [{ z: -len / 2, w: w * 0.95, y0, y1: y0 + H * 0.96 }, ...windowSecs(-len / 2 + 0.01, len / 2 - 0.3, w, y0, y0 + H, 3), { z: len / 2 - 0.22, w: w * 0.99, y0, y1: y0 + H * 0.96 }, { z: len / 2 - 0.08, w: w * 0.92, y0: y0 + 0.02, y1: y0 + H * 0.88 }, { z: len / 2, w: w * 0.78, y0: y0 + 0.05, y1: y0 + H * 0.7 }]
    : [{ z: -len / 2, w: w * 0.96, y0, y1: y0 + H * 0.97 }, ...windowSecs(-len / 2 + 0.01, len / 2 - 0.01, w, y0, y0 + H, 6), { z: len / 2, w: w * 0.96, y0, y1: y0 + H * 0.97 }];
  const out = [loft(secs, TRAIN_RING, pal, loco ? 'glass' : 'body', 'body')];
  for (const z of [len * 0.3, -len * 0.3]) for (const sx of [1, -1]) out.push(...wheel(0.06, 0.04, sx * 0.17, 0.07, z, rgb(0x1c1d20), rgb(0x7a7f87), 8));
  out.push(box(0.4, 0.04, len * 0.8, rgb(0x2c2f34), 0, 0.1, 0)); // underframe
  for (const sx of [1, -1]) for (const dz of [len * 0.18, -len * 0.18]) out.push(box(0.006, 0.34, 0.12, rgb(loco ? 0x7a2420 : 0x6c727a), sx * (w + 0.002), y0 + 0.2, dz * 1.0)); // doors (M8)
  for (const dz of loco ? [-0.2] : [0.3, -0.3]) out.push(paint(new THREE.CylinderGeometry(0.05, 0.05, 0.22, 8).rotateX(Math.PI / 2).translate(0, y0 + H + 0.02, dz), rgb(0xc9ced4))); // roof AC pods
  if (!loco) out.push(box(0.3, 0.3, 0.02, rgb(0x2c2f34), 0, y0 + 0.24, len / 2 + 0.03)); // gangway bellows
  if (loco) { // pantograph
    const y = y0 + H;
    out.push(box(0.2, 0.01, 0.02, rgb(0x2c2f34), 0, y + 0.2, -0.1), box(0.012, 0.2, 0.012, rgb(0x2c2f34), 0.05, y + 0.1, -0.12, 0.35), box(0.012, 0.2, 0.012, rgb(0x2c2f34), -0.05, y + 0.1, -0.12, -0.35), box(0.14, 0.02, 0.12, rgb(0x6c727a), 0, y + 0.01, -0.1));
  }
  out.forEach((g) => g.translate(0, 0, zc));
  return out;
}
export function buildTrain(): ModelParts {
  const parts = [...carriage(1.55, 1.4, true), ...carriage(0, 1.4, false), ...carriage(-1.55, 1.4, false)];
  parts.push(box(0.04, 0.03, 0.16, rgb(0x2c2f34), 0, 0.14, 0.775), box(0.04, 0.03, 0.15, rgb(0x2c2f34), 0, 0.14, -0.775));
  const lights = lightGeo([[0.08, 0.05, 0.012, 0.1, 0.3, 2.26, HEAD], [0.08, 0.05, 0.012, -0.1, 0.3, 2.26, HEAD], [0.08, 0.04, 0.012, 0.1, 0.3, -2.26, TAIL], [0.08, 0.04, 0.012, -0.1, 0.3, -2.26, TAIL]]);
  return { body: snowMask(merge(parts), 0.19), lights, foot: [0.38, 2.4] };
}

/** The Altiport arrival plane: the shared lofted high-wing utility plane (meshes/aircraft.ts), forward = +z; the spinner + propeller blades spin as the `prop` part. */
export function buildPlane(): ModelParts {
  const a = buildAircraft('full');
  const pv = new THREE.Matrix4().makeTranslation(-a.propPivot[0], -a.propPivot[1], -a.propPivot[2]);
  const lights = lightGeo(a.lights.map((l) => [l.s[0], l.s[1], l.s[2], l.c[0], l.c[1], l.c[2], l.rgb] as [number, number, number, number, number, number, Rgb]));
  return { body: mergeParts(a.body), lights, prop: mergeParts([...xformParts(a.spinner, pv), ...a.blades]), propPivot: a.propPivot };
}
