/**
 * Generic grid pathfinding: full A* plus a hierarchical (HPA*-style) search over 32×32 clusters. No three/DOM imports and no
 * dependency on sim/: the graph is injected through `PathGraph`.
 *
 * Nodes are tile indices (y*size+x). Edges are implicit: a tile steps to its 4/8 neighbours when `step()` returns a cost >= 0, plus
 * optional long-range `links` (lifts). Hierarchy: per (mode, cluster) a lazily built abstract graph of border portals with local
 * intra-cluster costs; queries insert the start/goal, run A* on the abstract graph and refine each hop with a bounded local A*.
 * Only clusters dirtied by `markDirty` are rebuilt; the path cache is keyed by (mode, origin, goal) and flushed by an epoch counter.
 */

export const CLUSTER = 32;
const SQRT2 = Math.SQRT2;
const DEFER = new Error('pathfinding deferred (cluster build budget)');

export interface Link { to: number; cost: number; /** Caller-defined (lift id*2 + direction). */ tag: number }

export interface PathGraph {
  readonly size: number;
  /** Cost of stepping from tile a to the adjacent tile b for `mode`; negative when not traversable. Must be >= minCost(mode)*stepLength. */
  step(mode: number, a: number, b: number): number;
  /** 8-neighbour movement for this mode (else 4). */
  diagonals(mode: number): boolean;
  /** Long-range edges leaving tile `a` for this mode. Cost must be >= minCost*octile distance (admissible). */
  links(mode: number, a: number): readonly Link[] | undefined;
  /** Every tile that has links (they become portals). */
  linkNodes(): readonly number[];
  /** Admissible cost per tile of distance (heuristic scale). */
  minCost(mode: number): number;
  /** Distance between portals along a border (smaller = more accurate, slower to build). */
  portalSpacing?(mode: number): number;
}

export interface PathResult { nodes: Int32Array; cost: number }

export interface PathStats { queries: number; cacheHits: number; hierarchical: number; full: number; fallbacks: number; clustersBuilt: number; expansions: number }

interface Bounds { x0: number; y0: number; x1: number; y1: number }
interface Edge { to: number; cost: number }
interface ClusterData { portals: number[]; intra: Map<number, Edge[]>; inter: Map<number, Edge[]> }

class Heap {
  private k: number[] = [];
  private v: number[] = [];
  get size(): number { return this.k.length; }
  clear(): void { this.k.length = 0; this.v.length = 0; }
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
  peekKey(): number { return this.k[0]!; }
  popVal(): number {
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

/** Octile distance in tiles between two tile indices. */
export function octile(size: number, a: number, b: number): number {
  const dx = Math.abs((a % size) - (b % size)), dy = Math.abs(((a / size) | 0) - ((b / size) | 0));
  return dx > dy ? dx + (SQRT2 - 1) * dy : dy + (SQRT2 - 1) * dx;
}

const DX8 = [0, 1, 0, -1, 1, 1, -1, -1], DY8 = [-1, 0, 1, 0, -1, 1, 1, -1];

export class Pathfinder {
  readonly N: number;
  readonly stats: PathStats = { queries: 0, cacheHits: 0, hierarchical: 0, full: 0, fallbacks: 0, clustersBuilt: 0, expansions: 0 };
  /** Bumped by every dirtying / link / cost change; cached paths are only valid for the epoch they were found in. */
  epoch = 1;
  private readonly cpr: number;
  private g: Float32Array; private gen = new Uint32Array(0); private closed = new Uint32Array(0); private parent: Int32Array;
  private g2: Float64Array; private gen2 = new Uint32Array(0); private closed2 = new Uint32Array(0); private parent2: Int32Array;
  private tgt = new Uint32Array(0);
  private tgtIdx = new Int32Array(0);
  private cur = 0; private cur2 = 0; private curT = 0;
  private heap = new Heap();
  private heap2 = new Heap();
  private clusters = new Map<number, ClusterData>(); // key = mode * 4096 + cluster id
  private linkByCluster = new Map<number, number[]>();
  private cache = new Map<number, { e: number; r: PathResult | null }>();
  private cacheMax = 6000;
  /** Cluster builds allowed per `beginTick` window (time-slicing); a query needing more answers `undefined` and resumes next tick. */
  maxBuildsPerTick = Infinity;
  private builds = 0;

  constructor(private graph: PathGraph) {
    const n = graph.size;
    this.N = n;
    this.cpr = Math.ceil(n / CLUSTER);
    const n2 = n * n;
    this.g = new Float32Array(n2); this.gen = new Uint32Array(n2); this.closed = new Uint32Array(n2); this.parent = new Int32Array(n2);
    this.g2 = new Float64Array(n2); this.gen2 = new Uint32Array(n2); this.closed2 = new Uint32Array(n2); this.parent2 = new Int32Array(n2);
    this.tgt = new Uint32Array(n2); this.tgtIdx = new Int32Array(n2);
    this.refreshLinks();
  }

  /** Start a new time-slice window (resets the cluster-build budget). */
  beginTick(): void { this.builds = 0; }
  /** Extra cluster builds allowed in the current window (decision refreshes). */
  grantBuilds(n: number): void { this.builds -= n; }

  // ---------- invalidation ----------

  private cid(t: number): number { const n = this.N; return (((t / n) | 0) >> 5) * this.cpr + ((t % n) >> 5); }

  /** Tile traversability changed: rebuild the owning cluster (and the neighbour across a shared border) lazily. */
  markDirty(tile: number): void {
    const n = this.N, x = tile % n, y = (tile / n) | 0, c = this.cid(tile);
    this.dropCluster(c);
    const lx = x & 31, ly = y & 31;
    if (lx === 0 && x > 0) this.dropCluster(c - 1);
    if (lx === 31 && x < n - 1) this.dropCluster(c + 1);
    if (ly === 0 && y > 0) this.dropCluster(c - this.cpr);
    if (ly === 31 && y < n - 1) this.dropCluster(c + this.cpr);
    this.epoch++;
  }

  markAllDirty(): void { this.clusters.clear(); this.epoch++; }

  /** Link topology changed (lift built/removed/opened). */
  refreshLinks(): void {
    const old = new Set(this.linkByCluster.keys());
    this.linkByCluster.clear();
    for (const t of this.graph.linkNodes()) {
      const c = this.cid(t);
      let l = this.linkByCluster.get(c);
      if (!l) { l = []; this.linkByCluster.set(c, l); }
      l.push(t);
    }
    for (const c of old) this.dropCluster(c);
    for (const c of this.linkByCluster.keys()) this.dropCluster(c);
    this.epoch++;
  }

  /** Link costs changed (queue lengths): cached paths are stale, abstract structure is not. */
  bumpCosts(): void { this.epoch++; }

  private dropCluster(c: number): void { for (let m = 0; m < 16; m++) this.clusters.delete(m * 4096 + c); }

  // ---------- cache ----------

  private key(mode: number, a: number, b: number): number { return (mode * this.N * this.N + a) * this.N * this.N + b; }

  /** Cached result: PathResult, null (known unreachable) or undefined (not cached / stale). */
  cached(mode: number, from: number, to: number): PathResult | null | undefined {
    const e = this.cache.get(this.key(mode, from, to));
    return e && e.e === this.epoch ? e.r : undefined;
  }

  private store(mode: number, from: number, to: number, r: PathResult | null): void {
    if (this.cache.size >= this.cacheMax) this.cache.clear();
    this.cache.set(this.key(mode, from, to), { e: this.epoch, r });
  }

  // ---------- public queries ----------

  /** Reference A* over the whole map (no hierarchy, no cache). */
  findFull(mode: number, from: number, to: number): PathResult | null {
    const c = this.astar(mode, from, to, null, true, Infinity);
    return c < 0 ? null : this.result(mode, from, to);
  }

  /**
   * Hierarchical query with caching. Short queries use the plain A*. Returns `undefined` when the cluster-build budget of the
   * current tick ran out (partial progress is kept; ask again next tick).
   */
  find(mode: number, from: number, to: number): PathResult | null | undefined {
    const hit = this.cached(mode, from, to);
    if (hit !== undefined) { this.stats.cacheHits++; return hit; }
    this.stats.queries++;
    let r: PathResult | null | undefined;
    if (from === to) r = { nodes: Int32Array.of(from), cost: 0 };
    else {
      const n = this.N;
      const d = Math.max(Math.abs((from % n) - (to % n)), Math.abs(((from / n) | 0) - ((to / n) | 0)));
      if (d <= CLUSTER + (CLUSTER >> 1)) {
        const c = this.astar(mode, from, to, null, true, 5000);
        this.stats.full++;
        if (c >= 0) r = this.result(mode, from, to);
        else if (c === -1) r = null; // exhausted: truly unreachable
      }
      if (r === undefined) {
        try { r = this.hier(mode, from, to); } catch (e) { if (e === DEFER) return undefined; throw e; }
        if (r === null) {
          // corner-diagonal crossings are not portals: confirm with a capped full search before declaring unreachable
          this.stats.fallbacks++;
          const c = this.astar(mode, from, to, null, true, 30000);
          r = c >= 0 ? this.result(mode, from, to) : null;
        }
      }
    }
    this.store(mode, from, to, r ?? null);
    return r ?? null;
  }

  // ---------- core A* ----------

  private h(mode: number, a: number, b: number): number { return this.graph.minCost(mode) * octile(this.N, a, b); }

  /**
   * A* from `start` to `goal`. Returns cost; -1 = unreachable (search space exhausted); -2 = expansion cap hit.
   * Parents of the found path stay in `this.parent` (valid for the current `cur` generation).
   */
  private astar(mode: number, start: number, goal: number, b: Bounds | null, useLinks: boolean, cap: number): number {
    const n = this.N, gr = this.graph, diag = gr.diagonals(mode), dirs = diag ? 8 : 4;
    const gen = ++this.cur;
    const g = this.g, gens = this.gen, closed = this.closed, parent = this.parent, heap = this.heap;
    heap.clear();
    g[start] = 0; gens[start] = gen; parent[start] = -1;
    heap.push(this.h(mode, start, goal), start);
    let exp = 0;
    const x0 = b ? b.x0 : 0, y0 = b ? b.y0 : 0, x1 = b ? b.x1 : n - 1, y1 = b ? b.y1 : n - 1;
    while (heap.size) {
      const a = heap.popVal();
      if (closed[a] === gen) continue;
      closed[a] = gen;
      if (a === goal) { this.stats.expansions += exp; return g[a]!; }
      if (++exp > cap) { this.stats.expansions += exp; return -2; }
      const ga = g[a]!, ax = a % n, ay = (a / n) | 0;
      for (let k = 0; k < dirs; k++) {
        const nx = ax + DX8[k]!, ny = ay + DY8[k]!;
        if (nx < x0 || ny < y0 || nx > x1 || ny > y1) continue;
        const nb = ny * n + nx;
        if (closed[nb] === gen) continue;
        const c = gr.step(mode, a, nb);
        if (c < 0) continue;
        const ng = ga + c;
        if (gens[nb] !== gen || ng < g[nb]!) {
          gens[nb] = gen; g[nb] = ng; parent[nb] = a;
          heap.push(ng + this.h(mode, nb, goal), nb);
        }
      }
      if (useLinks) {
        const ls = gr.links(mode, a);
        if (ls) for (const l of ls) {
          if (closed[l.to] === gen) continue;
          const ng = ga + l.cost;
          if (gens[l.to] !== gen || ng < g[l.to]!) {
            gens[l.to] = gen; g[l.to] = ng; parent[l.to] = a;
            heap.push(ng + this.h(mode, l.to, goal), l.to);
          }
        }
      }
    }
    this.stats.expansions += exp;
    return -1;
  }

  /** Path found by the last astar, with its cost recomputed in double precision. */
  private result(mode: number, start: number, goal: number): PathResult {
    const nodes = this.extract(start, goal);
    return { nodes, cost: this.pathCost(mode, nodes) };
  }

  private extract(start: number, goal: number): Int32Array {
    const out: number[] = [];
    for (let t = goal; t !== -1; t = this.parent[t]!) { out.push(t); if (t === start) break; }
    out.reverse();
    return Int32Array.from(out);
  }

  /** Forward Dijkstra from `start` inside `b` (no links) until every target is settled. Returns cost per target (-1 = unreachable). */
  private dijkstra(mode: number, start: number, b: Bounds, targets: readonly number[]): number[] {
    const n = this.N, gr = this.graph, dirs = gr.diagonals(mode) ? 8 : 4;
    const gen = ++this.cur, tg = ++this.curT;
    const g = this.g, gens = this.gen, closed = this.closed, heap = this.heap, tmark = this.tgt;
    for (const t of targets) tmark[t] = tg;
    let left = targets.length;
    const res = new Array<number>(targets.length).fill(-1);
    const tix = this.tgtIdx;
    targets.forEach((t, i) => { tix[t] = i; });
    heap.clear();
    g[start] = 0; gens[start] = gen;
    heap.push(0, start);
    let exp = 0;
    while (heap.size && left > 0) {
      const a = heap.popVal();
      if (closed[a] === gen) continue;
      closed[a] = gen;
      exp++;
      if (tmark[a] === tg) { res[tix[a]!] = g[a]!; left--; }
      const ga = g[a]!, ax = a % n, ay = (a / n) | 0;
      for (let k = 0; k < dirs; k++) {
        const nx = ax + DX8[k]!, ny = ay + DY8[k]!;
        if (nx < b.x0 || ny < b.y0 || nx > b.x1 || ny > b.y1) continue;
        const nb = ny * n + nx;
        if (closed[nb] === gen) continue;
        const c = gr.step(mode, a, nb);
        if (c < 0) continue;
        const ng = ga + c;
        if (gens[nb] !== gen || ng < g[nb]!) { gens[nb] = gen; g[nb] = ng; heap.push(ng, nb); }
      }
    }
    this.stats.expansions += exp;
    return res;
  }

  // ---------- hierarchy ----------

  private bounds(c: number): Bounds {
    const cx = c % this.cpr, cy = (c / this.cpr) | 0, n = this.N;
    return { x0: cx * CLUSTER, y0: cy * CLUSTER, x1: Math.min(n - 1, cx * CLUSTER + CLUSTER - 1), y1: Math.min(n - 1, cy * CLUSTER + CLUSTER - 1) };
  }

  /**
   * Portal pairs across the border between cluster A and its east (dir 0) / south (dir 1) neighbour B, chosen purely from the
   * graph so both clusters derive the same list. Returns [a, b] tile pairs.
   */
  private borderPairs(mode: number, A: number, dir: 0 | 1): Array<[number, number]> {
    const n = this.N, gr = this.graph, ba = this.bounds(A);
    const spacing = gr.portalSpacing ? gr.portalSpacing(mode) : 4;
    const diag = gr.diagonals(mode);
    const len = (dir === 0 ? ba.y1 - ba.y0 : ba.x1 - ba.x0) + 1;
    const elig: Array<Array<[number, number]> | null> = [];
    const ecost: number[] = [];
    for (let t = 0; t < len; t++) {
      const a = dir === 0 ? (ba.y0 + t) * n + ba.x1 : ba.y1 * n + ba.x0 + t;
      let found: Array<[number, number]> | null = null;
      let best = Infinity;
      for (const o of diag ? [0, -1, 1] : [0]) {
        const u = t + o;
        if (u < 0 || u >= len) continue;
        const b = dir === 0 ? (ba.y0 + u) * n + ba.x1 + 1 : (ba.y1 + 1) * n + ba.x0 + u;
        const c1 = gr.step(mode, a, b), c2 = gr.step(mode, b, a);
        if (c1 < 0 && c2 < 0) continue;
        (found ??= []).push([a, b]);
        best = Math.min(best, c1 < 0 ? c2 : c2 < 0 ? c1 : Math.min(c1, c2));
      }
      elig.push(found); ecost[t] = best;
    }
    const out: Array<[number, number]> = [];
    const take = (u: number): void => { for (const p of elig[u]!) out.push(p); };
    let t = 0;
    while (t < len) {
      if (!elig[t]) { t++; continue; }
      let e = t;
      while (e + 1 < len && elig[e + 1]) e++;
      if (e - t + 1 <= 2 * spacing) { for (let u = t; u <= e; u++) take(u); } // narrow crossings (pistes): every tile, lateral moves are costly
      else {
        // one portal per window: the cheapest crossing (a path tile beats a flat piste shuffle)
        for (let w0 = t; w0 <= e; w0 += spacing) {
          let bu = w0;
          for (let u = w0 + 1; u <= Math.min(e, w0 + spacing - 1); u++) if (ecost[u]! < ecost[bu]! - 1e-9) bu = u;
          take(bu);
        }
      }
      t = e + 1;
    }
    return out;
  }

  private ensure(mode: number, c: number): ClusterData {
    const key = mode * 4096 + c;
    let d = this.clusters.get(key);
    if (d) return d;
    if (this.builds >= this.maxBuildsPerTick) throw DEFER;
    this.builds++;
    this.stats.clustersBuilt++;
    const cpr = this.cpr, cx = c % cpr, cy = (c / cpr) | 0;
    const portals = new Set<number>();
    const interRaw: Array<[number, number]> = []; // [mine, theirs]
    const consider = (pairs: Array<[number, number]>, mineFirst: boolean): void => {
      for (const [a, b] of pairs) { const mine = mineFirst ? a : b, theirs = mineFirst ? b : a; portals.add(mine); interRaw.push([mine, theirs]); }
    };
    if (cx + 1 < cpr) consider(this.borderPairs(mode, c, 0), true);
    if (cy + 1 < cpr) consider(this.borderPairs(mode, c, 1), true);
    if (cx > 0) consider(this.borderPairs(mode, c - 1, 0), false);
    if (cy > 0) consider(this.borderPairs(mode, c - cpr, 1), false);
    for (const t of this.linkByCluster.get(c) ?? []) portals.add(t);
    const plist = [...portals].sort((a, b) => a - b);
    d = { portals: plist, intra: new Map(), inter: new Map() };
    for (const [mine, theirs] of interRaw) {
      const cst = this.graph.step(mode, mine, theirs);
      if (cst < 0) continue;
      let l = d.inter.get(mine);
      if (!l) { l = []; d.inter.set(mine, l); }
      l.push({ to: theirs, cost: cst });
    }
    this.clusters.set(key, d);
    return d;
  }

  /** Intra-cluster edges of one portal, computed on first use (one bounded Dijkstra) and kept until the cluster is dirtied. */
  private intraOf(mode: number, c: number, d: ClusterData, p: number): Edge[] {
    let e = d.intra.get(p);
    if (e) return e;
    if (this.builds >= this.maxBuildsPerTick) throw DEFER;
    this.builds++;
    const costs = this.dijkstra(mode, p, this.bounds(c), d.portals);
    e = [];
    d.portals.forEach((q, i) => { if (q !== p && costs[i]! >= 0) e!.push({ to: q, cost: costs[i]! }); });
    d.intra.set(p, e);
    return e;
  }

  private hier(mode: number, from: number, to: number): PathResult | null {
    this.stats.hierarchical++;
    const gr = this.graph, n = this.N;
    const cs = this.cid(from), cg = this.cid(to);
    const ds = this.ensure(mode, cs);
    this.ensure(mode, cg);
    const bs = this.bounds(cs), bg = this.bounds(cg);
    let best = Infinity, bestVia = -1, direct: number[] | null = null;

    // start -> portals of its cluster (and goal if same cluster)
    const toIsPortal = ds.portals.includes(to);
    const targets = cs === cg && !toIsPortal ? [...ds.portals, to] : ds.portals;
    const sc = this.dijkstra(mode, from, bs, targets);
    if (cs === cg) {
      const dc = toIsPortal ? sc[ds.portals.indexOf(to)]! : sc[sc.length - 1]!;
      if (dc >= 0) { best = dc; direct = []; }
    }
    const gen = ++this.cur2;
    const g = this.g2, gens = this.gen2, closed = this.closed2, parent = this.parent2, heap = this.heap2;
    heap.clear();
    const hh = (t: number): number => gr.minCost(mode) * octile(n, t, to);
    ds.portals.forEach((p, i) => {
      const c = sc[i]!;
      if (c < 0) return;
      gens[p] = gen; g[p] = c; parent[p] = -2;
      heap.push(c + hh(p), p);
    });
    const goalCost = new Map<number, number>();
    while (heap.size) {
      const f = heap.peekKey();
      if (f >= best) break;
      const a = heap.popVal();
      if (closed[a] === gen) continue;
      closed[a] = gen;
      const ga = g[a]!, ca = this.cid(a);
      if (ca === cg) {
        let c = goalCost.get(a);
        if (c === undefined) {
          c = a === to ? 0 : this.astar(mode, a, to, bg, false, Infinity);
          if (c < 0) c = -1;
          goalCost.set(a, c);
        }
        if (c >= 0 && ga + c < best) { best = ga + c; bestVia = a; direct = null; }
      }
      const cd = this.ensure(mode, ca);
      const relax = (t: number, cost: number): void => {
        if (closed[t] === gen) return;
        const ng = ga + cost;
        if (gens[t] !== gen || ng < g[t]!) { gens[t] = gen; g[t] = ng; parent[t] = a; heap.push(ng + hh(t), t); }
      };
      for (const e of this.intraOf(mode, ca, cd, a)) relax(e.to, e.cost);
      const oe = cd.inter.get(a);
      if (oe) for (const e of oe) relax(e.to, e.cost);
      const ls = gr.links(mode, a);
      if (ls) for (const l of ls) relax(l.to, l.cost);
    }
    if (best === Infinity) return null;

    // refine
    const nodes: number[] = [];
    const local = (a: number, b: number, bd: Bounds): boolean => {
      const c = this.astar(mode, a, b, bd, false, Infinity);
      if (c < 0) return false;
      const seg = this.extract(a, b);
      for (let i = nodes.length ? 1 : 0; i < seg.length; i++) nodes.push(seg[i]!);
      return true;
    };
    if (direct) { if (!local(from, to, bs)) return null; }
    else {
      const chain: number[] = [];
      for (let t = bestVia; t !== -2; t = this.parent2[t]!) chain.push(t);
      chain.reverse();
      if (!local(from, chain[0]!, bs)) return null;
      for (let i = 1; i < chain.length; i++) {
        const u = chain[i - 1]!, v = chain[i]!, cu = this.cid(u), cv = this.cid(v);
        const lk = gr.links(mode, u)?.find((q) => q.to === v);
        if (lk && Math.abs(g[v]! - g[u]! - lk.cost) < 1e-6) nodes.push(v); // link jump
        else if (cu === cv) { if (!local(u, v, this.bounds(cu))) return null; }
        else nodes.push(v); // cluster hop
      }
      if (!local(chain[chain.length - 1]!, to, bg)) return null;
    }
    const arr = Int32Array.from(nodes);
    return { nodes: arr, cost: this.pathCost(mode, arr) };
  }

  /** Cost of a node list (steps + links); -1 if some hop is not traversable. */
  pathCost(mode: number, nodes: Int32Array): number {
    const n = this.N, gr = this.graph;
    let total = 0;
    for (let i = 1; i < nodes.length; i++) {
      const a = nodes[i - 1]!, b = nodes[i]!;
      const adj = Math.abs((a % n) - (b % n)) <= 1 && Math.abs(((a / n) | 0) - ((b / n) | 0)) <= 1;
      let c = adj ? gr.step(mode, a, b) : -1;
      if (c < 0) {
        const ls = gr.links(mode, a);
        const l = ls?.find((q) => q.to === b);
        if (!l) return -1;
        c = l.cost;
      }
      total += c;
    }
    return total;
  }
}
