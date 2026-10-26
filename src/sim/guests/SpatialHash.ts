import { SPATIAL_CELL } from '../../config/balance';

/**
 * Uniform spatial hash over the tile plane (8×8-tile cells). Entities are intrusive doubly-linked lists per cell
 * (typed arrays), so `move` is O(1) and only touches the lists when the entity changes cell.
 */
export class SpatialHash {
  readonly cells: number; // cells per row
  readonly cell: number;
  private head: Int32Array;
  private next: Int32Array;
  private prev: Int32Array;
  private cellOf: Int32Array;
  private cnt: Int32Array;

  constructor(readonly mapSize: number, capacity: number, cell = SPATIAL_CELL) {
    this.cell = cell;
    this.cells = Math.ceil(mapSize / cell);
    this.head = new Int32Array(this.cells * this.cells).fill(-1);
    this.cnt = new Int32Array(this.cells * this.cells);
    this.next = new Int32Array(capacity).fill(-1);
    this.prev = new Int32Array(capacity).fill(-1);
    this.cellOf = new Int32Array(capacity).fill(-1);
  }

  private cellIndex(x: number, y: number): number {
    const c = this.cells - 1;
    const cx = Math.min(c, Math.max(0, (x / this.cell) | 0)), cy = Math.min(c, Math.max(0, (y / this.cell) | 0));
    return cy * this.cells + cx;
  }

  private link(id: number, c: number): void {
    const h = this.head[c]!;
    this.next[id] = h; this.prev[id] = -1;
    if (h >= 0) this.prev[h] = id;
    this.head[c] = id; this.cellOf[id] = c; this.cnt[c]!++;
  }

  private unlink(id: number): void {
    const c = this.cellOf[id]!;
    if (c < 0) return;
    const p = this.prev[id]!, n = this.next[id]!;
    if (p >= 0) this.next[p] = n; else this.head[c] = n;
    if (n >= 0) this.prev[n] = p;
    this.cellOf[id] = -1; this.cnt[c]!--;
  }

  /** Drop every entry (save load rebuilds from the store, in slot order, identically in every run). */
  clear(): void { this.head.fill(-1); this.cnt.fill(0); this.next.fill(-1); this.prev.fill(-1); this.cellOf.fill(-1); }
  insert(id: number, x: number, y: number): void { this.unlink(id); this.link(id, this.cellIndex(x, y)); }
  remove(id: number): void { this.unlink(id); }
  /** Incremental update: relinks only when the cell changes. */
  move(id: number, x: number, y: number): void {
    const c = this.cellIndex(x, y);
    if (c === this.cellOf[id]) return;
    this.unlink(id); this.link(id, c);
  }
  /** Entities in the cell containing (x,y). */
  countAt(x: number, y: number): number { return this.cnt[this.cellIndex(x, y)]!; }

  /** Appends ids within `r` tiles of (x,y) (Euclidean) to `out` (cleared first). Needs the live coordinate arrays. */
  query(x: number, y: number, r: number, xs: ArrayLike<number>, ys: ArrayLike<number>, out: number[] = []): number[] {
    out.length = 0;
    const r2 = r * r, c = this.cells - 1;
    const x0 = Math.max(0, ((x - r) / this.cell) | 0), x1 = Math.min(c, ((x + r) / this.cell) | 0);
    const y0 = Math.max(0, ((y - r) / this.cell) | 0), y1 = Math.min(c, ((y + r) / this.cell) | 0);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      for (let id = this.head[cy * this.cells + cx]!; id >= 0; id = this.next[id]!) {
        const dx = xs[id]! - x, dy = ys[id]! - y;
        if (dx * dx + dy * dy <= r2) out.push(id);
      }
    }
    return out;
  }
}
