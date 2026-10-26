import { TileType, type Grid } from '@/world/Grid';
import { HEIGHT_UNIT, SKIRT_BOTTOM } from '@/config/balance';

/**
 * Pure (WebGL-free) terrain geometry builder. Non-indexed, flat-shaded: each tile quad is two
 * triangles (6 vertices), tiles in row-major order (y then x) first, edge skirts afterwards.
 * Corner order [n,e,s,w] = (x,y),(x+s,y),(x+s,y+s),(x,y+s); world = (x, h*0.5, y).
 */
export interface TerrainGeometryData {
  positions: Float32Array;
  normals: Float32Array;
  /** per-vertex snow depth (tile snowDepth) */
  snow: Float32Array;
  /** per-vertex TileType */
  kind: Float32Array;
  /** per-vertex smoothed steepness (half-steps per tile, averaged over adjacent tiles); 0 for skirts */
  steep: Float32Array;
  /** per-vertex smooth normal (central differences of corner heights), 3 floats per vertex */
  smoothNormals: Float32Array;
  /** per-vertex wetness, 2 floats: x = fraction of surrounding tiles that are lake, y = stream */
  wet: Float32Array;
  /** per-vertex rock weight 0..1: average of the 4 surrounding tiles' Rock flag (smooth across tile borders) */
  rock: Float32Array;
  vertexCount: number;
  /** vertices belonging to tiles (the rest are skirts) */
  tileVertexCount: number;
  min: [number, number, number];
  max: [number, number, number];
}

/** true -> split along the n-s diagonal; false -> along e-w. Chooses the diagonal with the smaller height difference
 * (cap-like corners stay as one planar triangle + one sloped triangle); ties go n-s. */
export function diagonalNS(n: number, e: number, s: number, w: number): boolean {
  return Math.abs(n - s) <= Math.abs(e - w);
}

/** Per-vertex `kind` value of map-edge cliff skirts (shader draws a constant earth gradient: no xz texture => no vertical stripes). */
export const SKIRT_KIND = 7;
/** World units the far-LOD surface is lowered below the sampled minimum, so full-res draped things (roads, decals, protected chunks) stay on top. */
export const LOD_BIAS = 0.3;

export function buildTerrainGeometry(
  grid: Grid, x0: number, y0: number, tilesX: number, tilesY: number, step = 1,
): TerrainGeometryData {
  const qx = Math.floor(tilesX / step), qy = Math.floor(tilesY / step);
  const N = grid.size, V = grid.vsize, H = grid.heights;
  const skirtW = x0 === 0 ? qy : 0, skirtE = x0 + qx * step === N ? qy : 0;
  const skirtN = y0 === 0 ? qx : 0, skirtS = y0 + qy * step === N ? qx : 0;
  const tileVerts = qx * qy * 6;
  const total = tileVerts + (skirtW + skirtE + skirtN + skirtS) * 6;
  const positions = new Float32Array(total * 3);
  const normals = new Float32Array(total * 3);
  const snow = new Float32Array(total);
  const kind = new Float32Array(total);
  const steep = new Float32Array(total);
  const smoothNormals = new Float32Array(total * 3);
  const wet = new Float32Array(total * 2);
  const rock = new Float32Array(total);
  // corner caches over (qx+1)*(qy+1) corners: smoothed steepness + smooth normal
  const cw = qx + 1;
  const cSteep = new Float32Array(cw * (qy + 1));
  const cNorm = new Float32Array(cw * (qy + 1) * 3);
  const cWet = new Float32Array(cw * (qy + 1) * 2);
  const cRock = new Float32Array(cw * (qy + 1));
  const hc = (vx: number, vy: number): number => H[Math.min(N, Math.max(0, vy)) * V + Math.min(N, Math.max(0, vx))]!;
  const tileSteep = (tx: number, ty: number): number => { // tile origin corner coords, tile size = step
    if (tx < 0 || ty < 0 || tx + step > N || ty + step > N) return -1;
    const a = hc(tx, ty), b = hc(tx + step, ty), c = hc(tx + step, ty + step), d = hc(tx, ty + step);
    return (Math.max(a, b, c, d) - Math.min(a, b, c, d)) / step;
  };
  for (let j = 0; j <= qy; j++)
    for (let i = 0; i <= qx; i++) {
      const vx = x0 + i * step, vy = y0 + j * step;
      let sum = 0, cnt = 0;
      for (let k = 0; k < 4; k++) {
        const t = tileSteep(vx - (k & 1 ? 0 : step), vy - (k & 2 ? 0 : step));
        if (t >= 0) { sum += t; cnt++; }
      }
      const ci = j * cw + i;
      cSteep[ci] = cnt ? sum / cnt : 0;
      let lk = 0, st = 0, rk = 0, rn = 0;
      for (let k = 0; k < 4; k++) {
        const tx = vx - (k & 1 ? 0 : 1), ty = vy - (k & 2 ? 0 : 1);
        if (tx < 0 || ty < 0 || tx >= N || ty >= N) continue;
        const tt = grid.tileType[ty * N + tx];
        if (tt === TileType.Water) lk++; else if (tt === TileType.Stream) st++;
      }
      for (let k = 0; k < 4; k++) { // rock flag of the (macro) tiles around this corner
        const tx = vx - (k & 1 ? 0 : step), ty = vy - (k & 2 ? 0 : step);
        if (tx < 0 || ty < 0 || tx + step > N || ty + step > N) continue;
        rn++;
        if (grid.tileType[(ty + (step >> 1)) * N + tx + (step >> 1)] === TileType.Rock) rk++;
      }
      cRock[ci] = rn ? rk / rn : 0;
      cWet[ci * 2] = lk / 4; cWet[ci * 2 + 1] = st / 4;
      // Sobel-weighted central differences ([1 2 1] across the other axis): a gentle blur of the vertex normal. It reads the global height grid (clamped at the
      // map edge), so neighbouring chunks compute identical normals along a shared border (no seams) and slopes shade a bit softer than with the plain difference.
      let gxs = 0, gzs = 0;
      for (let k = -1; k <= 1; k++) {
        const wgt = k === 0 ? 2 : 1;
        gxs += wgt * (hc(vx + step, vy + k * step) - hc(vx - step, vy + k * step));
        gzs += wgt * (hc(vx + k * step, vy + step) - hc(vx + k * step, vy - step));
      }
      const gx = gxs * HEIGHT_UNIT / (8 * step), gz = gzs * HEIGHT_UNIT / (8 * step);
      const l = Math.hypot(gx, 1, gz);
      cNorm[ci * 3] = -gx / l; cNorm[ci * 3 + 1] = 1 / l; cNorm[ci * 3 + 2] = -gz / l;
    }
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let vi = 0;

  const tri = (
    ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number,
    sn: number, kd: number, nxo?: number, nyo?: number, nzo?: number,
  ): void => {
    let nx: number, ny: number, nz: number;
    if (nxo === undefined) {
      const ux = bx - ax, uy = by - ay, uz = bz - az, wx = cx - ax, wy = cy - ay, wz = cz - az;
      nx = uy * wz - uz * wy; ny = uz * wx - ux * wz; nz = ux * wy - uy * wx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
    } else { nx = nxo; ny = nyo!; nz = nzo!; }
    const o = vi * 3;
    positions[o] = ax; positions[o + 1] = ay; positions[o + 2] = az;
    positions[o + 3] = bx; positions[o + 4] = by; positions[o + 5] = bz;
    positions[o + 6] = cx; positions[o + 7] = cy; positions[o + 8] = cz;
    for (let k = 0; k < 3; k++) { normals[o + k * 3] = nx; normals[o + k * 3 + 1] = ny; normals[o + k * 3 + 2] = nz; }
    for (let k = 0; k < 3; k++) { snow[vi + k] = sn; kind[vi + k] = kd; }
    if (nxo === undefined) {
      const pts = [ax, az, bx, bz, cx, cz];
      for (let k = 0; k < 3; k++) {
        const ci = Math.round((pts[k * 2 + 1]! - y0) / step) * cw + Math.round((pts[k * 2]! - x0) / step);
        steep[vi + k] = cSteep[ci]!;
        const so = (vi + k) * 3;
        smoothNormals[so] = cNorm[ci * 3]!; smoothNormals[so + 1] = cNorm[ci * 3 + 1]!; smoothNormals[so + 2] = cNorm[ci * 3 + 2]!;
        rock[vi + k] = cRock[ci]!;
        wet[(vi + k) * 2] = cWet[ci * 2]!; wet[(vi + k) * 2 + 1] = cWet[ci * 2 + 1]!;
      }
    } else {
      for (let k = 0; k < 3; k++) {
        const so = (vi + k) * 3;
        smoothNormals[so] = nx; smoothNormals[so + 1] = ny; smoothNormals[so + 2] = nz;
      }
    }
    vi += 3;
    if (ax < minX) minX = ax; if (bx < minX) minX = bx; if (cx < minX) minX = cx;
    if (ax > maxX) maxX = ax; if (bx > maxX) maxX = bx; if (cx > maxX) maxX = cx;
    if (ay < minY) minY = ay; if (by < minY) minY = by; if (cy < minY) minY = cy;
    if (ay > maxY) maxY = ay; if (by > maxY) maxY = by; if (cy > maxY) maxY = cy;
    if (az < minZ) minZ = az; if (bz < minZ) minZ = bz; if (cz < minZ) minZ = cz;
    if (az > maxZ) maxZ = az; if (bz > maxZ) maxZ = bz; if (cz > maxZ) maxZ = cz;
  };
  const half = step >> 1;
  // Far LOD (step > 1): corner height = minimum of the fine corners within step/2 (window clamped) minus LOD_BIAS.
  // A coarse triangle can then never rise above the full-res surface that roads/buildings are draped on (they would be buried).
  const lowered = step > 1;
  const hQ = (vx: number, vy: number): number => {
    if (!lowered) return H[vy * V + vx]! * HEIGHT_UNIT;
    let m = Infinity;
    for (let dy = -half; dy <= half; dy++) for (let dx = -half; dx <= half; dx++) {
      const hv = H[Math.min(N, Math.max(0, vy + dy)) * V + Math.min(N, Math.max(0, vx + dx))]!;
      if (hv < m) m = hv;
    }
    return m * HEIGHT_UNIT - LOD_BIAS;
  };
  const hAt = hQ;

  for (let ty = 0; ty < qy; ty++) {
    const y = y0 + ty * step;
    for (let tx = 0; tx < qx; tx++) {
      const x = x0 + tx * step;
      const hn = H[y * V + x]!, he = H[y * V + x + step]!, hs = H[(y + step) * V + x + step]!, hw = H[(y + step) * V + x]!;
      const ti = (y + half) * N + (x + half);
      const sn = grid.snowDepth[ti]!, kd = grid.tileType[ti]!;
      const yn = lowered ? hQ(x, y) : hn * HEIGHT_UNIT, ye = lowered ? hQ(x + step, y) : he * HEIGHT_UNIT;
      const ys = lowered ? hQ(x + step, y + step) : hs * HEIGHT_UNIT, yw = lowered ? hQ(x, y + step) : hw * HEIGHT_UNIT;
      const X1 = x + step, Y1 = y + step;
      if (diagonalNS(hn, he, hs, hw)) {
        tri(x, yn, y, x, yw, Y1, X1, ys, Y1, sn, kd); // n,w,s
        tri(x, yn, y, X1, ys, Y1, X1, ye, y, sn, kd); // n,s,e
      } else {
        tri(x, yn, y, x, yw, Y1, X1, ye, y, sn, kd); // n,w,e
        tri(x, yw, Y1, X1, ys, Y1, X1, ye, y, sn, kd); // w,s,e
      }
    }
  }
  const tileVertexCount = vi;

  const B = SKIRT_BOTTOM;
  const quad = (
    ax: number, ay: number, az: number, bx: number, by: number, bz: number, nx: number, nz: number, sn: number, kd: number,
  ): void => {
    // top a -> top b, bottom below each
    tri(ax, ay, az, bx, B, bz, bx, by, bz, sn, kd, nx, 0, nz);
    tri(ax, ay, az, ax, B, az, bx, B, bz, sn, kd, nx, 0, nz);
  };
  if (skirtW) for (let t = 0; t < qy; t++) { const y = y0 + t * step; quad(0, hAt(0, y), y, 0, hAt(0, y + step), y + step, -1, 0, 0, SKIRT_KIND); }
  if (skirtE) for (let t = 0; t < qy; t++) { const y = y0 + t * step; quad(N, hAt(N, y + step), y + step, N, hAt(N, y), y, 1, 0, 0, SKIRT_KIND); }
  if (skirtN) for (let t = 0; t < qx; t++) { const x = x0 + t * step; quad(x + step, hAt(x + step, 0), 0, x, hAt(x, 0), 0, 0, -1, 0, SKIRT_KIND); }
  if (skirtS) for (let t = 0; t < qx; t++) { const x = x0 + t * step; quad(x, hAt(x, N), N, x + step, hAt(x + step, N), N, 0, 1, 0, SKIRT_KIND); }

  if (total === 0) { minX = minY = minZ = maxX = maxY = maxZ = 0; }
  return { positions, normals, snow, kind, steep, smoothNormals, wet, rock, vertexCount: vi, tileVertexCount, min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

/** Rewrite only the snow attribute for the tile vertices of a (step 1 or macro) region; returns count written. */
export function fillSnow(
  grid: Grid, x0: number, y0: number, tilesX: number, tilesY: number, step: number, out: Float32Array,
): number {
  const qx = Math.floor(tilesX / step), qy = Math.floor(tilesY / step), half = step >> 1;
  let i = 0;
  for (let ty = 0; ty < qy; ty++)
    for (let tx = 0; tx < qx; tx++) {
      const s = grid.snowDepth[(y0 + ty * step + half) * grid.size + x0 + tx * step + half]!;
      for (let k = 0; k < 6; k++) out[i++] = s;
    }
  return i;
}
