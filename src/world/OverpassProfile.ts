/** Road overpass record + height profile (no imports from Networks, so Networks can use it). Docs: docs/crossings.md. */
/**
 * Road overpass over a straight rail line (docs/crossings.md). The rail tile keeps `kind = Rail` with `cross = Cross.Overpass`; the road runs over a flat deck
 * on that tile and down a ramp of `n` tiles each side (7 or 9 tiles in all). Ramp tiles are ordinary road tiles that carry the overpass id (`Networks.oid`).
 * Pure planner + height profile; `Networks.buildOverpass` stores the record.
 */
export interface Overpass {
  id: number;
  /** The rail tile. */
  x: number; y: number;
  /** Direction of the road: 'h' = along x (rail runs N-S), 'v' = along y (rail runs E-W). */
  axis: 'h' | 'v';
  /** Ramp tiles on each side of the rail tile. */
  n: number;
  /** World height of the flat deck. */
  top: number;
  /** World height of the ground at the far end of the low (-) and high (+) ramp. */
  endA: number; endB: number;
  /** $ paid for the overpass itself (after multipliers; the new road tiles are charged as roads). Refund = half. */
  cost: number;
}

/** Deck height of an overpass at signed distance `s` (tiles) from the centre of the rail tile; flat over the rail tile, linear down each ramp. */
export function overpassAlong(o: Overpass, s: number): number {
  const a = Math.abs(s);
  if (a <= 0.5) return o.top;
  const t = Math.min(1, (a - 0.5) / o.n), end = s < 0 ? o.endA : o.endB;
  return o.top + (end - o.top) * t;
}

