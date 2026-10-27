import { BUILDINGS, type AccessKind, type AutoFlattenPolicy, type BuildingDef, type PisteRule, type SiteRule } from '../config/buildings';
import type { Grid } from '../world/Grid';

export interface Rect { x: number; y: number; w: number; h: number }
export type ServedKind = 'road' | 'path' | 'rail' | 'piste' | 'trail';

/** Network facts needed by the access/piste rules (implemented by world/Networks). */
export interface NetworkAccess {
  /** Footprint touches a network connected to its entry ('piste': any piste on/next to the footprint). */
  serves(kind: ServedKind, r: Rect): boolean;
  /** Any piste/trail layer on tile. */
  pisteAt(x: number, y: number): boolean;
  /** NetKind on tile (0 none, 1 path, 2 road, 3 rail). */
  kindAt(x: number, y: number): number;
  /** Why a road / path / rail footprint is NOT served although the network exists nearby (precise placement hint). */
  diagnose?(kind: 'road' | 'path' | 'rail', r: Rect): 'unlinked' | 'corner' | 'gap' | null;
}

const ACCESS_TEXT: Record<AccessKind, string> = {
  road: 'road access', path: 'footpath access', 'rail+path': 'rail and footpath access', pisteEdge: 'a piste next to it', trail: 'a hiking trail next to it', none: '',
};
/** Noun phrase per access kind for the 'Needs ...' text (a road always also counts as a footpath). */
const NEED_NOUN: Record<AccessKind, string> = { road: 'road', path: 'footpath', 'rail+path': 'rail line and a footpath', pisteEdge: 'piste', trail: 'hiking trail', none: '' };

function servedBy(kind: AccessKind, net: NetworkAccess, r: Rect): boolean {
  switch (kind) {
    case 'none': return true;
    case 'road': return net.serves('road', r);
    case 'path': return net.serves('path', r);
    case 'rail+path': return net.serves('rail', r) && net.serves('path', r);
    case 'pisteEdge': return net.serves('piste', r);
    case 'trail': return net.serves('trail', r);
  }
}

/** True when the footprint satisfies the building's access (or any alternative). Without network info: true. */
export function accessSatisfied(def: BuildingDef, net: NetworkAccess | undefined, r: Rect): boolean {
  if (!net || def.access === 'none') return true;
  return [def.access, ...(def.altAccess ?? [])].some((k) => servedBy(k, net, r));
}

/** Reason text when access is missing: 'Needs a footpath, road or piste next to it' (option list generated from the rule; used verbatim as the inspector status, advisor and toasts). */
export function accessReason(def: BuildingDef): string {
  const kinds = [def.access, ...(def.altAccess ?? [])].filter((k) => k !== 'none');
  if (!kinds.length) return '';
  const nouns: string[] = [];
  for (const k of kinds) {
    if (!nouns.includes(NEED_NOUN[k])) nouns.push(NEED_NOUN[k]);
    if (k === 'path' && !nouns.includes('road')) nouns.push('road'); // a road also serves as a footpath
  }
  const rank = (n: string): number => (n === 'piste' ? 2 : n === 'hiking trail' ? 1 : 0);
  nouns.sort((a, b) => rank(a) - rank(b)); // stable: trail then piste last ('a footpath, road, hiking trail or piste')
  const list = nouns.length === 1 ? nouns[0]! : `${nouns.slice(0, -1).join(', ')} or ${nouns[nouns.length - 1]}`;
  return `Needs a ${list} next to it`;
}

/**
 * Precise follow-up to accessReason for the ghost: WHY nearby network does not count. Rule: a network tile must share an EDGE with the
 * footprint (corners / diagonals never count) AND be linked to the road entry (a painted but unlinked footpath does not count).
 * Null when nothing is close (the plain 'Needs ...' text says it all).
 */
export function accessHint(typeId: string, net: NetworkAccess | undefined, r: Rect): string | null {
  const def = BUILDINGS[typeId];
  if (!def || !net?.diagnose || accessSatisfied(def, net, r)) return null;
  const kinds = [def.access, ...(def.altAccess ?? [])];
  const wants: Array<'road' | 'path' | 'rail'> = [];
  for (const k of kinds) {
    if (k === 'road') wants.push('road');
    else if (k === 'path') wants.push('path');
    else if (k === 'rail+path') wants.push('rail', 'path');
  }
  const noun = (k: 'road' | 'path' | 'rail'): string => (k === 'path' ? 'footpath' : k === 'rail' ? 'rail line' : 'road');
  const found = wants.map((k) => [k, net.diagnose!(k, r)] as const);
  for (const [k, d] of found) if (d === 'unlinked') return `Needs a connected ${noun(k)}: the one next to it isn't linked to the road entrance`;
  for (const [k, d] of found) if (d === 'corner') return `The ${noun(k)} touches only the corner: move it one tile (it must share a side)`;
  for (const [k, d] of found) if (d === 'gap') return `The ${noun(k)} is one tile away: move the building or extend the ${noun(k)} (it must share a side)`;
  return null;
}

/** True for a reason produced by accessReason (missing network access, as opposed to a missing prerequisite building). */
export const isAccessReason = (reason: string | undefined): boolean => /^Needs a .* next to it$/.test(reason ?? '') && /road|footpath|piste|trail|rail line/.test(reason ?? '');

/** The ONE access verdict for a placed building: null when fine (remote types always), else the accessReason text ('Needs a footpath, road or piste next to it'). */
export function accessProblem(typeId: string, net: NetworkAccess | undefined, r: Rect): string | null {
  const def = BUILDINGS[typeId];
  if (!def || accessSatisfied(def, net, r)) return null;
  return accessReason(def);
}

/**
 * True when the building is connected ONLY by trail / piste edge: no footpath or road touches the footprint
 * (remote types and rail+path never count). Such sites are supplied on foot and pay REMOTE_SUPPLY_MULT upkeep.
 */
export function suppliedOnFootOnly(def: BuildingDef, net: NetworkAccess | undefined, r: Rect): boolean {
  if (!net || def.access === 'none') return false;
  const kinds = [def.access, ...(def.altAccess ?? [])];
  if (!kinds.includes('trail') && !kinds.includes('pisteEdge')) return false;
  if (net.serves('path', r) || net.serves('road', r)) return false;
  return (kinds.includes('trail') && net.serves('trail', r)) || (kinds.includes('pisteEdge') && net.serves('piste', r));
}

export interface SlopeCheck { ok: boolean; spread: number; reason?: string }

/** Gentle-slope rule: monotone uniform gradient along the long axis, little cross-slope, bounded total rise. */
export const GENTLE_MIN_RISE = 2;
export const GENTLE_MAX_RISE = 6;

function gentle(grid: Grid, x: number, y: number, w: number, h: number): boolean {
  const alongX = w > h;
  const len = alongX ? w : h, wid = alongX ? h : w;
  const hv = (a: number, c: number): number => (alongX ? grid.getCorner(x + a, y + c) : grid.getCorner(x + c, y + a));
  const avg: number[] = [];
  for (let a = 0; a <= len; a++) {
    let mn = Infinity, mx = -Infinity, sum = 0;
    for (let c = 0; c <= wid; c++) { const v = hv(a, c); mn = Math.min(mn, v); mx = Math.max(mx, v); sum += v; }
    if (mx - mn > 1) return false; // cross-slope
    avg.push(sum / (wid + 1));
  }
  const rise = avg[len]! - avg[0]!;
  const sign = Math.sign(rise);
  if (Math.abs(rise) < GENTLE_MIN_RISE || Math.abs(rise) > GENTLE_MAX_RISE) return false;
  for (let a = 1; a <= len; a++) if ((avg[a]! - avg[a - 1]!) * sign < 0) return false;
  return true;
}

/** Slope rule of a site (flattening is decided by the caller). */
export function checkSlope(site: SiteRule, grid: Grid, x: number, y: number, w: number, h: number): SlopeCheck {
  let min = Infinity, max = -Infinity;
  for (let vy = y; vy <= y + h; vy++) for (let vx = x; vx <= x + w; vx++) {
    const v = grid.getCorner(vx, vy);
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const spread = max - min;
  if (site.slopeKind === 'gentleSlope') {
    return gentle(grid, x, y, w, h) ? { ok: true, spread } : { ok: false, spread, reason: 'Needs a gentle, uniform slope' };
  }
  if (spread > site.maxSlope) return { ok: false, spread, reason: site.slopeMessage ?? 'Too steep' };
  return { ok: true, spread };
}

/** Mean footprint corner height (half-steps). */
export function meanHeight(grid: Grid, x: number, y: number, w: number, h: number): number {
  let sum = 0, n = 0;
  for (let vy = y; vy <= y + h; vy++) for (let vx = x; vx <= x + w; vx++) { sum += grid.getCorner(vx, vy); n++; }
  return sum / n;
}

/** Default auto-flatten state when a type is picked. */
export function autoFlattenDefault(typeId: string): boolean {
  return BUILDINGS[typeId]?.site.autoFlatten === 'default';
}
export function autoFlattenPolicy(typeId: string): AutoFlattenPolicy { return BUILDINGS[typeId]?.site.autoFlatten ?? 'never'; }

export interface PlacementHints { access: AccessKind; altAccess: AccessKind[]; pisteRule: PisteRule; site: SiteRule; maxCount?: number }

/** Machine-readable rule summary for UI. */
export function placementHints(typeId: string): PlacementHints | null {
  const d = BUILDINGS[typeId];
  return d ? { access: d.access, altAccess: d.altAccess ?? [], pisteRule: d.pisteRule, site: d.site, maxCount: d.maxCount } : null;
}

/** Human-readable requirement lines (info card). */
export function describeRules(typeId: string): string[] {
  const d = BUILDINGS[typeId];
  if (!d) return [`Unknown building ${typeId}`];
  const out: string[] = [];
  if (d.access === 'none') out.push('No road needed (remote site)');
  else {
    out.push(d.access === 'pisteEdge' && !d.altAccess?.length
      ? 'Must be adjacent to a piste'
      : `Needs ${[d.access, ...(d.altAccess ?? [])].map((k) => ACCESS_TEXT[k]).join(' or ').replace('a piste next to it', 'adjacency to a piste')}`);
    out.push('Inactive ("Not connected") until access exists');
  }
  out.push(d.pisteRule === 'forbid' ? 'Cannot be built on a piste' : d.pisteRule === 'allow' ? 'May be built on a piste' : 'Not on a piste tile; sits beside one');
  const s = d.site;
  if (s.slopeKind === 'gentleSlope') out.push('Needs a gentle, uniform slope (not flat)');
  else if (!Number.isFinite(s.maxSlope)) out.push('Any slope');
  else if (s.maxSlope <= 1) out.push('Flat ground');
  else out.push(`Gentle slope (max ${s.maxSlope} half-steps)`);
  out.push(s.autoFlatten === 'default' ? 'Auto-flatten on by default' : s.autoFlatten === 'optional' ? 'Auto-flatten optional (off by default)' : 'Never changes terrain');
  if (s.onWater === 'lakeEdge') out.push('Must be on a lake shore');
  else if (s.onWater === 'shallow') out.push('May extend into lake shallows');
  else out.push('Cannot be on water or streams');
  if (d.streamAdjacent) out.push('Must stand on a stream bank (next to a stream tile)');
  if (!s.allowRock) out.push('Not on bare rock');
  if (s.minAltitude !== undefined) out.push(d.id === 'windTurbine' ? 'Exposed high ground only (upper third of the terrain)' : `Altitude at least ${s.minAltitude}`);
  if (s.maxAltitude !== undefined) out.push(`Altitude at most ${s.maxAltitude}`);
  if (d.maxCount) out.push(`Limit: ${d.maxCount} per resort`);
  for (const r of d.requires) out.push(`Needs ${BUILDINGS[r]?.name ?? r} first`);
  if (d.waterSource) out.push('Needs a Reservoir (within pipe range) or a lake nearby');
  return out;
}
