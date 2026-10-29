import { appealFor } from '../../config/guestTypes';
import type { GameState } from '../../core/GameState';
import type { GameBus } from '../../core/events';
import { DAYS_PER_YEAR } from '../../config/balance';
import { NIGHTLY_RATE, type LedgerCategory } from '../../config/prices';
import { hourOfDay, seasonOf } from '../Clock';
import type { SimSystem } from '../Systems';
import { Act } from '../guests/Decision';
import type { ArriveResult, GuestAttractionPort } from '../guests/AttractionPort';
import { GState, type GuestStore } from '../guests/Guest';
import type { WorldBuilding } from '../guests/GuestWorld';
import { Attraction, type InstanceSave } from './Attraction';
import { TrailUsage } from './Hiking';
import { RoomBook } from './Lodging';
import { hikeFee, mtbFee } from './MtbTrail';
import { ownsGear } from './Rental';
import { ATTRACTION_SPECS } from './registry';
import { eveningPremium, venueServing } from '../Evening';
import type { TourSystem } from './Tour';
import { GRUBBY_URGE, TOILET_USES_PER_DAY } from './Toilets';
import { CAMP, campFireHappiness } from './Campground';

export interface AttractionDeps {
  buildings: () => Iterable<WorldBuilding>;
  store: GuestStore;
  hash?: { move(slot: number, x: number, y: number): void };
  /** Condition verdict for a building (OpenStatus.buildingStatus); undefined = no condition data (open). */
  status: (id: number) => { open: boolean; reason?: string } | undefined;
  earn: (category: LedgerCategory, amount: number) => void;
  bus?: Pick<GameBus, 'emit'>;
  groundAt?: (x: number, y: number) => number;
  /** True when the lake next to a building is frozen (beach / boat rental). */
  lakeFrozen?: (b: WorldBuilding) => boolean;
  /**
   * Walkable tile beside a building's footprint (path/road, else any non-solid edge tile) where released guests are put down.
   * Without it guests would be released at a random spot INSIDE the footprint, which the pathfinder cannot leave (solid tiles).
   */
  exitFor?: (b: WorldBuilding) => { x: number; y: number } | null;
  /** Pricing hooks (Task 32). List price for a building type; multiplier (markup x seasonal); nightly rate; elasticity roll. */
  basePrice?: (type: string) => number | undefined;
  priceScale?: (type: string) => number;
  nightRate?: (type: string) => number;
  /** May this guest use/book at this price? (deterministic elasticity roll; `salt` varies per day). */
  willBuy?: (guestType: number, guestId: number, buildingType: string, listPrice: number, salt: number) => boolean;
  /** Tour bases (Phase 6 Task 5): schedule, closures and ride bookkeeping of attractions with `spec.tour`. Absent = tours never run. */
  tours?: TourSystem;
}

/** Ticks a guest waits in an attraction queue before giving up. */
export const QUEUE_PATIENCE_TICKS = 70;
export const CHECK_IN_HOUR = 18;

/**
 * Runtime of every catalog attraction/commercial building: FIFO queue with balking, slots with service time, price, staff,
 * need effects and revenue through `earn` (Economy ledger). Open/closed comes from OpenStatus (per-tile conditions), never the
 * global season. Guests inside are in GState.Using; membership is validated every tick so any other system may pull a guest out.
 */
export class AttractionSystem implements GuestAttractionPort {
  private items = new Map<number, Attraction>();
  readonly rooms = new RoomBook();
  /** Trekker beds in Mountain Huts (guest id -> hut id). */
  readonly beds = new RoomBook();
  trekNights = 0;
  readonly trails = new TrailUsage();
  /** Guests that rented gear (ids). */
  private rented = new Set<number>();
  private lastCheckDay = -1;
  /** Campfire evening (Campground): the absolute day the last gathering ran; -1 = never. Saved only once a campfire has burned (older saves / worlds without a campground hash exactly as before). */
  private lastGatherDay = -1;
  /** Guests that already took a room tonight. */
  nightsSold = 0;
  private tick = 0;
  /** Calendar position (set every update): drives venue opening hours and the evening premium. */
  private hour = 12;
  private day = 0;
  private absDay = 0;

  constructor(private d: AttractionDeps) {}

  get(id: number): Attraction | undefined { return this.items.get(id); }
  /** Re-derive one attraction's open/closed verdict right now (cheap, no events): the inspector must never show a cached reason that disagrees with the building's live status. */
  refreshOpen(id: number): Attraction | undefined {
    this.sync();
    const a = this.items.get(id);
    if (a) { const v = this.evalOpen(a); a.open = v.open; a.reason = v.reason; }
    return a;
  }
  all(): Attraction[] { return [...this.items.values()]; }

  // ---------- decision / guest ports ----------

  accepts(id: number): boolean { const a = this.items.get(id); return a ? a.open : true; }
  serving(id: number): boolean { const a = this.items.get(id); return a ? this.servingNow(a) : true; }
  /** Venues with an evening shift only serve between opening and closing hour (open flag = conditions only, so no closed-for-the-night news). */
  servingNow(a: Attraction): boolean { return a.spec.tour ? this.d.tours?.serving(a) ?? true : !a.spec.eveningShift || venueServing(this.day, this.hour); }
  canUse(id: number, slot: number): boolean {
    const a = this.items.get(id);
    return !a || !a.spec.overnightOnly || this.d.store.overnight[slot] === 1;
  }
  queueLength(id: number): number { return this.items.get(id)?.queue.length ?? 0; }
  unitPrice(id: number): number { return this.items.get(id)?.unitPrice() ?? 0; }
  appeal(id: number, type: number): number { const a = this.items.get(id); return (a ? appealFor(a.spec, a.b.type, type) : undefined) ?? 0.25; }
  needsGear(guestId: number, kind: 'ski' | 'bike'): boolean { return !ownsGear(guestId, kind) && !this.rented.has(guestId); }

  /** Total room capacity of active, open lodging (feed to the spawner's overnight cap). */
  lodgingCapacity(): number {
    let n = 0;
    for (const a of this.items.values()) if (a.spec.rooms && a.open) n += a.spec.rooms;
    return n;
  }

  private place(slot: number, a: Attraction, id: number): void {
    const s = this.d.store, b = a.b;
    const jx = (((Math.imul(id, 2654435761) >>> 0) % 100) / 100 - 0.5) * 0.8, jy = (((Math.imul(id, 1597334677) >>> 0) % 100) / 100 - 0.5) * 0.8;
    const x = b.x + b.w / 2 + jx * b.w, y = b.y + b.h / 2 + jy * b.h;
    s.px[slot] = s.x[slot] = x; s.py[slot] = s.y[slot] = y;
    s.pz[slot] = s.z[slot] = this.d.groundAt?.(x, y) ?? s.z[slot]!;
    this.d.hash?.move(slot, x, y);
  }

  arrive(slot: number, b: WorldBuilding, tick: number): ArriveResult {
    const a = this.items.get(b.id);
    if (!a) return 'unhandled';
    const s = this.d.store, id = s.id[slot]!;
    if (!a.open || !this.servingNow(a) || (a.spec.overnightOnly && !s.overnight[slot])) { a.stats.turnedAway++; s.happiness[slot] = Math.max(0, s.happiness[slot]! - 0.02); return 'handled'; }
    if (a.queue.length >= a.queueMax()) { a.stats.balked++; s.happiness[slot] = Math.max(0, s.happiness[slot]! - 0.03); return 'handled'; }
    if (s.budget[slot]! < a.unitPrice()) { a.stats.turnedAway++; return 'handled'; }
    if (this.d.willBuy && a.price > 0 && !this.d.willBuy(s.type[slot]!, id, b.type, a.price, Math.floor(tick / 240))) { a.stats.turnedAway++; return 'handled'; }
    s.state[slot] = GState.Using; s.act[slot] = Act.None; s.target[slot] = b.id; s.actTick[slot] = tick;
    this.place(slot, a, id);
    a.queue.push({ id, since: tick });
    this.admit(a, tick);
    return 'using';
  }

  trail(slot: number, kind: 'hike' | 'bike', tick: number): void {
    const s = this.d.store;
    const type = kind === 'hike' ? 'hiking' : 'mtbTrail';
    const fee = Math.round((this.d.basePrice?.(type) ?? (kind === 'hike' ? hikeFee() : mtbFee())) * (this.d.priceScale?.(type) ?? 1) * 100) / 100;
    const pay = fee > 0 && s.budget[slot]! >= fee ? fee : 0;
    if (pay > 0) { s.budget[slot] = s.budget[slot]! - pay; this.d.earn('recreation', pay); }
    this.trails.record(kind, pay, Math.floor(tick / 240));
  }

  // ---------- simulation ----------

  private release(id: number, tick: number, effects: Attraction | null): void {
    const s = this.d.store, slot = s.slotOf(id);
    if (slot < 0 || s.state[slot] !== GState.Using) return;
    if (effects) {
      const e = effects.spec.effects;
      if (e.hungerTo !== undefined) s.hunger[slot] = Math.min(s.hunger[slot]!, e.hungerTo);
      const grubby = effects.spec.kind === 'toilet' && this.usesToday(effects) > TOILET_USES_PER_DAY; // overrun block: only half relief, no goodwill
      if (e.urgeTo !== undefined) s.urge[slot] = Math.min(s.urge[slot]!, grubby ? GRUBBY_URGE : e.urgeTo);
      if (e.fatigue) s.fatigue[slot] = Math.min(1, Math.max(0, s.fatigue[slot]! + e.fatigue));
      if (e.happiness && !grubby) s.happiness[slot] = Math.min(1, Math.max(0, s.happiness[slot]! + e.happiness));
      if (effects.spec.amenity === 'pool') s.happiness[slot] = Math.min(1, s.happiness[slot]! + (effects.spec.poolHappiness ?? 0.06));
      if (effects.spec.grantsGear) this.rented.add(id);
      s.visits[slot] = Math.min(255, s.visits[slot]! + 1);
    }
    const home = this.items.get(s.target[slot]!);
    const exit = home ? this.d.exitFor?.(home.b) : null;
    if (exit) {
      s.px[slot] = s.x[slot] = exit.x; s.py[slot] = s.y[slot] = exit.y;
      s.pz[slot] = s.z[slot] = this.d.groundAt?.(exit.x, exit.y) ?? s.z[slot]!;
      this.d.hash?.move(slot, exit.x, exit.y);
    }
    s.state[slot] = GState.Idle; s.timer[slot] = 6 + (id % 8); s.act[slot] = Act.None; s.target[slot] = 0; s.actTick[slot] = tick;
  }

  /** Toilets: guests served today (cleanliness; saved in the attraction stats so a reload keeps it). */
  usesToday(a: Attraction): number { return a.stats.todayDay === this.absDay ? a.stats.today ?? 0 : 0; }

  private member(id: number, bid: number): boolean {
    const s = this.d.store, slot = s.slotOf(id);
    return slot >= 0 && s.state[slot] === GState.Using && s.target[slot] === bid;
  }

  /** Move queued guests into free slots, charging on entry. */
  private admit(a: Attraction, tick: number): void {
    if (a.spec.tour) return; // tour bases board in departures (boardTour)
    const s = this.d.store, cap = a.capacity();
    while (a.users.length < cap && a.queue.length) {
      const q = a.queue.shift()!, slot = s.slotOf(q.id);
      if (slot < 0) continue;
      const price = a.unitPrice();
      if (s.budget[slot]! < price) { a.stats.turnedAway++; this.release(q.id, tick, null); continue; }
      if (price > 0) { s.budget[slot] = s.budget[slot]! - price; this.d.earn(a.category, price); a.stats.revenue += price; a.recordRevenue(this.hour, price); }
      a.users.push({ id: q.id, end: tick + a.serviceTime() });
    }
  }

  /** Tour departure: up to the free seats of the queue board, pay the ticket and ride for the tour duration (they stay Using, off the nav graph). */
  private boardTour(a: Attraction, tick: number): void {
    const s = this.d.store, free = a.capacity() - a.users.length;
    if (free < 1) return;
    const end = tick + a.serviceTime();
    let riders = 0, revenue = 0;
    while (riders < free && a.queue.length) {
      const q = a.queue.shift()!, slot = s.slotOf(q.id);
      if (slot < 0) continue;
      const price = a.unitPrice();
      if (s.budget[slot]! < price) { a.stats.turnedAway++; this.release(q.id, tick, null); continue; }
      if (price > 0) { s.budget[slot] = s.budget[slot]! - price; this.d.earn(a.category, price); a.stats.revenue += price; a.recordRevenue(this.hour, price); revenue += price; }
      a.users.push({ id: q.id, end }); riders++;
    }
    if (riders > 0) this.d.tours?.departed(a, riders, revenue, end - tick);
  }

  private evalOpen(a: Attraction): { open: boolean; reason?: string } {
    if (!a.b.active) return { open: false, reason: `Inactive: ${a.b.reason ?? 'dependency missing'}` };
    const st = this.d.status(a.id);
    if (st && !st.open) return { open: false, reason: st.reason ?? 'Closed' };
    if (a.spec.seasonOpen && !a.spec.seasonOpen.includes(seasonOf({ day: this.day }))) return { open: false, reason: 'Closed for the season' };
    if (a.spec.extra === 'lake' && this.d.lakeFrozen?.(a.b)) return { open: false, reason: 'Closed: the lake is frozen' };
    if (a.def.staff > 0 && a.staff <= 0) return { open: false, reason: 'Closed: no staff' };
    if (a.spec.tour) { const r = this.d.tours?.closed(a); if (r) return { open: false, reason: r }; }
    return { open: true };
  }

  /** Undo support: the saved runtime of one attraction (price, staff, stats, open flags). */
  snapshotInstance(id: number): InstanceSave | undefined { return this.items.get(id)?.save(); }
  /** Undo support: apply a saved runtime to the (re-created) attraction of building `id`. */
  restoreInstance(id: number, d: InstanceSave): void { if (!this.items.has(id)) this.sync(); this.items.get(id)?.load(d); }

  private sync(): void {
    const seen = new Set<number>();
    for (const b of this.d.buildings()) {
      const spec = ATTRACTION_SPECS[b.type];
      if (!spec) continue;
      seen.add(b.id);
      const cur = this.items.get(b.id);
      if (!cur || cur.b !== b) {
        const n = new Attraction(b, spec);
        const bp = this.d.basePrice?.(b.type);
        if (bp !== undefined) n.price = Math.min(n.maxPrice, bp);
        n.priceScale = () => this.d.priceScale?.(b.type) ?? 1;
        if (spec.eveningShift) n.hourScale = () => eveningPremium(this.hour);
        if (spec.tour) n.tourInfo = () => this.d.tours?.info(n) ?? null;
        if (cur) { n.price = cur.price; n.staff = cur.staff; n.stats = cur.stats; n.users = cur.users; n.queue = cur.queue; n.open = cur.open; n.reported = cur.reported; }
        this.items.set(b.id, n);
      }
    }
    for (const [id, a] of this.items) {
      if (seen.has(id)) continue;
      for (const u of a.users) this.release(u.id, this.tick, null);
      for (const q of a.queue) this.release(q.id, this.tick, null);
      this.items.delete(id);
      this.d.tours?.gone(id);
    }
  }

  update(state: GameState, tick: number): void {
    this.tick = tick;
    this.hour = hourOfDay(state.date); this.day = state.date.day; this.absDay = state.date.year * DAYS_PER_YEAR + state.date.day;
    this.d.tours?.setContext({ tick, day: state.date.day, absDay: state.date.year * DAYS_PER_YEAR + state.date.day, hour: this.hour });
    this.sync();
    for (const a of this.items.values()) {
      const v = this.evalOpen(a);
      a.open = v.open; a.reason = v.reason;
      if (a.reported !== v.open) {
        a.reported = v.open;
        if (v.open) this.d.bus?.emit('attraction:opened', { id: a.id, type: a.b.type });
        else this.d.bus?.emit('attraction:closed', { id: a.id, type: a.b.type, reason: v.reason ?? 'Closed' });
      }
      if (!v.open) {
        if (a.spec.tour && a.users.length) { // a tour that closes (wind, season, route) lets the rides in progress finish; only the queue goes home
          for (const q of a.queue) this.release(q.id, tick, null);
          a.queue = [];
        } else {
          for (const u of a.users) this.release(u.id, tick, null);
          for (const q of a.queue) this.release(q.id, tick, null);
          a.users = []; a.queue = [];
          continue;
        }
      }
      if (a.users.length === 0 && a.queue.length === 0 && !a.spec.tour) continue;
      // drop guests pulled away by other systems (leaving, sleeping, despawn)
      if (a.users.length) a.users = a.users.filter((u) => this.member(u.id, a.id));
      if (a.queue.length) a.queue = a.queue.filter((q) => this.member(q.id, a.id));
      const still: Attraction['users'] = [];
      for (const u of a.users) {
        if (u.end > tick) { still.push(u); continue; }
        a.stats.served++;
        if (a.spec.kind === 'toilet') { a.stats.today = (a.stats.todayDay === this.absDay ? a.stats.today ?? 0 : 0) + 1; a.stats.todayDay = this.absDay; }
        this.release(u.id, tick, a);
      }
      a.users = still;
      if (a.queue.length) {
        const keep: Attraction['queue'] = [];
        for (const q of a.queue) {
          if (tick - q.since > QUEUE_PATIENCE_TICKS) {
            a.stats.reneged++;
            const slot = this.d.store.slotOf(q.id);
            if (slot >= 0) this.d.store.happiness[slot] = Math.max(0, this.d.store.happiness[slot]! - 0.05);
            this.release(q.id, tick, null);
          } else keep.push(q);
        }
        a.queue = keep;
      }
      this.admit(a, tick);
      if (a.spec.tour && v.open && this.d.tours?.due(a, a.queue.length)) this.boardTour(a, tick);
    }
    if (tick % 20 === 0) this.sweep(tick);
    const hour = hourOfDay(state.date);
    const absDay = state.date.year * DAYS_PER_YEAR + state.date.day;
    if (hour >= CHECK_IN_HOUR && this.lastCheckDay !== absDay) { this.lastCheckDay = absDay; this.checkIn(); }
    if (hour >= CAMP.gatherFrom && this.lastGatherDay !== absDay && [...this.items.values()].some((a) => a.spec.campfire)) { this.lastGatherDay = absDay; this.campfire(); }
  }

  /** Safety net: Using guests no attraction knows about (after load, building removal) go back to wandering. */
  private sweep(tick: number): void {
    const s = this.d.store;
    const known = new Set<number>();
    for (const a of this.items.values()) { for (const u of a.users) known.add(u.id); for (const q of a.queue) known.add(q.id); }
    for (let i = 0; i < s.limit; i++) if (s.alive[i] && s.state[i] === GState.Using && !known.has(s.id[i]!)) this.release(s.id[i]!, tick, null);
    this.beds.purge((g) => s.slotOf(g) >= 0, (id) => this.items.has(id));
    if (tick % 240 === 0) for (const id of this.rented) if (s.slotOf(id) < 0) this.rented.delete(id);
  }

  /** Evening: overnight guests take rooms in open lodging with free capacity; nightly revenue goes to the 'lodging' ledger. */
  private checkIn(): void {
    const s = this.d.store;
    this.rooms.purge((g) => s.slotOf(g) >= 0, (id) => this.items.has(id));
    const lodgings = [...this.items.values()].filter((a) => a.spec.rooms && a.open).sort((a, b) => a.id - b.id);
    if (!lodgings.length) return;
    const tiered = lodgings.some((a) => a.spec.tier !== undefined);
    for (let i = 0; i < s.limit; i++) {
      if (!s.alive[i] || !s.overnight[i]) continue;
      const gid = s.id[i]!;
      if (this.rooms.roomOf(gid) !== undefined && this.rooms.roomOf(gid) !== -1) {
        // already has a room: pay for the new night in the same building if it is still open
        const a = this.items.get(this.rooms.roomOf(gid)!);
        if (a && a.open) this.chargeNight(a, i);
        continue;
      }
      for (const a of tiered ? this.byPreference(lodgings, s.type[i]!) : lodgings) {
        if (this.rooms.occupied(a.id) >= (a.spec.rooms ?? 0)) continue;
        if (!this.chargeNight(a, i)) continue;
        this.rooms.assign(gid, a.id);
        break;
      }
    }
  }

  /**
   * Lodging v2 order for ONE guest type (only used while a tiered house exists, so worlds without one keep the plain id order): a tiered house the type likes
   * (appeal >= `CAMP.likes`) comes first, untiered houses next, then the tiered houses the type is lukewarm about; a type that has no appetite for it (appeal <= `CAMP.avoids`, i.e. 0 after the tier shift) never takes it.
   */
  private byPreference(lodgings: Attraction[], type: number): Attraction[] {
    const rank = (a: Attraction): number => { if (!a.spec.tier) return 1; const ap = this.appeal(a.id, type); return ap >= CAMP.likes ? 0 : ap <= CAMP.avoids ? 9 : 2; };
    return lodgings.map((a, i) => ({ a, i, r: rank(a) })).filter((x) => x.r < 9).sort((p, q) => p.r - q.r || p.i - q.i).map((x) => x.a);
  }

  /** Evening campfire (19:00+): campers at an open campground gain happiness; toilets within `CAMP.toiletRadius` tiles double it. */
  private campfire(): void {
    const s = this.d.store;
    const loos: WorldBuilding[] = [];
    for (const b of this.d.buildings()) if (b.type === 'toilets' && b.active) loos.push(b);
    for (const a of this.items.values()) {
      if (!a.spec.campfire || !a.open) continue;
      const cx = a.b.x + a.b.w / 2, cy = a.b.y + a.b.h / 2;
      const toilets = loos.some((t) => Math.hypot(t.x + t.w / 2 - cx, t.y + t.h / 2 - cy) <= CAMP.toiletRadius);
      const dh = campFireHappiness(toilets);
      for (const [gid] of this.roomGuests(a.id)) {
        const slot = s.slotOf(gid);
        if (slot >= 0) s.happiness[slot] = Math.min(1, s.happiness[slot]! + dh);
      }
      a.stats.fires = (a.stats.fires ?? 0) + 1;
    }
  }
  private roomGuests(id: number): Array<[number]> { return this.rooms.guestsOf(id).map((g) => [g] as [number]); }

  /** Campground inspector data (pitches, campers tonight, toilets nearby). */
  campInfo(id: number): { pitches: number; used: number; toilets: boolean; fires: number } | undefined {
    const a = this.items.get(id);
    if (!a || !a.spec.campfire) return undefined;
    const cx = a.b.x + a.b.w / 2, cy = a.b.y + a.b.h / 2;
    let toilets = false;
    for (const b of this.d.buildings()) if (b.type === 'toilets' && b.active && Math.hypot(b.x + b.w / 2 - cx, b.y + b.h / 2 - cy) <= CAMP.toiletRadius) { toilets = true; break; }
    return { pitches: a.spec.rooms ?? 0, used: this.rooms.occupied(id), toilets, fires: a.stats.fires ?? 0 };
  }

  private chargeNight(a: Attraction, slot: number): boolean {
    const s = this.d.store, rate = this.d.nightRate?.(a.b.type) ?? NIGHTLY_RATE[a.b.type]?.price ?? 0;
    if (s.budget[slot]! < rate) return false;
    if (this.d.willBuy && rate > 0 && !this.d.willBuy(s.type[slot]!, s.id[slot]!, `night:${a.b.type}`, rate, Math.floor(this.tick / 240))) return false;
    s.budget[slot] = s.budget[slot]! - rate;
    this.d.earn('lodging', rate);
    a.stats.revenue += rate; a.stats.nights++; this.nightsSold++;
    return true;
  }

  // ---------- trekker beds (Mountain Hut) ----------

  bedCapacity(id: number): number { const a = this.items.get(id); return a && a.open ? a.spec.beds ?? 0 : 0; }
  bedsFree(id: number): number { return Math.max(0, this.bedCapacity(id) - this.beds.occupied(id)); }
  reserveBed(guestId: number, id: number): boolean {
    if (this.beds.roomOf(guestId) !== undefined) return this.beds.roomOf(guestId) === id;
    if (this.bedsFree(id) <= 0) return false;
    this.beds.assign(guestId, id);
    return true;
  }
  releaseBed(guestId: number): void { this.beds.purge((g) => g !== guestId, () => true); }
  /** Arrival at the hut: pays bed + half-board (Pricing key night:mountainHut) into the lodging ledger. The bed is kept even if the guest cannot pay (the booking was made at the trailhead). */
  checkInBed(slot: number, id: number): boolean {
    const a = this.items.get(id);
    if (!a) return false;
    const s = this.d.store, rate = this.d.nightRate?.(a.b.type) ?? NIGHTLY_RATE[a.b.type]?.price ?? 0, pay = Math.min(rate, Math.max(0, s.budget[slot]!));
    s.budget[slot] = s.budget[slot]! - pay;
    this.d.earn('lodging', pay);
    a.stats.revenue += pay; a.stats.nights++; this.nightsSold++; this.trekNights++;
    return true;
  }

  // ---------- persistence ----------

  asSystem(): SimSystem {
    return {
      id: 'attractions',
      update: (state, tick) => this.update(state, tick),
      serialize: () => ({ items: this.all().map((a) => a.save()), trails: this.trails.serialize(), last: this.lastCheckDay, rented: [...this.rented], nights: this.nightsSold, ...(this.lastGatherDay >= 0 ? { gather: this.lastGatherDay } : {}), beds: this.beds.serialize(), trekNights: this.trekNights, hour: this.hour, day: this.day }),
      load: (data) => {
        const d = data as { items: InstanceSave[]; trails: ReturnType<TrailUsage['serialize']>; last: number; rented: number[]; nights?: number; gather?: number; beds?: Array<[number, number[]]>; trekNights?: number; hour?: number; day?: number };
        this.items.clear(); this.nightsSold = d.nights ?? 0;
        this.sync();
        for (const it of d.items) this.items.get(it.id)?.load(it);
        this.trails.load(d.trails); this.lastCheckDay = d.last; this.rented = new Set(d.rented);
        this.lastGatherDay = d.gather ?? -1; this.rooms.clear(); this.beds.load(d.beds); this.trekNights = d.trekNights ?? 0; this.hour = d.hour ?? 12; this.day = d.day ?? 0;
      },
    };
  }
}
