import * as THREE from 'three';
import { MIN_THIN, type Layer, type PartBuilder } from '../common';

/**
 * M8 lane D helpers: smooth lofted carrier shells (bubble hoods, gondola hulls) and one-piece curved tubes.
 * Pure geometry, deterministic, no allocation beyond the returned buffers. Everything is merged through PartBuilder, so it adds no draw calls.
 */

const spow = (v: number, e: number): number => Math.sign(v) * Math.pow(Math.abs(v), e);

export interface HullOpts {
  /** Length along z, width along x, height along y (hull is centred on the origin). */
  L: number; W: number; H: number;
  /** Rings along z / segments around the cross-section. */
  rings?: number; seg?: number;
  /** Plan superellipse exponent (2 = oval, 4 = rounded rectangle) and cross-section exponent (3 = soft rounded rectangle). */
  plan?: number; sec?: number;
  /** How much the lower half narrows (0 none, 0.25 = tapered shell). */
  taper?: number;
}

export interface HullBand { lo: number; hi: number; color: number; layer: Layer }

/**
 * Lofted hull: a rounded-rectangle plan (superellipse) with a rounded-rectangle cross-section, the lower shell tapered, ends closed by a rounded nose.
 * The surface is split into vertical bands by the section height fraction (-1 bottom .. +1 top): each band has its own colour / layer (shell, branding stripe,
 * glass band, roof) while vertices and smooth normals are shared, so the bands join without a lighting seam. Returns the vertical half extent used.
 */
export function addHull(b: PartBuilder, cx: number, cy: number, cz: number, o: HullOpts, bands: HullBand[]): void {
  const M = o.rings ?? 8, N = o.seg ?? 20, plan = o.plan ?? 4, ex = 2 / (o.sec ?? 3), taper = o.taper ?? 0.22;
  const pos = new Float32Array((M + 1) * N * 3), uv = new Float32Array((M + 1) * N * 2), py = new Float32Array((M + 1) * N);
  for (let j = 0; j <= M; j++) {
    const t = Math.sin(-Math.PI / 2 + (Math.PI * j) / M);
    const g = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(t), plan)), 1 / plan);
    for (let i = 0; i < N; i++) {
      const th = (2 * Math.PI * i) / N, px = spow(Math.cos(th), ex), qy = spow(Math.sin(th), ex);
      const k = 1 - taper * Math.pow(Math.max(0, -qy), 1.5), n = j * N + i;
      pos[n * 3] = (o.W / 2) * g * px * k;
      pos[n * 3 + 1] = (o.H / 2) * qy * (0.55 + 0.45 * g);
      pos[n * 3 + 2] = (o.L / 2) * t;
      uv[n * 2] = i / N; uv[n * 2 + 1] = j / M; py[n] = qy;
    }
  }
  const idx: number[][] = bands.map(() => []);
  for (let j = 0; j < M; j++) for (let i = 0; i < N; i++) {
    const a = j * N + i, bb = j * N + ((i + 1) % N), c = (j + 1) * N + i, d = (j + 1) * N + ((i + 1) % N);
    const m = (py[a]! + py[bb]! + py[c]! + py[d]!) / 4;
    const k = bands.findIndex((bd) => m >= bd.lo && m < bd.hi);
    if (k >= 0) idx[k]!.push(a, bb, c, bb, d, c);
  }
  const full = new THREE.BufferGeometry();
  full.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  full.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  full.setIndex(idx.flat());
  full.computeVertexNormals(); // smooth over the shared vertices (computed once on the whole hull so band borders do not show)
  const normal = full.getAttribute('normal');
  bands.forEach((bd, k) => {
    if (!idx[k]!.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', full.getAttribute('position'));
    g.setAttribute('normal', normal);
    g.setAttribute('uv', full.getAttribute('uv'));
    g.setIndex(idx[k]!);
    b.add(g, bd.layer, bd.color, cx, cy, cz);
  });
}

/** Half-width of a hull at height fraction ~0 and the given z (for placing seams): mirrors the plan superellipse in `addHull`. */
export function hullHalfWidth(W: number, L: number, z: number, plan = 4): number {
  const t = Math.min(1, Math.abs((2 * z) / L));
  return (W / 2) * Math.pow(Math.max(0, 1 - Math.pow(t, plan)), 1 / plan);
}

/**
 * Swept bubble hood over a chair bench: a half superellipsoid, long axis z, closed and rounded at the back, rounded in plan and profile,
 * open at the front (the riders' face) and underneath. `a` half width, `hgt` height, `len` length from the front opening to the back.
 */
export function addHood(b: PartBuilder, cx: number, yBase: number, cz: number, a: number, hgt: number, len: number, color: number, rings = 7, seg = 12, layer: Layer = 'glass'): void {
  const phi0 = 0.5, pos = new Float32Array((rings + 1) * (seg + 1) * 3), uv = new Float32Array((rings + 1) * (seg + 1) * 2);
  const c = len / (1 + Math.cos(phi0)) / 1; // z = zc + c cos(phi): front at phi0 .. back at pi
  const zc = cz + len / 2 - c * Math.cos(phi0);
  for (let j = 0; j <= rings; j++) {
    const phi = phi0 + ((Math.PI - phi0) * j) / rings, f = Math.pow(Math.sin(phi), 0.6);
    for (let i = 0; i <= seg; i++) {
      const psi = (Math.PI * i) / seg, n = j * (seg + 1) + i;
      pos[n * 3] = cx + a * f * spow(Math.cos(psi), 0.667);
      pos[n * 3 + 1] = yBase + hgt * f * spow(Math.sin(psi), 0.667);
      pos[n * 3 + 2] = zc + c * Math.cos(phi) * (0.8 + 0.2 * f);
      uv[n * 2] = i / seg; uv[n * 2 + 1] = j / rings;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
    const p = j * (seg + 1) + i, q = (j + 1) * (seg + 1) + i;
    idx.push(p, q, p + 1, q, q + 1, p + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  b.add(g, layer, color, 0, 0, 0);
}

/** One-piece curved tube through the given points (Catmull-Rom): hanger arms, arched grips, rails. tub x rad x 2 triangles. */
export function curveTube(b: PartBuilder, pts: Array<[number, number, number]>, r: number, color: number, layer: Layer = 'stone', tub = 12, rad = 5): PartBuilder {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'catmullrom', 0.5);
  return b.add(new THREE.TubeGeometry(curve, tub, Math.max(r, MIN_THIN / 2), rad, false), layer, color, 0, 0, 0);
}
