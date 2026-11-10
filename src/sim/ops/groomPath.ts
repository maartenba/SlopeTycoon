/** Snowcat leg planning (pure): a straight line from A to B unless it crosses a building footprint, then an 8-connected A* around the footprints
 *  with line-of-sight shortcuts. `owner[i]` = building id + 1 on tile i (0 = free); the cat's own garage footprint (`own`) never blocks (it starts inside it). */
export function buildOwner(N: number, bs: Iterable<{ id: number; x: number; y: number; w: number; h: number; active?: boolean }>): Int32Array {
  const o = new Int32Array(N * N);
  for (const b of bs) for (let y = Math.max(0, b.y); y < Math.min(N, b.y + b.h); y++) for (let x = Math.max(0, b.x); x < Math.min(N, b.x + b.w); x++) o[y * N + x] = b.id + 1;
  return o;
}

const free = (o: Int32Array, N: number, x: number, y: number, own: number): boolean => { const t = Math.floor(y) * N + Math.floor(x); if (x < 0 || y < 0 || x >= N || y >= N) return false; const v = o[t]!; return v === 0 || v === own + 1; };
/** Clear of footprints with a margin m (tiles): the centre and the four points m away along the axes. */
const clearM = (o: Int32Array, N: number, x: number, y: number, own: number, m: number): boolean => free(o, N, x, y, own) && (m <= 0 || (free(o, N, x - m, y, own) && free(o, N, x + m, y, own) && free(o, N, x, y - m, own) && free(o, N, x, y + m, own)));

/** Is the straight segment clear of footprints (sampled every 0.25 tile, with a margin `m` except within `m + 1.2` tiles of either end: the garage / a cannon the cat works beside)? */
export function lineClear(o: Int32Array, N: number, ax: number, ay: number, bx: number, by: number, own: number, m = 0): boolean {
  const d = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(d / 0.25)), ex = m + 1.2;
  for (let i = 0; i <= n; i++) { const u = i / n, x = ax + (bx - ax) * u, y = ay + (by - ay) * u; const near = Math.hypot(x - ax, y - ay) < ex || Math.hypot(x - bx, y - by) < ex; if (!clearM(o, N, x, y, own, near ? 0 : m)) return false; }
  return true;
}

/** Waypoints (tile-centre x, y pairs, excluding the start, excluding the goal) to drive from (ax, ay) to (bx, by) around buildings; [] = go straight.
 *  First tries to keep 0.7 tile (and one tile in the A* grid) away from every footprint, because the drawn cat lags its sim position and would cut a corner; falls back to the footprint only. */
export function legWaypoints(o: Int32Array, N: number, ax: number, ay: number, bx: number, by: number, own: number): number[] {
  return plan(o, N, ax, ay, bx, by, own, true) ?? plan(o, N, ax, ay, bx, by, own, false) ?? [];
}

function plan(o: Int32Array, N: number, ax: number, ay: number, bx: number, by: number, own: number, infl: boolean): number[] | null {
  const m = infl ? 0.7 : 0;
  if (lineClear(o, N, ax, ay, bx, by, own, m)) return [];
  const sx = Math.min(N - 1, Math.max(0, Math.floor(ax))), sy = Math.min(N - 1, Math.max(0, Math.floor(ay))), gx = Math.min(N - 1, Math.max(0, Math.floor(bx))), gy = Math.min(N - 1, Math.max(0, Math.floor(by)));
  const S = sy * N + sx, G = gy * N + gx;
  const g = new Float32Array(N * N).fill(Infinity), from = new Int32Array(N * N).fill(-1), closed = new Uint8Array(N * N);
  const open: number[] = [S]; g[S] = 0; let guard = 0;
  const h = (i: number): number => { const dx = Math.abs((i % N) - gx), dy = Math.abs(((i / N) | 0) - gy); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
  const f = (i: number): number => g[i]! + h(i);
  const own1 = own + 1;
  const hard = (x: number, y: number): boolean => { const v = o[y * N + x]!; return v === 0 || v === own1; };
  const ok = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= N || y >= N) return false; if (y * N + x === G) return true; if (!hard(x, y)) return false;
    if (infl && Math.max(Math.abs(x - sx), Math.abs(y - sy)) > 1 && Math.max(Math.abs(x - gx), Math.abs(y - gy)) > 1) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < N && yy < N && !hard(xx, yy)) return false; }
    return true;
  };
  while (open.length && guard++ < 40000) {
    let bi = 0; for (let j = 1; j < open.length; j++) { const a = f(open[j]!), b = f(open[bi]!); if (a < b || (a === b && open[j]! < open[bi]!)) bi = j; }
    const cur = open[bi]!; open[bi] = open[open.length - 1]!; open.pop();
    if (closed[cur]) continue; closed[cur] = 1;
    if (cur === G) break;
    const cx = cur % N, cy = (cur / N) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue; const nx = cx + dx, ny = cy + dy; if (!ok(nx, ny)) continue;
      if (dx && dy && (!ok(cx + dx, cy) || !ok(cx, cy + dy))) continue; // no corner cutting
      const ni = ny * N + nx, ng = g[cur]! + (dx && dy ? 1.414 : 1);
      if (ng < g[ni]!) { g[ni] = ng; from[ni] = cur; open.push(ni); }
    }
  }
  if (from[G]! < 0 && S !== G) return null; // no way round (with this margin)
  const tiles: number[] = []; for (let i = G; i !== S && i >= 0; i = from[i]!) tiles.push(i); tiles.reverse();
  // line-of-sight shortcuts: from the current anchor, jump to the farthest tile still visible (same margin)
  const pts: number[] = []; let px = ax, py = ay, k = 0;
  while (k < tiles.length) {
    let far = k; for (let j = tiles.length - 1; j >= k; j--) { const tx = (tiles[j]! % N) + 0.5, ty = ((tiles[j]! / N) | 0) + 0.5; if (lineClear(o, N, px, py, tx, ty, own, m)) { far = j; break; } }
    const t = tiles[far]!; px = (t % N) + 0.5; py = ((t / N) | 0) + 0.5; if (far < tiles.length - 1 || Math.hypot(px - bx, py - by) > 1e-6) pts.push(px, py); k = far + 1;
  }
  if (pts.length >= 2 && Math.hypot(pts[pts.length - 2]! - bx, pts[pts.length - 1]! - by) < 1e-6) pts.length -= 2;
  return pts;
}

/** A target tile that lies under a foreign building (a snow cannon on the piste edge): the free neighbouring tile centre nearest to (cx, cy) to groom it from, or null when the tile is free / fenced in. */
export function standPoint(o: Int32Array, N: number, tx: number, ty: number, cx: number, cy: number, own: number): [number, number] | null {
  const x0 = Math.floor(tx), y0 = Math.floor(ty); const v = o[y0 * N + x0]!; if (v === 0 || v === own + 1) return null;
  let best: [number, number] | null = null, bd = Infinity;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue; const x = x0 + dx, y = y0 + dy; if (x < 0 || y < 0 || x >= N || y >= N) continue; const w = o[y * N + x]!; if (w !== 0 && w !== own + 1) continue;
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy); if (d < bd - 1e-9) { bd = d; best = [x + 0.5, y + 0.5]; }
  }
  return best;
}

/** The drawn cat lags its sim position and can clip a corner: if (x, y) is inside a foreign footprint tile, move it to the nearest edge whose far side is free (render only). Returns null when nothing has to move. */
export function pushOut(o: Int32Array, N: number, x: number, y: number, own: number): [number, number] | null {
  if (free(o, N, x, y, own) || x < 0 || y < 0 || x >= N || y >= N) return null;
  const tx = Math.floor(x), ty = Math.floor(y); let best: [number, number] | null = null, bd = Infinity;
  const cand: Array<[number, number, number, number]> = [[-1, 0, tx - 0.02, y], [1, 0, tx + 1.02, y], [0, -1, x, ty - 0.02], [0, 1, x, ty + 1.02]];
  for (const [dx, dy, px, py] of cand) { if (!free(o, N, tx + dx + 0.5, ty + dy + 0.5, own)) continue; const d = Math.hypot(px - x, py - y); if (d < bd) { bd = d; best = [px, py]; } }
  return best;
}
