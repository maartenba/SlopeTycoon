import { DAYS_PER_MONTH, DAYS_PER_YEAR } from '../../config/balance';
import { RIVALS, RIVAL_PREFIXES, RIVAL_SUFFIXES } from '../../config/rivals';
import type { BaselineContext, BaselineMetric, BaselineProvider } from '../../config/yearAwards';
import { REGIONAL_BASELINES } from '../../config/yearAwards';
import { Rng } from '../../core/Rng';

/**
 * Rival resorts (M5.4 Task 23): 2-3 neighbours seeded from the map seed, a market-share number (multinomial logit of rating and day-pass
 * price) that scales arrivals by a small, bounded factor, and the regional baselines the Resort of the Year awards compare against.
 * Deterministic: one own Rng stream (saved), only advanced by the monthly step; never touches the sim RNG. Save module `rivals`.
 */
export interface Rival { id: number; name: string; /** long-run star level this rival is heading for */ target: number; stars: number; /** day-pass price ratio (1 = fair) */ price: number; priceBase: number; share: number }

export interface RivalSources {
  seed: number;
  /** Absolute day (year x 180 + day). */
  today(): number;
  /** The player's displayed stars (0..5) and day-pass price ratio (1 = fair). */
  stars(): number;
  priceRatio(): number;
  /** Today's sustainability facet 0..100, or null when unknown. */
  sustainability(): number | null;
  /** False in scenarios / the tutorial: the numbers are shown, but arrivals are not scaled. */
  affectsArrivals(): boolean;
  /** One quiet news line (rare). */
  news(text: string, id: string): void;
}

export interface RivalEntry { name: string; stars: number; share: number; you: boolean }
/** The year report's rival section. */
export interface RivalSection {
  /** Your mean market share over the year (0..1) and the fair share (1 / resorts). */
  share: number; fair: number; rank: number; of: number;
  entries: RivalEntry[];
  /** Mean sustainability facet over the year (0..100), null if fewer than 15 days were seen. */
  sustainability: number | null;
}

interface YearAcc { n: number; you: number; sust: number; sustN: number; shares: number[]; stars: number[] }
const emptyAcc = (k: number): YearAcc => ({ n: 0, you: 0, sust: 0, sustN: 0, shares: new Array<number>(k).fill(0), stars: new Array<number>(k).fill(0) });
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const r2 = (n: number): number => Math.round(n * 100) / 100;

/** Number of rivals and their static identity from the seed (pure). */
export function rivalCount(seed: number): number { return ((Math.imul(seed | 0, 0x9e3779b1) >>> 7) & 1) === 0 ? RIVALS.minCount : RIVALS.maxCount; }

export function makeRivals(seed: number): Rival[] {
  const rng = new Rng((seed ^ 0x52495641) >>> 0), n = rivalCount(seed);
  const pre = [...RIVAL_PREFIXES], out: Rival[] = [];
  for (let i = 0; i < n; i++) {
    const name = `${pre.splice(rng.int(0, pre.length - 1), 1)[0]} ${RIVAL_SUFFIXES[rng.int(0, RIVAL_SUFFIXES.length - 1)]}`;
    const [lo, hi] = RIVALS.starsRange, [plo, phi] = RIVALS.priceRange;
    const target = Math.round((lo + rng.next() * (hi - lo)) * 10) / 10, price = Math.round((plo + rng.next() * (phi - plo)) * 100) / 100;
    out.push({ id: i, name, target, stars: target, price, priceBase: price, share: 0 });
  }
  return out;
}

/** Multinomial-logit shares (index 0 = you). Pure. */
export function marketShares(you: { stars: number; price: number }, rivals: ReadonlyArray<{ stars: number; price: number }>): number[] {
  const u = (s: number, p: number): number => RIVALS.starSlope * (s - 3) - RIVALS.priceSlope * (p - 1);
  const e = [you, ...rivals].map((x) => Math.exp(u(x.stars, x.price)));
  const tot = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / tot);
}

export class Rivals implements BaselineProvider {
  rivals: Rival[];
  /** Your market share (0..1) as of the last daily update; the fair share is 1 / (rivals + 1). */
  share = 0;
  private rng: Rng;
  private startDay = -1;
  private lastNews = -1e9;
  private leading = false;
  private acc = new Map<number, YearAcc>();
  private mult = 1;

  constructor(private readonly src: RivalSources) {
    this.rivals = makeRivals(src.seed);
    this.rng = new Rng((src.seed ^ 0x6d61726b) >>> 0);
    this.share = 1 / (this.rivals.length + 1);
  }

  get fair(): number { return 1 / (this.rivals.length + 1); }
  /** 1 = you lead the market. */
  get rank(): number { return 1 + this.rivals.filter((r) => r.share > this.share).length; }
  /** Arrival multiplier: exactly 1 inside the grace period, in scenarios, and when your share is fair. */
  arrivalMult(): number { return this.mult; }
  /** Days since this game's rivals started counting (0 before the first day). */
  get age(): number { return this.startDay < 0 ? 0 : this.src.today() - this.startDay; }

  /** Once per in-game day. */
  newDay(): void {
    const today = this.src.today();
    if (this.startDay < 0) this.startDay = today;
    const age = today - this.startDay;
    if (age > 0 && age % DAYS_PER_MONTH === 0) this.monthlyStep(age);
    const you = { stars: this.src.stars(), price: this.src.priceRatio() };
    const sh = marketShares(you, this.rivals);
    this.share = sh[0]!;
    this.rivals.forEach((r, i) => { r.share = sh[i + 1]!; });
    const ramp = clamp((age - RIVALS.graceDays) / RIVALS.rampDays, 0, 1);
    const raw = clamp(1 + RIVALS.gain * (this.share / this.fair - 1), RIVALS.min, RIVALS.max);
    this.mult = this.src.affectsArrivals() ? 1 + ramp * (raw - 1) : 1;
    // yearly accumulators for the report
    const y = Math.floor(today / DAYS_PER_YEAR);
    let a = this.acc.get(y);
    if (!a) { a = emptyAcc(this.rivals.length); this.acc.set(y, a); for (const k of [...this.acc.keys()]) if (k < y - 2) this.acc.delete(k); }
    a.n++; a.you += this.share;
    this.rivals.forEach((r, i) => { a!.shares[i]! += r.share; a!.stars[i]! += r.stars; });
    const s = this.src.sustainability();
    if (s !== null) { a.sust += s; a.sustN++; }
    this.maybeNews(today, age);
  }

  private monthlyStep(age: number): void {
    const years = age / DAYS_PER_YEAR;
    for (const r of this.rivals) {
      const goal = Math.min(RIVALS.capStars, r.target + RIVALS.yearlyGain * years);
      r.stars = clamp(r.stars + (goal - r.stars) * RIVALS.pull + (this.rng.next() - 0.5) * 2 * RIVALS.noise, 2, 5);
      r.price = clamp(r.priceBase + (this.rng.next() - 0.5) * 0.12, 0.8, 1.3);
    }
  }

  /** Rare, quiet: only when the leader changes (with a margin), at most once per `newsEveryDays`. */
  private maybeNews(today: number, age: number): void {
    if (age < RIVALS.graceDays + RIVALS.rampDays / 2 || !this.src.affectsArrivals()) return;
    const best = Math.max(...this.rivals.map((r) => r.share));
    const margin = 0.03;
    const nowLeading = this.leading ? this.share > best - margin : this.share > best + margin;
    if (nowLeading === this.leading) return;
    this.leading = nowLeading;
    if (today - this.lastNews < RIVALS.newsEveryDays) return;
    this.lastNews = today;
    const top = [...this.rivals].sort((a, b) => b.share - a.share)[0]!;
    this.src.news(nowLeading ? 'Your resort is now the most popular in the region' : `${top.name} has overtaken you in the region`, `rival:${today}`);
  }

  /** Rival section of the report of `year` (null before any day of that year was counted). */
  section(year: number): RivalSection | null {
    const a = this.acc.get(year);
    if (!a || a.n === 0) return null;
    const entries: RivalEntry[] = [{ name: 'Your resort', stars: this.src.stars(), share: r2(a.you / a.n), you: true },
      ...this.rivals.map((r, i) => ({ name: r.name, stars: Math.round((a.stars[i]! / a.n) * 10) / 10, share: r2(a.shares[i]! / a.n), you: false }))];
    entries.sort((x, y) => y.share - x.share || (x.you ? -1 : y.you ? 1 : 0));
    return { share: r2(a.you / a.n), fair: r2(this.fair), rank: 1 + entries.findIndex((e) => e.you), of: entries.length, entries, sustainability: a.sustN >= 15 ? Math.round((a.sust / a.sustN) * 10) / 10 : null };
  }

  /** Awards benchmark: the static regional table scaled by how good the neighbours are (average rival stars; 3.5 = neutral). */
  baseline(metric: BaselineMetric, ctx: BaselineContext): number {
    const row = REGIONAL_BASELINES[metric];
    let v = row.value;
    if (row.scale === 'area') v *= Math.min(2, Math.max(0.5, (ctx.mapSize / 128) ** 0.5));
    if (metric === 'guestGrowth' || metric === 'profitMargin') return v; // not a neighbour comparison
    const avg = this.rivals.reduce((s, r) => s + r.stars, 0) / this.rivals.length;
    const q = 1 + 0.2 * (avg - 3.5);
    return metric === 'incidentsPer1000' ? v / q : v * q;
  }

  serialize(): unknown {
    return { rivals: this.rivals.map((r) => ({ ...r })), rng: this.rng.getState(), start: this.startDay, news: this.lastNews, leading: this.leading, share: this.share, mult: this.mult,
      acc: [...this.acc].map(([y, a]) => [y, a]) };
  }
  load(d: unknown): void {
    const o = d as { rivals?: Rival[]; rng?: number; start?: number; news?: number; leading?: boolean; share?: number; mult?: number; acc?: Array<[number, YearAcc]> } | null;
    if (!o || !Array.isArray(o.rivals)) { this.reset(); return; }
    this.rivals = o.rivals.map((r) => ({ ...r })); this.rng.setState(o.rng ?? 0); this.startDay = o.start ?? -1; this.lastNews = o.news ?? -1e9;
    this.leading = !!o.leading; this.share = o.share ?? this.fair; this.mult = o.mult ?? 1; this.acc = new Map(o.acc ?? []);
  }
  reset(): void {
    this.rivals = makeRivals(this.src.seed); this.rng = new Rng((this.src.seed ^ 0x6d61726b) >>> 0);
    this.startDay = -1; this.lastNews = -1e9; this.leading = false; this.acc = new Map(); this.mult = 1; this.share = this.fair;
  }
}
