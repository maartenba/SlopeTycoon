import { BUILDINGS } from '../config/buildings';
import { BUILDING_HEIGHT, BUILDING_OVERFLY_MAX } from '../config/buildingHeights';
import { HEIGHT_UNIT, LIFT_STATION_HEAD } from '../config/balance';
import { OccFlag } from '../world/Occupancy';
import { CHUNK_SIZE, type Grid } from '../world/Grid';
import { CANOPY, matureCanopyHeight, matureCrownRadius } from '../world/TreeHeights';
import { PropStore, surfaceHeight, TREE_KINDS, VEGETATION_KINDS } from '../world/Props';
import { PLANT } from './nature/Planting';
import type { Buildings } from './Buildings';
import type { LiftStore } from './Lift';

/**
 * Lift clearance over REAL obstacles (trees, shrubs, buildings, other lift stations / towers), not only terrain. See docs/lifts-clearance.md.
 * All numbers are world units (1 tile = 10 m).
 */
/** Free air kept between a carrier's underside and the highest obstacle below it. */
export const OBSTACLE_MARGIN = 0.3;
/** Half width of the carrier envelope: strand offset (0.3) + half a carrier (0.25) is covered by treating each strand as a line and the carrier as this wide. */
export const CARRIER_HALF = 0.25;
/** Lane the clear-forest option works in: trees standing within this of the line (1.5 tiles of strand reach + crown overhang: widest crown 1.15 + strand 0.3 + carrier 0.25 = 1.7) can be cut; nothing outside is ever touched. */
export const LANE_HALF = 1.8;
/** Obstacles within this distance of a station centre (station footprint + roof) are ignored: the station area is cleared on build. */
export const STATION_SKIP = 1.2;
/** Trees within this distance of a station centre are always cut under the line (a cable cannot climb over a forest edge right at a station); beyond it towers must clear them or the lane option cuts them. */
export const STATION_APPROACH = 6;
/** Sampling step along the line for the solver. */
export const OBS_STEP = 0.25;

const NONE = -1e9;

/** Lazily-updated tile map of the highest mature canopy top per tile (absolute world y at build time + reference ground height). */
export class TreeMap {
  readonly N: number;
  readonly top: Float32Array;
  readonly ref: Float32Array;
  readonly rad: Float32Array;
  private ver: Int32Array;
  private refs: unknown[];
  maxRad = 0.8;
  constructor(readonly props: PropStore) {
    const g = props.grid;
    this.N = g.size;
    this.top = new Float32Array(g.size * g.size).fill(NONE);
    this.ref = new Float32Array(g.size * g.size);
    this.rad = new Float32Array(g.size * g.size);
    this.ver = new Int32Array(props.chunks.length).fill(-1);
    this.refs = new Array(props.chunks.length).fill(null);
  }
  /** Rebuild the chunks whose props changed since the last call (dirty-chunk update, no full scan). */
  sync(): void {
    const p = this.props;
    for (let ci = 0; ci < p.chunks.length; ci++) {
      if (this.ver[ci] === p.chunkVersion[ci] && this.refs[ci] === p.chunks[ci]) continue;
      this.rebuild(ci);
      this.ver[ci] = p.chunkVersion[ci]!; this.refs[ci] = p.chunks[ci];
    }
  }
  private rebuild(ci: number): void {
    const p = this.props, g = p.grid, N = this.N;
    const cx = (ci % p.chunksPerRow) * CHUNK_SIZE, cy = Math.floor(ci / p.chunksPerRow) * CHUNK_SIZE;
    for (let y = cy; y < Math.min(N, cy + CHUNK_SIZE); y++) for (let x = cx; x < Math.min(N, cx + CHUNK_SIZE); x++) { const i = y * N + x; this.top[i] = NONE; this.rad[i] = 0; }
    const c = p.chunks[ci]!;
    for (let k = 0; k < c.kind.length; k++) {
      const kind = c.kind[k]!;
      if (!CANOPY[kind]) continue;
      const i = c.ty[k]! * N + c.tx[k]!;
      const abs = surfaceHeight(g, c.tx[k]! + c.ox[k]!, c.ty[k]! + c.oy[k]!) + matureCanopyHeight(kind, c.scale[k]!);
      if (abs > this.top[i]!) { this.top[i] = abs; this.ref[i] = surfaceHeight(g, c.tx[k]! + 0.5, c.ty[k]! + 0.5); }
      this.rad[i] = Math.max(this.rad[i]!, matureCrownRadius(kind, c.scale[k]!));
      if (this.rad[i]! > this.maxRad) this.maxRad = this.rad[i]!; // query reach follows the widest crown ever seen
    }
  }
  /** True when the tile holds vegetation. */
  has(tx: number, ty: number): boolean { return this.top[ty * this.N + tx]! > NONE / 2; }
  /**
   * Highest canopy top (absolute y) of tiles that could reach within `half` (+ their crown radius) of point (x, z); NONE when clear.
   * `skip(tileIndex)` excludes tiles (stations / tower bases, whose trees are cleared on build). Conservative: a tree may stand anywhere in its tile.
   */
  topNear(x: number, z: number, half: number, skip?: (i: number) => boolean): number {
    const g = this.props.grid, R = this.maxRad + half, N = this.N;
    const x0 = Math.max(0, Math.floor(x - R)), x1 = Math.min(N - 1, Math.floor(x + R));
    const z0 = Math.max(0, Math.floor(z - R)), z1 = Math.min(N - 1, Math.floor(z + R));
    let best = NONE;
    for (let tz = z0; tz <= z1; tz++) for (let tx = x0; tx <= x1; tx++) {
      const i = tz * N + tx, t = this.top[i]!;
      if (t <= best || t < NONE / 2) continue;
      const dx = Math.max(tx - x, 0, x - (tx + 1)), dz = Math.max(tz - z, 0, z - (tz + 1));
      if (Math.hypot(dx, dz) > this.rad[i]! + half) continue;
      if (skip && skip(i)) continue;
      best = t + (surfaceHeight(g, tx + 0.5, tz + 0.5) - this.ref[i]!);
    }
    return best;
  }
}

const maps = new WeakMap<PropStore, TreeMap>();
/** Shared, lazily maintained tree map of a prop store (synced on every call). */
export function treeMapFor(props: PropStore): TreeMap {
  let m = maps.get(props);
  if (!m) { m = new TreeMap(props); maps.set(props, m); }
  m.sync();
  return m;
}

export interface ObstacleEnv { props?: PropStore; buildings?: Buildings; lifts?: LiftStore; grid: Grid }

/** One obstacle sample along the line. */
export interface ObstacleSamples {
  step: number;
  /** Absolute y of the highest tree / building / other-lift thing under the carrier envelope at distance k*step (NONE-ish when clear). */
  tree: Float32Array;
  building: Float32Array;
  buildingName: Array<string | undefined>;
  /** True when a building here is too tall to ever overfly (BUILDING_OVERFLY_MAX). */
  tooTall: Uint8Array;
}
export const noObstacle = (v: number): boolean => v < NONE / 2;

const footprintTop = (grid: Grid, x: number, y: number, w: number, h: number): number => {
  let m = -Infinity;
  for (let vy = y; vy <= y + h; vy++) for (let vx = x; vx <= x + w; vx++) m = Math.max(m, grid.getCorner(vx, vy));
  return m * HEIGHT_UNIT;
};

/**
 * Sample obstacles along the straight line from (bx,bz) in direction (dx,dz) of length L. `reserved` tiles (stations, tower bases) are ignored for
 * trees (they are cleared on build). Samples closer than STATION_SKIP to either end are ignored.
 */
export function sampleObstacles(env: ObstacleEnv, bx: number, bz: number, dx: number, dz: number, L: number, skip: (tileIndex: number) => boolean, withTrees = true, withBuildings = true, treeApproach = 0): ObstacleSamples {
  const n = Math.floor(L / OBS_STEP) + 1;
  const out: ObstacleSamples = { step: OBS_STEP, tree: new Float32Array(n).fill(NONE), building: new Float32Array(n).fill(NONE), buildingName: new Array(n), tooTall: new Uint8Array(n) };
  const tm = withTrees && env.props ? treeMapFor(env.props) : null;
  const grid = env.grid, N = grid.size;
  const half = CARRIER_HALF + 0.3; // envelope half width (strand offset + carrier)
  for (let k = 0; k < n; k++) {
    const d = k * OBS_STEP;
    if (d < STATION_SKIP || L - d < STATION_SKIP) continue;
    const x = bx + dx * d, z = bz + dz * d;
    if (tm && d >= treeApproach && L - d >= treeApproach) out.tree[k] = tm.topNear(x, z, half, skip);
    if (withBuildings) {
      const b0x = Math.max(0, Math.floor(x - half)), b1x = Math.min(N - 1, Math.floor(x + half));
      const b0z = Math.max(0, Math.floor(z - half)), b1z = Math.min(N - 1, Math.floor(z + half));
      for (let tz = b0z; tz <= b1z; tz++) for (let tx = b0x; tx <= b1x; tx++) {
        const i = tz * N + tx;
        if (!grid.occupancy.flags[i]) continue;
        if (skip(i)) continue;
        if (grid.occupancy.flags[i]! & OccFlag.Building && env.buildings) {
          const b = env.buildings.at(tx, tz);
          if (!b) continue;
          const h = BUILDING_HEIGHT[b.type] ?? 2.5;
          const top = footprintTop(grid, b.x, b.y, b.w, b.h) + h;
          if (top > out.building[k]!) { out.building[k] = top; out.buildingName[k] = BUILDINGS[b.type]?.name ?? b.type; out.tooTall[k] = h > BUILDING_OVERFLY_MAX ? 1 : 0; }
        } else if (grid.occupancy.flags[i]! & OccFlag.Lift && env.lifts) {
          const o = env.lifts.at(tx, tz);
          if (!o) continue;
          // Another lift's tower head / station roof (its tiles are Lift-flagged). Treated like a building: never overflown unless the cable clears it.
          const t = o.towers.find((tw) => tw.tileX === tx && tw.tileY === tz);
          const top = t ? t.headY + 0.3 : surfaceHeight(grid, tx + 0.5, tz + 0.5) + LIFT_STATION_HEAD + 0.7;
          if (top > out.building[k]!) { out.building[k] = top; out.buildingName[k] = t ? 'a lift tower' : 'a lift station'; out.tooTall[k] = 0; }
        }
      }
    }
  }
  return out;
}

// ---------- lane clearing ----------

export interface LaneTree { ci: number; i: number; kind: number; mature: boolean }
export interface LanePlan {
  trees: LaneTree[];
  count: number;
  mature: number;
  /** Net clearing cost in dollars before the construction multiplier (clear cost minus timber revenue for mature trees). */
  cost: number;
}

export interface CableLike { pts: Array<{ x: number; y: number; z: number }>; cum: number[]; length: number; dirX: number; dirZ: number }

/** Strand y/x/z at distance d (3D arclength) with the given lateral offset, same maths as Lift.samplePath. */
function strandAt(path: CableLike, d: number, lateral: number, o: { x: number; y: number; z: number }): void {
  const dd = Math.min(path.length, Math.max(0, d));
  let lo = 0, hi = path.cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (path.cum[m]! <= dd) lo = m; else hi = m; }
  const a = path.pts[lo]!, b = path.pts[hi]!;
  const seg = path.cum[hi]! - path.cum[lo]!, u = seg > 0 ? (dd - path.cum[lo]!) / seg : 0;
  o.x = a.x + (b.x - a.x) * u - path.dirZ * lateral;
  o.y = a.y + (b.y - a.y) * u;
  o.z = a.z + (b.z - a.z) * u + path.dirX * lateral;
}

/**
 * Does a carrier on this path (hanging `hang` below the cable, `margin` free air) hit a point obstacle of crown radius `r` and top `top` at (x,z)?
 * Walks the strands (+-strandOffset) at 0.1 steps. Shared by lane clearing; tests/sim/LiftClearance.test.ts re-implements it independently.
 */
export function carrierHits(path: CableLike, strand: number, hang: number, x: number, z: number, r: number, top: number, margin = OBSTACLE_MARGIN): boolean {
  const f = path.pts[0]!;
  const rx = x - f.x, rz = z - f.z;
  const along = rx * path.dirX + rz * path.dirZ, lat = -rx * path.dirZ + rz * path.dirX;
  const reach = r + CARRIER_HALF + 0.05; // +0.05: conservative against graze cases (the exact geometry test uses r + CARRIER_HALF)
  if (Math.abs(Math.abs(lat) - strand) > reach) return false;
  const proj = (i: number): number => (path.pts[i]!.x - f.x) * path.dirX + (path.pts[i]!.z - f.z) * path.dirZ;
  // first path point whose horizontal position is before along - reach
  let lo = 0, hi = path.pts.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (proj(m) <= along - reach - 0.1) lo = m; else hi = m; }
  const tmp = { x: 0, y: 0, z: 0 };
  for (let d = path.cum[lo]!; d <= path.length + 1e-9; d += 0.1) {
    strandAt(path, d, 0, tmp);
    const pa = (tmp.x - f.x) * path.dirX + (tmp.z - f.z) * path.dirZ;
    if (pa > along + reach + 0.1) break;
    for (const lt of [strand, -strand]) {
      strandAt(path, d, lt, tmp);
      if (Math.hypot(tmp.x - x, tmp.z - z) <= reach && tmp.y - hang < top + margin) return true;
    }
  }
  return false;
}

/** Trees that a final cable would hit (exact per tree) among the vegetation in chunks near the line; each is within LANE_HALF of the line. */
export function planLane(props: PropStore, path: CableLike, hang: number, strand: number, skipEnds: number, now: number, approachOnly = 0): LanePlan {
  const f = path.pts[0]!, l = path.pts[path.pts.length - 1]!;
  const horiz = Math.hypot(l.x - f.x, l.z - f.z);
  const plan: LanePlan = { trees: [], count: 0, mature: 0, cost: 0 };
  if (horiz < 1e-6) return plan;
  const pad = LANE_HALF + 0.5;
  const minX = Math.min(f.x, l.x) - pad, maxX = Math.max(f.x, l.x) + pad, minZ = Math.min(f.z, l.z) - pad, maxZ = Math.max(f.z, l.z) + pad;
  const cx0 = Math.max(0, Math.floor(minX / CHUNK_SIZE)), cx1 = Math.min(props.chunksPerRow - 1, Math.floor(maxX / CHUNK_SIZE));
  const cy0 = Math.max(0, Math.floor(minZ / CHUNK_SIZE)), cy1 = Math.min(props.chunksPerRow - 1, Math.floor(maxZ / CHUNK_SIZE));
  const veg = new Set<number>(VEGETATION_KINDS), trees = new Set<number>(TREE_KINDS);
  const g = props.grid;
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    const ci = cy * props.chunksPerRow + cx, c = props.chunks[ci]!;
    for (let i = 0; i < c.kind.length; i++) {
      const kind = c.kind[i]!;
      if (!veg.has(kind)) continue;
      const x = c.tx[i]! + c.ox[i]!, z = c.ty[i]! + c.oy[i]!;
      if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
      const rx = x - f.x, rz = z - f.z;
      const along = rx * path.dirX + rz * path.dirZ, lat = -rx * path.dirZ + rz * path.dirX;
      if (along < skipEnds - 0.5 || along > horiz - skipEnds + 0.5 || Math.abs(lat) > LANE_HALF) continue;
      if (approachOnly > 0) { const reach = matureCrownRadius(kind, c.scale[i]!) + CARRIER_HALF; if (along - reach > approachOnly && along + reach < horiz - approachOnly) continue; }
      const top = surfaceHeight(g, x, z) + matureCanopyHeight(kind, c.scale[i]!);
      if (!carrierHits(path, strand, hang, x, z, matureCrownRadius(kind, c.scale[i]!), top)) continue;
      const mature = trees.has(kind) && (c.born[i]! < 0 || now - c.born[i]! >= 0);
      plan.trees.push({ ci, i, kind, mature });
      plan.count++;
      if (mature && c.born[i]! < 0) plan.mature++;
    }
  }
  plan.cost = Math.max(0, plan.count * PLANT.clearCost - plan.mature * PLANT.timberRevenue);
  return plan;
}

/** Remove the planned lane trees from the store (one pass per chunk, indices from `planLane` on the unchanged store). Returns touched chunk indices. */
export function applyLane(props: PropStore, plan: LanePlan): number[] {
  const byChunk = new Map<number, Set<number>>();
  for (const t of plan.trees) { let s = byChunk.get(t.ci); if (!s) byChunk.set(t.ci, s = new Set()); s.add(t.i); }
  const touched: number[] = [];
  for (const [ci, idx] of byChunk) {
    const c = props.chunks[ci]!;
    const keep = { kind: [] as number[], tx: [] as number[], ty: [] as number[], ox: [] as number[], oy: [] as number[], scale: [] as number[], rot: [] as number[], seed: [] as number[], born: [] as number[] };
    for (let i = 0; i < c.kind.length; i++) {
      if (idx.has(i)) continue;
      keep.kind.push(c.kind[i]!); keep.tx.push(c.tx[i]!); keep.ty.push(c.ty[i]!); keep.ox.push(c.ox[i]!); keep.oy.push(c.oy[i]!);
      keep.scale.push(c.scale[i]!); keep.rot.push(c.rot[i]!); keep.seed.push(c.seed[i]!); keep.born.push(c.born[i]!);
    }
    props.chunks[ci] = keep;
    props.chunkVersion[ci]!++;
    touched.push(ci);
  }
  return touched;
}
