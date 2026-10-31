import { CROSSING } from '../config/crossings';
import { Cross, NetKind } from '../world/Networks';
import type { Vehicle } from './guests/Arrivals';
import { VehicleKind } from './guests/Arrivals';

/** The tile arrays the crossings read (Networks satisfies this). */
export interface CrossNet { readonly size: number; readonly kind: Uint8Array; readonly conn: Uint8Array; readonly cross: Uint8Array; readonly crossCount: number; readonly version: number }

export interface CrossingInfo {
  tile: number; x: number; y: number;
  /** Cross.* value: 1 footpath crossing, 2 road crossing, 3 footbridge over rail. */
  kind: number;
  /** Direction the rail runs through the tile. */
  axis: 'ns' | 'ew';
}

interface RoutePos { tile: number; c: number; cross: number }

/**
 * Rail level crossings, sim side (docs/crossings.md). PURE and deterministic: it only reads the train polylines (fixed ticks, no RNG) and the
 * Networks arrays; it owns no saved state. `refresh(vehicles)` runs once per tick right after the vehicles advanced (inside the Spawner,
 * which runs before the guests), so guests and cars always see the exact post-advance state.
 *
 * A crossing is CLOSED while a train's nose is within `speed x leadTicks` tiles of the tile, or still on / just past it (nose - trainTailTiles
 * <= tile centre + 0.5). Trains never stop. Guests and cars may not ENTER a closed tile (they wait on the approach tile); anyone already on
 * the tile is out of it within one tick, and `leadTicks` (4) is far longer than that, so the tile is empty when the train arrives.
 * A footbridge over rail (cross 3) never closes.
 */
export class RailCrossings {
  /** Bumped whenever the set of closed crossings changed (renderers / audio re-read the state). */
  version = 0;
  private closed = new Set<number>();
  private infoCache: { v: number; list: CrossingInfo[] } | null = null;
  private routes = new Map<number, { v: number; pos: RoutePos[] }>();
  /** Ticks guests spent waiting at closed crossings today / yesterday (advisor: "a footbridge helps"). */
  private waitToday = 0; private waitYesterday = 0; private day = -1;
  private tileToday = new Map<number, number>(); private tileYesterday = new Map<number, number>();
  /** Total guest-ticks waited, diagnostics. */
  totalWait = 0;

  constructor(private net: CrossNet) {}

  /** Any level crossing or footbridge exists (false = every hook below is a no-op). */
  get active(): boolean { return this.net.crossCount > 0; }

  /** All crossings, ascending tile order (cached per network version). */
  list(): CrossingInfo[] {
    if (this.infoCache && this.infoCache.v === this.net.version) return this.infoCache.list;
    const n = this.net, out: CrossingInfo[] = [];
    if (n.crossCount > 0) {
      for (let i = 0; i < n.cross.length; i++) {
        if (!n.cross[i]) continue;
        out.push({ tile: i, x: i % n.size, y: (i / n.size) | 0, kind: n.cross[i]!, axis: n.conn[i] === 5 ? 'ns' : 'ew' }); // conn 5 = N|S
      }
    }
    this.infoCache = { v: n.version, list: out };
    return out;
  }

  isClosed(tile: number): boolean { return this.closed.size > 0 && this.closed.has(tile); }
  closedTiles(): ReadonlySet<number> { return this.closed; }

  /** A guest wanted to enter closed crossing `tile` this tick (counts towards the advisor's wait metric). */
  noteWait(tile = -1): void { this.waitToday++; this.totalWait++; if (tile >= 0) this.tileToday.set(tile, (this.tileToday.get(tile) ?? 0) + 1); }
  /** Guest-ticks waited yesterday (the advisor reads it; today's value is still accumulating). */
  waitedYesterday(): number { return this.waitYesterday; }
  /** The footpath crossing where guests waited most yesterday (tile index) and how long (ticks, summed over guests); null = none. */
  worstWaited(): { tile: number; ticks: number } | null {
    let best: { tile: number; ticks: number } | null = null;
    for (const [tile, ticks] of this.tileYesterday) if ((this.net.cross[tile] === Cross.Path || this.net.cross[tile] === Cross.Road) && (!best || ticks > best.ticks || (ticks === best.ticks && tile < best.tile))) best = { tile, ticks };
    return best;
  }
  /** Tests: pretend guests waited `ticks` at `tile` yesterday. */
  debugWaits(tile: number, ticks: number): void { this.tileYesterday.set(tile, ticks); this.waitYesterday = ticks; }

  /** Crossings of the polyline in route order: tile, distance along the route to the tile centre, cross kind. Cached per vehicle + network version. */
  private positionsOn(v: Vehicle): RoutePos[] {
    const c = this.routes.get(v.id);
    if (c && c.v === this.net.version) return c.pos;
    const n = this.net, pos: RoutePos[] = [];
    for (let k = 0; k * 2 + 1 < v.pts.length; k++) {
      const x = Math.floor(v.pts[k * 2]!), y = Math.floor(v.pts[k * 2 + 1]!);
      if (x < 0 || y < 0 || x >= n.size || y >= n.size) continue;
      const t = y * n.size + x, cr = n.cross[t]!;
      if ((cr === Cross.Path || cr === Cross.Road) && n.kind[t] === NetKind.Rail) pos.push({ tile: t, c: v.cum[k]!, cross: cr });
    }
    this.routes.set(v.id, { v: n.version, pos });
    return pos;
  }

  /** Recompute the closed set from the trains in flight. Call once per tick after the vehicles advanced. `absDay` rolls the daily wait counter. */
  refresh(vehicles: ReadonlyArray<Vehicle>, absDay = 0): void {
    if (this.day < 0) this.day = absDay; // first call: just learn the day (nothing waited yet)
    else if (absDay !== this.day) {
      const cons = absDay === this.day + 1;
      this.waitYesterday = cons ? this.waitToday : 0; this.waitToday = 0; this.day = absDay;
      this.tileYesterday = cons ? this.tileToday : new Map(); this.tileToday = new Map();
    }
    if (!this.active) { if (this.closed.size) { this.closed.clear(); this.version++; } if (this.routes.size) this.routes.clear(); return; }
    const next = new Set<number>();
    const live = new Set<number>();
    for (const v of vehicles) {
      live.add(v.id);
      if (v.kind !== VehicleKind.Train) continue;
      for (const p of this.positionsOn(v)) {
        if (p.c - v.dist <= v.speed * CROSSING.leadTicks && v.dist - CROSSING.trainTailTiles <= p.c + 0.5) next.add(p.tile);
      }
    }
    for (const id of [...this.routes.keys()]) if (!live.has(id)) this.routes.delete(id);
    let changed = next.size !== this.closed.size;
    if (!changed) for (const t of next) if (!this.closed.has(t)) { changed = true; break; }
    if (changed) { this.closed = next; this.version++; }
  }

  /**
   * Spawn rule for a train: no train may APPEAR inside the closing window of a crossing ahead of it. Returns the (possibly negative = it waits at
   * the rail entry) initial distance that keeps the first crossing open for `leadTicks + 1` ticks after the spawn.
   */
  spawnDist(v: Pick<Vehicle, 'pts' | 'cum' | 'speed'>, dist: number): number {
    if (!this.active) return dist;
    const n = this.net;
    for (let k = 0; k * 2 + 1 < v.pts.length; k++) {
      const x = Math.floor(v.pts[k * 2]!), y = Math.floor(v.pts[k * 2 + 1]!);
      if (x < 0 || y < 0 || x >= n.size || y >= n.size) continue;
      const t = y * n.size + x, cr = n.cross[t]!;
      if ((cr !== Cross.Path && cr !== Cross.Road) || n.kind[t] !== NetKind.Rail) continue;
      const c = v.cum[k]!;
      if (c + 0.5 <= dist - CROSSING.trainTailTiles) continue; // already behind the spawn point
      return Math.min(dist, c - v.speed * (CROSSING.leadTicks + 1));
    }
    return dist;
  }

  /** Cars / buses: the furthest distance this vehicle may move to this tick (stops 0.55 tiles before a closed road crossing it has not entered yet). */
  holdCar(v: Vehicle, to: number): number {
    if (this.closed.size === 0) return to;
    let lim = to;
    for (const p of this.positionsOn(v)) {
      if (p.cross !== Cross.Road || !this.closed.has(p.tile)) continue;
      const entry = p.c - 0.55;
      if (v.dist <= entry + 1e-6 && lim > entry) { lim = entry; if (v.dist >= entry - 0.5) this.tileToday.set(p.tile, (this.tileToday.get(p.tile) ?? 0) + 1); } // a car waiting at the line counts for the advisor (roads: an overpass ends the wait)
    }
    return lim;
  }
}
