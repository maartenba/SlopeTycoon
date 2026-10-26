import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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
/** Wheel with a lighter hub; axis along x. */
function wheel(r: number, w: number, x: number, y: number, z: number, tire: Rgb, hub: Rgb, seg = 10): THREE.BufferGeometry[] {
  const t = new THREE.CylinderGeometry(r, r, w, Math.max(12, seg)); t.rotateZ(Math.PI / 2); t.translate(x, y, z);
  const hb = new THREE.CylinderGeometry(r * 0.55, r * 0.55, w + 0.004, 8); hb.rotateZ(Math.PI / 2); hb.translate(x, y, z);
  return [paint(t, tire), paint(hb, hub)];
}

const BASE_PAL = (body: number): Palette => ({
  body: rgb(body), glass: rgb(0x2b3d52), dark: rgb(0x1c1d20), trim: rgb(0x2c2f34), white: rgb(0xf0f2f4), stripe: rgb(0x3a78c2), roof: rgb(body),
});
export const CAR_COLORS = [0xf2f2f2, 0xb8bec6, 0x2a2d32, 0xc93a32, 0x2f5fa8, 0x3a7d4a, 0xe8b93a, 0xe0762c] as const;
export const SPORT_COLORS = [0xc93a32, 0xe8b93a, 0x2a2d32, 0xf2f2f2] as const;
export const CAR_STYLES = ['hatchback', 'sedan', 'suv', 'van', 'sports'] as const;
const CAR_RING_BODY: Ring = [[0.8, 0, 'trim'], [1, 0.28, 'body'], [1, 0.7, 'body'], [0.86, 1, 'body']];
const CAR_RING_CABIN: Ring = [[0.9, 0, 'glass'], [1, 0.2, 'glass'], [1, 0.82, 'glass'], [0.82, 0.95, 'roof'], [0.55, 1, 'roof']];

interface CarStyle { body: Sec[]; cabin: Sec[]; wheelR: number; wheelZ: number; wheelX: number; len: number; roofY: number }
const STYLES: CarStyle[] = [
  { // hatchback
    body: [{ z: -0.38, w: 0.17, y0: 0.07, y1: 0.16 }, { z: -0.32, w: 0.2, y0: 0.05, y1: 0.2 }, { z: 0.0, w: 0.2, y0: 0.05, y1: 0.215 }, { z: 0.3, w: 0.2, y0: 0.05, y1: 0.19 }, { z: 0.39, w: 0.17, y0: 0.07, y1: 0.14 }],
    cabin: [{ z: -0.31, w: 0.14, y0: 0.19, y1: 0.28 }, { z: -0.25, w: 0.175, y0: 0.2, y1: 0.33 }, { z: 0.03, w: 0.175, y0: 0.2, y1: 0.33 }, { z: 0.16, w: 0.15, y0: 0.2, y1: 0.27 }],
    wheelR: 0.072, wheelZ: 0.25, wheelX: 0.19, len: 0.78, roofY: 0.33,
  },
  { // sedan
    body: [{ z: -0.44, w: 0.17, y0: 0.07, y1: 0.17 }, { z: -0.38, w: 0.2, y0: 0.05, y1: 0.21 }, { z: 0.0, w: 0.205, y0: 0.05, y1: 0.215 }, { z: 0.34, w: 0.2, y0: 0.05, y1: 0.19 }, { z: 0.44, w: 0.17, y0: 0.07, y1: 0.14 }],
    cabin: [{ z: -0.26, w: 0.15, y0: 0.2, y1: 0.28 }, { z: -0.18, w: 0.178, y0: 0.2, y1: 0.325 }, { z: 0.08, w: 0.178, y0: 0.2, y1: 0.325 }, { z: 0.2, w: 0.15, y0: 0.2, y1: 0.265 }],
    wheelR: 0.074, wheelZ: 0.28, wheelX: 0.19, len: 0.88, roofY: 0.325,
  },
  { // SUV
    body: [{ z: -0.42, w: 0.2, y0: 0.09, y1: 0.24 }, { z: -0.38, w: 0.225, y0: 0.07, y1: 0.28 }, { z: 0.0, w: 0.225, y0: 0.07, y1: 0.29 }, { z: 0.34, w: 0.225, y0: 0.07, y1: 0.27 }, { z: 0.42, w: 0.2, y0: 0.09, y1: 0.22 }],
    cabin: [{ z: -0.38, w: 0.2, y0: 0.27, y1: 0.4 }, { z: -0.34, w: 0.21, y0: 0.28, y1: 0.43 }, { z: 0.14, w: 0.21, y0: 0.28, y1: 0.43 }, { z: 0.24, w: 0.185, y0: 0.28, y1: 0.36 }],
    wheelR: 0.09, wheelZ: 0.27, wheelX: 0.21, len: 0.84, roofY: 0.43,
  },
  { // van
    body: [{ z: -0.44, w: 0.2, y0: 0.08, y1: 0.28 }, { z: -0.4, w: 0.215, y0: 0.06, y1: 0.33 }, { z: 0.1, w: 0.215, y0: 0.06, y1: 0.34 }, { z: 0.36, w: 0.2, y0: 0.07, y1: 0.28 }, { z: 0.45, w: 0.18, y0: 0.08, y1: 0.2 }],
    cabin: [{ z: -0.42, w: 0.2, y0: 0.31, y1: 0.43 }, { z: -0.38, w: 0.208, y0: 0.32, y1: 0.46 }, { z: 0.22, w: 0.208, y0: 0.32, y1: 0.46 }, { z: 0.36, w: 0.19, y0: 0.31, y1: 0.36 }],
    wheelR: 0.078, wheelZ: 0.28, wheelX: 0.2, len: 0.9, roofY: 0.46,
  },
  { // sports
    body: [{ z: -0.43, w: 0.18, y0: 0.06, y1: 0.14 }, { z: -0.37, w: 0.21, y0: 0.045, y1: 0.17 }, { z: 0.0, w: 0.215, y0: 0.045, y1: 0.165 }, { z: 0.3, w: 0.21, y0: 0.045, y1: 0.15 }, { z: 0.44, w: 0.17, y0: 0.055, y1: 0.1 }],
    cabin: [{ z: -0.24, w: 0.15, y0: 0.15, y1: 0.21 }, { z: -0.12, w: 0.18, y0: 0.155, y1: 0.255 }, { z: 0.08, w: 0.18, y0: 0.155, y1: 0.255 }, { z: 0.22, w: 0.15, y0: 0.15, y1: 0.19 }],
    wheelR: 0.068, wheelZ: 0.29, wheelX: 0.2, len: 0.88, roofY: 0.255,
  },
];

export interface ModelParts { body: THREE.BufferGeometry; lights: THREE.BufferGeometry; prop?: THREE.BufferGeometry; propPivot?: [number, number, number] }
const merge = (gs: THREE.BufferGeometry[]): THREE.BufferGeometry => {
  const m = mergeGeometries(gs, false)!;
  gs.forEach((g) => g.dispose());
  return m;
};
const lightGeo = (items: Array<[number, number, number, number, number, number, Rgb]>): THREE.BufferGeometry => merge(items.map(([w, h, d, x, y, z, c]) => box(w, h, d, c, x, y, z)));
const HEAD: Rgb = [1, 0.96, 0.8], TAIL: Rgb = [0.9, 0.08, 0.06], WHITE_GLOW: Rgb = [1, 1, 1];
void WHITE_GLOW;

/** rack: 0 none, 1 skis (winter), 2 bike (summer). style: 0..4, colour index into CAR_COLORS / SPORT_COLORS. */
export function buildCar(style: number, colorHex: number, rack: number): ModelParts {
  const st = STYLES[style % STYLES.length]!;
  const pal = BASE_PAL(colorHex);
  const parts: THREE.BufferGeometry[] = [loft(st.body, CAR_RING_BODY, pal, 'body', 'body'), loft(st.cabin, CAR_RING_CABIN, pal, 'glass', 'glass')];
  const tire = rgb(0x151618), hub = rgb(0x9aa0a8);
  for (const sx of [1, -1]) for (const sz of [1, -1]) parts.push(...wheel(st.wheelR, 0.055, sx * st.wheelX, st.wheelR, sz * st.wheelZ, tire, hub));
  // bumpers + grille line
  const hw = st.body[st.body.length - 1]!.w;
  parts.push(box(hw * 1.9, 0.03, 0.02, rgb(0x2c2f34), 0, st.body[0]!.y0 + 0.02, st.len / 2 - 0.005), box(hw * 1.9, 0.03, 0.02, rgb(0x2c2f34), 0, st.body[0]!.y0 + 0.02, -st.len / 2 + 0.005));
  if (rack === 1) {
    const y = st.roofY + 0.012;
    parts.push(box(0.3, 0.012, 0.015, rgb(0x2c2f34), 0, y, -0.08), box(0.3, 0.012, 0.015, rgb(0x2c2f34), 0, y, 0.06));
    parts.push(box(0.028, 0.016, 0.6, rgb(0xd83a34), -0.045, y + 0.014, 0), box(0.028, 0.016, 0.6, rgb(0x2f6fd0), 0.045, y + 0.014, 0));
  } else if (rack === 2) {
    const y = st.roofY + 0.07;
    parts.push(box(0.3, 0.012, 0.015, rgb(0x2c2f34), 0, st.roofY + 0.012, -0.08), box(0.3, 0.012, 0.015, rgb(0x2c2f34), 0, st.roofY + 0.012, 0.06));
    for (const z of [-0.14, 0.14]) parts.push(...wheel(0.06, 0.02, 0, y, z, rgb(0x151618), rgb(0xb8bec6), 8));
    parts.push(box(0.014, 0.014, 0.3, rgb(0xd83a34), 0, y + 0.03, 0));
  }
  const z0 = st.len / 2 - 0.003, lw = hw * 0.72, ly = st.body[0]!.y1 - 0.012;
  const lights = lightGeo([
    [0.07, 0.035, 0.012, lw * 0.62, ly, z0, HEAD], [0.07, 0.035, 0.012, -lw * 0.62, ly, z0, HEAD],
    [0.06, 0.03, 0.012, lw * 0.62, ly + 0.0, -z0, TAIL], [0.06, 0.03, 0.012, -lw * 0.62, ly + 0.0, -z0, TAIL],
  ]);
  return { body: merge(parts), lights };
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
/** Coach / shuttle minibus. */
export function buildBus(mini: boolean, colorHex: number): ModelParts {
  const L = mini ? 1.0 : 1.55, H = mini ? 0.42 : 0.52, w = mini ? 0.21 : 0.24, y0 = 0.08;
  const pal: Palette = { ...BASE_PAL(0xf4f4f4), stripe: rgb(colorHex), body: rgb(0xf4f4f4) };
  const secs: Sec[] = [{ z: -L / 2, w: w * 0.9, y0: y0 + 0.01, y1: y0 + H * 0.97 }, ...windowSecs(-L / 2 + 0.01, L / 2 - 0.12, w, y0, y0 + H, mini ? 6 : 10), { z: L / 2 - 0.04, w: w * 0.98, y0, y1: y0 + H * 0.96 }, { z: L / 2, w: w * 0.88, y0: y0 + 0.02, y1: y0 + H * 0.78 }];
  const parts = [loft(secs, BUS_RING, pal, 'glass', 'body')];
  const r = 0.085, tire = rgb(0x151618), hub = rgb(0x9aa0a8);
  const zs = mini ? [0.3, -0.3] : [0.5, -0.45, -0.62];
  for (const z of zs) for (const sx of [1, -1]) parts.push(...wheel(r, 0.07, sx * (w - 0.01), r, z, tire, hub));
  const lights = lightGeo([[0.07, 0.04, 0.012, 0.13, y0 + 0.1, L / 2 - 0.0, HEAD], [0.07, 0.04, 0.012, -0.13, y0 + 0.1, L / 2 - 0.0, HEAD], [0.06, 0.04, 0.012, 0.14, y0 + 0.14, -L / 2 - 0.0, TAIL], [0.06, 0.04, 0.012, -0.14, y0 + 0.14, -L / 2 - 0.0, TAIL]]);
  return { body: merge(parts), lights };
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
  return { body: merge(parts), lights };
}

const PLANE_RING: Ring = [[0.5, 0, 'white'], [0.9, 0.18, 'white'], [1, 0.4, 'white'], [1, 0.62, 'glass'], [0.8, 0.88, 'white'], [0.4, 1, 'white']];
export function buildPlane(): ModelParts {
  const pal: Palette = { ...BASE_PAL(0xf4f4f4), stripe: rgb(0x2f6fd0) };
  const fus = loft([{ z: -0.95, w: 0.025, y0: 0.4, y1: 0.46 }, { z: -0.6, w: 0.06, y0: 0.33, y1: 0.47 }, { z: -0.1, w: 0.14, y0: 0.2, y1: 0.46 }, { z: 0.35, w: 0.14, y0: 0.2, y1: 0.46 }, { z: 0.62, w: 0.11, y0: 0.24, y1: 0.43 }, { z: 0.74, w: 0.05, y0: 0.29, y1: 0.4 }], PLANE_RING, pal, 'body', 'body');
  const blue = rgb(0x2f6fd0), white = rgb(0xf4f4f4);
  const parts: THREE.BufferGeometry[] = [fus,
    box(1.0, 0.035, 0.34, white, 0.5, 0.42, 0.12, 0), box(1.0, 0.035, 0.34, white, -0.5, 0.42, 0.12, 0),
    box(0.12, 0.036, 0.35, blue, 1.0, 0.425, 0.12), box(0.12, 0.036, 0.35, blue, -1.0, 0.425, 0.12),
    box(0.03, 0.3, 0.22, blue, 0, 0.58, -0.78), box(0.55, 0.03, 0.17, white, 0, 0.44, -0.8),
    box(0.285, 0.04, 0.5, blue, 0, 0.32, 0.1), // belly stripe
  ];
  for (const sx of [1, -1]) parts.push(...wheel(0.05, 0.03, sx * 0.14, 0.05, 0.38, rgb(0x151618), rgb(0xb8bec6), 8), box(0.02, 0.17, 0.02, rgb(0x2c2f34), sx * 0.12, 0.13, 0.36));
  parts.push(...wheel(0.035, 0.025, 0, 0.035, -0.72, rgb(0x151618), rgb(0xb8bec6), 8));
  const lights = lightGeo([[0.04, 0.03, 0.02, 1.07, 0.43, 0.12, TAIL], [0.04, 0.03, 0.02, -1.07, 0.43, 0.12, [0.1, 0.9, 0.2]], [0.05, 0.03, 0.02, 0, 0.62, -0.9, [1, 1, 1]]]);
  const prop = merge([box(0.07, 0.5, 0.012, rgb(0x1c1d20), 0, 0, 0), box(0.5, 0.07, 0.012, rgb(0x1c1d20), 0, 0, 0)]);
  prop.rotateZ(Math.PI / 4);
  const spin = paint(new THREE.ConeGeometry(0.045, 0.1, 8).rotateX(Math.PI / 2).translate(0, 0, 0.05), rgb(0x2f6fd0));
  return { body: merge(parts), lights, prop: merge([prop, spin]), propPivot: [0, 0.33, 0.76] };
}
