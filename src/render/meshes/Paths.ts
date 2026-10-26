import * as THREE from 'three';
import { CHUNK_SIZE, type Grid } from '../../world/Grid';
import { Conn, Layer, type Networks } from '../../world/Networks';
import { HEIGHT_UNIT } from '../../config/balance';
import { diagonalNS } from '../TerrainGeometry';

const NET_LIFT = 0.06;
/** Shared 0..1 night factor for the road / path / rail material (set by main with Lighting.nightUniform): lifts dark asphalt out of near-black. */
export const NET_NIGHT = { value: 0 };
/** Night floor: faint cool emissive + a little of the albedo so asphalt (albedo ~0.07) reads as dark grey-blue, not black. Added to the radiance in linear space. */
export const NET_NIGHT_GLSL = 'totalEmissiveRadiance += (diffuseColor.rgb * 0.06 + vec3(0.010, 0.013, 0.026)) * uNetNight;';
const MARK_LIFT = 0.085;
const DECAL_LIFT = 0.06; // draped decal vertices sit on the surface, but their sub-quad triangles cut across the tile's diagonal crease: extra lift keeps ridge creases from burying half-tiles
const BRIDGE_LIFT = 0.18;
const HALF_W: Record<number, number> = { 1: 0.22, 2: 0.36, 3: 0.2 };
/** Atlas cell per kind (u offset in quarters); cell 3 is plain white (lane markings, tinted by vertex colour). */
const CELL: Record<number, number> = { 1: 0, 2: 1, 3: 2 };
const MARK_CELL = 3;
const CELLS = 4;
const SUBDIV = 4;
export const DIFF_COLORS = [0x2ecc40, 0x2a6fdb, 0xe0302a, 0x1b1b1f];

export interface GeoData { positions: number[]; uvs: number[]; colors: number[]; indices: number[] }
const empty = (): GeoData => ({ positions: [], uvs: [], colors: [], indices: [] });

/**
 * Height of the terrain surface exactly as the terrain mesh triangulates it (each tile = 2 planar triangles split
 * along the diagonal chosen by diagonalNS). Using this (not bilinear) keeps roads on the visible surface, so they
 * never sink into the terrain at tile corners.
 */
export function surfaceHeightAt(grid: Grid, x: number, z: number): number {
  const tx = Math.min(grid.size - 1, Math.max(0, Math.floor(x)));
  const ty = Math.min(grid.size - 1, Math.max(0, Math.floor(z)));
  const u = Math.min(1, Math.max(0, x - tx)), v = Math.min(1, Math.max(0, z - ty));
  const [n, e, s, w] = grid.getCorners(tx, ty);
  let h: number;
  if (diagonalNS(n, e, s, w)) h = u <= v ? n + v * (w - n) + u * (s - w) : n + u * (e - n) + v * (s - e);
  else h = u + v <= 1 ? n + u * (e - n) + v * (w - n) : s + (1 - u) * (w - s) + (1 - v) * (e - s);
  return h * HEIGHT_UNIT;
}

/** Rect inside tile (x,z), tessellated SUBDIV x SUBDIV and draped on the terrain surface. u/v are local 0..1 atlas coords. */
function pushQuad(d: GeoData, grid: Grid, x0: number, z0: number, x1: number, z1: number, lift: number, cell: number, vertical: boolean, rgb: number, flatY?: number, sub = SUBDIV): void {
  const base = d.positions.length / 3;
  const c = new THREE.Color(rgb);
  for (let j = 0; j <= sub; j++) for (let i = 0; i <= sub; i++) {
    const u = i / sub, v = j / sub;
    const px = x0 + (x1 - x0) * u, pz = z0 + (z1 - z0) * v;
    d.positions.push(px, (flatY ?? surfaceHeightAt(grid, px, pz)) + lift, pz);
    const uu = vertical ? u : v, vv = vertical ? v : u;
    d.uvs.push((cell + uu) / CELLS, vv);
    d.colors.push(c.r, c.g, c.b);
  }
  const row = sub + 1;
  for (let j = 0; j < sub; j++) for (let i = 0; i < sub; i++) {
    const a = base + j * row + i, b = a + 1, cc = a + row + 1, dd = a + row;
    d.indices.push(a, cc, b, a, dd, cc);
  }
}

/** Surface rectangles (tile-space x0,z0,x1,z1) that make up a tile's network by connection mask: centre square + one arm per set bit. */
export function networkRects(x: number, y: number, hw: number, m: number): Array<[number, number, number, number]> {
  const cx = x + 0.5, cz = y + 0.5;
  const r: Array<[number, number, number, number]> = [[cx - hw, cz - hw, cx + hw, cz + hw]];
  if (m & Conn.N) r.push([cx - hw, y, cx + hw, cz - hw]);
  if (m & Conn.S) r.push([cx - hw, cz + hw, cx + hw, y + 1]);
  if (m & Conn.W) r.push([x, cz - hw, cx - hw, cz + hw]);
  if (m & Conn.E) r.push([cx + hw, cz - hw, x + 1, cz + hw]);
  return r;
}


// ---------------------------------------------------------------------------------------------------------------
// Procedural line geometry (paths + rail): centre-lines per tile, strips draped on the surface.
// ---------------------------------------------------------------------------------------------------------------
export type P2 = [number, number];
/** `tans` (optional): explicit unit tangent per point (smooth Hermite lines); then the strip is NOT resampled and end cross-sections follow the shared tangent. */
export interface TileLine { pts: P2[]; role: 'through' | 'branch' | 'end'; bumper?: boolean; tans?: P2[] }

const DIRS: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // N E S W
const BIT_LIST = [Conn.N, Conn.E, Conn.S, Conn.W];
export const RAIL_HALF_BALLAST = 0.27;
export const RAIL_GAUGE_HALF = 0.115;
export const SLEEPER_SPACING = 0.25;
const ARC_STEPS = 6;

/**
 * Centre-lines of a tile's network by connection mask. All arms meet the tile edge at the edge MIDPOINT, so the
 * lines of adjacent tiles join exactly (end vertex of tile A == start vertex of tile B). Corners are quarter arcs
 * of radius 0.5 around the shared tile corner; T/cross use straight through-lines plus a branch to the centre.
 * `size` (map size) lets dead ends on the map boundary run out to the edge; `deadExt` is how far a dead end
 * continues past the centre otherwise.
 */
export function tileLines(x: number, y: number, m: number, size: number, deadExt: number, edgeTan?: EdgeTan): TileLine[] {
  const cx = x + 0.5, cz = y + 0.5;
  const arms: number[] = [];
  for (let d = 0; d < 4; d++) if (m & BIT_LIST[d]!) arms.push(d);
  const edge = (d: number): P2 => [cx + DIRS[d]![0] * 0.5, cz + DIRS[d]![1] * 0.5];
  const out: TileLine[] = [];
  if (arms.length === 0) return out;
  if (arms.length === 1) {
    const d = arms[0]!, o = (d + 2) % 4;
    const nx = x + DIRS[o]![0], ny = y + DIRS[o]![1];
    const outside = nx < 0 || ny < 0 || nx >= size || ny >= size;
    if (outside) out.push({ pts: [edge(d), edge(o)], role: 'end' });
    else out.push({ pts: [edge(d), [cx - DIRS[d]![0] * deadExt, cz - DIRS[d]![1] * deadExt]], role: 'end', bumper: true });
    return out;
  }
  const has = (d: number): boolean => arms.includes(d);
  if (arms.length === 2 && edgeTan) {
    const sm = smoothLine(cx, cz, arms[0]!, arms[1]!, edgeTan);
    if (sm) { out.push(sm); return out; }
  }
  if (arms.length === 2 && !(has(0) && has(2)) && !(has(1) && has(3))) {
    const [d1, d2] = arms as [number, number];
    const corner: P2 = [cx + 0.5 * (DIRS[d1]![0] + DIRS[d2]![0]), cz + 0.5 * (DIRS[d1]![1] + DIRS[d2]![1])];
    const va: P2 = [-0.5 * DIRS[d2]![0], -0.5 * DIRS[d2]![1]];
    const vb: P2 = [-0.5 * DIRS[d1]![0], -0.5 * DIRS[d1]![1]];
    const pts: P2[] = [];
    for (let i = 0; i <= ARC_STEPS; i++) {
      const t = (i / ARC_STEPS) * Math.PI / 2, c = Math.cos(t), sn = Math.sin(t);
      pts.push([corner[0] + va[0] * c + vb[0] * sn, corner[1] + va[1] * c + vb[1] * sn]);
    }
    pts[0] = edge(d1); pts[ARC_STEPS] = edge(d2); // exact edge midpoints (no float drift)
    out.push({ pts, role: 'through' });
    return out;
  }
  // straight / T / cross: through-lines for each opposite pair; unpaired arm is a branch to the centre.
  const used = new Set<number>();
  // through-lines run N->S and W->E (consistent direction)
  for (const d of [0, 1]) if (has(d) && has(d + 2)) { out.push({ pts: d === 0 ? [edge(0), edge(2)] : [edge(3), edge(1)], role: 'through' }); used.add(d); used.add(d + 2); }
  for (const d of arms) if (!used.has(d)) out.push({ pts: [edge(d), [cx, cz]], role: 'branch' });
  return out;
}

/** Unit tangent of the network at the edge of this tile towards direction d, pointing OUT of the tile (null = axis default). */
export type EdgeTan = (d: number) => P2 | null;
const HERMITE_STEPS = 8;
/** 0..1: how far road edge tangents lean towards the Catmull-Rom direction (1 = full; roads are wide, so less). */
export const ROAD_SMOOTH = 0.3;
/** Hermite curve through a degree-2 tile from the d1 edge midpoint to the d2 edge midpoint with the shared edge tangents; null when both are axis-default. */
function smoothLine(cx: number, cz: number, d1: number, d2: number, edgeTan: EdgeTan): TileLine | null {
  const a = edgeTan(d1), b = edgeTan(d2);
  if (!a && !b) return null;
  const p0: P2 = [cx + DIRS[d1]![0] * 0.5, cz + DIRS[d1]![1] * 0.5], p1: P2 = [cx + DIRS[d2]![0] * 0.5, cz + DIRS[d2]![1] * 0.5];
  // travel direction: into the tile at d1 (reverse of the outward tangent), out of it at d2
  const t0: P2 = a ? [-a[0], -a[1]] : [-DIRS[d1]![0], -DIRS[d1]![1]];
  const t1: P2 = b ?? [DIRS[d2]![0], DIRS[d2]![1]];
  const chord = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), k = 1.17 * chord;
  const pts: P2[] = [], tans: P2[] = [];
  for (let i = 0; i <= HERMITE_STEPS; i++) {
    const t = i / HERMITE_STEPS, t2 = t * t, t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
    const d00 = 6 * t2 - 6 * t, d10 = 3 * t2 - 4 * t + 1, d01 = -6 * t2 + 6 * t, d11 = 3 * t2 - 2 * t;
    const px = h00 * p0[0] + h10 * k * t0[0] + h01 * p1[0] + h11 * k * t1[0], pz = h00 * p0[1] + h10 * k * t0[1] + h01 * p1[1] + h11 * k * t1[1];
    const dx = d00 * p0[0] + d10 * k * t0[0] + d01 * p1[0] + d11 * k * t1[0], dz = d00 * p0[1] + d10 * k * t0[1] + d01 * p1[1] + d11 * k * t1[1];
    const l = Math.hypot(dx, dz) || 1;
    pts.push(i === 0 ? p0 : i === HERMITE_STEPS ? p1 : [px, pz]);
    tans.push(i === 0 ? t0 : i === HERMITE_STEPS ? t1 : [dx / l, dz / l]);
  }
  return { pts, tans, role: 'through' };
}

/**
 * Edge-tangent provider for a path / road tile: where the tile AND its neighbour across the edge are both plain 2-arm tiles of the same kind (no bridge),
 * the tangent is the Catmull-Rom direction (next centre - previous centre) - both tiles compute the same vector, so ribbons join with matching
 * direction and width. Everywhere else (junctions, dead ends, bridges, map edge) it stays axis-aligned (null). Pure; logical grid untouched.
 */
export function networkEdgeTan(net: Pick<Networks, 'kind' | 'conn' | 'bridge' | 'size'>, x: number, y: number): EdgeTan {
  const size = net.size, i = y * size + x, kind = net.kind[i]!;
  const arms2 = (m: number): number[] | null => { const r: number[] = []; for (let d = 0; d < 4; d++) if (m & BIT_LIST[d]!) r.push(d); return r.length === 2 ? r : null; };
  const mine = arms2(net.conn[i]!);
  return (d: number): P2 | null => {
    if (!mine || kind === 0 || kind === 3 || net.bridge[i] === 1) return null;
    const nx = x + DIRS[d]![0], ny = y + DIRS[d]![1];
    if (nx < 0 || ny < 0 || nx >= size || ny >= size) return null;
    const j = ny * size + nx;
    if (net.kind[j] !== kind || net.bridge[j] === 1) return null;
    const theirs = arms2(net.conn[j]!), back = (d + 2) % 4;
    if (!theirs || !theirs.includes(back)) return null;
    const oa = mine[0] === d ? mine[1]! : mine[0]!, ob = theirs[0] === back ? theirs[1]! : theirs[0]!;
    // next centre - previous centre = (B - A) + DIR[ob] - DIR[oa]
    const tx = DIRS[d]![0] + DIRS[ob]![0] - DIRS[oa]![0], tz = DIRS[d]![1] + DIRS[ob]![1] - DIRS[oa]![1];
    const l = Math.hypot(tx, tz);
    if (l < 1e-6) return null;
    // wide ribbons (roads, half width 0.36) would fold their inner edge on a tight bend: blend the Catmull-Rom direction towards the axis
    const mix = kind === 2 ? ROAD_SMOOTH : 1;
    const bx = DIRS[d]![0] + (tx / l - DIRS[d]![0]) * mix, bz = DIRS[d]![1] + (tz / l - DIRS[d]![1]) * mix, bl = Math.hypot(bx, bz);
    const ux = bx / bl, uz = bz / bl;
    return Math.abs(ux - DIRS[d]![0]) + Math.abs(uz - DIRS[d]![1]) < 1e-6 ? null : [ux, uz];
  };
}

const segLen = (a: P2, b: P2): number => Math.hypot(b[0] - a[0], b[1] - a[1]);
export function lineLength(pts: ReadonlyArray<P2>): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += segLen(pts[i - 1]!, pts[i]!);
  return l;
}

/** Split a polyline so no segment is longer than `step` (vertices of the original are kept; endpoints exact). */
export function resample(pts: ReadonlyArray<P2>, step: number): P2[] {
  const out: P2[] = [pts[0]!];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!, n = Math.max(1, Math.ceil(segLen(a, b) / step - 1e-9));
    for (let k = 1; k <= n; k++) out.push(k === n ? b : [a[0] + (b[0] - a[0]) * (k / n), a[1] + (b[1] - a[1]) * (k / n)]);
  }
  return out;
}

/** Point + unit tangent at arc length s. */
export function pointAt(pts: ReadonlyArray<P2>, s: number): { p: P2; t: P2 } {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!, l = segLen(a, b);
    if (s <= acc + l || i === pts.length - 1) {
      const f = l > 0 ? Math.min(1, Math.max(0, (s - acc) / l)) : 0;
      return { p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], t: l > 0 ? [(b[0] - a[0]) / l, (b[1] - a[1]) / l] : [1, 0] };
    }
    acc += l;
  }
  return { p: pts[0]!, t: [1, 0] };
}

/**
 * Sleeper centres along a line: count = round(len / 0.25), evenly spaced and centred in their slots, so a straight
 * tile (len 1) always has 4 sleepers at x+0.125, +0.375, +0.625, +0.875 — aligned in world space across tiles.
 */
export function sleepers(pts: ReadonlyArray<P2>): Array<{ p: P2; t: P2 }> {
  const len = lineLength(pts), n = Math.max(1, Math.round(len / SLEEPER_SPACING));
  const out: Array<{ p: P2; t: P2 }> = [];
  for (let k = 0; k < n; k++) out.push(pointAt(pts, ((k + 0.5) / n) * len));
  return out;
}

interface Sec { off: number; lift: number; rgb: number; u?: number }

/** Strip along a (resampled) polyline with a lateral cross-section, every vertex draped via surfaceHeightAt. */
function pushStrip(d: GeoData, grid: Grid, line: ReadonlyArray<P2>, secs: ReadonlyArray<Sec>, cell: number, o: { tans?: ReadonlyArray<P2>; lift: number; mixTo?: number; fadeEnd?: number; flatY?: number; vScale?: number } ): void {
  const base = d.positions.length / 3, S = secs.length;
  const total = lineLength(line), mix = new THREE.Color(o.mixTo ?? 0xffffff);
  let acc = 0;
  for (let i = 0; i < line.length; i++) {
    if (i) acc += segLen(line[i - 1]!, line[i]!);
    const a = line[Math.max(0, i - 1)]!, b = line[Math.min(line.length - 1, i + 1)]!;
    const l = segLen(a, b) || 1;
    let tx = (b[0] - a[0]) / l, tz = (b[1] - a[1]) / l;
    if (o.tans) { tx = o.tans[i]![0]; tz = o.tans[i]![1]; } else
    if (i === 0 || i === line.length - 1) { // arc end tangents are exactly axis-aligned: keeps edge cross-sections perpendicular
      if (Math.abs(tz) < 0.26) { tx = Math.sign(tx) || 1; tz = 0; } else if (Math.abs(tx) < 0.26) { tz = Math.sign(tz) || 1; tx = 0; }
    }
    const nx = -tz, nz = tx;
    // Edge shading fades to the base colour near a merge end (junction branches) so no dark seam crosses the through-line.
    const k = o.fadeEnd ? Math.min(1, Math.max(0, (total - acc) / o.fadeEnd)) : 1;
    for (let j = 0; j < S; j++) {
      const sc = secs[j]!;
      const px = line[i]![0] + nx * sc.off, pz = line[i]![1] + nz * sc.off;
      d.positions.push(px, (o.flatY ?? surfaceHeightAt(grid, px, pz)) + o.lift + sc.lift, pz);
      d.uvs.push((cell + (sc.u ?? 0.5)) / CELLS, acc * (o.vScale ?? 1));
      const c = new THREE.Color(sc.rgb).lerp(mix, 1 - k);
      d.colors.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < line.length - 1; i++) for (let j = 0; j < S - 1; j++) {
    const a = base + i * S + j, b = a + 1, c = a + S + 1, e = a + S;
    d.indices.push(a, b, e, b, c, e); // counter-clockwise seen from above (+y normal)
  }
}

/** Raised box along a tangent (bumper). */
function pushBox(d: GeoData, grid: Grid, p: P2, t: P2, halfAlong: number, halfAcross: number, lift: number, h: number, rgb: number): void {
  const nx = -t[1], nz = t[0], c = new THREE.Color(rgb);
  const corner = (a: number, b: number): P2 => [p[0] + t[0] * a + nx * b, p[1] + t[1] * a + nz * b];
  const cs = [corner(-halfAlong, -halfAcross), corner(halfAlong, -halfAcross), corner(halfAlong, halfAcross), corner(-halfAlong, halfAcross)];
  const base = d.positions.length / 3;
  const y0 = Math.max(...cs.map((q) => surfaceHeightAt(grid, q[0], q[1]))) + lift;
  for (const q of cs) { d.positions.push(q[0], y0, q[1]); d.uvs.push((MARK_CELL + 0.5) / CELLS, 0.5); d.colors.push(c.r * 0.7, c.g * 0.7, c.b * 0.7); }
  for (const q of cs) { d.positions.push(q[0], y0 + h, q[1]); d.uvs.push((MARK_CELL + 0.5) / CELLS, 0.5); d.colors.push(c.r, c.g, c.b); }
  // top + four sides (both windings are fine for a Lambert material; normals via computeVertexNormals)
  d.indices.push(base + 4, base + 5, base + 6, base + 4, base + 6, base + 7);
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; d.indices.push(base + i, base + j, base + 4 + j, base + i, base + 4 + j, base + 4 + i); }
}

const BALLAST_DARK = 0x4a463f, BALLAST = 0x948c7e, SLEEPER = 0x5b4331, STEEL_TOP = 0xe3e8ee, STEEL_SIDE = 0x6b7279;

/** One rail tile: gravel ballast bed (dark edges), evenly spaced sleepers, two continuous steel rails, bumper at dead ends. */
function railTile(d: GeoData, grid: Grid, x: number, y: number, m: number, size: number): void {
  const lines = tileLines(x, y, m, size, 0.12);
  const wc = MARK_CELL;
  lines.forEach((ln, li) => {
    const lift = NET_LIFT + li * 0.003;
    const fine = resample(ln.pts, 0.125);
    const fade = ln.role === 'branch' ? 0.2 : undefined;
    const HB = RAIL_HALF_BALLAST;
    // ballast
    pushStrip(d, grid, fine, [
      { off: -HB, lift: -0.012, rgb: BALLAST_DARK }, { off: -HB + 0.05, lift: 0, rgb: BALLAST },
      { off: HB - 0.05, lift: 0, rgb: BALLAST }, { off: HB, lift: -0.012, rgb: BALLAST_DARK },
    ], wc, { lift, mixTo: BALLAST, fadeEnd: fade });
    // sleepers (world-aligned by construction)
    const sc = new THREE.Color(SLEEPER);
    sleepers(ln.pts).forEach((sl, si) => {
      const wob = 0.9 + 0.1 * (((Math.floor(sl.p[0] * 8) * 31 + Math.floor(sl.p[1] * 8) * 17 + si) & 3) / 3);
      const col = new THREE.Color().copy(sc).multiplyScalar(wob);
      const t = sl.t, base = d.positions.length / 3;
      for (const al of [-0.035, 0.035]) for (const off of [-0.19, 0, 0.19]) {
        const px = sl.p[0] + t[0] * al - t[1] * off, pz = sl.p[1] + t[1] * al + t[0] * off;
        d.positions.push(px, surfaceHeightAt(grid, px, pz) + lift + 0.014, pz);
        d.uvs.push((wc + 0.5) / CELLS, 0.5); d.colors.push(col.r, col.g, col.b);
      }
      for (let j = 0; j < 2; j++) { const aa = base + j, b = aa + 1, c = aa + 4, e = aa + 3; d.indices.push(aa, b, e, b, c, e); }
    });
    // steel rails: raised strip with bright top, darker sloped sides
    for (const side of [-1, 1]) {
      const o = side * RAIL_GAUGE_HALF;
      pushStrip(d, grid, fine, [
        { off: o - 0.022, lift: 0.02, rgb: STEEL_SIDE }, { off: o - 0.013, lift: 0.04, rgb: STEEL_TOP },
        { off: o + 0.013, lift: 0.04, rgb: STEEL_TOP }, { off: o + 0.022, lift: 0.02, rgb: STEEL_SIDE },
      ], wc, { lift });
    }
    if (ln.bumper) {
      const end = ln.pts[ln.pts.length - 1]!, prev = ln.pts[ln.pts.length - 2]!;
      const l = segLen(prev, end) || 1;
      pushBox(d, grid, end, [(end[0] - prev[0]) / l, (end[1] - prev[1]) / l], 0.03, 0.2, lift + 0.01, 0.07, 0xb03a2e);
    }
  });
}

/** Footpath tile: gravel strip (textured) with darker tidy edges, quarter-arc corners; junctions blend branch edges. */
function pathTile(d: GeoData, grid: Grid, x: number, y: number, m: number, size: number, hw: number, cell: number, lift: number, rgb: number, flatY?: number, edgeTan?: EdgeTan): boolean {
  const lines = tileLines(x, y, m, size, hw, edgeTan);
  if (!lines.length) return false;
  const dark = new THREE.Color(rgb).multiplyScalar(0.72).getHex();
  lines.forEach((ln, li) => {
    // dead-end caps on the interior side get a rounded look via the extension; branches fade their edge shading at the merge.
    pushStrip(d, grid, ln.tans ? ln.pts : resample(ln.pts, 0.125), [
      { off: -hw, lift: -0.01, rgb: dark, u: 0 }, { off: -hw + 0.04, lift: 0, rgb, u: 0.15 },
      { off: hw - 0.04, lift: 0, rgb, u: 0.85 }, { off: hw, lift: -0.01, rgb: dark, u: 1 },
    ], cell, { tans: ln.tans, lift: lift + li * 0.004, mixTo: rgb, fadeEnd: ln.role === 'branch' ? 0.2 : undefined, flatY, vScale: 0.5 });
  });
  return true;
}

/**
 * Road tile that is a plain 2-arm piece that is a corner or has a smooth edge: a draped asphalt ribbon along the Hermite centre-line plus
 * a thin centre marking, width-consistent with the straight rect arms of junction / end tiles. Everything else keeps the rect layout (returns false).
 */
function roadTile(d: GeoData, grid: Grid, net: Networks, x: number, y: number, m: number, hw: number, cell: number, lift: number): boolean {
  const tan = networkEdgeTan(net, x, y);
  const lines = tileLines(x, y, m, net.size, hw, tan);
  if (lines.length !== 1 || (!lines[0]!.tans && lines[0]!.pts.length <= 2)) return false; // straight axis tiles stay rects
  const ln = lines[0]!, pts = ln.tans ? ln.pts : resample(ln.pts, 0.125);
  pushStrip(d, grid, pts, [{ off: -hw, lift: 0, rgb: 0xffffff, u: 0.1 }, { off: 0, lift: 0, rgb: 0xffffff, u: 0.5 }, { off: hw, lift: 0, rgb: 0xffffff, u: 0.9 }], cell, { tans: ln.tans, lift, vScale: 1 });
  const lw = 0.025;
  pushStrip(d, grid, pts, [{ off: -lw, lift: 0, rgb: 0xf2c14e, u: 0.5 }, { off: lw, lift: 0, rgb: 0xf2c14e, u: 0.5 }], MARK_CELL, { tans: ln.tans, lift: lift + (MARK_LIFT - NET_LIFT), vScale: 1 });
  return true;
}

/** Geometry for one tile of network (auto-tiled: centre + arms by connection mask). */
export function tileNetwork(d: GeoData, grid: Grid, net: Networks, x: number, y: number): void {
  const i = y * net.size + x, k = net.kind[i]!;
  if (!k) return;
  const m = net.conn[i]!;
  const hw = HALF_W[k]!;
  const cell = CELL[k]!;
  const bridge = net.bridge[i] === 1;
  const lift = bridge ? BRIDGE_LIFT : NET_LIFT;
  const flatY = bridge ? Math.max(...grid.getCorners(x, y)) * HEIGHT_UNIT : undefined;
  const rgb = bridge ? 0xc9a37a : 0xffffff;
  const cx = x + 0.5, cz = y + 0.5;
  if (k === 3) { railTile(d, grid, x, y, m, net.size); return; }
  if (k === 1 && m !== 0 && pathTile(d, grid, x, y, m, net.size, hw, cell, lift, rgb, flatY, networkEdgeTan(net, x, y))) return;
  if (k === 2 && !bridge && roadTile(d, grid, net, x, y, m, hw, cell, lift)) return;
  const vertical = (m & (Conn.N | Conn.S)) !== 0 && (m & (Conn.E | Conn.W)) === 0;
  // Centre square: UVs follow the straight direction; arms keep their own axis so texture runs along them.
  const [c0, ...arms] = networkRects(x, y, hw, m);
  pushQuad(d, grid, c0![0], c0![1], c0![2], c0![3], lift, cell, vertical, rgb, flatY);
  arms.forEach((a) => pushQuad(d, grid, a[0], a[1], a[2], a[3], lift, cell, a[3] - a[1] > a[2] - a[0], rgb, flatY, 2));
  // Roads: continuous centre line from every connected edge to the tile centre (so corners/T/cross join up).
  if (k === 2) {
    const lw = 0.025, mc = 0xf2c14e;
    const mk = (x0: number, z0: number, x1: number, z1: number): void => pushQuad(d, grid, x0, z0, x1, z1, lift + (MARK_LIFT - NET_LIFT), MARK_CELL, true, mc, flatY, 2);
    mk(cx - lw, cz - lw, cx + lw, cz + lw);
    if (m & Conn.N) mk(cx - lw, y, cx + lw, cz);
    if (m & Conn.S) mk(cx - lw, cz, cx + lw, y + 1);
    if (m & Conn.W) mk(x, cz - lw, cx, cz + lw);
    if (m & Conn.E) mk(cx, cz - lw, x + 1, cz + lw);
  }
}

/**
 * Per-tile decals: only trail bridge decks and the red outline of disconnected pistes. The piste / trail GROUND look is a soft terrain-shader
 * treatment (groundMask.ts + TerrainMesh); the full-tile difficulty colours live in the 'Piste difficulty' overlay.
 */
export function tileDecal(d: GeoData, grid: Grid, net: Networks, x: number, y: number): void {
  const i = y * net.size + x, l = net.layers[i]!;
  if (!l) return;
  if (net.bridge[i] === 1 && net.kind[i] === 0 && (l & (Layer.Mtb | Layer.Hike))) {
    // Trail crossing a stream: reuse the footpath bridge deck look.
    pushQuad(d, grid, x + 0.25, y + 0.05, x + 0.75, y + 0.95, BRIDGE_LIFT, 0, true, 0xc9a37a, Math.max(...grid.getCorners(x, y)) * HEIGHT_UNIT);
  }
  if ((l & Layer.Ski) && net.disconnectedMask()[i]) {
    // red outline on the sides that border a tile outside this disconnected piste
    const t = 0.07, red = 0xff2a2a, L = DECAL_LIFT + 0.03;
    const edge = (dx: number, dy: number, x0: number, z0: number, x1: number, z1: number): void => {
      if (!(net.inBounds(x + dx, y + dy) && net.disconnectedMask()[net.idxOf(x + dx, y + dy)])) pushQuad(d, grid, x0, z0, x1, z1, L, 3, true, red, undefined, 2);
    };
    edge(0, -1, x, y, x + 1, y + t); edge(0, 1, x, y + 1 - t, x + 1, y + 1);
    edge(-1, 0, x, y, x + t, y + 1); edge(1, 0, x + 1 - t, y, x + 1, y + 1);
  }
}

export function buildChunkData(grid: Grid, net: Networks, chunk: number): { net: GeoData; decal: GeoData } {
  const cpr = grid.chunksPerRow;
  const x0 = (chunk % cpr) * CHUNK_SIZE, y0 = Math.floor(chunk / cpr) * CHUNK_SIZE;
  const n = empty(), dc = empty();
  for (let y = y0; y < y0 + CHUNK_SIZE; y++) for (let x = x0; x < x0 + CHUNK_SIZE; x++) {
    tileNetwork(n, grid, net, x, y);
    tileDecal(dc, grid, net, x, y);
  }
  return { net: n, decal: dc };
}

function toGeometry(d: GeoData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(d.positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(d.uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(d.colors, 3));
  g.setIndex(d.indices);
  g.computeVertexNormals();
  return g;
}

/** Atlas: [path gravel | road asphalt with dashed centre | rail sleepers + steel]. Needs a DOM canvas. */
export function makeAtlas(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d')!;
  // path
  g.fillStyle = '#b9a687'; g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 90; i++) { g.fillStyle = i % 2 ? '#a08f72' : '#cdbd9f'; g.fillRect((i * 37) % 64, (i * 53) % 64, 2, 2); }
  // road: v runs along texture y
  g.fillStyle = '#4b4f57'; g.fillRect(64, 0, 64, 64);
  // rail
  g.fillStyle = '#7d6e5e'; g.fillRect(128, 0, 64, 64);
  g.fillStyle = '#4a3a2a'; for (let y = 2; y < 64; y += 12) g.fillRect(132, y, 56, 5);
  g.fillStyle = '#c5cad0'; g.fillRect(142, 0, 4, 64); g.fillRect(174, 0, 4, 64);
  g.fillStyle = '#ffffff'; g.fillRect(192, 0, 64, 64); // plain white cell (markings)
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Merged per-chunk meshes for paths/roads/rail + piste decals; only dirty chunks rebuild. */
export class NetworkMeshes {
  readonly group = new THREE.Group();
  private chunks = new Map<number, { net: THREE.Mesh | null; decal: THREE.Mesh | null }>();
  private netMat: THREE.MeshLambertMaterial;
  private decalMat: THREE.MeshLambertMaterial;
  private forced = new Set<number>();

  constructor(private grid: Grid, private net: Networks) {
    this.netMat = new THREE.MeshLambertMaterial({ map: makeAtlas(), vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.netMat.onBeforeCompile = (sh): void => {
      sh.uniforms.uNetNight = NET_NIGHT;
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNetNight;').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + NET_NIGHT_GLSL);
    };
    this.netMat.customProgramCacheKey = (): string => 'netNight1';
    this.decalMat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.group.name = 'networks';
  }

  /** Terrain under these chunks changed: rebuild them next update. */
  refreshChunks(ids: Iterable<number>): void { for (const c of ids) this.forced.add(c); }

  /** Rebuild dirty chunks. Returns number rebuilt. */
  update(): number {
    this.net.disconnectedMask(); // refresh piste components first: marks chunks whose disconnected-outline changed
    const ids = new Set([...this.net.consumeDirtyChunks(), ...this.forced]);
    this.forced.clear();
    for (const c of ids) this.rebuild(c);
    return ids.size;
  }

  private rebuild(chunk: number): void {
    const { net: nd, decal: dd } = buildChunkData(this.grid, this.net, chunk);
    const entry = this.chunks.get(chunk) ?? { net: null, decal: null };
    const swap = (old: THREE.Mesh | null, d: GeoData, mat: THREE.Material, order: number): THREE.Mesh | null => {
      if (old) { this.group.remove(old); old.geometry.dispose(); }
      if (!d.indices.length) return null;
      const m = new THREE.Mesh(toGeometry(d), mat);
      m.renderOrder = order;
      this.group.add(m);
      return m;
    };
    entry.net = swap(entry.net, nd, this.netMat, 2);
    entry.decal = swap(entry.decal, dd, this.decalMat, 1);
    this.chunks.set(chunk, entry);
  }

  dispose(): void {
    for (const e of this.chunks.values()) { e.net?.geometry.dispose(); e.decal?.geometry.dispose(); }
    this.netMat.map?.dispose(); this.netMat.dispose(); this.decalMat.dispose();
  }
}
