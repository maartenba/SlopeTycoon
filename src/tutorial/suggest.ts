import { BUILDINGS } from '../config/buildings';
import { LIFTS, type LiftKind } from '../config/lifts';
import { TileType } from '../world/Grid';
import { OccFlag } from '../world/Occupancy';
import { Layer, NET_COST, NetKind, PISTE_COST_PER_TILE, interpolateStroke, sweepBrush } from '../world/Networks';
import { placeBuilding, validatePlacement } from '../sim/PlaceBuilding';
import { autoFlattenDefault } from '../sim/PlacementRules';
import { placeLift, validateLift, type LiftData, type LiftEnv, type StationSite } from '../sim/Lift';
import { snapLift } from '../sim/LiftAssist';
import type { PlacedBuilding } from '../sim/Buildings';
import type { Sim } from '../game/createSim';
import { centreOf, rectOf, type Pt, type Rect } from './queries';
import { t } from './strings';

/** Visual/world changes a host (main.ts) needs to mirror after an assisted action. */
export interface Change { chunks?: number[]; building?: PlacedBuilding; lift?: LiftData; structure?: boolean }
export type ChangeSink = (c: Change) => void;
export interface ActionResult { ok: boolean; cost: number; reason?: string }

const FAIL = (reason: string): ActionResult => ({ ok: false, cost: 0, reason });
const FUNDS = 'Not enough funds'; // sim reason text (compared, never shown raw)

export const ringOf = (r: Rect): Pt[] => {
  const out: Pt[] = [];
  for (let x = r.x; x < r.x + r.w; x++) out.push({ x, y: r.y - 1 }, { x, y: r.y + r.h });
  for (let y = r.y; y < r.y + r.h; y++) out.push({ x: r.x - 1, y }, { x: r.x + r.w, y });
  return out;
};

/** Where services cluster: the lodge centre, and the middle of the road stub reaching it. */
export function anchors(sim: Sim): { lodge: Pt; road: Pt } {
  const l = sim.buildings.all().find((b) => b.type === 'baseLodge');
  const lodge = l ? centreOf(rectOf(l)) : { x: sim.terrainInfo.villageAnchor.x, y: sim.terrainInfo.villageAnchor.y };
  const e = sim.networks.roadEntry;
  const road = e ? { x: Math.round((e.x + lodge.x) / 2), y: Math.round((e.y + lodge.y) / 2) } : lodge;
  return { lodge, road };
}

// ---------------------------------------------------------------- building sites

export interface Site { type: string; x: number; y: number; rot: number; autoFlatten: boolean; cost: number; rect: Rect }
export interface SiteOpts {
  /** Footprint (and ring) must not touch a piste. */
  avoidPiste?: boolean;
  /** Require that the needed road / footpath link can actually be routed. */
  route?: 'road' | 'path';
  /** Explicit rotations to try (default: all for non-square). */
  rmax?: number;
  /** Extra veto on a candidate footprint. */
  avoid?: (r: Rect) => boolean;
}

const touchesPiste = (sim: Sim, r: Rect): boolean => {
  for (let j = r.y - 1; j <= r.y + r.h; j++) for (let i = r.x - 1; i <= r.x + r.w; i++) if (sim.networks.pisteAt(i, j)) return true;
  return false;
};

/** Spiral search for the nearest valid site (real placement rules; funds ignored). Null when nothing fits within `rmax`. */
export function findSite(sim: Sim, type: string, anchor: Pt, opts: SiteOpts = {}): Site | null {
  const def = BUILDINGS[type];
  if (!def) return null;
  const rmax = opts.rmax ?? 16;
  const af = autoFlattenDefault(type);
  let routeTries = 0;
  for (let r = 0; r <= rmax; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      for (let rot = 0; rot < (def.w === def.h ? 1 : 4); rot++) {
        const fw = rot % 2 ? def.h : def.w, fh = rot % 2 ? def.w : def.h;
        const x = Math.round(anchor.x) - (fw >> 1) + dx, y = Math.round(anchor.y) - (fh >> 1) + dy;
        const rect = { x, y, w: fw, h: fh };
        if (opts.avoidPiste && touchesPiste(sim, rect)) continue;
        if (opts.avoid?.(rect)) continue;
        const chk = validatePlacement(sim.env, type, x, y, rot, af);
        const reasons = chk.reasons.filter((q) => !q.startsWith(FUNDS));
        if (reasons.length) continue;
        if (opts.route) {
          if (routeTries >= 40) continue; // budget spent: never accept a site whose link was not checked
          routeTries++;
          if ((opts.route === 'road' ? planRoadTo(sim, rect) : planPathTo(sim, rect)) === null) continue;
        }
        return { type, x, y, rot, autoFlatten: af, cost: chk.cost + chk.flattenCost, rect };
      }
    }
  }
  return null;
}

/** Placement through the real API. */
export function placeSite(sim: Sim, site: Site, sink?: ChangeSink): ActionResult & { building?: PlacedBuilding } {
  const out = placeBuilding(sim.env, sim.props, site.type, site.x, site.y, site.rot, site.autoFlatten, false);
  if (!out.ok || !out.building) return FAIL(out.reasons.join(', ') || t('reason.blocked'));
  settle(sim);
  sim.refreshCoverage(out.building, out.changed.length > 0);
  sink?.({ chunks: out.touchedChunks, building: out.building, structure: true });
  return { ok: true, cost: out.cost, building: out.building };
}

export function settle(sim: Sim): void {
  sim.buildings.reevaluate();
  sim.refreshCoverage(undefined, true);
  sim.openStatus.evaluate();
}

/** Sample tiles of the largest ski piste from top to bottom (fractions 0..1). */
export function pisteSamples(sim: Sim): Pt[] {
  const comps = sim.networks.pisteComponents().filter((c) => c.count >= 4).sort((a, b) => b.count - a.count);
  const c = comps[0];
  if (!c) return [];
  const size = sim.size;
  const pts = c.tiles.map((i) => ({ x: i % size, y: (i / size) | 0 }));
  pts.sort((a, b) => sim.cond.altitude(b.x, b.y) - sim.cond.altitude(a.x, a.y));
  return pts;
}

/** Nearest valid site on a few points along the piste (huts, first aid, cannons, reservoir). */
export function findAlongPiste(sim: Sim, type: string, rmax: number, fractions: readonly number[] = [0.5, 0.3, 0.7, 0.15, 0.85], route?: 'road' | 'path'): Site | null {
  const pts = pisteSamples(sim);
  if (!pts.length) return null;
  // Buildings that are not meant to stand on a piste must not wall off the corridor beside any lift (a piste could not be planned / redrawn there).
  let avoid: ((r: Rect) => boolean) | undefined;
  if (BUILDINGS[type]?.pisteRule !== 'allow') {
    const corridor = new Set<number>();
    for (const l of sim.lifts.all()) for (const side of [1, -1] as const) for (const t of pisteGeom(sim, l.top, l.bottom, side).stroke) corridor.add(t.y * sim.size + t.x);
    if (corridor.size) avoid = (r) => { for (let j = r.y; j < r.y + r.h; j++) for (let i = r.x; i < r.x + r.w; i++) if (corridor.has(j * sim.size + i)) return true; return false; };
  }
  for (const f of fractions) {
    const p = pts[Math.min(pts.length - 1, Math.floor(pts.length * f))]!;
    const s = findSite(sim, type, p, { rmax, avoid, route });
    if (s) return s;
  }
  return null;
}

// ---------------------------------------------------------------- networks

const goalSetOf = (sim: Sim, r: Rect): Set<number> => new Set(ringOf(r).filter((t) => sim.networks.inBounds(t.x, t.y)).map((t) => sim.networks.idxOf(t.x, t.y)));

/** Tiles of a road from the road entry to `r` ([] = already served, null = impossible). */
export function planRoadTo(sim: Sim, r: Rect): Pt[] | null {
  const n = sim.networks;
  if (n.serves('road', r)) return [];
  const e = n.roadEntry;
  if (!e) return null;
  const goal = goalSetOf(sim, r);
  const route = n.route(NetKind.Road, e, e, 0, (x, y) => goal.has(n.idxOf(x, y)));
  return route.length ? route : null;
}

/**
 * Tiles of a footpath linking `r` to the walkable network (roads + footpaths reachable from the road entry). The path starts on a free tile
 * that already touches that network (beside the Base Lodge / any connected building); the shortest of the candidate routes wins.
 */
export function planPathTo(sim: Sim, r: Rect): Pt[] | null {
  const n = sim.networks;
  if (n.serves('path', r)) return [];
  const goal = goalSetOf(sim, r);
  const seen = new Set<number>();
  const starts: Pt[] = [];
  for (const b of sim.buildings.all()) {
    if (b.type !== 'baseLodge' && !b.active) continue;
    for (const t of ringOf(rectOf(b))) {
      if (!n.inBounds(t.x, t.y)) continue;
      const i = n.idxOf(t.x, t.y);
      if (seen.has(i) || n.kindAt(t.x, t.y) !== 0) continue;
      seen.add(i);
      if (n.serves('path', { x: t.x, y: t.y, w: 1, h: 1 })) starts.push(t);
    }
  }
  let best: Pt[] | null = null;
  for (const s of starts.slice(0, 60)) {
    const route = n.route(NetKind.Path, s, s, 0, (x, y) => goal.has(n.idxOf(x, y)));
    if (route.length && (!best || route.length < best.length)) best = route;
  }
  return best;
}

/** A footpath tying two buildings together even when a road already touches both (shortest of a few tries). */
export function planPathBetween(sim: Sim, a: Rect, b: Rect): Pt[] | null {
  const n = sim.networks;
  const goal = goalSetOf(sim, b);
  let best: Pt[] | null = null;
  for (const s of ringOf(a)) {
    if (!n.inBounds(s.x, s.y)) continue;
    const route = n.route(NetKind.Path, s, s, 0, (x, y) => goal.has(n.idxOf(x, y)) && n.kindAt(x, y) !== NetKind.Road);
    if (route.length && (!best || route.length < best.length)) best = route;
  }
  return best;
}

/** Cost estimate of building the tiles of a network (skips tiles that already exist). */
export function networkCost(sim: Sim, kind: 1 | 2, tiles: Pt[]): number {
  let n = 0;
  for (const t of tiles) if (sim.networks.kindAt(t.x, t.y) !== kind) n++;
  return n * NET_COST[kind] * sim.economy.constructionMultiplier();
}

export function buildNetwork(sim: Sim, kind: 1 | 2, tiles: Pt[], sink?: ChangeSink): ActionResult {
  if (!tiles.length) return { ok: true, cost: 0 };
  const plan = sim.networks.planSegment(kind === 1 ? NetKind.Path : NetKind.Road, tiles, sim.economy.constructionMultiplier());
  if (!plan.ok) return FAIL(plan.reason ?? t('reason.blocked'));
  if (!sim.economy.charge(plan.cost)) return FAIL(t('reason.funds'));
  for (const t of plan.newTiles) sim.networks.build(kind === 1 ? NetKind.Path : NetKind.Road, t.x, t.y);
  sim.bus.emit('path:drawn', { kind: kind === 1 ? 'path' : 'road', tiles: plan.newTiles.length, erase: false });
  settle(sim);
  sink?.({ structure: true, chunks: sim.networks.consumeDirtyChunks() });
  return { ok: true, cost: plan.cost };
}

// ---------------------------------------------------------------- lifts and pistes

export interface LiftPlan { kind: LiftKind; bottom: StationSite; top: StationSite; cost: number; side: 1 | -1; gain: number }

const liftEnv = (sim: Sim): LiftEnv => ({ grid: sim.grid, lifts: sim.lifts, economy: sim.economy, access: sim.networks.access, gate: sim.gate, props: sim.props, buildings: sim.buildings });

/** Piste beside a lift line: from the top station's edge, 3 tiles to one side, down to the bottom station. */
export function pisteGeom(sim: Sim, top: Pt, bottom: Pt, side: 1 | -1): { full: Pt[]; stroke: Pt[]; foot: Pt } {
  const size = sim.size;
  const dx = bottom.x - top.x, dy = bottom.y - top.y, len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * side, ny = (dx / len) * side, off = 3;
  const ax = top.x + 1 + nx * off, ay = top.y + 1 + ny * off;
  const head = ringOf({ x: top.x, y: top.y, w: 2, h: 2 }).filter((t) => t.x >= 1 && t.y >= 1 && t.x < size - 1 && t.y < size - 1)
    .reduce((bst, t) => (Math.hypot(t.x - ax, t.y - ay) < Math.hypot(bst.x - ax, bst.y - ay) ? t : bst));
  const a = { x: Math.round(ax), y: Math.round(ay) };
  const foot = { x: Math.round(bottom.x + 1 + nx * off), y: Math.round(bottom.y + 1 + ny * off) };
  const full = interpolateStroke([head, a, foot]);
  return { full, stroke: sweepBrush(full, 2, size), foot };
}

function pisteClean(sim: Sim, g: { full: Pt[]; stroke: Pt[] }, strict: boolean, allowLift = false): boolean {
  const { grid, cond } = sim;
  for (const t of g.stroke) {
    if (t.x < 0 || t.y < 0 || t.x >= sim.size || t.y >= sim.size) return false;
    const i = grid.tileIndex(t.x, t.y);
    if (grid.tileType[i] === TileType.Water || grid.tileType[i] === TileType.Stream) return false;
    if (grid.occupancy.flags[grid.occupancy.index(t.x, t.y)]! & (allowLift ? OccFlag.Water | OccFlag.Building : OccFlag.Water | OccFlag.Building | OccFlag.Lift)) return false;
  }
  let up = 0;
  for (let k = 3; k < g.full.length; k++) if (cond.altitude(g.full[k]!.x, g.full[k]!.y) > cond.altitude(g.full[k - 1]!.x, g.full[k - 1]!.y) + 1e-6) up++;
  return strict ? up === 0 : up <= 3;
}

/** Village dressing (path, lamps, benches) reaches about this many tiles beyond the Base Lodge; the decor parking lot east of it reaches `LODGE_ZONE_EAST`. */
export const LODGE_ZONE = 4;
export const LODGE_ZONE_EAST = 6;
/** Tiles of free ground kept around a suggested bottom station (no building, road or path within the margin; nothing on the lodge's village green). */
export const STATION_MARGIN = 1;

/**
 * True when the 2x2 station at (x,y) (plus `STATION_MARGIN`) touches no building, lift, road, footpath or water tile and stays out of the lodge's
 * village zone. This is on top of `validateLift` (which only checks the station footprint itself): a suggestion must never sit ON the base.
 */
export function stationSiteFree(sim: Sim, x: number, y: number): boolean {
  const { grid, size } = sim, occ = grid.occupancy;
  for (let j = y - STATION_MARGIN; j < y + 2 + STATION_MARGIN; j++) for (let i = x - STATION_MARGIN; i < x + 2 + STATION_MARGIN; i++) {
    if (i < 0 || j < 0 || i >= size || j >= size) return false;
    const inside = i >= x && i < x + 2 && j >= y && j < y + 2;
    if (inside && (occ.flags[occ.index(i, j)]! !== 0 || sim.networks.kindAt(i, j) !== 0)) return false;
    if (!inside && (occ.flags[occ.index(i, j)]! & (OccFlag.Building | OccFlag.Lift)) !== 0) return false;
  }
  for (const b of sim.buildings.all()) {
    if (b.type !== 'baseLodge') continue;
    if (x + 2 > b.x - LODGE_ZONE && x < b.x + b.w + LODGE_ZONE_EAST && y + 2 > b.y - LODGE_ZONE && y < b.y + b.h + LODGE_ZONE) return false;
  }
  return true;
}

/** Final gate for a proposed line: the real validators (stations, buildings, roads, paths, water, kind rules; auto-flatten on) plus `stationSiteFree` for both ends. */
export function liftPlanValid(sim: Sim, kind: LiftKind, bottom: StationSite, top: StationSite): boolean {
  return validateLift(liftEnv(sim), kind, bottom, top, { autoFlatten: true, skipFunds: true }).ok && stationSiteFree(sim, bottom.x, bottom.y) && stationSiteFree(sim, top.x, top.y);
}

/**
 * Finds a lift line: bottom station near the village, top uphill, valid for the cheapest of `kinds` that fits, with room for a
 * clean piste beside it. Deterministic (angle/radius scan). Null when the map offers nothing.
 */
export function planLift(sim: Sim, kinds: readonly LiftKind[] = ['chair4', 'tbar', 'chair2']): LiftPlan | null {
  const { grid, size } = sim;
  const env = liftEnv(sim);
  const { lodge } = anchors(sim);
  const radii: number[] = [8, 11, 14, 17];
  for (let r = 22; r <= size * 0.45; r += 5) radii.push(r);
  const existing = sim.lifts.all().map((l) => l.bottom);
  let best: LiftPlan | null = null;
  for (const kind of kinds) {
    search: for (const strict of [true, false]) for (const frac of [0.2, 0.14, 0.1, 0.07]) for (const rad of radii) {
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        const bx = Math.round(lodge.x + Math.cos(ang) * rad) - 1, by = Math.round(lodge.y + Math.sin(ang) * rad) - 1;
        if (bx < 3 || by < 3 || bx > size - 6 || by > size - 6) continue;
        if (existing.some((p) => Math.hypot(p.x - bx, p.y - by) < 7)) continue;
        let gx = 0, gy = 0;
        for (let k = 1; k <= 8; k++) {
          const sa = (k / 8) * Math.PI * 2, sx = Math.round(bx + Math.cos(sa) * 12), sy = Math.round(by + Math.sin(sa) * 12);
          if (sx < 0 || sy < 0 || sx > size || sy > size) continue;
          const h = grid.getCorner(sx, sy) - grid.getCorner(bx, by);
          gx += Math.cos(sa) * h; gy += Math.sin(sa) * h;
        }
        const gl = Math.hypot(gx, gy);
        if (gl < 1e-6) continue;
        const len = Math.max(10, Math.round(size * frac));
        const clamp = (v: number): number => Math.max(3, Math.min(size - 6, v));
        const top = { x: clamp(Math.round(bx + (gx / gl) * len)), y: clamp(Math.round(by + (gy / gl) * len)) };
        const snap = snapLift(env, kind, { x: bx, y: by }, top, { adjust: 'top', radius: 3, autoFlatten: true, skipFunds: true });
        if (!snap) continue;
        if (!stationSiteFree(sim, snap.bottom.x, snap.bottom.y) || !stationSiteFree(sim, snap.top.x, snap.top.y) || !liftPlanValid(sim, kind, snap.bottom, snap.top)) continue;
        const gain = grid.getCorner(snap.top.x, snap.top.y) - grid.getCorner(snap.bottom.x, snap.bottom.y);
        if (gain < 4) continue;
        const side = ([1, -1] as const).find((sd) => pisteClean(sim, pisteGeom(sim, snap.top, snap.bottom, sd), strict));
        if (!side) continue;
        if (!best || best.kind !== kind || gain > best.gain) best = { kind, bottom: snap.bottom, top: snap.top, cost: snap.check.cost + snap.check.flattenCost, side, gain };
      }
      if (best && best.kind === kind) break search;
    }
    if (best) break;
  }
  return best;
}

/** Valid-kinds check for the line the player drew (used for hints / tests). */
export const liftValid = (sim: Sim, kind: LiftKind, bottom: StationSite, top: StationSite): boolean => validateLift(liftEnv(sim), kind, bottom, top, { autoFlatten: true, skipFunds: true }).ok;

export function buildLift(sim: Sim, plan: LiftPlan, sink?: ChangeSink): ActionResult & { lift?: LiftData } {
  const out = placeLift(liftEnv(sim), sim.props, plan.kind, plan.bottom, plan.top, true);
  if (!out.ok || !out.lift) return FAIL(out.reasons.join(', ') || t('reason.blocked'));
  sim.bus.emit('lift:built', { id: out.lift.id, kind: out.lift.kind });
  sink?.({ chunks: out.touchedChunks, lift: out.lift, structure: true });
  const link = planPathTo(sim, { x: plan.bottom.x, y: plan.bottom.y, w: 2, h: 2 });
  let extra = 0;
  if (link && link.length) { const r = buildNetwork(sim, 1, link, sink); extra = r.ok ? r.cost : 0; }
  settle(sim);
  return { ok: true, cost: out.cost + extra, lift: out.lift };
}

/** The piste beside a built lift: stroke + the path linking its foot to the village. */
export function planPiste(sim: Sim, lift: LiftData): { full: Pt[]; stroke: Pt[]; foot: Pt; cost: number } | null {
  for (const side of [1, -1] as const) {
    for (const strict of [true, false]) {
      const g = pisteGeom(sim, lift.top, lift.bottom, side);
      if (pisteClean(sim, g, strict, true)) {
        const fresh = g.stroke.filter((t) => !sim.networks.pisteAt(t.x, t.y)).length;
        return { ...g, cost: fresh * PISTE_COST_PER_TILE * sim.economy.constructionMultiplier() };
      }
    }
  }
  return null;
}

export function paintPiste(sim: Sim, stroke: Pt[], foot: Pt | null, layer: 1 | 2 | 4 = Layer.Ski, sink?: ChangeSink): ActionResult {
  const fresh = stroke.filter((t) => sim.networks.canPaint(t.x, t.y, layer).ok && !(sim.networks.layers[sim.networks.idxOf(t.x, t.y)]! & layer)).length;
  const cost = fresh * PISTE_COST_PER_TILE * sim.economy.constructionMultiplier();
  if (!sim.economy.charge(cost)) return FAIL(t('reason.funds'));
  const res = sim.networks.paint(layer, stroke);
  if (!res.painted) { sim.economy.refund(cost); return FAIL(t('reason.nothingPainted')); }
  sim.bus.emit('piste:painted', { layer: layer === Layer.Mtb ? 'mtb' : layer === Layer.Hike ? 'hike' : 'ski', tiles: res.painted, erase: false });
  let extra = 0;
  if (foot && layer === Layer.Ski) {
    const link = planPathTo(sim, { x: foot.x, y: foot.y, w: 1, h: 1 });
    if (link && link.length) { const r = buildNetwork(sim, 1, link, sink); extra = r.ok ? r.cost : 0; }
  }
  settle(sim);
  sink?.({ structure: true, chunks: sim.networks.consumeDirtyChunks() });
  return { ok: true, cost: cost + extra };
}

/** A hiking trail along the main piste (anchored: it starts at the piste foot which is linked to the footpaths). */
export function planTrail(sim: Sim): { stroke: Pt[]; cost: number } | null {
  const pts = pisteSamples(sim);
  if (pts.length < 4) return null;
  const stroke = pts.filter((t) => sim.networks.canPaint(t.x, t.y, Layer.Hike).ok);
  if (stroke.length < 4) return null;
  const mult = sim.economy.constructionMultiplier();
  return { stroke, cost: stroke.length * PISTE_COST_PER_TILE * mult };
}

/** Rough price of a building (with the construction multiplier). */
export const priceOf = (sim: Sim, type: string): number => (BUILDINGS[type]?.cost ?? 0) * sim.economy.constructionMultiplier();
export const liftKindName = (k: LiftKind): string => LIFTS[k].name;
