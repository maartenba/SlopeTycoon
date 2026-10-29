import { OccFlag } from '../../world/Occupancy';
import { NetKind } from '../../world/Networks';
import { TileType } from '../../world/Grid';
import { LIFT_STATION_SIZE } from '../../config/balance';
import type { WalkWorld } from './walkPhysics';

/**
 * Walk mode interaction helpers (Task 12). PURE (no three / DOM / sim writes): look-ray target pick, lift boarding logic, footstep surface choice.
 * The walker is NOT a sim guest: boarding a lift is a cosmetic ride (no queue slot, no ticket, no occupancy, no RNG).
 */

export type InteractKind = 'building' | 'guest' | 'animal' | 'lift';
export interface InteractBox { kind: InteractKind; id: number; label: string; minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }
export interface InteractHit { kind: InteractKind; id: number; label: string; dist: number }

/** Reach of the E key: tiles from the eye. */
export const INTERACT_RANGE = 3;

/** Ray (origin o, unit-ish direction d) vs axis-aligned boxes (slab test); nearest hit within `range`, or null. */
export function pickInteract(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, boxes: readonly InteractBox[], range = INTERACT_RANGE): InteractHit | null {
  const dl = Math.hypot(dx, dy, dz) || 1;
  dx /= dl; dy /= dl; dz /= dl;
  let best: InteractHit | null = null;
  for (const b of boxes) {
    let t0 = 0, t1 = range;
    const axis = (o: number, d: number, mn: number, mx: number): boolean => {
      if (Math.abs(d) < 1e-9) return o >= mn && o <= mx;
      let a = (mn - o) / d, c = (mx - o) / d;
      if (a > c) { const t = a; a = c; c = t; }
      if (a > t0) t0 = a;
      if (c < t1) t1 = c;
      return t0 <= t1;
    };
    if (!axis(ox, dx, b.minX, b.maxX) || !axis(oy, dy, b.minY, b.maxY) || !axis(oz, dz, b.minZ, b.maxZ)) continue;
    if (!best || t0 < best.dist) best = { kind: b.kind, id: b.id, label: b.label, dist: t0 };
  }
  return best;
}

/** Context prompt for a hit: 'E: Inspect Café'. */
export const promptFor = (h: InteractHit): string => (h.kind === 'guest' || h.kind === 'animal' ? `E: Look at ${h.label}` : `E: Inspect ${h.label}`);

// ---- lifts ----
export interface BoardableLift {
  id: number;
  name: string;
  bottom: { x: number; y: number };
  top: { x: number; y: number };
  /** N-station lifts: every station bottom -> top (boardable from all but the top one). */
  stations?: ReadonlyArray<{ x: number; y: number }>;
  open: boolean;
  closedReason?: string | null;
  /** Cable ride time in seconds at the lift's current speed (computeStats().rideTimeS). */
  rideTimeS: number;
}
/** Boarding distance: from the walker to the nearest edge of the bottom station footprint (tiles). */
export const BOARD_REACH = 2;
const REASONS: Record<string, string> = { manual: 'closed by the operator', hours: 'outside operating hours', season: 'closed for the season', wind: 'too windy', fault: 'out of order', inspection: 'being inspected' };
export const reasonText = (r: string | null | undefined): string => (r ? (REASONS[r] ?? r.replace(/^Closed:\s*/i, '')) : 'not operating');

/** Distance from point (x, z) to the square station footprint anchored at (sx, sy). */
export function stationDistance(sx: number, sy: number, x: number, z: number, size = LIFT_STATION_SIZE): number {
  const dx = Math.max(sx - x, 0, x - (sx + size)), dz = Math.max(sy - z, 0, z - (sy + size));
  return Math.hypot(dx, dz);
}
/** Nearest bottom station within reach (ties: lowest id), or null. */
export function nearestBoardable<T extends BoardableLift>(lifts: readonly T[], x: number, z: number, reach = BOARD_REACH): { lift: T; dist: number; /** Index of the station the walker boards at (0 = the bottom). */ station: number } | null {
  let best: { lift: T; dist: number; station: number } | null = null;
  for (const l of lifts) {
    const n = l.stations && l.stations.length > 2 ? l.stations.length - 1 : 1; // N-station lifts: also from the mid-stations (never the top one)
    for (let k = 0; k < n; k++) {
      const st = n === 1 ? l.bottom : l.stations![k]!;
      const d = stationDistance(st.x, st.y, x, z);
      if (d <= reach && (!best || d < best.dist - 1e-9 || (Math.abs(d - best.dist) <= 1e-9 && l.id < best.lift.id))) best = { lift: l, dist: d, station: k };
    }
  }
  return best;
}
export interface BoardVerdict { ok: boolean; prompt: string; reason: string | null }
export function boardVerdict(l: BoardableLift): BoardVerdict {
  if (!l.open) return { ok: false, prompt: `${l.name}: closed`, reason: `Lift is closed: ${reasonText(l.closedReason)}` };
  return { ok: true, prompt: `E: Board ${l.name}`, reason: null };
}
/** Cosmetic ride duration (s): the lift's real ride time (real pace, not the ride-along slow-mo), at least 3 s. */
export const cosmeticRideSeconds = (l: Pick<BoardableLift, 'rideTimeS'>): number => Math.max(3, l.rideTimeS);

/** Nearest tile centre to (x, z) that the walker can stand on (spiral search up to `maxR`), or null. */
export function nearestFree(world: WalkWorld, x: number, z: number, maxR = 8): { x: number; z: number } | null {
  const cx = Math.floor(x), cy = Math.floor(z);
  let best: { x: number; z: number } | null = null, bd = Infinity;
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const tx = cx + dx, ty = cy + dy;
      if (world.solid(tx, ty)) continue;
      const px = tx + 0.5, pz = ty + 0.5, d = Math.hypot(px - x, pz - z);
      if (d < bd) { bd = d; best = { x: px, z: pz }; }
    }
    if (best && bd <= r) break;
  }
  return best;
}

// ---- footsteps ----
export type FootSurface = 'snow' | 'gravel' | 'grass' | 'wood' | 'road';
export const SNOW_FOOT_DEPTH = 0.12;
export interface SurfaceTile { tileType: number; snowDepth: number; occFlags: number; netKind: number; bridge: boolean }
/** Pure: what the walker steps on. Bridge / building platform = wood, road = road, path = gravel, snow cover = snow, else by ground type. */
export function footSurface(t: SurfaceTile): FootSurface {
  if (t.bridge) return 'wood';
  if (t.netKind === NetKind.Road || (t.occFlags & OccFlag.Road)) return 'road';
  if (t.netKind === NetKind.Path || (t.occFlags & OccFlag.Path)) return 'gravel';
  if (t.occFlags & (OccFlag.Building | OccFlag.Lift)) return 'wood';
  if (t.snowDepth >= SNOW_FOOT_DEPTH || t.tileType === TileType.Ice) return 'snow';
  if (t.tileType === TileType.Rock || t.tileType === TileType.Dirt) return 'gravel';
  return 'grass';
}
