import { MAX_TILE_DELTA, type Grid } from './Grid';
import type { CornerChange } from './Terraform';
import { TERRAFORM_COST_PER_HALF_STEP, TERRAFORM_MAX_HEIGHT } from '@/config/balance';

/**
 * Cut & fill pad planner (pure: reads the grid, never mutates it).
 *
 * A building pad (tile rect, vertex rect = tiles + 1) is levelled to a height H (optionally with `slack` half-steps of tilt, as the
 * site rule tolerates) and blended into the surroundings with an apron whose adjacent-vertex step is `edge` half-steps:
 *  - edge 1 = gentle apron (the terraform default),
 *  - edge 2 = steep apron / retaining wall: the largest step the terrain invariant allows (corner spread <= MAX_TILE_DELTA), i.e. a
 *    one-step (2 half-step) cliff edge around the pad that the renderer shows as a stone retaining wall.
 * A uniform natural slope of g half-steps/tile cannot be cut deeper than a few half-steps with a 1-step apron (the cut never dies out:
 * g >= edge), which is why the old unbounded ripple always ran into water/buildings on moderate slopes. The planner evaluates several
 * heights x slack x aprons, rejects plans whose apron would change a frozen vertex (water, buildings, lifts, pistes ...), leave the
 * margin window, exceed `maxChange`, or fail the caller's validate hook (road/rail slope limits, lift clearance), and returns the cheapest.
 */

export type FlattenFailKind = 'water' | 'building' | 'lift' | 'piste' | 'frozen' | 'range' | 'earthwork' | 'network' | 'clearance' | 'invalid';

export interface FlattenFail { kind: FlattenFailKind; vx?: number; vy?: number; detail?: string }

export interface FlattenPlanOptions {
  /** Vertex that must not move: returns the blocker kind or null. Pad vertices that are frozen reject every candidate. */
  frozen?: (vx: number, vy: number) => FlattenFailKind | null;
  /** Vertices around the pad the apron may change. Default 10. */
  margin?: number;
  /** Max |change| of any single vertex (half-steps). Default 14. */
  maxChange?: number;
  /** Corner-spread tilt the pad may keep (site tolerance, 0 or 1). Default 1. */
  slack?: number;
  /** Money multiplier. Default 1. */
  multiplier?: number;
  /** Final veto with the grid holding the new heights (road slope, lift clearance ...). null = ok. */
  validate?: (changes: CornerChange[]) => FlattenFail | null;
}

export interface FlattenPlan {
  ok: boolean;
  /** Pad base height (half-steps) and tilt actually used. */
  height: number;
  slack: number;
  /** Apron edge step: 1 gentle, 2 steep (retaining wall). */
  edge: 1 | 2;
  changes: CornerChange[];
  cut: number;
  fill: number;
  halfSteps: number;
  cost: number;
  /** Boundary edges whose step is the maximum (retaining-wall edges) around the pad. */
  wallEdges: number;
  /** Tile bounds of the changed area (inclusive); null when nothing changes. */
  area: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Most telling failure when !ok. */
  fail?: FlattenFail;
  /** How many candidate plans failed per kind (diagnostics / histograms). */
  failKinds: Partial<Record<FlattenFailKind, number>>;
}

/** Extra score (half-steps) for a steep apron / retaining wall over a gentle one: walls only when they save real earthwork or are the only way. */
const WALL_PENALTY = 14;

const FAIL_ORDER: FlattenFailKind[] = ['water', 'building', 'lift', 'piste', 'frozen', 'network', 'clearance', 'earthwork', 'range', 'invalid'];

/** Plan one fixed candidate. */
function attempt(
  grid: Grid, px0: number, py0: number, px1: number, py1: number, H: number, S: number, edge: 1 | 2, o: Required<Pick<FlattenPlanOptions, 'margin' | 'maxChange'>> & FlattenPlanOptions,
): { changes: CornerChange[] } | { fail: FlattenFail } {
  const V = grid.vsize;
  const wx0 = Math.max(0, px0 - o.margin), wy0 = Math.max(0, py0 - o.margin);
  const wx1 = Math.min(V - 1, px1 + o.margin), wy1 = Math.min(V - 1, py1 + o.margin);
  const ww = wx1 - wx0 + 1, wh = wy1 - wy0 + 1;
  const cur = new Int16Array(ww * wh), nat = new Int16Array(ww * wh);
  for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) cur[y * ww + x] = nat[y * ww + x] = grid.heights[(wy0 + y) * V + wx0 + x]!;
  const isPad = (x: number, y: number): boolean => { const vx = wx0 + x, vy = wy0 + y; return vx >= px0 && vx <= px1 && vy >= py0 && vy <= py1; };
  const queue: number[] = [];
  for (let vy = py0; vy <= py1; vy++) for (let vx = px0; vx <= px1; vx++) {
    const fz = o.frozen?.(vx, vy);
    const i = (vy - wy0) * ww + (vx - wx0);
    const to = Math.max(0, Math.min(TERRAFORM_MAX_HEIGHT, Math.max(H, Math.min(H + S, nat[i]!))));
    if (fz && to !== nat[i]) return { fail: { kind: fz, vx, vy } };
    cur[i] = to;
    queue.push(i);
  }
  const lim = (diag: boolean): number => (diag ? MAX_TILE_DELTA : Math.min(edge, MAX_TILE_DELTA));
  let head = 0;
  while (head < queue.length) {
    const i = queue[head++]!;
    const x = i % ww, y = (i / ww) | 0, hv = cur[i]!;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const cx = x + dx, cy = y + dy;
      if (cx < 0 || cy < 0 || cx >= ww || cy >= wh || isPad(cx, cy)) continue;
      const j = cy * ww + cx, hc = cur[j]!, l = lim(dx !== 0 && dy !== 0);
      const nh = hc > hv + l ? hv + l : hc < hv - l ? hv - l : hc;
      if (nh === hc) continue;
      const vx = wx0 + cx, vy = wy0 + cy;
      if (nh < 0 || nh > TERRAFORM_MAX_HEIGHT) return { fail: { kind: 'range', vx, vy } };
      const boundary = (cx === 0 && wx0 > 0) || (cy === 0 && wy0 > 0) || (cx === ww - 1 && wx1 < V - 1) || (cy === wh - 1 && wy1 < V - 1);
      if (boundary) return { fail: { kind: 'range', vx, vy } };
      const fz = o.frozen?.(vx, vy);
      if (fz) return { fail: { kind: fz, vx, vy } };
      if (Math.abs(nh - nat[j]!) > o.maxChange) return { fail: { kind: 'earthwork', vx, vy } };
      cur[j] = nh;
      queue.push(j);
    }
  }
  const changes: CornerChange[] = [];
  for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) {
    const i = y * ww + x;
    if (cur[i] !== nat[i]) changes.push({ vx: wx0 + x, vy: wy0 + y, from: nat[i]!, to: cur[i]! });
  }
  // Safety net: every tile of the window keeps corner spread <= MAX_TILE_DELTA.
  for (let y = 0; y + 1 < wh; y++) for (let x = 0; x + 1 < ww; x++) {
    const a = cur[y * ww + x]!, b = cur[y * ww + x + 1]!, c = cur[(y + 1) * ww + x]!, d = cur[(y + 1) * ww + x + 1]!;
    if (Math.max(a, b, c, d) - Math.min(a, b, c, d) > MAX_TILE_DELTA) return { fail: { kind: 'invalid', vx: wx0 + x, vy: wy0 + y } };
  }
  return { changes };
}

/** Temporarily write `changes` into the grid (no dirty marking), run fn, restore. */
export function withChanges<T>(grid: Grid, changes: CornerChange[], fn: () => T): T {
  const V = grid.vsize;
  for (const c of changes) grid.heights[c.vy * V + c.vx] = c.to;
  try { return fn(); } finally { for (const c of changes) grid.heights[c.vy * V + c.vx] = c.from; }
}

/** Apply a plan for real (marks dirty chunks). */
export function commitChanges(grid: Grid, changes: CornerChange[]): void {
  for (const c of changes) grid.setCornerUnchecked(c.vx, c.vy, c.to);
}

/**
 * Plan a pad for the tile rect (x, y, w, h). Candidates: heights around the pad's mean/median/min/max x tilt {0, slack} x apron {gentle, steep};
 * evaluated cheapest-pad-first, the first valid plan with the lowest score wins. Deterministic.
 */
export function planFlatten(grid: Grid, rect: { x: number; y: number; w: number; h: number }, opts: FlattenPlanOptions = {}): FlattenPlan {
  const margin = opts.margin ?? 10, maxChange = opts.maxChange ?? 14, slack = Math.max(0, Math.min(2, opts.slack ?? 1));
  const mult = opts.multiplier ?? 1;
  const px0 = rect.x, py0 = rect.y, px1 = rect.x + rect.w, py1 = rect.y + rect.h;
  const hs: number[] = [];
  for (let vy = py0; vy <= py1; vy++) for (let vx = px0; vx <= px1; vx++) hs.push(grid.getCorner(vx, vy));
  const sorted = [...hs].sort((a, b) => a - b);
  const mean = hs.reduce((s, v) => s + v, 0) / hs.length;
  const median = sorted[sorted.length >> 1]!;
  const cand = new Set<number>();
  for (let d = -3; d <= 3; d++) cand.add(Math.round(mean) + d);
  cand.add(median); cand.add(sorted[0]!); cand.add(sorted[sorted.length - 1]!); cand.add(median - 1); cand.add(median + 1);
  const padCost = (H: number, S: number): number => { let c = 0; for (const v of hs) c += Math.abs(Math.max(H, Math.min(H + S, v)) - v); return c; };
  const slacks = slack > 0 ? [0, slack] : [0];
  const combos: Array<{ H: number; S: number; pc: number }> = [];
  for (const H of cand) if (H >= 0 && H <= TERRAFORM_MAX_HEIGHT) for (const S of slacks) combos.push({ H, S, pc: padCost(H, S) + (S > 0 ? 4 : 0) });
  combos.sort((a, b) => a.pc - b.pc || a.H - b.H || a.S - b.S);

  const failKinds: FlattenPlan['failKinds'] = {};
  const note = (f: FlattenFail): void => { failKinds[f.kind] = (failKinds[f.kind] ?? 0) + 1; };
  let best: { score: number; H: number; S: number; edge: 1 | 2; changes: CornerChange[] } | null = null;
  const bestFail: FlattenFail[] = [];
  const o = { ...opts, margin, maxChange };
  for (const { H, S, pc } of combos) {
    if (best && pc >= best.score) break; // sorted by lower bound
    for (const edge of [1, 2] as const) {
      const r = attempt(grid, px0, py0, px1, py1, H, S, edge, o);
      if ('fail' in r) { note(r.fail); bestFail.push(r.fail); continue; }
      let halfSteps = 0;
      for (const c of r.changes) halfSteps += Math.abs(c.to - c.from);
      const score = halfSteps + (S > 0 ? 4 : 0) + (edge === 2 ? WALL_PENALTY : 0);
      if (best && score >= best.score) continue;
      if (opts.validate) {
        const f = withChanges(grid, r.changes, () => opts.validate!(r.changes));
        if (f) { note(f); bestFail.push(f); continue; }
      }
      best = { score, H, S, edge, changes: r.changes };
    }
  }
  if (!best) {
    let fail: FlattenFail | undefined;
    for (const k of FAIL_ORDER) { fail = bestFail.find((f) => f.kind === k); if (fail) break; }
    return { ok: false, height: Math.round(mean), slack: 0, edge: 1, changes: [], cut: 0, fill: 0, halfSteps: 0, cost: 0, wallEdges: 0, area: null, fail: fail ?? { kind: 'invalid' }, failKinds };
  }
  let cut = 0, fill = 0, wallEdges = 0;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const V = grid.vsize;
  const to = new Map<number, number>();
  for (const c of best.changes) {
    if (c.to < c.from) cut += c.from - c.to; else fill += c.to - c.from;
    x0 = Math.min(x0, c.vx - 1); y0 = Math.min(y0, c.vy - 1); x1 = Math.max(x1, c.vx); y1 = Math.max(y1, c.vy);
    to.set(c.vy * V + c.vx, c.to);
  }
  const hAt = (vx: number, vy: number): number => to.get(vy * V + vx) ?? grid.heights[vy * V + vx]!;
  for (let vx = px0; vx <= px1; vx++) for (const [oy, iy] of [[py0 - 1, py0], [py1 + 1, py1]] as const) {
    if (oy >= 0 && oy < V && Math.abs(hAt(vx, oy) - hAt(vx, iy)) >= MAX_TILE_DELTA) wallEdges++;
  }
  for (let vy = py0; vy <= py1; vy++) for (const [ox, ix] of [[px0 - 1, px0], [px1 + 1, px1]] as const) {
    if (ox >= 0 && ox < V && Math.abs(hAt(ox, vy) - hAt(ix, vy)) >= MAX_TILE_DELTA) wallEdges++;
  }
  const halfSteps = cut + fill;
  return {
    ok: true, height: best.H, slack: best.S, edge: best.edge, changes: best.changes, cut, fill, halfSteps,
    cost: halfSteps * TERRAFORM_COST_PER_HALF_STEP * mult, wallEdges,
    area: best.changes.length ? { x0: Math.max(0, x0), y0: Math.max(0, y0), x1: Math.min(grid.size - 1, x1), y1: Math.min(grid.size - 1, y1) } : null,
    failKinds,
  };
}
