import type { Grid } from '../world/Grid';

export interface SnowSink { updateSnow(chunkIdx: number): void }

/** Pull the snow-dirty chunk list out of the grid (pure; kept separate so tests can drive it). */
export function collectSnowFlush(grid: Grid, pending: Set<number>): void {
  for (const c of grid.consumeSnowDirtyChunks()) pending.add(c);
}

/**
 * Render-side snow flush: terrain aSnow attributes refresh at most `terrainEvery` s; props (tree snow tint) every `propsEvery` s.
 * Every dirty chunk reaches BOTH sinks (separate pending sets, never dropped).
 */
export class SnowFlush {
  private terrainPending = new Set<number>();
  private propPending = new Set<number>();
  private scratch = new Set<number>();
  private tT = 0;
  private pT = 0;

  constructor(
    private grid: Grid, private terrain: SnowSink, private props: { refreshChunks(l: number[]): void } | null,
    private terrainEvery = 0.5, private propsEvery = 3,
  ) {}

  /** Advance `dt` seconds; returns true if any terrain chunk was flushed this call. */
  step(dt: number): boolean {
    this.scratch.clear();
    collectSnowFlush(this.grid, this.scratch);
    for (const c of this.scratch) { this.terrainPending.add(c); this.propPending.add(c); }
    this.tT += dt; this.pT += dt;
    let flushed = false;
    if (this.tT >= this.terrainEvery && this.terrainPending.size > 0) {
      this.tT = 0;
      for (const c of this.terrainPending) this.terrain.updateSnow(c);
      this.terrainPending.clear();
      flushed = true;
    }
    if (this.pT >= this.propsEvery && this.propPending.size > 0) {
      this.pT = 0;
      const l = [...this.propPending];
      this.propPending.clear();
      this.props?.refreshChunks(l);
    }
    return flushed;
  }

  /** Flush everything now (date jumps / tests). */
  flushNow(): void { this.tT = this.terrainEvery; this.pT = this.propsEvery; this.step(0); }
}
