import { Occupancy } from './Occupancy';

/**
 * Coordinate convention: tile (x,y), 0 <= x,y < N. Vertex (vx,vy), 0 <= v <= N,
 * heights index = vy*(N+1)+vx, in half-steps (h=1 -> 0.5 world units).
 * Corner order everywhere is [n, e, s, w]:
 *   n=(x,y)  e=(x+1,y)  s=(x+1,y+1)  w=(x,y+1)
 */
export const CHUNK_SIZE = 32;
export const MAX_TILE_DELTA = 2;

export const TileType = { Grass: 0, Rock: 1, Water: 2, Dirt: 3, Forest: 4, Ice: 5, Stream: 6 } as const;

export const enum Shape {
  Flat = 0,
  HalfSlope = 1,
  FullSlope = 2,
  CornerUp = 3,
  CornerDown = 4,
  Valley = 5,
  Steep = 6,
}

export interface TileShape {
  shape: Shape;
  /**
   * 0..3. HalfSlope/FullSlope: raised edge is between corners rotation and rotation+1 (mod 4) in [n,e,s,w].
   * CornerUp: index of the raised corner. CornerDown: index of the lowered corner.
   * Valley: 0 = n,s high / e,w low; 1 = e,w high / n,s low. Steep/Flat: 0.
   */
  rotation: number;
}

/** Classify four corner heights [n,e,s,w]. */
export function classifyCorners(n: number, e: number, s: number, w: number): TileShape {
  const c = [n, e, s, w];
  const min = Math.min(n, e, s, w);
  const max = Math.max(n, e, s, w);
  if (min === max) return { shape: Shape.Flat, rotation: 0 };
  const hi: number[] = [];
  for (let i = 0; i < 4; i++) if (c[i] === max) hi.push(i);
  const twoLevel = c.every((v) => v === min || v === max);
  if (twoLevel) {
    const amt = max - min;
    if (hi.length === 1) return { shape: Shape.CornerUp, rotation: hi[0]! };
    if (hi.length === 3) {
      const lo = c.findIndex((v) => v === min);
      return { shape: Shape.CornerDown, rotation: lo };
    }
    // two high
    const [a, b] = hi as [number, number];
    if (b - a === 2) return { shape: Shape.Valley, rotation: a };
    const rot = a === 0 && b === 3 ? 3 : a;
    if (amt === 1) return { shape: Shape.HalfSlope, rotation: rot };
    if (amt === 2) return { shape: Shape.FullSlope, rotation: rot };
  }
  return { shape: Shape.Steep, rotation: 0 };
}

export class Grid {
  readonly size: number;
  readonly vsize: number;
  readonly chunksPerRow: number;
  readonly heights: Int16Array;
  readonly tileType: Uint8Array;
  readonly snowDepth: Float32Array;
  readonly flags: Uint8Array;
  readonly occupancy: Occupancy;
  private readonly dirty: Uint8Array;
  private dirtyList: number[] = [];
  private readonly snowDirty: Uint8Array;
  private snowDirtyList: number[] = [];

  constructor(size: 64 | 128 | 256) {
    if (size !== 64 && size !== 128 && size !== 256) throw new Error(`Invalid grid size ${size}`);
    this.size = size;
    this.vsize = size + 1;
    this.chunksPerRow = size / CHUNK_SIZE;
    this.heights = new Int16Array(this.vsize * this.vsize);
    this.tileType = new Uint8Array(size * size);
    this.snowDepth = new Float32Array(size * size);
    this.flags = new Uint8Array(size * size);
    this.occupancy = new Occupancy(size);
    this.dirty = new Uint8Array(this.chunksPerRow * this.chunksPerRow);
    this.snowDirty = new Uint8Array(this.chunksPerRow * this.chunksPerRow);
  }

  byteLength(): number {
    return (
      this.heights.byteLength + this.tileType.byteLength + this.snowDepth.byteLength +
      this.flags.byteLength + this.dirty.byteLength + this.occupancy.byteLength()
    );
  }

  tileIndex(x: number, y: number): number {
    return y * this.size + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.size && y < this.size;
  }

  getCorner(vx: number, vy: number): number {
    return this.heights[vy * this.vsize + vx]!;
  }

  /** Corner heights [n,e,s,w] of tile (x,y). */
  getCorners(x: number, y: number): [number, number, number, number] {
    const v = this.vsize;
    const i = y * v + x;
    const h = this.heights;
    return [h[i]!, h[i + 1]!, h[i + v + 1]!, h[i + v]!];
  }

  /**
   * Set a vertex height. REJECTS (returns false, no change) if it would make any adjacent
   * tile's corner spread exceed MAX_TILE_DELTA. Terraform/terrain-gen should use
   * setCornerUnchecked in bulk then verify with checkInvariants(), or propagate themselves.
   */
  setCorner(vx: number, vy: number, h: number): boolean {
    for (let ty = vy - 1; ty <= vy; ty++) {
      for (let tx = vx - 1; tx <= vx; tx++) {
        if (!this.inBounds(tx, ty)) continue;
        let min = h, max = h;
        const corners: Array<[number, number]> = [[tx, ty], [tx + 1, ty], [tx + 1, ty + 1], [tx, ty + 1]];
        for (const [cx, cy] of corners) {
          if (cx === vx && cy === vy) continue;
          const v = this.getCorner(cx, cy);
          if (v < min) min = v;
          if (v > max) max = v;
        }
        if (max - min > MAX_TILE_DELTA) return false;
      }
    }
    this.setCornerUnchecked(vx, vy, h);
    return true;
  }

  /** Set a vertex without invariant check (marks dirty). */
  setCornerUnchecked(vx: number, vy: number, h: number): void {
    this.heights[vy * this.vsize + vx] = h;
    for (let ty = vy - 1; ty <= vy; ty++)
      for (let tx = vx - 1; tx <= vx; tx++) if (this.inBounds(tx, ty)) this.markDirty(tx, ty);
  }

  setSnow(x: number, y: number, depth: number): void {
    const i = this.tileIndex(x, y);
    if (this.snowDepth[i] === depth) return;
    this.snowDepth[i] = depth;
    this.markSnowDirty(x, y);
  }

  /** Mark the chunk's snow attribute dirty (separate from height dirty: no geometry rebuild, see TerrainMesh.updateSnow). */
  markSnowDirty(x: number, y: number): void {
    const c = ((y / CHUNK_SIZE) | 0) * this.chunksPerRow + ((x / CHUNK_SIZE) | 0);
    if (!this.snowDirty[c]) { this.snowDirty[c] = 1; this.snowDirtyList.push(c); }
  }

  /** Flag every chunk's snow attribute dirty (date jumps / full re-seeds). */
  markAllSnowDirty(): void {
    for (let cy = 0; cy < this.chunksPerRow; cy++) for (let cx = 0; cx < this.chunksPerRow; cx++) this.markSnowDirty(cx * CHUNK_SIZE, cy * CHUNK_SIZE);
  }

  /** Chunk indices whose snow changed since the last call (cleared). */
  consumeSnowDirtyChunks(): number[] {
    const out = this.snowDirtyList;
    this.snowDirtyList = [];
    for (const c of out) this.snowDirty[c] = 0;
    return out;
  }

  classifyTile(x: number, y: number): TileShape {
    const [n, e, s, w] = this.getCorners(x, y);
    return classifyCorners(n, e, s, w);
  }

  /** Slope magnitude in half-steps per tile (gradient length). 0 = flat. */
  steepness(x: number, y: number): number {
    const [n, e, s, w] = this.getCorners(x, y);
    const dx = (e + s - n - w) / 2;
    const dy = (w + s - n - e) / 2;
    return Math.hypot(dx, dy);
  }

  /** Mark the chunk containing tile (x,y) dirty. */
  markDirty(x: number, y: number): void {
    const c = ((y / CHUNK_SIZE) | 0) * this.chunksPerRow + ((x / CHUNK_SIZE) | 0);
    if (!this.dirty[c]) {
      this.dirty[c] = 1;
      this.dirtyList.push(c);
    }
  }

  /** Returns dirty chunk indices (cy*chunksPerRow+cx) and clears the set. */
  consumeDirtyChunks(): number[] {
    const out = this.dirtyList;
    this.dirtyList = [];
    for (const c of out) this.dirty[c] = 0;
    return out;
  }

  /** Returns list of violation descriptions (empty = valid). */
  checkInvariants(): string[] {
    const errs: string[] = [];
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const c = this.getCorners(x, y);
        if (Math.max(...c) - Math.min(...c) > MAX_TILE_DELTA) errs.push(`tile ${x},${y} spread >${MAX_TILE_DELTA}`);
      }
    }
    return errs;
  }
}

/** Lake or stream tile (not buildable, not terraformable, no props). */
export function isWaterType(t: number): boolean {
  return t === TileType.Water || t === TileType.Stream;
}
