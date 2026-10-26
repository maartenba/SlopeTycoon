import { oldDays } from '../config/balance';
import { CHUNK_SIZE, Grid, TileType, isWaterType } from './Grid';
import { Rng } from '../core/Rng';

/** World units per half-step (mirrors config/balance HEIGHT_UNIT; kept local so world/ has no render deps). */
const H_UNIT = 0.5;

/** Kind byte is part of the save format: never renumber, only append. Conifer = spruce, Deciduous = round broadleaf. */
export const PropKind = { Conifer: 0, Deciduous: 1, Rock: 2, Pine: 3, Larch: 4, Birch: 5, Oak: 6, Shrub: 7, Snag: 8 } as const;
export type PropKindId = (typeof PropKind)[keyof typeof PropKind];
export const PROP_KIND_COUNT = 9;
/** Every kind that is vegetation (everything except rocks). */
export const VEGETATION_KINDS: readonly number[] = [
  PropKind.Conifer, PropKind.Deciduous, PropKind.Pine, PropKind.Larch, PropKind.Birch, PropKind.Oak, PropKind.Shrub, PropKind.Snag,
];
/** Vegetation excluding shrubs and snags: "real" trees. */
export const TREE_KINDS: readonly number[] = [
  PropKind.Conifer, PropKind.Deciduous, PropKind.Pine, PropKind.Larch, PropKind.Birch, PropKind.Oak,
];

const TREE_KIND_SET: ReadonlySet<number> = new Set(TREE_KINDS);

/** Placement tuning. */
export const TREES_PER_TILE_MAX = 4.5; // at density 255
export const TREE_MAX_STEEPNESS = 2.2; // half-steps per tile gradient
export const ROCK_STEEPNESS = 1.6;

/** Props of one 32x32 chunk, struct-of-arrays (parallel arrays; index = prop slot). Savable as plain data. */
export interface PropChunk {
  kind: number[];
  /** Tile coords (absolute). */
  tx: number[];
  ty: number[];
  /** Position within the tile, 0..1. */
  ox: number[];
  oy: number[];
  scale: number[];
  /** Rotation about vertical axis, radians. */
  rot: number[];
  /** Colour jitter seed, 0..255. */
  seed: number[];
  /** Absolute game day a sapling was planted; -1 = mature (generated props). Growth stages: see sim/nature/Planting. */
  born: number[];
}

function emptyChunk(): PropChunk {
  return { kind: [], tx: [], ty: [], ox: [], oy: [], scale: [], rot: [], seed: [], born: [] };
}

/** Growth timeline (game days): sapling -> young -> mature. Visual scale factor of a prop planted on `born` at day `now`. */
export const GROWTH = { youngDay: oldDays(30), matureDay: oldDays(120), saplingScale: 0.25, youngScale: 0.6 } as const;
export function growthFactor(born: number, now: number): number {
  if (born < 0) return 1;
  const a = Math.max(0, now - born);
  if (a >= GROWTH.matureDay) return 1;
  if (a >= GROWTH.youngDay) return GROWTH.youngScale + (1 - GROWTH.youngScale) * ((a - GROWTH.youngDay) / (GROWTH.matureDay - GROWTH.youngDay));
  return GROWTH.saplingScale + (GROWTH.youngScale - GROWTH.saplingScale) * (a / GROWTH.youngDay);
}
export type GrowthStage = 'sapling' | 'young' | 'mature';
export function growthStage(born: number, now: number): GrowthStage {
  if (born < 0) return 'mature';
  const a = now - born;
  return a >= GROWTH.matureDay ? 'mature' : a >= GROWTH.youngDay ? 'young' : 'sapling';
}

/** Surface height (world units) at world (x, y) = tile-space coordinates, bilinear over the tile's corners. */
export function surfaceHeight(grid: Grid, wx: number, wy: number): number {
  const tx = Math.min(grid.size - 1, Math.max(0, Math.floor(wx)));
  const ty = Math.min(grid.size - 1, Math.max(0, Math.floor(wy)));
  const u = wx - tx, v = wy - ty;
  const [n, e, s, w] = grid.getCorners(tx, ty);
  const h = n * (1 - u) * (1 - v) + e * u * (1 - v) + s * u * v + w * (1 - u) * v;
  return h * H_UNIT;
}

export class PropStore {
  readonly chunksPerRow: number;
  readonly chunks: PropChunk[];
  /** Bumped on every mutation of a chunk; renderers compare to detect staleness. */
  readonly chunkVersion: Uint32Array;
  /** Current absolute game day (set by the sim); renderers scale growing props with growthFactor(born, now). */
  now = 0;
  /** Running totals of real trees (TREE_KINDS) removed / planted since this store was created (sustainability, Task 23). Saved by the `rivals` module. */
  treesFelled = 0;
  treesPlanted = 0;

  constructor(readonly grid: Grid) {
    this.chunksPerRow = grid.chunksPerRow;
    this.chunks = Array.from({ length: this.chunksPerRow ** 2 }, emptyChunk);
    this.chunkVersion = new Uint32Array(this.chunks.length);
  }

  propsInChunk(cx: number, cy: number): PropChunk {
    return this.chunks[cy * this.chunksPerRow + cx]!;
  }

  count(): number {
    let n = 0;
    for (const c of this.chunks) n += c.kind.length;
    return n;
  }

  countByKind(): number[] {
    const out = new Array<number>(PROP_KIND_COUNT).fill(0);
    for (const c of this.chunks) for (const k of c.kind) out[k]!++;
    return out;
  }

  add(kind: number, tx: number, ty: number, ox: number, oy: number, scale: number, rot: number, seed: number, born = -1): void {
    const ci = ((ty / CHUNK_SIZE) | 0) * this.chunksPerRow + ((tx / CHUNK_SIZE) | 0);
    const c = this.chunks[ci]!;
    c.kind.push(kind); c.tx.push(tx); c.ty.push(ty); c.ox.push(ox); c.oy.push(oy);
    c.scale.push(scale); c.rot.push(rot); c.seed.push(seed); c.born.push(born);
    this.chunkVersion[ci]!++;
    if (born >= 0 && TREE_KIND_SET.has(kind)) this.treesPlanted++;
  }

  /** Number of props on tiles x0..x1, y0..y1 (inclusive); optional kind filter. */
  countInRect(x0: number, y0: number, x1: number, y1: number, filter?: (kind: number) => boolean): number {
    const last = this.chunksPerRow - 1;
    const lx = Math.min(x0, x1), hx = Math.max(x0, x1), ly = Math.min(y0, y1), hy = Math.max(y0, y1);
    const cx0 = Math.max(0, Math.floor(lx / CHUNK_SIZE)), cx1 = Math.min(last, Math.floor(hx / CHUNK_SIZE));
    const cy0 = Math.max(0, Math.floor(ly / CHUNK_SIZE)), cy1 = Math.min(last, Math.floor(hy / CHUNK_SIZE));
    let n = 0;
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const c = this.chunks[cy * this.chunksPerRow + cx]!;
      for (let i = 0; i < c.kind.length; i++) {
        if (c.tx[i]! >= lx && c.tx[i]! <= hx && c.ty[i]! >= ly && c.ty[i]! <= hy && (!filter || filter(c.kind[i]!))) n++;
      }
    }
    return n;
  }

  /** Remove all props on tiles x0..x1, y0..y1 (inclusive). Returns number removed. Returns affected chunks via `touched`. */
  removeInRect(x0: number, y0: number, x1: number, y1: number, touched?: number[], filter?: (kind: number) => boolean): number {
    const last = this.chunksPerRow - 1;
    const cx0 = Math.max(0, Math.floor(Math.min(x0, x1) / CHUNK_SIZE)), cx1 = Math.min(last, Math.floor(Math.max(x0, x1) / CHUNK_SIZE));
    const cy0 = Math.max(0, Math.floor(Math.min(y0, y1) / CHUNK_SIZE)), cy1 = Math.min(last, Math.floor(Math.max(y0, y1) / CHUNK_SIZE));
    const lx = Math.min(x0, x1), hx = Math.max(x0, x1), ly = Math.min(y0, y1), hy = Math.max(y0, y1);
    let removed = 0;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const ci = cy * this.chunksPerRow + cx;
        const c = this.chunks[ci]!;
        const keep = emptyChunk();
        for (let i = 0; i < c.kind.length; i++) {
          const inside = c.tx[i]! >= lx && c.tx[i]! <= hx && c.ty[i]! >= ly && c.ty[i]! <= hy && (!filter || filter(c.kind[i]!));
          if (inside) { removed++; if (TREE_KIND_SET.has(c.kind[i]!)) this.treesFelled++; continue; }
          keep.kind.push(c.kind[i]!); keep.tx.push(c.tx[i]!); keep.ty.push(c.ty[i]!);
          keep.ox.push(c.ox[i]!); keep.oy.push(c.oy[i]!); keep.scale.push(c.scale[i]!);
          keep.rot.push(c.rot[i]!); keep.seed.push(c.seed[i]!); keep.born.push(c.born[i]!);
        }
        if (keep.kind.length !== c.kind.length) {
          this.chunks[ci] = keep;
          this.chunkVersion[ci]!++;
          touched?.push(ci);
        }
      }
    }
    return removed;
  }

  /** World-space Y of prop i of a chunk, following the *current* terrain (used by the refresh path). */
  propY(c: PropChunk, i: number): number {
    return surfaceHeight(this.grid, c.tx[i]! + c.ox[i]!, c.ty[i]! + c.oy[i]!);
  }
}

// Species weights by altitude anchor (hFrac 0.1 / 0.35 / 0.6 / 0.85):
// order = Conifer, Deciduous, Pine, Larch, Birch, Oak, Shrub, Snag
const KIND_ORDER = [PropKind.Conifer, PropKind.Deciduous, PropKind.Pine, PropKind.Larch, PropKind.Birch, PropKind.Oak, PropKind.Shrub, PropKind.Snag];
const ZONE_ANCHORS = [0.1, 0.35, 0.6, 0.85];
const ZONE_WEIGHTS: number[][] = [
  [0.10, 0.25, 0.04, 0.00, 0.20, 0.25, 0.16, 0.00], // lowland: broadleaf, birch, oak
  [0.28, 0.15, 0.18, 0.08, 0.10, 0.06, 0.15, 0.00], // mixed
  [0.32, 0.02, 0.22, 0.26, 0.02, 0.00, 0.14, 0.02], // montane conifers + larch
  [0.30, 0.00, 0.10, 0.15, 0.00, 0.00, 0.20, 0.25], // subalpine: scrub + dead snags
];
const BROADLEAF = new Set<number>([PropKind.Deciduous, PropKind.Birch, PropKind.Oak]);
const KIND_SCALE: Record<number, number> = {
  [PropKind.Conifer]: 1, [PropKind.Deciduous]: 1, [PropKind.Pine]: 1.1, [PropKind.Larch]: 1.05,
  [PropKind.Birch]: 0.95, [PropKind.Oak]: 1.1, [PropKind.Shrub]: 0.6, [PropKind.Snag]: 0.9,
};

function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in 0..1 with feature size `scale` tiles. */
export function valueNoise(x: number, y: number, scale: number, seed: number): number {
  const fx = x / scale, fy = y / scale;
  const ix = Math.floor(fx), iy = Math.floor(fy);
  const u = fx - ix, v = fy - iy;
  const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed), c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}

/** Pick a vegetation kind for a tile from altitude, slope, forest-type cluster noise and local density. Deterministic given `r` in [0,1). */
export function pickVegetation(hFrac: number, steep: number, cluster: number, density: number, r: number): number {
  let lo = 0, hi = 0, f = 0;
  if (hFrac <= ZONE_ANCHORS[0]!) { lo = hi = 0; }
  else if (hFrac >= ZONE_ANCHORS[3]!) { lo = hi = 3; }
  else {
    while (hFrac > ZONE_ANCHORS[hi + 1]!) hi++;
    lo = hi; hi = lo + 1;
    f = (hFrac - ZONE_ANCHORS[lo]!) / (ZONE_ANCHORS[hi]! - ZONE_ANCHORS[lo]!);
  }
  const w: number[] = [];
  let total = 0;
  for (let k = 0; k < KIND_ORDER.length; k++) {
    const kind = KIND_ORDER[k]!;
    let x = ZONE_WEIGHTS[lo]![k]! * (1 - f) + ZONE_WEIGHTS[hi]![k]! * f;
    if (BROADLEAF.has(kind)) x *= 0.35 + 1.3 * cluster; // clusters: broadleaf stands vs conifer stands
    else if (kind === PropKind.Conifer || kind === PropKind.Pine || kind === PropKind.Larch) x *= 1.65 - 1.3 * cluster;
    if (kind === PropKind.Shrub) x *= (density < 0.35 ? 3 : 1) * (steep > 1.4 ? 1.8 : 1); // clearings + slopes
    if (kind === PropKind.Snag) x *= steep > 1.4 ? 1.5 : 1;
    w.push(x);
    total += x;
  }
  let t = r * total;
  for (let k = 0; k < w.length; k++) { t -= w[k]!; if (t < 0) return KIND_ORDER[k]!; }
  return PropKind.Conifer;
}

/**
 * Deterministic placement. Trees from forestDensity on non-water/rock/steep tiles; species mix by altitude
 * zone (broadleaf low, conifers/larch high, snags + shrubs near the tree line), slope and low-frequency
 * cluster noise; shrubs favour clearings. Rocks on rock tiles and steep zones, sparsely elsewhere.
 */
export function generateProps(grid: Grid, forestDensity: Uint8Array, seed: number): PropStore {
  const store = new PropStore(grid);
  const N = grid.size;
  const rng = new Rng((seed ^ 0x7a3c9d15) >>> 0);
  const relief = 80 * Math.sqrt(N / 128);
  const nseed = (seed ^ 0x51ed270b) | 0;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const type = grid.tileType[i]!;
      if (isWaterType(type) || type === TileType.Ice) continue;
      const steep = grid.steepness(x, y);
      const [n, e, s, w] = grid.getCorners(x, y);
      const hFrac = ((n + e + s + w) / 4 - 8) / relief;
      const isRockTile = type === TileType.Rock;
      if (isRockTile || steep > ROCK_STEEPNESS) {
        const nr = rng.chance(isRockTile ? 0.35 : 0.2) ? 1 + (rng.chance(0.3) ? 1 : 0) : 0;
        for (let k = 0; k < nr; k++) addOne(store, rng, PropKind.Rock, x, y, 0.5 + rng.next() * 0.9);
        if (isRockTile) continue;
      }
      if (type === TileType.Dirt || steep > TREE_MAX_STEEPNESS) continue;
      const d = forestDensity[i]! / 255;
      if (d <= 0) {
        if (rng.chance(0.004)) addOne(store, rng, PropKind.Rock, x, y, 0.3 + rng.next() * 0.5);
        continue;
      }
      const expect = d * TREES_PER_TILE_MAX;
      let nt = Math.floor(expect);
      if (rng.next() < expect - nt) nt++;
      const cluster = 0.6 * valueNoise(x, y, 14, nseed) + 0.4 * valueNoise(x, y, 5, nseed + 1);
      for (let k = 0; k < nt; k++) {
        const kind = pickVegetation(hFrac, steep, cluster, d, rng.next());
        addOne(store, rng, kind, x, y, (0.7 + rng.next() * 0.7) * (KIND_SCALE[kind] ?? 1));
      }
    }
  }
  return store;
}

function addOne(store: PropStore, rng: Rng, kind: number, x: number, y: number, scale: number): void {
  store.add(kind, x, y, 0.1 + rng.next() * 0.8, 0.1 + rng.next() * 0.8, scale, rng.next() * Math.PI * 2, (rng.next() * 256) | 0);
}
