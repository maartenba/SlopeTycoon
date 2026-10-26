import { Rng } from '../../core/Rng';
import { CHUNK_SIZE, TileType, isWaterType, type Grid } from '../../world/Grid';
import { PropKind, TREE_KINDS, TREE_MAX_STEEPNESS, VEGETATION_KINDS, growthFactor, type PropStore } from '../../world/Props';

/** Tree planting / clearing rules (pure over a PlantEnv; the PlantTool + tests use the same functions). */
export type PlantGroup = 'conifer' | 'deciduous' | 'birch' | 'shrub';

export const PLANT_GROUPS: Record<PlantGroup, { label: string; kinds: Array<[number, number]> }> = {
  conifer: { label: 'Conifer mix', kinds: [[PropKind.Conifer, 0.5], [PropKind.Pine, 0.3], [PropKind.Larch, 0.2]] },
  deciduous: { label: 'Deciduous mix', kinds: [[PropKind.Deciduous, 0.5], [PropKind.Oak, 0.3], [PropKind.Birch, 0.2]] },
  birch: { label: 'Birch grove', kinds: [[PropKind.Birch, 1]] },
  shrub: { label: 'Shrubs & meadow scrub', kinds: [[PropKind.Shrub, 1]] },
};
export const PLANT_GROUP_IDS = Object.keys(PLANT_GROUPS) as PlantGroup[];

export const PLANT = {
  /** Cost per planted tree, per cleared tree; timber revenue per cleared mature tree. */
  costPerTree: 12, shrubCost: 4, clearCost: 6, timberRevenue: 5,
  maxPerTile: 4, minSpacing: 0.42, maxBrush: 5,
  /** Relief fraction above which nothing is planted (tree line). */
  treeLine: 0.88,
} as const;

export interface PlantEnv {
  grid: Grid;
  props: PropStore;
  /** True when the tile is occupied by a building/lift/path/road/rail/piste/trail layer (or otherwise forbidden). */
  blocked: (i: number) => boolean;
  seed: number;
  /** Lift corridor rule: true when a tree of this kind/scale (fully grown) planted at (px, py) would reach a lift carrier. See sim/Lift liftPlantBlocker. */
  liftBlocks?: (px: number, py: number, kind: number, scale: number) => boolean;
}

export type PlantReject = 'edge' | 'water' | 'rock' | 'steep' | 'occupied' | 'treeline' | null;

/** Why a tile cannot take trees (null = plantable). */
export function plantReject(env: PlantEnv, x: number, y: number): PlantReject {
  const g = env.grid, N = g.size;
  if (x < 1 || y < 1 || x >= N - 1 || y >= N - 1) return 'edge';
  const i = y * N + x, t = g.tileType[i]!;
  if (isWaterType(t) || t === TileType.Ice) return 'water';
  if (t === TileType.Rock) return 'rock';
  if (g.steepness(x, y) > TREE_MAX_STEEPNESS) return 'steep';
  if (env.blocked(i) || g.occupancy.flags[i] !== 0) return 'occupied';
  const [n, e, s, w] = g.getCorners(x, y);
  if (((n + e + s + w) / 4 - 8) / (80 * Math.sqrt(N / 128)) > PLANT.treeLine) return 'treeline';
  return null;
}

export interface PlannedTree { kind: number; tx: number; ty: number; ox: number; oy: number; scale: number; rot: number; seed: number }
export interface PlantPlan { trees: PlannedTree[]; cost: number; tiles: number; rejected: number; /** Trees skipped because they would grow into a lift cable. */ liftBlocked?: number }

const hash = (a: number, b: number, c: number, d: number): number => (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791) ^ Math.imul(d, 2654435761)) >>> 0;
const pickKind = (group: PlantGroup, r: number): number => {
  let t = r;
  for (const [k, w] of PLANT_GROUPS[group].kinds) { t -= w; if (t < 0) return k; }
  return PLANT_GROUPS[group].kinds[0]![0];
};
const scaleOf = (k: number): number => (k === PropKind.Shrub ? 0.6 : 1);

/** Tiles of a square-ish brush (radius in tiles; 1 = single tile). */
export function brushTiles(cx: number, cy: number, brush: number): Array<[number, number]> {
  const r = Math.max(1, Math.min(PLANT.maxBrush, brush)) - 1, out: Array<[number, number]> = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + 0.5) out.push([cx + dx, cy + dy]);
  return out;
}

/** Plan trees for a brush stamp: deterministic in (seed, tile, day, group). Respects slope/water/rock/occupied/min spacing. */
export function planPlanting(env: PlantEnv, cx: number, cy: number, brush: number, group: PlantGroup, density: number, now: number): PlantPlan {
  const plan: PlantPlan = { trees: [], cost: 0, tiles: 0, rejected: 0 };
  const per = PLANT.costPerTree * (group === 'shrub' ? PLANT.shrubCost / PLANT.costPerTree : 1);
  const d = Math.min(1, Math.max(0.1, density));
  for (const [x, y] of brushTiles(cx, cy, brush)) {
    if (plantReject(env, x, y) !== null) { plan.rejected++; continue; }
    // existing props on this tile + neighbours for spacing
    const near: Array<[number, number]> = [];
    const ci = Math.floor(x / CHUNK_SIZE) + Math.floor(y / CHUNK_SIZE) * env.props.chunksPerRow;
    const chunk = env.props.chunks[ci]!;
    for (let i = 0; i < chunk.kind.length; i++) if (Math.abs(chunk.tx[i]! - x) <= 1 && Math.abs(chunk.ty[i]! - y) <= 1) near.push([chunk.tx[i]! + chunk.ox[i]!, chunk.ty[i]! + chunk.oy[i]!]);
    let onTile = 0;
    for (const [px, py] of near) if (Math.floor(px) === x && Math.floor(py) === y) onTile++;
    const rng = new Rng(hash(env.seed | 0, x, y, now) ^ group.length);
    const want = Math.min(PLANT.maxPerTile - onTile, Math.floor(d * 3 + rng.next()));
    let placed = 0;
    for (let k = 0; k < want * 3 && placed < want; k++) {
      const ox = 0.1 + rng.next() * 0.8, oy = 0.1 + rng.next() * 0.8, px = x + ox, py = y + oy;
      let ok = true;
      for (const [qx, qy] of near) if (Math.hypot(qx - px, qy - py) < PLANT.minSpacing) { ok = false; break; }
      for (const t of plan.trees) if (Math.hypot(t.tx + t.ox - px, t.ty + t.oy - py) < PLANT.minSpacing) { ok = false; break; }
      if (!ok) continue;
      const kind = pickKind(group, rng.next());
      const scale = (0.8 + rng.next() * 0.5) * scaleOf(kind);
      if (env.liftBlocks?.(px, py, kind, scale)) { plan.liftBlocked = (plan.liftBlocked ?? 0) + 1; continue; }
      plan.trees.push({ kind, tx: x, ty: y, ox, oy, scale, rot: rng.next() * Math.PI * 2, seed: (rng.next() * 256) | 0 });
      plan.cost += per; placed++;
    }
    if (placed > 0) plan.tiles++;
  }
  return plan;
}

/** Insert a plan into the store as saplings (born = now). Returns touched chunk indices. */
export function applyPlanting(props: PropStore, plan: PlantPlan, now: number): number[] {
  const touched = new Set<number>();
  for (const t of plan.trees) {
    props.add(t.kind, t.tx, t.ty, t.ox, t.oy, t.scale, t.rot, t.seed, now);
    touched.add(Math.floor(t.ty / CHUNK_SIZE) * props.chunksPerRow + Math.floor(t.tx / CHUNK_SIZE));
  }
  return [...touched];
}

export interface ClearPlan { count: number; mature: number; cost: number; revenue: number }

/** Count what a clear stamp would remove (vegetation only; rocks stay). Cost per tree, timber revenue for mature ones. */
export function planClearing(props: PropStore, cx: number, cy: number, brush: number, now: number): ClearPlan {
  const r = Math.max(1, Math.min(PLANT.maxBrush, brush)) - 1, out: ClearPlan = { count: 0, mature: 0, cost: 0, revenue: 0 };
  const veg = new Set(VEGETATION_KINDS);
  const cr = r * r + 0.5;
  for (let ty = cy - r; ty <= cy + r; ty++) for (let tx = cx - r; tx <= cx + r; tx++) {
    if ((tx - cx) ** 2 + (ty - cy) ** 2 > cr || tx < 0 || ty < 0 || tx >= props.grid.size || ty >= props.grid.size) continue;
    const c = props.propsInChunk(Math.floor(tx / CHUNK_SIZE), Math.floor(ty / CHUNK_SIZE));
    for (let i = 0; i < c.kind.length; i++) if (c.tx[i] === tx && c.ty[i] === ty && veg.has(c.kind[i]!)) {
      out.count++;
      if (growthFactor(c.born[i]!, now) >= 0.99 && (TREE_KINDS as readonly number[]).includes(c.kind[i]!)) out.mature++;
    }
  }
  out.cost = out.count * PLANT.clearCost;
  out.revenue = out.mature * PLANT.timberRevenue;
  return out;
}

/** Remove the vegetation of a clear stamp. Returns touched chunks. */
export function applyClearing(props: PropStore, cx: number, cy: number, brush: number): number[] {
  const r = Math.max(1, Math.min(PLANT.maxBrush, brush)) - 1, touched: number[] = [], veg = new Set(VEGETATION_KINDS);
  for (const [x, y] of brushTiles(cx, cy, brush)) props.removeInRect(x, y, x, y, touched, (k) => veg.has(k));
  void r;
  return [...new Set(touched)];
}

/** Forest cover per tile (growth-weighted tree count) and its 3x3-smoothed avalanche protection 0..1. */
export class ForestCover {
  readonly cover: Float32Array;
  readonly protection: Float32Array;
  dirty = true;
  constructor(private props: PropStore) {
    const n = props.grid.size ** 2;
    this.cover = new Float32Array(n); this.protection = new Float32Array(n);
  }
  rebuild(): void {
    const N = this.props.grid.size, cov = this.cover, now = this.props.now;
    cov.fill(0);
    const tree = new Set<number>(TREE_KINDS);
    for (const c of this.props.chunks) for (let i = 0; i < c.kind.length; i++) if (tree.has(c.kind[i]!)) cov[c.ty[i]! * N + c.tx[i]!]! += growthFactor(c.born[i]!, now);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= N) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx >= 0 && xx < N) s += cov[yy * N + xx]!; } }
      this.protection[y * N + x] = Math.min(1, s / 9 / 2.5);
    }
    this.dirty = false;
  }
  /** Share of land tiles that carry trees (scenery input), 0..1. */
  treeShare(): number {
    let t = 0; for (const v of this.cover) if (v > 0.5) t++;
    return t / this.cover.length;
  }
}

/** Tracks chunks that hold growing saplings and asks the renderer to refresh them every `refreshDays` days. */
export class GrowthTracker {
  private chunks = new Set<number>();
  private lastRefresh = -1e9;
  constructor(private props: PropStore, private refreshDays = 5) {}
  track(chunks: number[]): void { for (const c of chunks) this.chunks.add(c); }
  /** Rescan the store for growing props (after load / worldgen). */
  scan(): void {
    this.chunks.clear();
    this.props.chunks.forEach((c, ci) => { if (c.born.some((b) => b >= 0)) this.chunks.add(ci); });
  }
  /** Returns chunk indices to refresh (empty most days). Chunks whose props are all mature are dropped. */
  update(now: number): number[] {
    this.props.now = now;
    if (now - this.lastRefresh < this.refreshDays || this.chunks.size === 0) return [];
    this.lastRefresh = now;
    const out: number[] = [];
    for (const ci of [...this.chunks]) {
      const c = this.props.chunks[ci]!;
      let growing = false;
      for (const b of c.born) if (b >= 0 && growthFactor(b, now) < 1) { growing = true; break; }
      out.push(ci); // one last refresh when finished growing
      if (!growing) this.chunks.delete(ci);
    }
    return out;
  }
  get tracked(): number { return this.chunks.size; }
  serialize(): { last: number } { return { last: this.lastRefresh }; }
  load(d: { last: number } | undefined): void { this.lastRefresh = d?.last ?? -1e9; this.scan(); }
}
