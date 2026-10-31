import { TOURER_MAX_DANGER } from '../../config/guestTypes';

/**
 * Ski tourer support (Phase 6 Task 34, docs/guest-types.md "Ski tourer"). The backcountry layer (Task 32, docs/backcountry.md) exposes its routes through this small
 * view; the guest code only ever reads it, so the tourer works with whatever implements it (and is inert while nothing is attached: no route = no tourers).
 *
 * SAFETY RULE: a tourer never goes at danger >= `TOURER_MAX_DANGER`, even when the route is open (an operator override that keeps a route open does NOT apply to tourers).
 */
export interface TouringRoutes {
  /** Routes that are open for guests right now. */
  openRoutes(): ReadonlyArray<{ id: number }>;
  /** Avalanche danger level of a route (1..5). */
  dangerOf(id: number): number;
  isOpen(id: number): boolean;
  /** Tile indices of the route, in any order. */
  routeTiles(id: number): readonly number[];
}

/** Tour goals per route: the highest tile (the summit) plus an even sample of the rest (a hut or a shoulder on the way). */
export const TOUR_GOAL_SAMPLE = 3;

export class Touring {
  private view: TouringRoutes | null = null;
  attach(v: TouringRoutes | null): void { this.view = v; }
  get attached(): boolean { return this.view !== null; }

  /** Route ids a tourer would take: open AND below the danger cut-off. */
  safeRoutes(): number[] {
    const v = this.view;
    if (!v) return [];
    const out: number[] = [];
    for (const r of v.openRoutes()) if (v.isOpen(r.id) && v.dangerOf(r.id) < TOURER_MAX_DANGER) out.push(r.id);
    return out;
  }
  hasSafeRoute(): boolean { return this.safeRoutes().length > 0; }

  /** Goal tiles of every safe route (summit first, then a small sample), highest first; deterministic. */
  goalTiles(alt: (tile: number) => number): number[] {
    const v = this.view;
    if (!v) return [];
    const out: number[] = [];
    for (const id of this.safeRoutes()) {
      const tiles = [...v.routeTiles(id)].sort((a, b) => alt(b) - alt(a) || a - b);
      if (!tiles.length) continue;
      out.push(tiles[0]!);
      const step = Math.max(1, Math.floor(tiles.length / (TOUR_GOAL_SAMPLE + 1)));
      for (let k = step, n = 0; k < tiles.length && n < TOUR_GOAL_SAMPLE - 1; k += step, n++) out.push(tiles[k]!);
    }
    return out;
  }
}
