import { TOUR_DEFS, TOURS, tourDefOf, type TourDef, type TourRouteKind } from '../../config/tours';
import { seasonOf } from '../Clock';
import type { WorldBuilding } from '../guests/GuestWorld';
import type { Attraction, AttractionSpec } from './Attraction';

/**
 * Tour attractions (Phase 6 Task 5; docs/tours.md). A tour is a base building (an attraction with `spec.tour`) whose guests queue as usual and then
 * leave in DEPARTURES on fixed schedule slots: up to `seats` riders board together, pay the ticket, stay `Using` (off the nav graph) for the ride
 * duration and come back at the base with a happiness gain. The route is found by `planRoute` from the base over the attached network tiles
 * (out-and-back); a broken route (tile removed) closes the tour. Closures: season, route, wind / storm, avalanche instability on a route tile,
 * frozen water. Nothing here can hurt a guest: closing releases the queue at the base, rides in progress simply finish. The cosmetic carriers
 * are derived from the rides (`carriers`), the sim never reads them. All state is deterministic (no Rng).
 */

/** Ticks per in-game day (10 per hour). */
export const DAY_TICKS = 240;

export interface TourDeps {
  size: number;
  /** Does this tile belong to a route of `kind` (network layer test; `def.trailLayer` for 'trail')? Motorised piste exclusion is applied here, by the planner. */
  allows(kind: TourRouteKind, x: number, y: number, def: TourDef): boolean;
  /** Is this tile part of a ski piste? (motorised tours avoid them). */
  isPiste(x: number, y: number): boolean;
  /** Network epoch: the route is re-planned when it moves. */
  version(): number;
  /** Avalanche instability of a tile index (AVA scale). */
  instability(i: number): number;
  weather(): { wind: number };
  /** Water routes: is the water of this base frozen? */
  frozen?(b: WorldBuilding): boolean;
  /** Wildlife hook: scare animals within `r` tiles of (x, y). */
  disturb?(x: number, y: number, r: number): void;
}

export interface TourCtx { tick: number; day: number; absDay: number; hour: number }

export type RoutePlan = { ok: true; tiles: number[] } | { ok: false; reason: string };

/**
 * Pure route planner: breadth-first over `allow`ed tiles from the tiles touching the base footprint, depth <= maxLen; the route is the shortest path to
 * the farthest reachable tile (lowest index on ties) and must be >= minLen tiles. Deterministic (fixed neighbour order, FIFO).
 */
export function planRoute(allow: (x: number, y: number) => boolean, b: { x: number; y: number; w: number; h: number }, size: number, minLen: number, maxLen: number): RoutePlan {
  const parent = new Map<number, number>(), depth = new Map<number, number>();
  const queue: number[] = [];
  const starts: number[] = [];
  const touch = (x: number, y: number): void => { if (x >= 0 && y >= 0 && x < size && y < size && allow(x, y)) starts.push(y * size + x); };
  for (let x = b.x; x < b.x + b.w; x++) { touch(x, b.y - 1); touch(x, b.y + b.h); }
  for (let y = b.y; y < b.y + b.h; y++) { touch(b.x - 1, y); touch(b.x + b.w, y); }
  starts.sort((p, q) => p - q);
  for (const s of starts) if (!depth.has(s)) { depth.set(s, 1); parent.set(s, -1); queue.push(s); }
  let best = -1, bestD = 0;
  for (let h = 0; h < queue.length; h++) {
    const i = queue[h]!, d = depth.get(i)!;
    if (d > bestD || (d === bestD && i < best)) { best = i; bestD = d; }
    if (d >= maxLen) continue;
    const x = i % size, y = (i / size) | 0;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const n = ny * size + nx;
      if (depth.has(n) || !allow(nx, ny)) continue;
      depth.set(n, d + 1); parent.set(n, i); queue.push(n);
    }
  }
  if (best < 0 || bestD < minLen) return { ok: false, reason: `Needs a connected route of ${minLen}-${maxLen} tiles starting at the base` };
  const tiles: number[] = [];
  for (let i = best; i !== -1; i = parent.get(i)!) tiles.push(i);
  tiles.reverse();
  return { ok: true, tiles };
}

/** One departure in progress. */
export interface TourRide { start: number; end: number; riders: number }

interface TourState {
  id: number; type: string; def: TourDef;
  /** Network epoch of the cached plan (-1 = none) and its verdict. */
  ver: number; plan: RoutePlan;
  /** Cached dynamic closure (wind / instability / frozen) and when it was computed. */
  dynTick: number; dyn: string | null;
  /** Last schedule slot (absolute) processed; today's counters; yesterday's departures (sustainability); lifetime totals. */
  lastKey: number;
  day: number; dep: number; riders: number; revenue: number; prevDep: number;
  totalDep: number; totalRiders: number; totalRevenue: number;
  rides: TourRide[];
}

/** What the inspector shows. */
export interface TourInfo {
  /** null = running, otherwise why it is closed. */
  closed: string | null;
  routeLen: number;
  departuresToday: number; ridersToday: number; revenueToday: number;
  /** Riding right now. */
  riding: number;
  /** Next scheduled departure: hour (0..24) and whether it is tomorrow; null = none (closed for the season). */
  next: { hour: number; tomorrow: boolean } | null;
  totalDepartures: number; totalRiders: number; totalRevenue: number;
}

export interface Carrier { kind: TourDef['vehicle']; x: number; y: number; heading: number; seats: number }

const round2 = (n: number): number => Math.round(n * 100) / 100;

export class TourSystem {
  private st = new Map<number, TourState>();
  private ctx: TourCtx = { tick: 0, day: 0, absDay: 0, hour: 12 };

  constructor(private d: TourDeps) {}

  get isEmpty(): boolean { return this.st.size === 0; }
  /** Base building removed: the route (and its state) goes with it. */
  gone(id: number): void { this.st.delete(id); }
  /** Cheap per-tick context (set by the attraction system). */
  setContext(c: TourCtx): void { this.ctx = c; }

  private fresh(id: number, type: string, def: TourDef): TourState {
    return { id, type, def, ver: -1, plan: { ok: false, reason: 'No route yet' }, dynTick: -1e9, dyn: null, lastKey: -1, day: this.ctx.absDay, dep: 0, riders: 0, revenue: 0, prevDep: 0, totalDep: 0, totalRiders: 0, totalRevenue: 0, rides: [] };
  }
  private state(a: Attraction): TourState | null {
    const def = tourDefOf(a.b.type);
    if (!def) return null;
    let s = this.st.get(a.id);
    if (!s) { s = this.fresh(a.id, a.b.type, def); this.st.set(a.id, s); } else s.def = def;
    return s;
  }

  private rollDay(s: TourState): void {
    const d = this.ctx.absDay;
    if (s.day === d) return;
    s.prevDep = d - s.day === 1 ? s.dep : 0;
    s.day = d; s.dep = 0; s.riders = 0; s.revenue = 0;
  }

  private allow(s: TourState): (x: number, y: number) => boolean {
    const def = s.def;
    return (x, y) => {
      if (def.motorised && this.d.isPiste(x, y)) return false;
      for (const k of def.routes) if (this.d.allows(k, x, y, def)) return true;
      return false;
    };
  }

  private ensureRoute(s: TourState, b: WorldBuilding): void {
    const v = this.d.version();
    if (s.ver === v) return;
    s.ver = v;
    if (s.def.routes.length === 1 && s.def.routes[0] === 'water') { s.plan = { ok: false, reason: TOURS.waterStub }; return; }
    s.plan = planRoute(this.allow(s), b, this.d.size, s.def.minLen, s.def.maxLen);
  }

  /** Tile indices of the planned route (one way), [] when there is none. */
  route(id: number): readonly number[] { const s = this.st.get(id); return s && s.plan.ok ? s.plan.tiles : []; }

  /** Verdict for the attraction system: why this tour cannot take guests right now (null = open). */
  closed(a: Attraction): string | null {
    const s = this.state(a);
    if (!s) return null;
    this.rollDay(s);
    this.prune(s);
    const def = s.def;
    if (!def.seasons.includes(seasonOf({ day: this.ctx.day }))) return 'Closed for the season';
    this.ensureRoute(s, a.b);
    if (!s.plan.ok) return `Closed: ${s.plan.reason}`;
    if (this.ctx.tick - s.dynTick >= TOURS.checkEvery || this.ctx.tick < s.dynTick) { s.dynTick = this.ctx.tick; s.dyn = this.dynamic(s, a.b); }
    return s.dyn;
  }

  private dynamic(s: TourState, b: WorldBuilding): string | null {
    const def = s.def;
    if (this.d.weather().wind > def.maxWind) return 'Closed: too windy';
    if (s.plan.ok) for (const i of s.plan.tiles) if (this.d.instability(i) > def.maxInstability) return 'Closed: avalanche danger on the route';
    if (def.routes.includes('water') && this.d.frozen?.(b)) return 'Closed: the river is frozen';
    return null;
  }

  /** Guests may queue from an hour before the first until the last departure. */
  serving(a: Attraction): boolean {
    const def = tourDefOf(a.b.type);
    return !def || (this.ctx.hour >= def.firstHour - 1 && this.ctx.hour <= def.lastHour);
  }

  private prune(s: TourState): void {
    if (s.rides.length && s.rides.some((r) => r.end <= this.ctx.tick)) s.rides = s.rides.filter((r) => r.end > this.ctx.tick);
  }

  /** Latest scheduled departure slot (absolute) at or before now, or -1 before the first one today. */
  private latestSlot(def: TourDef): number {
    const s = Math.floor(this.ctx.hour * 10), first = Math.round(def.firstHour * 10), last = Math.round(def.lastHour * 10);
    if (s < first) return -1;
    const k = Math.floor((Math.min(s, last) - first) / def.intervalTicks);
    return this.ctx.absDay * DAY_TICKS + first + k * def.intervalTicks;
  }

  /**
   * Does a departure leave now? True once per scheduled slot, when the slot is fresh (< one interval old: a closed tour does not leave late) and
   * `queued` >= minRiders. The caller then boards the riders and calls `departed`.
   */
  due(a: Attraction, queued: number): boolean {
    const s = this.state(a);
    if (!s) return false;
    const def = s.def, slot = this.latestSlot(def);
    if (slot < 0 || slot <= s.lastKey) return false;
    const now = this.ctx.absDay * DAY_TICKS + Math.floor(this.ctx.hour * 10);
    if (now - slot >= def.intervalTicks) { s.lastKey = slot; return false; }
    s.lastKey = slot;
    return queued >= def.minRiders;
  }

  /** The riders have boarded: book the counters, remember the ride, scare wildlife for motorised tours. */
  departed(a: Attraction, riders: number, revenue: number, duration: number): void {
    const s = this.state(a);
    if (!s) return;
    this.rollDay(s);
    s.dep++; s.riders += riders; s.revenue = round2(s.revenue + revenue);
    s.totalDep++; s.totalRiders += riders; s.totalRevenue = round2(s.totalRevenue + revenue);
    s.rides.push({ start: this.ctx.tick, end: this.ctx.tick + duration, riders });
    if (s.def.motorised && s.def.noiseRadius > 0 && s.plan.ok) {
      const n = this.d.size, t = s.plan.tiles;
      for (let k = 0; k < t.length; k += TOURS.noiseEvery) this.d.disturb?.((t[k]! % n) + 0.5, ((t[k]! / n) | 0) + 0.5, s.def.noiseRadius);
    }
  }

  info(a: Attraction): TourInfo | null {
    const s = this.state(a);
    if (!s) return null;
    this.rollDay(s); this.prune(s);
    const def = s.def, first = Math.round(def.firstHour * 10), last = Math.round(def.lastHour * 10), now = Math.floor(this.ctx.hour * 10);
    let next: TourInfo['next'] = null;
    if (def.seasons.length) {
      const k = now < first ? 0 : Math.floor((now - first) / def.intervalTicks) + 1;
      const t = first + k * def.intervalTicks;
      next = t <= last ? { hour: t / 10, tomorrow: false } : { hour: first / 10, tomorrow: true };
    }
    return {
      closed: this.closed(a), routeLen: s.plan.ok ? s.plan.tiles.length : 0,
      departuresToday: s.dep, ridersToday: s.riders, revenueToday: s.revenue, riding: s.rides.reduce((n, r) => n + r.riders, 0), next,
      totalDepartures: s.totalDep, totalRiders: s.totalRiders, totalRevenue: s.totalRevenue,
    };
  }

  /**
   * Sustainability facet points taken by motorised tours (>= 0, never more than TOURS.maxSustainPenalty): the larger of yesterday's and today's
   * departures x `sustainPerDeparture`, summed over tours.
   */
  motorPenalty(): number {
    let p = 0;
    const d = this.ctx.absDay;
    for (const s of this.st.values()) {
      if (!s.def.motorised) continue;
      const n = s.day === d ? Math.max(s.prevDep, s.dep) : s.day === d - 1 ? s.dep : 0;
      p += n * s.def.sustainPerDeparture;
    }
    return Math.min(TOURS.maxSustainPenalty, Math.round(p * 100) / 100);
  }

  /**
   * Cosmetic carriers of the rides in progress, at `tick` (view only: nothing here is read by the sim). Each departure sends `def.vehicles`
   * carriers one behind the other along the out-and-back route. Capped at `max`.
   */
  carriers(tick: number, out: Carrier[] = [], max: number = TOURS.maxCarriers): Carrier[] {
    out.length = 0;
    const n = this.d.size;
    for (const s of this.st.values()) {
      if (!s.plan.ok || s.plan.tiles.length < 2) continue;
      const t = s.plan.tiles, L = t.length;
      for (const r of s.rides) {
        if (r.end <= tick || r.start > tick) continue;
        const per = Math.max(1, Math.round(r.riders / Math.max(1, s.def.vehicles)));
        for (let v = 0; v < s.def.vehicles; v++) {
          if (out.length >= max) return out;
          const p = Math.min(1, Math.max(0, (tick - r.start) / (r.end - r.start) - v * 0.03));
          const u = p < 0.5 ? p * 2 : 2 - p * 2, f = u * (L - 1), i0 = Math.min(L - 2, Math.floor(f)), k = f - i0;
          const ax = (t[i0]! % n) + 0.5, ay = ((t[i0]! / n) | 0) + 0.5, bx = (t[i0 + 1]! % n) + 0.5, by = ((t[i0 + 1]! / n) | 0) + 0.5;
          const dir = p < 0.5 ? 1 : -1;
          out.push({ kind: s.def.vehicle, x: ax + (bx - ax) * k, y: ay + (by - ay) * k, heading: Math.atan2((by - ay) * dir, (bx - ax) * dir), seats: per });
        }
      }
    }
    return out;
  }

  // ---------- persistence ----------

  /** Null when nothing ever ran (keeps the `tours` save module out of `stateHash` until content exists). Rides in progress are not saved (riders are released on load, like every attraction user). */
  serialize(): unknown {
    if (this.st.size === 0) return null;
    return {
      tours: [...this.st.values()].sort((p, q) => p.id - q.id).map((s) => ({ id: s.id, type: s.type, lastKey: s.lastKey, day: s.day, dep: s.dep, riders: s.riders, revenue: s.revenue, prevDep: s.prevDep, totalDep: s.totalDep, totalRiders: s.totalRiders, totalRevenue: s.totalRevenue })),
    };
  }
  load(d: unknown): void {
    this.reset();
    const o = d as { tours?: Array<Partial<TourState> & { id: number; type: string }> } | null;
    for (const t of o?.tours ?? []) {
      const def = tourDefOf(t.type);
      if (!def) continue;
      const s = this.fresh(t.id, t.type, def);
      Object.assign(s, { lastKey: t.lastKey ?? -1, day: t.day ?? 0, dep: t.dep ?? 0, riders: t.riders ?? 0, revenue: t.revenue ?? 0, prevDep: t.prevDep ?? 0, totalDep: t.totalDep ?? 0, totalRiders: t.totalRiders ?? 0, totalRevenue: t.totalRevenue ?? 0 });
      this.st.set(t.id, s);
    }
  }
  reset(): void { this.st.clear(); }
}

/** Behaviour spec of a tour base for the attraction registry (price / staff / upkeep come from the building and price tables). */
export function tourSpec(def: TourDef): AttractionSpec {
  return { kind: 'tour', tour: def.id, serviceTicks: def.durationTicks, slots: def.seats, effects: { happiness: def.happiness }, appeal: def.appeal };
}

/** Specs of every catalogue tour (empty until the content tasks add rows). */
export const tourSpecs = (): Record<string, AttractionSpec> => Object.fromEntries(Object.values(TOUR_DEFS).map((d) => [d.id, tourSpec(d)]));
