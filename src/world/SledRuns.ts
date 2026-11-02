import { SLED, SLED_MSG, type SledKind } from '../config/sled';
import { HEIGHT_UNIT } from '../config/balance';
import { Layer } from './Networks';
import type { Grid } from './Grid';

/**
 * Pure analysis of the painted sled-run / coaster layers (docs/sled-runs.md): which tiles form a run, how far it drops and whether it is safe.
 * Nothing here is saved: it is derived from `Networks.layers` (the saved bytes), cached per network version by the caller.
 */
export interface SledNet { readonly size: number; readonly layers: ArrayLike<number>; readonly version: number }

export interface SledRun {
  kind: SledKind;
  /** 8-connected tile component (indices). */
  tiles: number[];
  /** Highest / lowest tile and the drop between them (world units). */
  top: number; bottom: number; drop: number;
  /** Mean / max `Grid.steepness` of the tiles (half-steps per tile). */
  meanSteep: number; maxSteep: number;
  /** null = safe; otherwise why the run cannot be used. */
  problem: string | null;
}

const BIT: Readonly<Record<SledKind, number>> = { sled: Layer.Sled, coaster: Layer.Coaster };

/** Verdict on a set of tiles of `kind` (also used by the paint tool before a stroke is committed). */
export function judgeTiles(grid: Grid, kind: SledKind, tiles: ReadonlyArray<{ x: number; y: number }>): { meanSteep: number; maxSteep: number; problem: string | null } {
  let sum = 0, max = 0;
  for (const t of tiles) { const s = grid.steepness(t.x, t.y); sum += s; if (s > max) max = s; }
  const mean = tiles.length ? sum / tiles.length : 0;
  const problem = max > SLED.maxSteep[kind] ? (kind === 'coaster' ? SLED_MSG.steepCoaster : SLED_MSG.steep) : tiles.length >= SLED.minTiles[kind] && mean < SLED.minMeanSteep[kind] ? SLED_MSG.flat : null;
  return { meanSteep: mean, maxSteep: max, problem };
}

/** Every run (8-connected component) of one layer kind. Deterministic (row-major scan, FIFO). */
export function sledRuns(net: SledNet, grid: Grid, kind: SledKind): SledRun[] {
  const n = net.size, bit = BIT[kind], seen = new Uint8Array(n * n), out: SledRun[] = [];
  for (let s = 0; s < n * n; s++) {
    if (seen[s] || !(net.layers[s]! & bit)) continue;
    const q = [s]; seen[s] = 1;
    let top = s, bot = s, topA = -Infinity, botA = Infinity;
    for (let h = 0; h < q.length; h++) {
      const i = q[h]!, x = i % n, y = (i / n) | 0, c = grid.getCorners(x, y), a = ((c[0] + c[1] + c[2] + c[3]) / 4) * HEIGHT_UNIT;
      if (a > topA) { topA = a; top = i; }
      if (a < botA) { botA = a; bot = i; }
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const j = ny * n + nx;
        if (!seen[j] && (net.layers[j]! & bit)) { seen[j] = 1; q.push(j); }
      }
    }
    const j = judgeTiles(grid, kind, q.map((i) => ({ x: i % n, y: (i / n) | 0 })));
    out.push({ kind, tiles: q, top, bottom: bot, drop: topA - botA, meanSteep: j.meanSteep, maxSteep: j.maxSteep, problem: j.problem });
  }
  return out;
}

/** Tile set of the runs of `kind` that are SAFE (the ones a ride may use). */
export function safeSledTiles(net: SledNet, grid: Grid, kind: SledKind): Set<number> {
  const set = new Set<number>();
  for (const r of sledRuns(net, grid, kind)) if (!r.problem) for (const i of r.tiles) set.add(i);
  return set;
}
