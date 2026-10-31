import { HEIGHT_UNIT } from '../config/balance';
import { CROSSING } from '../config/crossings';
import { OccFlag } from './Occupancy';
import { TileType, type Grid } from './Grid';
import { NetKind, type Networks } from './Networks';
import { overpassAlong, type Overpass } from './OverpassProfile';
export { overpassAlong, type Overpass };
import type { Pt } from '../sim/Dependencies';

export const OVERPASS_MSG = {
  noRoom: 'No room for the ramps',
  steep: 'Too steep',
} as const;

const DXY = (axis: 'h' | 'v'): Pt => (axis === 'h' ? { x: 1, y: 0 } : { x: 0, y: 1 });

/** Bilinear ground height (world units) at tile-space (x, z). */
function ground(g: Grid, x: number, z: number): number {
  const tx = Math.min(g.size - 1, Math.max(0, Math.floor(x))), ty = Math.min(g.size - 1, Math.max(0, Math.floor(z)));
  const u = Math.min(1, Math.max(0, x - tx)), v = Math.min(1, Math.max(0, z - ty));
  const [n, e, s, w] = g.getCorners(tx, ty);
  return (n * (1 - u) * (1 - v) + e * u * (1 - v) + s * u * v + w * (1 - u) * v) * HEIGHT_UNIT;
}

export interface OverpassPlan {
  ok: boolean;
  reason?: string;
  x: number; y: number;
  axis: 'h' | 'v';
  n: number;
  top: number;
  endA: number; endB: number;
  /** Every tile of the overpass in order (ramp, rail tile in the middle, ramp). */
  tiles: Pt[];
  /** $ for the overpass (multiplier applied). */
  cost: number;
}

const bad = (reason: string, p: Partial<OverpassPlan> = {}): OverpassPlan => ({ ok: false, reason, x: 0, y: 0, axis: 'h', n: 0, top: 0, endA: 0, endB: 0, tiles: [], cost: 0, ...p });

/** Price of an overpass with ramps of `n` tiles each side (before the construction multiplier). */
export const overpassPrice = (n: number): number => CROSSING.overpass.base + CROSSING.overpass.perTile * (2 * n + 1);

/**
 * Plan the overpass for the road stroke `line` crossing the rail at index `k` (the rail tile). The caller (planStroke) has validated the stroke tiles as
 * road and the crossing itself (`crossingCheck`). Tries the short ramp first (3 tiles), then 4; the first one whose ground fits (no tile of the ramp
 * buried, gradient <= maxGrade). `claimed` = tiles of other overpasses planned in the same stroke.
 */
export function planOverpass(net: Networks, grid: Grid, line: ReadonlyArray<Pt>, k: number, mult = 1, claimed: ReadonlySet<number> = new Set()): OverpassPlan {
  const c = line[k]!, a = line[k - 1], b = line[k + 1];
  if (!a || !b) return bad(OVERPASS_MSG.noRoom);
  const axis: 'h' | 'v' = a.y === c.y ? 'h' : 'v';
  const d = DXY(axis);
  const sgn = axis === 'h' ? Math.sign(b.x - c.x) : Math.sign(b.y - c.y); // direction line[k] -> line[k+1]
  const P = CROSSING.overpass;
  const railY = ground(grid, c.x + 0.5, c.y + 0.5);
  const top = railY + P.deck;
  let reason: string = OVERPASS_MSG.noRoom;
  for (const n of P.ramps) {
    // line tiles (stroke order) and an along-axis position of each: s = (j - k) * sgn, so s > 0 = the b side
    const tiles: Pt[] = [];
    let ok = true;
    for (let j = -n; j <= n; j++) {
      const t = line[k + j];
      if (!t || t.x !== c.x + d.x * j * sgn || t.y !== c.y + d.y * j * sgn) { ok = false; break; }
      tiles.push(t);
    }
    if (!ok) { reason = OVERPASS_MSG.noRoom; continue; } // the stroke does not run straight for n tiles each side
    // tiles beside the rail must be free (road tiles of this stroke or an old plain road), no other crossing / overpass / building / water / bridge
    let free = true;
    for (const t of tiles) {
      if (t === c || (t.x === c.x && t.y === c.y)) continue;
      if (!net.inBounds(t.x, t.y)) { free = false; break; }
      const i = net.idxOf(t.x, t.y), kd = net.kind[i]!;
      if ((kd !== 0 && kd !== NetKind.Road) || net.bid[i] || net.oid[i] || net.cross[i] || claimed.has(i) || net.layers[i] || (grid.occupancy.flags[i]! & (OccFlag.Building | OccFlag.Lift))) { free = false; break; }
      const tt = grid.tileType[i];
      if (tt === TileType.Water || tt === TileType.Stream) { free = false; break; }
    }
    if (!free) { reason = OVERPASS_MSG.noRoom; continue; }
    // endA / endB are in WORLD axis direction (- and +), whichever way the stroke runs
    const endA = ground(grid, c.x + 0.5 - d.x * (n + 0.5), c.y + 0.5 - d.y * (n + 0.5));
    const endB = ground(grid, c.x + 0.5 + d.x * (n + 0.5), c.y + 0.5 + d.y * (n + 0.5));
    const o: Overpass = { id: 0, x: c.x, y: c.y, axis, n, top, endA, endB, cost: 0 };
    const grade = Math.max(Math.abs(top - endA), Math.abs(top - endB)) / n;
    if (grade > P.maxGrade + 1e-9) { reason = OVERPASS_MSG.steep; continue; }
    // the road must not be buried: ground along each ramp stays at or below the ramp surface
    let buried = false;
    for (let s = -(n + 0.5); s <= n + 0.5 && !buried; s += 0.25) {
      const gx = c.x + 0.5 + d.x * s, gz = c.y + 0.5 + d.y * s;
      if (ground(grid, gx, gz) > overpassAlong(o, s) + 0.08) buried = true;
    }
    if (buried) { reason = OVERPASS_MSG.steep; continue; }
    return { ok: true, x: c.x, y: c.y, axis, n, top, endA, endB, tiles, cost: overpassPrice(n) * mult };
  }
  return bad(reason);
}
