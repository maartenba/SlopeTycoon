import { Grid, TileType } from './Grid';
import { Rng } from '../core/Rng';
import { SPRING } from '../config/rivers';

/**
 * Natural spring sites (Phase 6 Task 44): a derived OVERLAY on the generated map. Pure: reads heights / tile types, never writes them, and uses its own
 * RNG stream so terrain generation (and every golden) is untouched. Re-derived from the seed on every load (never saved, never hashed). A site gives no
 * water by itself: it is only a free, valid river source until the player digs a river from it.
 */
export interface SpringSite { x: number; y: number }

export interface SpringContext {
  lakes: ReadonlyArray<{ level: number; tileIdx: readonly number[] }>;
  streams: ReadonlyArray<{ path: ReadonlyArray<{ x: number; y: number }> }>;
  villageAnchor: { x: number; y: number };
}

const DIRS4: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];

const tileMean = (g: Grid, x: number, y: number): number => { const c = g.getCorners(x, y); return (c[0] + c[1] + c[2] + c[3]) / 4; };

/** Count of 4-neighbours whose ground is strictly higher than this tile's. */
export function higherNeighbours(g: Grid, x: number, y: number): number {
  const m = tileMean(g, x, y);
  let n = 0;
  for (const [dx, dy] of DIRS4) { const nx = x + dx, ny = y + dy; if (g.inBounds(nx, ny) && tileMean(g, nx, ny) > m) n++; }
  return n;
}

/** The geometric rule shared by natural sites and player springs: dry, unoccupied and >= 2 higher neighbours. (No rock / forest requirement.) */
export function springGroundOk(g: Grid, x: number, y: number): boolean {
  if (!g.inBounds(x, y)) return false;
  const i = g.tileIndex(x, y), t = g.tileType[i]!;
  if (t === TileType.Water || t === TileType.Stream || t === TileType.Ice) return false;
  if (g.occupancy.flags[i] !== 0) return false;
  return higherNeighbours(g, x, y) >= SPRING.minHigherNeighbours;
}

const hash32 = (a: number, b: number): number => (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca6b)) >>> 0;

/** 0..3 sites near existing water (a lake tile or a stream head, 2..6 tiles away), highest ground first, spaced apart. Deterministic in (heights, seed). */
export function deriveSpringSites(g: Grid, ctx: SpringContext, seed: number): SpringSite[] {
  const N = g.size, rng = new Rng(hash32(seed, 0x5052494e)); // own stream: never the terrain Rng
  const anchors: Array<{ x: number; y: number; level: number }> = [];
  for (const lake of ctx.lakes) for (const ti of lake.tileIdx) anchors.push({ x: ti % N, y: (ti - (ti % N)) / N, level: lake.level });
  for (const s of ctx.streams) { const p = s.path[0]; if (p) anchors.push({ x: p.x, y: p.y, level: tileMean(g, p.x, p.y) * 1 }); }
  const R = SPRING.nearMax;
  const best = new Map<number, { score: number; x: number; y: number }>();
  for (const a of anchors) {
    for (let y = a.y - R; y <= a.y + R; y++) for (let x = a.x - R; x <= a.x + R; x++) {
      const d = Math.hypot(x - a.x, y - a.y);
      if (d < SPRING.nearMin || d > SPRING.nearMax) continue;
      if (x < SPRING.edgeMargin || y < SPRING.edgeMargin || x >= N - SPRING.edgeMargin || y >= N - SPRING.edgeMargin) continue;
      const i = y * N + x;
      if (!springGroundOk(g, x, y)) continue;
      if (Math.hypot(x - ctx.villageAnchor.x, y - ctx.villageAnchor.y) < 12) continue;
      if (y > N * 0.72 && Math.abs(x - (N >> 1)) <= 11) continue; // road / rail corridor
      const above = Math.max(0, Math.min(40, tileMean(g, x, y) - a.level)); // some fall towards the water, not a cliff top
      const score = above + (rng.next() * 0.001); // jitter only breaks exact ties, in a fixed visiting order
      const cur = best.get(i);
      if (!cur || score > cur.score) best.set(i, { score, x, y });
    }
  }
  const cands = [...best.values()].sort((p, q) => q.score - p.score || (p.y - q.y) || (p.x - q.x));
  const want = rng.int(SPRING.naturalMin, SPRING.naturalMax);
  const out: SpringSite[] = [];
  for (const c of cands) {
    if (out.length >= want) break;
    if (out.some((o) => Math.hypot(o.x - c.x, o.y - c.y) < SPRING.spacing)) continue;
    out.push({ x: c.x, y: c.y });
  }
  return out;
}
