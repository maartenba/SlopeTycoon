import { NetKind } from '../world/Networks';
import type { Sim } from './createSim';

/**
 * Footpath hygiene for generated towns (docs/demo-towns.md "Path network").
 *
 * While a town is built every building is wired up separately (`ensurePath`), and candidate sites that are later rejected leave their
 * strokes behind: the result was a ladder / lattice of footpaths with 1-tile holes, double-width bands and loops around buildings.
 * `tidyPaths` rebuilds the footpath network as a clean forest after the fact: every building / lift station / piste foot that was
 * path-served keeps its connection, but only the SHORTEST new strokes to the existing network are kept (greedy, nearest first), so a
 * building either sits right on a street or hangs off it on a short single-tile spur. Roads are never touched. Deterministic (fixed
 * neighbour order, no Rng); reverts itself when any need would lose service.
 */
interface Rect { x: number; y: number; w: number; h: number }
const DXY: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/** Tiles 4-adjacent to a footprint. */
const ringOf = (r: Rect): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  for (let x = r.x; x < r.x + r.w; x++) out.push([x, r.y - 1], [x, r.y + r.h]);
  for (let y = r.y; y < r.y + r.h; y++) out.push([r.x - 1, y], [r.x + r.w, y]);
  return out;
};

/** Returns the number of footpath tiles removed (0 when nothing changed or the pass was reverted). `feet` = piste foot tiles (they were joined to the village). */
export function tidyPaths(sim: Sim, feet: ReadonlyArray<{ x: number; y: number }> = []): number {
  const r = tidy(sim, feet, false);
  return r >= 0 ? r : Math.max(0, tidy(sim, feet, true)); // a trail-attached building lost its access: retry keeping every trail contact
}

/** -1 = reverted (a service would have been lost). */
function tidy(sim: Sim, feet: ReadonlyArray<{ x: number; y: number }>, pinTrails: boolean): number {
  const net = sim.networks, n = net.size, e = net.roadEntry;
  if (!e) return 0;
  const kind = net.kind;
  const inb = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < n && y < n;
  // walk network: roads + footpaths from the road entry (same rule as Networks.comps)
  const walk = new Uint8Array(n * n);
  const q: number[] = [];
  const crossing = (i: number): boolean => kind[i] === NetKind.Rail && net.cross[i]! > 0;
  const walkable = (i: number): boolean => kind[i] === NetKind.Road || kind[i] === NetKind.Path || crossing(i);
  const s0 = e.y * n + e.x;
  if (!walkable(s0)) return 0;
  walk[s0] = 1; q.push(s0);
  for (let h = 0; h < q.length; h++) {
    const i = q[h]!, x = i % n, y = (i / n) | 0;
    for (const [dx, dy] of DXY) { const nx = x + dx, ny = y + dy; if (!inb(nx, ny)) continue; const j = ny * n + nx; if (!walk[j] && walkable(j)) { walk[j] = 1; q.push(j); } }
  }
  const pathTiles = q.filter((i) => kind[i] === NetKind.Path);
  if (pathTiles.length < 6) return 0;
  const lodge = sim.buildings.all().find((b) => b.type === 'baseLodge');
  const cx = lodge ? lodge.x + lodge.w / 2 : e.x, cy = lodge ? lodge.y + lodge.h / 2 : e.y;

  // needs: footprints that were joined to the walk network
  const needs: Array<{ r: Rect; d: number }> = [];
  const add = (r: Rect): void => {
    if (ringOf(r).some(([x, y]) => inb(x, y) && walk[y * n + x])) needs.push({ r, d: Math.hypot(r.x + r.w / 2 - cx, r.y + r.h / 2 - cy) });
  };
  for (const b of sim.buildings.all()) add({ x: b.x, y: b.y, w: b.w, h: b.h });
  for (const l of sim.lifts.all()) { add({ x: l.bottom.x, y: l.bottom.y, w: 2, h: 2 }); add({ x: l.top.x, y: l.top.y, w: 2, h: 2 }); }
  for (const f of feet) add({ x: f.x, y: f.y, w: 1, h: 1 });
  // hiking / MTB trails attach to the walk network and serve huts, depots...: keep one footpath contact per trail tile that touches it
  if (pinTrails) for (let i = 0; i < n * n; i++) if (net.layers[i]! & 6) add({ x: i % n, y: (i / n) | 0, w: 1, h: 1 });
  needs.sort((a, b) => a.d - b.d || a.r.y - b.r.y || a.r.x - b.r.x);

  // roads connected to the entry by road alone (plus road level crossings) are the fixed backbone; everything else must be reached
  const roadComp = new Uint8Array(n * n);
  const isRoadish = (i: number): boolean => kind[i] === NetKind.Road || (kind[i] === NetKind.Rail && (net.cross[i] === 2 || net.cross[i] === 5));
  const rq: number[] = [];
  if (isRoadish(s0)) { roadComp[s0] = 1; rq.push(s0); }
  for (let h = 0; h < rq.length; h++) {
    const i = rq[h]!, x = i % n, y = (i / n) | 0;
    for (const [dx, dy] of DXY) { const nx = x + dx, ny = y + dy; if (!inb(nx, ny)) continue; const j = ny * n + nx; if (!roadComp[j] && isRoadish(j)) { roadComp[j] = 1; rq.push(j); } }
  }
  const keep = new Uint8Array(n * n);
  const solid = (x: number, y: number): boolean => inb(x, y) && (roadComp[y * n + x] === 1 || keep[y * n + x] === 1);
  const passable = (x: number, y: number): boolean => inb(x, y) && walk[y * n + x] === 1 && !roadComp[y * n + x] && !keep[y * n + x]; // footpaths, other roads / crossings that hang off them
  const touchesKept = (x: number, y: number): boolean => DXY.some(([dx, dy]) => solid(x + dx, y + dy));
  const mark = new Int32Array(n * n).fill(-2);
  for (const nd of needs) {
    const ring = ringOf(nd.r).filter(([x, y]) => inb(x, y));
    if (ring.some(([x, y]) => solid(x, y))) continue;
    // BFS over not-yet-kept walkable tiles from the need's ring until a tile that touches the kept network
    mark.fill(-2);
    const bq: number[] = [];
    for (const [x, y] of ring) if (passable(x, y) && mark[y * n + x] === -2) { mark[y * n + x] = -1; bq.push(y * n + x); }
    let hit = -1;
    for (let h = 0; h < bq.length && hit < 0; h++) {
      const i = bq[h]!, x = i % n, y = (i / n) | 0;
      if (touchesKept(x, y)) { hit = i; break; }
      for (const [dx, dy] of DXY) { const nx = x + dx, ny = y + dy; if (!passable(nx, ny)) continue; const j = ny * n + nx; if (mark[j] !== -2) continue; mark[j] = i; bq.push(j); }
    }
    if (hit < 0) continue; // cannot happen for a walk-reachable need; leave it (the verification below decides)
    for (let k = hit; k >= 0; k = mark[k]!) keep[k] = 1;
  }
  const drop = pathTiles.filter((i) => !keep[i]);
  if (!drop.length) return 0;
  const active0 = sim.buildings.all().map((b) => b.active);
  const before = sim.buildings.all().map((b) => net.isRoadServed(b.id) || net.isConnected(b.id));
  const liftsBefore = sim.lifts.all().map((l) => net.serves('path', { x: l.bottom.x, y: l.bottom.y, w: 2, h: 2 }));
  for (const i of drop) net.unbuild(i % n, (i / n) | 0);
  // buildings that must stay active (walking radius to the lodge, shuttle rules...) get their shortest ORIGINAL route back when the tidied tree made it longer
  const dropped = new Set(drop);
  if (lodge) {
    const lring = new Set(ringOf(lodge).filter(([x, y]) => inb(x, y)).map(([x, y]) => y * n + x));
    for (let it = 0; it < 40; it++) {
      sim.buildings.reevaluate();
      const bad = sim.buildings.all().filter((b, k) => active0[k] && !b.active);
      if (!bad.length) break;
      let fixed = false;
      for (const b of bad) {
        const par = new Map<number, number>();
        const bq: number[] = [];
        for (const [x, y] of ringOf(b)) if (inb(x, y)) { const i = y * n + x; if ((dropped.has(i) || kind[i] === NetKind.Path) && !par.has(i)) { par.set(i, -1); bq.push(i); } }
        let hit = -1;
        for (let h = 0; h < bq.length; h++) {
          const i = bq[h]!, x = i % n, y = (i / n) | 0;
          if (lring.has(i)) { hit = i; break; }
          for (const [dx, dy] of DXY) { const nx = x + dx, ny = y + dy; if (!inb(nx, ny)) continue; const j = ny * n + nx; if (par.has(j) || !(dropped.has(j) || kind[j] === NetKind.Path)) continue; par.set(j, i); bq.push(j); }
        }
        for (let k = hit; k >= 0; k = par.get(k)!) if (dropped.has(k)) { net.build(NetKind.Path, k % n, (k / n) | 0); dropped.delete(k); fixed = true; }
      }
      if (!fixed) break;
    }
  }
  const bs = sim.buildings.all();
  const ok = bs.every((b, k) => !before[k] || net.isRoadServed(b.id) || net.isConnected(b.id))
    && sim.lifts.all().every((l, k) => !liftsBefore[k] || net.serves('path', { x: l.bottom.x, y: l.bottom.y, w: 2, h: 2 }))
    && (sim.buildings.reevaluate(), sim.buildings.all().every((b, k) => !active0[k] || b.active))
    && needs.every((nd) => net.serves('path', nd.r));
  if (!ok) { for (const i of dropped) net.build(NetKind.Path, i % n, (i / n) | 0); sim.buildings.reevaluate(); return -1; }
  return dropped.size;
}

export interface PathQuality {
  /** Footpath + road tiles. */
  tiles: number;
  /** Free tiles with >= 3 footpath / road neighbours (pinholes inside a lattice). */
  holes: number;
  /** 2x2 blocks of footpath (double-width bands / blobs). */
  blocks: number;
  /** Orthogonal footpath-footpath adjacencies per footpath tile (a clean 1-wide line is ~1, a lattice is >= 1.5). */
  adjacency: number;
  /** Longest dead-end chain of footpath tiles (a leaf walked back to the first junction). */
  maxSpur: number;
  /** Combined 0..1 (1 = clean). */
  score: number;
}

/** Footpath tidiness of a built town (pure read). */
export function pathQuality(sim: Sim): PathQuality {
  const net = sim.networks, n = net.size, kind = net.kind;
  const occ = new Uint8Array(n * n);
  for (const b of sim.buildings.all()) for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) if (x >= 0 && y >= 0 && x < n && y < n) occ[y * n + x] = 1;
  const isP = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < n && y < n && kind[y * n + x] === NetKind.Path;
  const isNet = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < n && y < n && (kind[y * n + x] === NetKind.Path || kind[y * n + x] === NetKind.Road);
  let paths = 0, tiles = 0, holes = 0, blocks = 0, pairs = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x;
    if (isNet(x, y)) tiles++;
    if (isP(x, y)) {
      paths++;
      if (isP(x + 1, y)) pairs++;
      if (isP(x, y + 1)) pairs++;
      if (isP(x + 1, y) && isP(x, y + 1) && isP(x + 1, y + 1)) blocks++;
    } else if (!kind[i] && !occ[i]) {
      let c = 0;
      for (const [dx, dy] of DXY) if (isNet(x + dx, y + dy)) c++;
      if (c >= 3) holes++;
    }
  }
  // dead-end chains
  const deg = (x: number, y: number): number => DXY.reduce((s, [dx, dy]) => s + (isP(x + dx, y + dy) ? 1 : 0), 0);
  let maxSpur = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!isP(x, y) || deg(x, y) !== 1) continue;
    let len = 1, px = x, py = y, cx = x, cy = y;
    for (;;) {
      const nx = DXY.map(([dx, dy]) => [cx + dx, cy + dy] as const).find(([ax, ay]) => isP(ax, ay) && !(ax === px && ay === py));
      if (!nx) break;
      px = cx; py = cy; [cx, cy] = nx;
      if (deg(cx, cy) !== 2) break;
      len++;
    }
    maxSpur = Math.max(maxSpur, len);
  }
  const adjacency = paths ? +(pairs / paths).toFixed(3) : 0;
  const score = paths < 6 ? 1 : +Math.max(0, 1 - holes / Math.max(4, paths * 0.05) * 0.4 - (blocks / paths) * 3 - Math.max(0, adjacency - 1.05) * 1.5).toFixed(3);
  return { tiles, holes, blocks, adjacency, maxSpur, score };
}
