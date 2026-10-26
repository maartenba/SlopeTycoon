import { EMOTE_T } from './emotePick';

/** A wild animal that a guest may see: deer (short range) or an awake bear (longer range). */
export interface SightAnimal { x: number; y: number; kind: 'bear' | 'deer' }

const CELL = 8;
const key = (cx: number, cy: number): number => (cx + 512) * 4096 + (cy + 512);

/**
 * Render-only proximity index for the wildlife emote: a coarse hash grid of the animals that count (awake bears within `bearRange`, deer within
 * `deerRange`). `near(x, y)` is O(animals in 9 cells). Reads sim state, never writes it.
 */
export class WildlifeSight {
  private cells = new Map<number, SightAnimal[]>();
  private count = 0;
  /** Rebuild from the current animals (call once per sim tick, before the emote scan). */
  set(animals: Iterable<SightAnimal>): void {
    this.cells.clear(); this.count = 0;
    for (const a of animals) {
      const k = key(Math.floor(a.x / CELL), Math.floor(a.y / CELL));
      let l = this.cells.get(k);
      if (!l) { l = []; this.cells.set(k, l); }
      l.push(a); this.count++;
    }
  }
  get size(): number { return this.count; }
  near(x: number, y: number): boolean {
    if (!this.count) return false;
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const l = this.cells.get(key(cx + i, cy + j));
      if (!l) continue;
      for (const a of l) {
        const r = a.kind === 'bear' ? EMOTE_T.bearRange : EMOTE_T.deerRange;
        if ((a.x - x) * (a.x - x) + (a.y - y) * (a.y - y) <= r * r) return true;
      }
    }
    return false;
  }
}
