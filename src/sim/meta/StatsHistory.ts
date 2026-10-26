import { DAYS_PER_YEAR } from '../../config/balance';
import { EXPENSE_CATEGORIES, LEDGER_CATEGORIES } from '../../config/prices';
import type { GameBus } from '../../core/events';
import type { ExpenseBuckets, IncomeBuckets } from '../Economy';

/**
 * Daily statistics ring buffer (M5.3 Task 17; shared with the statistics screen, Task 30).
 * One entry per closed in-game day, the last `STATS_DAYS` (= 2 in-game years) are kept in compact typed arrays.
 * READ-ONLY observer of the sim: it never writes sim state and never touches the sim RNG. It is saved as the `stats` module (v1);
 * old saves load as an empty history. Capture is driven by `Economy.onDayClosed` (day end, after upkeep is booked) through `captureDay`.
 */
export const STATS_DAYS = 2 * DAYS_PER_YEAR;
/** Weather kinds -> small integer code stored per day. */
export const WEATHER_CODES = ['clear', 'cloudy', 'snow', 'heavySnow', 'rain', 'storm'] as const;

interface MetricDef { id: string; u16: boolean }
const BASE_METRICS: readonly MetricDef[] = [
  { id: 'arrivals', u16: true }, { id: 'family', u16: true }, { id: 'peak', u16: true },
  { id: 'income', u16: false }, { id: 'expense', u16: false },
  { id: 'rating', u16: false }, { id: 'happiness', u16: false },
  { id: 'incCreated', u16: true }, { id: 'incResolved', u16: true }, { id: 'hospitalised', u16: true },
  { id: 'runs', u16: true }, { id: 'snow', u16: false }, { id: 'skiable', u16: false }, { id: 'quality', u16: false },
  { id: 'weather', u16: true }, { id: 'temp', u16: false }, { id: 'queue', u16: false },
  { id: 'wildlife', u16: true }, { id: 'attacks', u16: true },
];
export const METRIC_IDS: readonly string[] = [
  ...BASE_METRICS.map((m) => m.id),
  ...LEDGER_CATEGORIES.map((c) => `inc:${c}`), ...EXPENSE_CATEGORIES.map((c) => `exp:${c}`),
];
const DEFS: readonly MetricDef[] = [
  ...BASE_METRICS,
  ...LEDGER_CATEGORIES.map((c) => ({ id: `inc:${c}`, u16: false })), ...EXPENSE_CATEGORIES.map((c) => ({ id: `exp:${c}`, u16: false })),
];

export type StatsAgg = 'sum' | 'mean' | 'min' | 'max';
export interface StatsSummary { n: number; sum: number; mean: number; min: number; max: number }
export interface StatsRange { /** First absolute day (inclusive); default: oldest kept. */ from?: number; /** Last absolute day (inclusive); default: newest. */ to?: number }

/** What the observer reads at the end of a day. All callbacks are read-only. */
export interface StatsSources {
  /** The day just closed: guests now / mean happiness. */
  guests(): { count: number; happiness: number };
  stars(): number;
  /** Absolute day (year * 180 + day-of-year) of the *current* date (the closed day is one before it). */
  today(): number;
  /** Money booked during the day being closed. */
  day(): { income: IncomeBuckets; expense: ExpenseBuckets };
  incidents(): { created: number; resolved: number; hospitalised: number };
  runs(): number;
  terrain(): { snow: number; skiable: number; quality: number };
  weather(): { code: number; temp: number };
  attacks(): number;
  /** Mean lift queue wait right now, minutes. */
  queueMinutes(): number;
  isFamily(guestId: number): boolean;
}

interface Acc { arrivals: number; family: number; peak: number; queueSum: number; queueN: number; wildlife: number }
const emptyAcc = (): Acc => ({ arrivals: 0, family: 0, peak: 0, queueSum: 0, queueN: 0, wildlife: 0 });
interface Cum { created: number; resolved: number; hospitalised: number; runs: number; attacks: number }

export const round2 = (n: number): number => Math.round(n * 100) / 100;

export class StatsHistory {
  private readonly arrays = new Map<string, Uint16Array | Float32Array>();
  /** Absolute day of the newest entry (-1 = none). */
  lastAbs = -1;
  /** Number of valid entries (<= STATS_DAYS). */
  len = 0;
  private acc = emptyAcc();
  private cum: Cum = { created: 0, resolved: 0, hospitalised: 0, runs: 0, attacks: 0 };
  private cumInit = false;
  private yearEndCb: ((year: number) => void) | null = null;
  private dayCb: ((abs: number) => void) | null = null;

  constructor(private readonly src: StatsSources | null = null) { this.clear(); }

  clear(): void {
    for (const d of DEFS) this.arrays.set(d.id, d.u16 ? new Uint16Array(STATS_DAYS) : new Float32Array(STATS_DAYS));
    this.lastAbs = -1; this.len = 0; this.acc = emptyAcc(); this.cumInit = false;
  }

  /** Listeners that feed the accumulators (arrivals by type, hourly peak + queue samples, wildlife). */
  attach(bus: GameBus): void {
    bus.on('guest:arrived', (e) => { this.acc.arrivals++; if (e && this.src?.isFamily(e.id)) this.acc.family++; });
    bus.on('time:hour', (e) => {
      const s = this.src; if (!s) return;
      const c = s.guests().count; if (c > this.acc.peak) this.acc.peak = c;
      const hour = e?.hour ?? 12; if (hour >= 9 && hour <= 16) { this.acc.queueSum += s.queueMinutes(); this.acc.queueN++; }
    });
    bus.on('incident:wildlife', (e) => { if (e?.outcome !== 'attack') this.acc.wildlife++; });
  }
  onYearEnd(cb: (year: number) => void): void { this.yearEndCb = cb; }
  onDay(cb: (abs: number) => void): void { this.dayCb = cb; }

  /** Close one day: write the entry for `lastAbs + 1`. Cheap (<0.2 ms): only reads small aggregates, no per-guest or per-tile full scans. */
  captureDay(): void {
    const s = this.src; if (!s) return;
    const abs = this.lastAbs < 0 ? Math.max(0, s.today() - 1) : this.lastAbs + 1;
    const slot = abs % STATS_DAYS;
    const a = this.acc, g = s.guests(), d = s.day(), inc = s.incidents(), t = s.terrain(), w = s.weather();
    const set = (id: string, v: number): void => { this.arrays.get(id)![slot] = v; };
    if (this.cum.runs < 0) this.cum.runs = s.runs(); // `GuestSim.runsCompleted` is not saved: the first day after a load only rebases it
    if (!this.cumInit) { this.cum = { created: inc.created, resolved: inc.resolved, hospitalised: inc.hospitalised, runs: s.runs(), attacks: s.attacks() }; this.cumInit = true; }
    let income = 0, expense = 0;
    for (const c of LEDGER_CATEGORIES) { const v = d.income[c]; income += v; set(`inc:${c}`, v); }
    for (const c of EXPENSE_CATEGORIES) { const v = d.expense[c]; expense += v; set(`exp:${c}`, v); }
    set('arrivals', a.arrivals); set('family', a.family); set('peak', Math.max(a.peak, g.count));
    set('income', income); set('expense', expense);
    set('rating', s.stars()); set('happiness', g.happiness);
    set('incCreated', Math.max(0, inc.created - this.cum.created)); set('incResolved', Math.max(0, inc.resolved - this.cum.resolved)); set('hospitalised', Math.max(0, inc.hospitalised - this.cum.hospitalised));
    const runs = s.runs(), at = s.attacks();
    set('runs', Math.max(0, runs - this.cum.runs)); set('attacks', Math.max(0, at - this.cum.attacks));
    this.cum = { created: inc.created, resolved: inc.resolved, hospitalised: inc.hospitalised, runs, attacks: at };
    set('snow', t.snow); set('skiable', t.skiable); set('quality', t.quality);
    set('weather', w.code); set('temp', w.temp);
    set('queue', a.queueN ? a.queueSum / a.queueN : 0); set('wildlife', a.wildlife);
    this.acc = emptyAcc();
    this.lastAbs = abs; this.len = Math.min(STATS_DAYS, this.len + 1);
    this.dayCb?.(abs);
    if (abs % DAYS_PER_YEAR === DAYS_PER_YEAR - 1) this.yearEndCb?.(Math.floor(abs / DAYS_PER_YEAR));
  }

  // ------------------------------------------------------------------ queries
  /** Oldest absolute day still kept (-1 when empty). */
  get firstAbs(): number { return this.len ? this.lastAbs - this.len + 1 : -1; }
  has(abs: number): boolean { return this.len > 0 && abs >= this.firstAbs && abs <= this.lastAbs; }
  /** Value of `metric` on one absolute day (NaN when not kept). */
  at(metric: string, abs: number): number { return this.has(abs) ? (this.arrays.get(metric)?.[abs % STATS_DAYS] ?? NaN) : NaN; }
  private bounds(r: StatsRange = {}): [number, number] | null {
    if (!this.len) return null;
    const from = Math.max(this.firstAbs, r.from ?? this.firstAbs), to = Math.min(this.lastAbs, r.to ?? this.lastAbs);
    return to >= from ? [from, to] : null;
  }
  /** Values oldest -> newest over the range (a fresh array). Unknown metrics throw. */
  series(metric: string, r: StatsRange = {}): Float32Array {
    const a = this.arrays.get(metric); if (!a) throw new Error(`Unknown stats metric '${metric}'`);
    const b = this.bounds(r); if (!b) return new Float32Array(0);
    const out = new Float32Array(b[1] - b[0] + 1);
    for (let d = b[0]; d <= b[1]; d++) out[d - b[0]!] = a[d % STATS_DAYS]!;
    return out;
  }
  /** min / max / mean / sum over a range. */
  summary(metric: string, r: StatsRange = {}): StatsSummary {
    const s = this.series(metric, r);
    if (!s.length) return { n: 0, sum: 0, mean: 0, min: 0, max: 0 };
    let sum = 0, min = Infinity, max = -Infinity;
    for (const v of s) { sum += v; if (v < min) min = v; if (v > max) max = v; }
    return { n: s.length, sum, mean: sum / s.length, min, max };
  }
  /** One aggregate per month (15 days) over the range; `index` = absolute month number (abs / 15), partial months included. */
  monthly(metric: string, agg: StatsAgg = 'sum', r: StatsRange = {}): Array<{ index: number; value: number; days: number }> {
    const b = this.bounds(r); if (!b) return [];
    const out: Array<{ index: number; value: number; days: number }> = [];
    for (let m = Math.floor(b[0] / 15); m <= Math.floor(b[1] / 15); m++) {
      const from = Math.max(b[0], m * 15), to = Math.min(b[1], m * 15 + 14);
      out.push({ index: m, value: this.aggregate(metric, agg, { from, to }), days: to - from + 1 });
    }
    return out;
  }
  /** Aggregate for one in-game year (calendar year number as in the game date). Only the kept days count. */
  yearAgg(metric: string, year: number, agg: StatsAgg = 'sum'): number { return this.aggregate(metric, agg, { from: year * DAYS_PER_YEAR, to: year * DAYS_PER_YEAR + DAYS_PER_YEAR - 1 }); }
  aggregate(metric: string, agg: StatsAgg, r: StatsRange = {}): number {
    const s = this.summary(metric, r);
    return agg === 'sum' ? s.sum : agg === 'mean' ? s.mean : agg === 'min' ? s.min : s.max;
  }
  /** True when the whole calendar year is still in the buffer. */
  hasYear(year: number): boolean { return this.has(year * DAYS_PER_YEAR) && this.has(year * DAYS_PER_YEAR + DAYS_PER_YEAR - 1); }

  // ------------------------------------------------------------------ save
  serialize(): unknown {
    const series: Record<string, Uint16Array | Float32Array> = {};
    for (const d of DEFS) series[d.id] = this.arrays.get(d.id)!.slice();
    return { lastAbs: this.lastAbs, len: this.len, acc: { ...this.acc }, cum: { ...this.cum, runs: 0 }, cumInit: this.cumInit, series };
  }
  load(data: unknown): void {
    this.clear();
    const o = data as { lastAbs?: number; len?: number; acc?: Acc; cum?: Cum; cumInit?: boolean; series?: Record<string, ArrayLike<number>> } | null;
    if (!o || typeof o.lastAbs !== 'number' || !o.series) return;
    for (const d of DEFS) { const src = o.series[d.id]; if (src) this.arrays.get(d.id)!.set(Array.from(src).slice(0, STATS_DAYS)); }
    this.lastAbs = o.lastAbs; this.len = Math.min(STATS_DAYS, o.len ?? 0);
    this.acc = { ...emptyAcc(), ...(o.acc ?? {}) }; if (o.cum) this.cum = { ...this.cum, ...o.cum, runs: -1 }; this.cumInit = !!o.cumInit;
  }
  reset(): void { this.clear(); }
}
