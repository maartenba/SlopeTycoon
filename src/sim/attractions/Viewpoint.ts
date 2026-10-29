import { VIEWPOINT, type ViewpointSpec } from '../../config/viewpoints';

/**
 * Viewpoint scoring (pure; docs/viewpoints.md). View score in 0..1 = share of the tiles in a disc around the site that lie lower than it
 * (a ridge sees most of the valley, a pit sees nothing) x the site's relative altitude on the map (a high spot beats a low spot with the same
 * share). Deterministic, no RNG; the caller caches it per nav epoch (terrain and trees do not change inside one epoch).
 */
export function viewScore(alt: (x: number, y: number) => number, size: number, cx: number, cy: number, amin: number, amax: number, radius: number = VIEWPOINT.radius, siteAlt?: number): number {
  const a0 = siteAlt ?? alt(cx, cy), r2 = radius * radius;
  let lower = 0, n = 0;
  for (let y = Math.max(0, cy - radius); y <= Math.min(size - 1, cy + radius); y++) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(size - 1, cx + radius); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r2) continue;
      n++;
      if (a0 - alt(x, y) >= VIEWPOINT.lowerMargin) lower++;
    }
  }
  if (!n) return 0;
  const rel = Math.max(0, Math.min(1, (a0 - amin) / (amax - amin || 1)));
  return (lower / n) * rel;
}

/** Direction (radians, atan2(dy, dx) over tile x / y) in which the ground falls away most from the site: where a photo spot should look. */
export function openDirection(alt: (x: number, y: number) => number, size: number, cx: number, cy: number, radius: number = VIEWPOINT.radius): number {
  const a0 = alt(cx, cy);
  let sx = 0, sy = 0;
  for (let y = Math.max(0, cy - radius); y <= Math.min(size - 1, cy + radius); y++) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(size - 1, cx + radius); x++) {
      const d = a0 - alt(x, y);
      if (d > 0) { sx += (x - cx) * d; sy += (y - cy) * d; }
    }
  }
  return sx === 0 && sy === 0 ? 0 : Math.atan2(sy, sx);
}

export interface ViewpointSite { id: number; x: number; y: number; w: number; h: number; spec: ViewpointSpec; /** Altitude of the vantage point when it is not the ground under (x, y): a bridge deck over a gorge. Bridges use negative ids (-bridge id). */ alt?: number }
export interface ViewpointInfo { id: number; tile: number; x: number; y: number; score: number; spec: ViewpointSpec; /** Visits (hikers that reached it). */ visits: number }

/**
 * The viewpoints of a resort: score cache keyed by (nav epoch, building id), visit counters, photo spots. Fed the placed buildings that carry
 * `def.viewpoint`; has no per-building-type logic.
 */
export class Viewpoints {
  private list: ViewpointInfo[] = [];
  private byTile = new Map<number, ViewpointInfo>();
  private epoch = -1;
  private sig = '';
  readonly visits = new Map<number, number>();

  /** Recompute scores when the epoch or the set of viewpoint buildings changed; returns the list (stable order by id). */
  refresh(epoch: number, sites: readonly ViewpointSite[], size: number, alt: (x: number, y: number) => number, amin: number, amax: number): readonly ViewpointInfo[] {
    const sig = sites.map((s) => `${s.id}:${s.x},${s.y}:${s.alt ?? ''}`).join('|');
    if (epoch === this.epoch && sig === this.sig) return this.list;
    this.epoch = epoch; this.sig = sig;
    this.list = sites.map((s) => {
      const cx = Math.floor(s.x + s.w / 2), cy = Math.floor(s.y + s.h / 2);
      return { id: s.id, tile: cy * size + cx, x: cx, y: cy, score: Math.max(s.spec.floor ?? 0, viewScore(alt, size, cx, cy, amin, amax, s.spec.radius, s.alt)), spec: s.spec, visits: this.visits.get(s.id) ?? 0 };
    }).sort((a, b) => a.id - b.id);
    this.byTile.clear();
    for (const v of this.list) this.byTile.set(v.tile, v);
    return this.list;
  }
  get all(): readonly ViewpointInfo[] { return this.list; }
  /** Viewpoint whose centre tile is exactly `tile` (null otherwise). */
  at(tile: number): ViewpointInfo | null { return this.byTile.get(tile) ?? null; }
  record(id: number): void { this.visits.set(id, (this.visits.get(id) ?? 0) + 1); const v = this.list.find((x) => x.id === id); if (v) v.visits++; }
  reset(): void { this.list = []; this.byTile.clear(); this.epoch = -1; this.sig = ''; }
}
