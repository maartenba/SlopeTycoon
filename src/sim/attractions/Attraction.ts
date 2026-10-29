import { BUILDINGS, type BuildingDef } from '../../config/buildings';
import { EVENING } from '../../config/balance';
import { PRICE_TABLE, STAFF_WAGE_PER_DAY, type LedgerCategory } from '../../config/prices';
import type { WorldBuilding } from '../guests/GuestWorld';
import type { SeasonId } from '../../core/events';
import type { LodgingTier } from '../../config/prices';
import type { TourInfo } from './Tour';

/** Preference per guest type: [solo, couple, family, vip, budget, adventure]. */
export type Appeal = readonly [number, number, number, number, number, number];

export interface AttractionSpec {
  /** Free-form kind label (restaurant, rink, ...). */
  kind: string;
  /** Ticks one guest occupies a slot (10 ticks = 1 in-game hour). */
  serviceTicks: number;
  /** Simultaneous users; defaults to the catalog capacity. */
  slots?: number;
  /** Need effects applied when service completes. */
  effects: { hungerTo?: number; fatigue?: number; happiness?: number; /** Comfort need: the urge is lowered to at most this (0 = fully relieved). Toilets 0, dining venues a little. */ urgeTo?: number };
  appeal: Appeal;
  /** Guests get ski/board/bike gear (rental). */
  grantsGear?: boolean;
  /** Only overnight guests may use it (lodging). */
  overnightOnly?: boolean;
  /** Overnight rooms (lodging); defaults to none. */
  rooms?: number;
  /** Lodging v2 (docs/lodging.md): price tier (nightly rate x tier multiplier, appeal vector shift). Absent = legacy (chalet / apartment: unchanged). */
  tier?: LodgingTier;
  /** Lodging v2: seasons in which the house takes guests; outside them it is "Closed for the season" (no check-ins). Absent = year-round. */
  seasonOpen?: readonly SeasonId[];
  /** Lodging v2 amenity. 'pool': `poolSlots` extra simultaneous `Using` places for overnight guests, `poolHappiness` bonus per visit. */
  amenity?: 'pool';
  poolSlots?: number;
  poolHappiness?: number;
  /** Campground: an evening campfire gathering (happiness for the campers, better with toilets nearby; the render burns a fire). */
  campfire?: boolean;
  /** Trekker beds (Mountain Hut): booked by multi-day hikers, separate from `rooms` (overnight resort guests). */
  beds?: number;
  /** Food / drink venue with evening opening hours (serves 08:00 - 23:00 winter / 22:30 summer; evening shift costs extra staff). */
  eveningShift?: boolean;
  /** Extra closed condition evaluated by the system, e.g. 'lake'. */
  extra?: 'lake';
  /** Tour base (Phase 6 Task 5, docs/tours.md): TourDef id. Guests board in scheduled departures instead of one by one; see TourSystem. */
  tour?: string;
}

export interface AttractionStats { /** Campground: evenings a campfire burned (inspector). */ fires?: number; /** Toilets: uses so far today and the absolute day they belong to (cleanliness). Absent elsewhere / in old saves. */ today?: number; todayDay?: number; served: number; revenue: number; balked: number; reneged: number; turnedAway: number; nights: number; /** Revenue by in-game hour (24 buckets; restaurants / bars / terraces). Absent in old saves. */ hourly?: number[] }

/** Plain data for the inspector / reports. */
export interface AttractionInfo {
  id: number; name: string; open: boolean; reason?: string;
  served: number; revenue: number; balked: number; reneged: number; nights: number;
  queue: number; users: number; capacity: number;
  /** Hour (0..23) with the most revenue so far, with its share (0..1); null without data / for non-venues. */
  busiestHour?: { hour: number; share: number } | null;
  price: number; maxPrice: number; billing: 'perUse' | 'perHour' | 'perNight'; unitPrice: number;
  staff: number; staffRequired: number; upkeepPerDay: number;
  /** Trekker beds (Mountain Hut): capacity, booked tonight, nights sold so far. */
  beds?: { total: number; used: number; sold: number };
  /** Campground: pitches, campers tonight, toilets within reach, evenings of fire. */
  camp?: { pitches: number; used: number; toilets: boolean; fires: number };
  /** Tour base: departures today, riders, next departure, route (TourSystem.info). */
  tour?: TourInfo;
  /** Toilets (comfort need): guests served today and the per-day figure above which the block is overrun. */
  toilet?: { usesToday: number; perDay: number };
}

export interface InstanceSave { id: number; price: number; staff: number; stats: AttractionStats; open?: boolean; reason?: string; reported?: boolean }

/** Runtime state of one placed attraction: queue (FIFO with balking), service slots, price, staff, counters. */
export class Attraction {
  readonly def: BuildingDef;
  price: number;
  staff: number;
  /** Tour bases: inspector data (set by the attraction system). */
  tourInfo: (() => TourInfo | null) | undefined;
  /** Live price multiplier (markup % x seasonal schedule), set by the system; 1 = list price. */
  priceScale: () => number = () => 1;
  /** Hour-of-day price multiplier (evening drinks premium for venues); 1 = none. Set by the system. */
  hourScale: () => number = () => 1;
  open = true;
  reason: string | undefined;
  /** Last verdict reported through the bus (undefined = never). */
  reported: boolean | undefined;
  users: Array<{ id: number; end: number }> = [];
  queue: Array<{ id: number; since: number }> = [];
  stats: AttractionStats = { served: 0, revenue: 0, balked: 0, reneged: 0, turnedAway: 0, nights: 0 };

  constructor(readonly b: WorldBuilding, readonly spec: AttractionSpec) {
    this.def = BUILDINGS[b.type]!;
    this.price = PRICE_TABLE[b.type]?.price ?? 0;
    this.staff = this.def.staff;
  }

  get id(): number { return this.b.id; }
  get category(): LedgerCategory { return PRICE_TABLE[this.b.type]?.category ?? 'recreation'; }
  get billing(): 'perUse' | 'perHour' | 'perNight' { return PRICE_TABLE[this.b.type]?.billing ?? 'perUse'; }
  get maxPrice(): number { return PRICE_TABLE[this.b.type]?.max ?? 0; }

  baseCapacity(): number { return Math.max(1, (this.spec.slots ?? this.def.capacity) + (this.spec.amenity === 'pool' ? this.spec.poolSlots ?? 0 : 0)); }
  /** Staff ratio 0..1: understaffed attractions serve fewer guests at once. */
  staffFactor(): number { return this.def.staff > 0 ? Math.min(1, this.staff / this.def.staff) : 1; }
  /** Simultaneous capacity after staffing. */
  capacity(): number { const f = this.staffFactor(); return f <= 0 ? 0 : Math.max(1, Math.floor(this.baseCapacity() * f)); }
  /** Extra staff beyond the requirement speed service up to +50 %. */
  serviceTime(): number {
    const req = this.def.staff;
    const speed = req > 0 && this.staff > req ? 1 + Math.min(0.5, 0.5 * (this.staff / req - 1)) : 1;
    return Math.max(1, Math.round(this.spec.serviceTicks / speed));
  }
  queueMax(): number { return Math.ceil(this.capacity() * 1.5) + 4; }
  /** Charge for one use (per-hour billing multiplies by service hours). */
  unitPrice(): number {
    const p = this.price * this.priceScale() * this.hourScale();
    return Math.round((this.billing === 'perHour' ? p * (this.spec.serviceTicks / 10) : p) * 100) / 100;
  }
  /** Daily upkeep including the wage of hired staff above/below the catalog requirement. */
  upkeepPerDay(): number { return Math.max(0, this.def.upkeep * (this.spec.eveningShift ? 1 + EVENING.staffCost : 1) + (this.staff - this.def.staff) * STAFF_WAGE_PER_DAY); }
  /** Credit revenue to its hour bucket. */
  recordRevenue(hour: number, amount: number): void { const h = (this.stats.hourly ??= new Array<number>(24).fill(0)); h[Math.floor(hour) % 24]! += amount; }
  busiestHour(): { hour: number; share: number } | null {
    const h = this.stats.hourly; if (!h) return null;
    const tot = h.reduce((a, b) => a + b, 0); if (tot <= 0) return null;
    let bi = 0; for (let i = 1; i < 24; i++) if (h[i]! > h[bi]!) bi = i;
    return { hour: bi, share: h[bi]! / tot };
  }
  get queueLength(): number { return this.queue.length; }
  get usersNow(): number { return this.users.length; }

  setPrice(p: number): void { this.price = Math.max(0, Math.min(this.maxPrice, p)); }
  setStaff(n: number): void { this.staff = this.def.staff === 0 ? 0 : Math.max(0, Math.min(this.def.staff * 2, Math.round(n))); }

  info(): AttractionInfo {
    return {
      id: this.id, name: this.def.name, open: this.open, reason: this.reason,
      served: this.stats.served, revenue: this.stats.revenue, balked: this.stats.balked, reneged: this.stats.reneged, nights: this.stats.nights,
      queue: this.queue.length, users: this.users.length, capacity: this.capacity(), busiestHour: this.busiestHour(),
      price: this.price, maxPrice: this.maxPrice, billing: this.billing, unitPrice: this.unitPrice(),
      staff: this.staff, staffRequired: this.def.staff, upkeepPerDay: this.upkeepPerDay(),
      ...(this.tourInfo ? { tour: this.tourInfo() ?? undefined } : {}),
    };
  }

  save(): InstanceSave { return { id: this.b.id, price: this.price, staff: this.staff, stats: { ...this.stats, ...(this.stats.hourly ? { hourly: [...this.stats.hourly] } : {}) }, open: this.open, reason: this.reason, reported: this.reported }; }
  /** Queues / users are NOT restored (guests inside are released by the next membership check). */
  load(d: InstanceSave): void {
    this.price = d.price; this.staff = d.staff; this.stats = { ...d.stats, ...(d.stats.hourly ? { hourly: [...d.stats.hourly] } : {}) };
    if (d.open !== undefined) { this.open = d.open; this.reason = d.reason; this.reported = d.reported; }
    this.queue = []; this.users = [];
  }
}

export const LOW: Appeal = [0.3, 0.3, 0.3, 0.3, 0.3, 0.3];
