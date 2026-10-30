import type { TourDef } from '../../config/tours';
import { computeFlow, type FlowModel, type WayFlow } from '../nature/Flow';
import { TileType, type Grid } from '../../world/Grid';
import { waterways, type Stream, type Waterway } from '../../world/Streams';
import type { RiverRec } from '../../world/Rivers';

/**
 * Water tour routes (Phase 6 Task 24, docs/water-tours.md): rafting and canyoning follow a WATERWAY (natural stream or dug river, `waterways()`) downstream from a
 * put-in tile within a few tiles of the base to a take-out. Pure: reads the waterway list, the flow table and a gorge test. No Rng, nothing saved.
 */
export interface WaterEnv {
  ways(): ReadonlyArray<Waterway>;
  /** Flow of a waterway: the current one (season factor, ice) or the nominal one (factor 1, never frozen: what placement judges). */
  flow(id: string, nominal?: boolean): WayFlow | undefined;
  /** Rock or steep-bank tile (a gorge wall). */
  gorge(x: number, y: number): boolean;
}

export interface WaterInfo {
  way: string;
  /** Tiles of flow class >= the def's flow class, rapids tiles, steep tiles and gorge tiles on / along the slice. */
  good: number; rapids: number; steep: number; gorge: number;
  /** Highest flow class on the slice (0 calm, 1 brisk, 2 rapids). */
  maxClass: number;
  /** Cumulative ride time (0..1) at each route tile: the raft is faster on fast water (time per tile ~ 1 / speed). */
  clock: number[];
  /** Flow class per route tile (splash on rapids). */
  cls: number[];
}

export type WaterPlan = { ok: true; tiles: number[]; info: WaterInfo } | { ok: false; reason: string; detail: string };

/** Drop per tile (half-steps) over a +-1 tile window. */
export function dropAt(level: ReadonlyArray<number>, i: number): number {
  const a = Math.max(0, i - 1), b = Math.min(level.length - 1, i + 1);
  return b > a ? Math.max(0, (level[a]! - level[b]!) / (b - a)) : 0;
}

const key = (x: number, y: number): number => (y << 16) | x;

/**
 * Plan the route of a water tour base. Every waterway tile within `putIn` tiles of the footprint is a put-in candidate; the slice runs downstream up to
 * `maxLen` tiles and is trimmed to the last qualifying tile + `tail`. The best candidate wins (most qualifying tiles, then the closest, then lowest way id / index).
 */
export function planWaterRoute(env: WaterEnv, b: { x: number; y: number; w: number; h: number }, def: TourDef, size: number, nominal = false): WaterPlan {
  const req = def.water!;
  const fail = (detail: string): WaterPlan => ({ ok: false, reason: req.need, detail });
  let best: { score: number; dist: number; way: string; i: number; tiles: number[]; info: WaterInfo } | null = null;
  let bestFail = { score: -1, detail: `no waterway within ${req.putIn} tiles of the base` };
  let anyReach = false;

  for (const w of env.ways()) {
    const f = env.flow(w.id, nominal);
    if (!f) continue;
    const n = w.path.length;
    const steepOf = (i: number): boolean => !!req.steep && dropAt(w.level, i) >= req.steep.minDrop;
    const goodOf = (i: number): boolean => (req.flow ? f.cls[i]! >= req.flow.minClass : true) && (req.steep ? steepOf(i) : true);
    const counts = !!(req.flow || req.steep);
    for (let i = 0; i < n; i++) {
      const p = w.path[i]!;
      const dx = Math.max(b.x - p.x, 0, p.x - (b.x + b.w - 1)), dy = Math.max(b.y - p.y, 0, p.y - (b.y + b.h - 1));
      const dist = Math.max(dx, dy);
      if (dist > req.putIn) continue;
      anyReach = true;
      let end = Math.min(n - 1, i + def.maxLen - 1), last = -1, good = 0, rapids = 0, steep = 0;
      for (let k = i; k <= end; k++) {
        if (counts ? goodOf(k) : false) { good++; last = k; }
        if (f.cls[k] === 2) rapids++;
        if (steepOf(k)) steep++;
      }
      if (counts && last >= 0) end = Math.min(end, last + req.tail);
      if (end - i + 1 < def.minLen) end = Math.min(n - 1, i + def.minLen - 1);
      if (end - i + 1 < def.minLen) { if (good > bestFail.score) bestFail = { score: good, detail: `the waterway is too short (${end - i + 1} of ${def.minLen} tiles)` }; continue; }
      good = 0; rapids = 0; steep = 0;
      let maxClass = 0;
      for (let k = i; k <= end; k++) { if (counts && goodOf(k)) good++; if (f.cls[k] === 2) rapids++; if (steepOf(k)) steep++; if (f.cls[k]! > maxClass) maxClass = f.cls[k]!; }
      const need = req.flow?.minTiles ?? req.steep?.minTiles ?? 0;
      if (counts && good < need) {
        if (good > bestFail.score) bestFail = { score: good, detail: req.flow ? `only ${good} of ${need} brisk tiles downstream` : `only ${good} of ${need} steep tiles downstream` };
        continue;
      }
      const tiles = w.path.slice(i, end + 1).map((q) => q.y * size + q.x);
      let gorge = 0;
      if (req.gorge) {
        const seen = new Set<number>(), r = req.gorge.radius;
        for (let k = i; k <= end; k++) {
          const q = w.path[k]!;
          for (let yy = q.y - r; yy <= q.y + r; yy++) for (let xx = q.x - r; xx <= q.x + r; xx++) {
            const kk = key(xx, yy);
            if (seen.has(kk)) continue;
            seen.add(kk);
            if (env.gorge(xx, yy)) gorge++;
          }
        }
        if (gorge < req.gorge.minTiles) { if (good + gorge > bestFail.score) bestFail = { score: good + gorge, detail: `only ${gorge} of ${req.gorge.minTiles} rock wall tiles along the stream` }; continue; }
      }
      const score = (counts ? good : end - i + 1) * 1000 + rapids * 10 + (req.gorge ? Math.min(gorge, 99) : 0);
      const better = !best || score > best.score || (score === best.score && (dist < best.dist || (dist === best.dist && (w.id < best.way || (w.id === best.way && i < best.i)))));
      if (!better) continue;
      const speeds: number[] = [];
      for (let k = i; k <= end; k++) speeds.push(Math.max(0.25, f.speed[k]! || 0.25));
      const clock = [0];
      for (let k = 1; k < speeds.length; k++) clock.push(clock[k - 1]! + 0.5 / speeds[k - 1]! + 0.5 / speeds[k]!);
      const total = clock[clock.length - 1] || 1;
      best = { score, dist, way: w.id, i, tiles, info: { way: w.id, good, rapids, steep, gorge, maxClass, clock: clock.map((c) => Math.round((c / total) * 10000) / 10000), cls: f.cls.slice(i, end + 1) } };
    }
  }
  if (!best) return anyReach ? fail(bestFail.detail) : fail(`no river or stream within ${req.putIn} tiles of the base`);
  return { ok: true, tiles: best.tiles, info: best.info };
}

/** Thrill of a planned run 0..1: rapids tiles against the def's `thrill.tiles`. */
export const thrillOf = (def: TourDef, info: WaterInfo | undefined): number => (!info || !def.water?.thrill ? 0 : Math.min(1, info.rapids / def.water.thrill.tiles));

/** Production env: waterways (natural + dug), the live flow model, nominal flow cached by the river version, gorge test on the grid. */
export function makeWaterEnv(src: { natural: () => ReadonlyArray<Stream>; rivers: () => { rivers: ReadonlyArray<RiverRec>; version: number }; flow: FlowModel; grid: Grid }): WaterEnv & { version(): number } {
  let waysKey = -1, ways: Waterway[] = [];
  let nomKey = -1, nominal = new Map<string, WayFlow>();
  const sync = (): void => {
    const r = src.rivers();
    if (r.version !== waysKey) { waysKey = r.version; ways = waterways(src.natural(), r.rivers); }
  };
  return {
    ways: () => { sync(); return ways; },
    flow: (id, nom) => {
      if (!nom) return src.flow.get(id);
      const r = src.rivers();
      if (r.version !== nomKey) { nomKey = r.version; nominal = computeFlow(src.natural(), r.rivers, 1); }
      return nominal.get(id);
    },
    gorge: (x, y) => {
      const g = src.grid;
      if (!g.inBounds(x, y)) return false;
      return g.tileType[g.tileIndex(x, y)] === TileType.Rock || steepBank(g, x, y);
    },
    /** Changes when the rivers, the month or the ice change (the plan is re-made then). */
    version: () => { src.flow.all(); return src.rivers().version * 1000003 + src.flow.version; },
  };
}

/** A non-water tile with a corner spread >= 2 (a steep bank, even where the ground is not bare rock). */
function steepBank(g: Grid, x: number, y: number): boolean {
  const t = g.tileType[g.tileIndex(x, y)];
  if (t === TileType.Water || t === TileType.Stream) return false;
  const [n, e, s, w] = g.getCorners(x, y);
  return Math.max(n, e, s, w) - Math.min(n, e, s, w) >= 2;
}
