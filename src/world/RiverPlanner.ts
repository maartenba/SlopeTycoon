import { MAX_TILE_DELTA, TileType, type Grid } from './Grid';
import { OccFlag } from './Occupancy';
import { MinHeap } from './Streams';
import { setCorners, type CornerChange } from './Terraform';
import { TERRAFORM_COST_PER_HALF_STEP } from '../config/balance';
import { RIVER } from '../config/rivers';
import type { PropStore } from './Props';
import type { CarvedCorner, Pt, RiverRec, RiverSink, RiverSource, Rivers } from './Rivers';

/**
 * River planning (Phase 6 Task 13, pure + deterministic: the grid is unchanged on return). A river runs from a SOURCE (a spring, a lake shore or a stream
 * bank) downhill to a SINK (a lake, the map edge, or a stream further downstream), 1 tile wide. The channel level never rises along the path; where the
 * ground does, the channel is CARVED (one corner of the tile is lowered to the running level, at most `RIVER.maxCarve` half-steps per tile). The search is a
 * cost-weighted A* (length + carve), so the stroke follows the fall line and only digs where it must.
 */
export interface RiverEnv {
  grid: Grid;
  /** A tile a river may start on as a spring (`Rivers.isSource`). Absent = no springs. */
  isSpring?: (x: number, y: number) => boolean;
  /** Natural lakes + player ponds: the rim invariant (non-water neighbours >= level) is re-checked around the channel. */
  lakes?: ReadonlyArray<{ level: number; tileIdx: readonly number[] }>;
  /** Footpath / road / rail / piste / trail layers on the tile (from Networks). */
  netAt?: (i: number) => number;
  liftClearanceViolations?: (changed: CornerChange[]) => number;
  multiplier?: () => number;
  props?: PropStore;
}

export interface TileRect { x0: number; y0: number; x1: number; y1: number }

export interface RiverPlan {
  ok: boolean;
  /** Primary refusal reason (plain language) when !ok. */
  reason?: string;
  /** Every reason found (the preview lists them). */
  reasons: string[];
  source?: RiverSource;
  sink?: RiverSink;
  end?: 'lake' | 'edge' | 'merge';
  path: Pt[];
  /** Channel level per tile after digging. */
  level: number[];
  /** Per-tile cut depth (half-steps below the original ground level), for the preview heat. */
  carveDepth: number[];
  maxCarve: number;
  /** Every corner the dig moves (including the soft ripple around deep cuts). */
  changed: CornerChange[];
  /** The corners the planner chose to lower (vertex index -> height). */
  targets: Map<number, number>;
  halfSteps: number;
  cost: number;
  earthCost: number;
  rect: TileRect;
}

export const REASON = {
  start: 'Start on dry ground: on a spring, beside a lake or beside a stream',
  noSource: 'A river needs a source: a spring, a lake shore or a stream bank',
  badSink: 'A river must end in a lake, a stream or at the map edge',
  sameLake: 'A river cannot end in the lake it starts from',
  uphill: "Water can't flow uphill here",
  deep: `Too deep to dig (max ${RIVER.maxCarve} per tile)`,
  blocked: 'Blocked by a building, lift, rail, path or other water',
  long: `Too long (max ${RIVER.maxTiles} tiles)`,
  short: `Too short (min ${RIVER.minTiles} tiles)`,
  lift: 'Digging here would break a lift cable clearance',
  ripple: 'The ground around the channel cannot be reshaped (water, building or piste next to it)',
  rim: 'Digging here would drain or break a lake bank',
} as const;

const DIRS: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const isWT = (t: number): boolean => t === TileType.Water || t === TileType.Stream;

const emptyPlan = (rect: TileRect, reason: string, reasons: string[] = [reason]): RiverPlan => ({ ok: false, reason, reasons, path: [], level: [], carveDepth: [], maxCarve: 0, changed: [], targets: new Map(), halfSteps: 0, cost: 0, earthCost: 0, rect });

/**
 * The channel edges of a path, as vertex-index pairs (vy * vsize + vx): edge 0 = the entry of tile 0 (the side facing away from tile 1), edge k + 1 = the side
 * shared by tile k and tile k + 1, last edge = the exit of the last tile (continuing straight on). Tile k is the ramp between edges k and k + 1. Pure.
 */
export function riverEdges(path: ReadonlyArray<Pt>, V: number): Array<[number, number]> {
  const n = path.length;
  const side = (p: Pt, dx: number, dy: number): [number, number] => {
    const a = p.y * V + p.x;
    if (dx === 1) return [a + 1, a + V + 1];
    if (dx === -1) return [a, a + V];
    if (dy === 1) return [a + V, a + V + 1];
    return [a, a + 1];
  };
  const dir = (k: number): [number, number] => {
    const q = k < n - 1 ? path[k + 1]! : path[k]!, p = k < n - 1 ? path[k]! : path[k - 1] ?? path[k]!;
    return [Math.sign(q.x - p.x), Math.sign(q.y - p.y)];
  };
  const out: Array<[number, number]> = [];
  if (n === 0) return out;
  const d0 = dir(0);
  out.push(side(path[0]!, -d0[0], -d0[1]));
  for (let k = 0; k < n; k++) { const d = dir(k); out.push(side(path[k]!, d[0], d[1])); }
  return out;
}

export function tileMinCorner(g: Grid, x: number, y: number): number {
  const i = y * g.vsize + x, h = g.heights;
  return Math.min(h[i]!, h[i + 1]!, h[i + g.vsize]!, h[i + g.vsize + 1]!);
}
const tileMaxCorner = (g: Grid, x: number, y: number): number => Math.max(...g.getCorners(x, y));

/** 4-connected component of tiles of the same water type as (x, y). */
function component(g: Grid, x: number, y: number): Set<number> {
  const N = g.size, t = g.tileType[y * N + x]!, out = new Set<number>(), q = [y * N + x];
  out.add(q[0]!);
  for (let h = 0; h < q.length; h++) {
    const c = q[h]!, cx = c % N, cy = (c - cx) / N;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (!g.inBounds(nx, ny)) continue;
      const n = ny * N + nx;
      if (g.tileType[n] === t && !out.has(n)) { out.add(n); q.push(n); }
    }
  }
  return out;
}

interface Goal { auto: boolean; water: Set<number> | null; edge: number; excludeLake: Set<number> | null }
interface Search { tiles: number[] | null; sink?: RiverSink; end?: 'lake' | 'edge' | 'merge'; tooLong?: boolean }

export function planRiver(env: RiverEnv, from: Pt, to: Pt | null = null): RiverPlan {
  const g = env.grid, N = g.size, T = g.tileType, V = g.vsize;
  const rect: TileRect = { x0: from.x, y0: from.y, x1: to?.x ?? from.x, y1: to?.y ?? from.y };
  if (!g.inBounds(from.x, from.y)) return emptyPlan(rect, REASON.start);
  const si = from.y * N + from.x;
  const mult = env.multiplier?.() ?? 1;

  // ---- source ----
  const placedSpring = (g.occupancy.flags[si]! & OccFlag.Decor) !== 0 && env.isSpring?.(from.x, from.y) === true;
  if (isWT(T[si]!) || T[si] === TileType.Ice || (g.occupancy.flags[si]! & OccFlag.Water)) return emptyPlan(rect, REASON.start);
  if (!placedSpring && ((g.occupancy.flags[si]! !== 0) || (env.netAt?.(si) ?? 0) !== 0)) return emptyPlan(rect, REASON.blocked);
  let source: RiverSource;
  let srcComp: Set<number> | null = null;
  if (env.isSpring?.(from.x, from.y)) source = { kind: 'spring', x: from.x, y: from.y };
  else {
    let via: Pt | null = null, kind: 'lake' | 'stream' = 'lake';
    for (const [dx, dy] of DIRS) {
      const nx = from.x + dx, ny = from.y + dy;
      if (!g.inBounds(nx, ny)) continue;
      const t = T[ny * N + nx]!;
      if (t === TileType.Stream) { via = { x: nx, y: ny }; kind = 'stream'; break; }
      if (t === TileType.Water && !via) { via = { x: nx, y: ny }; kind = 'lake'; }
    }
    if (!via) return emptyPlan(rect, REASON.noSource);
    source = { kind, x: from.x, y: from.y, via };
    srcComp = component(g, via.x, via.y);
  }

  // ---- sink ----
  const goal: Goal = { auto: false, water: null, edge: -1, excludeLake: source.kind === 'lake' ? srcComp : null };
  if (!to) goal.auto = true;
  else {
    if (!g.inBounds(to.x, to.y)) return emptyPlan(rect, REASON.badSink);
    const ti = to.y * N + to.x, tt = T[ti]!;
    if (tt === TileType.Water) {
      goal.water = component(g, to.x, to.y);
      if (srcComp && source.kind === 'lake' && srcComp.has(ti)) return emptyPlan(rect, REASON.sameLake);
    } else if (tt === TileType.Stream) goal.water = component(g, to.x, to.y);
    else if (to.x === 0 || to.y === 0 || to.x === N - 1 || to.y === N - 1) goal.edge = ti;
    else return emptyPlan(rect, REASON.badSink);
  }

  const lakeLevel = new Map<number, number>();
  const lvlOfWater = (ni: number): number => {
    if (T[ni] === TileType.Stream) return tileMinCorner(g, ni % N, (ni / N) | 0);
    const c = lakeLevel.get(ni);
    if (c !== undefined) return c;
    let lv = tileMaxCorner(g, ni % N, (ni / N) | 0);
    for (const l of env.lakes ?? []) if (l.tileIdx.includes(ni)) { lv = l.level; break; }
    lakeLevel.set(ni, lv);
    return lv;
  };

  const nearForeignWater = (x: number, y: number): boolean => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (!g.inBounds(nx, ny)) continue;
      const n = ny * N + nx;
      if (isWT(T[n]!) && !(srcComp?.has(n))) return true;
    }
    return false;
  };

  const heur = (x: number, y: number): number => {
    if (goal.edge >= 0) return Math.abs(x - (goal.edge % N)) + Math.abs(y - ((goal.edge / N) | 0));
    return 0;
  };

  const search = (limitCarve: boolean, blockers: boolean): Search => {
    const dist = new Float64Array(N * N).fill(Infinity), run = new Int16Array(N * N), prev = new Int32Array(N * N).fill(-1), len = new Uint16Array(N * N), done = new Uint8Array(N * N);
    const heap = new MinHeap();
    dist[si] = 0; run[si] = tileMinCorner(g, from.x, from.y); len[si] = 1;
    heap.push(heur(from.x, from.y), si);
    let expanded = 0, tooLong = false;
    while (heap.size > 0) {
      const ci = heap.pop();
      if (done[ci]) continue;
      done[ci] = 1;
      if (++expanded > RIVER.maxExpand) break;
      const cx = ci % N, cy = (ci - cx) / N, r = run[ci]!, L = len[ci]!;
      // goal test
      if (L >= RIVER.minTiles) {
        if ((cx === 0 || cy === 0 || cx === N - 1 || cy === N - 1) && (goal.auto || goal.edge === ci)) {
          const tiles: number[] = []; for (let c = ci; c >= 0; c = prev[c]!) tiles.push(c);
          return { tiles: tiles.reverse(), sink: { kind: 'edge', x: cx, y: cy }, end: 'edge' };
        }
        for (const [dx, dy] of DIRS) {
          const nx = cx + dx, ny = cy + dy;
          if (!g.inBounds(nx, ny)) continue;
          const ni = ny * N + nx, tt = T[ni]!;
          if (!isWT(tt)) continue;
          if (goal.water ? !goal.water.has(ni) : (tt === TileType.Water && goal.excludeLake?.has(ni))) continue;
          if (r < lvlOfWater(ni)) continue;
          const tiles: number[] = []; for (let c = ci; c >= 0; c = prev[c]!) tiles.push(c);
          return { tiles: tiles.reverse(), sink: { kind: tt === TileType.Water ? 'lake' : 'stream', x: nx, y: ny }, end: tt === TileType.Water ? 'lake' : 'merge' };
        }
      }
      if (blockers && ci !== si && nearForeignWater(cx, cy)) continue; // may only END beside water
      if (L >= RIVER.maxTiles) { tooLong = true; continue; }
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx, ny = cy + dy;
        if (!g.inBounds(nx, ny)) continue;
        const ni = ny * N + nx;
        if (done[ni] || isWT(T[ni]!) || T[ni] === TileType.Ice) continue;
        if (blockers && (g.occupancy.flags[ni] !== 0 || (env.netAt?.(ni) ?? 0) !== 0)) continue;
        const lv = tileMinCorner(g, nx, ny), carve = Math.max(0, lv - r);
        if (limitCarve && carve > RIVER.maxCarve) continue;
        const nd = dist[ci]! + 1 + RIVER.carveWeight * carve;
        if (nd < dist[ni]!) { dist[ni] = nd; prev[ni] = ci; run[ni] = Math.min(lv, r); len[ni] = L + 1; heap.push(nd + heur(nx, ny), ni); }
      }
    }
    return { tiles: null, tooLong };
  };

  const res = search(true, true);
  if (!res.tiles) {
    const reasons: string[] = [];
    const deep = search(false, true);
    if (deep.tiles) reasons.push(REASON.deep);
    const blocked = search(true, false);
    if (blocked.tiles) reasons.push(REASON.blocked);
    if (reasons.length === 0) {
      const both = search(false, false);
      if (both.tiles) reasons.push(REASON.deep, REASON.blocked);
    }
    if (res.tooLong || deep.tooLong) reasons.push(REASON.long);
    if (reasons.length === 0) reasons.push(REASON.uphill);
    return { ...emptyPlan(rect, reasons[0]!, reasons), source };
  }
  const tiles = res.tiles;
  const path: Pt[] = tiles.map((t) => ({ x: t % N, y: (t - (t % N)) / N }));

  // ---- exact carve profile (corners shared by neighbouring tiles are lowered once) ----
  const touchesWater = (vx: number, vy: number): boolean => {
    for (let ty = vy - 1; ty <= vy; ty++) for (let tx = vx - 1; tx <= vx; tx++) if (g.inBounds(tx, ty) && isWT(T[ty * N + tx]!)) return true;
    return false;
  };
  const targets = new Map<number, number>();
  const origLevel: number[] = [];
  for (const p of path) origLevel.push(tileMinCorner(g, p.x, p.y));
  // Channel BED: one level per tile EDGE along the path (entry edge of tile 0, then the edge between tile k and k + 1, then the exit of the last tile), never rising.
  // Both corners of an edge are lowered to that edge's level, so every tile is a clean ramp from its entry edge to its exit edge (no saw-tooth, no tile whose
  // surface climbs against the flow, no single-corner pit). A corner never rises; corners beside other water are left alone.
  const edges = riverEdges(path, V);
  let runL = Infinity;
  for (const e of edges) {
    runL = Math.min(runL, g.heights[e[0]]!, g.heights[e[1]]!);
    for (const c of e) {
      const orig = g.heights[c]!;
      if (orig <= runL) continue;
      const vx = c % V, vy = (c - vx) / V;
      if (touchesWater(vx, vy)) continue;
      if (orig - runL > RIVER.maxCarve) return { ...emptyPlan(rect, REASON.deep), source };
      const prevT = targets.get(c);
      targets.set(c, prevT === undefined ? runL : Math.min(prevT, runL));
    }
  }

  // ---- real terraform preview (ripple, occupancy, water, lift clearance) ----
  let changed: CornerChange[] = [], halfSteps = 0;
  if (targets.size > 0) {
    // the spring's own Decor mark must not veto the dig around it
    if (placedSpring) g.occupancy.flags[si]! &= ~OccFlag.Decor & 0xff;
    const pre = setCorners(g, targets, { commit: false, maxEdgeDelta: RIVER.maxEdgeDelta, liftClearanceViolations: env.liftClearanceViolations });
    if (placedSpring) g.occupancy.flags[si]! |= OccFlag.Decor;
    if (!pre.ok) {
      const reason = pre.reason === 'lift clearance' ? REASON.lift : pre.reason === 'nochange' ? '' : pre.reason === 'water' ? REASON.blocked : REASON.blocked;
      if (reason) return { ...emptyPlan(rect, reason), source };
    } else { changed = pre.changed; halfSteps = pre.halfSteps; }
  }
  // verify on the real heights, then roll back
  for (const c of changed) g.setCornerUnchecked(c.vx, c.vy, c.to);
  let fail: string | null = null;
  const level: number[] = [], carveDepth: number[] = [];
  let maxCarve = 0, pl = Infinity;
  for (let k = 0; k < path.length; k++) {
    const p = path[k]!, lv = tileMinCorner(g, p.x, p.y);
    if (lv > pl) { fail = REASON.uphill; break; }
    pl = lv; level.push(lv);
    const d = origLevel[k]! - lv; carveDepth.push(Math.max(0, d)); maxCarve = Math.max(maxCarve, d);
  }
  if (!fail && maxCarve > RIVER.maxCarve) fail = REASON.deep;
  if (!fail && res.sink && res.end !== 'edge') {
    const sl = lvlOfWater(res.sink.y * N + res.sink.x);
    if (level[level.length - 1]! < sl) fail = REASON.uphill;
  }
  if (!fail && changed.length > 0 && !rimsOk(g, env.lakes, changed)) fail = REASON.rim;
  if (!fail) for (const c of changed) if (Math.abs(c.to - c.from) > 64) { fail = REASON.deep; break; }
  for (let k = changed.length - 1; k >= 0; k--) g.setCornerUnchecked(changed[k]!.vx, changed[k]!.vy, changed[k]!.from);
  if (fail) return { ...emptyPlan(rect, fail), source };

  const earthCost = Math.round(halfSteps * TERRAFORM_COST_PER_HALF_STEP * mult);
  const cost = earthCost + Math.round(path.length * RIVER.costPerTile * mult);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of path) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  for (const c of changed) { x0 = Math.min(x0, c.vx - 1); y0 = Math.min(y0, c.vy - 1); x1 = Math.max(x1, c.vx); y1 = Math.max(y1, c.vy); }
  return {
    ok: true, reasons: [], source, sink: res.sink, end: res.end, path, level, carveDepth, maxCarve, changed, targets, halfSteps, cost, earthCost,
    rect: { x0: Math.max(0, x0), y0: Math.max(0, y0), x1: Math.min(N - 1, x1), y1: Math.min(N - 1, y1) },
  };
}

/** The lake invariant around changed corners: lake tiles keep every corner <= level, their non-water neighbours every corner >= level. */
function rimsOk(g: Grid, lakes: RiverEnv['lakes'], changed: CornerChange[]): boolean {
  if (!lakes || lakes.length === 0) return true;
  const N = g.size;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of changed) { x0 = Math.min(x0, c.vx - 1); y0 = Math.min(y0, c.vy - 1); x1 = Math.max(x1, c.vx); y1 = Math.max(y1, c.vy); }
  for (const lake of lakes) {
    const set = new Set(lake.tileIdx);
    for (const ti of lake.tileIdx) {
      const x = ti % N, y = (ti - x) / N;
      if (x < x0 - 2 || x > x1 + 2 || y < y0 - 2 || y > y1 + 2) continue;
      if (Math.max(...g.getCorners(x, y)) > lake.level) return false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (!g.inBounds(nx, ny) || set.has(ny * N + nx)) continue;
        if (Math.min(...g.getCorners(nx, ny)) < lake.level) return false;
      }
    }
  }
  return true;
}

export const MAX_RIVER_RIPPLE = MAX_TILE_DELTA;

// ------------------------------------------------------------------------------------------------------------------ commit

export interface RiverApplied { ok: boolean; reason?: string; rec?: RiverRec; touchedChunks: number[] }

/** Commit a plan from `planRiver` on the same state: carve, mark the tiles as stream (+ water occupancy), clear props. The caller charges `plan.cost`. */
export function applyRiver(env: RiverEnv, rivers: Rivers, plan: RiverPlan): RiverApplied {
  if (!plan.ok || !plan.source || !plan.sink || !plan.end) return { ok: false, reason: plan.reason, touchedChunks: [] };
  const g = env.grid, N = g.size;
  const touched = new Set<number>();
  const felled = env.props?.treesFelled ?? 0;
  const carved: CarvedCorner[] = [];
  if (plan.targets.size > 0) {
    const si = plan.source.y * N + plan.source.x, hadMark = plan.source.kind === 'spring' && (g.occupancy.flags[si]! & OccFlag.Decor) !== 0;
    if (hadMark) g.occupancy.flags[si]! &= ~OccFlag.Decor & 0xff;
    const res = setCorners(g, plan.targets, { commit: true, maxEdgeDelta: RIVER.maxEdgeDelta, props: env.props, liftClearanceViolations: env.liftClearanceViolations });
    if (hadMark && !res.ok) g.occupancy.flags[si]! |= OccFlag.Decor;
    if (!res.ok) return { ok: false, reason: 'The ground changed: plan the river again', touchedChunks: [] };
    for (const c of res.changed) { carved.push({ v: c.vy * g.vsize + c.vx, from: c.from, to: c.to }); }
    for (const c of res.touchedChunks) touched.add(c);
  }
  for (const p of plan.path) {
    const i = p.y * N + p.x;
    const tc: number[] = [];
    env.props?.removeInRect(p.x, p.y, p.x, p.y, tc);
    for (const c of tc) touched.add(c);
    g.tileType[i] = TileType.Stream;
    g.occupancy.flags[i]! = (g.occupancy.flags[i]! & ~OccFlag.Decor & 0xff) | OccFlag.Water;
    g.snowDepth[i] = 0;
    g.markDirty(p.x, p.y);
  }
  if (env.props) env.props.treesFelled = felled; // clearing the channel is not "felling" (sustainability stays neutral)
  const level = plan.path.map((p) => tileMinCorner(g, p.x, p.y));
  const rec = rivers.add({ path: plan.path.map((p) => ({ ...p })), level, source: plan.source, sink: plan.sink, end: plan.end, carved, cost: plan.cost });
  return { ok: true, rec, touchedChunks: [...touched] };
}

export interface RiverFillPlan { ok: boolean; reason?: string; rec?: RiverRec; cost: number }

/** Fill a river back in (bulldoze: refund 0, no fee). Refused while another river is fed by it. */
export const UNDER_BRIDGE_MSG = 'A bridge crosses the river: remove the bridge first';

export function planFillRiver(rivers: Rivers, riverId: number, env?: Pick<RiverEnv, 'netAt'>): RiverFillPlan {
  const rec = rivers.rivers.find((r) => r.id === riverId);
  if (!rec) return { ok: false, reason: 'No river here', cost: 0 };
  if (env?.netAt && rec.path.some((p) => env.netAt!(p.y * rivers.grid.size + p.x) !== 0)) return { ok: false, reason: UNDER_BRIDGE_MSG, rec, cost: 0 }; // a deck stands over the channel (Task 46)
  const mine = new Set(rec.path.map((p) => p.y * rivers.grid.size + p.x));
  for (const o of rivers.rivers) {
    if (o.id === rec.id) continue;
    if (mine.has(o.sink.y * rivers.grid.size + o.sink.x)) return { ok: false, reason: 'Another river flows into this one: fill that one in first', rec, cost: 0 };
    if (o.source.via && mine.has(o.source.via.y * rivers.grid.size + o.source.via.x)) return { ok: false, reason: 'Another river branches off this one: fill that one in first', rec, cost: 0 };
  }
  return { ok: true, rec, cost: 0 };
}

/** Put the ground back (corners the dig lowered return to their old height unless somebody changed them since), tiles become grass again. */
export function applyFillRiver(env: RiverEnv, rivers: Rivers, plan: RiverFillPlan): { ok: boolean; reason?: string; touchedChunks: number[] } {
  if (!plan.ok || !plan.rec) return { ok: false, reason: plan.reason, touchedChunks: [] };
  const g = env.grid, N = g.size, rec = plan.rec;
  const prevType: number[] = [], prevFlag: number[] = [];
  for (const p of rec.path) { const i = p.y * N + p.x; prevType.push(g.tileType[i]!); prevFlag.push(g.occupancy.flags[i]!); g.tileType[i] = TileType.Grass; g.occupancy.flags[i]! &= ~OccFlag.Water & 0xff; }
  const targets = new Map<number, number>();
  for (const c of rec.carved) if (g.heights[c.v] === c.to) targets.set(c.v, c.from);
  const touched = new Set<number>();
  if (targets.size > 0) {
    const res = setCorners(g, targets, { commit: true, maxEdgeDelta: RIVER.maxEdgeDelta, props: env.props });
    if (!res.ok && res.reason !== 'nochange') {
      rec.path.forEach((p, k) => { const i = p.y * N + p.x; g.tileType[i] = prevType[k]!; g.occupancy.flags[i] = prevFlag[k]!; });
      return { ok: false, reason: 'Something stands next to the channel: remove it first', touchedChunks: [] };
    }
    for (const c of res.touchedChunks) touched.add(c);
  }
  for (const p of rec.path) {
    const i = p.y * N + p.x;
    g.snowDepth[i] = 0;
    if (rivers.isPlacedSpring(p.x, p.y)) g.occupancy.flags[i]! |= OccFlag.Decor; // the spring marker stays
    g.markDirty(p.x, p.y);
  }
  rivers.remove(rec.id);
  return { ok: true, touchedChunks: [...touched] };
}
