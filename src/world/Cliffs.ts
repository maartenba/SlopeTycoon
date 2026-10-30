import { TileType, type Grid } from './Grid';

/**
 * Rock faces for the Climbing Crag (Phase 6 Task 23, docs/climbing.md). A CLIFF TILE is a bare Rock tile whose four corners spread at least
 * `minSpread` half-steps (a full 45 degree slope = 2, the steepest tile the grid can hold). Pure: reads the grid only.
 */
export interface CliffRule {
  /** Cliff tiles needed in reach. */
  minTiles: number;
  /** Reach in tiles (Chebyshev ring around the footprint, footprint included). */
  radius: number;
  /** Min corner spread (half-steps) of one cliff tile. */
  minSpread: number;
}

/** One climbable face tile: centre, rise (half-steps, base -> top) and the uphill heading (radians in tile x / y space; the way a climber faces). */
export interface CliffFace { x: number; y: number; cx: number; cy: number; spread: number; heading: number; dist: number }

export const isCliffTile = (grid: Grid, x: number, y: number, minSpread: number): boolean => {
  if (!grid.inBounds(x, y) || grid.tileType[grid.tileIndex(x, y)] !== TileType.Rock) return false;
  const [n, e, s, w] = grid.getCorners(x, y);
  return Math.max(n, e, s, w) - Math.min(n, e, s, w) >= minSpread;
};

/** Cliff tiles within `rule.radius` of the footprint, nearest first (ties by index): deterministic. */
export function cliffFaces(grid: Grid, rect: { x: number; y: number; w: number; h: number }, rule: CliffRule): CliffFace[] {
  const out: CliffFace[] = [];
  const mx = rect.x + rect.w / 2, my = rect.y + rect.h / 2;
  for (let y = rect.y - rule.radius; y < rect.y + rect.h + rule.radius; y++) for (let x = rect.x - rule.radius; x < rect.x + rect.w + rule.radius; x++) {
    if (!isCliffTile(grid, x, y, rule.minSpread)) continue;
    const [n, e, s, w] = grid.getCorners(x, y);
    // uphill = gradient of the four corners (n=(x,y) e=(x+1,y) s=(x+1,y+1) w=(x,y+1))
    const gx = (e + s) - (n + w), gy = (w + s) - (n + e);
    out.push({ x, y, cx: x + 0.5, cy: y + 0.5, spread: Math.max(n, e, s, w) - Math.min(n, e, s, w), heading: Math.atan2(gy, gx), dist: Math.hypot(x + 0.5 - mx, y + 0.5 - my) });
  }
  return out.sort((a, b) => a.dist - b.dist || a.y - b.y || a.x - b.x);
}

/** Does the footprint have enough cliff in reach? */
export const countCliffs = (grid: Grid, rect: { x: number; y: number; w: number; h: number }, rule: CliffRule): number => cliffFaces(grid, rect, rule).length;
