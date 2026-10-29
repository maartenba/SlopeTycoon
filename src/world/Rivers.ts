import { TileType, isWaterType, type Grid } from './Grid';
import { OccFlag } from './Occupancy';
import { SPRING } from '../config/rivers';
import { springGroundOk, type SpringSite } from './SpringSites';
import type { Stream } from './Streams';

/**
 * Dug rivers + springs (Phase 6 M6.2). A river is a 1-tile-wide polyline of `TileType.Stream` tiles from a source (spring / lake shore / stream bank)
 * downhill to a sink (lake / map edge / stream). The CARVED heights already live in the saved grid; the record keeps the exact corner diff so the channel
 * can be filled back in, and the source / sink for the unified `waterways()` read model. Pure data: planning is `RiverPlanner`, committing is `applyRiver`.
 *
 * Inert until used: `serialize()` is null while there are no rivers and no player springs, so saves and `stateHash` of every world without them are
 * byte-identical to before. Natural spring sites are a derived overlay (`SpringSites`), never saved.
 */
export interface Pt { x: number; y: number }
export interface RiverSource { kind: 'spring' | 'lake' | 'stream'; x: number; y: number; /** The water tile the source touches (lake / stream). */ via?: Pt }
export interface RiverSink { kind: 'lake' | 'edge' | 'stream'; x: number; y: number }
/** One moved corner: vertex index (vy*(N+1)+vx), the height before / after the dig. */
export interface CarvedCorner { v: number; from: number; to: number }

export interface RiverRec {
  id: number;
  path: Pt[];
  /** Channel level per tile (min corner, half-steps) right after digging; non-increasing. */
  level: number[];
  source: RiverSource;
  sink: RiverSink;
  /** Same vocabulary as natural streams (`lake | edge | merge`). */
  end: Stream['end'];
  carved: CarvedCorner[];
  /** $ paid. */
  cost: number;
}

export interface Waterbody { x: number; y: number }

export class Rivers {
  rivers: RiverRec[] = [];
  /** Player-placed springs ($250): saved. */
  springs: Pt[] = [];
  /** Natural spring sites derived from the seed (overlay; set by createSim after terrain generation, never saved). */
  natural: SpringSite[] = [];
  readonly springSitesVersion: number = SPRING.sitesVersion;
  /** Bumped by every change (renderers rebuild; the unified waterway list is re-read). */
  version = 0;
  private nextId = 1;
  private listeners: Array<() => void> = [];
  constructor(readonly grid: Grid) {}

  onChange(fn: () => void): void { this.listeners.push(fn); }
  changed(): void { this.version++; for (const l of this.listeners) l(); }

  nextRiverId(): number { return this.nextId; }
  add(r: Omit<RiverRec, 'id'>): RiverRec { const rec = { ...r, id: this.nextId++ }; this.rivers.push(rec); this.changed(); return rec; }
  remove(id: number): void { this.rivers = this.rivers.filter((r) => r.id !== id); this.changed(); }
  addSpring(p: Pt): void { this.springs.push({ x: p.x, y: p.y }); this.changed(); }
  removeSpring(x: number, y: number): void { this.springs = this.springs.filter((s) => s.x !== x || s.y !== y); this.changed(); }

  riverAt(x: number, y: number): RiverRec | undefined { return this.rivers.find((r) => r.path.some((p) => p.x === x && p.y === y)); }
  isPlacedSpring(x: number, y: number): boolean { return this.springs.some((s) => s.x === x && s.y === y); }
  isNaturalSite(x: number, y: number): boolean { return this.natural.some((s) => s.x === x && s.y === y); }
  /** A tile a river may start on: a placed spring, or a natural site that is still dry and free. */
  isSource(x: number, y: number): boolean {
    if (this.isPlacedSpring(x, y)) return true;
    if (!this.isNaturalSite(x, y)) return false;
    const i = y * this.grid.size + x;
    return !isWaterType(this.grid.tileType[i]!) && this.grid.occupancy.flags[i] === 0;
  }
  /** Every spring (natural + placed) for markers: `placed` tells them apart. */
  allSprings(): Array<Pt & { placed: boolean; used: boolean }> {
    const used = (x: number, y: number): boolean => this.rivers.some((r) => r.source.kind === 'spring' && r.source.x === x && r.source.y === y);
    return [
      ...this.natural.map((s) => ({ x: s.x, y: s.y, placed: false, used: used(s.x, s.y) })),
      ...this.springs.map((s) => ({ x: s.x, y: s.y, placed: true, used: used(s.x, s.y) })),
    ];
  }

  serialize(): { v: number; sitesVersion: number; rivers: RiverRec[]; springs: Pt[]; nextId: number } | null {
    if (this.rivers.length === 0 && this.springs.length === 0) return null;
    return {
      v: 1, sitesVersion: this.springSitesVersion, nextId: this.nextId,
      rivers: this.rivers.map((r) => ({ ...r, path: r.path.map((p) => ({ ...p })), level: [...r.level], source: { ...r.source, ...(r.source.via ? { via: { ...r.source.via } } : {}) }, sink: { ...r.sink }, carved: r.carved.map((c) => ({ ...c })) })),
      springs: this.springs.map((s) => ({ ...s })),
    };
  }
  load(d: unknown): void {
    const o = (d ?? {}) as { rivers?: RiverRec[]; springs?: Pt[]; nextId?: number };
    this.rivers = (o.rivers ?? []).map((r) => ({ ...r, path: r.path.map((p) => ({ ...p })), level: [...r.level], source: { ...r.source }, sink: { ...r.sink }, carved: r.carved.map((c) => ({ ...c })) }));
    this.springs = (o.springs ?? []).map((s) => ({ x: s.x, y: s.y }));
    this.nextId = o.nextId ?? this.rivers.reduce((m, r) => Math.max(m, r.id), 0) + 1;
    this.changed();
  }
  reset(): void { this.load(null); }
}

// ------------------------------------------------------------------------------------------------------------ springs (player)

export interface SpringEnv { grid: Grid; netAt?: (i: number) => number; multiplier?: () => number }
export interface SpringPlan { ok: boolean; reason?: string; x: number; y: number; cost: number }

/** Can a spring be placed here? Dry, unoccupied, >= 2 higher neighbours. Fee `SPRING.cost` x construction multiplier. */
export function planSpring(env: SpringEnv, rivers: Rivers, x: number, y: number): SpringPlan {
  const g = env.grid, cost = Math.round(SPRING.cost * (env.multiplier?.() ?? 1));
  const no = (reason: string): SpringPlan => ({ ok: false, reason, x, y, cost: 0 });
  if (!g.inBounds(x, y)) return no('Out of bounds');
  const i = g.tileIndex(x, y), t = g.tileType[i]!;
  if (isWaterType(t) || t === TileType.Ice || (g.occupancy.flags[i]! & OccFlag.Water)) return no('A spring needs dry ground');
  if (rivers.isPlacedSpring(x, y) || rivers.isNaturalSite(x, y)) return no('There is already a spring here');
  if (g.occupancy.flags[i] !== 0 || (env.netAt?.(i) ?? 0) !== 0) return no('The tile is occupied');
  if (!springGroundOk(g, x, y)) return no('Springs need ground that rises on at least two sides');
  return { ok: true, x, y, cost };
}

/** Commit a planned spring (the caller charges `plan.cost`). The tile is marked like garden decor so nothing gets built on it. */
export function applySpring(env: SpringEnv, rivers: Rivers, plan: SpringPlan): boolean {
  if (!plan.ok) return false;
  env.grid.occupancy.flags[env.grid.tileIndex(plan.x, plan.y)]! |= OccFlag.Decor;
  rivers.addSpring({ x: plan.x, y: plan.y });
  return true;
}

export interface SpringRemovePlan { ok: boolean; reason?: string; refund: number }
/** Bulldoze a placed spring: refund 0. Refused while a river starts there (dig it back in first). Natural sites stay. */
export function planRemoveSpring(rivers: Rivers, x: number, y: number): SpringRemovePlan {
  if (rivers.isNaturalSite(x, y) && !rivers.isPlacedSpring(x, y)) return { ok: false, reason: 'Natural springs stay', refund: 0 };
  if (!rivers.isPlacedSpring(x, y)) return { ok: false, reason: 'No spring here', refund: 0 };
  if (rivers.rivers.some((r) => r.source.kind === 'spring' && r.source.x === x && r.source.y === y)) return { ok: false, reason: 'A river starts at this spring: fill the river in first', refund: 0 };
  return { ok: true, refund: 0 };
}
export function applyRemoveSpring(env: SpringEnv, rivers: Rivers, x: number, y: number): boolean {
  if (!planRemoveSpring(rivers, x, y).ok) return false;
  env.grid.occupancy.flags[env.grid.tileIndex(x, y)]! &= ~OccFlag.Decor & 0xff;
  rivers.removeSpring(x, y);
  return true;
}
