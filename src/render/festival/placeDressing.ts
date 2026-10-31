import { FESTIVAL_BY_ID, type FestivalId } from '../../config/festivals';

/**
 * Pure anchor selection + prop layout of a festival's set dressing (M5.4 Task 21). No three.js, no sim state, no RNG of the sim: the layout is a
 * deterministic function of the world snapshot, the festival and a seed. View only: nothing here is ever written to Occupancy or the nav graph.
 *
 * Anchor: the road / path tiles nearest the BASE LIFT STATION, else the village, else the lodge. A line of such tiles (the "chain") is strung with
 * bunting (poles at the road edge, both sides), flags sit on some poles, banners with the festival name span the road, market stalls stand beside
 * it, and a procession walks a loop along it. With no network tile near the anchor, a row of free ground tiles (a plaza) takes its place.
 */
export interface Pt { x: number; y: number }

export interface DressingWorld {
  size: number;
  /** Network kind per tile: 0 none, 1 path, 2 road, 3 rail. */
  kind: (i: number) => number;
  isWater: (i: number) => boolean;
  /** Occupancy (buildings, lift stations, ...). */
  isBuilding: (i: number) => boolean;
  /** Optional: tiles that are too steep to put a stall on. */
  steep?: (i: number) => boolean;
  /** Anchor candidates in priority order. */
  station: Pt | null;
  village: Pt | null;
  lodge: Pt | null;
  /** World Cup: the foot of the black piste (finish) and the racers' line from the top down. */
  finish?: Pt | null;
  racerLine?: readonly Pt[];
  /** Optional: a tree stands on this tile (the concert stage looks for tree-free ground first, view only). */
  tree?: (i: number) => boolean;
  /** Mountain concert anchors (Task 41; all optional): top stations of gondolas / cable cars, viewpoint buildings, mid-station plazas of N-station lifts. */
  liftTops?: readonly Pt[];
  viewpoints?: readonly Pt[];
  midStations?: readonly Pt[];
}

export const DRESSING = { anchorRadius: 16, chainRadius: 12, stallSpacing: 1.15, poleOffset: 0.42, maxChain: 24 } as const;

export interface Pole { x: number; z: number; /** 0 = left of the road, 1 = right. */ side: 0 | 1; /** Flag colour index, -1 = plain pole. */ flag: number }
export interface BannerSpec { x: number; z: number; ry: number; w: number; h: number }
export interface StallSpec { x: number; z: number; ry: number; color: number }
/** Where a concert stage stands (best-scoring anchor first: a mid-station plaza, a viewpoint, a gondola / cable car top, then the base station / village / lodge). */
export type StageAnchor = 'midStation' | 'viewpoint' | 'liftTop';
export const STAGE = {
  /** Footprint in tiles: stage 4 wide x 2 deep, crowd area 4 wide x 3 deep in front of it. */
  width: 4, stageDepth: 2, crowdDepth: 3,
  /** Search radius (tiles) around a mountain anchor / a fallback anchor. */
  radius: 10, fallbackRadius: 12,
  /** Anchor weights (higher wins; a tile of distance costs `distCost`). */
  weight: { midStation: 3, viewpoint: 2.5, liftTop: 2, station: 1, village: 0.8, lodge: 0.6 } as Record<string, number>, distCost: 0.15,
} as const;
export interface StageSpecLayout {
  /** Centre of the stage floor (tile corner coordinates; the front of the stage is local +z), yaw like the other props. */
  x: number; z: number; ry: number; edition: 'summer' | 'winter';
  /** Crowd members (world x / z) and a colour index. */
  crowd: Array<{ x: number; z: number; c: number }>;
  /** The banner board hangs on the truss: world position, yaw, size. */
  banner: BannerSpec;
}
export interface DressingLayout {
  festival: FestivalId;
  /** Which anchor candidate was used. */
  source: 'station' | 'village' | 'lodge' | StageAnchor;
  anchor: Pt;
  /** Road / path (or plaza) tile centres the bunting follows. */
  chain: Pt[];
  poles: Pole[];
  /** Bunting strings as pole index pairs. */
  strings: Array<[number, number]>;
  banners: BannerSpec[];
  stalls: StallSpec[];
  grandstand: { x: number; z: number; ry: number } | null;
  finish: { x: number; z: number; ry: number } | null;
  /** Mountain concert stage (null for every other festival). */
  stage: StageSpecLayout | null;
  /** Procession path (closed loop: out along one edge of the road, back along the other; racers: the one-way piste line). */
  loop: Pt[];
  /** Number of procession figures to show. */
  figures: number;
  /** Every tile index a prop stands on (for stacking several festivals without overlaps). */
  tiles: number[];
}

/** Small deterministic hash RNG (mulberry32 over an FNV seed): never the sim RNG. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hashStr = (s: string): number => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h; };
const DIRS: ReadonlyArray<readonly [number, number]> = [[1, 0], [0, 1], [-1, 0], [0, -1]];

/** Tiles props may stand on: inside the map, no water, no building. */
function makeOk(w: DressingWorld, taken?: ReadonlySet<number>): (x: number, y: number) => boolean {
  return (x, y) => {
    if (x < 1 || y < 1 || x >= w.size - 1 || y >= w.size - 1) return false;
    const i = y * w.size + x;
    return !w.isWater(i) && !w.isBuilding(i) && !(taken?.has(i) ?? false);
  };
}

/** The longest-ish line of network tiles around `seed`: BFS component within `radius` of the anchor, then the path between its two far ends. */
function networkLine(w: DressingWorld, ok: (x: number, y: number) => boolean, anchor: Pt, radius: number): Pt[] {
  const N = w.size, isNet = (x: number, y: number): boolean => ok(x, y) && (w.kind(y * N + x) === 1 || w.kind(y * N + x) === 2);
  let seed: Pt | null = null, best = Infinity;
  const ax = Math.floor(anchor.x), ay = Math.floor(anchor.y), R = Math.ceil(radius);
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const x = ax + dx, y = ay + dy;
    if (!isNet(x, y)) continue;
    const d = Math.hypot(x + 0.5 - anchor.x, y + 0.5 - anchor.y);
    if (d <= radius && d < best) { best = d; seed = { x, y }; }
  }
  if (!seed) return [];
  const within = (x: number, y: number): boolean => isNet(x, y) && Math.hypot(x + 0.5 - anchor.x, y + 0.5 - anchor.y) <= radius + 6;
  const bfs = (from: Pt): { order: Pt[]; prev: Map<number, number> } => {
    const prev = new Map<number, number>([[from.y * N + from.x, -1]]), order: Pt[] = [from];
    for (let h = 0; h < order.length; h++) {
      const c = order[h]!;
      for (const [dx, dy] of DIRS) {
        const x = c.x + dx, y = c.y + dy, k = y * N + x;
        if (prev.has(k) || !within(x, y)) continue;
        prev.set(k, c.y * N + c.x); order.push({ x, y });
      }
    }
    return { order, prev };
  };
  const a = bfs(seed).order.at(-1)!;
  const { order, prev } = bfs(a);
  const b = order.at(-1)!;
  const path: Pt[] = [];
  for (let k = b.y * N + b.x; k !== -1; k = prev.get(k)!) path.push({ x: k % N, y: (k / N) | 0 });
  return path;
}

/** A straight row of free ground tiles through the anchor (plaza fallback when no road is near). */
function plazaRow(w: DressingWorld, ok: (x: number, y: number) => boolean, anchor: Pt): Pt[] {
  const ax = Math.floor(anchor.x), ay = Math.floor(anchor.y);
  for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
    const row: Pt[] = [];
    for (let k = -8; k <= 8; k++) { const x = ax + dx * k, y = ay + dy * k; if (ok(x, y) && w.kind(y * w.size + x) !== 3) row.push({ x, y }); else if (k < 0) row.length = 0; else break; }
    if (row.length >= 4) return row;
  }
  return [];
}

/** Pick `n` window of `chain` centred on the tile nearest the anchor. */
function windowOf(chain: Pt[], anchor: Pt, n: number): Pt[] {
  if (chain.length <= n) return chain;
  let c = 0, best = Infinity;
  chain.forEach((p, i) => { const d = Math.hypot(p.x + 0.5 - anchor.x, p.y + 0.5 - anchor.y); if (d < best) { best = d; c = i; } });
  const from = Math.max(0, Math.min(chain.length - n, c - (n >> 1)));
  return chain.slice(from, from + n);
}

/**
 * Lay out one festival's set dressing. `taken` = tiles already used by another festival's dressing (they are left alone).
 * Deterministic: the same world, festival, seed and `taken` always give the same layout.
 */
export function placeDressing(w: DressingWorld, festival: FestivalId, seed: number, taken?: ReadonlySet<number>): DressingLayout | null {
  const spec = FESTIVAL_BY_ID[festival]?.dressing;
  if (!spec) return null;
  const r = rng((seed ^ hashStr(festival)) >>> 0), ri = (rg: readonly [number, number]): number => rg[0] + Math.floor(r() * (rg[1] - rg[0] + 1));
  const ok = makeOk(w, taken), N = w.size;
  if (spec.stage) return placeStage(w, festival, spec.stage.edition, ok, r);
  const anchors: Array<{ p: Pt; source: DressingLayout['source'] }> = [];
  if (w.station) anchors.push({ p: w.station, source: 'station' });
  if (w.village) anchors.push({ p: w.village, source: 'village' });
  if (w.lodge) anchors.push({ p: w.lodge, source: 'lodge' });
  let chain: Pt[] = [], used = anchors[0] ?? null;
  for (const a of anchors) {
    const line = networkLine(w, ok, a.p, DRESSING.anchorRadius);
    if (line.length >= 3) { chain = line; used = a; break; }
  }
  if (!used) return null;
  if (chain.length < 3) { chain = plazaRow(w, ok, used.p); if (chain.length < 3) return null; }
  chain = windowOf(chain, used.p, Math.min(DRESSING.maxChain, ri(spec.bunting)));
  const anchor = used.p;
  const tiles = new Set<number>();
  const mark = (x: number, z: number): void => { tiles.add(Math.floor(z) * N + Math.floor(x)); };

  // direction of the chain at each tile (towards the next tile; the last copies the previous)
  const dirAt = (i: number): Pt => {
    const a = chain[Math.min(i, chain.length - 2)]!, b = chain[Math.min(i, chain.length - 2) + 1]!;
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
    return { x: dx / l, y: dy / l };
  };

  // bunting poles on both edges of the road, strung between neighbouring tiles
  const poles: Pole[] = [], strings: Array<[number, number]> = [], poleIdx: Array<[number, number]> = [];
  chain.forEach((c, i) => {
    const d = dirAt(i), nx = -d.y, nz = d.x; // normal (left of the direction of travel)
    const pair: [number, number] = [-1, -1];
    for (const s of [0, 1] as const) {
      const k = s === 0 ? 1 : -1;
      pair[s] = poles.length;
      poles.push({ x: c.x + 0.5 + nx * DRESSING.poleOffset * k, z: c.y + 0.5 + nz * DRESSING.poleOffset * k, side: s, flag: -1 });
    }
    poleIdx.push(pair);
    mark(c.x, c.y);
  });
  for (let i = 0; i + 1 < chain.length; i++) for (const s of [0, 1] as const) strings.push([poleIdx[i]![s], poleIdx[i + 1]![s]]);
  // flags: some poles carry a flag (evenly spread, alternating sides)
  const flagN = Math.min(poles.length, ri(spec.flags));
  for (let k = 0; k < flagN; k++) {
    const ci = Math.min(chain.length - 1, Math.floor(((k + 0.5) / flagN) * chain.length)), p = poles[poleIdx[ci]![(k % 2) as 0 | 1]!]!;
    p.flag = k % spec.palette.length;
  }
  // banners span the road (perpendicular to it), at spread-out positions
  const banners: BannerSpec[] = [];
  const bn = ri(spec.banners);
  for (let k = 0; k < bn; k++) {
    const ci = Math.min(chain.length - 1, Math.max(0, Math.round(((k + 1) / (bn + 1)) * (chain.length - 1)))), c = chain[ci]!, d = dirAt(ci);
    banners.push({ x: c.x + 0.5, z: c.y + 0.5, ry: Math.atan2(d.x, d.y), w: 1.6, h: 0.42 });
  }
  // stalls beside the road: nearest free tiles to the chain, spaced apart, facing the road
  const stalls: StallSpec[] = [];
  const sn = ri(spec.stalls);
  if (sn > 0) {
    const cand: Array<{ x: number; z: number; d: number; face: number; t: number }> = [];
    const onChain = new Set(chain.map((c) => c.y * N + c.x));
    for (const c of chain) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const x = c.x + dx, y = c.y + dy, i = y * N + x;
      if (!ok(x, y) || onChain.has(i) || w.kind(i) !== 0 || (w.steep?.(i) ?? false) || tiles.has(i)) continue;
      const d = Math.hypot(dx, dy);
      cand.push({ x: x + 0.5, z: y + 0.5, d: d + r() * 0.25, face: Math.atan2(-dx, -dy), t: i });
    }
    cand.sort((a, b) => a.d - b.d || a.t - b.t);
    for (const c of cand) {
      if (stalls.length >= sn) break;
      if (stalls.some((s) => Math.hypot(s.x - c.x, s.z - c.z) < DRESSING.stallSpacing)) continue;
      stalls.push({ x: c.x, z: c.z, ry: c.face, color: stalls.length % spec.palette.length }); mark(c.x, c.z);
    }
  }
  // World Cup: grandstand beside the finish (or the anchor) and a finish banner across the foot of the piste
  let grandstand: DressingLayout['grandstand'] = null, finish: DressingLayout['finish'] = null;
  if (spec.grandstand) {
    const fp = w.finish ?? anchor;
    finish = { x: Math.floor(fp.x) + 0.5, z: Math.floor(fp.y) + 0.5, ry: 0 };
    mark(finish.x, finish.z);
    let bestG: { x: number; z: number; d: number } | null = null;
    for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
      const x = Math.floor(fp.x) + dx, y = Math.floor(fp.y) + dy, i = y * N + x;
      const d = Math.hypot(dx, dy);
      if (d < 2.4 || d > 5.5 || !ok(x, y) || w.kind(i) !== 0 || (w.steep?.(i) ?? false) || tiles.has(i)) continue;
      const free2 = ok(x + 1, y) && w.kind(i + 1) === 0 && !(w.steep?.(i + 1) ?? false);
      if (free2 && (!bestG || d < bestG.d)) bestG = { x: x + 1, z: y + 0.5, d };
    }
    if (bestG) { grandstand = { x: bestG.x, z: bestG.z, ry: Math.atan2(fp.x - bestG.x, fp.y - bestG.z) }; mark(bestG.x - 0.5, bestG.z); mark(bestG.x + 0.5, bestG.z); }
  }
  // procession path
  let loop: Pt[] = [], figures = 0;
  if (spec.procession) {
    figures = Math.min(ri(spec.procession.count), Math.max(4, Math.floor(chain.length * 0.7)));
    if (spec.procession.kind === 'racer') figures = ri(spec.procession.count);
    if (spec.procession.kind === 'racer') loop = (w.racerLine ?? []).map((p) => ({ x: p.x + 0.5, y: p.y + 0.5 }));
    else {
      const out: Pt[] = [], back: Pt[] = [];
      chain.forEach((c, i) => { const d = dirAt(i), nx = -d.y, nz = d.x; out.push({ x: c.x + 0.5 + nx * 0.17, y: c.y + 0.5 + nz * 0.17 }); back.push({ x: c.x + 0.5 - nx * 0.17, y: c.y + 0.5 - nz * 0.17 }); });
      loop = [...out, ...back.reverse()];
    }
    if (loop.length < 2) figures = 0;
  }
  return { festival, source: used.source, anchor, chain, poles, strings, banners, stalls, grandstand, finish, stage: null, loop, figures, tiles: [...tiles].sort((a, b) => a - b) };
}

/** The 4 yaw steps a stage may face (multiples of a quarter turn so the footprint stays on whole tiles). */
const STAGE_YAWS = [0, Math.PI / 2, Math.PI, Math.PI * 1.5] as const;
/** World point of local (u, v) of a stage centred at (cx, cz) with yaw `ry` (same convention as the other props: x' = x cos + z sin, z' = -x sin + z cos). */
export function stagePoint(cx: number, cz: number, ry: number, u: number, v: number): Pt {
  const c = Math.round(Math.cos(ry) * 1e6) / 1e6, s = Math.round(Math.sin(ry) * 1e6) / 1e6;
  return { x: cx + u * c + v * s, y: cz - u * s + v * c };
}
/** Local cell centres of the footprint: stage cells (v -0.5, 0.5) then crowd cells (v 1.5, 2.5, 3.5). */
function stageCells(): Array<{ u: number; v: number; crowd: boolean }> {
  const out: Array<{ u: number; v: number; crowd: boolean }> = [];
  for (let k = 0; k < STAGE.stageDepth + STAGE.crowdDepth; k++) for (let i = 0; i < STAGE.width; i++) out.push({ u: i - (STAGE.width - 1) / 2, v: k - STAGE.stageDepth / 2 + 0.5, crowd: k >= STAGE.stageDepth });
  return out;
}

/**
 * Mountain concert (Task 41): scores every anchor (mid-station plaza > viewpoint > gondola / cable car top > base station > village > lodge) by the best free,
 * flat, network-free 4 x 5 tile site (stage 4x2 + crowd 4x3) within reach; returns null when no anchor has a site. Pure and deterministic.
 */
function placeStage(w: DressingWorld, festival: FestivalId, edition: 'summer' | 'winter', ok: (x: number, y: number) => boolean, r: () => number): DressingLayout | null {
  const N = w.size, cells = stageCells();
  const kinds: Array<{ source: DressingLayout['source']; pts: readonly Pt[]; radius: number; weight: number }> = [
    { source: 'midStation', pts: w.midStations ?? [], radius: STAGE.radius, weight: STAGE.weight.midStation! },
    { source: 'viewpoint', pts: w.viewpoints ?? [], radius: STAGE.radius, weight: STAGE.weight.viewpoint! },
    { source: 'liftTop', pts: w.liftTops ?? [], radius: STAGE.radius, weight: STAGE.weight.liftTop! },
    { source: 'station', pts: w.station ? [w.station] : [], radius: STAGE.fallbackRadius, weight: STAGE.weight.station! },
    { source: 'village', pts: w.village ? [w.village] : [], radius: STAGE.fallbackRadius, weight: STAGE.weight.village! },
    { source: 'lodge', pts: w.lodge ? [w.lodge] : [], radius: STAGE.fallbackRadius, weight: STAGE.weight.lodge! },
  ];
  const toward = w.village ?? w.station ?? w.lodge; // the crowd faces the valley (village / base) when it can
  const treeCache = new Map<number, boolean>();
  const treeAt = (i: number): boolean => { let v = treeCache.get(i); if (v === undefined) { v = w.tree?.(i) ?? false; treeCache.set(i, v); } return v; };
  const search = (avoidTrees: boolean): { score: number; source: DressingLayout['source']; anchor: Pt; cx: number; cz: number; ry: number } | null => {
    let best: { score: number; source: DressingLayout['source']; anchor: Pt; cx: number; cz: number; ry: number } | null = null;
    for (const k of kinds) for (const a of k.pts) {
      const R = Math.ceil(k.radius), ax = Math.round(a.x), ay = Math.round(a.y);
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const cx = ax + dx, cz = ay + dy, d = Math.hypot(cx - a.x, cz - a.y);
        if (d > k.radius) continue;
        const score = k.weight - d * STAGE.distCost;
        if (best && score <= best.score) continue;
        let pick = -1, pickDot = -Infinity;
        for (const ry of STAGE_YAWS) {
          let fits = true;
          for (const c of cells) {
            const p = stagePoint(cx, cz, ry, c.u, c.v), tx = Math.floor(p.x), ty = Math.floor(p.y), i = ty * N + tx;
            if (!ok(tx, ty) || w.kind(i) !== 0 || (w.steep?.(i) ?? false) || (avoidTrees && treeAt(i))) { fits = false; break; }
          }
          if (!fits) continue;
          const dot = toward ? Math.sin(ry) * (toward.x - cx) + Math.cos(ry) * (toward.y - cz) : 0;
          if (dot > pickDot + 1e-9) { pickDot = dot; pick = ry; }
        }
        if (pick >= 0) best = { score, source: k.source, anchor: a, cx, cz, ry: pick };
      }
    }
    return best;
  };
  const best = search(true) ?? search(false);
  if (!best) return null;
  const tiles = new Set<number>();
  for (const c of cells) { const p = stagePoint(best.cx, best.cz, best.ry, c.u, c.v); tiles.add(Math.floor(p.y) * N + Math.floor(p.x)); }
  const crowd: StageSpecLayout['crowd'] = [];
  for (const c of cells.filter((q) => q.crowd)) for (let n = 0; n < 2; n++) {
    const p = stagePoint(best.cx, best.cz, best.ry, c.u + (r() - 0.5) * 0.7, c.v + (r() - 0.5) * 0.7);
    crowd.push({ x: p.x, z: p.y, c: Math.floor(r() * 5) });
  }
  const bp = stagePoint(best.cx, best.cz, best.ry, 0, 1.02);
  const banner: BannerSpec = { x: bp.x, z: bp.y, ry: best.ry, w: 2.6, h: 0.34 };
  return {
    festival, source: best.source, anchor: best.anchor, chain: [], poles: [], strings: [], banners: [], stalls: [], grandstand: null, finish: null,
    stage: { x: best.cx, z: best.cz, ry: best.ry, edition, crowd, banner }, loop: [], figures: 0, tiles: [...tiles].sort((a, b) => a - b),
  };
}

/** Total number of props of a layout (poles, strings, banners, stalls, stands, figures). */
export function propCount(l: DressingLayout | null): number {
  return l ? l.poles.length + l.strings.length + l.banners.length + l.stalls.length + (l.grandstand ? 1 : 0) + (l.finish ? 1 : 0) + (l.stage ? 1 + l.stage.crowd.length : 0) + l.figures : 0;
}

/** The racers' line down a black piste: from its highest tile, step to the lowest connected black tile until none is lower. Returns tiles top -> bottom. */
export function blackPisteLine(isBlack: (i: number) => boolean, alt: (i: number) => number, size: number): Pt[] {
  let top = -1, topAlt = -Infinity;
  for (let i = 0; i < size * size; i++) if (isBlack(i) && alt(i) > topAlt) { topAlt = alt(i); top = i; }
  if (top < 0) return [];
  const out: Pt[] = [{ x: top % size, y: (top / size) | 0 }], seen = new Set<number>([top]);
  for (let guard = 0; guard < 600; guard++) {
    const c = out.at(-1)!;
    let nb = -1, na = alt(c.y * size + c.x);
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      const x = c.x + dx, y = c.y + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const i = y * size + x;
      if (!isBlack(i) || seen.has(i)) continue;
      if (alt(i) < na) { na = alt(i); nb = i; }
    }
    if (nb < 0) break;
    seen.add(nb); out.push({ x: nb % size, y: (nb / size) | 0 });
  }
  return out;
}
