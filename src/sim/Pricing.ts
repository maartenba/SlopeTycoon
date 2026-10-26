import { NIGHTLY_RATE, PASS_PRICES, PRICE_TABLE } from '../config/prices';
import {
  DAY_CLASS_DEMAND, DAY_CLASS_FAIR, DEFAULT_SCHEDULE, ELASTICITY, HOLIDAYS, MARKUP, POWDER, SCHEDULE_RANGE, SHOCK,
  type DayClass, type ScheduleProfile, type SeasonKey,
} from '../config/marketing';
import { seasonOf, weekdayOf } from './Clock';
import { valueFromRatio, verdictOf } from './Elasticity';

/** Calendar/world context the price menus react to (bound by createSim; absent in unit tests = neutral). */
export interface PricingContext {
  date(): { year: number; day: number };
  /** Fresh snow today (powder day). */
  powder(): boolean;
  /** Resort rating in stars 0..5 (fair value moves with quality). */
  stars(): number;
}

export const profileOf = (s: SeasonKey): ScheduleProfile => (s === 'winter' ? 'winter' : s === 'summer' ? 'summer' : 'shoulder');
const SKIP_SEASONAL = (key: string): boolean => key === 'seasonPass' || key.startsWith('markup:');
const clampN = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** True when `day` (0..359) lies in a holiday range (ranges may not wrap). */
export const isHoliday = (day: number): boolean => HOLIDAYS.some(([s, n]) => day >= s && day < s + n);

/**
 * Price indirection: everything that sells reads `get(key)` (the base price) or `effective(key)` (base x markup x seasonal schedule).
 * Menus call `set`. Typed key families: 'dayPass' | 'seasonPass' | building type (attraction/restaurant/shop/rental) |
 * 'night:<lodgingType>' | 'markup:restaurants' | 'markup:shops' (percent).
 * Guards: min = 25 % of default (unless the item may be offered free via `setFree`), max = catalog cap, daily price-shock tracking.
 */
export class Pricing {
  private overrides = new Map<string, number>();
  private free = new Set<string>();
  schedule: Record<ScheduleProfile, Record<DayClass, number>> = JSON.parse(JSON.stringify(DEFAULT_SCHEDULE)) as Record<ScheduleProfile, Record<DayClass, number>>;
  powderSurcharge = false;
  /** 0..1 temporary penalty after a big price jump (decays daily). */
  shock = 0;
  private lastDay = new Map<string, number>();
  private ctx: PricingContext | null = null;

  bind(ctx: PricingContext): void { this.ctx = ctx; }

  isKnown(key: string): boolean { return key in PASS_PRICES || key in PRICE_TABLE || key.startsWith('night:') || key.startsWith('markup:'); }
  defaultOf(key: string): number {
    if (key in PASS_PRICES) return PASS_PRICES[key as keyof typeof PASS_PRICES].price;
    if (key.startsWith('night:')) return NIGHTLY_RATE[key.slice(6)]?.price ?? 0;
    if (key.startsWith('markup:')) return MARKUP.default;
    return PRICE_TABLE[key]?.price ?? 0;
  }
  maxOf(key: string): number {
    if (key in PASS_PRICES) return PASS_PRICES[key as keyof typeof PASS_PRICES].max;
    if (key.startsWith('night:')) return NIGHTLY_RATE[key.slice(6)]?.max ?? 0;
    if (key.startsWith('markup:')) return MARKUP.max;
    return PRICE_TABLE[key]?.max ?? 0;
  }
  /** Lowest allowed non-free price: 25 % of the default (markups: MARKUP.min). */
  minOf(key: string): number {
    if (key.startsWith('markup:')) return MARKUP.min;
    const d = this.defaultOf(key);
    return d <= 0 ? 0 : Math.max(1, Math.round(d * 0.25));
  }
  /** Items that may be given away for free through the explicit toggle. */
  canBeFree(key: string): boolean { return !SKIP_SEASONAL(key) && !key.startsWith('night:') && this.defaultOf(key) > 0; }

  /** Base price (0 when free). */
  get(key: string): number {
    if (this.free.has(key)) return 0;
    return this.overrides.get(key) ?? this.defaultOf(key);
  }
  isFree(key: string): boolean { return this.free.has(key); }
  isOverridden(key: string): boolean { return this.overrides.has(key) || this.free.has(key); }
  set(key: string, v: number): void {
    const max = this.maxOf(key), min = this.minOf(key);
    const r = Math.round(Number.isFinite(v) ? v : this.defaultOf(key));
    this.overrides.set(key, max > 0 ? clampN(r, Math.min(min, max), max) : Math.max(0, r));
    this.free.delete(key);
  }
  setFree(key: string, on: boolean): void { if (!on) this.free.delete(key); else if (this.canBeFree(key)) this.free.add(key); }
  reset(key: string): void { this.overrides.delete(key); this.free.delete(key); }
  resetAll(): void { this.overrides.clear(); this.free.clear(); this.schedule = JSON.parse(JSON.stringify(DEFAULT_SCHEDULE)) as typeof this.schedule; this.powderSurcharge = false; }

  /** Set every sold item to default x factor (presets). Seasonal schedule is untouched. */
  applyPreset(factor: number, keys: readonly string[]): void {
    for (const k of keys) {
      if (k.startsWith('markup:')) this.set(k, MARKUP.default * factor);
      else if (this.defaultOf(k) > 0 && this.maxOf(k) > 0) this.set(k, this.defaultOf(k) * factor);
    }
  }

  // ----- calendar -----
  dayClass(): DayClass {
    const d = this.ctx?.date();
    if (!d) return 'regular';
    if (this.ctx!.powder() && seasonOf(d) === 'winter') return 'peak';
    const wd = weekdayOf(d);
    if (wd >= 5 || isHoliday(d.day)) return 'peak';
    return wd === 4 ? 'regular' : 'off';
  }
  powderToday(): boolean { return !!this.ctx && this.ctx.powder() && seasonOf(this.ctx.date()) === 'winter'; }
  profile(): ScheduleProfile { const d = this.ctx?.date(); return d ? profileOf(seasonOf(d)) : 'winter'; }
  setSchedule(profile: ScheduleProfile, cls: DayClass, m: number): void { this.schedule[profile][cls] = Math.round(clampN(m, SCHEDULE_RANGE.min, SCHEDULE_RANGE.max) * 100) / 100; }
  /** Today's seasonal multiplier (schedule x optional powder surcharge). 1 without context. */
  seasonalMultiplier(): number {
    if (!this.ctx) return 1;
    return this.schedule[this.profile()][this.dayClass()] * (this.powderSurcharge && this.powderToday() ? POWDER.surcharge : 1);
  }
  /** Arrival-volume factor of today's day class. */
  dayDemand(): number { return this.ctx ? DAY_CLASS_DEMAND[this.dayClass()] : 1; }

  /** Multiplier applied to the base price of `key` right now (markup % x seasonal). */
  multiplierFor(key: string): number {
    if (SKIP_SEASONAL(key)) return 1;
    let m = this.seasonalMultiplier();
    const cat = PRICE_TABLE[key]?.category;
    if (cat === 'restaurants' || cat === 'bars') m *= this.get('markup:restaurants') / 100;
    else if (cat === 'shops') m *= this.get('markup:shops') / 100;
    return m;
  }
  /** Price a guest actually sees today (rounded to cents). */
  effective(key: string): number { return Math.round(this.get(key) * this.multiplierFor(key) * 100) / 100; }

  // ----- fair value / verdicts -----
  quality(): number { return ELASTICITY.fairBase + ELASTICITY.fairPerStar * clampN(this.ctx?.stars() ?? 2.5, 0, 5); }
  /** What the market considers fair for `key` today (default price x quality x day class). */
  fairOf(key: string): number {
    const cls = this.ctx && !SKIP_SEASONAL(key) ? DAY_CLASS_FAIR[this.dayClass()] : 1;
    const base = key.startsWith('markup:') ? MARKUP.default : this.defaultOf(key);
    return Math.max(0.01, base * this.quality() * cls);
  }
  /** effective / fair (markups: percent / 100 against quality). */
  ratioOf(key: string): number { return key.startsWith('markup:') ? this.get(key) / this.fairOf(key) : this.effective(key) / this.fairOf(key); }
  verdictOf(key: string): 'cheap' | 'fair' | 'expensive' { return this.isFree(key) ? 'cheap' : verdictOf(this.ratioOf(key)); }

  /** Value-for-money 0..1 for the resort rating: weighted over day pass, lodging and food/shop markups, minus any price shock. */
  valueScore(): number {
    const parts: Array<[number, number]> = [[valueFromRatio(this.ratioOf('dayPass'), this.isFree('dayPass')), 0.5]];
    const nights = ['night:baseLodge', 'night:chalet', 'night:apartment'].map((k) => valueFromRatio(this.ratioOf(k)));
    parts.push([nights.reduce((a, b) => a + b, 0) / nights.length, 0.2]);
    parts.push([valueFromRatio(this.ratioOf('markup:restaurants')), 0.15], [valueFromRatio(this.ratioOf('markup:shops')), 0.15]);
    let num = 0, den = 0;
    for (const [v, w] of parts) { num += v * w; den += w; }
    return clampN((num / den) * (1 - SHOCK.valuePenalty * this.shock), 0, 1);
  }

  /** Called at the start of each day: detect big price jumps (shock) and decay the previous one. */
  newDay(): void {
    let jump = 0;
    const keys = new Set<string>([...this.overrides.keys(), ...this.free, ...this.lastDay.keys()]);
    for (const k of keys) {
      const cur = this.get(k), last = this.lastDay.get(k) ?? this.defaultOf(k);
      jump = Math.max(jump, Math.abs(cur - last) / Math.max(1, last));
      if (this.isOverridden(k)) this.lastDay.set(k, cur); else this.lastDay.delete(k);
    }
    if (jump > SHOCK.threshold) this.shock = Math.max(this.shock, Math.min(1, jump));
    else { this.shock *= SHOCK.decay; if (this.shock < 0.02) this.shock = 0; }
  }

  serialize(): { overrides: Array<[string, number]>; free: string[]; schedule: Pricing['schedule']; powder: boolean; shock: number; last: Array<[string, number]> } {
    return {
      overrides: [...this.overrides.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)), free: [...this.free].sort(),
      schedule: JSON.parse(JSON.stringify(this.schedule)) as Pricing['schedule'], powder: this.powderSurcharge, shock: this.shock,
      last: [...this.lastDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    };
  }
  load(d: ReturnType<Pricing['serialize']> | Array<[string, number]> | undefined): void {
    if (!d) return;
    if (Array.isArray(d)) { this.overrides = new Map(d); return; } // legacy shape
    this.overrides = new Map(d.overrides); this.free = new Set(d.free); this.schedule = d.schedule; this.powderSurcharge = d.powder; this.shock = d.shock; this.lastDay = new Map(d.last);
  }
}
