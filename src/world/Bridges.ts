import { BRIDGES, BRIDGE_MAX_RISE, BRIDGE_MSG, GAP_MIN_DROP, type BridgeKind, type BridgeSpec } from '../config/bridges';
import { TileType, type Grid } from './Grid';
import { OccFlag } from './Occupancy';
import { Layer, NET_COST, ROAD_START_MSG, TRAIL_ORPHAN_MSG, NetKind, PISTE_COST_PER_TILE, type Networks, type NetKindId } from './Networks';
import type { Pt } from '../sim/Dependencies';

/** A stored bridge: the deck runs a -> b (both bank tiles are ordinary network tiles), `span` are the tiles between them. */
export interface Bridge {
  id: number;
  kind: BridgeKind;
  a: Pt; b: Pt;
  span: Pt[];
  /** Deck level in half-steps (flat across the span). */
  deck: number;
  /** Money paid ($, after multipliers; refund = half). Legacy auto records: 0. */
  cost: number;
  /** A record derived from an old per-tile stream-crossing flag (cost 0, nothing stored). */
  auto?: boolean;
}

export interface BridgePlan {
  ok: boolean;
  reason?: string;
  kind: BridgeKind | 'rail';
  a: Pt; b: Pt;
  span: Pt[];
  deck: number;
  /** Half-steps the deck sits above the lower bank (the ramp on the bank tile). */
  rise: number;
  /** Span indices (0-based) that carry a pier / post pair: every 2nd tile, and the last one. */
  supports: number[];
  /** Bank tiles that must be newly built as ordinary network tiles. */
  newBanks: Pt[];
  /** Total $ (span + new banks), x multiplier. */
  cost: number;
  spanCost: number;
  /** Every span tile is stream (tooltip: 'Footbridge over stream'). */
  overStream?: boolean;
}

const fail = (kind: BridgeKind | 'rail', a: Pt, b: Pt, reason: string): BridgePlan => ({ ok: false, reason, kind, a, b, span: [], deck: 0, rise: 0, supports: [], newBanks: [], cost: 0, spanCost: 0 });

const maxCorner = (g: Grid, x: number, y: number): number => Math.max(...g.getCorners(x, y));
const minCorner = (g: Grid, x: number, y: number): number => Math.min(...g.getCorners(x, y));
/** A road tile (or the road entry) is on / next to this tile: a new road bank links to the network there. */
const roadLinked = (net: Networks, t: Pt): boolean => {
  if (net.roadEntry && net.roadEntry.x === t.x && net.roadEntry.y === t.y) return true;
  if (net.kindAt(t.x, t.y) === NetKind.Road) return true;
  return [[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dx, dy]) => net.kindAt(t.x + dx!, t.y + dy!) === NetKind.Road);
};
const isWaterTile = (g: Grid, x: number, y: number): boolean => { const t = g.tileType[g.tileIndex(x, y)]; return t === TileType.Water || t === TileType.Stream; };

/** Supports (pier / post pairs) of an n-tile span: every second tile starting with the first, and always the last. */
export function bridgeSupports(n: number): number[] {
  const s: number[] = [];
  for (let i = 0; i < n; i += 2) s.push(i);
  if (n > 0 && s[s.length - 1] !== n - 1) s.push(n - 1);
  return s;
}

/**
 * Pure bridge planner (docs/bridges.md). `a` and `b` are the two bank tiles (the drag start / end), on one row or column. Checks, in this order:
 * rail -> straight line -> span length (1..maxSpan) -> both banks solid and legal for the layer -> every span tile is free and either water or a gap ->
 * deck level (clearance over water, never below a bank) and the rise to the banks. Returns the tiles, deck level, supports and cost, or the exact reason.
 */
export interface PlanBridgeOpts {
  /** Tile indices (`net.idxOf`) of the rest of the same stroke that will exist when this bridge is built (a road bank links through them). */
  planned?: ReadonlySet<number>;
  /** The caller judges linking for the whole stroke (drag-to-bridge): skip the per-bridge anchoring check. */
  skipLink?: boolean;
}

export function planBridge(net: Networks, grid: Grid, kind: BridgeKind | 'rail', a: Pt, b: Pt, mult = 1, opts: PlanBridgeOpts = {}): BridgePlan {
  if (kind === 'rail') return fail(kind, a, b, BRIDGE_MSG.rail);
  const spec: BridgeSpec = BRIDGES[kind];
  if (a.x !== b.x && a.y !== b.y) return fail(kind, a, b, BRIDGE_MSG.straight);
  const len = Math.abs(a.x - b.x) + Math.abs(a.y - b.y) - 1;
  if (len < 1) return fail(kind, a, b, BRIDGE_MSG.nothing);
  if (len > spec.maxSpan) return fail(kind, a, b, BRIDGE_MSG.tooLong(spec.maxSpan));
  if (!net.inBounds(a.x, a.y) || !net.inBounds(b.x, b.y)) return fail(kind, a, b, BRIDGE_MSG.ends);
  const dx = Math.sign(b.x - a.x), dy = Math.sign(b.y - a.y);
  const span: Pt[] = [];
  for (let i = 1; i <= len; i++) span.push({ x: a.x + dx * i, y: a.y + dy * i });

  // banks: solid ground, legal for the layer
  const banks = [a, b];
  const newBanks: Pt[] = [];
  const planned = new Set<number>(opts.planned);
  for (const t of span) planned.add(net.idxOf(t.x, t.y));
  planned.add(net.idxOf(a.x, a.y)); planned.add(net.idxOf(b.x, b.y)); // linking is judged once, at the end (physical reasons come first)
  let anyAnchored = false;
  for (let k = 0; k < 2; k++) {
    const t = banks[k]!, i = net.idxOf(t.x, t.y);
    if (isWaterTile(grid, t.x, t.y)) return fail(kind, a, b, BRIDGE_MSG.ends);
    if (spec.flatBanks) { const c = grid.getCorners(t.x, t.y); if (Math.max(...c) - Math.min(...c) > 1) return fail(kind, a, b, BRIDGE_MSG.flatEnds); }
    if (spec.layer === 'path' || spec.layer === 'road') {
      const nk = (spec.layer === 'path' ? NetKind.Path : NetKind.Road) as NetKindId;
      if (net.kind[i] === nk || (spec.layer === 'path' && net.kind[i] === NetKind.Road)) { anyAnchored = spec.layer === 'road' ? anyAnchored || roadLinked(net, t) || net.kind[i] === NetKind.Road : true; continue; } // lands on an existing tile
      if (net.kind[i] !== 0) return fail(kind, a, b, BRIDGE_MSG.ends); // rail / the other network
      // slope, occupancy and (roads) linking: bank B may link through the planned span; bank A must link by itself
      const c = net.canBuild(nk, t.x, t.y, planned);
      if (!c.ok) return fail(kind, a, b, c.reason === 'Water' ? BRIDGE_MSG.ends : (c.reason ?? BRIDGE_MSG.ends));
      newBanks.push(t);
      if (spec.layer === 'road' ? roadLinked(net, t) : net.isAnchoredTile(t.x, t.y)) anyAnchored = true;
    } else {
      const layer = spec.layer === 'hike' ? Layer.Hike : Layer.Mtb;
      const c = net.canPaint(t.x, t.y, layer);
      if (!c.ok) return fail(kind, a, b, BRIDGE_MSG.ends);
      if (net.isAnchoredTile(t.x, t.y, layer)) anyAnchored = true;
      if (!(net.layers[i]! & layer)) newBanks.push(t);
    }
  }

  // span tiles: free, and water or a gap
  let water = false;
  for (const t of span) {
    const i = net.idxOf(t.x, t.y);
    if (net.kind[i] !== 0 || net.layers[i] !== 0 || net.bid[i] !== 0) return fail(kind, a, b, BRIDGE_MSG.blocked);
    if (grid.occupancy.flags[i]! & (OccFlag.Building | OccFlag.Lift | OccFlag.Decor)) return fail(kind, a, b, BRIDGE_MSG.blocked);
    if (isWaterTile(grid, t.x, t.y)) water = true;
  }

  // deck level: never below a bank, clearance over every water tile; dry span tiles must then lie in a real gap below the deck
  let deck = Math.max(maxCorner(grid, a.x, a.y), maxCorner(grid, b.x, b.y));
  for (const t of span) if (isWaterTile(grid, t.x, t.y)) deck = Math.max(deck, maxCorner(grid, t.x, t.y) + spec.clearance);
  // a dry span tile is a gap only when its lowest corner is at least GAP_MIN_DROP half-steps below BOTH banks' highest corners (a depression between them, not just a slope)
  const bankLow = Math.min(maxCorner(grid, a.x, a.y), maxCorner(grid, b.x, b.y));
  let gap = false;
  for (const t of span) {
    if (isWaterTile(grid, t.x, t.y)) continue;
    if (bankLow - minCorner(grid, t.x, t.y) < GAP_MIN_DROP) return fail(kind, a, b, water ? BRIDGE_MSG.notGap : BRIDGE_MSG.nothing);
    gap = true;
  }
  if (!water && !gap) return fail(kind, a, b, BRIDGE_MSG.nothing);
  const rise = deck - Math.min(minCorner(grid, a.x, a.y), minCorner(grid, b.x, b.y));
  // a bank whose lowest corner is too far below the deck cannot be reached (the stairs would be a wall)
  if (deck - maxCorner(grid, a.x, a.y) > BRIDGE_MAX_RISE || deck - maxCorner(grid, b.x, b.y) > BRIDGE_MAX_RISE) return fail(kind, a, b, BRIDGE_MSG.low);

  if (!anyAnchored && !opts.skipLink) return fail(kind, a, b, spec.layer === 'road' ? ROAD_START_MSG : spec.layer === 'path' ? 'Paths must connect to a path, road or building' : TRAIL_ORPHAN_MSG);
  const spanCost = len * spec.costPerTile * mult;
  const bankUnit = spec.layer === 'road' ? NET_COST[NetKind.Road] : spec.layer === 'path' ? NET_COST[NetKind.Path] : PISTE_COST_PER_TILE;
  return { ok: true, kind, a, b, span, deck, rise, supports: bridgeSupports(len), newBanks, cost: spanCost + newBanks.length * bankUnit * mult, spanCost, overStream: span.every((t) => grid.tileType[grid.tileIndex(t.x, t.y)] === TileType.Stream) };
}
