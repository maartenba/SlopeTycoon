import { DAYS_PER_YEAR } from '../../config/balance';
import { EXPENSE_CATEGORIES, LEDGER_CATEGORIES } from '../../config/prices';
import type { GameBus } from '../../core/events';
import { decodeInts, encodeInts } from './statsCodec';
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
  /** Money at day end and the sustainability facet score (0..100) (Task 30). */
  { id: 'cash', u16: false }, { id: 'sustain', u16: false },
];
export const METRIC_IDS: readonly string[] = [
  ...BASE_METRICS.map((m) => m.id),
  ...LEDGER_CATEGORIES.map((c) => `inc:${c}`), ...EXPENSE_CATEGORIES.map((c) => `exp:${c}`),
];
const DEFS: readonly MetricDef[] = [
  ...BASE_METRICS,
  ...LEDGER_CATEGORIES.map((c) => ({ id: `inc:${c}`, u16: false })), ...EXPENSE_CATEGORIES.map((c) => ({ id: `exp:${c}`, u16: false })),
];

/** Save quantisation: counts and money as whole numbers, ratios / temperatures in hundredths. `cash` is delta coded (it moves smoothly). */
const scaleOf = (id: string): number => (/^(inc|exp):|^(income|expense|cash)$/.test(id) || DEFS.find((d) => d.id === id)?.u16 ? 1 : 100);

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
  /** Money at the end of the day (Task 30). Optional: absent = 0. */
  cash?(): number;
  /** Sustainability facet score 0..100; absent / not measurable = 0 (Task 30). */
  sustain?(): number;
}

/** Long-term archive (Task 30): one row per closed in-game month, kept for the whole game (capped). Metric -> how a month folds. */
export const ARCHIVE_MONTHS = 40 * 12;
const ARCH_AGG: Record<string, StatsAgg | 'last'> = {
  arrivals: 'sum', peak: 'max', happiness: 'mean', rating: 'mean', cash: 'last', sustain: 'mean', income: 'sum', expense: 'sum',
  ...Object.fromEntries(LEDGER_CATEGORIES.map((c) => [`inc:${c}`, 'sum' as const])),
};
export const ARCHIVE_METRICS: readonly string[] = Object.keys(ARCH_AGG);

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
  /** Monthly archive: absolute month index (abs / 15) of row 0 and one array per archive metric. */
  private archFirst = -1;
  private arch = new Map<string, number[]>();
  private yearEndCb: ((year: number) => void) | null = null;
  private dayCb: ((abs: number) => void) | null = null;

  constructor(private readonly src: StatsSources | null = null) { this.clear(); }

  clear(): void {
    for (const d of DEFS) this.arrays.set(d.id, d.u16 ? new Uint16Array(STATS_DAYS) : new Float32Array(STATS_DAYS));
    this.lastAbs = -1; this.len = 0; this.acc = emptyAcc(); this.cumInit = false;
    this.archFirst = -1; this.arch = new Map(ARCHIVE_METRICS.map((m) => [m, [] as number[]]));
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
    set('cash', round2(s.cash?.() ?? 0)); set('sustain', round2(s.sustain?.() ?? 0));
    set('queue', a.queueN ? a.queueSum / a.queueN : 0); set('wildlife', a.wildlife);
    this.acc = emptyAcc();
    this.lastAbs = abs; this.len = Math.min(STATS_DAYS, this.len + 1);
    if (abs % 15 === 14) this.closeMonth(Math.floor(abs / 15));
    this.dayCb?.(abs);
    if (abs % DAYS_PER_YEAR === DAYS_PER_YEAR - 1) this.yearEndCb?.(Math.floor(abs / DAYS_PER_YEAR));
  }

  /** Fold the 15 days of month `m` into the archive (only when the whole month is kept; a save loaded mid-month still has all its days). */
  private closeMonth(m: number): void {
    const from = Math.max(m * 15, this.firstAbs), to = m * 15 + 14;
    if (this.archFirst < 0) this.archFirst = m;
    const next = this.archFirst + (this.arch.get('arrivals')?.length ?? 0);
    if (m !== next) return; // never leave a hole: months must stay contiguous
    for (const id of ARCHIVE_METRICS) {
      const agg = ARCH_AGG[id]!;
      const v = agg === 'last' ? this.at(id, to) : this.aggregate(id, agg, { from, to });
      this.arch.get(id)!.push(round2(v));
    }
    if (this.arch.get('arrivals')!.length > ARCHIVE_MONTHS) { for (const a of this.arch.values()) a.shift(); this.archFirst++; }
  }
  /** Rebuild the archive from the kept days (whole months only). */
  backfillArchive(): void {
    this.archFirst = -1; for (const a of this.arch.values()) a.length = 0;
    if (!this.len) return;
    for (let m = Math.ceil(this.firstAbs / 15); m * 15 + 14 <= this.lastAbs; m++) this.closeMonth(m);
  }
  /** Closed months in the archive (index = abs / 15). Metrics: see ARCHIVE_METRICS. */
  archiveMonths(): number { return this.arch.get('arrivals')?.length ?? 0; }
  archive(metric: string): Array<{ index: number; value: number }> {
    const a = this.arch.get(metric); if (!a) throw new Error(`Unknown archive metric '${metric}'`);
    return a.map((value, i) => ({ index: this.archFirst + i, value }));
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
    // Compact (Task 30): chronological (unrolled ring), quantised integers as base64 varints, all-zero series left out.
    const series: Record<string, string> = {};
    const first = this.firstAbs;
    for (const d of DEFS) {
      const src = this.arrays.get(d.id)!, q = scaleOf(d.id), vals: number[] = [];
      let any = false;
      for (let i = 0; i < this.len; i++) { const v = Math.round(src[(first + i) % STATS_DAYS]! * q); vals.push(v); if (v !== 0) any = true; }
      if (any) series[d.id] = encodeInts(vals, d.id === 'cash');
    }
    const arch: Record<string, string> = {};
    for (const [k, v] of this.arch) { const q = scaleOf(k), ints = v.map((x) => Math.round(x * q)); if (ints.some((x) => x !== 0)) arch[k] = encodeInts(ints, k === 'cash'); }
    return { chrono: 2, lastAbs: this.lastAbs, len: this.len, acc: { ...this.acc }, cum: { ...this.cum, runs: 0 }, cumInit: this.cumInit, series, archFirst: this.archFirst, archN: this.archiveMonths(), arch };
  }
  load(data: unknown): void {
    this.clear();
    const o = data as { chrono?: number; archFirst?: number; archN?: number; arch?: Record<string, string>; lastAbs?: number; len?: number; acc?: Acc; cum?: Cum; cumInit?: boolean; series?: Record<string, ArrayLike<number> | string> } | null;
    if (!o || typeof o.lastAbs !== 'number' || !o.series) return;
    this.lastAbs = o.lastAbs; this.len = Math.min(STATS_DAYS, o.len ?? 0);
    if (o.chrono) {
      const first = this.lastAbs - this.len + 1;
      for (const d of DEFS) {
        const src = o.series[d.id]; if (typeof src !== 'string') continue;
        const q = scaleOf(d.id), dst = this.arrays.get(d.id)!, v = decodeInts(src, this.len, d.id === 'cash');
        for (let i = 0; i < this.len; i++) dst[(first + i) % STATS_DAYS] = v[i]! / q;
      }
      const n = o.archN ?? 0; this.archFirst = n > 0 ? (o.archFirst ?? -1) : -1;
      for (const id of ARCHIVE_METRICS) { const src = o.arch?.[id], a = this.arch.get(id)!, q = scaleOf(id), v = typeof src === 'string' ? decodeInts(src, n, id === 'cash') : null; for (let i = 0; i < n; i++) a.push(v ? v[i]! / q : 0); }
    } else {
      for (const d of DEFS) { const src = o.series[d.id]; if (src && typeof src !== 'string') this.arrays.get(d.id)!.set(Array.from(src).slice(0, STATS_DAYS)); }
      this.backfillArchive(); // saves from before the archive (or generated demo data): monthly rows from the days that are kept
    }
    this.acc = { ...emptyAcc(), ...(o.acc ?? {}) }; if (o.cum) this.cum = { ...this.cum, ...o.cum, runs: -1 }; this.cumInit = !!o.cumInit;
  }
  reset(): void { this.clear(); }
}
