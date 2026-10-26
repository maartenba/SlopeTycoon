import type { GameState } from '../../core/GameState';
import type { GameBus, SeasonId } from '../../core/events';
import { BUILDINGS } from '../../config/buildings';
import { DAYS_PER_YEAR, GUEST_BASE_SPAWN_PER_TICK, SIZE_SPAWN_MULT } from '../../config/balance';
import { hourOfDay, seasonOf } from '../Clock';
import { arrivalWindow } from '../Daylight';
import type { SimSystem } from '../Systems';
import {
  evaluateArrivals, makeCum, tripPlan, VEHICLE_SPEED, VehicleKind, centre, vehiclePose, type ArrivalPoint, type ArrivalReport, type Vehicle,
} from './Arrivals';
import { GUEST_TYPE_NAMES, GuestType, Mode, Skill, type GuestStore, type GuestTypeName } from './Guest';
import type { GuestWorld, Pt, ResortStats } from './GuestWorld';
import type { SpatialHash } from './SpatialHash';

/** Marketing stub: per-type weights (default mix) and an overall multiplier. Later tasks drive it from campaigns. */
export interface MarketingState { weights: Record<GuestTypeName, number>; boost: number }
export const defaultMarketing = (): MarketingState => ({ weights: { solo: 1, couple: 1, family: 1, vip: 1, budget: 1, adventure: 1 }, boost: 1 });

/** Price stub (default price table); real pricing arrives with the economy tasks. */
export interface PriceTable { dayTicket: number; meal: number; lodgingNight: number }
export const DEFAULT_PRICES: PriceTable = { dayTicket: 45, meal: 12, lodgingNight: 120 };
const REFERENCE_TICKET = 45;

/** Pricing hook (Task 32): arrival-volume multiplier for a type mix at today's day-pass price, and a per-type share weight. */
export interface PricingDemand { volume(mix: readonly number[]): number; typeWeight(k: number): number }

/** Guest-type mix by season (relative weights, order = GUEST_TYPE_NAMES: solo, couple, family, vip, budget, adventure). */
export const TYPE_MIX: Record<SeasonId, readonly number[]> = {
  winter: [0.2, 0.2, 0.25, 0.05, 0.15, 0.15],
  spring: [0.2, 0.25, 0.2, 0.05, 0.15, 0.15],
  summer: [0.1, 0.15, 0.35, 0.05, 0.1, 0.25],
  autumn: [0.2, 0.3, 0.1, 0.1, 0.1, 0.2],
};
export const SEASON_RATE: Record<SeasonId, number> = { winter: 1, spring: 0.5, summer: 0.6, autumn: 0.4 };

/**
 * Off-season demand floor (docs/balance.md "Gentler summer"). With no open lift only 15 % of the guests came, which made every
 * snow-less month a ghost town even for a resort with restaurants, lodging and paths. Outside winter a village with amenities and
 * attractions keeps drawing day guests (hikers, sightseers, families): the no-open-lift factor rises with the amenity variety and the
 * attractions, up to `OFFSEASON_NO_LIFT_MAX`. Winter keeps the strict 0.15.
 */
export const OFFSEASON_NO_LIFT_MAX = 0.6;
export function offSeasonNoLiftFactor(s: Pick<ResortStats, 'amenityVariety' | 'attractions'>): number {
  return Math.min(OFFSEASON_NO_LIFT_MAX, Math.max(0.15, 0.15 + 0.07 * s.amenityVariety + 0.05 * s.attractions));
}
const GROUP: Record<number, readonly [number, number]> = {
  [GuestType.Solo]: [1, 1], [GuestType.Couple]: [2, 2], [GuestType.Family]: [3, 5], [GuestType.VIP]: [1, 2], [GuestType.Budget]: [2, 4], [GuestType.Adventure]: [1, 3],
};
const BUDGET: Record<number, readonly [number, number]> = {
  [GuestType.Solo]: [150, 300], [GuestType.Couple]: [250, 450], [GuestType.Family]: [400, 700], [GuestType.VIP]: [1500, 3000], [GuestType.Budget]: [80, 150], [GuestType.Adventure]: [200, 400],
};
const OVERNIGHT_P: Record<number, number> = { [GuestType.Solo]: 0.3, [GuestType.Couple]: 0.6, [GuestType.Family]: 0.6, [GuestType.VIP]: 0.9, [GuestType.Budget]: 0.15, [GuestType.Adventure]: 0.5 };
const WEATHER_RATE: Record<string, number> = { clear: 1, cloudy: 0.95, snow: 1.3, heavySnow: 1.5, rain: 0.6, storm: 0.25 };

/** Legacy fixed window (superseded by arrivalWindow(day) in sim/Daylight.ts). */
export const SPAWN_FROM_HOUR = 7.5, SPAWN_TO_HOUR = 15.5;

/** Attractiveness stub 0..1.5: open lifts, open piste length, attractions and amenity variety. Task 27 replaces it. */
export function attractiveness(s: ResortStats): number {
  const v = 0.35 * Math.min(1, s.openLifts / 4) + 0.35 * Math.min(1, s.openPisteTiles / 200) + 0.15 * Math.min(1, s.attractions / 4) + 0.15 * Math.min(1, s.amenityVariety / 5);
  const lifts = s.openLifts > 0 ? 1 : 0.15; // no open lift = hardly anyone comes
  return v * lifts * 1.5;
}

export interface SpawnStatus { text: string; arrivals: ArrivalReport | null; rate: number; attractiveness: number; overflow: number }

const skillFor = (type: number, r: number): number => {
  const t = type === GuestType.Adventure ? [0.1, 0.2, 0.35, 0.35] : type === GuestType.VIP ? [0.1, 0.3, 0.4, 0.2] : type === GuestType.Family ? [0.5, 0.35, 0.12, 0.03] : [0.3, 0.35, 0.25, 0.1];
  let a = 0;
  for (let k = 0; k < 4; k++) { a += t[k]!; if (r < a) return k; }
  return Skill.Expert;
};

/**
 * Arrival spawner. Expected guests/tick = base × attractiveness × season × weather(powder) × marketing × price; vehicles carry
 * guest groups in along the road/rail/air route and guests materialise when the vehicle arrives.
 *
 * CAP POLICY: active guests (+ riders still travelling) never exceed `store.capacity` (1000/2000/3000 by map size). Over the cap
 * arrivals are throttled: the vehicle is not spawned and its riders are counted in `overflow` (aggregated demand - they "visit"
 * the resort in the statistics only, are not simulated and do not block lodging/parking).
 */
export class Spawner {
  vehicles: Vehicle[] = [];
  marketing = defaultMarketing();
  prices: PriceTable = { ...DEFAULT_PRICES };
  overflow = 0;
  /** Difficulty multiplier on the arrival rate. */
  rateMult = 1;
  /** Scenario modifier: per guest type weight multiplier (order = GUEST_TYPE_NAMES); null = none. */
  mixBias: readonly number[] | null = null;
  /** Live marketing provider (campaigns); default = the `marketing` field. */
  marketingFn: (() => MarketingState) | null = null;
  /** Price elasticity + calendar demand (replaces the fixed-ticket stub when set). */
  pricingDemand: PricingDemand | null = null;
  /** Attractiveness provider (Task 27 hooks the resort rating in); default = the stub above. */
  private attractFn: (s: ResortStats) => number = attractiveness;
  private acc = 0;
  private nextVehicle = 1;
  private nextGroup = 1;
  private report: ArrivalReport | null = null;
  private stats: ResortStats = { openLifts: 0, openPisteTiles: 0, attractions: 0, amenityVariety: 0 };
  private lodging = 0;
  private modeLoad = [0, 0, 0];
  private lastRate = 0;
  private lastAttr = 0;
  private routes = new Map<string, number[]>();
  private routeVersion = -1;

  constructor(private world: GuestWorld, private store: GuestStore, private hash: SpatialHash, private bus?: Pick<GameBus, 'emit'>) {}

  setAttractiveness(fn: ((s: ResortStats) => number) | null): void { this.attractFn = fn ?? attractiveness; }

  status(): SpawnStatus {
    const r = this.report;
    return { text: r ? r.message : '', arrivals: r, rate: this.lastRate, attractiveness: this.lastAttr, overflow: this.overflow };
  }

  private refresh(): void {
    this.report = evaluateArrivals(this.world);
    this.stats = this.world.stats();
    this.lodging = 0;
    for (const b of this.world.buildings()) if (b.active && BUILDINGS[b.type]?.category === 'lodging') this.lodging += BUILDINGS[b.type]!.capacity;
    this.modeLoad = [0, 0, 0];
    const s = this.store;
    for (let i = 0; i < s.limit; i++) if (s.alive[i]) this.modeLoad[s.mode[i]!]!++;
    for (const v of this.vehicles) this.modeLoad[v.mode]! += v.riders.length;
  }

  update(state: GameState, tick: number): void {
    if (tick % 10 === 0 || !this.report) this.refresh();
    this.advanceVehicles(state);
    const hour = hourOfDay(state.date);
    const season = seasonOf(state.date);
    const r = this.report!;
    const win = arrivalWindow(state.date.day); // follows the sun (sim/Daylight.ts)
    if (!r.any || hour < win.from || hour > win.to) { this.lastRate = 0; if (!r.any) this.acc = 0; return; }
    const attr = this.attractFn(this.stats);
    const w = this.world.weather();
    const mk = this.marketingFn?.() ?? this.marketing;
    const priceF = this.pricingDemand
      ? this.pricingDemand.volume(TYPE_MIX[season].map((m, k) => m * (this.mixBias?.[k] ?? 1) * (mk.weights[GUEST_TYPE_NAMES[k]!] ?? 1)))
      : Math.min(1.5, Math.max(0.3, REFERENCE_TICKET / Math.max(1, this.prices.dayTicket)));
    const windowNorm = Math.min(1.6, Math.max(0.75, 8 / Math.max(1, win.to - win.from))); // keeps guests per DAY ~ constant when the daylight window shrinks (winter 5.5 h) or grows (summer 10.5 h)
    const rate = GUEST_BASE_SPAWN_PER_TICK * windowNorm * attr * SEASON_RATE[season] * (WEATHER_RATE[w.kind] ?? 1) * mk.boost * priceF * this.rateMult * (SIZE_SPAWN_MULT[this.world.mapSize as 64 | 128 | 256] ?? 1);
    this.lastRate = rate; this.lastAttr = attr;
    this.acc += rate * (0.5 + state.rng.next());
    for (let n = 0; n < 6 && this.acc >= 1; n++) {
      const size = this.spawnVehicle(state, season, r);
      if (size <= 0) { this.acc = Math.min(this.acc, 1); break; }
      this.acc -= size;
    }
    if (this.acc > 8) this.acc = 8;
  }

  private pickType(state: GameState, season: SeasonId, r: ArrivalReport): number {
    const mix = TYPE_MIX[season];
    const mk = this.marketingFn?.() ?? this.marketing;
    let tot = 0;
    const ws = mix.map((m, k) => {
      let v = m * (this.mixBias?.[k] ?? 1) * (mk.weights[GUEST_TYPE_NAMES[k]!] ?? 1) * (this.pricingDemand?.typeWeight(k) ?? 1);
      if (k === GuestType.VIP && r.air.available) v *= 3;
      tot += v; return v;
    });
    let u = state.rng.next() * tot;
    for (let k = 0; k < ws.length; k++) { u -= ws[k]!; if (u < 0) return k; }
    return GuestType.Solo;
  }

  private modeOk(p: ArrivalPoint, extra: number): boolean { return p.available && this.modeLoad[p.mode]! + extra <= p.capacity; }

  /** Returns the number of guests dispatched (0 = nothing possible this tick). */
  private spawnVehicle(state: GameState, season: SeasonId, r: ArrivalReport): number {
    const rng = state.rng;
    const type = this.pickType(state, season, r);
    const [gmin, gmax] = GROUP[type]!;
    let size = rng.int(gmin, gmax);
    let kind: number = VehicleKind.Car;
    let riders = [type];
    // mode choice
    let p: ArrivalPoint | null = null;
    if (type === GuestType.VIP && this.modeOk(r.air, size)) p = r.air;
    else {
      const opts = [r.road, r.rail].filter((m) => this.modeOk(m, size));
      if (opts.length) p = opts.length === 1 ? opts[0]! : rng.chance(0.7) ? r.road : r.rail;
    }
    if (!p) return 0;
    if (p === r.road && r.road.destinations.some((d) => d.type === 'shuttleDepot') && rng.chance(0.15)) {
      kind = VehicleKind.Bus; size = rng.int(8, 14);
      riders = Array.from({ length: size }, () => rng.pick([GuestType.Solo, GuestType.Budget, GuestType.Adventure]));
    } else riders = Array.from({ length: size }, () => type);
    if (p === r.rail) kind = VehicleKind.Train;
    if (p === r.air) kind = VehicleKind.Plane;
    if (this.store.count + this.ridersInFlight() + size > this.store.capacity) { this.overflow += size; return size; } // aggregate
    const dests = kind === VehicleKind.Bus ? p.destinations.filter((d) => d.type === 'shuttleDepot') : p.destinations;
    const dest = rng.pick(dests);
    const to = { x: dest.x, y: dest.y, w: dest.w, h: dest.h };
    let pts: number[] = [];
    if (kind === VehicleKind.Plane) {
      const c = centre(to);
      pts = [c.x - 50, c.y - 20, c.x, c.y];
    } else if (p.entry) {
      const rt = this.cachedRoute(kind === VehicleKind.Train ? 'rail' : 'road', p.entry, dest.id, to);
      pts = rt.length >= 4 ? rt : [p.entry.x + 0.5, p.entry.y + 0.5, centre(to).x, centre(to).y];
    }
    const cum = makeCum(pts);
    const plan = tripPlan(cum[cum.length - 1]!, VEHICLE_SPEED[kind]!);
    const v: Vehicle = {
      id: this.nextVehicle++, kind, mode: p.mode, pts, cum, dist: plan.dist, speed: plan.speed,
      riders, group: this.nextGroup++, dest: dest.id, alt: kind === VehicleKind.Plane ? 6 : 0,
    };
    this.vehicles.push(v);
    this.modeLoad[p.mode]! += size;
    return size;
  }

  /**
   * Bench / test helper: arrive guests instantly at the road entry (type mix like normal arrivals) until `target` are alive, at most
   * `perCall` per call. Goes through the same `materialise` path (tickets, `onArrival`, `guest:arrived`), so guests behave normally.
   */
  benchFill(state: GameState, target: number, perCall = 300): number {
    if (!this.report) this.refresh();
    const r = this.report!;
    const e = this.world.roadEntry();
    if (!r.any || !e) return 0;
    const season = seasonOf(state.date);
    let added = 0;
    while (this.store.count < target && added < perCall) {
      const type = this.pickType(state, season, r);
      const [gmin, gmax] = GROUP[type]!;
      const size = state.rng.int(gmin, gmax);
      const v = { id: 0, kind: VehicleKind.Car, mode: Mode.Road, pts: [], cum: [0], dist: 0, speed: 0, riders: Array.from({ length: size }, () => type), group: this.nextGroup++, dest: 0, alt: 0 } as Vehicle;
      this.materialise(state, v, e.x + 0.5, e.y + 0.5);
      added += size;
    }
    return added;
  }

  private ridersInFlight(): number { let n = 0; for (const v of this.vehicles) n += v.riders.length; return n; }

  private cachedRoute(kind: 'road' | 'rail', from: Pt, destId: number, to: { x: number; y: number; w: number; h: number }): number[] {
    const ver = this.world.networkVersion();
    if (ver !== this.routeVersion) { this.routes.clear(); this.routeVersion = ver; }
    const key = `${kind}:${destId}`;
    let c = this.routes.get(key);
    if (!c) {
      const path = this.world.route(kind, from, to);
      c = path.flatMap((t) => [t.x + 0.5, t.y + 0.5]);
      this.routes.set(key, c);
    }
    return c;
  }

  private advanceVehicles(state: GameState): void {
    if (!this.vehicles.length) return;
    const keep: Vehicle[] = [];
    const pose = { x: 0, y: 0, heading: 0 };
    for (const v of this.vehicles) {
      v.dist += v.speed;
      const total = v.cum[v.cum.length - 1]!;
      if (v.dist < total) { keep.push(v); continue; }
      vehiclePose(v, total, pose);
      this.materialise(state, v, pose.x, pose.y);
    }
    this.vehicles = keep;
  }

  private materialise(state: GameState, v: Vehicle, x: number, y: number): void {
    const rng = state.rng;
    const absDay = state.date.year * DAYS_PER_YEAR + state.date.day;
    const ticket = this.world.ticketAtEntrance?.() === false ? 0 : (this.world.dayTicketPrice?.() ?? this.prices.dayTicket);
    for (const type of v.riders) {
      const [b0, b1] = BUDGET[type]!;
      const budget = b0 + rng.next() * (b1 - b0) - ticket;
      const free = this.lodging - this.store.overnightCount;
      const overnight = free > 0 && rng.chance(OVERNIGHT_P[type]!);
      const gx = x + (rng.next() - 0.5) * 1.2, gy = y + (rng.next() - 0.5) * 1.2;
      const slot = this.store.add({
        x: gx, y: gy, z: this.world.groundAt(gx, gy), type, skill: skillFor(type, rng.next()), budget, group: v.group, mode: v.mode,
        overnight, leaveDay: overnight ? absDay + rng.int(1, 3) : absDay, tick: state.date.tick,
        happiness: 0.8, hunger: 0.05 + rng.next() * 0.2,
      });
      if (slot < 0) { this.overflow++; continue; }
      this.hash.insert(slot, gx, gy);
      if (ticket > 0) this.world.onSpend?.(ticket, 'ticket');
      this.world.onArrival?.(this.store.id[slot]!, ticket);
      this.bus?.emit('guest:arrived', { id: this.store.id[slot]! });
    }
  }

  serialize(): unknown {
    return { vehicles: this.vehicles, acc: this.acc, nextVehicle: this.nextVehicle, nextGroup: this.nextGroup, overflow: this.overflow, marketing: this.marketing, prices: this.prices };
  }
  load(d: unknown): void {
    const s = d as ReturnType<Spawner['serialize']> as { vehicles: Vehicle[]; acc: number; nextVehicle: number; nextGroup: number; overflow: number; marketing: MarketingState; prices: PriceTable };
    this.vehicles = s.vehicles; this.acc = s.acc; this.nextVehicle = s.nextVehicle; this.nextGroup = s.nextGroup; this.overflow = s.overflow;
    this.marketing = s.marketing; this.prices = s.prices; this.report = null;
  }
}

export function createSpawnerSystem(sp: Spawner): SimSystem {
  return { id: 'spawner', update: (state, tick) => sp.update(state, tick), serialize: () => sp.serialize(), load: (d) => sp.load(d) };
}
