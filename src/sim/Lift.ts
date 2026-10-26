import { LIFTS, normalizeLiftKind, type LiftDef, type LiftKind } from '../config/lifts';
import type { AccessKind, BuildingDef } from '../config/buildings';
import { accessSatisfied, type NetworkAccess } from './PlacementRules';
import { networkSpreadViolations } from '../world/Networks';
import {
  HEIGHT_UNIT, LIFT_DWELL_S, LIFT_FUNI_CUT_MAX, LIFT_FUNI_TRESTLE_MAX, LIFT_MIN_LENGTH, LIFT_MIN_SPEED, LIFT_STATION_HEAD,
  LIFT_STATION_SIZE, LIFT_TOWER_COST_FACTOR, LIFT_TRESTLE_COST_FACTOR, LIFT_ECO_FACTOR, LIFT_UPKEEP_PER_METRE_DAY, TERRAFORM_DEFAULT_MAX_EDGE_DELTA, TILE_METRES,
} from '../config/balance';
import { OccFlag } from '../world/Occupancy';
import type { Occupancy } from '../world/Occupancy';
import { isWaterType, type Grid } from '../world/Grid';
import { flattenRect, type CornerChange } from '../world/Terraform';
import { heightAt } from '../render/Picking';
import type { Economy } from './Economy';
import type { PropStore } from '../world/Props';
import type { UnlockGate } from '../config/unlocks';
import type { Buildings } from './Buildings';
import {
  CARRIER_HALF, OBSTACLE_MARGIN, OBS_STEP, STATION_APPROACH, STATION_SKIP, applyLane, carrierHits, noObstacle, planLane, sampleObstacles, treeMapFor, type LanePlan, type ObstacleSamples,
} from './LiftClearance';
import { matureCanopyHeight, matureCrownRadius } from '../world/TreeHeights';

export interface V3 { x: number; y: number; z: number }

/** Per-kind construction parameters (world units; 1 unit = TILE_METRES m). */
export interface LiftParams {
  /** Min cable clearance above terrain along the span (sag included). */
  minClearance: number;
  minTowerHeight: number;
  maxTowerHeight: number;
  /** Midspan sag as a fraction of span length. */
  sag: number;
  /** How far carriers hang below the cable (visual pad / old tuning value). */
  hang: number;
  /** Measured bottom of the carrier mesh below the cable (footrest / cabin floor): the clearance maths uses this. */
  drop: number;
}

const CHAIR_PRM: LiftParams = { minClearance: 0.5, minTowerHeight: 0.9, maxTowerHeight: 6, sag: 0.012, hang: 0.4, drop: 0.6 };
const GONDOLA_PRM: LiftParams = { minClearance: 0.6, minTowerHeight: 1.0, maxTowerHeight: 7, sag: 0.012, hang: 0.5, drop: 0.95 };
export const LIFT_PARAMS: Record<LiftKind, LiftParams> = {
  tbar: { minClearance: 0.1, minTowerHeight: 0.5, maxTowerHeight: 4, sag: 0.01, hang: 0.25, drop: 0.65 },
  chair2: CHAIR_PRM, chair4: CHAIR_PRM, chair4d: CHAIR_PRM, chair6: CHAIR_PRM,
  chair6b: { ...CHAIR_PRM, minClearance: 0.55, hang: 0.45, drop: 0.6 }, chair8b: { ...CHAIR_PRM, minClearance: 0.55, hang: 0.45, drop: 0.6 },
  gondola6: GONDOLA_PRM, gondola10: { ...GONDOLA_PRM, minClearance: 0.65, hang: 0.55, drop: 1.0 },
  cablecar: { minClearance: 0.8, minTowerHeight: 1.5, maxTowerHeight: 12, sag: 0.015, hang: 0.6, drop: 1.0 },
  funicular: { minClearance: 0, minTowerHeight: 0, maxTowerHeight: 0, sag: 0, hang: 0, drop: 0 },
};

/** Free air under the carrier above bare terrain (T-bar skis drag on snow: exempt). */
export const TERRAIN_CARRIER_MARGIN = 0.05;
/** Cable-over-terrain clearance the solver enforces: the old tuning value, but never less than the carrier's drop + margin (T-bar exempt). */
export const terrainClearance = (kind: LiftKind): number => {
  const p = LIFT_PARAMS[kind];
  return kind === 'tbar' || kind === 'funicular' ? p.minClearance : Math.max(p.minClearance, p.drop + TERRAIN_CARRIER_MARGIN);
};

/** Funicular track: max slope change between consecutive track steps (rise/run), after trestle/cut smoothing. */
export const FUNI_MAX_CURVATURE = 0.8;
/** Tower spacing multipliers tried in turn (denser towers) before giving up. */
export const TOWER_DENSITY_STEPS = [1, 0.75, 0.55, 0.4, 0.3];
export const STRAND_OFFSET = 0.3;

export interface TowerData { x: number; z: number; tileX: number; tileY: number; groundY: number; headY: number }

/** Plain serialisable lift. */
export interface LiftData {
  id: number;
  kind: LiftKind;
  /** Station anchors (top-left tile of the square footprint) and ground heights (world y). */
  bottom: { x: number; y: number; ground: number };
  top: { x: number; y: number; ground: number };
  towers: TowerData[];
  /** Cable/track support points bottom -> top (heads, tower heads; funicular: track points). */
  nodes: V3[];
  /** Tile indices occupied (stations, towers, funicular track). */
  tiles: number[];
  open: boolean;
  /** Operating mode: ski, foot (foot/bike passengers), mixed, or auto (default: by conditions). Additive, optional. */
  mode?: 'auto' | 'ski' | 'foot' | 'mixed';
  /** Mode the lift currently runs in (set by sim/OpenStatus); null/undefined when closed. */
  activeMode?: 'ski' | 'foot' | 'mixed' | null;
  /** Why conditions closed it (set by sim/OpenStatus). */
  closedReason?: string;
  /** 0..1 fraction of nominal speed (LIFT_MIN_SPEED..1). */
  speed: number;
  cost: number;
  /** Rider counters kept by the guest lift queues (Task 21); feeds lift-pass revenue (Task 24). Runtime only. */
  riders?: { total: number; perHour: number };
  /** Operations (sim/ops/LiftOps): schedule, eco, inspection, wear, faults. All optional (defaults filled lazily). */
  ops?: LiftOpsData;
  /** Conditions verdict from OpenStatus (undefined = not evaluated yet = open). */
  condOpen?: boolean;
  /** True while LiftOps keeps the lift closed (so conditions re-opening does not override the operator). */
  opsClosed?: boolean;
  /** Why LiftOps holds it closed (null/undefined = not held). 'hours' closures still count as "open for business" for ratings. */
  opsReason?: LiftHold | null;
  /** Eco mode currently halving the speed (empty queue). Runtime. */
  ecoActive?: boolean;
  /** Set by LiftOps when stranded riders are evacuated: queues drop them at the bottom station. */
  evac?: boolean;
}

export type LiftHold = 'manual' | 'hours' | 'season' | 'wind' | 'fault' | 'inspection';
export type LiftOpMode = 'auto' | 'open' | 'closed';
export type InspectionLevel = 'none' | 'basic' | 'thorough';
export interface LiftFault {
  /** breakdown: unplanned (strands riders); overhaul: planned repair; inspection: periodic check. */
  kind: 'breakdown' | 'overhaul' | 'inspection';
  startTick: number;
  /** Tick the work completes (hours of work already scaled by workshop/condition). */
  endTick: number;
  /** Guests on the cable when it broke. */
  stranded: number;
  incidentId: number;
  /** Rush job bought (halves remaining time once). */
  rushed?: boolean;
  /** Level for inspections. */
  level?: InspectionLevel;
}
export interface LiftOpsData {
  mode: LiftOpMode;
  /** Opening hours (0..24, may wrap past midnight when from > to). */
  from: number; to: number;
  /** 'Auto (daylight)': from/to are rewritten every tick to [sunrise + 45 min, sunset - 15 min] (sim/Daylight.ts). Absent on old saves = manual hours. */
  daylight?: boolean;
  /** Eco mode: run at half speed while nobody queues. */
  eco: boolean;
  /** Operate in each season profile. */
  seasons: { winter: boolean; shoulder: boolean; summer: boolean };
  inspection: InspectionLevel;
  /** Condition 0..100 (wear). */
  condition: number;
  /** Operating days accumulated since built (age). */
  ageDays: number;
  /** Absolute day of the last inspection (-1 = never). */
  lastInspection: number;
  fault: LiftFault | null;
  /** Dollars of energy / hours of operation accumulated today (settled by Finance at day end). */
  energyToday: number;
  runHoursToday: number;
  /** Breakdown count since built. */
  breakdowns: number;
}

// ---------- geometry helpers ----------

/** Vertical cable offset (<=0) at fraction u of a span of `len`: catenary-shaped, zero at the ends. */
export function sagOffset(u: number, len: number, sag: number): number {
  const a = 1.5;
  const c = (Math.cosh(a * (2 * u - 1)) - 1) / (Math.cosh(a) - 1); // 1 at ends, 0 at mid
  return -sag * len * (1 - c);
}

export interface CablePath {
  pts: V3[];
  /** cumulative distance along the polyline (3D), cum[0]=0. */
  cum: number[];
  length: number;
  /** Unit horizontal direction bottom->top. */
  dirX: number;
  dirZ: number;
}

export function buildPath(nodes: V3[], sag: number): CablePath {
  const pts: V3[] = [nodes[0]!];
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1]!, b = nodes[i]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = sag > 0 ? Math.max(4, Math.ceil(len / 0.5)) : 1;
    for (let k = 1; k <= n; k++) {
      const u = k / n;
      pts.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u + (sag > 0 ? sagOffset(u, len, sag) : 0), z: a.z + (b.z - a.z) * u });
    }
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1]!, q = pts[i]!;
    cum.push(cum[i - 1]! + Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z));
  }
  const f = nodes[0]!, l = nodes[nodes.length - 1]!;
  const dl = Math.hypot(l.x - f.x, l.z - f.z) || 1;
  return { pts, cum, length: cum[cum.length - 1]!, dirX: (l.x - f.x) / dl, dirZ: (l.z - f.z) / dl };
}

export interface PathSample { x: number; y: number; z: number; /** Heading yaw (rad, mesh +z forward) travelling up. */ yaw: number; pitch: number }

/** Point at distance d (clamped) along the path, shifted laterally by `lateral` (perpendicular to the overall line). */
export function samplePath(path: CablePath, d: number, lateral = 0): PathSample {
  const dd = Math.min(path.length, Math.max(0, d));
  let lo = 0, hi = path.cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (path.cum[m]! <= dd) lo = m; else hi = m; }
  const a = path.pts[lo]!, b = path.pts[hi]!;
  const seg = path.cum[hi]! - path.cum[lo]!;
  const u = seg > 0 ? (dd - path.cum[lo]!) / seg : 0;
  const hx = b.x - a.x, hz = b.z - a.z, hy = b.y - a.y;
  return {
    x: a.x + hx * u - path.dirZ * lateral,
    y: a.y + hy * u,
    z: a.z + hz * u + path.dirX * lateral,
    yaw: Math.atan2(path.dirX, path.dirZ),
    pitch: -Math.atan2(hy, Math.hypot(hx, hz) || 1),
  };
}

/** Clearance required at distance d (tiles) along a line of length `total`: tapers to 0 over the last 2 tiles at each station. */
export function requiredClearance(minClearance: number, d: number, total: number): number {
  return minClearance * Math.max(0, Math.min(1, d / 2, (total - d) / 2));
}

// ---------- stats ----------

export interface LiftStats {
  /** Horizontal length, tiles and metres. */
  lengthTiles: number;
  lengthM: number;
  /** Slant (cable) length in tiles. */
  slant: number;
  gradient: number;
  rideTimeS: number;
  /** Uphill riders per hour at the given speed fraction. */
  throughputPerHour: number;
  carriers: number;
  /** Carriers (or cabins/trains) departing per hour. throughputPerHour = carriersPerHour x capacity. */
  carriersPerHour: number;
  capacity: number;
}

export function kindDef(kind: LiftKind): LiftDef { return LIFTS[normalizeLiftKind(kind)]; }

export function liftPath(l: Pick<LiftData, 'kind' | 'nodes'>): CablePath { return buildPath(l.nodes, LIFT_PARAMS[l.kind].sag); }

export function computeStats(kindIn: LiftKind, nodes: V3[], speedFrac = 1): LiftStats {
  const kind = normalizeLiftKind(kindIn);
  const def = LIFTS[kind];
  const path = buildPath(nodes, LIFT_PARAMS[kind].sag);
  const a = nodes[0]!, b = nodes[nodes.length - 1]!;
  const horiz = Math.hypot(b.x - a.x, b.z - a.z);
  const v = def.speed * Math.max(LIFT_MIN_SPEED, Math.min(1, speedFrac));
  const rideTimeS = path.length / v;
  let cph: number, carriers: number;
  if (def.reversible) {
    carriers = 2;
    cph = 3600 / (rideTimeS + LIFT_DWELL_S);
  } else {
    carriers = Math.max(2, Math.floor((2 * path.length) / def.carrierSpacing));
    cph = (v / (((2 * path.length) / carriers) || def.carrierSpacing)) * 3600;
  }
  return {
    lengthTiles: horiz, lengthM: horiz * TILE_METRES, slant: path.length,
    gradient: horiz > 0 ? (b.y - a.y) / horiz : 0, rideTimeS, throughputPerHour: cph * def.capacityPerCarrier, carriers,
    carriersPerHour: cph, capacity: def.capacityPerCarrier,
  };
}

export const liftStats = (l: LiftData): LiftStats => computeStats(l.kind, l.nodes, l.speed * (l.ecoActive ? LIFT_ECO_FACTOR : 1));
/** Full-schedule upkeep per day (dollars) at the lift's speed setting. LiftOps scales it down for closed time. */
export const upkeepPerDay = (l: LiftData): number => liftStats({ ...l, ecoActive: false }).lengthM * LIFT_UPKEEP_PER_METRE_DAY * (0.4 + 0.6 * l.speed) * LIFTS[normalizeLiftKind(l.kind)].upkeepFactor;

// ---------- carriers ----------

export interface CarrierState extends PathSample {
  index: number;
  /** 0 = uphill strand, 1 = downhill strand. */
  strand: 0 | 1;
}

/**
 * Carrier poses for a lift after `phase` tiles of cable travel (the animator integrates speed*dt while open).
 * Loop kinds: `count` carriers evenly spread over the 2*L loop (up strand, then down strand).
 * Reversible kinds: 2 cabins in opposition with dwell at the ends.
 */
export function carrierStates(l: Pick<LiftData, 'kind' | 'nodes'>, phase: number, path: CablePath = liftPath(l)): CarrierState[] {
  const def = LIFTS[l.kind];
  const P = path.length;
  const out: CarrierState[] = [];
  const at = (d: number, strand: 0 | 1, index: number): CarrierState => {
    const s = samplePath(path, d, strand === 0 ? STRAND_OFFSET : -STRAND_OFFSET);
    return { ...s, strand, index };
  };
  if (def.reversible) {
    const D = LIFT_DWELL_S * def.speed;
    const cyc = 2 * (P + D);
    const u = ((phase % cyc) + cyc) % cyc;
    let a: number;
    if (u < D) a = 0; else if (u < D + P) a = u - D; else if (u < 2 * D + P) a = P; else a = P - (u - 2 * D - P);
    out.push(at(a, 0, 0), at(P - a, 1, 1));
    return out;
  }
  const loop = 2 * P;
  const count = Math.max(2, Math.floor(loop / def.carrierSpacing));
  for (let i = 0; i < count; i++) {
    const s = ((((phase + (i * loop) / count) % loop) + loop) % loop);
    if (s < P) out.push(at(s, 0, i));
    else out.push(at(2 * P - s, 1, i));
  }
  return out;
}

// ---------- validation ----------

export interface LiftEnv {
  grid: Grid; lifts: LiftStore; economy: Economy;
  /** Trees / shrubs under the cable (clearance + lane clearing). Absent = terrain-only rules (older tests). */
  props?: PropStore;
  /** Buildings under the cable (roof height). */
  buildings?: Buildings;
  /** Optional network facts for the 'Not connected' rule. */
  access?: NetworkAccess;
  /** Career unlock gate (config/unlocks.ts). Absent = nothing is locked. */
  gate?: UnlockGate;
}
export interface StationSite { x: number; y: number }
export interface FlattenPlan { site: StationSite; target: number; edge: 1 | 2 }
export interface LiftCheck {
  ok: boolean;
  reasons: string[];
  cost: number;
  flattenCost: number;
  flatten: boolean;
  /** Chosen flatten per station (target half-steps + max edge delta) so placement applies exactly what was previewed. */
  flattenPlan: FlattenPlan[];
  /** Tower/trestle part of `cost` (already included in `cost`). */
  supportCost: number;
  stats: LiftStats | null;
  /** Non-blocking notes, e.g. 'Bottom station not connected: needs footpath access'. */
  warnings: string[];
  /** Geometry (valid when route could be computed, even if !ok, for red preview). */
  data: Omit<LiftData, 'id'> | null;
  /** Trees the line clears (lane clearing on and needed): count, mature, net dollars (already in `cost`). */
  lane?: LanePlan & { laneCost: number };
  /** Career lock reason ('Unlocks at level 2: Local favourite'), also the first entry of `reasons`. */
  locked?: string;
}

const S = LIFT_STATION_SIZE;
export const FLAT_TOL = 1;

/** Access reasons for a lift's stations (empty = connected). Bottom needs `bottomAccess`; top `topAccess` ('none' by default). */
export function liftAccess(net: NetworkAccess | undefined, kind: LiftKind, bottom: StationSite, top: StationSite): string[] {
  if (!net) return [];
  const def = LIFTS[kind];
  const probe = (access: AccessKind, s: StationSite): boolean =>
    accessSatisfied({ access } as BuildingDef, net, { x: s.x, y: s.y, w: LIFT_STATION_SIZE, h: LIFT_STATION_SIZE });
  const out: string[] = [];
  if (!probe(def.bottomAccess, bottom)) out.push(`Not connected: bottom station needs ${def.bottomAccess === 'road' ? 'road' : 'footpath'} access`);
  if (!probe(def.topAccess, top)) out.push('Not connected: top station needs access');
  return out;
}

/** Same check for a placed lift (e.g. after path changes). */
export function liftConnection(net: NetworkAccess | undefined, l: Pick<LiftData, 'kind' | 'bottom' | 'top'>): { connected: boolean; reasons: string[] } {
  const reasons = liftAccess(net, l.kind, l.bottom, l.top);
  return { connected: reasons.length === 0, reasons };
}

export function stationAnchor(grid: Grid, cx: number, cy: number): StationSite {
  return { x: Math.max(0, Math.min(grid.size - S, Math.round(cx) - S / 2)), y: Math.max(0, Math.min(grid.size - S, Math.round(cy) - S / 2)) };
}

function spread(grid: Grid, x: number, y: number): { min: number; max: number; mean: number } {
  let min = Infinity, max = -Infinity, sum = 0, n = 0;
  for (let vy = y; vy <= y + S; vy++) for (let vx = x; vx <= x + S; vx++) {
    const v = grid.getCorner(vx, vy);
    min = Math.min(min, v); max = Math.max(max, v); sum += v; n++;
  }
  return { min, max, mean: sum / n };
}

const tileBlocked = (grid: Grid, x: number, y: number): boolean =>
  (grid.occupancy.flags[grid.occupancy.index(x, y)]! & ~OccFlag.Water & 0xff) !== 0;
const tileWater = (grid: Grid, x: number, y: number): boolean =>
  grid.occupancy.has(x, y, OccFlag.Water) || isWaterType(grid.tileType[grid.tileIndex(x, y)]!);

function flattenOpts(env: LiftEnv, edge: 1 | 2, commit: boolean, props?: PropStore): Parameters<typeof flattenRect>[3] {
  return {
    commit, props, constructionMultiplier: () => env.economy.constructionMultiplier(), maxEdgeDelta: edge,
    tolerateOccupancy: OccFlag.Path | OccFlag.Road, extraViolations: (ch) => networkSpreadViolations(env.grid, env.access, ch),
  };
}

/**
 * Cheapest way to level a station footprint: tries several target heights (mean, floor/ceil, min, max) with the gentle slope
 * blend (edge delta 1) and then the steeper blend (edge delta 2, shorter ripple, so it clears nearby water). null = impossible.
 */
function bestFlatten(env: LiftEnv, x: number, y: number, sp: { min: number; max: number; mean: number }): (FlattenPlan & { cost: number; changed: CornerChange[] }) | null {
  const targets = [...new Set([Math.round(sp.mean), Math.floor(sp.mean), Math.ceil(sp.mean), sp.min, sp.max])];
  let best: (FlattenPlan & { cost: number; changed: CornerChange[] }) | null = null;
  for (const edge of [TERRAFORM_DEFAULT_MAX_EDGE_DELTA, 2] as const) {
    for (const target of targets) {
      const r = flattenRect(env.grid, { vx0: x, vy0: y, vx1: x + S, vy1: y + S }, target, flattenOpts(env, edge, false));
      if (r.ok && (!best || r.cost < best.cost)) best = { site: { x, y }, target, edge, cost: r.cost, changed: r.changed };
    }
    if (best) break;
  }
  return best;
}

/** autoFlatten defaults to TRUE (stations are levelled and the cost is shown); pass false to forbid terraforming. */
export interface ValidateOpts {
  autoFlatten?: boolean; skipFunds?: boolean;
  /** Cut the trees the cable would hit when towers cannot clear them (default true; needs env.props). */
  clearLane?: boolean;
}

/** Pure validation (flatten is previewed and rolled back). */
export function validateLift(env: LiftEnv, kindIn: LiftKind, bottomSite: StationSite, topSite: StationSite, opts: ValidateOpts = {}): LiftCheck {
  const kind = normalizeLiftKind(kindIn);
  const { grid } = env;
  const def = LIFTS[kind];
  const prm = LIFT_PARAMS[kind];
  const out: LiftCheck = { ok: false, reasons: [], cost: 0, flattenCost: 0, flatten: false, flattenPlan: [], supportCost: 0, stats: null, warnings: [], data: null };
  const bad = (r: string): void => { if (!out.reasons.includes(r)) out.reasons.push(r); };
  const lock = env.gate?.locked('lift', kind);
  if (lock) { out.locked = lock; bad(lock); }
  const sites = [bottomSite, topSite];
  for (const s of sites) {
    if (s.x < 0 || s.y < 0 || s.x + S > grid.size || s.y + S > grid.size) { bad('Out of bounds'); return out; }
    if (s.x < 1 || s.y < 1 || s.x + S > grid.size - 1 || s.y + S > grid.size - 1) bad('Too close to the map edge');
  }
  const acc = liftAccess(env.access, kind, bottomSite, topSite);
  out.warnings.push(...acc);
  const used = new Set<number>();
  const stationGround: number[] = [];
  const planChanged: CornerChange[][] = [];
  let anyStationFail = false;
  sites.forEach((s, si) => {
    const label = si === 0 ? 'Bottom' : 'Top';
    let occupied = false, water = false;
    for (let j = s.y; j < s.y + S; j++) for (let i = s.x; i < s.x + S; i++) {
      if (tileBlocked(grid, i, j)) occupied = true;
      if (tileWater(grid, i, j)) water = true;
      const idx = grid.tileIndex(i, j);
      if (used.has(idx)) bad('Stations overlap');
      used.add(idx);
    }
    if (occupied) { bad(`${label} station site occupied`); anyStationFail = true; }
    if (water) { bad(`${label} station cannot be on water`); anyStationFail = true; }
    const sp = spread(grid, s.x, s.y);
    if (sp.max - sp.min > FLAT_TOL) {
      if (opts.autoFlatten !== false && !occupied && !water) {
        const plan = bestFlatten(env, s.x, s.y, sp);
        if (plan) { out.flatten = true; out.flattenCost += plan.cost; out.flattenPlan.push({ site: plan.site, target: plan.target, edge: plan.edge }); planChanged.push(plan.changed); stationGround.push(plan.target * HEIGHT_UNIT); }
        else { bad(`Cannot flatten ${label.toLowerCase()} station site (water, buildings or the map edge too close) \u2014 try a nearby spot`); anyStationFail = true; stationGround.push(sp.min * HEIGHT_UNIT); }
      } else if (opts.autoFlatten === false) { bad(`${label} station site too steep \u2014 enable auto-flatten (F)`); anyStationFail = true; stationGround.push(sp.min * HEIGHT_UNIT); }
      else stationGround.push(sp.min * HEIGHT_UNIT);
    } else stationGround.push(sp.min * HEIGHT_UNIT);
  });
  // A station's flatten ripple (slope blend) can reach the OTHER station and un-level it (e.g. levelling a high top station
  // raised the flat valley-floor bottom station by 1..5 steps, so placement failed after the fact). Check the combined effect:
  // apply the plans temporarily, re-plan any station that ended up out of tolerance on the modified terrain, then roll back.
  if (out.flatten && opts.autoFlatten !== false && !anyStationFail) {
    const hitsOther = planChanged.some((ch, pi) => {
      const plan = out.flattenPlan[pi]!;
      return sites.some((st) => st !== plan.site && ch.some((c) => c.vx >= st.x && c.vx <= st.x + S && c.vy >= st.y && c.vy <= st.y + S));
    });
    if (hitsOther) {
      const applied: CornerChange[] = [];
      const apply = (plan: FlattenPlan): void => { applied.push(...flattenRect(grid, { vx0: plan.site.x, vy0: plan.site.y, vx1: plan.site.x + S, vy1: plan.site.y + S }, plan.target, flattenOpts(env, plan.edge, true)).changed); };
      const before = { plan: out.flattenPlan.slice(), cost: out.flattenCost, ground: stationGround.slice() };
      let converged = false;
      try {
        for (const plan of out.flattenPlan.slice()) apply(plan);
        for (let round = 0; round < 4 && !converged; round++) {
          let again = false;
          for (let si = 0; si < sites.length; si++) {
            const st = sites[si]!, sp2 = spread(grid, st.x, st.y);
            if (sp2.max - sp2.min <= FLAT_TOL) continue;
            const plan = bestFlatten(env, st.x, st.y, sp2);
            if (!plan) { again = false; round = 99; break; }
            apply(plan);
            out.flattenPlan.push({ site: plan.site, target: plan.target, edge: plan.edge });
            out.flattenCost += plan.cost;
            stationGround[si] = plan.target * HEIGHT_UNIT;
            again = true;
          }
          if (!again && round < 99) converged = sites.every((st) => { const q = spread(grid, st.x, st.y); return q.max - q.min <= FLAT_TOL; });
        }
      } finally {
        for (let i = applied.length - 1; i >= 0; i--) { const c = applied[i]!; grid.setCornerUnchecked(c.vx, c.vy, c.from); }
      }
      // Only keep the repaired plan when it actually levels both stations; otherwise behave as before (placement re-validates).
      if (!converged) { out.flattenPlan.splice(0, out.flattenPlan.length, ...before.plan); out.flattenCost = before.cost; stationGround.splice(0, stationGround.length, ...before.ground); }
    }
  }
  const gB = stationGround[0]!, gT = stationGround[1]!;
  const hB = gB + LIFT_STATION_HEAD, hT = gT + LIFT_STATION_HEAD;
  const bc = { x: bottomSite.x + S / 2, z: bottomSite.y + S / 2 }, tc = { x: topSite.x + S / 2, z: topSite.y + S / 2 };
  const L = Math.hypot(tc.x - bc.x, tc.z - bc.z);
  out.cost = (def.costPerMetre * L * TILE_METRES + 2 * def.stationCost) * env.economy.constructionMultiplier();
  if (L < LIFT_MIN_LENGTH) bad('Too short');
  if (L > def.maxLength) bad(`Too long (max ${def.maxLength} tiles)`);
  if (gT <= gB) bad('Top station must be higher than bottom');
  const gradient = L > 0 ? (gT - gB) / L : 0;
  if (gradient > def.maxGradient) bad(`Too steep: average gradient ${Math.round(gradient * 100)}% > ${Math.round(def.maxGradient * 100)}% max for a ${def.name}`);
  if (L < 1e-6) return out;

  const dx = (tc.x - bc.x) / L, dz = (tc.z - bc.z) / L;
  const towers: TowerData[] = [];
  let nodes: V3[] = [];
  const tiles = new Set<number>(used);

  if (kind === 'funicular') {
    // Track = straight line between the stations, kept within [ground - CUT_MAX, ground + TRESTLE_MAX] (cuttings / trestles),
    // then smoothed. Water and gullies are spanned on trestles; only buildings block it.
    const n = Math.max(2, Math.ceil(L));
    const raw: number[] = [];
    for (let i = 0; i <= n; i++) raw.push(heightAt(grid, bc.x + (dx * L * i) / n, bc.z + (dz * L * i) / n));
    raw[0] = gB; raw[n] = gT;
    const lo = raw.map((r) => r - LIFT_FUNI_CUT_MAX), hi = raw.map((r) => r + LIFT_FUNI_TRESTLE_MAX);
    lo[0] = hi[0] = gB; lo[n] = hi[n] = gT;
    let sm = raw.map((_, i) => Math.min(hi[i]!, Math.max(lo[i]!, gB + ((gT - gB) * i) / n)));
    for (let pass = 0; pass < 30; pass++) {
      const nx = sm.slice();
      for (let i = 1; i < n; i++) nx[i] = Math.min(hi[i]!, Math.max(lo[i]!, (sm[i - 1]! + sm[i]! + sm[i + 1]!) / 3));
      sm = nx;
    }
    const step = L / n;
    let maxSlope = 0, maxCurv = 0, prevS = 0, trestle = 0;
    for (let i = 1; i <= n; i++) {
      const sl = (sm[i]! - sm[i - 1]!) / step;
      maxSlope = Math.max(maxSlope, Math.abs(sl));
      if (i > 1) maxCurv = Math.max(maxCurv, Math.abs(sl - prevS));
      prevS = sl;
      trestle += Math.max(0, sm[i]! - raw[i]! - 0.3) * step;
    }
    if (maxSlope > def.maxLocalGradient) bad(`Track too steep locally (${Math.round(maxSlope * 100)}% > ${Math.round(def.maxLocalGradient * 100)}%)`);
    if (maxCurv > FUNI_MAX_CURVATURE) bad('Track slope changes too sharply (pick a straighter line)');
    out.supportCost = trestle * TILE_METRES * def.costPerMetre * LIFT_TRESTLE_COST_FACTOR * env.economy.constructionMultiplier();
    out.cost += out.supportCost;
    for (let i = 0; i <= n; i++) {
      const x = bc.x + (dx * L * i) / n, z = bc.z + (dz * L * i) / n;
      nodes.push({ x, y: sm[i]! + 0.08, z });
      const tx = Math.min(grid.size - 1, Math.floor(x)), ty = Math.min(grid.size - 1, Math.floor(z));
      const idx = grid.tileIndex(tx, ty);
      if (!used.has(idx)) {
        if (tileBlocked(grid, tx, ty)) bad('Track blocked by another structure');
        else if (!tileWater(grid, tx, ty)) tiles.add(idx);
      }
    }
  } else {
    const solve = (obs: ObsMode): { ok: boolean; reason: string; towers: TowerData[]; nodes: V3[] } => {
      let lastReason = 'Cannot place towers';
      for (const mult of TOWER_DENSITY_STEPS) {
        const r = planTowers(env, kind, prm, def, bc, dx, dz, L, hB, hT, tiles, mult, obs);
        if (r.ok) {
          let seg = 0;
          for (let i = 1; i < r.nodes.length; i++) { const a = r.nodes[i - 1]!, b = r.nodes[i]!; seg = Math.max(seg, Math.abs(b.y - a.y) / (Math.hypot(b.x - a.x, b.z - a.z) || 1)); }
          if (seg <= def.maxLocalGradient || mult === TOWER_DENSITY_STEPS[TOWER_DENSITY_STEPS.length - 1]) return { ok: true, reason: '', towers: r.towers, nodes: r.nodes };
          lastReason = `Too steep locally: a cable section is ${Math.round(seg * 100)}% (max ${Math.round(def.maxLocalGradient * 100)}%)`;
          continue;
        }
        lastReason = r.reason;
        if (!r.retry) break;
      }
      return { ok: false, reason: lastReason, towers: [], nodes: [] };
    };
    const wantObs = !!(env.props || env.buildings || env.lifts.size);
    let res = solve(wantObs ? { trees: true, buildings: true } : { trees: false, buildings: false });
    let ok = res.ok;
    let lane: LanePlan | null = null;
    if (!ok && wantObs) {
      // Which obstacle is the blocker? Retry without trees, then terrain only, to give a specific reason (and an option for trees).
      const noTrees = solve({ trees: false, buildings: true });
      if (noTrees.ok) {
        if (opts.clearLane !== false && env.props) { res = noTrees; ok = true; lane = { trees: [], count: 0, mature: 0, cost: 0 }; }
        else bad('Cable would pass through trees: raise towers or clear a lane (enable \u201cClear forest lane\u201d)');
      } else {
        const bare = solve({ trees: false, buildings: false });
        if (bare.ok) {
          const nm = firstBuilding(env, bc, dx, dz, L, tiles);
          bad(nm ? `Cable would hit ${nm}` : 'Cable would hit a structure');
        } else bad(res.reason);
      }
    } else if (!ok) bad(res.reason);
    if (ok) { towers.splice(0, towers.length, ...res.towers); nodes = res.nodes; }
    if (!ok) {
      nodes = [{ x: bc.x, y: hB, z: bc.z }, { x: tc.x, y: hT, z: tc.z }];
    } else {
      for (const t of towers) tiles.add(grid.tileIndex(t.tileX, t.tileY));
      let seg = 0;
      for (let i = 1; i < nodes.length; i++) {
        const a = nodes[i - 1]!, b = nodes[i]!;
        seg = Math.max(seg, Math.abs(b.y - a.y) / (Math.hypot(b.x - a.x, b.z - a.z) || 1));
      }
      if (seg > def.maxLocalGradient) bad(`Too steep locally: a cable section is ${Math.round(seg * 100)}% (max ${Math.round(def.maxLocalGradient * 100)}%)`);
      out.supportCost = towers.reduce((a, t) => a + def.costPerMetre * LIFT_TOWER_COST_FACTOR * Math.pow(Math.max(0, t.headY - t.groundY), 1.5), 0) * env.economy.constructionMultiplier();
      out.cost += out.supportCost;
      if (env.props && wantObs) {
        // Whole lane when the tree-blocked fallback (or the option) applies; otherwise only the station approaches (always cut: nothing can clear them).
        const path = buildPath(nodes, prm.sag);
        const plan = planLane(env.props, path, prm.drop, STRAND_OFFSET, STATION_SKIP, env.props.now, lane ? 0 : STATION_APPROACH);
        const laneCost = plan.cost * env.economy.constructionMultiplier();
        if (plan.count > 0) { out.lane = { ...plan, laneCost }; out.cost += laneCost; }
      }
    }
  }

  out.data = {
    kind, bottom: { x: bottomSite.x, y: bottomSite.y, ground: gB }, top: { x: topSite.x, y: topSite.y, ground: gT },
    towers, nodes, tiles: [...tiles], open: true, speed: 1, cost: out.cost + out.flattenCost,
  };
  out.stats = computeStats(kind, nodes, 1);
  void anyStationFail;
  if (!opts.skipFunds && !env.economy.canAfford(out.cost + out.flattenCost)) bad(`Not enough funds ($${Math.ceil(out.cost + out.flattenCost)})`);
  out.ok = out.reasons.length === 0;
  return out;
}

interface ObsMode { trees: boolean; buildings: boolean }

/** Name of the first building / lift structure straight under the line (for the 'Cable would hit X' reason). */
function firstBuilding(env: LiftEnv, bc: { x: number; z: number }, dx: number, dz: number, L: number, reserved: Set<number>): string | null {
  const o = sampleObstacles(env, bc.x, bc.z, dx, dz, L, (i) => reserved.has(i), false, true);
  let best: string | null = null;
  for (let k = 0; k < o.building.length; k++) if (!noObstacle(o.building[k]!) && o.buildingName[k]) { if (o.tooTall[k]) return o.buildingName[k]!; best ??= o.buildingName[k]!; }
  return best;
}

interface TowerPlan { ok: boolean; reason: string; retry: boolean; towers: TowerData[]; nodes: V3[] }

function planTowers(
  env: LiftEnv, kind: LiftKind, prm: LiftParams, def: LiftDef, bc: { x: number; z: number },
  dx: number, dz: number, L: number, hB: number, hT: number, reserved: Set<number>, mult: number, obsMode: ObsMode = { trees: false, buildings: false },
): TowerPlan {
  const { grid } = env;
  const fail = (reason: string, retry: boolean): TowerPlan => ({ ok: false, reason, retry, towers: [], nodes: [] });
  const spans = Math.max(1, Math.ceil(L / (def.towerSpacing * mult)));
  const towers: TowerData[] = [];
  const taken = new Set<number>(reserved);
  const tm = obsMode.trees && env.props ? treeMapFor(env.props) : null;
  const ds: number[] = [0];
  for (let i = 1; i < spans; i++) {
    const base = (L * i) / spans;
    let placed = false;
    // Prefer the highest free ground within +-spacing/4 (ridge tops need the shortest towers), ties -> closest to the ideal spot.
    const reach = Math.max(1.5, (L / spans) * 0.25);
    let best: { d: number; x: number; z: number; tx: number; ty: number; g: number; score: number } | null = null;
    for (let off = -reach; off <= reach + 1e-9; off += 0.5) {
      const d = base + off;
      if (d <= 1.5 || d >= L - 1.5 || d <= ds[ds.length - 1]! + 1) continue;
      const x = bc.x + dx * d, z = bc.z + dz * d;
      const tx = Math.floor(x), ty = Math.floor(z);
      const idx = grid.tileIndex(tx, ty);
      if (taken.has(idx) || tileBlocked(grid, tx, ty) || tileWater(grid, tx, ty)) continue;
      const g = heightAt(grid, x, z);
      const score = g - Math.abs(off) * 0.05 - (tm && tm.has(tx, ty) ? 0.35 : 0); // prefer clearings: fewer trees to cut at the base
      if (!best || score > best.score) best = { d, x, z, tx, ty, g, score };
    }
    if (best) {
      taken.add(grid.tileIndex(best.tx, best.ty));
      ds.push(best.d);
      towers.push({ x: best.x, z: best.z, tileX: best.tx, tileY: best.ty, groundY: best.g, headY: 0 });
      placed = true;
    }
    if (!placed) return fail('No free tile for a tower (blocked or water)', true);
  }
  ds.push(L);
  // Obstacles under the straight line (trees, roofs, other lifts); station + tower-base tiles are cleared on build so they do not count.
  let obs: ObstacleSamples | null = null;
  if (obsMode.trees || obsMode.buildings) {
    obs = sampleObstacles(env, bc.x, bc.z, dx, dz, L, (i) => taken.has(i), obsMode.trees, obsMode.buildings, STATION_APPROACH);
    for (let k = 0; k < obs.tooTall.length; k++) if (obs.tooTall[k]) return fail(`Cable would hit ${obs.buildingName[k] ?? 'a building'}`, false);
  }
  const drop = prm.drop;
  /** Lowest cable y that keeps the carrier (hanging `drop` below) clear of what is under distance d; -Infinity when nothing. */
  const need = (d: number): number => {
    if (!obs) return -Infinity;
    const k0 = Math.floor(d / OBS_STEP), k1 = Math.min(obs.tree.length - 1, k0 + 1);
    let top = -Infinity;
    for (let k = k0; k <= k1; k++) { const t = Math.max(obs.tree[k]!, obs.building[k]!); if (!noObstacle(t) && t > top) top = t; }
    return top === -Infinity ? top : top + drop + OBSTACLE_MARGIN + 0.04; // +0.04: sampling / chord slack, the checked margin stays 0.3
  };
  const tClear = terrainClearance(kind);
  const heads = ds.map((d, i) => {
    if (i === 0) return hB;
    if (i === ds.length - 1) return hT;
    const t = towers[i - 1]!;
    return Math.max(hB + ((hT - hB) * d) / L, t.groundY + prm.minTowerHeight);
  });
  void CARRIER_HALF;
  // Highest ground under the carrier envelope: the centre line and both strands (+-STRAND_OFFSET), so a cross slope cannot put a carrier into the hill.
  const ground = (d: number): number => {
    const x = bc.x + dx * d, z = bc.z + dz * d;
    return Math.max(heightAt(grid, x, z), heightAt(grid, x - dz * STRAND_OFFSET, z + dx * STRAND_OFFSET), heightAt(grid, x + dz * STRAND_OFFSET, z - dx * STRAND_OFFSET));
  };
  for (let iter = 0; iter < 300; iter++) {
    let changed = false;
    for (let s = 0; s < ds.length - 1; s++) {
      const d0 = ds[s]!, d1 = ds[s + 1]!, len = d1 - d0;
      let worst = 0, worstU = 0.5;
      for (let k = 1; k < Math.ceil(len / 0.25); k++) {
        const u = (k * 0.25) / len;
        const y = heads[s]! + (heads[s + 1]! - heads[s]!) * u + sagOffset(u, len, prm.sag);
        const dd = d0 + len * u;
        const def2 = Math.max(requiredClearance(tClear, dd, L) - (y - ground(dd)), need(dd) - y);
        if (def2 > worst) { worst = def2; worstU = u; }
      }
      if (worst <= 1e-6) continue;
      changed = true;
      const lastS = s + 1 === ds.length - 1, firstS = s === 0;
      if (firstS && lastS) return fail(obs ? 'Cable clearance impossible (something is in the way)' : 'Cable clearance impossible (terrain in the way)', true);
      if (firstS) heads[s + 1] = heads[s + 1]! + worst / Math.max(0.15, worstU);
      else if (lastS) heads[s] = heads[s]! + worst / Math.max(0.15, 1 - worstU);
      else { heads[s] = heads[s]! + worst; heads[s + 1] = heads[s + 1]! + worst; }
    }
    for (let i = 1; i < ds.length - 1; i++) {
      if (heads[i]! - towers[i - 1]!.groundY > prm.maxTowerHeight + 1e-9) return fail(`Terrain too rugged: towers would exceed ${prm.maxTowerHeight} tall`, true);
    }
    if (!changed) break;
    if (iter === 299) return fail('Cannot reach cable clearance', true);
  }
  towers.forEach((t, i) => { t.headY = heads[i + 1]!; });
  const nodes: V3[] = ds.map((d, i) => ({ x: bc.x + dx * d, y: heads[i]!, z: bc.z + dz * d }));
  void kind;
  return { ok: true, reason: '', retry: false, towers, nodes };
}

// ---------- store ----------

export class LiftStore {
  private items = new Map<number, LiftData>();
  private nextId = 1;
  constructor(private occ: Occupancy) {}

  get size(): number { return this.items.size; }
  all(): LiftData[] { return [...this.items.values()]; }
  get(id: number): LiftData | undefined { return this.items.get(id); }

  at(x: number, y: number): LiftData | undefined {
    if (x < 0 || y < 0 || x >= this.occ.size || y >= this.occ.size) return undefined;
    if (!this.occ.has(x, y, OccFlag.Lift)) return undefined;
    return this.items.get(this.occ.entityId[this.occ.index(x, y)]!);
  }

  add(d: Omit<LiftData, 'id'>, id?: number): LiftData {
    const lid = id ?? this.nextId;
    this.nextId = Math.max(this.nextId, lid + 1);
    const l: LiftData = { ...d, kind: normalizeLiftKind(d.kind), id: lid };
    this.items.set(lid, l);
    for (const t of l.tiles) this.occ.set(t % this.occ.size, Math.floor(t / this.occ.size), OccFlag.Lift, lid);
    return l;
  }

  /** Position of lift `id` in store order (-1 when absent). */
  indexOf(id: number): number { let i = 0; for (const k of this.items.keys()) { if (k === id) return i; i++; } return -1; }
  /** Undo of a placement: hand the id out again when it was the latest. */
  rewindId(id: number): void { if (this.nextId === id + 1) this.nextId = id; }
  /** Undo of a demolish: put the exact lift record back (same id) at store position `index`. */
  reinsert(data: LiftData, index: number): LiftData {
    const l = structuredClone(data);
    const list = [...this.items.values()];
    list.splice(Math.max(0, Math.min(index, list.length)), 0, l);
    this.items = new Map(list.map((x) => [x.id, x]));
    this.nextId = Math.max(this.nextId, l.id + 1);
    for (const t of l.tiles) this.occ.set(t % this.occ.size, Math.floor(t / this.occ.size), OccFlag.Lift, l.id);
    return l;
  }

  remove(id: number): LiftData | null {
    const l = this.items.get(id);
    if (!l) return null;
    this.items.delete(id);
    for (const t of l.tiles) this.occ.clear(t % this.occ.size, Math.floor(t / this.occ.size), OccFlag.Lift);
    return l;
  }

  /** Player open/close. Sets the operating mode (closed = stays shut; open = manual open outside the schedule). */
  setOpen(id: number, open: boolean): void {
    const l = this.items.get(id);
    if (!l) return;
    l.open = open;
    if (l.ops) { l.ops.mode = open ? 'open' : 'closed'; l.opsClosed = !open; l.opsReason = open ? null : 'manual'; }
  }
  setSpeed(id: number, v: number): void { const l = this.items.get(id); if (l) l.speed = Math.max(LIFT_MIN_SPEED, Math.min(1, v)); }

  /** Save/load (Task 33): replace the store wholesale (occupancy is restored with the grid). */
  restore(data: LiftData[], nextId: number): void {
    this.items = new Map(data.map((l) => [l.id, structuredClone(l)]));
    this.nextId = Math.max(nextId, ...data.map((l) => l.id + 1), 1);
  }
  nextIdValue(): number { return this.nextId; }

  serialize(): LiftData[] { return this.all().map((l) => structuredClone(l)); }
  load(data: LiftData[]): void {
    for (const l of this.all()) this.remove(l.id);
    for (const d of data) { const { id, ...rest } = d; this.add(rest, id); }
  }
}

export interface LiftPlaceOutcome { ok: boolean; reasons: string[]; lift?: LiftData; cost: number; touchedChunks: number[] }

export function placeLift(
  env0: LiftEnv, props: PropStore | undefined, kindIn: LiftKind, bottom: StationSite, top: StationSite, autoFlatten = true, clearLane = true,
): LiftPlaceOutcome {
  const kind = normalizeLiftKind(kindIn);
  const env: LiftEnv = env0.props || !props ? env0 : { ...env0, props };
  const chk = validateLift(env, kind, bottom, top, { autoFlatten, clearLane });
  if (!chk.ok || !chk.data) return { ok: false, reasons: chk.reasons, cost: 0, touchedChunks: [] };
  const total = chk.cost + chk.flattenCost;
  if (!env.economy.charge(total)) return { ok: false, reasons: ['Not enough funds'], cost: 0, touchedChunks: [] };
  const touched: number[] = [];
  const applied: CornerChange[] = [];
  for (const plan of chk.flattenPlan) {
    const r = flattenRect(env.grid, { vx0: plan.site.x, vy0: plan.site.y, vx1: plan.site.x + S, vy1: plan.site.y + S }, plan.target, flattenOpts(env, plan.edge, true, props));
    applied.push(...r.changed);
    touched.push(...r.touchedChunks);
  }
  // Re-validate against the (now flattened) real terrain. On failure undo the flatten (newest first) and
  // only then refund, so the player is never left with altered terrain for free.
  const fin = validateLift(env, kind, bottom, top, { autoFlatten: false, skipFunds: true, clearLane });
  if (!fin.ok || !fin.data) {
    for (let i = applied.length - 1; i >= 0; i--) { const c = applied[i]!; env.grid.setCornerUnchecked(c.vx, c.vy, c.from); }
    env.economy.refund(total);
    return { ok: false, reasons: fin.reasons, cost: 0, touchedChunks: touched };
  }
  // Lane first (its indices refer to the store as validated), then the station / tower footprints.
  if (fin.lane && fin.lane.count > 0 && props) touched.push(...applyLane(props, fin.lane));
  for (const t of fin.data.tiles) props?.removeInRect(t % env.grid.size, Math.floor(t / env.grid.size), t % env.grid.size, Math.floor(t / env.grid.size), touched);
  fin.data.cost = total;
  const lift = env.lifts.add(fin.data);
  return { ok: true, reasons: [], lift, cost: total, touchedChunks: touched };
}

/** Remove a lift with 50% refund of its build cost. */
export function demolishLift(store: LiftStore, economy: Economy, id: number): { ok: boolean; refund: number } {
  const l = store.remove(id);
  if (!l) return { ok: false, refund: 0 };
  const refund = Math.round(l.cost * 0.5);
  economy.refund(refund);
  return { ok: true, refund };
}

/** Minimum distance between a ray and the lift's cable/path (3D), for picking. */
export function rayDistanceToLift(l: Pick<LiftData, 'kind' | 'nodes'>, o: V3, dir: V3): number {
  const path = liftPath(l);
  const dl = Math.hypot(dir.x, dir.y, dir.z) || 1;
  const d = { x: dir.x / dl, y: dir.y / dl, z: dir.z / dl };
  let best = Infinity;
  for (const p of path.pts) {
    const vx = p.x - o.x, vy = p.y - o.y, vz = p.z - o.z;
    const t = Math.max(0, vx * d.x + vy * d.y + vz * d.z);
    best = Math.min(best, Math.hypot(vx - d.x * t, vy - d.y * t, vz - d.z * t));
  }
  return best;
}

/**
 * Number of lifts whose cable would be closer to the terrain than its minimum clearance because of the
 * given (already applied) corner changes. Only raised corners near a lift's ground projection are considered.
 */
export function liftClearanceViolations(grid: Grid, lifts: LiftStore, changed: CornerChange[]): number {
  const raised = changed.filter((c) => c.to > c.from);
  if (!raised.length || !lifts.size) return 0;
  let bad = 0;
  for (const l of lifts.all()) {
    if (l.kind === 'funicular') continue;
    const prm = LIFT_PARAMS[l.kind];
    const near = raised.some((c) => {
      for (let i = 0; i + 1 < l.nodes.length; i++) {
        const a = l.nodes[i]!, b = l.nodes[i + 1]!;
        const abx = b.x - a.x, abz = b.z - a.z, len2 = abx * abx + abz * abz || 1;
        const t = Math.max(0, Math.min(1, ((c.vx - a.x) * abx + (c.vy - a.z) * abz) / len2));
        if (Math.hypot(c.vx - (a.x + abx * t), c.vy - (a.z + abz * t)) <= 1.5) return true;
      }
      return false;
    });
    if (!near) continue;
    let violated = false;
    const first = l.nodes[0]!, last = l.nodes[l.nodes.length - 1]!;
    const total = Math.hypot(last.x - first.x, last.z - first.z);
    for (let i = 0; i + 1 < l.nodes.length && !violated; i++) {
      const a = l.nodes[i]!, b = l.nodes[i + 1]!;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const d0 = Math.hypot(a.x - first.x, a.z - first.z);
      for (let k = 1; k < Math.ceil(len / 0.25); k++) {
        const u = (k * 0.25) / len;
        const y = a.y + (b.y - a.y) * u + sagOffset(u, len, prm.sag);
        if (y - heightAt(grid, a.x + (b.x - a.x) * u, a.z + (b.z - a.z) * u) < requiredClearance(prm.minClearance, d0 + len * u, total) - 1e-6) { violated = true; break; }
      }
    }
    if (violated) bad++;
  }
  return bad;
}

const pathCache = new WeakMap<object, CablePath>();
/** Cable path of a lift record, cached per record (nodes never change after build). */
function cachedPath(l: LiftData): CablePath {
  let p = pathCache.get(l);
  if (!p) { p = liftPath(l); pathCache.set(l, p); }
  return p;
}

/**
 * Plant-tool rule: would a tree of `kind` x `scale` planted at (px, py) - judged at its MATURE height - grow into any existing lift's carriers?
 * (Saplings are small today but would intrude later, so the rule uses the fully grown crown.) Funiculars are on the ground and exempt.
 */
export function liftPlantBlocker(lifts: LiftStore, grid: Grid): (px: number, py: number, kind: number, scale: number) => boolean {
  return (px, py, kind, scale) => {
    if (!lifts.size) return false;
    const h = matureCanopyHeight(kind, scale), r = matureCrownRadius(kind, scale);
    if (h <= 0) return false;
    const top = heightAt(grid, px, py) + h;
    for (const l of lifts.all()) {
      if (l.kind === 'funicular' || l.nodes.length < 2) continue;
      const a = l.nodes[0]!, b = l.nodes[l.nodes.length - 1]!;
      if (px < Math.min(a.x, b.x) - 3 || px > Math.max(a.x, b.x) + 3 || py < Math.min(a.z, b.z) - 3 || py > Math.max(a.z, b.z) + 3) continue;
      const dist = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const along = ((px - a.x) * (b.x - a.x) + (py - a.z) * (b.z - a.z)) / dist;
      if (along < STATION_SKIP || along > dist - STATION_SKIP) continue;
      if (carrierHits(cachedPath(l), STRAND_OFFSET, LIFT_PARAMS[l.kind].drop, px, py, r, top)) return true;
    }
    return false;
  };
}
