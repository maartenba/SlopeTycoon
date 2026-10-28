import { GUEST_WALK_SPEED, NAV_MAX_QUERIES_PER_TICK } from '../../config/balance';
import { GuestStore, WP_MAX } from './Guest';
import { type NavGraph, isSkiMode } from './NavGraph';
import { PisteTraffic } from '../ops/PisteQuality';

export interface Goal {
  x: number; y: number;
  /** When set, the goal is the footprint (arrive adjacent to it, or anywhere inside it when `inside`). */
  rect?: { x: number; y: number; w: number; h: number };
  inside?: boolean;
  key: string;
}
/** 'lift': the next path edge is a lift ride - the caller queues the guest (see NavMovement.liftTag). */
export type MoveResult = 'moving' | 'arrived' | 'unreachable' | 'pending' | 'lift';

/**
 * Movement API. `NavMovement` (A* over the combined navigation graph) implements it; `SimpleMovement` is the old footpath-BFS kept
 * for fixtures that only provide a WalkNet.
 */
export interface Movement {
  /** Advance guest slot `i` one tick toward `goal`. */
  moveTo(store: GuestStore, i: number, goal: Goal): MoveResult;
  /** Networks changed: drop cached routing data. */
  invalidate(): void;
  /** Optional per-tick hook (resets the path-query budget). */
  beginTick?(tick: number): void;
}

/** Walkable view of the tile networks (Networks satisfies this: kind 1 = path, 2 = road). */
export interface WalkNet { readonly size: number; readonly kind: Uint8Array; readonly version: number }

const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
const MAX_FIELDS = 12;

/**
 * Simple movement: a BFS distance field over footpath/road tiles per goal (computed at most once per tick - time-sliced - and
 * cached per network version); guests descend the field. Guests off the network head for the nearest walkable tile within 3 tiles.
 */
export class SimpleMovement implements Movement {
  private fields = new Map<string, { v: number; d: Int16Array }>();
  private builtThisTick = -1;
  /** Fields computed total (diagnostics). */
  built = 0;
  private tick = 0;

  constructor(private net: () => WalkNet | null, private speed = GUEST_WALK_SPEED) {}

  /** Call once per tick before moving guests (resets the per-tick build budget). */
  beginTick(tick: number): void { this.tick = tick; }
  invalidate(): void { this.fields.clear(); }

  private walkable(net: WalkNet, x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= net.size || y >= net.size) return false;
    const k = net.kind[y * net.size + x]!;
    return k === 1 || k === 2;
  }

  private field(net: WalkNet, goal: Goal): Int16Array | null {
    const c = this.fields.get(goal.key);
    if (c && c.v === net.version) return c.d;
    if (this.builtThisTick === this.tick) return null; // time-slice: one BFS per tick
    this.builtThisTick = this.tick; this.built++;
    const n = net.size, d = new Int16Array(n * n).fill(-1);
    const q: number[] = [];
    const seed = (x: number, y: number): void => {
      if (!this.walkable(net, x, y)) return;
      const i = y * n + x;
      if (d[i]! < 0) { d[i] = 0; q.push(i); }
    };
    if (goal.rect) {
      const r = goal.rect;
      for (let x = r.x - 1; x <= r.x + r.w; x++) { seed(x, r.y - 1); seed(x, r.y + r.h); }
      for (let y = r.y; y < r.y + r.h; y++) { seed(r.x - 1, y); seed(r.x + r.w, y); }
    } else seed(Math.floor(goal.x), Math.floor(goal.y));
    for (let h = 0; h < q.length; h++) {
      const i = q[h]!, x = i % n, y = (i / n) | 0, nd = d[i]! + 1;
      for (let k = 0; k < 4; k++) {
        const nx = x + DX[k]!, ny = y + DY[k]!;
        if (!this.walkable(net, nx, ny)) continue;
        const ni = ny * n + nx;
        if (d[ni]! < 0) { d[ni] = nd; q.push(ni); }
      }
    }
    if (this.fields.size >= MAX_FIELDS) this.fields.delete(this.fields.keys().next().value as string);
    this.fields.set(goal.key, { v: net.version, d });
    return d;
  }

  moveTo(s: GuestStore, i: number, goal: Goal): MoveResult {
    const net = this.net();
    if (!net) return 'unreachable';
    const d = this.field(net, goal);
    if (!d) return 'pending';
    const n = net.size;
    const tx = Math.floor(s.x[i]!), ty = Math.floor(s.y[i]!);
    let tox: number, toy: number;
    const here = tx >= 0 && ty >= 0 && tx < n && ty < n ? d[ty * n + tx]! : -1;
    if (here === 0) return 'arrived';
    if (here > 0) {
      let best = here, bx = -1, by = -1;
      for (let k = 0; k < 4; k++) {
        const nx = tx + DX[k]!, ny = ty + DY[k]!;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const v = d[ny * n + nx]!;
        if (v >= 0 && v < best) { best = v; bx = nx; by = ny; }
      }
      if (bx < 0) return 'unreachable';
      tox = bx + 0.5; toy = by + 0.5;
    } else {
      // off-network: nearest reachable walkable tile within radius 3
      let best = Infinity, bx = -1, by = -1;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const nx = tx + dx, ny = ty + dy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n || d[ny * n + nx]! < 0) continue;
        const dist = dx * dx + dy * dy;
        if (dist < best) { best = dist; bx = nx; by = ny; }
      }
      if (bx < 0) return 'unreachable';
      tox = bx + 0.5; toy = by + 0.5;
    }
    const vx = tox - s.x[i]!, vy = toy - s.y[i]!, len = Math.hypot(vx, vy);
    if (len <= this.speed) { s.x[i] = tox; s.y[i] = toy; } else { s.x[i] = s.x[i]! + (vx / len) * this.speed; s.y[i] = s.y[i]! + (vy / len) * this.speed; }
    return 'moving';
  }
}

const RING_RADIUS = 3;

/**
 * Path-following movement over the NavGraph. Per-guest state (path, index, epoch) lives here keyed by store slot. Paths come from
 * the hierarchical pathfinder (cached, at most `maxQueries` uncached queries per tick; the rest answer 'pending'). After a
 * structural change a guest first re-validates its remaining path edge-by-edge and only re-queries if some edge broke.
 * Guests ride lifts through the 'lift' result; after the ride they resume the same path.
 */
export class NavMovement implements Movement {
  private paths: Array<Int32Array | null>;
  private idx: Int32Array; private epoch: Int32Array; private owner: Int32Array; private pend: Uint16Array;
  private gkey: string[]; private gmode: Uint8Array;
  /** Lift tag (liftId*2 + dir) of the ride requested by the last 'lift' result per slot. */
  readonly liftTag: Int32Array;
  private budget = NAV_MAX_QUERIES_PER_TICK;
  /** Diagnostics: uncached queries answered, pending answers. */
  queries = 0; pendings = 0;

  constructor(private graph: () => NavGraph | null, capacity: number, private maxQueries = NAV_MAX_QUERIES_PER_TICK) {
    this.paths = new Array<Int32Array | null>(capacity).fill(null);
    this.idx = new Int32Array(capacity); this.epoch = new Int32Array(capacity); this.owner = new Int32Array(capacity);
    this.pend = new Uint16Array(capacity); this.gkey = new Array<string>(capacity).fill(''); this.gmode = new Uint8Array(capacity).fill(255);
    this.liftTag = new Int32Array(capacity).fill(-1);
  }

  beginTick(): void { this.budget = this.maxQueries; this.graph()?.pf.beginTick(); }
  invalidate(): void { /* the graph diffs the networks itself; guests re-validate lazily via the epoch */ }
  /** Forget every path / pending query (save load: the nav graph is rebuilt lazily from the restored world). */
  resetAll(): void {
    this.paths.fill(null); this.gkey.fill(''); this.pend.fill(0); this.idx.fill(0); this.epoch.fill(0); this.owner.fill(0); this.gmode.fill(255); this.liftTag.fill(-1);
    this.budget = this.maxQueries;
  }
  /** Forget a guest's path (activity changed). */
  reset(i: number): void { this.paths[i] = null; this.gkey[i] = ''; this.pend[i] = 0; }
  /** The guest's current path (inspector / tests); null when none. */
  pathOf(i: number): { nodes: Int32Array; index: number } | null { const p = this.paths[i]; return p ? { nodes: p, index: this.idx[i]! } : null; }

  private inGoal(goal: Goal, tx: number, ty: number): boolean {
    const r = goal.rect;
    if (!r) return tx === Math.floor(goal.x) && ty === Math.floor(goal.y);
    if (goal.inside) return tx >= r.x && ty >= r.y && tx < r.x + r.w && ty < r.y + r.h;
    const inX = tx >= r.x && tx < r.x + r.w, inY = ty >= r.y && ty < r.y + r.h;
    return (inX && (ty === r.y - 1 || ty === r.y + r.h)) || (inY && (tx === r.x - 1 || tx === r.x + r.w));
  }

  /** Up to three nearest standable goal tiles for the mode, nearest first. */
  private goalTiles(g: NavGraph, mode: number, goal: Goal, fx: number, fy: number): number[] {
    const n = g.size, c: Array<{ t: number; d: number }> = [];
    const add = (x: number, y: number): void => {
      if (x < 0 || y < 0 || x >= n || y >= n) return;
      const t = y * n + x;
      if (!g.standable(mode, t) || g.isCrossing(t)) return; // nobody ever parks on a level crossing
      c.push({ t, d: (x - fx) * (x - fx) + (y - fy) * (y - fy) });
    };
    const r = goal.rect;
    if (r && goal.inside) { for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) add(x, y); }
    else if (r) {
      for (let x = r.x; x < r.x + r.w; x++) { add(x, r.y - 1); add(x, r.y + r.h); }
      for (let y = r.y; y < r.y + r.h; y++) { add(r.x - 1, y); add(r.x + r.w, y); }
    } else {
      const gx = Math.floor(goal.x), gy = Math.floor(goal.y);
      for (let dy = -RING_RADIUS; dy <= RING_RADIUS; dy++) for (let dx = -RING_RADIUS; dx <= RING_RADIUS; dx++) add(gx + dx, gy + dy);
      c.sort((a, b) => ((a.t % n - gx) ** 2 + ((a.t / n | 0) - gy) ** 2) - ((b.t % n - gx) ** 2 + ((b.t / n | 0) - gy) ** 2) || a.t - b.t);
      return c.slice(0, 3).map((e) => e.t);
    }
    c.sort((a, b) => a.d - b.d || a.t - b.t);
    return c.slice(0, 3).map((e) => e.t);
  }

  moveTo(s: GuestStore, i: number, goal: Goal): MoveResult {
    const g = this.graph();
    if (!g) return 'unreachable';
    const n = g.size;
    const cx = Math.floor(s.x[i]!), cy = Math.floor(s.y[i]!);
    if (cx < 0 || cy < 0 || cx >= n || cy >= n) return 'unreachable';
    const cur = cy * n + cx, mode = s.moveMode[i]!;
    if (this.owner[i] !== s.id[i]) { this.owner[i] = s.id[i]!; this.reset(i); }
    if (this.inGoal(goal, cx, cy)) { this.reset(i); return 'arrived'; }

    let p = this.paths[i] ?? null;
    if (p && (this.gkey[i] !== goal.key || this.gmode[i] !== mode)) p = null;
    if (p) {
      let j = this.idx[i]!;
      if (cur !== p[j] && cur !== p[j + 1]) {
        let f = -1;
        for (let k = Math.max(0, j - 1); k < p.length && k <= j + 8; k++) if (p[k] === cur) { f = k; break; }
        if (f < 0) p = null; else { j = f; this.idx[i] = f; }
      }
      if (p && this.epoch[i] !== g.epoch) {
        if (g.pathStillValid(mode, p, this.idx[i]!)) this.epoch[i] = g.epoch; else p = null;
      }
    }
    if (!p) {
      if (!g.standable(mode, cur)) return this.repairStart(s, i, g, mode, cx, cy);
      const tiles = this.goalTiles(g, mode, goal, s.x[i]!, s.y[i]!);
      if (!tiles.length) return 'unreachable';
      let found: Int32Array | null = null, waiting = false;
      for (const t of tiles) {
        let r = g.pf.cached(mode, cur, t);
        if (r === undefined) {
          if (this.budget <= 0) { waiting = true; continue; }
          this.budget--; this.queries++;
          r = g.pf.find(mode, cur, t);
          if (r === undefined) { waiting = true; this.budget = 0; continue; } // cluster-build budget spent this tick
        }
        if (r) { found = r.nodes; break; }
      }
      if (!found) {
        if (waiting) {
          this.pendings++;
          if (++this.pend[i]! > 240) { this.pend[i] = 0; return 'unreachable'; }
          return 'pending';
        }
        return 'unreachable';
      }
      p = found; this.paths[i] = p; this.idx[i] = 0; this.epoch[i] = g.epoch; this.gkey[i] = goal.key; this.gmode[i] = mode; this.pend[i] = 0;
    }
    this.pend[i] = 0;

    // follow the path
    let j = this.idx[i]!, time = 1, x = s.x[i]!, y = s.y[i]!;
    const skill = s.skill[i]!, ski = isSkiMode(mode);
    while (time > 1e-6 && j + 1 < p.length) {
      const a = p[j]!, b = p[j + 1]!;
      const ax = a % n, ay = (a / n) | 0, bx = b % n, by = (b / n) | 0;
      if (Math.abs(ax - bx) > 1 || Math.abs(ay - by) > 1) {
        s.x[i] = x; s.y[i] = y; this.idx[i] = j;
        this.liftTag[i] = g.liftTag(mode, a, b);
        return 'lift';
      }
      const v = g.speed(mode, a, b, skill);
      const tx = bx + 0.5, ty = by + 0.5;
      if (g.crossingClosed(b) && !(Math.floor(x) === bx && Math.floor(y) === by)) {
        // closed level crossing ahead: wait at the CENTRE of the approach tile (never nearer: family kids are glued to the leader +-0.25 tiles and must
        // stay out of the crossing too). A guest already past the centre steps back. Trains never stop for anyone (docs/crossings.md).
        const sx = ax + 0.5, sy = ay + 0.5, dd = Math.hypot(sx - x, sy - y), step = v * time;
        if (dd <= step) { x = sx; y = sy; g.world.onCrossingWait?.(); } else { x += ((sx - x) / dd) * step; y += ((sy - y) / dd) * step; }
        time = 0;
        break;
      }
      const d = Math.hypot(tx - x, ty - y);
      if (d / v <= time) {
        x = tx; y = ty; time -= d / v; j++;
        { const w = s.wpN[i]!; if (w < WP_MAX) { s.wp[(i * WP_MAX + w) * 2] = tx; s.wp[(i * WP_MAX + w) * 2 + 1] = ty; s.wpN[i] = w + 1; } }
        if (ski && g.isPiste(b)) { PisteTraffic.record(b); const df = g.difficultyAt(b); if (df > s.runMax[i]!) s.runMax[i] = df; }
      } else { x += ((tx - x) / d) * v * time; y += ((ty - y) / d) * v * time; time = 0; }
    }
    s.x[i] = x; s.y[i] = y; this.idx[i] = j;
    if (j + 1 >= p.length) { this.reset(i); return 'arrived'; } // reached the chosen goal tile
    return 'moving';
  }

  /** Guest stands on a tile its mode cannot use: walk to the nearest usable tile within a few tiles. */
  private repairStart(s: GuestStore, i: number, g: NavGraph, mode: number, cx: number, cy: number): MoveResult {
    const n = g.size;
    let best = Infinity, bx = -1, by = -1;
    // wider search for skiers: a closed piste (avalanche) can be several tiles wide/long
    const R = isSkiMode(mode) ? 10 : 4;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n || !g.standable(mode, ny * n + nx)) continue;
      const d = dx * dx + dy * dy;
      if (d < best) { best = d; bx = nx; by = ny; }
    }
    if (bx < 0) return 'unreachable';
    const tx = bx + 0.5, ty = by + 0.5, vx = tx - s.x[i]!, vy = ty - s.y[i]!, len = Math.hypot(vx, vy), v = GUEST_WALK_SPEED * 2;
    if (len <= v) { s.x[i] = tx; s.y[i] = ty; } else { s.x[i] = s.x[i]! + (vx / len) * v; s.y[i] = s.y[i]! + (vy / len) * v; }
    return 'moving';
  }
}
