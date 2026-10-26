import { Grid, TileType } from './Grid';
import { Rng } from '../core/Rng';

export interface Stream {
  /** Tile path from spring downhill; consecutive tiles are 4-adjacent. */
  path: Array<{ x: number; y: number }>;
  /** Channel level per path tile (min corner height, half-steps); non-increasing along the path. */
  level: number[];
  /** How the stream ended: into a lake (adjacent water tile), at the map edge (last tile on the border), or into another stream (adjacent tile of it, at a level <= ours). Never a dead end. */
  end: 'lake' | 'edge' | 'merge';
}

export interface StreamContext {
  villageAnchor: { x: number; y: number };
  villageRadius: number;
  relief: number;
  valleyBase: number;
  enforce: (grid: Grid) => void;
  /** Optional check that lakes are still valid (rim >= level); streams violating it are rejected. */
  lakesOk?: () => boolean;
}

const FALL_LINE_K = 4;
const DIRS: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];

class MinHeap {
  private k: number[] = [];
  private v: number[] = [];
  get size(): number { return this.k.length; }
  reset(): void { this.k.length = 0; this.v.length = 0; }
  push(key: number, val: number): void {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p]! <= key) break;
      k[i] = k[p]!; v[i] = v[p]!; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop(): number {
    const k = this.k, v = this.v;
    const top = v[0]!;
    const lk = k.pop()!, lv = v.pop()!;
    const n = k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1]! < k[c]!) c++;
        if (k[c]! >= lk) break;
        k[i] = k[c]!; v[i] = v[c]!; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

/**
 * Route streams from springs to an outlet (lake / map edge / existing stream) with a least-cost search that
 * penalises climbing, then carve a monotonic channel (cutting through saddles). Every kept stream terminates
 * in an outlet; springs that cannot reach one within budget are dropped. Mutates heights + tileType.
 */
export function generateStreams(grid: Grid, rng: Rng, ctx: StreamContext): Stream[] {
  const N = grid.size, V = grid.vsize, h = grid.heights, T = grid.tileType;
  const sum = (x: number, y: number): number => {
    const i = y * V + x;
    return h[i]! + h[i + 1]! + h[i + V]! + h[i + V + 1]!;
  };
  const tileLevel = (x: number, y: number): number => {
    const i = y * V + x;
    return Math.min(h[i]!, h[i + 1]!, h[i + V]!, h[i + V + 1]!);
  };
  const tileMax = (x: number, y: number): number => {
    const i = y * V + x;
    return Math.max(h[i]!, h[i + 1]!, h[i + V]!, h[i + V + 1]!);
  };
  const forbidden = (x: number, y: number): boolean => {
    if (Math.hypot(x - ctx.villageAnchor.x, y - ctx.villageAnchor.y) < ctx.villageRadius * 1.35) return true;
    return y > N * 0.72 && Math.abs(x - (N >> 1)) <= 11; // road/rail corridor
  };
  const minLen = N >= 128 ? 10 : 8;
  const want = rng.int(2, 3 + (N >> 6));
  const salt = rng.int(1, 1 << 30);
  const jitter = (i: number): number => (Math.imul(i ^ salt, 0x9e3779b1) >>> 20) / 4096; // [0,1)
  const owner = new Int16Array(N * N); // stream index + 1
  const streams: Stream[] = [];
  const springs: Array<{ x: number; y: number }> = [];

  /** Outlet kind for a tile (ignoring `self` stream), with the outlet level to stay at or above. */
  const outletOf = (x: number, y: number, self: number): { kind: Stream['end']; level: number } | null => {
    for (let d = 0; d < 4; d++) {
      const nx = x + DIRS[d]![0], ny = y + DIRS[d]![1];
      if (!grid.inBounds(nx, ny)) continue;
      const ni = ny * N + nx;
      if (T[ni] === TileType.Water) return { kind: 'lake', level: tileMax(nx, ny) };
      if (T[ni] === TileType.Stream && owner[ni] !== self) return { kind: 'merge', level: tileLevel(nx, ny) };
    }
    if (x === 0 || y === 0 || x === N - 1 || y === N - 1) return { kind: 'edge', level: -1 };
    return null;
  };

  const dist = new Float64Array(N * N);
  const prev = new Int32Array(N * N);
  const heap = new MinHeap();
  const maxCost = N * 4;

  /** Least-cost tile path from spring to the nearest outlet, or null. */
  const route = (sx: number, sy: number): number[] | null => {
    dist.fill(Infinity);
    const si = sy * N + sx;
    dist[si] = 0; prev[si] = -1;
    heap.push(0, si);
    let found = -1;
    while (heap.size > 0) {
      const ci = heap.pop();
      const cx = ci % N, cy = (ci - cx) / N;
      const dc = dist[ci]!;
      if (ci !== si && outletOf(cx, cy, 0)) { found = ci; break; }
      const ce = sum(cx, cy) / 4;
      // gradient (half-steps per tile, pointing uphill) of the current tile
      const ci4 = cy * V + cx;
      const gn = h[ci4]!, ge = h[ci4 + 1]!, gw = h[ci4 + V]!, gs = h[ci4 + V + 1]!;
      const gx = (ge + gs - gn - gw) / 2, gy = (gw + gs - gn - ge) / 2;
      const gl = Math.hypot(gx, gy);
      for (let d = 0; d < 4; d++) {
        const nx = cx + DIRS[d]![0], ny = cy + DIRS[d]![1];
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const ni = ny * N + nx;
        if (T[ni] === TileType.Water || T[ni] === TileType.Stream || forbidden(nx, ny)) continue;
        const ne = sum(nx, ny) / 4;
        const climb = Math.max(0, ne - ce);
        // fall-line cost: 0 when moving straight downhill, large across contours / uphill on steep ground
        const cosDown = gl > 0.01 ? -(gx * DIRS[d]![0] + gy * DIRS[d]![1]) / gl : 1;
        const lateral = FALL_LINE_K * gl * (1 - cosDown);
        const nd = dc + 1 + jitter(ni) * 0.6 + climb * 5 + lateral;
        if (nd < dist[ni]! && nd < maxCost) { dist[ni] = nd; prev[ni] = ci; heap.push(nd, ni); }
      }
    }
    heap.reset();
    if (found < 0) return null;
    const out: number[] = [];
    for (let c = found; c >= 0; c = prev[c]!) out.push(c);
    return out.reverse();
  };

  /** Re-verify every stream's invariants (monotonic levels, valid outlet). */
  const verify = (): boolean => {
    if (ctx.lakesOk && !ctx.lakesOk()) return false;
    for (let si = 0; si < streams.length; si++) {
      const s = streams[si]!;
      let pl = Infinity;
      for (const p of s.path) {
        const lv = tileLevel(p.x, p.y);
        if (lv > pl) return false;
        pl = lv;
      }
      const last = s.path[s.path.length - 1]!;
      const o = outletOf(last.x, last.y, si + 1);
      if (!o || o.kind !== s.end || pl < o.level) return false;
    }
    return true;
  };

  let failures = 0;
  for (let attempt = 0; attempt < 120 && streams.length < want && failures < 40; attempt++) {
    const sx = rng.int(1, N - 2), sy = rng.int(1, N - 2);
    const si = sy * N + sx;
    if (T[si] === TileType.Water || T[si] === TileType.Stream || forbidden(sx, sy)) continue;
    const frac = (sum(sx, sy) / 4 - ctx.valleyBase) / ctx.relief;
    if (frac < 0.3 || frac > 0.85) continue;
    if (springs.some((s) => Math.hypot(s.x - sx, s.y - sy) < N * 0.08)) continue;
    if (grid.steepness(sx, sy) > 2.2) continue;

    const tiles = route(sx, sy);
    if (!tiles || tiles.length < minLen) { failures++; continue; }
    const path = tiles.map((t) => ({ x: t % N, y: (t - (t % N)) / N }));
    const last = path[path.length - 1]!;
    const o = outletOf(last.x, last.y, 0)!;
    // Minimal carving: a tile only gets its lowest corner lowered (by <= 1 half-step) when it would be higher
    // than the stream so far; on a proper fall line nothing is carved at all.
    const snapshot = h.slice();
    const idx = streams.length + 1;
    let run = Infinity, cut = 0, bad = false;
    for (const p of path) {
      const lv = tileLevel(p.x, p.y);
      if (lv > run) {
        if (lv - run > 1) { bad = true; break; }
        let best = 0, bh = Infinity;
        for (let k = 0; k < 4; k++) {
          const vi = (p.y + (k >> 1)) * V + p.x + (k & 1);
          if (h[vi]! < bh) { bh = h[vi]!; best = vi; }
        }
        h[best] = run; cut += lv - run;
      } else run = lv;
    }
    // reject streams that mostly traverse steep ground instead of running down the fall line
    let steepN = 0, levelN = 0;
    for (let i = 0; i + 1 < path.length; i++) {
      const p = path[i]!, q = path[i + 1]!;
      if (grid.steepness(p.x, p.y) < 1.5) continue;
      steepN++;
      if (sum(q.x, q.y) > sum(p.x, p.y) - 2) levelN++;
    }
    if (steepN > 3 && levelN > steepN * 0.4) bad = true;
    if (bad || cut > path.length * 0.25 + 3 || run < o.level) { h.set(snapshot); failures++; continue; }
    for (const t of tiles) { T[t] = TileType.Stream; owner[t] = idx; }
    ctx.enforce(grid);
    streams.push({ path, level: path.map((p) => tileLevel(p.x, p.y)), end: o.kind });
    if (!verify()) {
      streams.pop();
      h.set(snapshot);
      for (const t of tiles) { T[t] = TileType.Grass; owner[t] = 0; }
      failures++;
      continue;
    }
    springs.push({ x: sx, y: sy });
    for (const s of streams) s.level = s.path.map((p) => tileLevel(p.x, p.y));
  }
  return streams;
}
