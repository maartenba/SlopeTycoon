import { BRIDGES, BRIDGE_MSG, GAP_MIN_DROP, type BridgeKind } from '../config/bridges';
import { CROSSING } from '../config/crossings';
import { TileType, type Grid } from './Grid';
import { OccFlag } from './Occupancy';
import { planBridge, type BridgePlan } from './Bridges';
import { Cross, Layer, NetKind, TRAIL_ORPHAN_MSG, PISTE_COST_PER_TILE, type LayerBit, type Networks, type NetKindId } from './Networks';
import type { Pt } from '../sim/Dependencies';

/**
 * Drag-to-bridge stroke planner (docs/bridges.md, docs/crossings.md). Bridges are not a mode: every path kind draws normally and when the stroke runs over
 * a lake / pond (or, for footpaths and roads, a gap) the planner splits it into ordinary pieces and one bridge of the matching type; a stroke that meets a
 * rail line gets the level crossing or the bridge variant (`CrossMode`). Pure; `buildStroke` applies the result.
 */
export type StrokeKind = 'path' | 'road' | 'rail' | 'hike' | 'mtb';
/** What a stroke does where it meets a rail line: a level crossing (guests wait for trains) or a bridge over it (never waits, costs more). */
export type CrossMode = 'level' | 'bridge';

/** Bridge type that matches each drawable kind (rail never bridges). */
export const BRIDGE_OF: Record<Exclude<StrokeKind, 'rail'>, BridgeKind> = { path: 'footbridge', road: 'roadBridge', hike: 'hikeBridge', mtb: 'mtbBridge' };

export type StrokeStep = { type: 'seg'; tiles: Pt[] } | { type: 'bridge'; plan: BridgePlan };

export interface StrokePlan {
  ok: boolean;
  reason?: string;
  cost: number;
  /** Ordinary new tiles (paths / roads / rail) or tiles to paint (trails), banks excluded. */
  newTiles: Pt[];
  /** Level crossings / rail bridges the stroke creates. */
  crossings: Array<Pt & { cross: number }>;
  bridges: BridgePlan[];
  steps: StrokeStep[];
  /** Every non-span tile of the stroke (the preview line). */
  line: Pt[];
}

const maxCorner = (g: Grid, x: number, y: number): number => Math.max(...g.getCorners(x, y));
const minCorner = (g: Grid, x: number, y: number): number => Math.min(...g.getCorners(x, y));
const failed = (reason: string, line: Pt[], extra: Partial<StrokePlan> = {}): StrokePlan => ({ ok: false, reason, cost: 0, newTiles: [], crossings: [], bridges: [], steps: [], line, ...extra });

interface Run { s: number; e: number; water: boolean }

/** Maximal runs of tiles a bridge has to carry: lake / pond tiles and (footpath / road) dry tiles in a depression. */
function findRuns(net: Networks, grid: Grid, kind: StrokeKind, line: Pt[]): Run[] {
  const runs: Run[] = [];
  const free = (t: Pt): boolean => {
    if (!net.inBounds(t.x, t.y)) return false;
    const i = net.idxOf(t.x, t.y);
    return net.kind[i] === 0 && net.layers[i] === 0 && net.bid[i] === 0;
  };
  const isWater = (t: Pt): boolean => grid.tileType[net.idxOf(t.x, t.y)] === TileType.Water;
  const gaps = kind !== 'rail'; // trails too: a depression that a bridge can span becomes a bridge, any other dip stays plain ground (planTrailStroke drops the run)
  /** A dry free tile at least GAP_MIN_DROP half-steps below the bank the run starts from (a depression: the bridge planner then checks the far bank). */
  const deep = (t: Pt, ref: number): boolean => gaps && !(grid.occupancy.flags[net.idxOf(t.x, t.y)]! & (OccFlag.Building | OccFlag.Lift | OccFlag.Decor)) && minCorner(grid, t.x, t.y) <= ref - GAP_MIN_DROP;
  for (let k = 0; k < line.length; k++) {
    const t = line[k]!;
    if (!free(t)) continue;
    const water = isWater(t);
    if (!water && (k === 0 || !deep(t, maxCorner(grid, line[k - 1]!.x, line[k - 1]!.y)))) continue;
    const ref = k > 0 ? maxCorner(grid, line[k - 1]!.x, line[k - 1]!.y) : Infinity;
    let e = k, anyWater = false;
    for (; e < line.length && free(line[e]!) && (isWater(line[e]!) || deep(line[e]!, ref)); e++) if (isWater(line[e]!)) anyWater = true;
    runs.push({ s: k, e: e - 1, water: anyWater });
    k = e - 1;
  }
  return runs;
}

const isStraight = (line: Pt[], r: Run): boolean => {
  if (r.s < 1 || r.e >= line.length - 1) return true; // missing banks are reported by planRun
  const a = line[r.s - 1]!, b = line[r.e + 1]!;
  const h = a.y === b.y, v = a.x === b.x;
  if (!h && !v) return false;
  for (let k = r.s - 1; k <= r.e + 1; k++) if (h ? line[k]!.y !== a.y : line[k]!.x !== a.x) return false;
  return true;
};

/**
 * A freehand drag is never a perfectly straight line, but a bridge is: where the stroke enters a lake / pond on a bank the bridge runs straight on in the
 * direction of entry up to the first dry tile (the far bank), and the stroke carries on from there (an L-shaped connector to where the drag came out).
 * A drag that ends in the water is carried on to the far bank. Strokes that are already straight, and runs that cannot be straightened, are left alone.
 */
export function straightenRuns(net: Networks, grid: Grid, kind: StrokeKind, line: Pt[]): Pt[] {
  const water = (x: number, y: number): boolean => net.inBounds(x, y) && grid.tileType[net.idxOf(x, y)] === TileType.Water;
  let cur = line;
  for (let guard = 0; guard < 6; guard++) {
    const r = findRuns(net, grid, kind, cur).find((q) => q.water && q.s >= 1 && !isStraight(cur, q) || (q.water && q.s >= 1 && q.e >= cur.length - 1));
    if (!r) break;
    const a = cur[r.s - 1]!, dx = cur[r.s]!.x - a.x, dy = cur[r.s]!.y - a.y;
    const walk: Pt[] = [];
    let x = a.x + dx, y = a.y + dy;
    while (water(x, y) && walk.length < 12) { walk.push({ x, y }); x += dx; y += dy; }
    if (!net.inBounds(x, y) || water(x, y)) break;
    walk.push({ x, y }); // the far bank
    let rest = cur.slice(r.e + 1);
    if (rest.length && rest[0]!.x === x && rest[0]!.y === y) rest = rest.slice(1); // the drag came out exactly on the far bank
    let conn: Pt[] = [];
    if (rest.length) {
      const t = rest[0]!;
      const L = (hFirst: boolean): Pt[] => { const out: Pt[] = []; let px = x, py = y; const stepX = (): void => { while (px !== t.x) { px += Math.sign(t.x - px); out.push({ x: px, y: py }); } }; const stepY = (): void => { while (py !== t.y) { py += Math.sign(t.y - py); out.push({ x: px, y: py }); } }; if (hFirst) { stepX(); stepY(); } else { stepY(); stepX(); } return out; };
      const wet = (c: Pt[]): number => c.filter((q) => water(q.x, q.y)).length;
      const c1 = L(true), c2 = L(false);
      conn = wet(c1) <= wet(c2) ? c1 : c2;
      if (conn.length && conn[conn.length - 1]!.x === t.x && conn[conn.length - 1]!.y === t.y) conn.pop(); // the target is the head of `rest`
    }
    cur = [...cur.slice(0, r.s), ...walk, ...conn, ...rest];
  }
  return cur;
}

/** Validate a run: banks exist, the run is one straight line, then `planBridge` (spans, clearance, cost). */
function planRun(net: Networks, grid: Grid, kind: Exclude<StrokeKind, 'rail'>, line: Pt[], r: Run, mult: number, planned: ReadonlySet<number>): BridgePlan | { reason: string } {
  if (r.s < 1) return { reason: BRIDGE_MSG.nearBank };
  if (r.e >= line.length - 1) return { reason: BRIDGE_MSG.farBank };
  const a = line[r.s - 1]!, b = line[r.e + 1]!;
  const horizontal = a.y === b.y, vertical = a.x === b.x;
  if (!horizontal && !vertical) return { reason: BRIDGE_MSG.straight };
  for (let k = r.s - 1; k <= r.e + 1; k++) if (horizontal ? line[k]!.y !== a.y : line[k]!.x !== a.x) return { reason: BRIDGE_MSG.straight };
  const plan = planBridge(net, grid, BRIDGE_OF[kind], a, b, mult, { planned, skipLink: true });
  if (plan.ok) return plan;
  // a steep slope is not a gap: say 'Too steep', not 'Bridges only cross water or a gap'
  if (!r.water && (kind === 'path' || kind === 'road') && (plan.reason === BRIDGE_MSG.notGap || plan.reason === BRIDGE_MSG.nothing || plan.reason?.startsWith('Span too long'))) {
    const nk = (kind === 'path' ? NetKind.Path : NetKind.Road) as NetKindId;
    const c = net.canBuild(nk, line[r.s]!.x, line[r.s]!.y, planned as Set<number>);
    if (!c.ok && c.reason) return { reason: c.reason };
  }
  return { reason: plan.reason ?? BRIDGE_MSG.nothing };
}

/** The `over` argument of `crossingCheck` for a mode and a kind: false = level crossing. */
export function overFor(kind: StrokeKind, mode: CrossMode): boolean | number {
  if (mode !== 'bridge') return false;
  return kind === 'mtb' ? Cross.MtbBridge : Cross.Footbridge;
}

/** Plan a footpath / road / rail stroke (tiles in drag order). Rail never bridges; trails go through `planTrailStroke`. */
export function planStroke(net: Networks, grid: Grid, kind: 'path' | 'road' | 'rail', line: Pt[], mult = 1, mode: CrossMode = 'level'): StrokePlan {
  const nk = (kind === 'path' ? NetKind.Path : kind === 'road' ? NetKind.Road : NetKind.Rail) as NetKindId;
  const over = overFor(kind, mode);
  const runs = kind === 'rail' ? [] : findRuns(net, grid, kind, line);
  const steps: StrokeStep[] = [], planned = new Set<number>();
  const crossings: Array<Pt & { cross: number }> = [], newTiles: Pt[] = [], bridges: BridgePlan[] = [];
  let cost = 0, from = 0;
  const seg = (tiles: Pt[]): string | null => {
    if (!tiles.length) return null;
    const p = net.planSegment(nk, tiles, mult, over, planned);
    if (!p.ok) return p.reason ?? 'Blocked';
    for (const t of p.newTiles) planned.add(net.idxOf(t.x, t.y));
    for (const c of p.crossings) planned.add(net.idxOf(c.x, c.y));
    newTiles.push(...p.newTiles); crossings.push(...p.crossings); cost += p.cost;
    steps.push({ type: 'seg', tiles });
    return null;
  };
  for (const r of runs) {
    const e = seg(line.slice(from, Math.max(from, r.s - 1)));
    if (e) return failed(e, line);
    const bp = planRun(net, grid, kind as Exclude<StrokeKind, 'rail'>, line, r, mult, planned);
    if (!('ok' in bp)) return failed(bp.reason, line);
    bridges.push(bp); steps.push({ type: 'bridge', plan: bp }); cost += bp.cost;
    for (const t of [bp.a, ...bp.span, bp.b]) planned.add(net.idxOf(t.x, t.y));
    from = r.e + 2;
  }
  const e = seg(line.slice(from));
  if (e) return failed(e === 'Water' && kind === 'rail' ? BRIDGE_MSG.rail : e, line);
  if (kind === 'path' && (newTiles.length || bridges.length) && !net.strokeAnchored(line.filter((t, k) => !runs.some((r) => k >= r.s && k <= r.e) && net.inBounds(t.x, t.y)))) return failed('Paths must connect to a path, road or building', line);
  return { ok: true, cost, newTiles, crossings, bridges, steps, line: line.filter((_, k) => !runs.some((r) => k >= r.s && k <= r.e)) };
}

/** Apply a successful `planStroke` plan in order (each piece re-validates against the state the previous one left). */
export function buildStroke(net: Networks, kind: 'path' | 'road' | 'rail', plan: StrokePlan, mode: CrossMode = 'level'): void {
  const nk = (kind === 'path' ? NetKind.Path : kind === 'road' ? NetKind.Road : NetKind.Rail) as NetKindId;
  for (const s of plan.steps) {
    if (s.type === 'seg') net.buildSegment(nk, s.tiles, overFor(kind, mode));
    else net.buildBridge(s.plan);
  }
}

const LAYER_OF = { hike: Layer.Hike, mtb: Layer.Mtb } as const;

/**
 * Plan a hiking / MTB trail stroke (the 4-connected centre line of the freehand drag): lake tiles become a wooden hiking / MTB bridge, rail tiles a level
 * crossing or the (ramp) bridge over the rail, everything else paints as before. Trails need no bridge over gaps (they simply follow the ground).
 */
export function planTrailStroke(net: Networks, grid: Grid, kind: 'hike' | 'mtb', line: Pt[], mult = 1, mode: CrossMode = 'level'): StrokePlan {
  const layer: LayerBit = LAYER_OF[kind];
  line = straightenRuns(net, grid, kind, line);
  // runs a bridge cannot serve: a dip that is no gap (steep ground) is simply painted as before; water always needs its bridge or a clear refusal
  const runs = findRuns(net, grid, kind, line).filter((r) => r.water || 'ok' in planRun(net, grid, kind, line, r, mult, new Set()));
  const inRun = (k: number): boolean => runs.some((r) => k >= r.s && k <= r.e);
  const steps: StrokeStep[] = [], bridges: BridgePlan[] = [], crossings: Array<Pt & { cross: number }> = [];
  let cost = 0;
  for (const r of runs) {
    const bp = planRun(net, grid, kind, line, r, mult, new Set());
    if (!('ok' in bp)) return failed(bp.reason, line);
    bridges.push(bp); steps.push({ type: 'bridge', plan: bp }); cost += bp.cost;
  }
  const painted: Pt[] = [], solid: Pt[] = [];
  const bank = new Set<number>(); // a bridge builds its own banks (and charges them): they are not painted twice
  for (const r of runs) for (const k of [r.s - 1, r.e + 1]) if (line[k]) bank.add(k);
  for (let k = 0; k < line.length; k++) {
    const t = line[k]!;
    if (inRun(k)) continue;
    if (!net.inBounds(t.x, t.y)) return failed('Out of bounds', line);
    const i = net.idxOf(t.x, t.y);
    if (net.kind[i] === NetKind.Rail) {
      const c = net.crossingCheck(NetKind.Path, line, k, crossings, overFor(kind, mode));
      if (!c.ok) return failed(c.reason ?? 'Crossing not supported', line);
      if (net.cross[i] !== c.cross) { crossings.push({ x: t.x, y: t.y, cross: c.cross }); cost += net.crossCost(c.cross) * mult; }
      solid.push(t);
      continue;
    }
    const c = net.canPaint(t.x, t.y, layer);
    if (!c.ok) continue; // like before: a tile that cannot take a trail (building, garden decor) is skipped, the rest paints
    if (!bank.has(k)) painted.push(t);
    solid.push(t);
  }
  if (!net.strokeAnchored(solid, layer)) return failed(TRAIL_ORPHAN_MSG, line);
  steps.push({ type: 'seg', tiles: painted });
  return { ok: true, cost: cost + painted.length * PISTE_COST_PER_TILE * mult, newTiles: painted, crossings, bridges, steps, line: solid };
}

/** Apply a trail plan: crossings, bridges (their banks included), then the painted tiles with the difficulty override. */
export function buildTrailStroke(net: Networks, kind: 'hike' | 'mtb', plan: StrokePlan, override?: number): void {
  for (const c of plan.crossings) net.buildCrossing(NetKind.Path, c.x, c.y, c.cross);
  for (const b of plan.bridges) net.buildBridge(b);
  if (plan.newTiles.length) net.paint(LAYER_OF[kind], plan.newTiles, override);
}

/** One line for the tooltip: what this stroke adds besides plain tiles. */
export function describeExtras(plan: StrokePlan): string {
  const out: string[] = [];
  for (const b of plan.bridges) out.push(`${BRIDGES[b.kind as BridgeKind].label}: span ${b.span.length} tile${b.span.length === 1 ? '' : 's'}, $${Math.round(b.spanCost)}`);
  const by = (c: number): number => plan.crossings.filter((x) => x.cross === c).length;
  const n1 = by(Cross.Path) + by(Cross.Road);
  if (n1) out.push(n1 === 1 ? 'level crossing: guests wait for trains' : `${n1} level crossings`);
  if (by(Cross.Footbridge)) out.push(by(Cross.Footbridge) === 1 ? 'footbridge over the rail' : `${by(Cross.Footbridge)} footbridges over the rail`);
  if (by(Cross.MtbBridge)) out.push(by(Cross.MtbBridge) === 1 ? 'MTB ramp bridge over the rail' : `${by(Cross.MtbBridge)} MTB ramp bridges over the rail`);
  return out.join(' + ');
}

export const MTB_RAIL_COST = CROSSING.mtbBridge.cost;
