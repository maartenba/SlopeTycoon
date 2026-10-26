import { LEDGER_CATEGORIES } from '../config/prices';
import { STATS_DAYS, type StatsAgg, type StatsHistory } from '../sim/meta/StatsHistory';

/** Pure data side of the Statistics screen (Task 30): range selection, bucketing and the colour-blind-safe palette. No DOM. */
export type StatsRangeId = '30d' | '180d' | '2y' | 'all';
export const STATS_RANGES: ReadonlyArray<{ id: StatsRangeId; label: string; title: string }> = [
  { id: '30d', label: '30 days', title: 'The last 30 in-game days, one bar per day' },
  { id: '180d', label: 'Year', title: 'The last 180 days (one in-game year)' },
  { id: '2y', label: '2 years', title: 'The last two in-game years, day by day' },
  { id: 'all', label: 'All time', title: 'Every closed month since the start (older days are kept as monthly summaries)' },
];
export const MAX_POINTS = 36;

/** Okabe-Ito based: distinguishable with the common colour-vision deficiencies. Revenue slots also differ in lightness. */
export const PALETTE = ['#56b4e9', '#e69f00', '#009e73', '#f0e442', '#cc79a7', '#d55e00', '#9fb4cc'] as const;
export const LINE = { guests: '#56b4e9', peak: '#f0e442', cash: '#009e73', rating: '#e69f00', sustain: '#56b4e9' } as const;

export interface StatsPoint { /** First and last absolute day of the bucket. */ from: number; to: number; /** Short x label ('Y2 M3'). */ label: string }
export interface StatsFrame { range: StatsRangeId; monthly: boolean; points: StatsPoint[]; value(metric: string, agg: StatsAgg | 'last'): number[] }

const MONTH = 15;
export function dayLabel(abs: number, monthly: boolean): string {
  const y = Math.floor(abs / 180) + 1, m = Math.floor((abs % 180) / MONTH) + 1, d = (abs % MONTH) + 1;
  return monthly ? `Y${y} M${m}` : `Y${y} M${m} D${d}`;
}

/** Bucket size so that `n` items make at most MAX_POINTS points (buckets are cut from the newest end, so the OLDEST one may be shorter). */
export function bucketSize(n: number): number { return Math.max(1, Math.ceil(n / MAX_POINTS)); }

/** Build the frame (buckets) of a range from the history. `null` when there is nothing to chart yet. */
export function statsFrame(h: StatsHistory, range: StatsRangeId): StatsFrame | null {
  if (range === 'all') {
    const n = h.archiveMonths();
    if (n < 1) return null;
    const rows = h.archive('arrivals'), step = bucketSize(n);
    const points: StatsPoint[] = [], groups: number[][] = [];
    for (let end = n; end > 0; end -= step) {
      const start = Math.max(0, end - step), idx: number[] = [];
      for (let i = start; i < end; i++) idx.push(i);
      groups.unshift(idx);
    }
    for (const g of groups) { const a = rows[g[0]!]!.index, b = rows[g[g.length - 1]!]!.index; points.push({ from: a * MONTH, to: b * MONTH + MONTH - 1, label: a === b ? dayLabel(a * MONTH, true) : `${dayLabel(a * MONTH, true)} - ${dayLabel(b * MONTH, true)}` }); }
    return { range, monthly: true, points, value: (metric, agg) => { const rowsOf = h.archive(metric); return groups.map((g) => {
      const v = g.map((i) => rowsOf[i]!.value);
      return agg === 'sum' ? v.reduce((s, x) => s + x, 0) : agg === 'max' ? Math.max(...v) : agg === 'min' ? Math.min(...v) : agg === 'last' ? v[v.length - 1]! : v.reduce((s, x) => s + x, 0) / v.length;
    }); } };
  }
  const days = range === '30d' ? 30 : range === '180d' ? 180 : STATS_DAYS;
  if (h.len < 1) return null;
  const to = h.lastAbs, from = Math.max(h.firstAbs, to - days + 1), n = to - from + 1, step = bucketSize(n);
  const points: StatsPoint[] = [];
  for (let end = to; end >= from; end -= step) {
    const a = Math.max(from, end - step + 1);
    points.unshift({ from: a, to: end, label: a === end ? dayLabel(a, false) : `${dayLabel(a, false)} - ${dayLabel(end, false)}` });
  }
  return { range, monthly: false, points, value: (metric, agg) => points.map((p) => {
    if (agg === 'last') return h.at(metric, p.to);
    return h.aggregate(metric, agg, { from: p.from, to: p.to });
  }) };
}

export interface RevenueSeries { id: string; label: string; color: string; values: number[]; total: number }
const CAT_LABEL: Record<string, string> = { lifts: 'Lifts', passes: 'Passes', lodging: 'Lodging', shops: 'Shops', restaurants: 'Restaurants', bars: 'Bars', recreation: 'Recreation', rental: 'Rental', lessons: 'Lessons', grant: 'Grants', other: 'Other' };

/** Revenue by category, largest first: the top 5 plus one 'Everything else' (small ones merged) so the legend stays readable. */
export function revenueSeries(f: StatsFrame): RevenueSeries[] {
  const all = LEDGER_CATEGORIES.map((c) => { const values = f.value(`inc:${c}`, 'sum'); return { id: c, label: CAT_LABEL[c] ?? c, values, total: values.reduce((s, x) => s + x, 0) }; }).filter((s) => s.total > 0).sort((a, b) => b.total - a.total);
  const top = all.slice(0, 5), rest = all.slice(5);
  const out: RevenueSeries[] = top.map((s, i) => ({ ...s, color: PALETTE[i]! }));
  if (rest.length) out.push({ id: 'rest', label: 'Everything else', color: PALETTE[6]!, values: f.points.map((_, i) => rest.reduce((s, r) => s + r.values[i]!, 0)), total: rest.reduce((s, r) => s + r.total, 0) });
  return out;
}

export const money = (v: number): string => `${v < 0 ? '-' : ''}$${Math.abs(Math.round(v)).toLocaleString('en-US')}`;
export function compact(v: number): string {
  const a = Math.abs(v), s = v < 0 ? '-' : '';
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`;
  return `${s}${Math.round(a)}`;
}
/** 'Nice' axis: 4 ticks over [lo, hi] with round steps. */
export function niceAxis(lo: number, hi: number, ticks = 4): { min: number; max: number; step: number } {
  if (!(hi > lo)) { hi = lo + 1; }
  const raw = (hi - lo) / ticks, mag = 10 ** Math.floor(Math.log10(raw)), norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  return { min: Math.floor(lo / step) * step, max: Math.ceil(hi / step) * step, step };
}
