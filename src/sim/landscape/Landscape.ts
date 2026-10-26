import { Rng } from '../../core/Rng';
import { CHUNK_SIZE, TileType, isWaterType, type Grid } from '../../world/Grid';
import { OccFlag } from '../../world/Occupancy';
import { PropKind, VEGETATION_KINDS, type PropStore } from '../../world/Props';
import { setCorners, type CornerChange } from '../../world/Terraform';
import { TERRAFORM_COST_PER_HALF_STEP } from '../../config/balance';
import { DECOR, DECOR_IDS, LANDSCAPE, type DecorKind } from '../../config/landscape';
import type { UnlockGate } from '../../config/unlocks';

/**
 * Landscaping rules (pure sim: no three / DOM). Ponds, boulders and garden decor are planned by pure `plan*` functions (grid untouched) and committed
 * by `apply*`; the build tools, undo and the tests all go through the same functions. Everything is deterministic (no wall clock, seeded hashes only).
 *
 * Water model: a pond is a flat water surface at `level` over the footprint tiles (`TileType.Water` + `OccFlag.Water`), a basin dug by `setCorners` and a
 * bank raised to at least `level` all around (the `lakesValid` invariant of the terrain generator: water tiles have all corners <= level, every non-water
 * neighbour has all corners >= level). Natural lakes / streams are never touched. The renderer draws `ponds` through the same Water mesh as natural lakes.
 */
export interface PondRec { id: number; cx: number; cy: number; radius: number; level: number; tiles: number; tileIdx: number[] }
export interface DecorRec { kind: DecorKind; x: number; y: number; rot: 0 | 1 }
export interface TileRect { x0: number; y0: number; x1: number; y1: number }

/** What the rules need to know about the world around the grid. All optional hooks default to "nothing there". */
export interface LandscapeEnv {
  grid: Grid;
  props: PropStore;
  seed: number;
  /** Footpath / road / rail / piste / trail layers on the tile (from Networks). */
  netAt?: (i: number) => number;
  /** Ski piste on the tile (guests ski here: keep ponds away). */
  isPiste?: (i: number) => boolean;
  /** Career gate (`gate.locked('landscape','pond')`). */
  gate?: UnlockGate;
  /** Lift cable clearance: lifts whose clearance the heights change would violate. */
  liftClearanceViolations?: (changed: CornerChange[]) => number;
  /** A building that needs this water (beach, boat rental) stands next to these tiles: filling would break it. */
  waterDependent?: (tileIdx: readonly number[]) => string | null;
  multiplier?: () => number;
}

const mult = (e: LandscapeEnv): number => e.multiplier?.() ?? 1;
const hash = (a: number, b: number, c: number, d: number): number => (Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663) ^ Math.imul(c | 0, 83492791) ^ Math.imul(d | 0, 2654435761)) >>> 0;
const tidx = (g: Grid, x: number, y: number): number => y * g.size + x;

export class Landscape {
  ponds: PondRec[] = [];
  decor = new Map<number, DecorRec>();
  /** Bumped by every change (renderers rebuild water / decor when it moves). */
  version = 0;
  private nextId = 1;
  private listeners: Array<() => void> = [];
  constructor(readonly grid: Grid) {}

  onChange(fn: () => void): void { this.listeners.push(fn); }
  changed(): void { this.version++; for (const l of this.listeners) l(); }

  pondAt(tile: number): PondRec | undefined { return this.ponds.find((p) => p.tileIdx.includes(tile)); }
  /** All tiles of player-made ponds. */
  pondTiles(): number[] { return this.ponds.flatMap((p) => p.tileIdx); }

  addPond(p: Omit<PondRec, 'id'>): PondRec { const r = { ...p, id: this.nextId++ }; this.ponds.push(r); this.changed(); return r; }
  removePond(id: number): void { this.ponds = this.ponds.filter((p) => p.id !== id); this.changed(); }
  setDecor(r: DecorRec): void { const i = r.y * this.grid.size + r.x; this.decor.set(i, r); this.grid.occupancy.flags[i]! |= OccFlag.Decor; this.changed(); }
  clearDecor(x: number, y: number): boolean {
    const i = y * this.grid.size + x;
    if (!this.decor.delete(i)) return false;
    this.grid.occupancy.flags[i]! &= ~OccFlag.Decor & 0xff;
    this.changed();
    return true;
  }

  serialize(): { ponds: PondRec[]; decor: Array<[number, number, number, number]>; nextId: number } {
    const order = (k: DecorKind): number => DECOR_IDS.indexOf(k);
    return {
      ponds: this.ponds.map((p) => ({ ...p, tileIdx: [...p.tileIdx] })),
      decor: [...this.decor.values()].sort((a, b) => a.y * this.grid.size + a.x - (b.y * this.grid.size + b.x)).map((d) => [d.x, d.y, order(d.kind), d.rot]),
      nextId: this.nextId,
    };
  }
  load(d: unknown): void {
    const o = (d ?? {}) as { ponds?: PondRec[]; decor?: Array<[number, number, number, number]>; nextId?: number };
    this.ponds = (o.ponds ?? []).map((p) => ({ ...p, tileIdx: [...p.tileIdx] }));
    this.decor.clear();
    for (const [x, y, k, rot] of o.decor ?? []) { const kind = DECOR_IDS[k]; if (kind) this.decor.set(y * this.grid.size + x, { kind, x, y, rot: rot ? 1 : 0 }); }
    this.nextId = o.nextId ?? this.ponds.reduce((m, p) => Math.max(m, p.id), 0) + 1;
    this.changed();
  }
  reset(): void { this.load(null); }
}

// ---------------------------------------------------------------------------------------------------------------- ponds

export interface PondPlan {
  ok: boolean;
  /** Plain-language refusal reason when !ok. */
  reason?: string;
  tileIdx: number[];
  level: number;
  cost: number;
  earthCost: number;
  changed: CornerChange[];
  rect: TileRect;
}

const fail = (reason: string, rect: TileRect, tileIdx: number[] = []): PondPlan => ({ ok: false, reason, tileIdx, level: 0, cost: 0, earthCost: 0, changed: [], rect });

/** Clamp a drag to the allowed extent (min 3, max 11 tiles each way). */
export function clampPondRect(r: TileRect): TileRect {
  const { minExtent, maxExtent } = LANDSCAPE.pond;
  let { x0, y0, x1, y1 } = { x0: Math.min(r.x0, r.x1), y0: Math.min(r.y0, r.y1), x1: Math.max(r.x0, r.x1), y1: Math.max(r.y0, r.y1) };
  if (x1 - x0 + 1 > maxExtent) { if (r.x1 >= r.x0) x1 = x0 + maxExtent - 1; else x0 = x1 - maxExtent + 1; }
  if (y1 - y0 + 1 > maxExtent) { if (r.y1 >= r.y0) y1 = y0 + maxExtent - 1; else y0 = y1 - maxExtent + 1; }
  while (x1 - x0 + 1 < minExtent) { x1++; if (x1 - x0 + 1 < minExtent) x0--; }
  while (y1 - y0 + 1 < minExtent) { y1++; if (y1 - y0 + 1 < minExtent) y0--; }
  return { x0, y0, x1, y1 };
}

/** A square brush click -> the footprint rect (odd extent centred on the tile). */
export function pondRectAround(cx: number, cy: number, extent: number): TileRect {
  const e = Math.max(LANDSCAPE.pond.minExtent, Math.min(LANDSCAPE.pond.maxExtent, extent)), lo = Math.floor((e - 1) / 2);
  return { x0: cx - lo, y0: cy - lo, x1: cx - lo + e - 1, y1: cy - lo + e - 1 };
}

/** Organic footprint: an ellipse inscribed in the rect with a deterministic wobble (same rect -> same pond). */
export function pondFootprint(g: Grid, rect: TileRect): number[] {
  const w = rect.x1 - rect.x0 + 1, h = rect.y1 - rect.y0 + 1, cx = rect.x0 + w / 2, cy = rect.y0 + h / 2;
  const ph1 = (hash(rect.x0, rect.y0, w, h) % 628) / 100, ph2 = (hash(rect.y0, rect.x0, h, w) % 628) / 100;
  const out: number[] = [];
  for (let y = rect.y0; y <= rect.y1; y++) for (let x = rect.x0; x <= rect.x1; x++) {
    const dx = (x + 0.5 - cx) / (w / 2), dy = (y + 0.5 - cy) / (h / 2), a = Math.atan2(dy, dx);
    const r = 1 + 0.1 * Math.sin(3 * a + ph1) + 0.07 * Math.sin(5 * a + ph2);
    if (dx * dx + dy * dy <= r * r && g.inBounds(x, y)) out.push(tidx(g, x, y));
  }
  return out;
}

/** Every non-water neighbour of a water tile has all corners >= level; every water tile has all corners <= level (the generator's `lakesValid`, restricted to one pond). */
export function pondValid(g: Grid, level: number, tileIdx: readonly number[]): boolean {
  const N = g.size, set = new Set(tileIdx);
  for (const ti of tileIdx) {
    const x = ti % N, y = (ti - x) / N;
    if (Math.max(...g.getCorners(x, y)) > level) return false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (!g.inBounds(nx, ny) || set.has(ny * N + nx)) continue;
      if (Math.min(...g.getCorners(nx, ny)) < level) return false;
    }
  }
  return true;
}

function pondTargets(g: Grid, fp: readonly number[]): { level: number; targets: Map<number, number>; spread: number } {
  const N = g.size, V = g.vsize, inF = new Set(fp);
  const v0 = new Set<number>();
  for (const ti of fp) { const x = ti % N, y = (ti - x) / N; for (let k = 0; k < 4; k++) v0.add((y + (k >> 1)) * V + x + (k & 1)); }
  const hs = [...v0].map((v) => g.heights[v]!).sort((a, b) => a - b);
  const level = hs[hs.length >> 1]!;
  const spread = hs[hs.length - 1]! - hs[0]!;
  const tileIn = (x: number, y: number): boolean => g.inBounds(x, y) && inF.has(y * N + x);
  const bed = new Map<number, number>(), q: number[] = [];
  for (const v of v0) { const vx = v % V, vy = (v - vx) / V; if (!(tileIn(vx - 1, vy - 1) && tileIn(vx, vy - 1) && tileIn(vx - 1, vy) && tileIn(vx, vy))) { bed.set(v, 0); q.push(v); } }
  for (let h = 0; h < q.length; h++) {
    const v = q[h]!, vx = v % V, vy = (v - vx) / V;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) { const n = (vy + dy) * V + vx + dx; if (v0.has(n) && !bed.has(n)) { bed.set(n, bed.get(v)! + 1); q.push(n); } }
  }
  const targets = new Map<number, number>();
  for (const v of v0) targets.set(v, level - Math.min(2, bed.get(v) ?? 0));
  // two rings of bank around the basin: d=1 -> [level, level+1], d=2 -> [level-1, level+2]
  let frontier = [...v0];
  const seen = new Set(v0);
  for (let d = 1; d <= 2; d++) {
    const next: number[] = [];
    for (const v of frontier) {
      const vx = v % V, vy = (v - vx) / V;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = vx + dx, ny = vy + dy;
        if (nx < 0 || ny < 0 || nx >= V || ny >= V) continue;
        const n = ny * V + nx;
        if (seen.has(n)) continue;
        seen.add(n); next.push(n);
        const cur = g.heights[n]!, lo = level - (d - 1), hi = level + d;
        targets.set(n, Math.min(hi, Math.max(lo, cur)));
      }
    }
    frontier = next;
  }
  return { level, targets, spread };
}

/** Plan a pond for a footprint rect (pure: the grid is unchanged on return). */
export function planPond(env: LandscapeEnv, rect0: TileRect): PondPlan {
  const g = env.grid, P = LANDSCAPE.pond, N = g.size;
  const rect = clampPondRect(rect0);
  const lock = env.gate?.locked('landscape', P.unlockId);
  if (lock) return fail(lock, rect);
  const fp = pondFootprint(g, rect);
  if (fp.length < 8) return fail('Too small: a pond needs at least about 3×3 tiles', rect, fp);
  if (rect.x0 - P.edgeMargin < 0 || rect.y0 - P.edgeMargin < 0 || rect.x1 + P.edgeMargin >= N || rect.y1 + P.edgeMargin >= N) return fail('Too close to the map edge', rect, fp);
  // distance (Chebyshev tiles) from the footprint
  const dist = new Map<number, number>(), q: number[] = [];
  for (const t of fp) { dist.set(t, 0); q.push(t); }
  const reach = Math.max(P.waterGap, P.buildingGap, P.pisteGap, P.liftGap);
  for (let h = 0; h < q.length; h++) {
    const t = q[h]!, d = dist.get(t)!;
    if (d >= reach) continue;
    const x = t % N, y = (t - x) / N;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if (!g.inBounds(nx, ny)) continue; const n = ny * N + nx; if (!dist.has(n)) { dist.set(n, d + 1); q.push(n); } }
  }
  let rock = false, occupied = false, building = false, piste = false, lift = false, water = false, steep = false;
  for (const [t, d] of dist) {
    const f = g.occupancy.flags[t]!, tt = g.tileType[t]!, net = env.netAt?.(t) ?? 0;
    if (d <= P.waterGap && (isWaterType(tt) || tt === TileType.Ice || (f & OccFlag.Water))) water = true;
    if (d === 0) {
      if (tt === TileType.Rock) rock = true;
      const x = t % N, y = (t - x) / N;
      if (g.steepness(x, y) > P.maxSlope) steep = true;
    }
    if (d <= 1 && ((f & ~OccFlag.Water & 0xff) !== 0 || net !== 0)) occupied = true;
    if (d <= P.buildingGap && (f & OccFlag.Building)) building = true;
    if (d <= P.pisteGap && ((f & OccFlag.Piste) || env.isPiste?.(t))) piste = true;
    if (d <= P.liftGap && (f & OccFlag.Lift)) lift = true;
  }
  if (water) return fail(`Too close to other water: keep ${P.waterGap} tiles clear`, rect, fp);
  if (building) return fail('Too close to a building: keep ponds away from the village', rect, fp);
  if (piste) return fail('Too close to a piste: skiers would end up in the water', rect, fp);
  if (lift) return fail('Too close to a lift line', rect, fp);
  if (occupied) return fail('A path, road, rail or garden decor is in the way', rect, fp);
  if (rock) return fail('Bare rock: you cannot dig a pond here', rect, fp);
  const { level, targets, spread } = pondTargets(g, fp);
  if (spread > P.maxSpread) return fail(`Too steep for a pond: needs nearly level ground (this spot varies by ${spread} half-steps, max ${P.maxSpread})`, rect, fp);
  if (steep) return fail('Too steep for a pond: the ground slopes too much here, try a flatter bench or a smaller pond', rect, fp);
  const res = setCorners(g, targets, { commit: false, maxEdgeDelta: 2, liftClearanceViolations: env.liftClearanceViolations });
  if (!res.ok) {
    return fail(res.reason === 'lift clearance' ? 'Digging here would break a lift cable clearance' : res.reason === 'water' ? 'Too close to other water' : res.reason === 'nochange' ? 'Nothing to dig' : 'Too close to a building, path or piste to reshape the ground', rect, fp);
  }
  // the ground must satisfy the lake invariant AFTER the earthworks (edge-delta propagation can undo a bank): check on the real heights, then roll back
  for (const c of res.changed) g.setCornerUnchecked(c.vx, c.vy, c.to);
  const ok = pondValid(g, level, fp);
  for (const c of res.changed) g.setCornerUnchecked(c.vx, c.vy, c.from);
  if (!ok) return fail('The ground around is too uneven for a pond: try a flatter spot or a smaller pond', rect, fp);
  const m = mult(env), earthCost = Math.round(res.halfSteps * TERRAFORM_COST_PER_HALF_STEP * m);
  return { ok: true, tileIdx: fp, level, changed: res.changed, earthCost, cost: earthCost + Math.round(fp.length * P.costPerTile * m), rect };
}

/** Commit a planned pond: dig, bank, fill, clear props. Returns the touched prop chunks. The plan must come from `planPond` on the same state. */
export function applyPond(env: LandscapeEnv, ls: Landscape, plan: PondPlan): { ok: boolean; touchedChunks: number[] } {
  if (!plan.ok) return { ok: false, touchedChunks: [] };
  const g = env.grid, N = g.size;
  const { targets } = pondTargets(g, plan.tileIdx);
  const felled = env.props.treesFelled; // sustainability stays neutral: trees cleared for a pond are not 'felled'
  const res = setCorners(g, targets, { commit: true, maxEdgeDelta: 2, props: env.props, liftClearanceViolations: env.liftClearanceViolations });
  if (!res.ok) { env.props.treesFelled = felled; return { ok: false, touchedChunks: [] }; }
  const touched = new Set<number>(res.touchedChunks);
  for (const t of plan.tileIdx) {
    const x = t % N, y = (t - x) / N, tc: number[] = [];
    env.props.removeInRect(x, y, x, y, tc);
    for (const c of tc) touched.add(c);
    g.tileType[t] = TileType.Water;
    g.occupancy.flags[t]! |= OccFlag.Water;
    g.snowDepth[t] = 0;
    g.markDirty(x, y);
  }
  env.props.treesFelled = felled;
  const xs = plan.tileIdx.map((t) => t % N), ys = plan.tileIdx.map((t) => (t / N) | 0);
  ls.addPond({ cx: xs.reduce((a, b) => a + b, 0) / xs.length, cy: ys.reduce((a, b) => a + b, 0) / ys.length, radius: Math.max(plan.rect.x1 - plan.rect.x0 + 1, plan.rect.y1 - plan.rect.y0 + 1) / 2, level: plan.level, tiles: plan.tileIdx.length, tileIdx: plan.tileIdx });
  return { ok: true, touchedChunks: [...touched] };
}

export interface FillPlan { ok: boolean; reason?: string; pond?: PondRec; cost: number }

export function planFill(env: LandscapeEnv, ls: Landscape, tx: number, ty: number): FillPlan {
  const g = env.grid;
  if (!g.inBounds(tx, ty)) return { ok: false, reason: 'Out of bounds', cost: 0 };
  const i = tidx(g, tx, ty), pond = ls.pondAt(i);
  if (!pond) return { ok: false, reason: isWaterType(g.tileType[i]!) ? 'Natural lakes and streams stay: only ponds you dug can be filled in' : 'No pond here', cost: 0 };
  const dep = env.waterDependent?.(pond.tileIdx);
  if (dep) return { ok: false, reason: `${dep} needs this water: bulldoze it first`, pond, cost: 0 };
  return { ok: true, pond, cost: Math.round(pond.tileIdx.length * LANDSCAPE.pond.fillCostPerTile * mult(env)) };
}

/** Fill a pond back in to ground level (the basin is raised to the old water level). */
export function applyFill(env: LandscapeEnv, ls: Landscape, plan: FillPlan): { ok: boolean; touchedChunks: number[] } {
  if (!plan.ok || !plan.pond) return { ok: false, touchedChunks: [] };
  const g = env.grid, N = g.size, p = plan.pond;
  for (const t of p.tileIdx) { g.tileType[t] = TileType.Grass; g.occupancy.flags[t]! &= ~OccFlag.Water & 0xff; }
  const targets = new Map<number, number>();
  for (const t of p.tileIdx) { const x = t % N, y = (t - x) / N; for (let k = 0; k < 4; k++) { const v = (y + (k >> 1)) * g.vsize + x + (k & 1); if (g.heights[v]! < p.level) targets.set(v, p.level); } }
  const res = targets.size ? setCorners(g, targets, { commit: true, maxEdgeDelta: 2, props: env.props }) : { ok: true, touchedChunks: [] as number[] };
  if (!res.ok) { // could not re-level (something grew around the basin): put the water back
    for (const t of p.tileIdx) { g.tileType[t] = TileType.Water; g.occupancy.flags[t]! |= OccFlag.Water; }
    return { ok: false, touchedChunks: [] };
  }
  for (const t of p.tileIdx) { g.snowDepth[t] = 0; g.markDirty(t % N, (t / N) | 0); }
  ls.removePond(p.id);
  return { ok: true, touchedChunks: res.touchedChunks };
}

// -------------------------------------------------------------------------------------------------------------- boulders

export interface RockPlan { rocks: Array<{ tx: number; ty: number; ox: number; oy: number; scale: number; rot: number; seed: number }>; cost: number; rejected: number }

function tileReject(env: LandscapeEnv, x: number, y: number, maxSlope: number, margin: number): string | null {
  const g = env.grid, N = g.size;
  if (x < margin || y < margin || x >= N - margin || y >= N - margin) return 'edge';
  const i = tidx(g, x, y), t = g.tileType[i]!;
  if (isWaterType(t) || t === TileType.Ice) return 'water';
  if (g.steepness(x, y) > maxSlope) return 'steep';
  if (g.occupancy.flags[i] !== 0 || (env.netAt?.(i) ?? 0) !== 0) return 'occupied';
  return null;
}

const disc = (cx: number, cy: number, brush: number): Array<[number, number]> => {
  const r = Math.max(1, brush) - 1, out: Array<[number, number]> = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + 0.5) out.push([cx + dx, cy + dy]);
  return out;
};

const isRock = (k: number): boolean => k === PropKind.Rock;

export function planRocks(env: LandscapeEnv, cx: number, cy: number, brush: number, now: number): RockPlan {
  const R = LANDSCAPE.rock, plan: RockPlan = { rocks: [], cost: 0, rejected: 0 };
  const b = Math.min(R.maxBrush, brush);
  for (const [x, y] of disc(cx, cy, b)) {
    if (tileReject(env, x, y, R.maxSlope, 1) !== null) { plan.rejected++; continue; }
    const rng = new Rng(hash(env.seed, x, y, now) ^ 0x70c4);
    const have = env.props.countInRect(x, y, x, y, isRock);
    const want = Math.min(R.maxPerTile - have, rng.next() < 0.55 ? 1 : 0) + (rng.next() < 0.15 && have === 0 ? 1 : 0);
    for (let k = 0; k < want && have + k < R.maxPerTile; k++) {
      plan.rocks.push({ tx: x, ty: y, ox: 0.15 + rng.next() * 0.7, oy: 0.15 + rng.next() * 0.7, scale: 0.7 + rng.next() * 0.7, rot: rng.next() * Math.PI * 2, seed: (rng.next() * 256) | 0 });
      plan.cost += R.cost;
    }
  }
  plan.cost = Math.round(plan.cost * mult(env));
  return plan;
}

export function applyRocks(props: PropStore, plan: RockPlan): number[] {
  const touched = new Set<number>();
  for (const r of plan.rocks) { props.add(PropKind.Rock, r.tx, r.ty, r.ox, r.oy, r.scale, r.rot, r.seed, -1); touched.add(Math.floor(r.ty / CHUNK_SIZE) * props.chunksPerRow + Math.floor(r.tx / CHUNK_SIZE)); }
  return [...touched];
}

export function planRockRemoval(env: LandscapeEnv, cx: number, cy: number, brush: number): { count: number; cost: number } {
  let count = 0;
  for (const [x, y] of disc(cx, cy, Math.min(LANDSCAPE.rock.maxBrush, brush))) if (env.grid.inBounds(x, y)) count += env.props.countInRect(x, y, x, y, isRock);
  return { count, cost: Math.round(count * LANDSCAPE.rock.removeCost * mult(env)) };
}

export function applyRockRemoval(env: LandscapeEnv, cx: number, cy: number, brush: number): number[] {
  const touched: number[] = [];
  for (const [x, y] of disc(cx, cy, Math.min(LANDSCAPE.rock.maxBrush, brush))) if (env.grid.inBounds(x, y)) env.props.removeInRect(x, y, x, y, touched, isRock);
  return [...new Set(touched)];
}

// ---------------------------------------------------------------------------------------------------------------- decor

export interface DecorPlan { ok: boolean; reason?: string; cost: number }

export function planDecor(env: LandscapeEnv, x: number, y: number, kind: DecorKind): DecorPlan {
  const g = env.grid;
  if (!g.inBounds(x, y)) return { ok: false, reason: 'Out of bounds', cost: 0 };
  const why = tileReject(env, x, y, LANDSCAPE.decor.maxSlope, LANDSCAPE.decor.edgeMargin);
  if (why === 'edge') return { ok: false, reason: 'Too close to the map edge', cost: 0 };
  if (why === 'water') return { ok: false, reason: 'Water: decor stays on dry ground', cost: 0 };
  if (why === 'steep') return { ok: false, reason: 'Too steep for decor', cost: 0 };
  if (why === 'occupied') return { ok: false, reason: g.occupancy.flags[tidx(g, x, y)]! & OccFlag.Decor ? 'There is already decor here' : 'A building, path, road, piste or lift is in the way', cost: 0 };
  if (g.tileType[tidx(g, x, y)] === TileType.Rock) return { ok: false, reason: 'Bare rock', cost: 0 };
  if (env.props.countInRect(x, y, x, y, (k) => k === PropKind.Rock || VEGETATION_KINDS.includes(k)) > 0) return { ok: false, reason: 'Clear the trees or rocks on this tile first', cost: 0 };
  return { ok: true, cost: Math.round(DECOR[kind].cost * mult(env)) };
}

export function applyDecor(ls: Landscape, x: number, y: number, kind: DecorKind, rot: 0 | 1): void { ls.setDecor({ kind, x, y, rot }); }

/** Decor on a tile may be removed for free (there is no refund, it is garden furniture). */
export function planDecorRemoval(ls: Landscape, x: number, y: number): boolean { return ls.decor.has(y * ls.grid.size + x); }

