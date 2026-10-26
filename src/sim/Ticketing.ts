import { PASS_TUNING } from '../config/prices';
import { DAYS_PER_YEAR } from '../config/balance';
import type { Economy } from './Economy';
import type { Pricing } from './Pricing';

export const SEASON_PASS_SALE_MONTH = 8; // first winter month

export interface TicketingDeps {
  economy: Economy;
  pricing: Pricing;
  /** A Ticket Office exists (day passes are sold at arrival; otherwise at the lift station on first boarding). */
  hasTicketOffice(): boolean;
  date(): { year: number; day: number };
  budgetOf(guestId: number): number;
  /** Add `delta` (may be negative) to the guest's spending budget. */
  adjustBudget(guestId: number, delta: number): void;
  /** Expected number of season passes sold at season start (appeal-driven). */
  seasonDemand?(): number;
  /** Elasticity (Task 32): fraction of the guest's budget they will put into a ticket (per guest type). */
  affordShare?(guestId: number): number;
}

const absDay = (d: { year: number; day: number }): number => d.year * DAYS_PER_YEAR + d.day;

/** Lift pass logic: day passes (entrance or first boarding of the day), season passes (upfront sale, holders ride free & return more often). */
export class Ticketing {
  private passDay = new Map<number, number>();
  private holders = new Set<number>();
  /** Foot-passenger (hiker/biker) tickets sold: guest id -> day. */
  private hikerDay = new Map<number, number>();
  hikerTickets = 0;
  sold = 0;
  dayPassesSold = 0;
  refusals = 0;
  rides = 0;
  holderRides = 0;

  constructor(private d: TicketingDeps) {}

  /** Whether the Spawner should charge the day ticket on arrival. */
  ticketAtEntrance(): boolean { return this.d.hasTicketOffice(); }
  dayPrice(): number { return this.d.pricing.effective('dayPass'); }
  hikerPrice(): number { return this.d.pricing.effective('hikerPass'); }
  hasHikerTicket(id: number): boolean { return this.hikerDay.get(id) === absDay(this.d.date()); }
  seasonPrice(): number { return this.d.pricing.get('seasonPass'); }
  isHolder(id: number): boolean { return this.holders.has(id); }
  hasDayPass(id: number): boolean { return this.passDay.get(id) === absDay(this.d.date()); }

  /** Share (%) of arriving guests that are pass holders. */
  holderSharePct(): number {
    if (this.sold <= 0) return 0;
    return Math.min(PASS_TUNING.holderMaxSharePct, Math.round((100 * this.sold) / (this.sold + PASS_TUNING.holderHalfSaturation)));
  }
  /** Extra daily arrivals contributed by pass holders (Spawner hook). */
  returningHolders(): number { return Math.round(this.sold * PASS_TUNING.returnVisitsPerPass); }

  /** Deterministic holder decision from the guest id (no RNG). */
  private rollHolder(id: number): boolean { return (Math.imul(id + 1, 2654435761) >>> 0) % 100 < this.holderSharePct(); }

  /** Guest arrived; `paid` = day ticket already deducted from their budget by the arrival code (0 when sold at the lift). */
  onArrival(id: number, paid: number): void {
    if (this.rollHolder(id)) {
      this.holders.add(id);
      const budget = this.d.budgetOf(id) + paid;
      this.d.adjustBudget(id, paid - budget * (1 - PASS_TUNING.holderSpendFactor)); // refund ticket; holders spend less
      return;
    }
    if (paid > 0) { this.d.economy.earn('lifts', paid); this.dayPassesSold++; this.passDay.set(id, absDay(this.d.date())); }
  }

  /** May this guest take a lift? (holders and day-pass owners yes; others need budget for a day pass.) */
  canRide(id: number, foot = false): boolean {
    if (this.isHolder(id) || this.hasDayPass(id) || (foot && this.hasHikerTicket(id))) return true;
    return this.d.budgetOf(id) * (this.d.affordShare?.(id) ?? 1) >= (foot ? this.hikerPrice() : this.dayPrice());
  }

  /** A guest boarded a lift: sell the day pass on first boarding of the day. */
  onBoard(id: number, foot = false): void {
    this.rides++;
    if (this.isHolder(id)) { this.holderRides++; return; }
    if (this.hasDayPass(id)) return;
    if (foot) {
      if (this.hasHikerTicket(id)) return;
      const hp = this.hikerPrice();
      if (hp > 0 && this.d.budgetOf(id) < hp) { this.refusals++; return; }
      this.d.adjustBudget(id, -hp); this.d.economy.earn('lifts', hp); this.hikerTickets++; this.hikerDay.set(id, absDay(this.d.date()));
      return;
    }
    const price = this.dayPrice();
    if (price > 0 && this.d.budgetOf(id) < price) { this.refusals++; return; }
    this.d.adjustBudget(id, -price);
    this.d.economy.earn('lifts', price);
    this.dayPassesSold++;
    this.passDay.set(id, absDay(this.d.date()));
  }

  /** Season start: sell passes upfront (revenue booked now under 'passes'). */
  sellSeasonPasses(): number {
    const n = Math.max(0, Math.floor(this.d.seasonDemand?.() ?? 0));
    this.sold = n;
    if (n > 0) this.d.economy.earn('passes', n * this.seasonPrice());
    return n;
  }

  /** Called once per day: drop expired day passes. */
  newDay(): void {
    const today = absDay(this.d.date());
    for (const [id, day] of [...this.passDay]) if (day < today) this.passDay.delete(id);
    for (const [id, day] of [...this.hikerDay]) if (day < today) this.hikerDay.delete(id);
  }
  onMonth(month: number): void { if (month === SEASON_PASS_SALE_MONTH) { this.holders.clear(); this.sellSeasonPasses(); } }
  forget(id: number): void { this.passDay.delete(id); this.holders.delete(id); this.hikerDay.delete(id); }

  serialize(): unknown {
    const num = (a: number, b: number): number => a - b;
    return {
      passDay: [...this.passDay].sort((a, b) => a[0] - b[0]), holders: [...this.holders].sort(num),
      sold: this.sold, dayPassesSold: this.dayPassesSold, refusals: this.refusals, rides: this.rides, holderRides: this.holderRides,
      hikerDay: [...this.hikerDay].sort((a, b) => a[0] - b[0]), hikerTickets: this.hikerTickets,
    };
  }
  load(d: unknown): void {
    const o = d as { passDay: Array<[number, number]>; holders: number[]; sold: number; dayPassesSold: number; refusals: number; rides: number; holderRides: number; hikerDay?: Array<[number, number]>; hikerTickets?: number };
    this.hikerDay = new Map(o.hikerDay ?? []); this.hikerTickets = o.hikerTickets ?? 0;
    this.passDay = new Map(o.passDay); this.holders = new Set(o.holders);
    this.sold = o.sold; this.dayPassesSold = o.dayPassesSold; this.refusals = o.refusals; this.rides = o.rides; this.holderRides = o.holderRides;
  }
}
