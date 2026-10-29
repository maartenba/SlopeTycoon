import { LIFTS, normalizeLiftKind, type LiftDef, type LiftKind } from '../config/lifts';
import type { AccessKind, BuildingDef } from '../config/buildings';
import { accessSatisfied, type NetworkAccess } from './PlacementRules';
import { networkSpreadViolations } from '../world/Networks';
import {
  HEIGHT_UNIT, LIFT_DWELL_S, LIFT_MAX_STATIONS, LIFT_MID_LINE_TOL, LIFT_MID_STATION_DWELL_S, LIFT_MID_TOWER_GAP, LIFT_FUNI_CUT_MAX, LIFT_FUNI_TRESTLE_MAX, LIFT_MIN_LENGTH, LIFT_MIN_SPEED, LIFT_STATION_HEAD,
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
  /** Hard cap on tower height (head above the ground at its foot, world units; 1 unit = 10 m). Over it the route is refused. */
  maxTowerHeight: number;
  /** Comfortable tower height: the solver tries denser towers (shorter spans) while the tallest tower exceeds it. */
  softTowerHeight: number;
  /** Hard cap relative to the longer adjacent span: a tower may not be taller than spanRatio x span (at least minTowerHeight + 0.6). */
  spanRatio: number;
  /** Midspan sag as a fraction of span length. */
  sag: number;
  /** How far carriers hang below the cable (visual pad / old tuning value). */
  hang: number;
  /** Measured bottom of the carrier mesh below the cable (footrest / cabin floor): the clearance maths uses this. */
  drop: number;
}

/** Tower height caps (world units, 1 = 10 m): hard (route refused) and soft (solver prefers denser towers above it). See docs/lifts-clearance.md. */
const TBAR_MAX_H = 3.5, TBAR_SOFT_H = 2.2;
const CHAIR_MAX_H = 5, CHAIR_SOFT_H = 3;
const GONDOLA_MAX_H = 6, GONDOLA_SOFT_H = 3.8;
const CABLECAR_MAX_H = 10, CABLECAR_SOFT_H = 7;
const CHAIR_PRM: LiftParams = { minClearance: 0.5, minTowerHeight: 0.9, maxTowerHeight: CHAIR_MAX_H, softTowerHeight: CHAIR_SOFT_H, spanRatio: 1, sag: 0.012, hang: 0.4, drop: 0.6 };
const GONDOLA_PRM: LiftParams = { minClearance: 0.6, minTowerHeight: 1.0, maxTowerHeight: GONDOLA_MAX_H, softTowerHeight: GONDOLA_SOFT_H, spanRatio: 1, sag: 0.012, hang: 0.5, drop: 0.95 };
export const LIFT_PARAMS: Record<LiftKind, LiftParams> = {
  tbar: { minClearance: 0.1, minTowerHeight: 0.5, maxTowerHeight: TBAR_MAX_H, softTowerHeight: TBAR_SOFT_H, spanRatio: 1, sag: 0.01, hang: 0.25, drop: 0.65 },
  chair2: CHAIR_PRM, chair4: CHAIR_PRM, chair4d: CHAIR_PRM, chair6: CHAIR_PRM, chair6d: CHAIR_PRM,
  chair6b: { ...CHAIR_PRM, minClearance: 0.55, hang: 0.45, drop: 0.6 }, chair8b: { ...CHAIR_PRM, minClearance: 0.55, hang: 0.45, drop: 0.6 },
  gondola6: GONDOLA_PRM, gondola10: { ...GONDOLA_PRM, minClearance: 0.65, hang: 0.55, drop: 1.0 },
  cablecar: { minClearance: 0.8, minTowerHeight: 1.5, maxTowerHeight: CABLECAR_MAX_H, softTowerHeight: CABLECAR_SOFT_H, spanRatio: 0.7, sag: 0.015, hang: 0.6, drop: 1.0 },
  funicular: { minClearance: 0, minTowerHeight: 0, maxTowerHeight: 0, softTowerHeight: 0, spanRatio: 0, sag: 0, hang: 0, drop: 0 },
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
  /**
   * N-station lifts (docs/mid-stations.md): ALL stations bottom -> top (3 or 4 entries). ABSENT for ordinary 2-station lifts (the common case:
   * saves and hashes of such lifts are unchanged); use `liftStations(l)` which derives [bottom, top] when absent.
   */
  stations?: StationRef[];
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

/** One station of an N-station lift. Mid-stations lie on the line between the terminals; their cable node is part of `LiftData.nodes`. */
export interface StationRef {
  /** Top-left tile of the 2x2 footprint and ground height (world y). */
  x: number; y: number; ground: number;
  /** Index of the station's support point in `LiftData.nodes`. */
  node: number;
  /** Guests may board / alight here (absent = both). */
  board?: boolean; alight?: boolean;
}

export type LiftHold = 'manual' | 'hours' | 'season' | 'wind' | 'fault' | 'inspection' | 'service';
export type LiftOpMode = 'auto' | 'open' | 'closed';
export type InspectionLevel = 'none' | 'basic' | 'thorough';
export interface LiftFault {
  /** breakdown: unplanned (strands riders); overhaul: planned repair; inspection: periodic check. */
  kind: 'breakdown' | 'overhaul' | 'inspection' | 'service';
  startTick: number;
  /** Tick the work completes (hours of work already scaled by workshop/condition). */
  endTick: number;
  /** Guests on the cable when it broke. */
  stranded: number;
  incidentId: number;
  /** Rush job bought (halves remaining time once). */
  rushed?: boolean;
  /** Level for inspections / planned services. */
  level?: InspectionLevel;
}
/** Planned maintenance bookkeeping (sim/ops/LiftOps.ts, config LIFT_SERVICE). Created when LiftOps first sees the lift (= commissioning counts as the first service). */
export interface LiftMaint {
  /** Absolute day of the last service (or of commissioning when `count` is 0). */
  last: number;
  /** Planned services completed so far. */
  count: number;
  /** Chosen service month (real month index, 0 = January); undefined = Auto (April for winter lifts, October for summer-only lifts). */
  window?: number;
  /** Level of the last completed service (drives the risk relief). */
  level?: 'basic' | 'thorough';
  /** Overdue news already sent: 0 none, 1 overdue, 2 critical. */
  notified?: number;
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
  /** Planned maintenance (absent until LiftOps first updates the lift). */
  maint?: LiftMaint;
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

// ---------- stations (N-station lifts) ----------

/** Kinds that may have mid-stations: gondolas, cable cars, detachable chairs (config `LiftDef.midStations`). */
export const midStationsAllowed = (kind: LiftKind): boolean => LIFTS[normalizeLiftKind(kind)].midStations;
/** All stations bottom -> top (2 for an ordinary lift). Allocates for 2-station lifts: keep it out of per-guest hot paths. */
export function liftStations(l: Pick<LiftData, 'bottom' | 'top' | 'nodes' | 'stations'>): StationRef[] {
  return l.stations ?? [{ x: l.bottom.x, y: l.bottom.y, ground: l.bottom.ground, node: 0 }, { x: l.top.x, y: l.top.y, ground: l.top.ground, node: l.nodes.length - 1 }];
}
export const stationCount = (l: Pick<LiftData, 'stations'>): number => l.stations?.length ?? 2;
export const isMultiStation = (l: Pick<LiftData, 'stations'>): boolean => (l.stations?.length ?? 2) > 2;
/** Number of intermediate stations. */
export const midCount = (l: Pick<LiftData, 'stations'>): number => Math.max(0, stationCount(l) - 2);
/** Station (index) whose 2x2 footprint contains tile (x, y), or -1. */
export function stationIndexAt(l: Pick<LiftData, 'bottom' | 'top' | 'nodes' | 'stations'>, x: number, y: number): number {
  const st = liftStations(l);
  for (let i = 0; i < st.length; i++) { const s = st[i]!; if (x >= s.x && x < s.x + LIFT_STATION_SIZE && y >= s.y && y < s.y + LIFT_STATION_SIZE) return i; }
  return -1;
}
/** Segments between consecutive stations (index k = station k -> k + 1). */
export function liftSegments(l: Pick<LiftData, 'bottom' | 'top' | 'nodes' | 'stations'>): Array<{ from: StationRef; to: StationRef; index: number }> {
  const st = liftStations(l);
  const out: Array<{ from: StationRef; to: StationRef; index: number }> = [];
  for (let i = 0; i + 1 < st.length; i++) out.push({ from: st[i]!, to: st[i + 1]!, index: i });
  return out;
}
/** Index of the cable `pts` entry of each node (mirrors buildPath). */
function nodePointIndex(nodes: V3[], sag: number): number[] {
  const idx = [0];
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1]!, b = nodes[i]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    idx.push(idx[i - 1]! + (sag > 0 ? Math.max(4, Math.ceil(len / 0.5)) : 1));
  }
  return idx;
}
/** Slant (cable) distance bottom -> each station, tiles. [0, ..., total]. */
export function stationDistances(l: Pick<LiftData, 'kind' | 'nodes' | 'bottom' | 'top' | 'stations'>): number[] {
  const path = liftPath(l), pi = nodePointIndex(l.nodes, LIFT_PARAMS[l.kind].sag);
  return liftStations(l).map((s) => path.cum[Math.min(path.cum.length - 1, pi[s.node]!)]!);
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

export function computeStats(kindIn: LiftKind, nodes: V3[], speedFrac = 1, mids = 0): LiftStats {
  const kind = normalizeLiftKind(kindIn);
  const def = LIFTS[kind];
  const path = buildPath(nodes, LIFT_PARAMS[kind].sag);
  const a = nodes[0]!, b = nodes[nodes.length - 1]!;
  const horiz = Math.hypot(b.x - a.x, b.z - a.z);
  const v = def.speed * Math.max(LIFT_MIN_SPEED, Math.min(1, speedFrac));
  const rideTimeS = path.length / v + mids * (def.reversible ? LIFT_DWELL_S : LIFT_MID_STATION_DWELL_S);
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

export const liftStats = (l: LiftData): LiftStats => computeStats(l.kind, l.nodes, l.speed * (l.ecoActive ? LIFT_ECO_FACTOR : 1), midCount(l));
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
export function carrierStates(l: Pick<LiftData, 'kind' | 'nodes'> & Partial<Pick<LiftData, 'stations'>>, phase: number, path: CablePath = liftPath(l)): CarrierState[] {
  const def = LIFTS[l.kind];
  const P = path.length;
  const out: CarrierState[] = [];
  const at = (d: number, strand: 0 | 1, index: number): CarrierState => {
    const s = samplePath(path, d, strand === 0 ? STRAND_OFFSET : -STRAND_OFFSET);
    return { ...s, strand, index };
  };
  const mids = l.stations && l.stations.length > 2 ? midDistancesOf(l as Pick<LiftData, 'kind' | 'nodes' | 'stations'>, path) : [];
  if (def.reversible) {
    // reversible: the cabin stops (dwell D) at every station, both ways; mids are visited on the way up and on the way down
    const D = LIFT_DWELL_S * def.speed;
    const stops = [0, ...mids, P];
    const seq: Array<{ len: number; from: number; to: number }> = []; // len = rope tiles; from == to is a dwell
    for (let k = 0; k < stops.length; k++) { seq.push({ len: D, from: stops[k]!, to: stops[k]! }); if (k + 1 < stops.length) seq.push({ len: stops[k + 1]! - stops[k]!, from: stops[k]!, to: stops[k + 1]! }); }
    for (let k = stops.length - 1; k >= 0; k--) { if (k < stops.length - 1 && k > 0) seq.push({ len: D, from: stops[k]!, to: stops[k]! }); if (k > 0) seq.push({ len: stops[k]! - stops[k - 1]!, from: stops[k]!, to: stops[k - 1]! }); }
    const cyc = seq.reduce((a, q) => a + q.len, 0);
    let u = ((phase % cyc) + cyc) % cyc, a = 0;
    for (const q of seq) { if (u < q.len || q === seq[seq.length - 1]) { a = q.from === q.to ? q.from : q.from + (q.to - q.from) * Math.min(1, u / q.len); break; } u -= q.len; }
    out.push(at(a, 0, 0), at(P - a, 1, 1));
    return out;
  }
  // Detachable loop: carriers slow to a crawl in a zone around each mid-station (rope coordinate r -> path distance d, see `ropeToPath`).
  const E = mids.length ? MID_SLOW_EXTRA : 0;
  const ropeLen = P + mids.length * E;
  const loop = 2 * ropeLen;
  const count = Math.max(2, Math.floor(loop / def.carrierSpacing));
  for (let i = 0; i < count; i++) {
    const s = ((((phase + (i * loop) / count) % loop) + loop) % loop);
    if (s < ropeLen) out.push(at(ropeToPath(s, mids, P), 0, i));
    else out.push(at(ropeToPath(2 * ropeLen - s, mids, P), 1, i));
  }
  return out;
}

/** Visual carrier slow-down around a mid-station (docs/mid-stations.md): zone length (tiles of cable), and the rope tiles it adds: carriers crawl at 1/10 of the line speed there. */
export const MID_SLOW_ZONE = 4;
export const MID_SLOW_EXTRA = MID_SLOW_ZONE * 9;

/** Path distance of every mid-station (slant tiles from the bottom). */
export function midDistancesOf(l: Pick<LiftData, 'kind' | 'nodes' | 'stations'>, path: CablePath): number[] {
  const pi = nodePointIndex(l.nodes, LIFT_PARAMS[l.kind].sag);
  return l.stations!.slice(1, -1).map((s) => path.cum[Math.min(path.cum.length - 1, pi[s.node]!)]!);
}

/** Cable distance -> rope coordinate (inverse of `ropeToPath`). */
export function pathToRope(d: number, mids: number[]): number {
  let r = d;
  const hz = MID_SLOW_ZONE / 2;
  for (const m of mids) r += MID_SLOW_EXTRA * Math.max(0, Math.min(1, (d - (m - hz)) / MID_SLOW_ZONE));
  return r;
}

/** Rope coordinate -> cable distance: free running at the line speed, 1/10 of it inside the MID_SLOW_ZONE around each mid-station. Monotone, continuous. */
export function ropeToPath(r: number, mids: number[], P: number): number {
  if (!mids.length) return Math.max(0, Math.min(P, r));
  const hz = MID_SLOW_ZONE / 2;
  let rope = 0, d = 0; // rope / path position of the segment start
  for (const m of mids) {
    const a = m - hz, b = m + hz; // zone start / end on the path
    if (r <= rope + (a - d)) return d + (r - rope);
    rope += a - d; d = a;
    if (r <= rope + hz * 2 + MID_SLOW_EXTRA) return d + ((r - rope) / (MID_SLOW_ZONE + MID_SLOW_EXTRA)) * MID_SLOW_ZONE;
    rope += MID_SLOW_ZONE + MID_SLOW_EXTRA; d = b;
  }
  return Math.min(P, d + (r - rope));
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
export interface FlattenPlan { site: StationSite; target: number; edge: 1 | 2; /** Preview cost of this pad (dollars, before nothing else); lets N-station validation count a shared mid pad once. */ cost?: number }
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
  /** Mid-stations (1 or 2 sites, any order: sorted along the line). Each segment is validated on its own (docs/mid-stations.md). */
  mids?: StationSite[];
  /** Internal: min distance (tiles, from the station centre) of the first / last tower from each end (default 1.5). */
  endClear?: [number, number];
}

/** Pure validation (flatten is previewed and rolled back). */
export function validateLift(env: LiftEnv, kindIn: LiftKind, bottomSite: StationSite, topSite: StationSite, opts: ValidateOpts = {}): LiftCheck {
  if (opts.mids && opts.mids.length) return validateMulti(env, normalizeLiftKind(kindIn), bottomSite, topSite, opts);
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
        if (plan) { out.flatten = true; out.flattenCost += plan.cost; out.flattenPlan.push({ site: plan.site, target: plan.target, edge: plan.edge, cost: plan.cost }); planChanged.push(plan.changed); stationGround.push(plan.target * HEIGHT_UNIT); }
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
            out.flattenPlan.push({ site: plan.site, target: plan.target, edge: plan.edge, cost: plan.cost });
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
      // Prefer MORE towers over tall ones: keep densifying while the tallest tower exceeds the soft height; of the feasible
      // layouts take the first under it, else the one with the lowest tallest tower (ties -> fewer towers).
      let best: { towers: TowerData[]; nodes: V3[]; maxH: number } | null = null;
      for (const mult of TOWER_DENSITY_STEPS) {
        const r = planTowers(env, kind, prm, def, bc, dx, dz, L, hB, hT, tiles, mult, obs, opts.endClear ?? [1.5, 1.5]);
        if (r.ok) {
          let seg = 0;
          for (let i = 1; i < r.nodes.length; i++) { const a = r.nodes[i - 1]!, b = r.nodes[i]!; seg = Math.max(seg, Math.abs(b.y - a.y) / (Math.hypot(b.x - a.x, b.z - a.z) || 1)); }
          const last = mult === TOWER_DENSITY_STEPS[TOWER_DENSITY_STEPS.length - 1];
          if (seg <= def.maxLocalGradient || last) {
            if (!best || r.maxH < best.maxH - 0.05) best = { towers: r.towers, nodes: r.nodes, maxH: r.maxH };
            if (r.maxH <= prm.softTowerHeight + 1e-9) break;
            continue;
          }
          lastReason = `Too steep locally: a cable section is ${Math.round(seg * 100)}% (max ${Math.round(def.maxLocalGradient * 100)}%)`;
          continue;
        }
        lastReason = r.reason;
        if (!r.retry) break;
      }
      if (best) return { ok: true, reason: '', towers: best.towers, nodes: best.nodes };
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

/** Perpendicular distance (tiles) of point p from the infinite line a-b, and its parameter u along a->b (0..1 between the ends). */
function lineFit(a: { x: number; z: number }, b: { x: number; z: number }, p: { x: number; z: number }): { dist: number; u: number } {
  const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1;
  const u = ((p.x - a.x) * dx + (p.z - a.z) * dz) / L2;
  return { dist: Math.hypot(p.x - (a.x + dx * u), p.z - (a.z + dz * u)), u };
}

/**
 * N-station validation: every segment (station k -> k + 1) goes through the ordinary single-segment validator (tower spacing, clearance,
 * max span, slope, length ...); the results are merged. Mid-stations need the same flat pad as terminals (auto-flatten), lie within
 * LIFT_MID_LINE_TOL of the straight terminal line, and keep every tower LIFT_MID_TOWER_GAP tiles clear of their footprint.
 * Cost = every segment's cable and towers + one station price per station (a mid-station costs as much as a terminal).
 */
function validateMulti(env: LiftEnv, kind: LiftKind, bottom: StationSite, top: StationSite, opts: ValidateOpts): LiftCheck {
  const def = LIFTS[kind];
  const out: LiftCheck = { ok: false, reasons: [], cost: 0, flattenCost: 0, flatten: false, flattenPlan: [], supportCost: 0, stats: null, warnings: [], data: null };
  const bad = (r: string): void => { if (!out.reasons.includes(r)) out.reasons.push(r); };
  const lock = env.gate?.locked('lift', kind);
  if (lock) { out.locked = lock; bad(lock); }
  const mids = opts.mids!;
  if (!def.midStations) { bad(`A ${def.name} cannot have mid-stations (gondolas, cable cars and detachable chairs only)`); return out; }
  if (mids.length + 2 > LIFT_MAX_STATIONS) { bad(`At most ${LIFT_MAX_STATIONS - 2} mid-stations per lift`); return out; }
  const bc = { x: bottom.x + S / 2, z: bottom.y + S / 2 }, tc = { x: top.x + S / 2, z: top.y + S / 2 };
  const fits = mids.map((m) => ({ site: m, ...lineFit(bc, tc, { x: m.x + S / 2, z: m.y + S / 2 }) })).sort((a, b) => a.u - b.u);
  for (const f of fits) {
    if (f.dist > LIFT_MID_LINE_TOL) bad(`Mid-station must lie on the straight line between the end stations (${f.dist.toFixed(1)} tiles off, max ${LIFT_MID_LINE_TOL})`);
    if (f.u <= 0 || f.u >= 1) bad('Mid-station must be between the end stations');
  }
  const sites = [bottom, ...fits.map((f) => f.site), top];
  const centre = (p: StationSite): { x: number; z: number } => ({ x: p.x + S / 2, z: p.y + S / 2 });
  for (let i = 0; i + 1 < sites.length; i++) {
    const a = centre(sites[i]!), b = centre(sites[i + 1]!);
    if (Math.hypot(b.x - a.x, b.z - a.z) < LIFT_MIN_LENGTH) bad('Mid-station too close to the next station');
  }
  if (out.reasons.length) return out;
  const segs: LiftCheck[] = [];
  const nameOf = (i: number, upper: boolean): string => (upper ? (i === sites.length - 2 ? 'Top station' : 'Mid-station') : (i === 0 ? 'Bottom station' : 'Mid-station'));
  for (let i = 0; i + 1 < sites.length; i++) {
    const c = validateLift(env, kind, sites[i]!, sites[i + 1]!, {
      ...opts, mids: undefined, skipFunds: true,
      endClear: [i === 0 ? 1.5 : LIFT_MID_TOWER_GAP + S / 2, i === sites.length - 2 ? 1.5 : LIFT_MID_TOWER_GAP + S / 2],
    });
    segs.push(c);
    for (const r of c.reasons) {
      let m = r.replace(/\bBottom station/, nameOf(i, false)).replace(/\bTop station/, nameOf(i, true)).replace(/\bbottom station/, nameOf(i, false).toLowerCase()).replace(/\btop station/, nameOf(i, true).toLowerCase());
      if (m === r && !/^(Not enough funds|Out of bounds|Too close to the map edge|Stations overlap|Unlocks)/.test(r)) m = `Segment ${i + 1}: ${r}`;
      bad(m);
    }
  }
  if (i0Warn(segs[0])) out.warnings.push(...segs[0]!.warnings);
  // the mid-stations' two pads must agree (each segment levels its own copy of the shared pad)
  for (let i = 0; i + 1 < segs.length; i++) {
    const a = segs[i]!.data, b = segs[i + 1]!.data;
    if (a && b && Math.abs(a.top.ground - b.bottom.ground) > 1e-6) bad('Mid-station pad cannot be levelled consistently: pick a nearby spot');
  }
  const mult = env.economy.constructionMultiplier();
  const seen = new Set<string>();
  for (const c of segs) {
    out.cost += c.cost; out.supportCost += c.supportCost;
    for (const p of c.flattenPlan) {
      const key = `${p.site.x},${p.site.y}`;
      if (seen.has(key)) continue; // the shared mid-station pad is levelled once
      seen.add(key); out.flattenPlan.push(p); out.flattenCost += p.cost ?? 0; out.flatten = true;
    }
  }
  out.cost -= (sites.length - 2) * def.stationCost * mult;
  const datas = segs.map((c) => c.data);
  if (datas.some((d) => !d)) return out;
  const towers: TowerData[] = [], nodes: V3[] = [], tiles = new Set<number>();
  const stations: StationRef[] = [];
  datas.forEach((d, i) => {
    towers.push(...d!.towers);
    if (i === 0) { nodes.push(...d!.nodes); stations.push({ x: d!.bottom.x, y: d!.bottom.y, ground: d!.bottom.ground, node: 0 }); } else nodes.push(...d!.nodes.slice(1));
    stations.push({ x: d!.top.x, y: d!.top.y, ground: d!.top.ground, node: nodes.length - 1 });
    for (const t of d!.tiles) tiles.add(t);
  });
  // towers keep clear of every mid-station footprint (the per-segment end margin covers its own line; check the other segment's too)
  for (const st of stations.slice(1, -1)) {
    for (const t of towers) {
      const gx = Math.max(st.x - t.tileX, t.tileX - (st.x + S - 1), 0), gy = Math.max(st.y - t.tileY, t.tileY - (st.y + S - 1), 0);
      if (Math.max(gx, gy) < LIFT_MID_TOWER_GAP) bad('A tower would stand too close to a mid-station');
    }
  }
  const lane = segs.filter((c) => c.lane).map((c) => c.lane!);
  if (lane.length) {
    const uniq = new Map<string, LanePlan['trees'][number]>();
    for (const l of lane) for (const t of l.trees) uniq.set(`${t.ci}:${t.i}`, t);
    out.lane = { trees: [...uniq.values()], count: lane.reduce((a, l) => a + l.count, 0), mature: lane.reduce((a, l) => a + l.mature, 0), cost: lane.reduce((a, l) => a + l.cost, 0), laneCost: lane.reduce((a, l) => a + l.laneCost, 0) };
  }
  out.data = {
    kind, bottom: datas[0]!.bottom, top: datas[datas.length - 1]!.top, towers, stations, nodes, tiles: [...tiles], open: true, speed: 1, cost: out.cost + out.flattenCost,
  };
  out.stats = computeStats(kind, nodes, 1, stations.length - 2);
  if (!opts.skipFunds && !env.economy.canAfford(out.cost + out.flattenCost)) bad(`Not enough funds ($${Math.ceil(out.cost + out.flattenCost)})`);
  out.ok = out.reasons.length === 0;
  return out;
}
const i0Warn = (c: LiftCheck | undefined): boolean => !!c && c.warnings.length > 0;

interface ObsMode { trees: boolean; buildings: boolean }

/** Name of the first building / lift structure straight under the line (for the 'Cable would hit X' reason). */
function firstBuilding(env: LiftEnv, bc: { x: number; z: number }, dx: number, dz: number, L: number, reserved: Set<number>): string | null {
  const o = sampleObstacles(env, bc.x, bc.z, dx, dz, L, (i) => reserved.has(i), false, true);
  let best: string | null = null;
  for (let k = 0; k < o.building.length; k++) if (!noObstacle(o.building[k]!) && o.buildingName[k]) { if (o.tooTall[k]) return o.buildingName[k]!; best ??= o.buildingName[k]!; }
  return best;
}

interface TowerPlan { ok: boolean; reason: string; retry: boolean; towers: TowerData[]; nodes: V3[]; /** Tallest tower (head above its ground). */ maxH: number }

function planTowers(
  env: LiftEnv, kind: LiftKind, prm: LiftParams, def: LiftDef, bc: { x: number; z: number },
  dx: number, dz: number, L: number, hB: number, hT: number, reserved: Set<number>, mult: number, obsMode: ObsMode = { trees: false, buildings: false }, endClear: [number, number] = [1.5, 1.5],
): TowerPlan {
  const { grid } = env;
  const fail = (reason: string, retry: boolean): TowerPlan => ({ ok: false, reason, retry, towers: [], nodes: [], maxH: 0 });
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
      if (d <= endClear[0] || d >= L - endClear[1] || d <= ds[ds.length - 1]! + 1) continue;
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
      const h = heads[i]! - towers[i - 1]!.groundY;
      const span = Math.max(ds[i]! - ds[i - 1]!, ds[i + 1]! - ds[i]!);
      const cap = Math.min(prm.maxTowerHeight, Math.max(prm.minTowerHeight + 0.6, prm.spanRatio * span));
      if (h > cap + 1e-9) return fail(`Towers would need to be ${Math.ceil(h * TILE_METRES)} m tall (max ${Math.floor(cap * TILE_METRES)} m): shorten the span, clear the forest lane or pick another route`, true);
    }
    if (!changed) break;
    if (iter === 299) return fail('Cannot reach cable clearance', true);
  }
  towers.forEach((t, i) => { t.headY = heads[i + 1]!; });
  const nodes: V3[] = ds.map((d, i) => ({ x: bc.x + dx * d, y: heads[i]!, z: bc.z + dz * d }));
  void kind;
  return { ok: true, reason: '', retry: false, towers, nodes, maxH: towers.reduce((m, t) => Math.max(m, t.headY - t.groundY), 0) };
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

  /** Put back a record taken out with `remove` (the SAME object: views and systems hold references) at store position `index`. */
  attach(l: LiftData, index: number): LiftData {
    const list = [...this.items.values()];
    list.splice(Math.max(0, Math.min(index, list.length)), 0, l);
    this.items = new Map(list.map((x) => [x.id, x]));
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
  env0: LiftEnv, props: PropStore | undefined, kindIn: LiftKind, bottom: StationSite, top: StationSite, autoFlatten = true, clearLane = true, mids?: StationSite[],
): LiftPlaceOutcome {
  const kind = normalizeLiftKind(kindIn);
  const env: LiftEnv = env0.props || !props ? env0 : { ...env0, props };
  const chk = validateLift(env, kind, bottom, top, { autoFlatten, clearLane, mids });
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
  const fin = validateLift(env, kind, bottom, top, { autoFlatten: false, skipFunds: true, clearLane, mids });
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

export interface MidChangeOutcome {
  ok: boolean; reasons: string[];
  /** The lift after the change (same id, same store position, ops / speed / mode / counters kept). */
  lift?: LiftData;
  /** The exact record before the change (for undo). */
  previous?: LiftData;
  /** Dollars charged (adding a mid-station: the price difference) or 0. */
  charged: number;
  /** Dollars refunded (removing one: half the price difference) or 0. */
  refunded: number;
  touchedChunks: number[];
}

/**
 * Add / move / remove the mid-stations of an existing lift (docs/mid-stations.md, Task 39): the lift is re-planned between its unchanged terminals
 * with the new mid-station list (`[]` = back to an ordinary 2-station lift). Same id and store position; operations, speed, mode and counters are kept.
 * Price: adding charges the difference to the new total (a mid-station costs as much as a terminal plus the extra cable and towers); removing refunds
 * half of the difference. The caller makes sure nobody is queueing for or riding the lift. All-or-nothing: on any failure the old lift is back untouched.
 */
export function setMidStations(env0: LiftEnv, props: PropStore | undefined, id: number, mids: StationSite[], autoFlatten = true, clearLane = true): MidChangeOutcome {
  const env: LiftEnv = env0.props || !props ? env0 : { ...env0, props };
  const fail = (reasons: string[], touchedChunks: number[] = []): MidChangeOutcome => ({ ok: false, reasons, charged: 0, refunded: 0, touchedChunks });
  const old = env.lifts.get(id);
  if (!old) return fail(['The lift is gone']);
  const previous = structuredClone(old);
  const index = env.lifts.indexOf(id);
  const bottom: StationSite = { x: old.bottom.x, y: old.bottom.y }, top: StationSite = { x: old.top.x, y: old.top.y };
  const back = (): void => { env.lifts.attach(old, index); };
  env.lifts.remove(id); // its own tiles must not block the re-plan
  const chk = validateLift(env, old.kind, bottom, top, { autoFlatten, clearLane, mids: mids.length ? mids : undefined, skipFunds: true });
  if (!chk.ok || !chk.data) { back(); return fail(chk.reasons); }
  const total = chk.cost + chk.flattenCost;
  const adding = mids.length > midCount(previous);
  const cost = adding ? Math.max(total, previous.cost) : Math.min(total, previous.cost);
  const charged = adding ? Math.max(0, Math.round(cost - previous.cost)) : 0;
  const refunded = adding ? 0 : Math.round(0.5 * Math.max(0, previous.cost - cost));
  if (charged > 0 && !env.economy.charge(charged)) { back(); return fail(['Not enough funds']); }
  const touched: number[] = [], applied: CornerChange[] = [];
  for (const plan of chk.flattenPlan) {
    const r = flattenRect(env.grid, { vx0: plan.site.x, vy0: plan.site.y, vx1: plan.site.x + S, vy1: plan.site.y + S }, plan.target, flattenOpts(env, plan.edge, true, props));
    applied.push(...r.changed); touched.push(...r.touchedChunks);
  }
  const fin = validateLift(env, old.kind, bottom, top, { autoFlatten: false, skipFunds: true, clearLane, mids: mids.length ? mids : undefined });
  if (!fin.ok || !fin.data) {
    for (let i = applied.length - 1; i >= 0; i--) { const c = applied[i]!; env.grid.setCornerUnchecked(c.vx, c.vy, c.from); }
    if (charged > 0) env.economy.refund(charged);
    back();
    return fail(fin.reasons, touched);
  }
  if (fin.lane && fin.lane.count > 0 && props) touched.push(...applyLane(props, fin.lane));
  for (const t of fin.data.tiles) props?.removeInRect(t % env.grid.size, Math.floor(t / env.grid.size), t % env.grid.size, Math.floor(t / env.grid.size), touched);
  const next: LiftData = { ...previous, bottom: fin.data.bottom, top: fin.data.top, towers: fin.data.towers, nodes: fin.data.nodes, tiles: fin.data.tiles, cost };
  if (fin.data.stations) next.stations = fin.data.stations; else delete next.stations;
  if (refunded > 0) env.economy.refund(refunded);
  env.lifts.reinsert(next, index);
  return { ok: true, reasons: [], lift: env.lifts.get(id), previous, charged, refunded, touchedChunks: touched };
}

/** Dry run of `setMidStations` (validation only, nothing is changed, the lift is put back): the check plus the money it would cost / refund. */
export function previewMids(env: LiftEnv, id: number, mids: StationSite[], opts: ValidateOpts = {}): LiftCheck & { charge: number } {
  const old = env.lifts.get(id);
  const bad = (r: string): LiftCheck & { charge: number } => ({ ok: false, reasons: [r], cost: 0, flattenCost: 0, flatten: false, flattenPlan: [], supportCost: 0, stats: null, warnings: [], data: null, charge: 0 });
  if (!old) return bad('The lift is gone');
  const index = env.lifts.indexOf(id);
  env.lifts.remove(id);
  try {
    const chk = validateLift(env, old.kind, { x: old.bottom.x, y: old.bottom.y }, { x: old.top.x, y: old.top.y }, { ...opts, mids: mids.length ? mids : undefined, skipFunds: true });
    const total = chk.cost + chk.flattenCost;
    const charge = Math.max(0, Math.round(Math.max(total, old.cost) - old.cost));
    if (chk.ok && charge > 0 && !env.economy.canAfford(charge)) { chk.ok = false; chk.reasons.push(`Not enough funds ($${charge})`); }
    return Object.assign(chk, { charge });
  } finally {
    env.lifts.attach(old, index);
  }
}

/** The mid-station site nearest to the hovered point `(cx, cy)` (tile units) that lies on the straight line of the lift: the point projected on the line, snapped to the 2x2 grid. */
export function midSiteOnLine(grid: Grid, bottom: StationSite, top: StationSite, cx: number, cy: number): StationSite {
  const bc = { x: bottom.x + S / 2, z: bottom.y + S / 2 }, tc = { x: top.x + S / 2, z: top.y + S / 2 };
  const dx = tc.x - bc.x, dz = tc.z - bc.z, L2 = dx * dx + dz * dz || 1;
  const u = Math.max(0, Math.min(1, ((cx - bc.x) * dx + (cy - bc.z) * dz) / L2));
  return stationAnchor(grid, bc.x + dx * u, bc.z + dz * u);
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
    const midD = isMultiStation(l) ? liftStations(l).slice(1, -1).map((st) => Math.hypot(l.nodes[st.node]!.x - first.x, l.nodes[st.node]!.z - first.z)) : [];
    for (let i = 0; i + 1 < l.nodes.length && !violated; i++) {
      const a = l.nodes[i]!, b = l.nodes[i + 1]!;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const d0 = Math.hypot(a.x - first.x, a.z - first.z);
      for (let k = 1; k < Math.ceil(len / 0.25); k++) {
        const u = (k * 0.25) / len;
        const y = a.y + (b.y - a.y) * u + sagOffset(u, len, prm.sag);
        const dd = d0 + len * u;
        let req = requiredClearance(prm.minClearance, dd, total);
        if (midD.length) for (const m of midD) req = Math.min(req, prm.minClearance * Math.max(0, Math.min(1, Math.abs(dd - m) / 2))); // the cable also lands in each mid-station
        if (y - heightAt(grid, a.x + (b.x - a.x) * u, a.z + (b.z - a.z) * u) < req - 1e-6) { violated = true; break; }
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
