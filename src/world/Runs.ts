/**
 * Pistes as RUNS (docs/runs.md). The player paints strokes; the game used to treat every 8-connected blob of ski tiles as ONE piste. A run is an EDGE of
 * a graph over the painted tiles:
 *   nodes = junctions (3+ branches meet), lift stations (forced), dead ends (absorbed into their run);
 *   runs  = the tile chains between nodes, oriented downhill (`from` = the higher end).
 * Wide pistes are thinned (Zhang-Suen) to a centre line, short thinning spurs are pruned, and every other tile is handed to the nearest run by a
 * deterministic multi-source flood fill (so a 6-wide slope is ONE run, not a ladder of runs). Pure and deterministic: no DOM, no three.js, no RNG.
 *
 * Invariant (tested): every piste tile belongs to exactly one run (`runOf`) OR is a skeleton tile of a node (`nodeOf`, `runOf = -1`).
 */
import { TILE_METRES } from '../config/balance';
import type { Pt } from '../sim/Dependencies';

export interface Run {
  /** Index in `RunNetwork.runs` (not persistent: the persistent id is `Names.pisteId(run)`). */
  index: number;
  /** Every tile owned by this run (chain + the flood-filled width). `count` = tiles.length. */
  tiles: number[];
  count: number;
  /** Centre line, top to bottom (tile indices), including the adjacent node tiles at both ends. */
  poly: number[];
  /** Upstream (higher) / downstream node index, -1 for a dead end. */
  from: number;
  to: number;
  top: Pt;
  bottom: Pt;
  /** World-unit altitude (mean corner height) of the top / bottom of the centre line. */
  topAlt: number;
  bottomAlt: number;
  lengthM: number;
  dropM: number;
  avgSlopePct: number;
  maxSlopePct: number;
  /** 1 green .. 4 black: majority of this run's own tiles (stored difficulty is 0..3). */
  difficulty: number;
  /** A closed ring (no ends / junctions) or a loop edge back to its own node. */
  loop: boolean;
  /** No centre line could be derived (blob / 2x2): the run is the whole component. */
  synthetic: boolean;
  /** Filled by RunIndex from the Networks disconnected mask. */
  disconnected: boolean;
}

export interface RunNode {
  index: number;
  kind: 'junction' | 'station';
  /** Skeleton tiles of the node. */
  tiles: number[];
  pos: Pt;
  /** Runs that arrive here (`to` = this node) / leave from here (`from`). */
  runsIn: number[];
  runsOut: number[];
}

export interface RunInput {
  size: number;
  /** Non-zero where the tile is a piste (ski) tile. */
  mask: ArrayLike<number>;
  /** World-unit altitude of a tile. */
  alt(i: number): number;
  /** Stored difficulty 0..3 per tile. */
  difficulty: ArrayLike<number>;
  /** Lift station centres in tile coordinates: the nearest centre-line tile becomes a (forced) node. */
  stations?: ReadonlyArray<Pt>;
}

export interface RunNetwork {
  size: number;
  runs: Run[];
  nodes: RunNode[];
  /** Run index per tile (-1: not piste, or a node tile). */
  runOf: Int32Array;
  /** Node index per tile (-1 = not a node tile). */
  nodeOf: Int32Array;
  /** The run a tile is part of; node tiles answer with the run they lead into (lowest index). */
  runAt(tile: number): Run | null;
}

/** Shorter than this (tiles) and a dead-end branch is a thinning spur, not a run. */
export const RUN_MIN_SPUR = 1;
/** How far (tiles) from a lift station footprint centre the centre line may be and still become the station node. */
export const STATION_REACH = 4;

const OX = [0, 1, 1, 1, 0, -1, -1, -1], OY = [-1, -1, 0, 1, 1, 1, 0, -1]; // ring order N NE E SE S SW W NW

interface Cluster { index: number; tiles: number[]; forced: boolean; junction: boolean; dead: boolean }
interface Edge { a: number; b: number; poly: number[]; chain: number; dead: boolean }

export function buildRuns(inp: RunInput): RunNetwork {
  const n = inp.size, N = n * n, m = inp.mask;
  const tiles: number[] = [];
  for (let i = 0; i < N; i++) if (m[i]) tiles.push(i);
  const runOf = new Int32Array(N).fill(-1), nodeOf = new Int32Array(N).fill(-1);
  const runs: Run[] = [], nodes: RunNode[] = [];
  const net: RunNetwork = { size: n, runs, nodes, runOf, nodeOf, runAt: (t) => (runOf[t]! >= 0 ? runs[runOf[t]!]! : nodeOf[t]! >= 0 ? runs[nodes[nodeOf[t]!]!.runsOut[0] ?? nodes[nodeOf[t]!]!.runsIn[0] ?? -1] ?? null : null) };
  if (!tiles.length) return net;

  const inMask = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < n && y < n && !!m[y * n + x];

  // ---- 1. thinning (Zhang-Suen) ----
  const sk = new Uint8Array(N);
  for (const t of tiles) sk[t] = 1;
  const at = (x: number, y: number): number => (x >= 0 && y >= 0 && x < n && y < n ? sk[y * n + x]! : 0);
  const ring = new Uint8Array(8);
  const readRing = (x: number, y: number): void => { for (let k = 0; k < 8; k++) ring[k] = at(x + OX[k]!, y + OY[k]!); };
  const transitions = (): number => { let a = 0; for (let k = 0; k < 8; k++) if (!ring[k] && ring[(k + 1) & 7]) a++; return a; };
  let cand = tiles.slice();
  for (let changed = true; changed;) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      const del: number[] = [];
      for (const i of cand) {
        const x = i % n, y = (i / n) | 0;
        readRing(x, y);
        let b = 0; for (let k = 0; k < 8; k++) b += ring[k]!;
        if (b < 2 || b > 6 || transitions() !== 1) continue;
        if (step === 0) { if ((ring[0]! & ring[2]! & ring[4]!) || (ring[2]! & ring[4]! & ring[6]!)) continue; }
        else if ((ring[0]! & ring[2]! & ring[6]!) || (ring[0]! & ring[4]! & ring[6]!)) continue;
        del.push(i);
      }
      if (del.length) { for (const d of del) sk[d] = 0; changed = true; cand = cand.filter((i) => sk[i]!); }
    }
  }

  // ---- 2. distance to the edge of the piste (chamfer, 8-neighbour): the local half width ----
  const dt = new Int16Array(N);
  {
    const q: number[] = [];
    for (const t of tiles) {
      const x = t % n, y = (t / n) | 0;
      let edge = false;
      for (let k = 0; k < 8 && !edge; k++) if (!inMask(x + OX[k]!, y + OY[k]!)) edge = true;
      if (edge) { dt[t] = 1; q.push(t); }
    }
    for (let h = 0; h < q.length; h++) {
      const t = q[h]!, x = t % n, y = (t / n) | 0;
      for (let k = 0; k < 8; k++) { const nx = x + OX[k]!, ny = y + OY[k]!; if (!inMask(nx, ny)) continue; const u = ny * n + nx; if (!dt[u]) { dt[u] = dt[t]! + 1; q.push(u); } }
    }
  }

  // ---- 3. classify skeleton tiles, cluster the node tiles ----
  const skTiles = tiles.filter((t) => sk[t]);
  const isNode = new Uint8Array(N), isJunction = new Uint8Array(N), isForced = new Uint8Array(N);
  for (const s of inp.stations ?? []) {
    let best = -1, bd = Infinity;
    for (let dy = -STATION_REACH; dy <= STATION_REACH; dy++) for (let dx = -STATION_REACH; dx <= STATION_REACH; dx++) {
      const x = Math.floor(s.x) + dx, y = Math.floor(s.y) + dy;
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      const i = y * n + x;
      if (!sk[i]) continue;
      const d = (x + 0.5 - s.x) ** 2 + (y + 0.5 - s.y) ** 2;
      if (d < bd || (d === bd && i < best)) { bd = d; best = i; }
    }
    if (best >= 0) isForced[best] = 1;
  }
  for (const t of skTiles) {
    readRing(t % n, (t / n) | 0);
    let b = 0; for (let k = 0; k < 8; k++) b += ring[k]!;
    const a = transitions();
    if (a >= 3 || (a === 0 && b > 0)) { isNode[t] = 1; isJunction[t] = 1; }
    else if (a <= 1) isNode[t] = 1; // endpoint (or fat tip)
    if (isForced[t]) isNode[t] = 1;
  }
  const clusterOf = new Int32Array(N).fill(-1);
  const clusters: Cluster[] = [];
  for (const s of skTiles) {
    if (!isNode[s] || clusterOf[s]! >= 0) continue;
    const c: Cluster = { index: clusters.length, tiles: [s], forced: false, junction: false, dead: false };
    clusterOf[s] = c.index;
    for (let h = 0; h < c.tiles.length; h++) {
      const t = c.tiles[h]!;
      if (isForced[t]) c.forced = true;
      if (isJunction[t]) c.junction = true;
      const x = t % n, y = (t / n) | 0;
      for (let k = 0; k < 8; k++) { const nx = x + OX[k]!, ny = y + OY[k]!; if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue; const u = ny * n + nx; if (isNode[u] && clusterOf[u]! < 0) { clusterOf[u] = c.index; c.tiles.push(u); } }
    }
    c.tiles.sort((p, q) => p - q);
    clusters.push(c);
  }

  // ---- 4. chains between clusters ----
  const visited = new Uint8Array(N);
  const edges: Edge[] = [];
  for (const c of clusters) {
    for (const t of c.tiles) {
      const x = t % n, y = (t / n) | 0;
      for (let k = 0; k < 8; k++) {
        const nx = x + OX[k]!, ny = y + OY[k]!;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const u = ny * n + nx;
        if (!sk[u] || isNode[u] || visited[u]) continue;
        const poly = [t, u], chain = [u];
        visited[u] = 1;
        let cur = u, endC = -1;
        for (;;) {
          const cx = cur % n, cy = (cur / n) | 0;
          let bestNode = -1, bestNext = -1;
          for (let j = 0; j < 8; j++) {
            const ax = cx + OX[j]!, ay = cy + OY[j]!;
            if (ax < 0 || ay < 0 || ax >= n || ay >= n) continue;
            const v = ay * n + ax;
            if (!sk[v]) continue;
            if (isNode[v]) { if ((clusterOf[v] !== c.index || chain.length >= 3) && (bestNode < 0 || v < bestNode)) bestNode = v; }
            else if (!visited[v] && (bestNext < 0 || v < bestNext)) bestNext = v;
          }
          if (bestNode >= 0) { endC = clusterOf[bestNode]!; poly.push(bestNode); break; }
          if (bestNext < 0) break;
          visited[bestNext] = 1; chain.push(bestNext); poly.push(bestNext); cur = bestNext;
        }
        if (endC >= 0) edges.push({ a: c.index, b: endC, poly, chain: chain.length, dead: false });
        else edges.push({ a: c.index, b: -1, poly, chain: chain.length, dead: false });
      }
    }
  }
  // dangling chains (no node at the far end) get a synthetic dead end: the last tile
  for (const e of edges) if (e.b < 0) {
    const last = e.poly[e.poly.length - 1]!;
    const c: Cluster = { index: clusters.length, tiles: [last], forced: false, junction: false, dead: false };
    clusters.push(c); e.b = c.index; clusterOf[last] = c.index;
  }

  // ---- 5. prune thinning spurs, dissolve pseudo nodes ----
  // incremental degree table (was an O(edges) scan per query: quadratic on busy networks)
  const degs = new Int32Array(clusters.length);
  for (const e of edges) { degs[e.a]!++; degs[e.b]!++; }
  const deg = (ci: number): number => degs[ci]!;
  const spurLimit = (c: Cluster): number => { let w = 1; for (const t of c.tiles) w = Math.max(w, dt[t]!); return Math.max(RUN_MIN_SPUR, w); };
  for (let again = true; again;) {
    again = false;
    for (const e of edges) {
      if (e.dead || e.a === e.b) continue;
      for (const [leaf, other] of [[e.a, e.b], [e.b, e.a]] as const) {
        const lc = clusters[leaf]!, oc = clusters[other]!;
        if (lc.forced || deg(leaf) !== 1) continue;
        const od = deg(other);
        if (!(od >= 3 || (oc.forced && od >= 2))) continue;
        if (e.chain > spurLimit(oc)) continue;
        e.dead = true; lc.dead = true; degs[e.a]!--; degs[e.b]!--; again = true; break;
      }
    }
    // merge pseudo nodes (degree 2, not a station)
    for (const c of clusters) {
      if (c.dead || c.forced || degs[c.index] !== 2) continue;
      const inc = edges.filter((e) => !e.dead && (e.a === c.index || e.b === c.index));
      const d = inc.reduce((s, e) => s + (e.a === c.index ? 1 : 0) + (e.b === c.index ? 1 : 0), 0);
      if (d !== 2 || inc.length !== 2) continue;
      const [e1, e2] = inc as [Edge, Edge];
      const p1 = e1.b === c.index ? e1 : flip(e1), p2 = e2.a === c.index ? e2 : flip(e2);
      const poly = p1.poly.concat(p2.poly[0] === p1.poly[p1.poly.length - 1] ? p2.poly.slice(1) : p2.poly);
      e1.dead = true; e2.dead = true; c.dead = true; degs[c.index] = 0; // the new edge keeps the far ends' degrees
      edges.push({ a: p1.a, b: p2.b, poly, chain: p1.chain + p2.chain + c.tiles.length, dead: false });
      again = true;
    }
  }
  const live = edges.filter((e) => !e.dead);
  const finalDeg = new Int32Array(clusters.length);
  for (const e of live) { finalDeg[e.a]!++; finalDeg[e.b]!++; }
  const realNode = (ci: number): boolean => { const c = clusters[ci]!; return !c.dead && (c.forced || finalDeg[ci]! >= 3); };

  // ---- 6. runs from edges, downhill ----
  const altOf = (t: number): number => inp.alt(t);
  const pending: Array<{ poly: number[]; a: number; b: number; extra: number[]; loop: boolean; synthetic: boolean }> = [];
  for (const e of live) {
    let { a, b } = e, poly = e.poly;
    const hi = altOf(poly[0]!), lo = altOf(poly[poly.length - 1]!);
    if (hi < lo || (hi === lo && poly[0]! > poly[poly.length - 1]!)) { poly = poly.slice().reverse(); [a, b] = [b, a]; }
    const extra: number[] = [];
    for (const ci of [a, b]) if (!realNode(ci)) extra.push(...clusters[ci]!.tiles);
    pending.push({ poly, a: realNode(a) ? a : -1, b: realNode(b) ? b : -1, extra, loop: a === b, synthetic: false });
  }
  // ---- 7. ownership: nodes, run centre lines, flood fill ----
  const nodeIdx = new Map<number, number>();
  for (const c of clusters) if (!c.dead && realNode(c.index)) {
    const idx = nodes.length;
    nodeIdx.set(c.index, idx);
    nodes.push({ index: idx, kind: c.forced ? 'station' : 'junction', tiles: c.tiles, pos: { x: c.tiles[0]! % n, y: (c.tiles[0]! / n) | 0 }, runsIn: [], runsOut: [] });
    for (const t of c.tiles) nodeOf[t] = idx;
  }
  // deterministic run order: by the smallest tile on the centre line
  pending.sort((p, q) => Math.min(...p.poly) - Math.min(...q.poly) || p.poly[0]! - q.poly[0]!);
  const owner = new Int32Array(N).fill(-1);
  const q: number[] = [];
  const own = (t: number, r: number): void => { if (owner[t]! < 0 && nodeOf[t]! < 0) { owner[t] = r; q.push(t); } };
  pending.forEach((p, r) => { for (const t of p.poly) own(t, r); for (const t of p.extra) own(t, r); });
  // node tiles are flood sources labelled with the run they lead into
  const prefOf = new Map<number, number>(); // node index -> first run (in run order) that arrives / leaves there
  pending.forEach((p, r) => { for (const c of [p.a, p.b]) { const ni = c >= 0 ? nodeIdx.get(c) : undefined; if (ni !== undefined && !prefOf.has(ni)) prefOf.set(ni, r); } });
  const nodePref = (ni: number): number => prefOf.get(ni) ?? -1;
  const srcLabel: Array<[number, number]> = [];
  for (const nd of nodes) { const pr = nodePref(nd.index); if (pr >= 0) for (const t of nd.tiles) srcLabel.push([t, pr]); }
  const order = q.slice().map((t) => [t, owner[t]!] as [number, number]).concat(srcLabel).sort((a, b) => a[0] - b[0]);
  const fq: number[] = [], lab = new Int32Array(N).fill(-1);
  for (const [t, r] of order) { lab[t] = r; fq.push(t); }
  for (let h = 0; h < fq.length; h++) {
    const t = fq[h]!, x = t % n, y = (t / n) | 0;
    for (let k = 0; k < 8; k++) {
      const nx = x + OX[k]!, ny = y + OY[k]!;
      if (!inMask(nx, ny)) continue;
      const u = ny * n + nx;
      if (lab[u]! >= 0) continue;
      lab[u] = lab[t]!; fq.push(u);
    }
  }
  // components the centre line never reached (blobs, 2x2, rings): one synthetic run each
  const done = new Uint8Array(N);
  for (const t of tiles) {
    if (lab[t]! >= 0 || done[t]) continue;
    const comp = [t]; done[t] = 1;
    for (let h = 0; h < comp.length; h++) {
      const c = comp[h]!, x = c % n, y = (c / n) | 0;
      for (let k = 0; k < 8; k++) { const nx = x + OX[k]!, ny = y + OY[k]!; if (!inMask(nx, ny)) continue; const u = ny * n + nx; if (!done[u]) { done[u] = 1; comp.push(u); } }
    }
    let hi = comp[0]!, lo = comp[0]!;
    for (const c of comp) { if (altOf(c) > altOf(hi) || (altOf(c) === altOf(hi) && c < hi)) hi = c; if (altOf(c) < altOf(lo) || (altOf(c) === altOf(lo) && c < lo)) lo = c; }
    const ring2 = comp.filter((c) => sk[c]);
    const idx = pending.length;
    pending.push({ poly: hi === lo ? [hi] : [hi, lo], a: -1, b: -1, extra: [], loop: ring2.length > 2, synthetic: true });
    for (const c of comp) lab[c] = idx;
  }
  // build Run objects (in `pending` order, synthetic ones appended)
  const byRun: number[][] = pending.map(() => []);
  for (const t of tiles) if (nodeOf[t]! < 0 && lab[t]! >= 0) { runOf[t] = lab[t]!; byRun[lab[t]!]!.push(t); }
  pending.forEach((p, r) => {
    const rt = byRun[r]!;
    const poly = p.poly, first = poly[0]!, last = poly[poly.length - 1]!;
    let len = 0, maxPct = 0;
    const alts = poly.map(altOf);
    for (let k = 1; k < poly.length; k++) len += Math.hypot((poly[k]! % n) - (poly[k - 1]! % n), ((poly[k]! / n) | 0) - ((poly[k - 1]! / n) | 0));
    if (p.synthetic) len = poly.length > 1 ? len + 1 : Math.max(1, Math.sqrt(rt.length));
    for (let k = 0; k + 3 < poly.length; k++) {
      let d = 0; for (let j = k + 1; j <= k + 3; j++) d += Math.hypot((poly[j]! % n) - (poly[j - 1]! % n), ((poly[j]! / n) | 0) - ((poly[j - 1]! / n) | 0));
      if (d > 0) maxPct = Math.max(maxPct, ((alts[k]! - alts[k + 3]!) / d) * 100);
    }
    const topAlt = p.synthetic ? Math.max(...rt.map(altOf)) : alts[0]!, botAlt = p.synthetic ? Math.min(...rt.map(altOf)) : alts[alts.length - 1]!;
    const drop = Math.max(0, topAlt - botAlt);
    const cnt = [0, 0, 0, 0, 0];
    for (const t of rt) cnt[Math.max(1, Math.min(4, (inp.difficulty[t] ?? 0) + 1))]!++;
    let diff = 1; for (let d = 2; d <= 4; d++) if (cnt[d]! > cnt[diff]!) diff = d;
    const run: Run = {
      index: r, tiles: rt, count: rt.length, poly,
      from: p.a >= 0 ? nodeIdx.get(p.a)! : -1, to: p.b >= 0 ? nodeIdx.get(p.b)! : -1,
      top: { x: first % n, y: (first / n) | 0 }, bottom: { x: last % n, y: (last / n) | 0 }, topAlt, bottomAlt: botAlt,
      lengthM: Math.round(len * TILE_METRES), dropM: Math.round(drop * TILE_METRES),
      avgSlopePct: len > 0 ? Math.round(((drop / len) * 100) * 10) / 10 : 0, maxSlopePct: Math.round(maxPct * 10) / 10,
      difficulty: diff, loop: p.loop, synthetic: p.synthetic, disconnected: false,
    };
    runs.push(run);
    if (run.from >= 0) nodes[run.from]!.runsOut.push(r);
    if (run.to >= 0) nodes[run.to]!.runsIn.push(r);
  });
  return net;

  function flip(e: Edge): Edge { return { a: e.b, b: e.a, poly: e.poly.slice().reverse(), chain: e.chain, dead: e.dead }; }
}
