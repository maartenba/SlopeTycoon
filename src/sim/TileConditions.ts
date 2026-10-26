import type { Grid } from '../world/Grid';
import { isWaterType } from '../world/Grid';
import {
  BIKE_MAX_STEEPNESS, HEIGHT_UNIT, SKI_CLOSE_DEPTH, SKI_OPEN_DEPTH, SNOWFREE_BAD_DEPTH, SNOWFREE_OK_DEPTH, SNOW_SLUSH_DEPTH,
} from '../config/balance';

export type TileZone = 'snow' | 'slush' | 'meadow';

/**
 * Per-tile conditions on top of Grid.snowDepth (metres). Skiable / snow-free flags are hysteresis states (open at >= 30 cm,
 * close below 15 cm; snow-free at <= 3 cm, lost above 10 cm) so tiles never flicker while depth hovers near a threshold.
 * The snow system calls `refreshTile` for every tile it updates.
 */
export class TileConditions {
  readonly skiOpen: Uint8Array;
  readonly hikeOk: Uint8Array;
  /** Tiles whose ski/hike state flipped since the last `takeFlips` (navigation re-validates routes through them). */
  private flips: number[] = [];
  private flipAll = false;

  constructor(readonly grid: Grid) {
    this.skiOpen = new Uint8Array(grid.size * grid.size);
    this.hikeOk = new Uint8Array(grid.size * grid.size);
  }

  /** Apply the hysteresis rule to tile index i from its current depth. Returns true if either state flipped. */
  refreshTile(i: number): boolean {
    const d = this.grid.snowDepth[i]!;
    let ch = false;
    const s = this.skiOpen[i]!;
    const ns = d >= SKI_OPEN_DEPTH ? 1 : d < SKI_CLOSE_DEPTH ? 0 : s;
    if (ns !== s) { this.skiOpen[i] = ns; ch = true; }
    const h = this.hikeOk[i]!;
    const nh = d <= SNOWFREE_OK_DEPTH ? 1 : d > SNOWFREE_BAD_DEPTH ? 0 : h;
    if (nh !== h) { this.hikeOk[i] = nh; ch = true; }
    if (ch && !this.flipAll) { this.flips.push(i); if (this.flips.length > 16384) { this.flips = []; this.flipAll = true; } }
    return ch;
  }

  /** Initialise all states from the depths (new game / load): the dead band resolves by its midpoint. */
  syncAll(): void {
    const mid = (SKI_OPEN_DEPTH + SKI_CLOSE_DEPTH) / 2, midH = (SNOWFREE_OK_DEPTH + SNOWFREE_BAD_DEPTH) / 2;
    for (let i = 0; i < this.skiOpen.length; i++) {
      const d = this.grid.snowDepth[i]!;
      this.skiOpen[i] = d >= mid ? 1 : 0;
      this.hikeOk[i] = d <= midH ? 1 : 0;
    }
    this.flipAll = true;
  }

  /** Consume the flipped-tile journal (null = nothing changed; every tile after `syncAll`). */
  takeFlips(): number[] | null {
    if (this.flipAll) { this.flipAll = false; this.flips = []; return Array.from({ length: this.skiOpen.length }, (_, i) => i); }
    if (!this.flips.length) return null;
    const f = this.flips; this.flips = [];
    return f;
  }

  private idx(x: number, y: number): number { return y * this.grid.size + x; }
  private valid(x: number, y: number): boolean {
    return this.grid.inBounds(x, y) && !isWaterType(this.grid.tileType[y * this.grid.size + x]!);
  }

  isSkiable(x: number, y: number): boolean { return this.valid(x, y) && this.skiOpen[this.idx(x, y)] === 1; }
  isHikeable(x: number, y: number): boolean { return this.valid(x, y) && this.hikeOk[this.idx(x, y)] === 1; }
  isBikeable(x: number, y: number): boolean { return this.isHikeable(x, y) && this.grid.steepness(x, y) <= BIKE_MAX_STEEPNESS; }

  zone(x: number, y: number): TileZone {
    if (!this.grid.inBounds(x, y)) return 'meadow';
    const i = this.idx(x, y);
    if (this.skiOpen[i]) return 'snow';
    return this.grid.snowDepth[i]! > SNOW_SLUSH_DEPTH ? 'slush' : 'meadow';
  }

  depth(x: number, y: number): number { return this.grid.inBounds(x, y) ? this.grid.snowDepth[this.idx(x, y)]! : 0; }

  /** Mean tile altitude in world units. */
  altitude(x: number, y: number): number {
    const [n, e, s, w] = this.grid.getCorners(x, y);
    return ((n + e + s + w) / 4) * HEIGHT_UNIT;
  }
}
