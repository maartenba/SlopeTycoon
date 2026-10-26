import { presetOf, type TerrainPresetId } from './TerrainPresets';
import { Grid, TileType, MAX_TILE_DELTA } from './Grid';
import { Noise2D } from './noise';
import { Rng } from '../core/Rng';
import { OccFlag } from './Occupancy';
import {
  TERRAIN_RELIEF_128, TERRAIN_RELIEF_EXP, TERRAIN_TALUS, TERRAIN_TALUS_CLIFF, TERRAIN_TERRACE, TERRAIN_FREQ_SCALE,
} from '../config/balance';
import { generateStreams, type Stream } from './Streams';

export type { Stream } from './Streams';

/**
 * Heights are Int16 half-steps. The valley floor sits at VALLEY_BASE; the summit is VALLEY_BASE + terrainRelief(size) above
 * (52 on 128, ~30 on 64, ~90 on 256: relief grows as (N/128)^0.8, so bigger maps spread it over more tiles = gentler). Heights are
 * rescaled so the summit always reaches full relief. Slopes are shaped by terraces, flat benches and thermal erosion (shapeTerrain).
 *
 * Altitude zones are fractions of relief above the valley floor:
 *   0 Valley (<25%), 1 Foothills (<50%), 2 Alpine (<75%), 3 Summit (>=75%).
 */
export const VALLEY_BASE = 8;
export const ALTITUDE_ZONE_COUNT = 4;
export const ALTITUDE_ZONES = [0.25, 0.5, 0.75] as const;

/** Tiles steeper than this (half-steps/tile) or above this relief fraction become rock. Expert pistes go to ~2. */
export const ROCK_STEEP = 1.5;
/** Max-steepness tiles only turn to rock above this relief fraction; lower down they stay steep grass (expert slope). */
export const ROCK_STEEP_MINALT = 0.65;
export const ROCK_ALT = 0.95;
/** Very high tiles only turn to rock when not flat (summit plateaus and shoulders stay snow/grass for building). */
export const ROCK_ALT_MINSTEEP = 0.5;

/** Total relief on a 128 map (half-steps) and its growth with size: bigger maps get more relief but spread over more tiles. */
export const RELIEF_128 = TERRAIN_RELIEF_128;
export const RELIEF_EXP = TERRAIN_RELIEF_EXP;

export function terrainRelief(size: number): number {
  return Math.round(RELIEF_128 * Math.pow(size / 128, RELIEF_EXP));
}

export function altitudeZone(size: number, height: number): number {
  const f = (height - VALLEY_BASE) / terrainRelief(size);
  let z = 0;
  for (const t of ALTITUDE_ZONES) if (f >= t) z++;
  return z;
}

export interface Lake {
  cx: number;
  cy: number;
  radius: number;
  /** Water level in half-steps. */
  level: number;
  tiles: number;
  /** Tile indices (y*N+x) of the water tiles (organic footprint; corners <= level, flat surface at level). */
  tileIdx: number[];
}

export interface TerrainResult {
  roadEntry: { x: number; y: number };
  railEntry: { x: number; y: number };
  villageAnchor: { x: number; y: number };
  lakes: Lake[];
  /** Downhill 1-tile-wide streams (tile paths + channel levels); tiles are TileType.Stream. */
  streams: Stream[];
  /** N*N, 0..255. Low on rock/water/very high, high on mid-slopes. */
  forestDensity: Uint8Array;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Lower corners until every tile spread <= MAX_TILE_DELTA. */
export function enforceInvariant(grid: Grid): void {
  const n = grid.size, v = grid.vsize, h = grid.heights;
  for (let iter = 0; iter < 1000; iter++) {
    let changed = false;
    const fwd = iter % 2 === 0;
    for (let yy = 0; yy < n; yy++) {
      const y = fwd ? yy : n - 1 - yy;
      for (let xx = 0; xx < n; xx++) {
        const x = fwd ? xx : n - 1 - xx;
        const i = y * v + x;
        const a = h[i]!, b = h[i + 1]!, c = h[i + v + 1]!, d = h[i + v]!;
        const cap = Math.min(a, b, c, d) + MAX_TILE_DELTA;
        if (a > cap) { h[i] = cap; changed = true; }
        if (b > cap) { h[i + 1] = cap; changed = true; }
        if (c > cap) { h[i + v + 1] = cap; changed = true; }
        if (d > cap) { h[i + v] = cap; changed = true; }
      }
    }
    if (!changed) return;
  }
}

interface FootprintMask { x0: number; y0: number; w: number; mask: Uint8Array; }

function morph(m: Uint8Array, w: number, dilate: boolean, square = false): Uint8Array {
  const out = new Uint8Array(m.length);
  for (let y = 0; y < w; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const g = (xx: number, yy: number): number => (xx < 0 || yy < 0 || xx >= w || yy >= w ? 0 : m[yy * w + xx]!);
      const c = [m[i]!, g(x - 1, y), g(x + 1, y), g(x, y - 1), g(x, y + 1)];
      if (square) c.push(g(x - 1, y - 1), g(x + 1, y - 1), g(x - 1, y + 1), g(x + 1, y + 1));
      out[i] = dilate ? (c.some((v) => v) ? 1 : 0) : (c.every((v) => v) ? 1 : 0);
    }
  return out;
}

/** Organic round/oval tile footprint (noise-perturbed radius, closed+opened, largest component, no holes). */
function lakeFootprint(
  noise: Noise2D, cx: number, cy: number, r: number, ecc: number, rot: number, off: number, N: number,
): FootprintMask | null {
  const R = Math.ceil(r * 1.6) + 2, w = 2 * R + 1;
  const x0 = cx - R, y0 = cy - R;
  let m: Uint8Array = new Uint8Array(w * w);
  const ca = Math.cos(rot), sa = Math.sin(rot);
  for (let j = 0; j < w; j++)
    for (let i = 0; i < w; i++) {
      const dx = i - R, dy = j - R;
      const u = (dx * ca + dy * sa) / (1 + ecc), v = (-dx * sa + dy * ca) / (1 - ecc);
      const ang = Math.atan2(dy, dx);
      const rr = r * (1 + 0.3 * noise.fbm(Math.cos(ang) * 1.2 + off, Math.sin(ang) * 1.2, 2));
      if (Math.hypot(u, v) <= rr) m[j * w + i] = 1;
    }
  m = morph(morph(m, w, true), w, false); // close
  m = morph(morph(m, w, false, true), w, true, true); // open (3x3 square: removes spurs/bumps < 3 wide)
  for (let it = 0; it < 4; it++) { // smooth: drop tiles with < 2 water neighbours, fill pockets with >= 3
    const nm = m.slice();
    for (let y = 1; y < w - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const nb = m[y * w + x - 1]! + m[y * w + x + 1]! + m[(y - 1) * w + x]! + m[(y + 1) * w + x]!;
        if (m[y * w + x]) { if (nb < 2) nm[y * w + x] = 0; } else if (nb >= 3) nm[y * w + x] = 1;
      }
    m = nm;
  }
  // largest 4-connected component
  const comp = new Int32Array(w * w).fill(-1);
  let best = -1, bestN = 0;
  for (let s = 0; s < w * w; s++) {
    if (!m[s] || comp[s]! >= 0) continue;
    const st = [s]; comp[s] = s; let n = 0;
    while (st.length) {
      const c = st.pop()!; n++;
      const x = c % w, y = (c - x) / w;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= w) continue;
        const k = yy * w + xx;
        if (m[k] && comp[k]! < 0) { comp[k] = s; st.push(k); }
      }
    }
    if (n > bestN) { bestN = n; best = s; }
  }
  if (best < 0 || bestN < 9) return null;
  const out = new Uint8Array(w * w);
  for (let i = 0; i < w * w; i++) if (comp[i] === best) out[i] = 1;
  // fill holes: flood background from the window border
  const bg = new Uint8Array(w * w);
  const st: number[] = [];
  for (let i = 0; i < w; i++) for (const k of [i, (w - 1) * w + i, i * w, i * w + w - 1]) if (!out[k] && !bg[k]) { bg[k] = 1; st.push(k); }
  while (st.length) {
    const c = st.pop()!; const x = c % w, y = (c - x) / w;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= w) continue;
      const k = yy * w + xx;
      if (!out[k] && !bg[k]) { bg[k] = 1; st.push(k); }
    }
  }
  for (let i = 0; i < w * w; i++) if (!bg[i]) out[i] = 1;
  for (let j = 0; j < w; j++)
    for (let i = 0; i < w; i++)
      if (out[j * w + i] && (x0 + i < 2 || y0 + j < 2 || x0 + i > N - 3 || y0 + j > N - 3)) return null;
  return { x0, y0, w, mask: out };
}

interface LakePlan {
  level: number;
  tileIdx: number[];
  /** vertex index -> target height (only vertices that change or are constrained) */
  vertIdx: number[];
  lo: number[];
  hi: number[];
  cost: number;
  touched: number;
}

/** Plans the shelf: level = median footprint vertex height; bed/rim/bank bounds per vertex. */
function planLake(grid: Grid, fp: FootprintMask, margin: number): LakePlan | null {
  const N = grid.size, V = grid.vsize, h = grid.heights;
  const { x0, y0, w, mask } = fp;
  const inF = (x: number, y: number): boolean => {
    const i = x - x0, j = y - y0;
    return i >= 0 && j >= 0 && i < w && j < w && mask[j * w + i] === 1;
  };
  // window of vertices
  const wx0 = Math.max(0, x0 - margin), wy0 = Math.max(0, y0 - margin);
  const wx1 = Math.min(N, x0 + w + margin), wy1 = Math.min(N, y0 + w + margin);
  const ww = wx1 - wx0 + 1, wh = wy1 - wy0 + 1;
  const dist = new Int16Array(ww * wh).fill(-1); // Chebyshev distance to footprint vertices (0 = water vertex)
  const bed = new Int16Array(ww * wh).fill(-1); // distance inside to nearest shore vertex (0 = shore)
  const tileIdx: number[] = [];
  const q: number[] = [];
  const heights: number[] = [];
  for (let ty = y0; ty < y0 + w; ty++)
    for (let tx = x0; tx < x0 + w; tx++) {
      if (!inF(tx, ty)) continue;
      tileIdx.push(ty * N + tx);
      for (let k = 0; k < 4; k++) {
        const vx = tx + (k & 1), vy = ty + (k >> 1);
        const li = (vy - wy0) * ww + (vx - wx0);
        if (dist[li]! < 0) { dist[li] = 0; q.push(li); heights.push(h[vy * V + vx]!); }
      }
    }
  if (tileIdx.length < 9) return null;
  heights.sort((a, b) => a - b);
  const level = heights[heights.length >> 1]!;
  // shore vertices: any adjacent tile not in footprint
  const bq: number[] = [];
  for (const li of q) {
    const vx = wx0 + (li % ww), vy = wy0 + (li - (li % ww)) / ww;
    if (!(inF(vx - 1, vy - 1) && inF(vx, vy - 1) && inF(vx - 1, vy) && inF(vx, vy))) { bed[li] = 0; bq.push(li); }
  }
  for (let qi = 0; qi < bq.length; qi++) {
    const li = bq[qi]!;
    const lx = li % ww, ly = (li - lx) / ww;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const xx = lx + dx, yy = ly + dy;
      if (xx < 0 || yy < 0 || xx >= ww || yy >= wh) continue;
      const k = yy * ww + xx;
      if (dist[k] === 0 && bed[k]! < 0) { bed[k] = bed[li]! + 1; bq.push(k); }
    }
  }
  for (let qi = 0; qi < q.length; qi++) {
    const li = q[qi]!;
    const lx = li % ww, ly = (li - lx) / ww;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const xx = lx + dx, yy = ly + dy;
        if (xx < 0 || yy < 0 || xx >= ww || yy >= wh) continue;
        const k = yy * ww + xx;
        if (dist[k]! < 0 && dist[li]! < margin) { dist[k] = dist[li]! + 1; q.push(k); }
      }
  }
  const vertIdx: number[] = [], lo: number[] = [], hi: number[] = [];
  let cost = 0;
  for (let li = 0; li < ww * wh; li++) {
    const d = dist[li]!;
    if (d < 0) continue;
    const vx = wx0 + (li % ww), vy = wy0 + (li - (li % ww)) / ww;
    const cur = h[vy * V + vx]!;
    let a: number, b: number;
    if (d === 0) { a = b = level - Math.min(2, bed[li]!); } else { a = level - (d - 1); b = level + d; }
    const t = Math.min(b, Math.max(a, cur));
    cost += Math.abs(t - cur);
    vertIdx.push(vy * V + vx); lo.push(a); hi.push(b);
  }
  return { level, tileIdx, vertIdx, lo, hi, cost, touched: vertIdx.length };
}

function applyLake(grid: Grid, plan: LakePlan): void {
  const h = grid.heights;
  for (let i = 0; i < plan.vertIdx.length; i++) {
    const vi = plan.vertIdx[i]!;
    h[vi] = Math.min(plan.hi[i]!, Math.max(plan.lo[i]!, h[vi]!));
  }
}

/**
 * Lake validity: every water tile is inside the footprint with all corners <= level, and every non-water
 * 8-neighbour of a water tile has all corners >= level (water never overhangs lower ground).
 */
export function lakesValid(grid: Grid, lakes: ReadonlyArray<Pick<Lake, 'level' | 'tileIdx'>>): boolean {
  const N = grid.size;
  for (const lake of lakes) {
    const set = new Set(lake.tileIdx);
    for (const ti of lake.tileIdx) {
      const x = ti % N, y = (ti - x) / N;
      if (Math.max(...grid.getCorners(x, y)) > lake.level) return false;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (!grid.inBounds(nx, ny) || set.has(ny * N + nx)) continue;
          if (Math.min(...grid.getCorners(nx, ny)) < lake.level) return false;
        }
    }
  }
  return true;
}

/**
 * Ski-friendly shaping of the normalised height field (0..1):
 *  1. terracing: soft shelves at a few altitudes (organically warped), so slopes alternate steep riser / flat bench;
 *  2. thermal erosion: slopes beyond a talus angle are relaxed, except on cliff bands / the summit cone;
 *  3. renormalise so the summit still reaches full relief.
 */
interface Bench { x: number; y: number; r: number }

function shapeTerrain(
  raw: Float32Array, V: number, N: number, noise: Noise2D, r: Rng, va: { x: number; y: number }, R0: number, relief: number, talusMul = 1,
): Bench[] {
  const K = 3 + (N >= 128 ? 1 : 0) + (N >= 256 ? 1 : 0);
  const jit = r.next() * 0.3;
  const wob = 0.25 + r.next() * 0.2;
  const nf = 3.5 / N;
  const ox = r.next() * 100, oy = r.next() * 100;
  const sh = (x: number): number => (x < 0.5 ? 0.5 * Math.pow(2 * x, 3) : 1 - 0.5 * Math.pow(2 * (1 - x), 3));
  const cliffMask = new Float32Array(V * V);
  for (let vy = 0; vy < V; vy++)
    for (let vx = 0; vx < V; vx++) {
      const i = vy * V + vx, f = raw[i]!;
      const w = smoothstep(0.04, 0.16, f) * TERRAIN_TERRACE;
      const s = (f * (K + 1) + jit + wob * noise.fbm(vx * nf + ox, vy * nf + oy, 2)) ;
      const fl = Math.floor(s), u = sh(s - fl);
      const t = (fl + u - jit) / (K + 1);
      raw[i] = Math.max(0, f + (t - f) * w);
      // cliff bands: a few narrow bands in the alpine zone + the summit cone
      const band = smoothstep(0.62, 0.78, noise.fbm(vx * nf * 0.8 + ox + 300, vy * nf * 0.8 + oy, 2) * 0.5 + 0.5);
      const alt = smoothstep(0.35, 0.5, f) * (1 - smoothstep(0.8, 0.9, f));
      cliffMask[i] = Math.max(smoothstep(0.78, 0.9, f), band * alt);
    }
  // thermal erosion in half-steps
  const hh = new Float32Array(V * V);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < V * V; i++) { const v = raw[i]!; if (v < lo) lo = v; if (v > hi) hi = v; }
  const k = 1 / (hi - lo);
  for (let i = 0; i < V * V; i++) hh[i] = (raw[i]! - lo) * k * relief;
  const pin = new Uint8Array(V * V);
  for (let vy = 0; vy < V; vy++)
    for (let vx = 0; vx < V; vx++)
      if (Math.hypot(vx - va.x, (vy - va.y) * 0.9) < R0 * 0.95) pin[vy * V + vx] = 1;
  const iters = 24 + Math.round(N / 4);
  const off = [1, V, -1, -V];
  for (let it = 0; it < iters; it++)
    for (let vy = 0; vy < V; vy++)
      for (let vx = 0; vx < V; vx++) {
        const i = vy * V + vx;
        const T = (TERRAIN_TALUS + (TERRAIN_TALUS_CLIFF - TERRAIN_TALUS) * cliffMask[i]!) * talusMul;
        for (let d = 0; d < 4; d++) {
          if ((d === 0 && vx === V - 1) || (d === 1 && vy === V - 1) || (d === 2 && vx === 0) || (d === 3 && vy === 0)) continue;
          const j = i + off[d]!;
          const diff = hh[i]! - hh[j]!;
          if (diff > T) {
            const m = (diff - T) * 0.5;
            if (!pin[i]) hh[i] = hh[i]! - m;
            if (!pin[j]) hh[j] = hh[j]! + m;
          }
        }
      }
  let hlo = Infinity, hhi = -Infinity;
  for (let i = 0; i < V * V; i++) { const v = hh[i]!; if (v < hlo) hlo = v; if (v > hhi) hhi = v; }
  const kk = 1 / (hhi - hlo);
  for (let i = 0; i < V * V; i++) raw[i] = (hh[i]! - hlo) * kk;
  // Guaranteed benches: flat shelves (ski-station / building sites) at mid altitude, blended into the slope.
  const benchCount = 2 + (N >= 128 ? 1 : 0) + (N >= 256 ? 2 : 0);
  const taken: Array<{ x: number; y: number }> = [];
  const benches: Bench[] = [];
  for (let b = 0; b < benchCount; b++) {
    const rx = 4.6 + r.next() * 1.6, ry = 4.6 + r.next() * 1.6, fall = 5;
    let best: { x: number; y: number; q: number } | null = null;
    for (let tries = 0; tries < 150; tries++) {
      const cx = Math.round(8 + r.next() * (N - 16)), cy = Math.round(8 + r.next() * (N - 16));
      const f = raw[cy * V + cx]!;
      if (f < 0.3 || f > 0.72) continue;
      if (Math.hypot(cx - va.x, cy - va.y) < R0 * 1.5) continue;
      if (taken.some((t) => Math.hypot(t.x - cx, t.y - cy) < 10)) continue;
      let q = 0;
      for (let a = 0; a < 8; a++) q += Math.abs(raw[(cy + Math.round(5 * Math.sin(a * 0.785))) * V + cx + Math.round(5 * Math.cos(a * 0.785))]! - f);
      if (!best || q < best.q) best = { x: cx, y: cy, q };
    }
    if (!best) continue;
    taken.push(best);
    benches.push({ x: best.x, y: best.y, r: Math.max(rx, ry) });
    const lvl = raw[best.y * V + best.x]!;
    const ex = Math.ceil(rx + fall), ey = Math.ceil(ry + fall);
    for (let y = best.y - ey; y <= best.y + ey; y++)
      for (let x = best.x - ex; x <= best.x + ex; x++) {
        if (x < 0 || y < 0 || x >= V || y >= V) continue;
        const d = Math.hypot((x - best.x) / rx, (y - best.y) / ry);
        const wgt = 1 - smoothstep(1, 1 + fall / Math.min(rx, ry), d);
        const i = y * V + x;
        raw[i] = raw[i]! + (lvl - raw[i]!) * wgt;
      }
  }
  return benches;
}

export function generateTerrain(grid: Grid, seed: number, presetId: TerrainPresetId = 'balanced'): TerrainResult {
  const preset = presetOf(presetId);
  const N = grid.size, V = grid.vsize, h = grid.heights;
  const noise = new Noise2D(seed);
  const rng = new Rng(seed ^ 0x51ed270b);
  const relief = Math.round(terrainRelief(N) * preset.relief);

  // Valley / village at the south edge; mountain rises to the north and flanks.
  const villageAnchor = { x: N >> 1, y: Math.round(N * 0.84) };
  const roadEntry = { x: (N >> 1) - 6, y: N - 1 };
  const railEntry = { x: (N >> 1) + 6, y: N - 1 };
  const R0 = N * 0.17; // flat village radius
  const dmax = N * 0.85;

  // ---- Per-seed character (all drawn from rng => deterministic) ----
  const freq = ((2.2 + rng.next() * 2.2) * TERRAIN_FREQ_SCALE) / N; // feature size
  const warpAmt = 0.3 + rng.next() * 1.3; // domain-warp strength
  const sharp = 1.2 + rng.next() * 1.6; // ridge crest sharpness
  const ridgeAmp = 0.1 + rng.next() * 0.2;
  const baseW = 0.28 + rng.next() * 0.38; // weight of broad radial rise
  const peakW = 0.1 + rng.next() * 0.45; // weight of discrete peaks
  const valleyAngle = (rng.next() - 0.5) * 1.1; // valley axis tilt (radians)
  const valleyStretch = 0.75 + rng.next() * 0.5; // narrow vs wide valley
  const ridgeRot = rng.next() * Math.PI * 2; // ridgeline orientation for noise
  const cr = Math.cos(ridgeRot), sr = Math.sin(ridgeRot);
  const ridgeStretch = 0.6 + rng.next() * 0.9;
  const peakCount = rng.int(1, 3);
  const peaks: Array<{ x: number; y: number; sx: number; sy: number; a: number; c: number; s: number; h: number }> = [];
  const lineAng = rng.next() * Math.PI; // shared ridgeline direction for peaks
  for (let k = 0; k < peakCount; k++) {
    let px = N * 0.5, py = N * 0.3;
    for (let tries = 0; tries < 40; tries++) {
      px = N * (0.12 + rng.next() * 0.76);
      py = N * (0.08 + rng.next() * 0.62);
      if (Math.hypot(px - villageAnchor.x, py - villageAnchor.y) > N * 0.4) break;
    }
    const ang = lineAng + (rng.next() - 0.5) * 0.4;
    peaks.push({
      x: px, y: py,
      sx: N * (0.16 + rng.next() * 0.16) * (1 + rng.next() * 0.8),
      sy: N * (0.16 + rng.next() * 0.16),
      a: ang, c: Math.cos(ang), s: Math.sin(ang), h: 0.6 + rng.next() * 0.4,
    });
  }
  const terrainKind = rng.next(); // <0.25 plateau, 0.25..0.5 glacier bowl, else classic
  const plateau = terrainKind < 0.25;
  const bowl = terrainKind >= 0.25 && terrainKind < 0.5;
  const bowlPeak = peaks[0]!;
  const bowlR = N * (0.07 + rng.next() * 0.06);
  const bowlC = { x: bowlPeak.x + (rng.next() - 0.5) * N * 0.1, y: bowlPeak.y + N * 0.05 };
  const plateauCut = 0.62 + rng.next() * 0.16;
  // secondary valleys / passes: a line carved from the village outward
  const passes: Array<{ ang: number; w: number; depth: number }> = [];
  const passCount = rng.int(0, 2);
  for (let k = 0; k < passCount; k++)
    passes.push({ ang: -Math.PI / 2 + (rng.next() - 0.5) * 2.2, w: N * (0.03 + rng.next() * 0.04), depth: 0.35 + rng.next() * 0.35 });

  const raw = new Float32Array(V * V);
  for (let vy = 0; vy < V; vy++) {
    for (let vx = 0; vx < V; vx++) {
      // anisotropic, tilted distance from village => valley shape/orientation
      const ox = vx - villageAnchor.x, oy = (vy - villageAnchor.y) * 0.9;
      const ca = Math.cos(valleyAngle), sa = Math.sin(valleyAngle);
      const ux = ox * ca - oy * sa, uy = ox * sa + oy * ca;
      const d = Math.hypot(ux * valleyStretch, uy);
      const dTrue = Math.hypot(ox, oy);
      const t = Math.min(1, Math.max(0, (d - R0) / (dmax * Math.max(1, valleyStretch))));
      const nx = vx * freq, ny = vy * freq;
      const warp = noise.fbm(nx * 0.5 + 50, ny * 0.5, 2);
      const warp2 = noise.fbm(nx * 0.5, ny * 0.5 + 91, 2);
      const wx = nx + warp * warpAmt, wy = ny + warp2 * warpAmt;
      const rx = (wx * cr - wy * sr) * ridgeStretch, ry = wx * sr + wy * cr;
      const ridge = noise.ridged(rx, ry, 4, sharp);
      const detail = noise.fbm(nx * 2, ny * 2, 3);
      const gate = smoothstep(R0 * 0.8, R0 * 2.2, dTrue);
      const base = Math.pow(t, 1.15);
      let pk = 0;
      for (const p of peaks) {
        const dx = vx - p.x, dy = vy - p.y;
        const u = (dx * p.c + dy * p.s) / p.sx, w = (-dx * p.s + dy * p.c) / p.sy;
        pk += p.h * Math.exp(-(u * u + w * w));
      }
      pk = Math.min(1, pk);
      let val = baseW * base + peakW * pk * gate
        + gate * (ridgeAmp * ridge * smoothstep(0, 0.5, t + 0.15) + 0.06 * detail * base);
      if (bowl) {
        const bd = Math.hypot(vx - bowlC.x, vy - bowlC.y) / bowlR;
        val -= 0.22 * Math.exp(-bd * bd * 1.5) * gate;
        if (val < 0) val = 0;
      }
      for (const ps of passes) {
        const rel = Math.atan2(vy - villageAnchor.y, vx - villageAnchor.x);
        const perp = Math.abs(Math.sin(rel - ps.ang)) * dTrue;
        const along = Math.cos(rel - ps.ang) > 0 ? 1 : 0;
        val *= 1 - ps.depth * along * Math.exp(-((perp / ps.w) ** 2)) * gate;
      }
      raw[vy * V + vx] = val;
    }
  }
  // Smooth (four 3x3 box passes) so ridges stay attractive, not spiky.
  const tmp = new Float32Array(V * V);
  const smoothPasses = Math.max(1, (N <= 64 ? 6 : N <= 128 ? 5 : 4) + preset.smooth); // small maps are steeper per tile => smooth more (broad flanks)
  for (let pass = 0; pass < smoothPasses; pass++) {
    for (let y = 0; y < V; y++)
      for (let x = 0; x < V; x++) {
        let sum = 0, cnt = 0;
        for (let k = -1; k <= 1; k++) {
          const xx = x + k;
          if (xx < 0 || xx >= V) continue;
          sum += raw[y * V + xx]!; cnt++;
        }
        tmp[y * V + x] = sum / cnt;
      }
    for (let y = 0; y < V; y++)
      for (let x = 0; x < V; x++) {
        let sum = 0, cnt = 0;
        for (let k = -1; k <= 1; k++) {
          const yy = y + k;
          if (yy < 0 || yy >= V) continue;
          sum += tmp[yy * V + x]!; cnt++;
        }
        raw[y * V + x] = sum / cnt;
      }
  }
  const normalize = (): void => {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < V * V; i++) { const v = raw[i]!; if (v < lo) lo = v; if (v > hi) hi = v; }
    const k = 1 / (hi - lo);
    for (let i = 0; i < V * V; i++) raw[i] = (raw[i]! - lo) * k;
  };
  normalize();
  if (plateau) {
    for (let i = 0; i < V * V; i++) {
      const f = raw[i]!;
      if (f > plateauCut) raw[i] = plateauCut + (f - plateauCut) * 0.25;
    }
    normalize();
  }
  const benches = shapeTerrain(raw, V, N, noise, new Rng(seed ^ 0x2c1b3c6d), villageAnchor, R0, relief, preset.talus);
  for (let i = 0; i < V * V; i++) h[i] = Math.round(VALLEY_BASE + raw[i]! * relief);

  // Rock outcrops: a few smooth knolls in the foothills/alpine band (steep flanks become rock tiles).
  const outcropCount = rng.int(1, 2 + (N >> 7));
  for (let k = 0; k < outcropCount; k++) {
    const r = rng.int(3, 4), amp = rng.int(5, 8);
    let cx = 0, cy = 0, found = false;
    for (let tries = 0; tries < 20 && !found; tries++) {
      cx = rng.int(r + 2, N - r - 2); cy = rng.int(r + 2, N - r - 2);
      found = Math.hypot(cx - villageAnchor.x, cy - villageAnchor.y) >= R0 * 1.8;
    }
    if (!found) continue;
    for (let y = cy - r; y <= cy + r; y++)
      for (let x = cx - r; x <= cx + r; x++) {
        const f = Math.max(0, 1 - Math.hypot(x - cx, y - cy) / r);
        h[y * V + x] = h[y * V + x]! + Math.round(amp * f * f * (3 - 2 * f));
      }
  }

  // Lakes: level a flat shelf (water surface = one level), build banks so every rim vertex >= level,
  // lower the uphill side, lower a shallow bed inside. Verified after global invariant enforcement.
  enforceInvariant(grid);
  const lakes: Lake[] = [];
  const maxLakes = Math.max(1, rng.int(1, 2 + (N >> 6))) + preset.extraLakes;
  const minSep = N * 0.12;
  const rMax = N >= 128 ? 6 : 4;
  const MARGIN = 8;
  const lakeNoise = new Noise2D(seed ^ 0x1a4e);
  for (let attempt = 0; attempt < 500 && lakes.length < maxLakes; attempt++) {
    const thr = 0.7 + attempt * 0.012; // acceptable average earthwork per touched vertex (half-steps)
    const r = rng.int(3, rMax);
    const ecc = rng.next() * 0.35, rot = rng.next() * Math.PI, off = rng.next() * 100;
    const cx = rng.int(r + 4, N - r - 5), cy = rng.int(r + 4, N - r - 5);
    const dv = Math.hypot(cx - villageAnchor.x, cy - villageAnchor.y);
    if (dv - r * 1.5 - MARGIN < R0 * 0.9) continue;
    if (lakes.some((l) => Math.hypot(l.cx - cx, l.cy - cy) < minSep + r)) continue;
    if (attempt < 300 && benches.some((b) => Math.hypot(b.x - cx, b.y - cy) < b.r + r + 3)) continue; // keep benches dry
    const fp = lakeFootprint(lakeNoise, cx, cy, r, ecc, rot, off, N);
    if (!fp) continue;
    const plan = planLake(grid, fp, MARGIN);
    if (!plan || plan.cost / plan.touched > thr) continue;
    const z = altitudeZone(N, plan.level);
    if (z < 1 || z > 2) continue;
    const snapshot = h.slice();
    applyLake(grid, plan);
    enforceInvariant(grid);
    if (!lakesValid(grid, [...lakes, { level: plan.level, tileIdx: plan.tileIdx } as Lake])) {
      h.set(snapshot);
      continue;
    }
    lakes.push({ cx, cy, radius: r, level: plan.level, tiles: plan.tileIdx.length, tileIdx: plan.tileIdx });
  }

  // Tile types.
  grid.tileType.fill(TileType.Grass);
  for (const lake of lakes) for (const ti of lake.tileIdx) grid.tileType[ti] = TileType.Water;
  const streamRng = new Rng(rng.getState() ^ 0x7f4a7c15); // isolated: stream routing does not perturb later draws
  const streams = generateStreams(grid, streamRng, {
    villageAnchor, villageRadius: R0, relief, valleyBase: VALLEY_BASE, enforce: enforceInvariant,
    lakesOk: () => lakesValid(grid, lakes),
  });
  for (let i = 0; i < N * N; i++) {
    const t = grid.tileType[i]!;
    if (t === TileType.Water || t === TileType.Stream) grid.occupancy.flags[i]! |= OccFlag.Water;
  }
  const forest = new Uint8Array(N * N);
  const forestFreq = 0.05 + rng.next() * 0.09; // clump size
  const groveLo = 0.2 + rng.next() * 0.3 + preset.groveShift; // higher = more clearings
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      if (grid.tileType[i] === TileType.Water || grid.tileType[i] === TileType.Stream) continue;
      const c = grid.getCorners(x, y);
      const avg = (c[0] + c[1] + c[2] + c[3]) / 4;
      const frac = (avg - VALLEY_BASE) / relief;
      const steep = grid.steepness(x, y);
      if ((steep >= ROCK_STEEP && frac > ROCK_STEEP_MINALT) || (frac > ROCK_ALT && steep > ROCK_ALT_MINSTEEP)) {
        grid.tileType[i] = TileType.Rock;
        continue;
      }
      const alt = smoothstep(0.05, 0.25, frac) * (1 - smoothstep(0.55, 0.8, frac));
      const slopeF = 1 - smoothstep(0.8, 1.5, steep) * 0.7;
      const patch = 0.5 + 0.5 * noise.fbm(x * forestFreq, y * forestFreq + 200, 3);
      const grove = smoothstep(groveLo, groveLo + 0.25, patch);
      const dv = Math.hypot(x - villageAnchor.x, y - villageAnchor.y);
      const vil = smoothstep(R0 * 0.6, R0 * 1.4, dv);
      forest[i] = Math.round(255 * Math.min(1, alt * slopeF * (0.15 + 0.85 * grove) * vil * preset.forest));
    }
  }

  for (let cy = 0; cy < grid.chunksPerRow; cy++)
    for (let cx = 0; cx < grid.chunksPerRow; cx++) grid.markDirty(cx * 32, cy * 32);

  return { roadEntry, railEntry, villageAnchor, lakes, streams, forestDensity: forest };
}
