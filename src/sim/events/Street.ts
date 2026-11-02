/**
 * The Carnival's "village street" (M7.4, docs/festivals.md "Carnival"): a connected run of at least `CARNIVAL.streetTiles` road / footpath tiles within
 * `CARNIVAL.streetRadius` tiles of the base lift station, the village or the Base Lodge. Pure: it reads the network kinds only (1 = road, 2 = footpath).
 * The same chain is what the render's `placeDressing` strings the bunting along, so a passing check means the parade has a street to walk.
 */
import { CARNIVAL } from '../../config/festivals';

export interface StreetWorld { size: number; kind(i: number): number; anchors: ReadonlyArray<{ x: number; y: number }> }

/** Largest connected (4-neighbour) road / path component touching a disc around any anchor, counted in tiles (0 = none). */
export function streetTiles(w: StreetWorld): number {
  const N = w.size, R = CARNIVAL.streetRadius;
  const isNet = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < N && y < N && (w.kind(y * N + x) === 1 || w.kind(y * N + x) === 2);
  let best = 0;
  const seen = new Set<number>();
  for (const a of w.anchors) {
    const ax = Math.floor(a.x), ay = Math.floor(a.y);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const x = ax + dx, y = ay + dy;
      if (!isNet(x, y) || seen.has(y * N + x) || Math.hypot(dx, dy) > R) continue;
      const q: number[] = [y * N + x]; seen.add(q[0]!);
      let n = 0;
      for (let h = 0; h < q.length; h++) {
        const c = q[h]!, cx = c % N, cy = (c / N) | 0;
        if (Math.hypot(cx - ax, cy - ay) <= R + 6) n++;
        for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = cx + ox, ny = cy + oy, k = ny * N + nx;
          if (!seen.has(k) && isNet(nx, ny) && Math.hypot(nx - ax, ny - ay) <= R + 6) { seen.add(k); q.push(k); }
        }
      }
      if (n > best) best = n;
    }
  }
  return best;
}
export const hasStreet = (w: StreetWorld): boolean => streetTiles(w) >= CARNIVAL.streetTiles;
