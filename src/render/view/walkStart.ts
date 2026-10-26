import { standable, settle, type WalkWorld } from './walkPhysics';

/**
 * Walk mode start positions (PURE, deterministic, no sim access): where the default entry (V / Walk) puts the walker, and how a street-view style
 * drop (click on the map) is validated and snapped. The walker always starts on a PATH / ROAD tile near the view centre and never inside a
 * blocked tile (building, lift, water without a bridge) or a trunk / decor circle: every candidate is validated with the walker's own collision world.
 */

/** Net kinds (world/Networks NetKind): path 1, road 2. Rail (3) is never a start. */
const PATH = 1, ROAD = 2;
/** How far (tiles) from the view centre a path / road tile is searched before falling back to the lodge door. */
export const START_SEARCH_RADIUS = 24;
/** A road tile counts this many tiles 'farther' than a footpath tile (footpaths are preferred). */
export const ROAD_PENALTY = 6;
/** Buildings nearer than this (tiles) are faced on entry. */
export const FACE_BUILDING_RANGE = 14;
/** Closer than this a building would fill the whole view: face along the path instead. */
export const FACE_BUILDING_MIN = 2;
/** Extra cost (tiles) of a path tile with a solid tile within 2 tiles (a wall right beside the start fills the view). */
export const WALL_PENALTY = 4;

export interface StartRect { x: number; y: number; w: number; h: number }
export interface StartOpts {
  focus: { x: number; z: number };
  /** Network kind per tile (Networks.kind: 0 none, 1 path, 2 road, 3 rail), row-major, `world.size` wide. */
  netKind: ArrayLike<number> | null;
  /** The Base Lodge (front door fallback), when built. */
  lodge?: StartRect | null;
  /** All buildings (the walker faces the nearest one). */
  buildings?: readonly StartRect[];
  /** Used when there is nothing else (the village centre). Default: the map centre. */
  centre?: { x: number; z: number };
  /** Yaw used when there is no path direction / building to face. */
  fallbackYaw?: number;
  radius?: number;
}
export type StartSource = 'path' | 'road' | 'lodge' | 'ring' | 'none';
export interface StartResult { x: number; z: number; yaw: number; source: StartSource }

/** Yaw (ViewCameraRig convention: forward = (-sin yaw, -cos yaw)) that looks along the direction (dx, dz). */
export const yawToward = (dx: number, dz: number): number => Math.atan2(-dx, -dz);

/** Nearest standable tile centre to (x, z) (ring search up to `maxR` tiles); ties broken by (z, x). Null when nothing is free. */
export function nearestStandable(world: WalkWorld, x: number, z: number, maxR = 12): { x: number; z: number } | null {
  const cx = Math.floor(x), cy = Math.floor(z);
  let best: { x: number; z: number } | null = null, bd = Infinity;
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const tx = cx + dx, ty = cy + dy;
      if (world.solid(tx, ty)) continue;
      const px = tx + 0.5, pz = ty + 0.5, d = Math.hypot(px - x, pz - z);
      if (d < bd - 1e-9 && standable(world, px, pz)) { bd = d; best = { x: px, z: pz }; }
    }
    if (best && bd <= r) break; // nothing in a farther ring can be closer
  }
  return best;
}

/** Can the walker stand at the CENTRE of tile (tx, ty)? (Not solid, no trunk / decor circle or wall within the collision radius.) */
export const tileStandable = (world: WalkWorld, tx: number, ty: number): boolean => !world.solid(tx, ty) && standable(world, tx + 0.5, ty + 0.5);

export interface DropResult {
  /** The hovered tile itself can be stood on (green); false = blocked (red). */
  ok: boolean;
  /** Where the walker would be placed (the tile centre when ok, else the nearest free tile centre). Null when nothing is free nearby. */
  x: number; z: number;
  /** Placed on another tile than the hovered one. */
  snapped: boolean;
  valid: boolean;
}
/** Validate a drop at world point (x, z): the hovered tile when walkable, else a snap to the nearest free tile. */
export function resolveDrop(world: WalkWorld, x: number, z: number, maxR = 8): DropResult {
  const tx = Math.floor(x), ty = Math.floor(z);
  if (tileStandable(world, tx, ty)) return { ok: true, x: tx + 0.5, z: ty + 0.5, snapped: false, valid: true };
  const n = nearestStandable(world, x, z, maxR);
  return n ? { ok: false, x: n.x, z: n.z, snapped: true, valid: true } : { ok: false, x: tx + 0.5, z: ty + 0.5, snapped: false, valid: false };
}

/** Direction (unit, world x/z) along the path at tile (tx, ty): the neighbour axis with the longest straight run of path tiles. Null when isolated. */
export function pathDirection(netKind: ArrayLike<number>, size: number, tx: number, ty: number): { x: number; z: number } | null {
  let best: { x: number; z: number } | null = null, bestRun = 0;
  for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
    let run = 0;
    for (let k = 1; k <= 8; k++) {
      const x = tx + dx * k, y = ty + dz * k;
      if (x < 0 || y < 0 || x >= size || y >= size) break;
      const kd = netKind[y * size + x]!;
      if (kd !== PATH && kd !== ROAD) break;
      run++;
    }
    if (run > bestRun) { bestRun = run; best = { x: dx, z: dz }; }
  }
  return best;
}

function nearestBuilding(bs: readonly StartRect[], x: number, z: number): { b: StartRect; d: number } | null {
  let best: { b: StartRect; d: number } | null = null;
  for (const b of bs) {
    const dx = Math.max(b.x - x, 0, x - (b.x + b.w)), dz = Math.max(b.y - z, 0, z - (b.y + b.h)), d = Math.hypot(dx, dz);
    if (!best || d < best.d - 1e-9) best = { b, d };
  }
  return best;
}

/** Yaw to face at a start point: the nearest building within range, else along the path, else the fallback. */
export function startYaw(opts: StartOpts, size: number, x: number, z: number): number {
  const nb = nearestBuilding(opts.buildings ?? [], x, z);
  if (nb && nb.d <= FACE_BUILDING_RANGE && nb.d >= FACE_BUILDING_MIN) return yawToward(nb.b.x + nb.b.w / 2 - x, nb.b.y + nb.b.h / 2 - z);
  const pd = opts.netKind ? pathDirection(opts.netKind, size, Math.floor(x), Math.floor(z)) : null;
  return pd ? yawToward(pd.x, pd.z) : (opts.fallbackYaw ?? 0);
}

/**
 * The default entry spot: the nearest standable PATH tile (a road tile counts ROAD_PENALTY tiles farther) within `radius` of the focus; else the
 * tile in front of the Base Lodge door; else the nearest free tile to the village centre. Deterministic (ties by tile order).
 */
export function chooseStart(world: WalkWorld, opts: StartOpts): StartResult {
  const size = world.size, nk = opts.netKind, R = opts.radius ?? START_SEARCH_RADIUS;
  const fx = Math.min(size - 1, Math.max(0, opts.focus.x)), fz = Math.min(size - 1, Math.max(0, opts.focus.z));
  if (nk) {
    const cands: Array<{ c: number; tx: number; ty: number; road: boolean }> = [];
    const x0 = Math.max(0, Math.floor(fx - R)), x1 = Math.min(size - 1, Math.floor(fx + R)), y0 = Math.max(0, Math.floor(fz - R)), y1 = Math.min(size - 1, Math.floor(fz + R));
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      const k = nk[ty * size + tx]!;
      if (k !== PATH && k !== ROAD) continue;
      const d = Math.hypot(tx + 0.5 - fx, ty + 0.5 - fz);
      if (d > R) continue;
      let wall = 0;
      for (let oy = -2; oy <= 2 && !wall; oy++) for (let ox = -2; ox <= 2; ox++) if ((ox || oy) && world.solid(tx + ox, ty + oy)) { wall = WALL_PENALTY; break; }
      cands.push({ c: d + wall + (k === ROAD ? ROAD_PENALTY : 0), tx, ty, road: k === ROAD });
    }
    cands.sort((a, b) => a.c - b.c || a.ty - b.ty || a.tx - b.tx);
    for (const c of cands) {
      if (!tileStandable(world, c.tx, c.ty)) continue;
      const x = c.tx + 0.5, z = c.ty + 0.5;
      return { x, z, yaw: startYaw(opts, size, x, z), source: c.road ? 'road' : 'path' };
    }
  }
  const l = opts.lodge;
  if (l) {
    const n = nearestStandable(world, l.x + l.w / 2, l.y + l.h + 1.2, 14);
    if (n) return { x: n.x, z: n.z, yaw: startYaw(opts, size, n.x, n.z), source: 'lodge' };
  }
  const c = opts.centre ?? { x: size / 2, z: size / 2 };
  const n = nearestStandable(world, c.x, c.z, Math.max(16, size));
  if (n) return { x: n.x, z: n.z, yaw: startYaw(opts, size, n.x, n.z), source: 'ring' };
  return { x: c.x, z: c.z, yaw: opts.fallbackYaw ?? 0, source: 'none' };
}

/** Settle a requested spawn point: the point itself when standable, else the nearest standable tile centre, else the pushed-out point. Never inside a solid tile. */
export function spawnPoint(world: WalkWorld, x: number, z: number): { x: number; z: number } | null {
  if (!world.solid(Math.floor(x), Math.floor(z)) && standable(world, x, z)) return { x, z };
  const n = nearestStandable(world, x, z, 12);
  if (n) return n;
  const s = settle(world, x, z);
  return world.solid(Math.floor(s.x), Math.floor(s.z)) ? null : { x: s.x, z: s.z };
}
