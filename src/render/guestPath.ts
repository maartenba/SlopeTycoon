/**
 * Render interpolation of a guest between two sim ticks along the REAL path (docs/time-flow.md): at 1.6 ticks/s a guest covers 2.5-5 tiles per tick,
 * so the straight chord px,py -> x,y cuts corners (over buildings / water). The sim records the tile centres it passed in the tick (GuestStore.wp);
 * the guest is drawn at fraction `alpha` of the polyline length. Pure (no three), no allocations.
 */
export interface Pt2 { x: number; y: number }

/**
 * Point at fraction `alpha` (0..1 of the total length) along px,py -> wp[o..o+n) -> x,y. With `n = 0` it is the linear chord.
 * `wp` is flat x,y pairs starting at element `o` (= slot * WP_MAX * 2).
 */
export function pathPoint(px: number, py: number, x: number, y: number, wp: ArrayLike<number>, o: number, n: number, alpha: number, out: Pt2): Pt2 {
  if (n <= 0 || !(alpha > 0)) {
    if (!(alpha > 0)) { out.x = px; out.y = py; return out; }
    out.x = px + (x - px) * alpha; out.y = py + (y - py) * alpha; return out;
  }
  if (alpha >= 1) { out.x = x; out.y = y; return out; }
  // total length
  let total = 0, ax = px, ay = py;
  for (let k = 0; k < n; k++) { const bx = wp[o + k * 2]!, by = wp[o + k * 2 + 1]!; total += Math.hypot(bx - ax, by - ay); ax = bx; ay = by; }
  total += Math.hypot(x - ax, y - ay);
  if (total < 1e-9) { out.x = x; out.y = y; return out; }
  let rem = alpha * total;
  ax = px; ay = py;
  for (let k = 0; k <= n; k++) {
    const bx = k < n ? wp[o + k * 2]! : x, by = k < n ? wp[o + k * 2 + 1]! : y;
    const seg = Math.hypot(bx - ax, by - ay);
    if (rem <= seg && seg > 0) { const u = rem / seg; out.x = ax + (bx - ax) * u; out.y = ay + (by - ay) * u; return out; }
    rem -= seg; ax = bx; ay = by;
  }
  out.x = x; out.y = y;
  return out;
}

/** Max distance (tiles) any point of the drawn path may lie from the straight chord (diagnostics / tests). */
export function maxChordDeviation(px: number, py: number, x: number, y: number, wp: ArrayLike<number>, o: number, n: number): number {
  const dx = x - px, dy = y - py, L = Math.hypot(dx, dy);
  let m = 0;
  for (let k = 0; k < n; k++) {
    const bx = wp[o + k * 2]! - px, by = wp[o + k * 2 + 1]! - py;
    m = Math.max(m, L < 1e-9 ? Math.hypot(bx, by) : Math.abs(bx * dy - by * dx) / L);
  }
  return m;
}
