import { BUILDINGS } from '../config/buildings';
import { CHUNK_SIZE, TileType, type Grid } from './Grid';
import { OccFlag } from './Occupancy';
import type { Pt } from '../sim/Dependencies';
import { HEIGHT_UNIT } from '../config/balance';
import { CROSSING } from '../config/crossings';
import { accessProblem, suppliedOnFootOnly, type NetworkAccess, type ServedKind } from '../sim/PlacementRules';

export const NetKind = { None: 0, Path: 1, Road: 2, Rail: 3 } as const;
export type NetKindId = 1 | 2 | 3;
/** Connection bits per tile. */
export const Conn = { N: 1, E: 2, S: 4, W: 8 } as const;
/** Piste layer bits (multiple per tile). */
export const Layer = { Ski: 1, Mtb: 2, Hike: 4 } as const;
export type LayerBit = 1 | 2 | 4;
export const Difficulty = { Green: 0, Blue: 1, Red: 2, Black: 3 } as const;

export const NET_COST: Record<NetKindId, number> = { 1: 20, 2: 60, 3: 100 };
export const PISTE_COST_PER_TILE = 10;
/** Reasons for level crossings / footbridges over rail (docs/crossings.md). */
export const CROSS_MSG = {
  angle: 'Paths can only cross a straight rail line at right angles',
  spacing: 'Crossings need more room: another crossing is too close',
  station: 'Cannot cross rail at a station',
  bridge: 'Cannot cross rail on a bridge',
  roadOnly: 'Roads need a level crossing, not a footbridge',
  ends: 'A crossing needs path or road on both sides of the rail',
} as const;
/** `cross` values: 0 none, 1 footpath level crossing, 2 road level crossing, 3 footbridge over rail (path only, never closes). */
export const Cross = { None: 0, Path: 1, Road: 2, Footbridge: 3 } as const;
export const PISTE_WATER_MSG = "Can't build a piste over water — use a bridge (footpath/road) or route around";
/** Max corner spread (half-steps) per network kind. */
export const NET_MAX_SPREAD: Record<NetKindId, number> = { 1: 2, 2: 1, 3: 1 };

const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0]; // N E S W
const BITS = [Conn.N, Conn.E, Conn.S, Conn.W];

export interface Rect { x: number; y: number; w: number; h: number }
/** Minimal building lookup used by Networks (satisfied by sim/Buildings). */
export interface BuildingHost {
  at(x: number, y: number): { id: number; x: number; y: number; w: number; h: number; type?: string } | undefined;
  get(id: number): { id: number; x: number; y: number; w: number; h: number; type?: string } | undefined;
}

/** Slope (avg steepness, half-steps/tile) -> difficulty. */
export function difficultyFromSteepness(avg: number): number {
  if (avg < 0.75) return Difficulty.Green;
  if (avg < 1.25) return Difficulty.Blue;
  if (avg < 1.75) return Difficulty.Red;
  return Difficulty.Black;
}

export interface BuildCheck { ok: boolean; reason?: string }

/** Straight / L-shaped tile list from a to b (horizontal first unless `vFirst`). Inclusive. */
export function lineTiles(a: Pt, b: Pt, vFirst = false): Pt[] {
  const out: Pt[] = [];
  const step = (x0: number, y0: number, x1: number, y1: number): void => {
    const sx = Math.sign(x1 - x0), sy = Math.sign(y1 - y0);
    let x = x0, y = y0;
    for (;;) {
      if (!out.length || out[out.length - 1]!.x !== x || out[out.length - 1]!.y !== y) out.push({ x, y });
      if (x === x1 && y === y1) break;
      if (x !== x1) x += sx; else y += sy;
    }
  };
  if (vFirst) { step(a.x, a.y, a.x, b.y); step(a.x, b.y, b.x, b.y); }
  else { step(a.x, a.y, b.x, a.y); step(b.x, a.y, b.x, b.y); }
  return out;
}

/**
 * Interpolate pointer samples into a gap-free, 4-connected tile stroke: consecutive samples are joined with a
 * supercover line (Bresenham plus the corner tile wherever the line steps diagonally), so fast mouse movement
 * never skips tiles and no two consecutive tiles touch only at a corner. Output has no consecutive duplicates.
 */
export function interpolateStroke(samples: ReadonlyArray<Pt>): Pt[] {
  const out: Pt[] = [];
  const push = (x: number, y: number): void => {
    const l = out[out.length - 1];
    if (!l || l.x !== x || l.y !== y) out.push({ x, y });
  };
  for (let s = 0; s < samples.length; s++) {
    const b = samples[s]!;
    if (s === 0) { push(b.x, b.y); continue; }
    const a = samples[s - 1]!;
    const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
    const sx = a.x < b.x ? 1 : -1, sy = a.y < b.y ? 1 : -1;
    let x = a.x, y = a.y, err = dx - dy;
    // Walk like Bresenham but never move diagonally: step the axis with the larger error term first (4-connected).
    while (x !== b.x || y !== b.y) {
      const e2 = 2 * err;
      const mx = e2 > -dy && x !== b.x, my = e2 < dx && y !== b.y;
      if (mx && my) { // diagonal step: emit the corner tile (x-first) to stay 4-connected
        x += sx; err -= dy; push(x, y);
        y += sy; err += dx; push(x, y);
      } else if (mx) { x += sx; err -= dy; push(x, y); }
      else if (my) { y += sy; err += dx; push(x, y); }
      else break;
    }
  }
  return out;
}

/** Square brush footprint swept along a (4-connected) stroke; `brush` 1 = one tile, 2 = 3x3, 3 = 5x5. Clipped to size, deduped, stroke order. */
export function sweepBrush(stroke: ReadonlyArray<Pt>, brush: number, size: number): Pt[] {
  const r = Math.max(0, brush - 1), seen = new Set<number>(), out: Pt[] = [];
  for (const p of stroke) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = p.x + dx, y = p.y + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const k = y * size + x;
      if (!seen.has(k)) { seen.add(k); out.push({ x, y }); }
    }
  }
  return out;
}

/** Snapshot of one tile's mutable state (for stroke undo). */
export interface TileSnap { i: number; kind: number; bridge: number; cross?: number; layers: number; difficulty: number; quality: number }

export interface PisteComponent {
  id: number;
  /** Tile indices (y*size+x). */
  tiles: number[];
  count: number;
  /** World-unit altitude of the highest / lowest tile (mean corner height). */
  topAlt: number;
  bottomAlt: number;
  top: Pt;
  bottom: Pt;
  touchesLift: boolean;
  touchesPath: boolean;
  touchesBuilding: boolean;
  /** Largest component. */
  main: boolean;
  /** Not the main piste and not touching a lift station: flagged in the overlay (not open for skiers). */
  disconnected: boolean;
}

/** Fragments smaller than this that touch nothing are auto-removed after a piste stroke. */
export const PISTE_MIN_FRAGMENT = 4;

/** Number of road/rail/path tiles whose corner spread would exceed their max after `changed` corners moved (grid holds new heights). */
export function networkSpreadViolations(grid: Grid, net: NetworkAccess | undefined, changed: ReadonlyArray<{ vx: number; vy: number }>): number {
  if (!net) return 0;
  const seen = new Set<number>();
  let bad = 0;
  for (const c of changed) {
    for (let ty = c.vy - 1; ty <= c.vy; ty++) for (let tx = c.vx - 1; tx <= c.vx; tx++) {
      if (!grid.inBounds(tx, ty)) continue;
      const k = net.kindAt(tx, ty);
      const key = ty * grid.size + tx;
      if (!k || seen.has(key)) continue;
      seen.add(key);
      const cs = grid.getCorners(tx, ty);
      if (Math.max(...cs) - Math.min(...cs) > NET_MAX_SPREAD[k as NetKindId]) bad++;
    }
  }
  return bad;
}

/** Flat-enough footprint check for runways (altiport): no water/occupied, corner spread <= 1. */
export function checkRunway(grid: Grid, x: number, y: number, w: number, h: number): BuildCheck {
  if (x < 0 || y < 0 || x + w > grid.size || y + h > grid.size) return { ok: false, reason: 'Out of bounds' };
  let min = Infinity, max = -Infinity;
  for (let j = y; j <= y + h; j++) for (let i = x; i <= x + w; i++) {
    const v = grid.getCorner(i, j);
    if (v < min) min = v;
    if (v > max) max = v;
  }
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
    const t = grid.tileType[grid.tileIndex(i, j)];
    if (t === TileType.Water || t === TileType.Stream) return { ok: false, reason: 'Water' };
    if (!grid.occupancy.isFree(i, j)) return { ok: false, reason: 'Occupied' };
  }
  if (max - min > 1) return { ok: false, reason: 'Runway must be flat' };
  return { ok: true };
}

/** Paths, roads, rail (tile networks) and piste/trail layers. Typed arrays only. */
export class Networks {
  readonly size: number;
  /** NetKind per tile. */
  readonly kind: Uint8Array;
  /** Connection bitmask (N/E/S/W) per tile, to same-kind neighbours. */
  readonly conn: Uint8Array;
  /** 1 = bridge segment (over stream). */
  readonly bridge: Uint8Array;
  /** Level crossing per tile (Cross.*): the tile's `kind` stays Rail; 1 = footpath, 2 = road crossing, 3 = footbridge over the rail. */
  readonly cross: Uint8Array;
  /** Number of tiles with cross > 0 (0 = every crossing system is inert). */
  crossCount = 0;
  /** Piste layer bits per tile. */
  readonly layers: Uint8Array;
  /** Difficulty 0..3 per tile (valid where Ski/Mtb/Hike layer set). */
  readonly difficulty: Uint8Array;
  /** Piste quality 0..255 (Phase 3). */
  readonly quality: Uint8Array;
  roadEntry: Pt | null = null;
  railEntry: Pt | null = null;
  version = 0;
  private dirty = new Set<number>();
  private journal: Map<number, TileSnap> | null = null;
  private pisteCache: { v: number; comps: PisteComponent[]; flags: Uint8Array } | null = null;
  private cache: { v: number; roadComp?: Uint8Array; walkComp?: Uint8Array; railComp?: Uint8Array } = { v: -1 };

  constructor(private grid: Grid, private host: BuildingHost) {
    const n = grid.size * grid.size;
    this.size = grid.size;
    this.kind = new Uint8Array(n);
    this.conn = new Uint8Array(n);
    this.bridge = new Uint8Array(n);
    this.cross = new Uint8Array(n);
    this.layers = new Uint8Array(n);
    this.difficulty = new Uint8Array(n);
    this.quality = new Uint8Array(n);
  }

  /** Save/load (Task 33): replace all per-tile state; invalidates every cache and marks every chunk dirty. */
  restoreAll(d: { kind: ArrayLike<number>; conn: ArrayLike<number>; bridge: ArrayLike<number>; cross?: ArrayLike<number>; layers: ArrayLike<number>; difficulty: ArrayLike<number>; quality: ArrayLike<number>; roadEntry: Pt | null; railEntry: Pt | null; version: number }): void {
    this.kind.set(d.kind); this.conn.set(d.conn); this.bridge.set(d.bridge); if (d.cross) this.cross.set(d.cross); else this.cross.fill(0); this.recountCross(); this.layers.set(d.layers); this.difficulty.set(d.difficulty); this.quality.set(d.quality);
    this.roadEntry = d.roadEntry ? { ...d.roadEntry } : null; this.railEntry = d.railEntry ? { ...d.railEntry } : null;
    this.pisteCache = null; this.cache = { v: -1 }; this.journal = null;
    this.version = d.version + 1;
    for (let c = 0; c < this.grid.chunksPerRow ** 2; c++) this.dirty.add(c);
  }

  private idx(x: number, y: number): number { return y * this.size + x; }
  private inb(x: number, y: number): boolean { return x >= 0 && y >= 0 && x < this.size && y < this.size; }
  idxOf(x: number, y: number): number { return y * this.size + x; }
  inBounds(x: number, y: number): boolean { return this.inb(x, y); }
  kindAt(x: number, y: number): number { return this.inb(x, y) ? this.kind[this.idx(x, y)]! : 0; }

  private markDirty(x: number, y: number): void {
    this.dirty.add(((y / CHUNK_SIZE) | 0) * this.grid.chunksPerRow + ((x / CHUNK_SIZE) | 0));
    this.version++;
  }
  /** Chunk indices (cy*chunksPerRow+cx) touched since last call. */
  consumeDirtyChunks(): number[] { const o = [...this.dirty]; this.dirty.clear(); return o; }

  // ---------- network tiles ----------

  canBuild(kind: NetKindId, x: number, y: number, planned?: Set<number>): BuildCheck {
    if (!this.inb(x, y)) return { ok: false, reason: 'Out of bounds' };
    const g = this.grid, i = this.idx(x, y);
    if (this.kind[i] === kind) return { ok: true };
    if (this.kind[i] !== 0) return { ok: false, reason: 'Crossing not supported' };
    const t = g.tileType[i]!;
    if (t === TileType.Water) return { ok: false, reason: 'Water' };
    if (g.occupancy.flags[i]! & (OccFlag.Building | OccFlag.Lift)) return { ok: false, reason: 'Occupied' };
    if (t === TileType.Stream && kind === NetKind.Rail) return { ok: false, reason: 'Rail cannot cross water' };
    const c = g.getCorners(x, y);
    if (Math.max(...c) - Math.min(...c) > NET_MAX_SPREAD[kind]) {
      return { ok: false, reason: kind === NetKind.Path ? 'Too steep' : 'Too steep (max half-slope)' };
    }
    if (kind !== NetKind.Path) {
      const entry = kind === NetKind.Road ? this.roadEntry : this.railEntry;
      let linked = !!entry && entry.x === x && entry.y === y;
      for (let d = 0; d < 4 && !linked; d++) {
        const nx = x + DX[d]!, ny = y + DY[d]!;
        if (!this.inb(nx, ny)) continue;
        const ni = this.idx(nx, ny);
        if (this.kind[ni] === kind || planned?.has(ni) || (kind === NetKind.Road && this.kind[ni] === NetKind.Rail && this.cross[ni] === Cross.Road)) linked = true;
      }
      if (!linked) return { ok: false, reason: kind === NetKind.Road ? 'Roads must start at the road entry' : 'Rail must start at the rail entry' };
    }
    return { ok: true };
  }

  /**
   * Level-crossing / footbridge check for stroke tile `k` landing on a tile of another network kind. Pure.
   * A path/road stroke over a straight rail tile, or a rail stroke over a straight path/road tile, must run perpendicular to it with a
   * stroke tile on each side; no building (station), no bridge, and at least CROSSING.minSpacing tiles from any other crossing.
   * `overRail` = footbridge over the rail (path only, never closes).
   */
  crossingCheck(kind: NetKindId, tiles: ReadonlyArray<Pt>, k: number, extra: ReadonlyArray<Pt>, overRail = false): { ok: boolean; reason?: string; cross: number } {
    const t = tiles[k]!, i = this.idx(t.x, t.y), ex = this.kind[i]!;
    const fail = (reason: string): { ok: false; reason: string; cross: number } => ({ ok: false, reason, cross: 0 });
    if (this.grid.occupancy.flags[i]! & (OccFlag.Building | OccFlag.Lift)) return fail(CROSS_MSG.station);
    if (this.bridge[i] === 1 || this.grid.tileType[i] === TileType.Stream) return fail(CROSS_MSG.bridge);
    // which network is the "line" being crossed and what is crossing it
    if (kind !== NetKind.Rail && ex !== NetKind.Rail) return fail('Crossing not supported');
    if (kind === NetKind.Rail && ex !== NetKind.Path && ex !== NetKind.Road) return fail('Crossing not supported');
    if (overRail && kind !== NetKind.Path) return fail(CROSS_MSG.roadOnly);
    const m = this.conn[i]!;
    const ns = m === (Conn.N | Conn.S), ew = m === (Conn.E | Conn.W);
    if (!ns && !ew) return fail(CROSS_MSG.angle);
    const a = tiles[k - 1], b = tiles[k + 1];
    if (!a || !b) {
      const o = a ?? b; // a stroke that runs ALONG the line is an angle problem, one that merely ends on it lacks an approach tile
      return fail(o && (ns ? o.x === t.x : o.y === t.y) ? CROSS_MSG.angle : CROSS_MSG.ends);
    }
    // the stroke must enter and leave on opposite sides, perpendicular to the line
    const perpX = ns, perpY = ew; // line N-S => stroke runs E-W
    const okAxis = perpX ? (a.y === t.y && b.y === t.y && Math.abs(a.x - t.x) === 1 && Math.abs(b.x - t.x) === 1 && a.x !== b.x)
      : perpY ? (a.x === t.x && b.x === t.x && Math.abs(a.y - t.y) === 1 && Math.abs(b.y - t.y) === 1 && a.y !== b.y) : false;
    if (!okAxis) return fail(CROSS_MSG.angle);
    const cur = this.cross[i]!;
    const want = overRail ? Cross.Footbridge : kind === NetKind.Road || (kind === NetKind.Rail && ex === NetKind.Road) ? Cross.Road : Cross.Path;
    if (cur === want || (cur === Cross.Road && want === Cross.Path)) return { ok: true, cross: cur };
    if (cur) return fail('Crossing not supported');
    const sp = CROSSING.minSpacing;
    for (let j = 0; j < this.size * this.size && this.crossCount > 0; j++) {
      if (!this.cross[j]) continue;
      if (Math.abs((j % this.size) - t.x) + Math.abs(((j / this.size) | 0) - t.y) <= sp) return fail(CROSS_MSG.spacing);
    }
    for (const e of extra) if (Math.abs(e.x - t.x) + Math.abs(e.y - t.y) <= sp) return fail(CROSS_MSG.spacing);
    const c = this.grid.getCorners(t.x, t.y);
    if (Math.max(...c) - Math.min(...c) > Math.min(NET_MAX_SPREAD[NetKind.Rail], NET_MAX_SPREAD[(kind === NetKind.Rail ? ex : kind) as NetKindId])) return fail(kind === NetKind.Path ? 'Too steep' : 'Too steep (max half-slope)');
    return { ok: true, cross: want };
  }

  /** Cost ($, before the construction multiplier) of one crossing of this `cross` value. */
  crossCost(cross: number): number { return cross === Cross.Footbridge ? CROSSING.footbridge.cost : cross === Cross.Road ? CROSSING.cost.road : CROSSING.cost.path; }

  /** Is there a level crossing / rail footbridge on this tile? */
  crossAt(x: number, y: number): number { return this.inb(x, y) ? this.cross[this.idx(x, y)]! : 0; }

  /** Validate a drag segment (tiles in order). Cost counts only new tiles (+ level crossings). `overRail`: path strokes over rail become footbridges. */
  planSegment(kind: NetKindId, tiles: Pt[], mult = 1, overRail = false): { ok: boolean; cost: number; reason?: string; newTiles: Pt[]; crossings: Array<Pt & { cross: number }> } {
    const planned = new Set<number>();
    const newTiles: Pt[] = [];
    const crossings: Array<Pt & { cross: number }> = [];
    let cost = 0;
    for (let k = 0; k < tiles.length; k++) {
      const t = tiles[k]!;
      const i = this.inb(t.x, t.y) ? this.idx(t.x, t.y) : -1;
      const ex = i >= 0 ? this.kind[i]! : 0;
      if (i >= 0 && ex !== 0 && ex !== kind && ((kind !== NetKind.Rail && ex === NetKind.Rail) || (kind === NetKind.Rail && (ex === NetKind.Path || ex === NetKind.Road)))) {
        const c = this.crossingCheck(kind, tiles, k, crossings, overRail);
        if (!c.ok) return { ok: false, cost: 0, reason: c.reason, newTiles, crossings };
        planned.add(i); // the far side links through the crossing (roads / rail: 'must start at the entry' linking rule)
        if (this.cross[i] !== c.cross) { crossings.push({ x: t.x, y: t.y, cross: c.cross }); cost += this.crossCost(c.cross) * mult; }
        continue;
      }
      const c = this.canBuild(kind, t.x, t.y, planned);
      if (!c.ok) return { ok: false, cost: 0, reason: c.reason, newTiles, crossings };
      if (this.kind[i] !== kind) { planned.add(i); newTiles.push(t); }
    }
    return { ok: true, cost: cost + newTiles.length * NET_COST[kind] * mult, newTiles, crossings };
  }

  /** Build one tile (validated). Returns true if a tile was newly added. */
  build(kind: NetKindId, x: number, y: number): boolean {
    if (!this.canBuild(kind, x, y).ok) return false;
    const i = this.idx(x, y);
    if (this.kind[i] === kind) return false;
    this.note(i);
    this.kind[i] = kind;
    this.bridge[i] = this.grid.tileType[i] === TileType.Stream ? 1 : 0;
    this.grid.occupancy.set(x, y, kind === NetKind.Path ? OccFlag.Path : OccFlag.Road);
    this.refreshConn(x, y);
    return true;
  }

  /**
   * Turn tile (x,y) into a level crossing / footbridge (already validated by `planSegment`). A path/road over rail only sets `cross`; a rail over a
   * path/road replaces the tile's kind by Rail and remembers the old kind as `cross`.
   */
  buildCrossing(kind: NetKindId, x: number, y: number, cross: number): boolean {
    if (!this.inb(x, y)) return false;
    const i = this.idx(x, y), ex = this.kind[i]!;
    if (!cross || this.cross[i] === cross) return false;
    this.note(i);
    if (kind === NetKind.Rail && ex !== NetKind.Rail) {
      this.grid.occupancy.clear(x, y, ex === NetKind.Path ? OccFlag.Path : OccFlag.Road);
      this.kind[i] = NetKind.Rail;
      this.grid.occupancy.set(x, y, OccFlag.Road);
    } else if (ex !== NetKind.Rail) return false;
    if (!this.cross[i]) this.crossCount++;
    this.cross[i] = cross;
    this.refreshConn(x, y);
    return true;
  }

  private recountCross(): void { let n = 0; for (let i = 0; i < this.cross.length; i++) if (this.cross[i]) n++; this.crossCount = n; }

  /** Build a validated segment atomically. Returns tiles added (empty if invalid). */
  buildSegment(kind: NetKindId, tiles: Pt[], overRail = false): Pt[] {
    const plan = this.planSegment(kind, tiles, 1, overRail);
    if (!plan.ok) return [];
    for (const c of plan.crossings) this.buildCrossing(kind, c.x, c.y, c.cross); // first: the road tiles beyond it link through the crossing
    for (const t of plan.newTiles) this.build(kind, t.x, t.y);
    return plan.newTiles;
  }

  /** Remove a network tile; returns the removed kind (0 if none). Disconnected remnants of roads/rail stay (inert). */
  unbuild(x: number, y: number): number {
    if (!this.inb(x, y)) return 0;
    const i = this.idx(x, y), k = this.kind[i]!;
    if (!k) return 0;
    this.note(i);
    if (this.cross[i]) { // bulldozing a level crossing / rail footbridge reverts the tile to plain rail; the path / road is cut (docs/crossings.md)
      const was = this.cross[i]!;
      this.cross[i] = 0; this.crossCount--;
      this.refreshConn(x, y);
      return was === Cross.Road ? NetKind.Road : NetKind.Path;
    }
    this.kind[i] = 0;
    this.bridge[i] = (this.layers[i]! & (Layer.Mtb | Layer.Hike)) && this.grid.tileType[i] === TileType.Stream ? 1 : 0;
    this.grid.occupancy.clear(x, y, k === NetKind.Path ? OccFlag.Path : OccFlag.Road);
    this.refreshConn(x, y);
    return k;
  }

  /** Refund-worthy cost of the tile kind. */
  costOf(kind: number): number { return kind ? NET_COST[kind as NetKindId] : 0; }

  private refreshConn(x: number, y: number): void {
    const recompute = (tx: number, ty: number): void => {
      if (!this.inb(tx, ty)) return;
      const i = this.idx(tx, ty), k = this.kind[i]!;
      let m = 0;
      if (k) for (let d = 0; d < 4; d++) {
        const nx = tx + DX[d]!, ny = ty + DY[d]!, nk = this.kindAt(nx, ny);
        if (nk === k) m |= BITS[d]!;
        else if (k !== NetKind.Rail && nk === NetKind.Rail && this.crossJoins(nx, ny, d, k)) m |= BITS[d]!; // an approach tile reaches into the crossing
      }
      this.conn[i] = m;
      this.markDirty(tx, ty);
    };
    recompute(x, y);
    for (let d = 0; d < 4; d++) recompute(x + DX[d]!, y + DY[d]!);
    // a crossing tile's own arms may just have changed (rail laid next to it): its approach tiles must follow
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d]!, ny = y + DY[d]!;
      if (this.crossAt(nx, ny)) for (let e = 0; e < 4; e++) recompute(nx + DX[e]!, ny + DY[e]!);
    }
  }

  /** Does the crossing on tile (x,y) join a path/road tile of kind `k` coming from direction `d` (the line must run perpendicular to `d`)? */
  private crossJoins(x: number, y: number, d: number, k: number): boolean {
    const i = this.idx(x, y), c = this.cross[i]!;
    if (!c) return false;
    if (!(c === k || (k === NetKind.Path && c === Cross.Footbridge) || (k === NetKind.Road && c === Cross.Road))) return false;
    const m = this.conn[i]!;
    return d === 1 || d === 3 ? m === (Conn.N | Conn.S) : m === (Conn.E | Conn.W);
  }

  // ---------- pistes / trails ----------

  canPaint(x: number, y: number, layer: LayerBit = Layer.Ski): BuildCheck {
    if (!this.inb(x, y)) return { ok: false, reason: 'Out of bounds' };
    const i = this.idx(x, y);
    const tt = this.grid.tileType[i];
    // Lakes block every layer; streams block ski pistes (no snow on water: documented rule, no snow bridges) but trails bridge them.
    if (tt === TileType.Water || (tt === TileType.Stream && layer === Layer.Ski)) return { ok: false, reason: PISTE_WATER_MSG };
    if (this.grid.occupancy.flags[i]! & OccFlag.Decor) return { ok: false, reason: 'Garden decor in the way' };
    if (this.grid.occupancy.flags[i]! & OccFlag.Building) {
      // Only buildings that may stand on a piste (pisteRule 'allow': carpet, cannon, sign, stunt park) can be painted over.
      const t = this.host.at(x, y)?.type;
      if (!(t && BUILDINGS[t]?.pisteRule === 'allow')) return { ok: false, reason: 'Occupied by a building' };
    }
    return { ok: true };
  }

  /** Paint a stroke of tiles on a layer. Difficulty auto from average steepness unless overridden. */
  paint(layer: LayerBit, tiles: Pt[], override?: number): { painted: number; difficulty: number } {
    const ok = tiles.filter((t) => this.canPaint(t.x, t.y, layer).ok);
    if (!ok.length) return { painted: 0, difficulty: 0 };
    let sum = 0;
    for (const t of ok) sum += this.grid.steepness(t.x, t.y);
    const diffs = override === undefined ? this.autoDifficulty(ok) : new Map<number, number>();
    const diff = override ?? difficultyFromSteepness(sum / ok.length);
    let n = 0;
    for (const t of ok) {
      const i = this.idx(t.x, t.y);
      this.note(i);
      if (!(this.layers[i]! & layer)) n++;
      this.layers[i]! |= layer;
      if (layer !== Layer.Ski && this.kind[i] === 0 && this.grid.tileType[i] === TileType.Stream) this.bridge[i] = 1;
      this.difficulty[i] = override ?? diffs.get(i) ?? diff;
      if (!this.quality[i]) this.quality[i] = 128;
      this.markDirty(t.x, t.y);
    }
    return { painted: n, difficulty: diff };
  }

  unpaint(layer: LayerBit, x: number, y: number): boolean {
    if (!this.inb(x, y)) return false;
    const i = this.idx(x, y);
    if (!(this.layers[i]! & layer)) return false;
    this.note(i);
    this.layers[i]! &= ~layer & 0xff;
    if (!this.layers[i]) { this.difficulty[i] = 0; this.quality[i] = 0; if (!this.kind[i]) this.bridge[i] = 0; }
    this.markDirty(x, y);
    return true;
  }

  /** Remove every layer on a tile. */
  clearLayers(x: number, y: number): boolean {
    let any = false;
    for (const l of [1, 2, 4] as const) any = this.unpaint(l, x, y) || any;
    return any;
  }


  // ---------- undo journal ----------

  private snap(i: number): TileSnap {
    return { i, kind: this.kind[i]!, bridge: this.bridge[i]!, cross: this.cross[i]!, layers: this.layers[i]!, difficulty: this.difficulty[i]!, quality: this.quality[i]! };
  }
  /** Snapshots of the CURRENT state of the given tiles (redo of a stroke replays the post-state). */
  snapshotTiles(idx: ReadonlyArray<number>): TileSnap[] { return idx.map((i) => this.snap(i)); }
  private note(i: number): void { if (this.journal && !this.journal.has(i)) this.journal.set(i, this.snap(i)); }
  /** Start recording the pre-change state of every tile mutated until `endJournal`. */
  beginJournal(): void { this.journal = new Map(); }
  /** Stop recording; returns the pre-change snapshots (a diff that `restore` can apply). */
  endJournal(): TileSnap[] { const j = this.journal ? [...this.journal.values()] : []; this.journal = null; return j; }
  /** Restore tiles to a snapshot (undo). Tiles now covered by a building/lift are left alone. Returns tiles restored. */
  restore(diff: ReadonlyArray<TileSnap>): number {
    let n = 0;
    const touched: number[] = [];
    for (const s of diff) {
      const x = s.i % this.size, y = (s.i / this.size) | 0;
      if (s.kind && this.grid.occupancy.flags[s.i]! & (OccFlag.Building | OccFlag.Lift)) continue;
      const old = this.kind[s.i]!;
      if (old) this.grid.occupancy.clear(x, y, old === NetKind.Path ? OccFlag.Path : OccFlag.Road);
      this.kind[s.i] = s.kind; this.bridge[s.i] = s.bridge;
      { const c = s.cross ?? 0; if (c && !this.cross[s.i]) this.crossCount++; else if (!c && this.cross[s.i]) this.crossCount--; this.cross[s.i] = c; }
      if (s.kind) this.grid.occupancy.set(x, y, s.kind === NetKind.Path ? OccFlag.Path : OccFlag.Road);
      this.layers[s.i] = s.layers; this.difficulty[s.i] = s.difficulty; this.quality[s.i] = s.quality;
      touched.push(s.i);
      n++;
    }
    for (const i of touched) this.refreshConn(i % this.size, (i / this.size) | 0);
    return n;
  }

  // ---------- stroke validation ----------

  /**
   * Does a trail/footpath tile attach to something: an existing network tile (path/road/rail), a building, a lift, or
   * (when `layer` given) an existing tile of the same trail layer — on the tile or 4-adjacent.
   */
  isAnchoredTile(x: number, y: number, layer?: LayerBit): boolean {
    for (let d = -1; d < 4; d++) {
      const nx = d < 0 ? x : x + DX[d]!, ny = d < 0 ? y : y + DY[d]!;
      if (!this.inb(nx, ny)) continue;
      const i = this.idx(nx, ny);
      if (this.kind[i]) return true;
      if (layer && (this.layers[i]! & layer)) return true;
      if (this.grid.occupancy.flags[i]! & (OccFlag.Building | OccFlag.Lift)) return true;
    }
    return false;
  }

  /** A stroke of line-network tiles may be placed only if at least one tile attaches (the stroke itself is 4-connected). */
  strokeAnchored(tiles: ReadonlyArray<Pt>, layer?: LayerBit): boolean {
    return tiles.some((t) => this.isAnchoredTile(t.x, t.y, layer));
  }

  /** 3x3 mean steepness around a tile (smooths per-tile speckle). */
  smoothedSteepness(x: number, y: number): number {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!this.inb(x + dx, y + dy)) continue;
      s += this.grid.steepness(x + dx, y + dy); n++;
    }
    return n ? s / n : 0;
  }

  /** Per-tile auto difficulty from 3x3-smoothed steepness with hysteresis along the stroke order (no blue/red flicker). */
  autoDifficulty(tiles: ReadonlyArray<Pt>): Map<number, number> {
    const out = new Map<number, number>();
    const MARGIN = 0.2;
    let prev = -1;
    for (const t of tiles) {
      const s = this.smoothedSteepness(t.x, t.y);
      let d = difficultyFromSteepness(s);
      if (prev >= 0 && d !== prev) {
        // Only switch when clearly past the boundary of the previous bucket.
        const lo = [-Infinity, 0.75, 1.25, 1.75][prev]!, hi = [0.75, 1.25, 1.75, Infinity][prev]!;
        if (s > lo - MARGIN && s < hi + MARGIN) d = prev;
      }
      out.set(this.idx(t.x, t.y), d);
      prev = d;
    }
    return out;
  }

  // ---------- piste components ----------

  /** 8-connected components of the ski layer with stats (cached per version). */
  pisteComponents(): PisteComponent[] {
    return this.pisteState().comps;
  }
  /** 1 where the tile belongs to a disconnected piste component. */
  disconnectedMask(): Uint8Array { return this.pisteState().flags; }

  private pisteState(): { v: number; comps: PisteComponent[]; flags: Uint8Array } {
    if (this.pisteCache && this.pisteCache.v === this.version) return this.pisteCache;
    const comps = this.componentsOf(Layer.Ski);
    const flags = new Uint8Array(this.size * this.size);
    for (const c of comps) if (c.disconnected) for (const i of c.tiles) flags[i] = 1;
    const old = this.pisteCache?.flags;
    this.pisteCache = { v: this.version, comps, flags };
    if (old) { // chunks whose flagged tiles changed must re-render their overlay (without bumping version)
      for (let i = 0; i < flags.length; i++) if (flags[i] !== old[i]) this.dirty.add((((i / this.size) | 0) / CHUNK_SIZE | 0) * this.grid.chunksPerRow + (((i % this.size) / CHUNK_SIZE) | 0));
    }
    return this.pisteCache;
  }

  private componentsOf(layer: number): PisteComponent[] {
    const n = this.size, seen = new Uint8Array(n * n), comps: PisteComponent[] = [];
    const occ = this.grid.occupancy.flags;
    for (let s = 0; s < n * n; s++) {
      if (seen[s] || !(this.layers[s]! & layer)) continue;
      const q = [s]; seen[s] = 1;
      let lift = false, path = false, bld = false;
      let top = s, bot = s, topA = -Infinity, botA = Infinity;
      for (let h = 0; h < q.length; h++) {
        const i = q[h]!, x = i % n, y = (i / n) | 0;
        const c = this.grid.getCorners(x, y);
        const a = ((c[0] + c[1] + c[2] + c[3]) / 4) * HEIGHT_UNIT;
        if (a > topA) { topA = a; top = i; }
        if (a < botA) { botA = a; bot = i; }
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (!this.inb(nx, ny)) continue;
          const ni = this.idx(nx, ny);
          const o = occ[ni]!;
          if (o & OccFlag.Lift) lift = true;
          if (o & OccFlag.Building) bld = true;
          if (dx === 0 || dy === 0) { const k = this.kind[ni]; if (k === NetKind.Path || k === NetKind.Road) path = true; }
          if (!seen[ni] && (this.layers[ni]! & layer)) { seen[ni] = 1; q.push(ni); }
        }
      }
      comps.push({
        id: comps.length, tiles: q, count: q.length, topAlt: topA, bottomAlt: botA,
        top: { x: top % n, y: (top / n) | 0 }, bottom: { x: bot % n, y: (bot / n) | 0 },
        touchesLift: lift, touchesPath: path, touchesBuilding: bld, main: false, disconnected: false,
      });
    }
    let main = -1;
    for (const c of comps) if (main < 0 || c.count > comps[main]!.count) main = c.id;
    if (main >= 0) comps[main]!.main = true;
    for (const c of comps) c.disconnected = layer === Layer.Ski && !c.main && !c.touchesLift;
    return comps;
  }

  /**
   * After a piste stroke: remove tiny (< PISTE_MIN_FRAGMENT) ski fragments that are not the main piste and touch no
   * lift/path/building. Returns the number of tiles removed.
   */
  cleanupPiste(minTiles = PISTE_MIN_FRAGMENT): number {
    let removed = 0;
    for (const c of this.componentsOf(Layer.Ski)) {
      if (c.main || c.count >= minTiles || c.touchesLift || c.touchesPath || c.touchesBuilding) continue;
      for (const i of c.tiles) if (this.unpaint(Layer.Ski, i % this.size, (i / this.size) | 0)) removed++;
    }
    return removed;
  }

  /**
   * Remove every unattached component of a layer: ski = any non-main component not touching lift/path/building;
   * trails = components touching no path/road/rail/building/lift. Returns tiles removed.
   */
  pruneOrphans(layer: LayerBit): number {
    let removed = 0;
    for (const c of this.componentsOf(layer)) {
      const attached = layer === Layer.Ski
        ? c.main || c.touchesLift || c.touchesPath || c.touchesBuilding
        : c.touchesLift || c.touchesPath || c.touchesBuilding || c.tiles.some((i) => this.kind[i] !== 0 || this.isAnchoredNonLayer(i));
      if (attached) continue;
      for (const i of c.tiles) if (this.unpaint(layer, i % this.size, (i / this.size) | 0)) removed++;
    }
    return removed;
  }
  private isAnchoredNonLayer(i: number): boolean {
    const x = i % this.size, y = (i / this.size) | 0;
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d]!, ny = y + DY[d]!;
      if (!this.inb(nx, ny)) continue;
      const k = this.idx(nx, ny);
      if (this.kind[k]) return true;
    }
    return false;
  }

  // ---------- connectivity ----------

  private fp(b: Rect | { x: number; y: number; w: number; h: number }): Rect { return b; }
  private footprintOf(p: Pt): Rect | null {
    const b = this.host.at(p.x, p.y);
    return b ? this.fp(b) : null;
  }

  /** Tiles 4-adjacent to the footprint (outside it). */
  private ring(r: Rect): Pt[] {
    const out: Pt[] = [];
    for (let i = r.x; i < r.x + r.w; i++) { out.push({ x: i, y: r.y - 1 }, { x: i, y: r.y + r.h }); }
    for (let j = r.y; j < r.y + r.h; j++) { out.push({ x: r.x - 1, y: j }, { x: r.x + r.w, y: j }); }
    return out.filter((t) => this.inb(t.x, t.y));
  }

  /**
   * Bounded BFS over footpath tiles between two buildings (or tiles with no building).
   * Distance = path tiles walked + 1 (entering from building A's edge counts one step; reaching B's edge counts none extra),
   * i.e. number of steps from A's footprint to B's footprint. Infinity if > maxTiles or unreachable.
   */
  /** Footpath tile, or a footpath level crossing / footbridge over rail. */
  private isFootTile(i: number): boolean { return this.kind[i] === NetKind.Path || (this.kind[i] === NetKind.Rail && (this.cross[i] === Cross.Path || this.cross[i] === Cross.Footbridge)); }

  pathDistance = (from: Pt, to: Pt, maxTiles: number): number => {
    const a = this.footprintOf(from) ?? { x: from.x, y: from.y, w: 1, h: 1 };
    const b = this.footprintOf(to) ?? { x: to.x, y: to.y, w: 1, h: 1 };
    if (a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h) return 0;
    const inB = (x: number, y: number): boolean => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
    const dist = new Map<number, number>();
    let frontier: number[] = [];
    for (const t of this.ring(a)) {
      const i = this.idx(t.x, t.y);
      if (this.isFootTile(i) && !dist.has(i)) { dist.set(i, 1); frontier.push(i); }
      else if (inB(t.x, t.y)) return 1;
    }
    let d = 1;
    while (frontier.length && d <= maxTiles) {
      const next: number[] = [];
      for (const i of frontier) {
        const x = i % this.size, y = (i / this.size) | 0;
        for (let k = 0; k < 4; k++) {
          const nx = x + DX[k]!, ny = y + DY[k]!;
          if (!this.inb(nx, ny)) continue;
          if (inB(nx, ny)) return d + 1 <= maxTiles ? d + 1 : Infinity;
          const ni = this.idx(nx, ny);
          if (!this.isFootTile(ni) || dist.has(ni)) continue;
          dist.set(ni, d + 1);
          next.push(ni);
        }
      }
      frontier = next;
      d++;
    }
    return Infinity;
  };

  private flood(starts: number[], pass: (i: number) => boolean): Uint8Array {
    const seen = new Uint8Array(this.size * this.size);
    const q: number[] = [];
    for (const s of starts) if (pass(s) && !seen[s]) { seen[s] = 1; q.push(s); }
    for (let h = 0; h < q.length; h++) {
      const i = q[h]!, x = i % this.size, y = (i / this.size) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = x + DX[k]!, ny = y + DY[k]!;
        if (!this.inb(nx, ny)) continue;
        const ni = this.idx(nx, ny);
        if (!seen[ni] && pass(ni)) { seen[ni] = 1; q.push(ni); }
      }
    }
    return seen;
  }

  private comps(): NonNullable<typeof this.cache> {
    const c = this.cache;
    if (c.v === this.version) return c;
    const k = this.kind;
    const e = (p: Pt | null): number[] => (p ? [this.idx(p.x, p.y)] : []);
    c.v = this.version;
    const cr = this.cross;
    c.roadComp = this.flood(e(this.roadEntry), (i) => k[i] === NetKind.Road || (k[i] === NetKind.Rail && cr[i] === Cross.Road));
    c.walkComp = this.flood(e(this.roadEntry), (i) => k[i] === NetKind.Road || k[i] === NetKind.Path || (k[i] === NetKind.Rail && cr[i]! > 0));
    c.railComp = this.flood(e(this.railEntry), (i) => k[i] === NetKind.Rail);
    return c;
  }

  private touches(r: Rect, seen: Uint8Array): boolean {
    return this.ring(r).some((t) => seen[this.idx(t.x, t.y)]);
  }

  private onSeen(r: Rect, seen: Uint8Array): boolean {
    for (let j = r.y; j < r.y + r.h; j++) for (let i = r.x; i < r.x + r.w; i++) if (this.inb(i, j) && seen[this.idx(i, j)]) return true;
    return false;
  }

  /** Building reachable from the road entry via roads + footpaths (adjacent tiles link). */
  isConnected(buildingId: number): boolean {
    const b = this.host.get(buildingId);
    return !!b && this.touches(b, this.comps().walkComp!);
  }

  /** Access verdict from the building's own access rule (PlacementRules): null = fine (remote types are always fine), else the 'Not connected: needs ...' text. */
  accessProblem(buildingId: number): string | null {
    const b = this.host.get(buildingId);
    if (!b) return null;
    return b.type ? accessProblem(b.type, this.access, { x: b.x, y: b.y, w: b.w, h: b.h }) : null;
  }

  /** Buildings flagged as disconnected from the entry. */
  disconnected(ids: Iterable<number>): number[] {
    return [...ids].filter((id) => !this.isConnected(id));
  }

  /** Building footprint touches a road connected to the road entry. */
  isRoadServed(buildingId: number): boolean {
    const b = this.host.get(buildingId);
    return !!b && this.touches(b, this.comps().roadComp!);
  }

  /** Any piste/trail layer on tile. */
  pisteAt(x: number, y: number): boolean { return this.inb(x, y) && this.layers[this.idx(x, y)]! !== 0; }

  /** Footprint (or its 4-neighbour ring) touches a piste. */
  private touchesPiste(r: Rect): boolean {
    for (let j = r.y; j < r.y + r.h; j++) for (let i = r.x; i < r.x + r.w; i++) if (this.pisteAt(i, j)) return true;
    return this.ring(r).some((t) => this.pisteAt(t.x, t.y));
  }

  /** Does the footprint rect touch a connected network of this kind (or a piste)? Used by the data-driven access rules. */
  serves(kind: ServedKind, r: Rect): boolean {
    const c = this.comps();
    switch (kind) {
      case 'road': return this.touches(r, c.roadComp!);
      case 'path': return this.touches(r, c.walkComp!);
      case 'rail': return this.touches(r, c.railComp!) || this.onSeen(r, c.railComp!); // a station may stand ON the rail
      case 'piste': return this.touchesPiste(r);
      case 'trail': return this.touchesTrail(r);
    }
  }

  private trailCache: { v: number; mask: Uint8Array } | null = null;

  /**
   * 1 on every Hike / MTB trail tile of an ATTACHED component (cached per version): the component touches a footpath / road
   * of the walk network from the road entry, or a lift. A trail island nobody can walk to does not serve buildings.
   */
  trailMask(): Uint8Array {
    if (this.trailCache && this.trailCache.v === this.version) return this.trailCache.mask;
    const n = this.size, mask = new Uint8Array(n * n), walk = this.comps().walkComp!;
    for (const c of this.componentsOf(Layer.Hike | Layer.Mtb)) {
      let attached = c.touchesLift;
      for (let h = 0; !attached && h < c.tiles.length; h++) {
        const i = c.tiles[h]!, x = i % n, y = (i / n) | 0;
        if (walk[i]) { attached = true; break; }
        for (let d = 0; d < 4 && !attached; d++) { const nx = x + DX[d]!, ny = y + DY[d]!; if (this.inb(nx, ny) && walk[this.idx(nx, ny)]) attached = true; }
      }
      if (attached) for (const i of c.tiles) mask[i] = 1;
    }
    this.trailCache = { v: this.version, mask };
    return mask;
  }

  /** Footprint (or its 4-neighbour ring) touches an attached hiking / MTB trail tile. */
  private touchesTrail(r: Rect): boolean {
    const m = this.trailMask();
    for (let j = r.y; j < r.y + r.h; j++) for (let i = r.x; i < r.x + r.w; i++) if (this.inb(i, j) && m[this.idx(i, j)]) return true;
    return this.ring(r).some((t) => m[this.idx(t.x, t.y)]);
  }

  /** True when the building is supplied only on foot (trail / piste edge, no footpath or road): pays the remote-supply upkeep surcharge. */
  suppliedOnFootOnly(buildingId: number): boolean {
    const b = this.host.get(buildingId);
    const def = b?.type ? BUILDINGS[b.type] : undefined;
    return !!b && !!def && suppliedOnFootOnly(def, this.access, { x: b.x, y: b.y, w: b.w, h: b.h });
  }

  /** Why a network of this kind near the footprint does not serve it: linked-only-by-corner, painted but not linked to the entry, or one tile away. */
  diagnose(kind: 'road' | 'path' | 'rail', r: Rect): 'unlinked' | 'corner' | 'gap' | null {
    const want = (x: number, y: number): boolean => {
      if (!this.inb(x, y)) return false;
      const k = this.kind[this.idx(x, y)];
      return kind === 'road' ? k === NetKind.Road : kind === 'path' ? k === NetKind.Road || k === NetKind.Path : k === NetKind.Rail;
    };
    if (this.ring(r).some((t) => want(t.x, t.y))) return 'unlinked'; // a side touches it (else it would serve): the network is not linked to the entry
    const x1 = r.x + r.w, y1 = r.y + r.h;
    if (want(r.x - 1, r.y - 1) || want(x1, r.y - 1) || want(r.x - 1, y1) || want(x1, y1)) return 'corner';
    for (let i = r.x; i < x1; i++) if (want(i, r.y - 2) || want(i, y1 + 1)) return 'gap';
    for (let j = r.y; j < y1; j++) if (want(r.x - 2, j) || want(x1 + 1, j)) return 'gap';
    return null;
  }

  /** Query facade for Buildings.setNetwork({ access }). */
  readonly access: NetworkAccess = {
    serves: (k, r) => this.serves(k, r),
    diagnose: (k, r) => this.diagnose(k, r),
    pisteAt: (x, y) => this.pisteAt(x, y),
    kindAt: (x, y) => this.kindAt(x, y),
    crossAt: (x, y) => this.crossAt(x, y),
  };

  /** Train station reached by rail from the rail entry. */
  isRailServed(buildingId: number): boolean {
    const b = this.host.get(buildingId);
    return !!b && (this.touches(b, this.comps().railComp!) || this.onSeen(b, this.comps().railComp!));
  }

  /** Both points (buildings) sit on roads connected to the road entry (or, with no entry, the same road component). */
  roadConnected = (a: Pt, b: Pt): boolean => {
    const ra = this.footprintOf(a), rb = this.footprintOf(b);
    if (!ra || !rb) return false;
    const c = this.comps();
    if (this.roadEntry) return this.touches(ra, c.roadComp!) && this.touches(rb, c.roadComp!);
    const starts = this.ring(ra).map((t) => this.idx(t.x, t.y)).filter((i) => this.kind[i] === NetKind.Road);
    return this.touches(rb, this.flood(starts, (i) => this.kind[i] === NetKind.Road));
  };

  // ---------- pathfinding for free stubs ----------

  /** BFS route over buildable tiles of `kind` from `from` to within `stopWithin` tiles of `to`. */
  route(kind: NetKindId, from: Pt, to: Pt, stopWithin = 0, goal?: (x: number, y: number) => boolean): Pt[] {
    const n = this.size;
    const prev = new Int32Array(n * n).fill(-2);
    const s = this.idx(from.x, from.y);
    if (!this.inb(from.x, from.y)) return [];
    const ok = (x: number, y: number): boolean => {
      const i = this.idx(x, y);
      if (this.kind[i] === kind) return true;
      if (this.kind[i] !== 0) return false;
      const t = this.grid.tileType[i];
      if (t === TileType.Water) return false;
      if (this.grid.occupancy.flags[i]! & (OccFlag.Building | OccFlag.Lift)) return false;
      if (t === TileType.Stream && kind === NetKind.Rail) return false;
      const c = this.grid.getCorners(x, y);
      return Math.max(...c) - Math.min(...c) <= NET_MAX_SPREAD[kind];
    };
    if (!ok(from.x, from.y)) return [];
    prev[s] = -1;
    const q = [s];
    for (let h = 0; h < q.length; h++) {
      const i = q[h]!, x = i % n, y = (i / n) | 0;
      if (goal ? goal(x, y) : Math.abs(x - to.x) + Math.abs(y - to.y) <= stopWithin) {
        const out: Pt[] = [];
        for (let c = i; c !== -1; c = prev[c]!) out.push({ x: c % n, y: (c / n) | 0 });
        return out.reverse();
      }
      for (let k = 0; k < 4; k++) {
        const nx = x + DX[k]!, ny = y + DY[k]!;
        if (!this.inb(nx, ny)) continue;
        const ni = this.idx(nx, ny);
        if (prev[ni] !== -2 || !ok(nx, ny)) continue;
        prev[ni] = i;
        q.push(ni);
      }
    }
    return [];
  }

  /**
   * Multi-source route for building new stubs: starts from every `source` tile AND every existing tile of `kind` (so a new
   * stub branches off the nearest existing path instead of running a parallel strip from the start), prefers diagonal
   * staircases (small bonus for turning) and a deterministic per-tile wobble so lines read as gentle curves, not a rigid grid.
   * Same passability rules as `route`. Returns the tiles from the branch-off point to the goal (first tile = the source).
   */
  routeFrom(kind: NetKindId, sources: readonly Pt[], goal: (x: number, y: number) => boolean, style: 'curve' | 'straight' = 'curve'): Pt[] {
    const n = this.size, N = n * n;
    const ok = (x: number, y: number): boolean => {
      const i = this.idx(x, y);
      if (this.kind[i] === kind) return true;
      if (this.kind[i] !== 0) return false;
      const t = this.grid.tileType[i];
      if (t === TileType.Water) return false;
      if (this.grid.occupancy.flags[i]! & (OccFlag.Building | OccFlag.Lift)) return false;
      if (t === TileType.Stream && kind === NetKind.Rail) return false;
      const c = this.grid.getCorners(x, y);
      return Math.max(...c) - Math.min(...c) <= NET_MAX_SPREAD[kind];
    };
    const wob = (i: number): number => { const h = Math.imul(i ^ 0x9e3779b1, 0x85ebca6b) >>> 0; return ((h ^ (h >>> 13)) % 1000) / 1000; };
    // state = tile * 5 + incoming direction (4 = none); binary heap on cost
    const dist = new Float32Array(N * 5).fill(Infinity), prev = new Int32Array(N * 5).fill(-1);
    const heap: Array<[number, number]> = [];
    const push = (c: number, st: number): void => { let i = heap.length; heap.push([c, st]); while (i > 0) { const p = (i - 1) >> 1; if (heap[p]![0] <= heap[i]![0]) break; [heap[p], heap[i]] = [heap[i]!, heap[p]!]; i = p; } };
    const pop = (): [number, number] => { const top = heap[0]!, last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l; if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i]!, heap[m]!]; i = m; } } return top; };
    const seen = new Set<number>();
    const seed = (x: number, y: number): void => { if (!this.inb(x, y) || !ok(x, y)) return; const i = this.idx(x, y); if (seen.has(i)) return; seen.add(i); dist[i * 5 + 4] = 0; push(0, i * 5 + 4); };
    for (const s of sources) seed(s.x, s.y);
    for (let i = 0; i < N; i++) if (this.kind[i] === kind) seed(i % n, (i / n) | 0);
    while (heap.length) {
      const [c, st] = pop();
      if (c > dist[st]!) continue;
      const i = (st / 5) | 0, d = st % 5, x = i % n, y = (i / n) | 0;
      if (goal(x, y)) {
        const out: Pt[] = [];
        for (let k = st; k !== -1; k = prev[k]!) { const t = (k / 5) | 0; if (!out.length || out[out.length - 1]!.x !== t % n || out[out.length - 1]!.y !== ((t / n) | 0)) out.push({ x: t % n, y: (t / n) | 0 }); }
        return out.reverse();
      }
      for (let k = 0; k < 4; k++) {
        const nx = x + DX[k]!, ny = y + DY[k]!;
        if (!this.inb(nx, ny) || !ok(nx, ny)) continue;
        const ni = this.idx(nx, ny);
        // existing tiles of the kind are free to walk (reuse the network); new tiles cost 1 (+ wobble), turning is a little cheaper than going straight
        const step = this.kind[ni] === kind ? 0.01 : (style === 'curve' ? 1 + wob(ni) * 0.08 + (d === k ? 0.06 : 0) : 1 + (d === k || d === 4 ? 0 : 0.3));
        const ns = ni * 5 + k, nc = c + step;
        if (nc < dist[ns]!) { dist[ns] = nc; prev[ns] = st; push(nc, ns); }
      }
    }
    return [];
  }

  /** Free starter infrastructure: road entry -> village, rail entry -> toward village. Pass the lodge rect so the road ends adjacent to it. */
  placeInitialStubs(roadEntry: Pt, railEntry: Pt, village: Pt, lodge?: Rect): { road: number; rail: number } {
    this.roadEntry = { ...roadEntry };
    this.railEntry = { ...railEntry };
    const ringSet = new Set((lodge ? this.ring(lodge) : []).map((t) => this.idx(t.x, t.y)));
    const lay = (kind: NetKindId, entry: Pt, stop: number): number => {
      const goal = kind === NetKind.Road && lodge ? (x: number, y: number): boolean => ringSet.has(this.idx(x, y)) : undefined;
      const r = this.route(kind, entry, village, stop, goal);
      let n = 0;
      for (const t of r) if (this.build(kind, t.x, t.y)) n++;
      return n;
    };
    return { road: lay(NetKind.Road, roadEntry, 6), rail: lay(NetKind.Rail, railEntry, 10) };
  }
}
