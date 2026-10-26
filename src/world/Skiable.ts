import { Grid, TileType } from './Grid';
import { VALLEY_BASE } from './TerrainGen';

export const SKIABLE_MIN = 0.5;
export const SKIABLE_MAX = 2;

export interface SkiableStats {
  nonWater: number;
  rockTiles: number;
  /** rockTiles / nonWater */
  rockFrac: number;
  /** non-water tiles above village altitude */
  aboveVillage: number;
  /** fraction of those with steepness in [0.5, 2] and not Rock */
  skiableFrac: number;
  /** Largest skiable region (8-connected) by vertical drop (half-steps) */
  bestRegionDrop: number;
  /** bounding-box length (max of w,h) of that region, tiles */
  bestRegionLength: number;
  /** bestRegionDrop / total relief (max-min tile-average height) */
  dropFrac: number;
  totalRelief: number;
}

/** Terrain skiability metrics. Village altitude = height at the grid's village row (VALLEY_BASE + small). */
export function skiableStats(grid: Grid, villageHeight = VALLEY_BASE + 2): SkiableStats {
  const N = grid.size;
  const avg = new Float32Array(N * N);
  const ok = new Uint8Array(N * N);
  let nonWater = 0, rockTiles = 0, above = 0, skiable = 0, hMin = Infinity, hMax = -Infinity;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const c = grid.getCorners(x, y);
      const a = (c[0] + c[1] + c[2] + c[3]) / 4;
      avg[i] = a;
      if (a < hMin) hMin = a;
      if (a > hMax) hMax = a;
      const t = grid.tileType[i];
      if (t === TileType.Water || t === TileType.Stream) continue;
      nonWater++;
      if (t === TileType.Rock) { rockTiles++; if (a > villageHeight) above++; continue; }
      const s = grid.steepness(x, y);
      const sk = s >= SKIABLE_MIN && s <= SKIABLE_MAX;
      if (sk) ok[i] = 1;
      if (a > villageHeight) { above++; if (sk) skiable++; }
    }
  let bestDrop = 0, bestLen = 0, bestScore = -1;
  const seen = new Uint8Array(N * N);
  for (let s0 = 0; s0 < N * N; s0++) {
    if (!ok[s0] || seen[s0]) continue;
    const st = [s0]; seen[s0] = 1;
    let lo = Infinity, hi = -Infinity, x0 = N, x1 = 0, y0 = N, y1 = 0;
    while (st.length) {
      const c = st.pop()!;
      const x = c % N, y = (c - x) / N;
      const a = avg[c]!;
      if (a < lo) lo = a;
      if (a > hi) hi = a;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
          const k = yy * N + xx;
          if (ok[k] && !seen[k]) { seen[k] = 1; st.push(k); }
        }
    }
    const drop = hi - lo, len = Math.max(x1 - x0, y1 - y0) + 1;
    if (drop > bestScore) { bestScore = drop; bestDrop = drop; bestLen = len; }
  }
  const totalRelief = hMax - hMin;
  return {
    nonWater, rockTiles, rockFrac: nonWater ? rockTiles / nonWater : 0,
    aboveVillage: above, skiableFrac: above ? skiable / above : 0,
    bestRegionDrop: bestDrop, bestRegionLength: bestLen,
    dropFrac: totalRelief ? bestDrop / totalRelief : 0, totalRelief,
  };
}
