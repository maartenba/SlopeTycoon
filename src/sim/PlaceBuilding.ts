import { BUILDINGS } from '../config/buildings';
import { HEIGHT_UNIT } from '../config/balance';
import { OccFlag } from '../world/Occupancy';
import { CHUNK_SIZE, TileType, isWaterType, type Grid } from '../world/Grid';
import type { CornerChange } from '../world/Terraform';
import { countCliffs } from '../world/Cliffs';
import { commitChanges, planFlatten, type FlattenFail, type FlattenFailKind, type FlattenPlan } from '../world/FlattenPlanner';
import { TREE_KINDS, type PropStore } from '../world/Props';

const TREE_SET: ReadonlySet<number> = new Set(TREE_KINDS);
const isTreeKind = (k: number): boolean => TREE_SET.has(k);
import { canPlace, evaluateStatus } from './Dependencies';
import { networkSpreadViolations } from '../world/Networks';
import { autoFlattenPolicy, checkSlope, accessHint, isAccessReason, meanHeight } from './PlacementRules';
import { footprintOf, type Buildings, type PlacedBuilding } from './Buildings';
import type { Economy } from './Economy';
import type { UnlockGate } from '../config/unlocks';

export const EDGE_MARGIN = 1;

export interface PlacementEnv {
  grid: Grid;
  buildings: Buildings;
  economy: Economy;
  /** Trees/rocks (counted in the preview: 'Trees will be cleared'). */
  props?: PropStore;
  /** Career unlock gate (config/unlocks.ts). Absent = nothing is locked (tests, Sandbox). */
  gate?: UnlockGate;
  /** Water tour bases (Phase 6 Task 24): judge `site.nearWaterway` for a candidate footprint (nominal flow: season / ice independent). Absent = the rule passes (older tests). */
  waterSite?: (type: string, rect: { x: number; y: number; w: number; h: number }) => { ok: boolean; reason: string; hint: string; info: string };
}

/** Summary of the levelling a placement would do (cut & fill pad + apron / retaining wall). */
export interface FlattenSummary {
  cut: number;
  fill: number;
  /** Pad height (half-steps), apron step (1 gentle, 2 steep = retaining wall) and number of pad-boundary edges that are walls. */
  height: number;
  /** Lowest footprint corner after levelling (where the building sits). */
  base: number;
  edge: 1 | 2;
  wallEdges: number;
  /** Changed corners (from/to) for the ghost's cut/fill preview. */
  changes: CornerChange[];
  /** Tile bounds of the changed area. */
  area: { x0: number; y0: number; x1: number; y1: number } | null;
}

export interface PlacementCheck {
  ok: boolean;
  /** ALL failing rules (not just the first). */
  reasons: string[];
  /** Building cost (multiplier applied). */
  cost: number;
  flattenCost: number;
  /** True if auto-flatten will be used. */
  flatten: boolean;
  spread: number;
  /** Non-blocking notes (e.g. 'Not connected: needs road access': placeable but would start inactive). */
  warnings: string[];
  /** Plain-language next steps for the blocking reasons (same order as `reasons`, may be shorter). */
  hints: string[];
  /** Hint per reason (reason text -> hint) so the UI can show 'Too steep \u2014 enable Auto-flatten (F)'. */
  hintFor: Record<string, string>;
  /** Neutral notes for the preview ('Trees will be cleared (12)', 'Levelling: $X (cut a / fill b)'). */
  info: string[];
  /** Props (trees, rocks) that placing here removes. */
  trees: number;
  flattenPlan?: FlattenSummary;
  /** Career lock reason ('Unlocks at level 4: Alpine destination'), also the FIRST entry of `reasons`. */
  locked?: string;
}

/** Apron-blocking kinds -> plain language (reason, hint). */
function flattenFailText(f: FlattenFail): { reason: string; hint: string } {
  const at = f.vx !== undefined ? ` at ${f.vx},${f.vy}` : '';
  const k: FlattenFailKind = f.kind;
  switch (k) {
    case 'water': return { reason: 'Cannot flatten next to water', hint: `the levelled slope would run into water${at}: move away from the lake/stream` };
    case 'building': return { reason: 'Cannot flatten next to other buildings', hint: `levelling would undermine a nearby building${at}: leave a gap or pick another spot` };
    case 'lift': return { reason: 'Cannot flatten next to a lift', hint: `levelling would disturb a lift line${at}` };
    case 'piste': return { reason: 'Cannot flatten across a piste', hint: `levelling would reshape a piste${at}: place beside it, not across it` };
    case 'network': return { reason: 'Cannot flatten: road would get too steep', hint: `flattening would make the nearby road/path/rail too steep${f.detail ? ` (${f.detail})` : ''}: move away from it` };
    case 'clearance': return { reason: 'Cannot flatten: lift clearance', hint: 'raising the ground would violate a lift cable clearance' };
    case 'earthwork': case 'range': return { reason: 'Cannot flatten here', hint: 'too steep to level, even with a retaining wall: try a gentler spot' };
    default: return { reason: 'Cannot flatten here', hint: 'the terrain cannot be levelled here: try another spot' };
  }
}

function frozenKind(env: PlacementEnv, x: number, y: number, w: number, h: number): (vx: number, vy: number) => FlattenFailKind | null {
  const { grid } = env;
  const net = env.buildings.depContext().access;
  return (vx, vy) => {
    const pad = vx >= x && vx <= x + w && vy >= y && vy <= y + h;
    for (let ty = vy - 1; ty <= vy; ty++) for (let tx = vx - 1; tx <= vx; tx++) {
      if (!grid.inBounds(tx, ty)) continue;
      const fl = grid.occupancy.flags[grid.occupancy.index(tx, ty)]!;
      if (fl & OccFlag.Building) return 'building';
      if (fl & OccFlag.Lift) return 'lift';
      if ((fl & OccFlag.Water) || isWaterType(grid.tileType[grid.tileIndex(tx, ty)]!)) return 'water';
      if (!pad && net && net.pisteAt(tx, ty)) return 'piste';
    }
    return null;
  };
}

/** Plan the cut & fill pad for a footprint (pure: grid unchanged). */
export function planPad(env: PlacementEnv, type: string, x: number, y: number, w: number, h: number): FlattenPlan {
  const def = BUILDINGS[type];
  const tilt = def && Number.isFinite(def.site.maxSlope) ? Math.min(1, def.site.maxSlope) : 0;
  const access = env.buildings.depContext().access;
  return planFlatten(env.grid, { x, y, w, h }, {
    slack: tilt,
    multiplier: env.economy.constructionMultiplier(),
    frozen: frozenKind(env, x, y, w, h),
    validate: (ch) => {
      // Paths/roads/rail re-drape over changed terrain provided they keep their slope limits; lift cable clearance is checked via the hook.
      if (networkSpreadViolations(env.grid, access, ch) > 0) return { kind: 'network' };
      if (env.buildings.liftClearance && env.buildings.liftClearance(ch) > 0) return { kind: 'clearance' };
      return null;
    },
  });
}

function padBase(grid: Grid, changes: CornerChange[], x: number, y: number, w: number, h: number): number {
  const to = new Map<number, number>();
  for (const c of changes) to.set(c.vy * grid.vsize + c.vx, c.to);
  let min = Infinity;
  for (let vy = y; vy <= y + h; vy++) for (let vx = x; vx <= x + w; vx++) min = Math.min(min, to.get(vy * grid.vsize + vx) ?? grid.getCorner(vx, vy));
  return min;
}

function propsOnFootprint(env: PlacementEnv, x: number, y: number, w: number, h: number): number {
  const p = env.props;
  if (!p) return 0;
  return p.countInRect(x, y, x + w - 1, y + h - 1);
}

/** Pure validation (no mutation: flatten is previewed and rolled back). Collects every failing rule. */
export function validatePlacement(env: PlacementEnv, type: string, x: number, y: number, rot: number, autoFlatten = false): PlacementCheck {
  const def = BUILDINGS[type];
  const out: PlacementCheck = { ok: false, reasons: [], cost: 0, flattenCost: 0, flatten: false, spread: 0, warnings: [], hints: [], hintFor: {}, info: [], trees: 0 };
  if (!def) { out.reasons.push(`Unknown building ${type}`); return out; }
  const { grid, economy } = env;
  const { w, h } = footprintOf(type, rot);
  const bad = (r: string, hint?: string): void => {
    if (!out.reasons.includes(r)) out.reasons.push(r);
    if (hint) { if (!out.hints.includes(hint)) out.hints.push(hint); out.hintFor[r] ??= hint; }
  };
  out.cost = def.cost * economy.constructionMultiplier();
  const lock = env.gate?.locked('building', type);
  if (lock) { out.locked = lock; out.reasons.push(lock); }
  if (x < 0 || y < 0 || x + w > grid.size || y + h > grid.size) { out.reasons.push('Out of bounds'); return out; }
  if (x < EDGE_MARGIN || y < EDGE_MARGIN || x + w > grid.size - EDGE_MARGIN || y + h > grid.size - EDGE_MARGIN) bad('Too close to the map edge');

  const net = env.buildings.depContext().access;
  const site = def.site;
  let hard = false; // terrain cannot be flattened (occupied / water)
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
    const fl = grid.occupancy.flags[grid.occupancy.index(i, j)]!;
    const tt = grid.tileType[grid.tileIndex(i, j)]!;
    if (fl & OccFlag.Building) { bad('Tile occupied'); hard = true; }
    if (fl & (OccFlag.Road | OccFlag.Path)) {
      // A rail tile (kindAt 3) is fine for a type that may stand on the line (Train Station): the rail stays in Networks under the platform.
      if (!(def.overRail && net?.kindAt(i, j) === 3)) { bad('Cannot build on a road, path or rail'); hard = true; }
      else if (net?.crossAt?.(i, j)) { bad('Cannot build on a level crossing'); hard = true; }
    }
    if (fl & OccFlag.Lift) { bad('Blocked by a lift line'); hard = true; }
    if (fl & OccFlag.Decor) { bad('Garden decor in the way: remove it first (Landscape drawer)'); hard = true; }
    if (tt === TileType.Stream) { bad('Cannot build on a stream'); hard = true; }
    else if (isWaterType(tt) || (fl & OccFlag.Water)) {
      if (site.onWater !== 'shallow') { bad('Cannot build on water'); hard = true; }
    }
    if (tt === TileType.Rock && !site.allowRock) bad('Cannot build on bare rock');
    if (net && def.pisteRule !== 'allow' && net.pisteAt(i, j)) { bad('Cannot build on a piste'); }
  }

  const sl = checkSlope(site, grid, x, y, w, h);
  out.spread = sl.spread;
  if (!sl.ok) {
    const policy = autoFlattenPolicy(type);
    const canFlatten = autoFlatten && policy !== 'never' && site.slopeKind !== 'gentleSlope' && !hard;
    if (canFlatten) {
      const plan = planPad(env, type, x, y, w, h);
      if (plan.ok) {
        out.flatten = true; out.flattenCost = plan.cost;
        out.flattenPlan = { cut: plan.cut, fill: plan.fill, height: plan.height, base: padBase(grid, plan.changes, x, y, w, h), edge: plan.edge, wallEdges: plan.wallEdges, changes: plan.changes, area: plan.area };
        out.info.push(`Levelling: $${Math.round(plan.cost)} (cut ${plan.cut} / fill ${plan.fill})`);
        if (plan.wallEdges > 0) out.info.push(`Retaining wall on ${plan.wallEdges} edge${plan.wallEdges === 1 ? '' : 's'}`);
      } else {
        const t = flattenFailText(plan.fail ?? { kind: 'invalid' });
        bad(t.reason, t.hint);
      }
    } else if (hard) bad(sl.reason ?? 'Too steep');
    else if (site.slopeKind === 'gentleSlope') bad(sl.reason ?? 'Too steep');
    else if (policy === 'never') bad(sl.reason ?? 'Too steep', 'this building never reshapes terrain, pick flatter ground');
    else bad(sl.reason ?? 'Too steep', 'enable Auto-flatten (F) to level it');
  }

  if (site.minAltitude !== undefined || site.maxAltitude !== undefined) {
    const m = meanHeight(grid, x, y, w, h);
    if (site.minAltitude !== undefined && m < site.minAltitude) bad('Too low for this building');
    if (site.maxAltitude !== undefined && m > site.maxAltitude) bad('Too high for this building');
  }

  const dep = canPlace(type, env.buildings.depContext(), { x, y });
  for (const r of dep.reasons) bad(r);

  // Missing access / shuttle never blocks: the building would start inactive.
  const st = evaluateStatus({ id: -1, type, x, y, w, h, active: true }, env.buildings.depContext());
  if (!st.active && st.reason && !out.reasons.includes(st.reason)) {
    out.warnings.push(st.reason);
    if (isAccessReason(st.reason)) {
      const hint = accessHint(type, net, { x, y, w, h });
      if (hint) out.info.push(hint);
      else if (def.placeTip) out.info.push(def.placeTip);
    }
  }

  if (site.forest && env.props) {
    const f = site.forest;
    const n = env.props.countInRect(x - f.radius, y - f.radius, x + w - 1 + f.radius, y + h - 1 + f.radius, isTreeKind);
    if (n < f.minTrees) bad('Needs forest around it', `pick a spot with at least ${f.minTrees} trees within ${f.radius} tiles (${n} here)`);
    else out.info.push(`Forest around it (${n} trees): they stay`);
  }
  if (site.nearRock) {
    const n = countCliffs(grid, { x, y, w, h }, site.nearRock);
    if (n < site.nearRock.minTiles) bad('Needs a steep rock face nearby', `pick a spot at the foot of a cliff: at least ${site.nearRock.minTiles} steep bare-rock tiles within ${site.nearRock.radius} tiles (${n} here)`);
    else out.info.push(`Rock face in reach (${n} steep rock tiles)`);
  }
  if (site.nearWaterway && env.waterSite) {
    const r = env.waterSite(type, { x, y, w, h });
    if (!r.ok) bad(r.reason, r.hint);
    else out.info.push(r.info);
  }
  out.trees = site.forest && site.forest.keepTrees !== false ? 0 : propsOnFootprint(env, x, y, w, h);
  if (out.trees > 0) out.info.push(`Trees will be cleared (${out.trees})`);
  const total = out.cost + out.flattenCost;
  if (!economy.canAfford(total)) bad(`Not enough funds ($${Math.ceil(total)})`, 'save up or pick a cheaper spot');
  out.ok = out.reasons.length === 0;
  return out;
}

export interface PlaceOutcome {
  ok: boolean;
  reasons: string[];
  building?: PlacedBuilding;
  changed: number[];
  touchedChunks: number[];
  cost: number;
}

/** Validate, charge, flatten (optional), clear props, write store+occupancy. `free` skips charge (starting lodge). */
export function placeBuilding(
  env: PlacementEnv, props: PropStore | undefined, type: string, x: number, y: number, rot: number,
  autoFlatten = false, free = false,
): PlaceOutcome {
  const chk = validatePlacement(env, type, x, y, rot, autoFlatten);
  // Free placements skip only the funds reason.
  const reasons = free ? chk.reasons.filter((r) => !r.startsWith('Not enough funds')) : chk.reasons;
  if (reasons.length) return { ok: false, reasons, changed: [], touchedChunks: [], cost: 0 };
  const total = free ? 0 : chk.cost + chk.flattenCost;
  if (!env.economy.charge(total)) return { ok: false, reasons: ['Not enough funds'], changed: [], touchedChunks: [], cost: 0 };
  const { w, h } = footprintOf(type, rot);
  const touched: number[] = [];
  if (chk.flatten && chk.flattenPlan) {
    // Replan on the real grid (identical to the preview: pure and deterministic), then write the pad + apron.
    const plan = planPad(env, type, x, y, w, h);
    if (!plan.ok) return { ok: false, reasons: ['Cannot flatten here'], changed: [], touchedChunks: [], cost: 0 };
    commitChanges(env.grid, plan.changes);
    // Tell renderers (props, road/path drapes) which chunks changed height.
    for (const c of plan.changes) {
      for (const [tx, ty] of [[c.vx - 1, c.vy - 1], [c.vx, c.vy - 1], [c.vx - 1, c.vy], [c.vx, c.vy]] as const) {
        if (!env.grid.inBounds(tx, ty)) continue;
        const ci = Math.floor(ty / CHUNK_SIZE) * env.grid.chunksPerRow + Math.floor(tx / CHUNK_SIZE);
        if (!touched.includes(ci)) touched.push(ci);
      }
    }
  }
  const keep = BUILDINGS[type]?.site.forest && BUILDINGS[type]!.site.forest!.keepTrees !== false; // treehouse: the forest stays
  if (!keep) props?.removeInRect(x, y, x + w - 1, y + h - 1, touched);
  const { building, changed } = env.buildings.add(type, x, y, rot);
  return { ok: true, reasons: [], building, changed, touchedChunks: touched, cost: total };
}

/** Top-left tile so the footprint is centred on the picked tile. */
export function anchorFor(type: string, rot: number, tileX: number, tileY: number): { x: number; y: number } {
  const { w, h } = footprintOf(type, rot);
  return { x: tileX - Math.floor((w - 1) / 2), y: tileY - Math.floor((h - 1) / 2) };
}

/** Y to place a building's origin on: lowest corner of its footprint. */
export function baseHeight(grid: Grid, x: number, y: number, w: number, h: number): number {
  let min = Infinity;
  for (let vy = y; vy <= y + h; vy++) for (let vx = x; vx <= x + w; vx++) min = Math.min(min, grid.getCorner(vx, vy));
  return min * HEIGHT_UNIT;
}

/** Corner extremes of a footprint in half-steps. */
export function cornerRange(grid: Grid, x: number, y: number, w: number, h: number): { min: number; max: number } {
  let min = Infinity, max = -Infinity;
  for (let vy = y; vy <= y + h; vy++) for (let vx = x; vx <= x + w; vx++) { const c = grid.getCorner(vx, vy); if (c < min) min = c; if (c > max) max = c; }
  return { min, max };
}

/**
 * Where a mesh sits on a sloped footprint: the pad top is the HIGHEST corner (nothing is buried) and the stone plinth reaches down to the
 * lowest corner (`depth` = spread + a small embed, never less than `base`). Flat footprints give `base` (0.4) as before.
 */
export function seatOf(grid: Grid, x: number, y: number, w: number, h: number, base = 0.4): { y: number; depth: number; spread: number } {
  const { min, max } = cornerRange(grid, x, y, w, h);
  const spread = (max - min) * HEIGHT_UNIT;
  return { y: max * HEIGHT_UNIT, depth: spread > 0 ? Math.max(base, spread + 0.12) : base, spread };
}

/**
 * Seat of a tree-borne building (treehouse): the origin sits at the MIDDLE of the footprint's corner range and the trunks reach down to the lowest corner
 * (`depth` = distance to it + a small embed, at least 0.3). No pad, no stone plinth: a 2x2 on a 2 half-steps / tile slope used to stand on a 2-unit grey skirt.
 */
export function rootedSeatOf(grid: Grid, x: number, y: number, w: number, h: number): { y: number; depth: number; spread: number } {
  const { min, max } = cornerRange(grid, x, y, w, h);
  const mid = ((min + max) / 2) * HEIGHT_UNIT;
  return { y: mid, depth: Math.max(0.3, mid - min * HEIGHT_UNIT + 0.15), spread: (max - min) * HEIGHT_UNIT };
}

export interface RotateOutcome { ok: boolean; reasons: string[]; building?: PlacedBuilding; changed: number[]; touchedChunks: number[] }

/** Anchor that keeps the footprint centred when a building turns from `fromRot` to `toRot`. */
export function rotatedAnchor(b: { type: string; x: number; y: number; rot: number }, toRot: number): { x: number; y: number } {
  const a = footprintOf(b.type, b.rot), c = footprintOf(b.type, toRot);
  return { x: b.x + Math.trunc((a.w - c.w) / 2), y: b.y + Math.trunc((a.h - c.h) / 2) };
}

/**
 * Can the placed building `id` turn to `toRot`? Re-validates the rotated footprint (free tiles, slope, water, pistes, dependencies) as if the
 * building were lifted off the map; rotating is free and never flattens terrain. Pure (no mutation survives).
 */
export function validateRotation(env: PlacementEnv, id: number, toRot: number): { ok: boolean; reasons: string[]; x: number; y: number } {
  const b = env.buildings.get(id);
  if (!b) return { ok: false, reasons: ['No such building'], x: 0, y: 0 };
  const { x, y } = rotatedAnchor(b, toRot);
  const chk = env.buildings.without(id, () => validatePlacement({ ...env, gate: undefined }, b.type, x, y, toRot, false));
  const reasons = chk.reasons.filter((r) => !r.startsWith('Not enough funds'));
  return { ok: reasons.length === 0, reasons, x, y };
}

/** Rotate a placed building by one quarter turn (dir +1 clockwise, -1 counter-clockwise) when the rotated footprint is valid; else refuse with reasons. */
export function rotateBuilding(env: PlacementEnv, props: PropStore | undefined, id: number, dir: 1 | -1 = 1): RotateOutcome {
  const b = env.buildings.get(id);
  if (!b) return { ok: false, reasons: ['No such building'], changed: [], touchedChunks: [] };
  const toRot = (b.rot + dir + 4) % 4;
  const v = validateRotation(env, id, toRot);
  if (!v.ok) return { ok: false, reasons: v.reasons, changed: [], touchedChunks: [] };
  const { w, h } = footprintOf(b.type, toRot);
  const touched: number[] = [];
  props?.removeInRect(v.x, v.y, v.x + w - 1, v.y + h - 1, touched);
  const r = env.buildings.rotate(id, toRot, v.x, v.y);
  if (!r) return { ok: false, reasons: ['No such building'], changed: [], touchedChunks: [] };
  return { ok: true, reasons: [], building: r.building, changed: r.changed, touchedChunks: touched };
}
