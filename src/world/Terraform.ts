import { MAX_TILE_DELTA, isWaterType, type Grid } from './Grid';
import type { PropStore } from './Props';
import {
  TERRAFORM_COST_PER_HALF_STEP, TERRAFORM_DEFAULT_MAX_EDGE_DELTA, TERRAFORM_FALLOFF_PEAK, TERRAFORM_MAX_HEIGHT,
} from '@/config/balance';

export interface CornerChange {
  vx: number;
  vy: number;
  from: number;
  to: number;
}

export interface TerraformResult {
  ok: boolean;
  /** Reason when !ok: 'occupied' | 'water' | 'nochange'. */
  reason?: 'occupied' | 'water' | 'nochange' | 'lift clearance';
  changed: CornerChange[];
  /** Σ|Δh| (half-steps). */
  halfSteps: number;
  cost: number;
  removedProps: number;
  /** Prop chunk indices touched by prop removal. */
  touchedChunks: number[];
}

export interface TerraformOptions {
  /** Cost multiplier hook (Season supplies e.g. 0.5 in summer). Default 1. */
  constructionMultiplier?: () => number;
  /** If false, compute result then roll back (preview). Default true. */
  commit?: boolean;
  props?: PropStore;
  /** Max height difference between adjacent vertices: 1 gentle (default), 2 steep. */
  maxEdgeDelta?: 1 | 2;
  /** Raise/lower: smooth falloff over rects wider than one tile (rounded hills). Default false. */
  falloff?: boolean;
  /** Hook (grid already holds the new heights): number of lifts whose cable clearance the change violates. >0 rejects with reason 'lift clearance'. */
  liftClearanceViolations?: (changed: CornerChange[]) => number;
  /** OccFlag bits that do NOT block the change (e.g. Path|Road for building auto-flatten; networks re-drape). */
  tolerateOccupancy?: number;
  /** Extra post-change veto (grid holds new heights): >0 rejects with reason 'occupied' (e.g. road max-slope broken). */
  extraViolations?: (changed: CornerChange[]) => number;
}

export const defaultConstructionMultiplier = (): number => 1.0;

/** Vertex rectangle, inclusive. */
export interface VRect { vx0: number; vy0: number; vx1: number; vy1: number }

/** Vertex rect covered by a brush on a tile target (b x b tiles → (b+1)² corners). */
export function tileBrushRect(grid: Grid, tx: number, ty: number, brush: number): VRect {
  const lo = Math.floor((brush - 1) / 2);
  const x0 = clampI(tx - lo, 0, grid.size - brush), y0 = clampI(ty - lo, 0, grid.size - brush);
  return { vx0: x0, vy0: y0, vx1: x0 + brush, vy1: y0 + brush };
}

/** Vertex rect for a corner target (b x b corners). */
export function cornerBrushRect(grid: Grid, vx: number, vy: number, brush: number): VRect {
  const lo = Math.floor((brush - 1) / 2);
  const x0 = clampI(vx - lo, 0, grid.vsize - brush), y0 = clampI(vy - lo, 0, grid.vsize - brush);
  return { vx0: x0, vy0: y0, vx1: x0 + brush - 1, vy1: y0 + brush - 1 };
}

function clampI(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(Math.max(a, b), v));
}

function isWaterAround(grid: Grid, vx: number, vy: number): boolean {
  for (let ty = vy - 1; ty <= vy; ty++)
    for (let tx = vx - 1; tx <= vx; tx++)
      if (grid.inBounds(tx, ty) && isWaterType(grid.tileType[grid.tileIndex(tx, ty)]!)) return true;
  return false;
}

function isOccupiedAround(grid: Grid, vx: number, vy: number, tolerate = 0): boolean {
  for (let ty = vy - 1; ty <= vy; ty++)
    for (let tx = vx - 1; tx <= vx; tx++)
      if (grid.inBounds(tx, ty) && (grid.occupancy.flags[grid.occupancy.index(tx, ty)]! & ~tolerate & 0xff) !== 0) return true;
  return false;
}

/**
 * BFS-propagate from seeds so every 4-neighbour edge delta <= maxEdge and every tile's corner
 * spread (diagonals) <= MAX_TILE_DELTA. `orig` records first-seen heights for changed vertices.
 */
function propagate(grid: Grid, queue: number[], orig: Map<number, number>, maxEdge: number): void {
  const v = grid.vsize;
  const h = grid.heights;
  let head = 0;
  while (head < queue.length) {
    const i = queue[head++]!;
    const vx = i % v, vy = (i / v) | 0;
    const hv = h[i]!;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const cx = vx + dx, cy = vy + dy;
        if (cx < 0 || cy < 0 || cx >= v || cy >= v) continue;
        const lim = dx !== 0 && dy !== 0 ? MAX_TILE_DELTA : Math.min(maxEdge, MAX_TILE_DELTA);
        const j = cy * v + cx;
        const hc = h[j]!;
        let nh = hc;
        if (hc > hv + lim) nh = hv + lim;
        else if (hc < hv - lim) nh = hv - lim;
        if (nh !== hc) {
          if (!orig.has(j)) orig.set(j, hc);
          grid.setCornerUnchecked(cx, cy, nh);
          queue.push(j);
        }
      }
    }
  }
}

function finish(
  grid: Grid, orig: Map<number, number>, opts: TerraformOptions,
): TerraformResult {
  const v = grid.vsize;
  const changed: CornerChange[] = [];
  let halfSteps = 0;
  let blocked = false;
  let water = false;
  for (const [i, from] of orig) {
    const to = grid.heights[i]!;
    if (to === from) continue;
    const vx = i % v, vy = (i / v) | 0;
    changed.push({ vx, vy, from, to });
    halfSteps += Math.abs(to - from);
    if (isWaterAround(grid, vx, vy)) water = true;
    if (isOccupiedAround(grid, vx, vy, opts.tolerateOccupancy ?? 0)) blocked = true;
  }
  const rollback = (): void => {
    for (const c of changed) grid.setCornerUnchecked(c.vx, c.vy, c.from);
  };
  const empty = (reason: 'occupied' | 'water' | 'nochange' | 'lift clearance'): TerraformResult =>
    ({ ok: false, reason, changed: [], halfSteps: 0, cost: 0, removedProps: 0, touchedChunks: [] });
  if (water) { rollback(); return empty('water'); }
  if (blocked) { rollback(); return empty('occupied'); }
  if (changed.length === 0) return empty('nochange');
  if (opts.extraViolations && opts.extraViolations(changed) > 0) { rollback(); return empty('occupied'); }
  if (opts.liftClearanceViolations && opts.liftClearanceViolations(changed) > 0) { rollback(); return empty('lift clearance'); }
  const mult = (opts.constructionMultiplier ?? defaultConstructionMultiplier)();
  const cost = halfSteps * TERRAFORM_COST_PER_HALF_STEP * mult;
  if (opts.commit === false) {
    rollback();
    return { ok: true, changed, halfSteps, cost, removedProps: 0, touchedChunks: [] };
  }
  let removedProps = 0;
  const touchedChunks: number[] = [];
  if (opts.props) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of changed) {
      x0 = Math.min(x0, c.vx - 1); y0 = Math.min(y0, c.vy - 1);
      x1 = Math.max(x1, c.vx); y1 = Math.max(y1, c.vy);
    }
    removedProps = opts.props.removeInRect(
      Math.max(0, x0), Math.max(0, y0), Math.min(grid.size - 1, x1), Math.min(grid.size - 1, y1), touchedChunks);
  }
  return { ok: true, changed, halfSteps, cost, removedProps, touchedChunks };
}

function edgeOf(opts: TerraformOptions): number {
  return opts.maxEdgeDelta ?? TERRAFORM_DEFAULT_MAX_EDGE_DELTA;
}

function clampH(h: number): number {
  return Math.max(0, Math.min(TERRAFORM_MAX_HEIGHT, h));
}

/** Set targets (index -> height) then propagate. */
function applyTargets(grid: Grid, targets: Map<number, number>, maxEdge: number): Map<number, number> {
  const orig = new Map<number, number>();
  const queue: number[] = [];
  for (const [i, to0] of targets) {
    const from = grid.heights[i]!;
    const to = clampH(to0);
    if (to === from) continue;
    orig.set(i, from);
    grid.setCornerUnchecked(i % grid.vsize, (i / grid.vsize) | 0, to);
    queue.push(i);
  }
  propagate(grid, queue, orig, maxEdge);
  return orig;
}

function rectIndices(grid: Grid, r: VRect): number[] {
  const out: number[] = [];
  const x0 = Math.max(0, r.vx0), y0 = Math.max(0, r.vy0);
  const x1 = Math.min(grid.vsize - 1, r.vx1), y1 = Math.min(grid.vsize - 1, r.vy1);
  for (let vy = y0; vy <= y1; vy++) for (let vx = x0; vx <= x1; vx++) out.push(vy * grid.vsize + vx);
  return out;
}

/**
 * Raise (delta>0) or lower (delta<0) corners in the rect. Without falloff every corner moves by
 * delta; with falloff (rect wider than 1 tile) the centre moves by delta*PEAK and the change fades smoothly.
 */
export function raiseLowerRect(grid: Grid, rect: VRect, delta: number, opts: TerraformOptions = {}): TerraformResult {
  const v = grid.vsize;
  const ext = Math.max(rect.vx1 - rect.vx0, rect.vy1 - rect.vy0);
  const fall = opts.falloff === true && ext >= 2;
  const cx = (rect.vx0 + rect.vx1) / 2, cy = (rect.vy0 + rect.vy1) / 2;
  const R = ext / 2 + 0.5;
  const targets = new Map<number, number>();
  for (const i of rectIndices(grid, rect)) {
    let d = delta;
    if (fall) {
      const dist = Math.hypot((i % v) - cx, ((i / v) | 0) - cy);
      const w = Math.max(0, 1 - (dist / R) ** 2);
      d = Math.sign(delta) * Math.round(Math.abs(delta) * TERRAFORM_FALLOFF_PEAK * w);
    }
    if (d !== 0) targets.set(i, grid.heights[i]! + d);
  }
  return finish(grid, applyTargets(grid, targets, edgeOf(opts)), opts);
}

/** Flatten all corners in the vertex rect to `target`; edges blend outward via propagation. */
export function flattenRect(grid: Grid, rect: VRect, target: number, opts: TerraformOptions = {}): TerraformResult {
  const targets = new Map<number, number>();
  for (const i of rectIndices(grid, rect)) targets.set(i, target);
  return finish(grid, applyTargets(grid, targets, edgeOf(opts)), opts);
}

/** Relax corners in the rect toward the mean of their 3x3 neighbourhood (quantized to half-steps). */
export function smoothRect(grid: Grid, rect: VRect, opts: TerraformOptions = {}): TerraformResult {
  const v = grid.vsize;
  const targets = new Map<number, number>();
  for (const i of rectIndices(grid, rect)) {
    const vx = i % v, vy = (i / v) | 0;
    let sum = 0, n = 0;
    for (let y = vy - 1; y <= vy + 1; y++)
      for (let x = vx - 1; x <= vx + 1; x++) {
        if (x < 0 || y < 0 || x >= v || y >= v) continue;
        sum += grid.heights[y * v + x]!; n++;
      }
    targets.set(i, Math.round(sum / n));
  }
  return finish(grid, applyTargets(grid, targets, edgeOf(opts)), opts);
}
