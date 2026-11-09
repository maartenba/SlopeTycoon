import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Small, pure geometry kit for smooth aircraft and canopies (render only, deterministic, no RNG): a `sweep` lofts a list of closed rings into a rounded surface
 * with SMOOTH vertex normals and bins the faces by a colour function (so livery stripes, windows and cell panels are crisp while the shading stays round).
 * Everything returns `AirPart`s (one geometry per colour) that callers either merge into one vertex-coloured mesh (`mergeParts`: no extra draw call) or
 * feed to a PartBuilder colour by colour. Axes of the helpers: free; the aircraft use +z forward, y up, x span.
 */
export type V3 = [number, number, number];
export interface AirPart { geo: THREE.BufferGeometry; color: number; glass?: boolean }
export const spow = (v: number, e: number): number => Math.sign(v) * Math.pow(Math.abs(v), e);

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const centroid = (ps: V3[]): V3 => { const c: V3 = [0, 0, 0]; for (const p of ps) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; } return [c[0] / ps.length, c[1] / ps.length, c[2] / ps.length]; };

/** Colour (hex) for a face given its centroid and unit normal, the ring pair index `a` (face between rings a and a+1; -1 for an end cap) and the loop point index `k` (face between loop points k and k+1). */
export type ColorFn = (c: V3, n: V3, a: number, k: number) => number;

/**
 * Lofts `rings` (each a closed loop of the same point count) into a surface. Every face is wound outward (relative to the rings' centre line), vertex normals are
 * smoothed over the shared ring vertices, the end caps (flat, own vertices) close the shape. Faces are split into one geometry per colour.
 */
export function sweep(rings: V3[][], colorOf: ColorFn, caps = true): AirPart[] {
  const R = rings.length, N = rings[0]!.length;
  const pos: number[] = [];
  for (const r of rings) for (const p of r) pos.push(p[0], p[1], p[2]);
  const cs = rings.map(centroid);
  const idx: number[] = [], faceA: number[] = [], faceK: number[] = [];
  const P = (i: number): V3 => [pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!];
  let curA = -1, curK = -1;
  const pushTri = (a: number, b: number, c: number, out: V3): void => {
    faceA.push(curA); faceK.push(curK);
    const pa = P(a), pb = P(b), pc = P(c), n = cross(sub(pb, pa), sub(pc, pa));
    if (dot(n, out) < 0) idx.push(a, c, b); else idx.push(a, b, c);
  };
  for (let a = 0; a + 1 < R; a++) {
    const mid = centroid([cs[a]!, cs[a + 1]!]);
    for (let k = 0; k < N; k++) {
      curA = a; curK = k;
      const k2 = (k + 1) % N, p = a * N + k, p2 = a * N + k2, q = (a + 1) * N + k, q2 = (a + 1) * N + k2;
      pushTri(p, q, p2, sub(centroid([P(p), P(q), P(p2)]), mid)); pushTri(p2, q, q2, sub(centroid([P(p2), P(q), P(q2)]), mid));
    }
  }
  if (caps) {
    curA = -1; curK = -1;
    const cap = (ri: number, away: V3): void => {
      const base = pos.length / 3, c = cs[ri]!;
      pos.push(c[0], c[1], c[2]);
      for (const p of rings[ri]!) pos.push(p[0], p[1], p[2]);
      for (let k = 0; k < N; k++) pushTri(base, base + 1 + k, base + 1 + ((k + 1) % N), away);
    };
    cap(0, sub(cs[0]!, cs[Math.min(1, R - 1)]!)); cap(R - 1, sub(cs[R - 1]!, cs[Math.max(0, R - 2)]!));
  }
  // smooth vertex normals (area weighted)
  const nrm = new Float32Array(pos.length);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i]!, b = idx[i + 1]!, c = idx[i + 2]!, n = cross(sub(P(b), P(a)), sub(P(c), P(a)));
    for (const v of [a, b, c]) for (let k = 0; k < 3; k++) nrm[v * 3 + k] = nrm[v * 3 + k]! + n[k]!;
  }
  for (let v = 0; v < nrm.length / 3; v++) { const l = Math.hypot(nrm[v * 3]!, nrm[v * 3 + 1]!, nrm[v * 3 + 2]!) || 1; for (let k = 0; k < 3; k++) nrm[v * 3 + k] = nrm[v * 3 + k]! / l; }
  // bin faces by colour (insertion order = first appearance: deterministic)
  const bins = new Map<number, number[]>();
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i]!, b = idx[i + 1]!, c = idx[i + 2]!, pa = P(a), pb = P(b), pc = P(c);
    const fn = norm(cross(sub(pb, pa), sub(pc, pa)));
    const col = colorOf(centroid([pa, pb, pc]), fn, faceA[i / 3]!, faceK[i / 3]!);
    let list = bins.get(col); if (!list) { list = []; bins.set(col, list); }
    list.push(a, b, c);
  }
  const out: AirPart[] = [];
  for (const [color, list] of bins) {
    const p = new Float32Array(list.length * 3), n = new Float32Array(list.length * 3), uv = new Float32Array(list.length * 2);
    list.forEach((v, i) => { uv[i * 2] = pos[v * 3]! + pos[v * 3 + 2]!; uv[i * 2 + 1] = pos[v * 3 + 1]!; p[i * 3] = pos[v * 3]!; p[i * 3 + 1] = pos[v * 3 + 1]!; p[i * 3 + 2] = pos[v * 3 + 2]!; n[i * 3] = nrm[v * 3]!; n[i * 3 + 1] = nrm[v * 3 + 1]!; n[i * 3 + 2] = nrm[v * 3 + 2]!; });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('normal', new THREE.BufferAttribute(n, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.push({ geo: g, color });
  }
  return out;
}

const ringPts = (seg: number): Array<[number, number]> => Array.from({ length: seg }, (_, i) => { const t = (i / seg) * Math.PI * 2; return [Math.cos(t), Math.sin(t)] as [number, number]; });

/** Tube along a path with per-point radii (open ends unless `caps`): struts, legs, lines, spars. */
export function tube(points: V3[], radii: number[], seg: number, color: number, caps = false): AirPart[] {
  const rings: V3[][] = points.map((p, i) => {
    const t = norm(sub(points[Math.min(points.length - 1, i + 1)]!, points[Math.max(0, i - 1)]!));
    const up: V3 = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = norm(cross(t, up)), v = cross(t, u), r = radii[Math.min(i, radii.length - 1)]!;
    return ringPts(seg).map(([c, s]) => [p[0] + r * (c * u[0] + s * v[0]), p[1] + r * (c * u[1] + s * v[1]), p[2] + r * (c * u[2] + s * v[2])] as V3);
  });
  return sweep(rings, () => color, caps);
}

/** Ellipsoid (rounded blob) centred at c with radii r, long axis `axis`, `rings` rings (flat caps at both poles). */
export function blob(c: V3, r: V3, seg: number, rings: number, color: number, axis: 'x' | 'y' | 'z' = 'z', colorOf?: ColorFn): AirPart[] {
  const rs: V3[][] = [];
  for (let k = 0; k < rings; k++) {
    const ph = (Math.PI * (k + 0.5)) / rings, z = Math.cos(ph) * r[2], rr = Math.sin(ph);
    rs.push(ringPts(seg).map(([co, si]) => {
      const lx = rr * r[0] * co, ly = rr * r[1] * si;
      const p: V3 = axis === 'z' ? [lx, ly, z] : axis === 'y' ? [lx, z, ly] : [z, ly, lx];
      return [c[0] + p[0], c[1] + p[1], c[2] + p[2]] as V3;
    }));
  }
  return sweep(rs, colorOf ?? (() => color), true);
}

/** Flat disc facing +/-z at c, both faces (a propeller blur). */
export function disc(c: V3, r: number, seg: number, color: number): AirPart[] {
  const out: AirPart[] = [];
  for (const dz of [0, 0.004]) {
    const verts: number[] = [], nor: number[] = [];
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2, s = dz === 0 ? 1 : -1;
      const tri = s > 0 ? [[0, 0], [Math.cos(a0), Math.sin(a0)], [Math.cos(a1), Math.sin(a1)]] : [[0, 0], [Math.cos(a1), Math.sin(a1)], [Math.cos(a0), Math.sin(a0)]];
      for (const [x, y] of tri as number[][]) { verts.push(c[0] + x! * r, c[1] + y! * r, c[2] + dz); nor.push(0, 0, s); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(seg * 6).fill(0), 2));
    out.push({ geo: g, color });
  }
  return out;
}

export interface WingOpts {
  /** Section positions 0..1 along the half span (first = root). */
  sections: number[]; halfSpan: number;
  /** Chord / leading-edge z (at the section's span fraction, BEFORE the rounded tip) and half-thickness ratio. */
  chord: (s: number) => number; zLE: (s: number) => number; thick: number;
  /** Rounded tip: from this span fraction on the chord shrinks like an ellipse (1 = no rounding). */
  tipFrom?: number;
  /** Airfoil points: `up` = u values (0 = leading edge .. 1 = trailing edge) along the top, `lo` = lower surface values (without the ends) from the trailing edge back to the nose (descending). */
  up: number[]; lo: number[];
  /** Maps (span coordinate, z, thickness offset) to a point. */
  place: (a: number, z: number, t: number) => V3;
  mirror: boolean;
  /** Extra thickness offset per section (a camber / droop), by span fraction. */
  drop?: (s: number) => number;
}
/** Airfoil half thickness profile (0 at both ends, rounded nose). */
const fth = (u: number): number => (Math.sqrt(u) * (1 - u)) / 0.385;
/** A rounded, tapered wing / stabiliser / fin as a closed loft; returns the rings so callers can colour by span. */
export function wingRings(o: WingOpts): V3[][] {
  const tf = o.tipFrom ?? 0.8;
  const ss = o.mirror ? [...o.sections.slice(1).reverse().map((s) => -s), ...o.sections] : o.sections;
  return ss.map((s) => {
    const as = Math.abs(s), c0 = o.chord(as), le0 = o.zLE(as), mid = le0 - c0 / 2;
    const k = as > tf ? Math.sqrt(Math.max(0.03, 1 - Math.pow((as - tf) / (1 - tf), 2) * 0.97)) : 1;
    const c = c0 * k, le = mid + c / 2, a = s * o.halfSpan, d = o.drop ? o.drop(as) : 0;
    const pts: V3[] = [];
    for (const u of o.up) pts.push(o.place(a, le - u * c, o.thick * c * fth(u) + d));
    for (const u of o.lo) pts.push(o.place(a, le - u * c, -o.thick * c * fth(u) + d));
    return pts;
  });
}

/** Vertex-coloured merge (colour attribute from each part's colour, multiplied nowhere: the colours are final). `scale` shrinks everything about the origin. */
export function mergeParts(parts: AirPart[], mat?: THREE.Matrix4): THREE.BufferGeometry {
  const gs = parts.map((p) => {
    const g = p.geo.clone(), n = g.getAttribute('position').count, c = new THREE.Color(p.color), a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3)); g.deleteAttribute('uv');
    return g;
  });
  const m = mergeGeometries(gs, false)!;
  gs.forEach((g) => g.dispose());
  if (mat) m.applyMatrix4(mat);
  return m;
}

/** Colour-bearing copy of the parts transformed by `mat` (the originals stay untouched). */
export function xformParts(parts: AirPart[], mat: THREE.Matrix4): AirPart[] {
  return parts.map((p) => { const g = p.geo.clone(); g.applyMatrix4(mat); return { ...p, geo: g }; });
}
export function triCount(parts: AirPart[]): number { return parts.reduce((s, p) => s + p.geo.getAttribute('position').count / 3, 0); }
