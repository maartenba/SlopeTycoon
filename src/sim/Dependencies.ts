import { BUILDINGS } from '../config/buildings';
import { WALKING_RADIUS_TILES } from '../config/balance';
import { accessReason, accessSatisfied, type NetworkAccess } from './PlacementRules';

export interface Pt { x: number; y: number }

export interface BuildingInstance extends Pt {
  id: number;
  type: string;
  active: boolean;
  reason?: string;
  /** Rotated footprint (PlacedBuilding); falls back to the catalog size. */
  w?: number;
  h?: number;
}

export interface DepContext {
  buildings: Iterable<BuildingInstance>;
  /** Lake tiles from terrain (natural lakes). */
  lakeTiles?: Pt[];
  /** Is tile (x,y) a stream tile? (hydro buildings must stand on a stream bank.) Absent = no streams known. */
  streamAt?: (x: number, y: number) => boolean;
  /** Resort core anchor (Base Lodge/village). Falls back to the Base Lodge. */
  core?: Pt | null;
  walkingRadius?: number;
  /** Footpath distance from→to, or Infinity when > max / unreachable. */
  pathDistance?: (from: Pt, to: Pt, max: number) => number;
  /** Road connectivity between two points. */
  roadConnected?: (a: Pt, b: Pt) => boolean;
  /** Road/path/rail/piste access queries (data-driven `access` rule). Absent = not evaluated. */
  access?: NetworkAccess;
}

export interface Status { active: boolean; reason?: string }
export interface PlaceResult { ok: boolean; reasons: string[] }

export const manhattanPathDistance = (a: Pt, b: Pt, max: number): number => {
  const d = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  return d > max ? Infinity : d;
};

const list = (s: DepContext) => [...s.buildings];
const has = (s: DepContext, type: string) => list(s).some((b) => b.type === type);

function hasWaterSource(s: DepContext, at?: Pt): boolean {
  const range = BUILDINGS.reservoir?.serviceRadius ?? 24;
  const res = list(s).filter((b) => b.type === 'reservoir');
  // A Reservoir must be within pipe range of the consumer (when the location is known).
  if (res.some((r) => !at || Math.hypot(r.x - at.x, r.y - at.y) <= range)) return true;
  const lakes = s.lakeTiles ?? [];
  if (!lakes.length) return false;
  return !at || lakes.some((t) => Math.abs(t.x - at.x) <= 12 && Math.abs(t.y - at.y) <= 12);
}

function lakeAdjacent(s: DepContext, b: Pt, w = 1, h = 1): boolean {
  return (s.lakeTiles ?? []).some((t) => t.x >= b.x - 1 && t.x <= b.x + w && t.y >= b.y - 1 && t.y <= b.y + h);
}

function streamAdjacent(s: DepContext, b: Pt, w = 1, h = 1): boolean {
  const at = s.streamAt;
  if (!at) return false;
  for (let y = b.y - 1; y <= b.y + h; y++) for (let x = b.x - 1; x <= b.x + w; x++) if (at(x, y)) return true;
  return false;
}

function coreOf(s: DepContext): Pt | null {
  if (s.core) return s.core;
  return list(s).find((b) => b.type === 'baseLodge') ?? null;
}

function prereqReasons(type: string, s: DepContext, at?: Pt): string[] {
  const def = BUILDINGS[type];
  if (!def) return [`Unknown building ${type}`];
  const out: string[] = [];
  for (const r of def.requires) if (!has(s, r)) out.push(`Needs ${BUILDINGS[r]?.name ?? r}`);
  if (def.waterSource && !hasWaterSource(s, at)) out.push('Needs Reservoir or Lake');
  return out;
}

/** Dependency-only placement check (geometry comes later). Stations/altiports always placeable. */
export function canPlace(type: string, s: DepContext, at?: Pt): PlaceResult {
  const def = BUILDINGS[type];
  const reasons = prereqReasons(type, s, at);
  if (def?.lakeAdjacent && at && !lakeAdjacent(s, at, def.w, def.h)) reasons.push('Must be next to a lake');
  if (def?.streamAdjacent && at && !streamAdjacent(s, at, def.w, def.h)) reasons.push('Must be next to a stream');
  if (def?.maxCount && list(s).filter((b) => b.type === type).length >= def.maxCount) {
    reasons.push(def.maxCount === 1 ? `Only one ${def.name} allowed` : `Max ${def.maxCount} ${def.name}`);
  }
  return { ok: reasons.length === 0, reasons };
}

export function evaluateStatus(b: BuildingInstance, s: DepContext): Status {
  const def = BUILDINGS[b.type];
  if (!def) return { active: false, reason: `Unknown building ${b.type}` };
  const missing = prereqReasons(b.type, s, b);
  if (missing.length) return { active: false, reason: missing[0] };
  if (def.lakeAdjacent && !lakeAdjacent(s, b, def.w, def.h)) return { active: false, reason: 'Must be next to a lake' };
  if (def.streamAdjacent && !streamAdjacent(s, b, b.w ?? def.w, b.h ?? def.h)) return { active: false, reason: 'Must be next to a stream' };
  if (!accessSatisfied(def, s.access, { x: b.x, y: b.y, w: b.w ?? def.w, h: b.h ?? def.h })) return { active: false, reason: accessReason(def) };
  if (def.shuttleDependent) {
    const radius = s.walkingRadius ?? WALKING_RADIUS_TILES;
    const core = coreOf(s);
    const dist = s.pathDistance ?? manhattanPathDistance;
    if (core && dist(b, core, radius) <= radius) return { active: true };
    const connected = s.roadConnected;
    const depots = list(s).filter((d) => d.type === 'shuttleDepot');
    if (connected && depots.some((d) => connected(b, d))) return { active: true };
    return { active: false, reason: 'Needs Shuttle Bus Depot' };
  }
  return { active: true };
}

/** Re-evaluate all buildings; returns ids whose status changed. */
export function reevaluateAll(s: DepContext): number[] {
  const changed: number[] = [];
  for (const b of list(s)) {
    const st = evaluateStatus(b, s);
    if (st.active !== b.active || st.reason !== b.reason) changed.push(b.id);
    b.active = st.active;
    b.reason = st.reason;
  }
  return changed;
}

/** Call after the building has been removed from s.buildings; cascades dependents inactive. */
export function onRemove(_removed: BuildingInstance, s: DepContext): number[] {
  return reevaluateAll(s);
}
