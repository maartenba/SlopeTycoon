import { DAYS_PER_MONTH, DAYS_PER_YEAR } from '../../config/balance';
import {
  AWARDS, headlineOf, HEADLINE_TEXT, StaticBaselines, tierOf, type AwardTier, type BaselineProvider, type HeadlineTier, type YearMetrics,
} from '../../config/yearAwards';
import type { SeasonId } from '../../core/events';
import { seasonOfMonth } from '../Clock';
import { round2, type StatsHistory } from './StatsHistory';

/** Last N reports kept (and saved). */
export const MAX_REPORTS = 10;
export const WARM_SPELL_C = 10;

export interface AwardResult { id: string; name: string; /** 0 none, 1 bronze, 2 silver, 3 gold */ tier: AwardTier; /** null = could not be judged this year */ ratio: number | null; blurb: string; how: string }
export interface MonthRow { month: number; income: number; expense: number; net: number; guests: number; rating: number; days: number }
export interface DeltaChip { key: 'guests' | 'profit' | 'income' | 'rating'; label: string; delta: number; pct: number | null }
export interface YearReport {
  v: 1;
  year: number;
  name: string;
  /** Days of the year that were actually recorded (< 180 when the game started mid-year or the save is old). */
  days: number;
  /** Fewer than half of the year's days were recorded (the game started late in the year): the headline is capped at bronze. */
  partial: boolean;
  totals: { guests: number; income: number; expense: number; profit: number; margin: number; runs: number; peakGuests: number; happiness: number; ratingStart: number; ratingEnd: number };
  months: MonthRow[];
  bestMonth: number | null; worstMonth: number | null;
  busiest: { day: number; guests: number } | null;
  bestSeason: { season: SeasonId; net: number } | null;
  categories: Array<{ id: string; amount: number }>;
  venues: Array<{ name: string; revenue: number }>;
  safety: { incidents: number; resolved: number; hospitalised: number; per1000: number };
  weather: { snowiestWeek: { startDay: number; snowDays: number } | null; warmSpell: { startDay: number; days: number } | null };
  wildlife: { sightings: number; attacks: number };
  goalsCompleted: number; goalsTotal: number;
  level: number | null;
  awards: AwardResult[];
  points: number; maxPoints: number;
  headline: { tier: HeadlineTier; title: string };
  deltas: DeltaChip[];
  /** Small JPEG data URL (<= 30 kB) added by the UI after the report was generated; absent headless. */
  cover?: string;
}

/** Everything `computeYearReport` needs besides the history. */
export interface ReportInput {
  hist: StatsHistory; year: number; mapSize: number; name: string;
  baselines?: BaselineProvider; prev?: YearReport | null;
  level?: number | null; goalsTotal?: number; venues?: Array<{ name: string; revenue: number }>;
}

const r0 = (n: number): number => Math.round(n);
const seasonOfAbs = (abs: number): SeasonId => seasonOfMonth(Math.floor((abs % DAYS_PER_YEAR) / DAYS_PER_MONTH));

/** Pure: the report of one calendar year from the stats ring. Deterministic (stable rounding, no RNG, no clock). */
export function computeYearReport(i: ReportInput): YearReport {
  const h = i.hist, y0 = i.year * DAYS_PER_YEAR;
  const from = Math.max(y0, h.firstAbs < 0 ? y0 : h.firstAbs), to = Math.min(y0 + DAYS_PER_YEAR - 1, h.lastAbs);
  const range = { from, to }, days = h.len && to >= from ? to - from + 1 : 0;
  const sum = (m: string, r = range): number => h.summary(m, r).sum;
  const guests = sum('arrivals'), income = sum('income'), expense = sum('expense'), profit = income - expense;

  const months: MonthRow[] = [];
  for (let m = 0; m < 12; m++) {
    const r = { from: Math.max(from, y0 + m * DAYS_PER_MONTH), to: Math.min(to, y0 + m * DAYS_PER_MONTH + DAYS_PER_MONTH - 1) };
    const n = r.to >= r.from ? r.to - r.from + 1 : 0;
    const inc = n ? sum('income', r) : 0, exp = n ? sum('expense', r) : 0;
    months.push({ month: m, income: r0(inc), expense: r0(exp), net: r0(inc - exp), guests: n ? r0(sum('arrivals', r)) : 0, rating: n ? round2(h.summary('rating', r).mean) : 0, days: n });
  }
  const live = months.filter((m) => m.days > 0);
  const best = live.length ? live.reduce((a, b) => (b.net > a.net ? b : a)) : null;
  const worst = live.length ? live.reduce((a, b) => (b.net < a.net ? b : a)) : null;

  // busiest day (the peak resident guests of a day)
  let busiest: YearReport['busiest'] = null;
  for (let d = from; d <= to; d++) { const v = h.at('peak', d); if (v > 0 && (!busiest || v > busiest.guests)) busiest = { day: d - y0, guests: v }; }

  const seasonNet = new Map<SeasonId, number>();
  for (let d = from; d <= to; d++) seasonNet.set(seasonOfAbs(d), (seasonNet.get(seasonOfAbs(d)) ?? 0) + h.at('income', d) - h.at('expense', d));
  let bestSeason: YearReport['bestSeason'] = null;
  for (const [season, net] of [...seasonNet].sort((a, b) => b[1] - a[1])) { bestSeason = { season, net: r0(net) }; break; }

  const cats = ['lifts', 'passes', 'lodging', 'shops', 'restaurants', 'bars', 'recreation', 'rental', 'lessons', 'other']
    .map((id) => ({ id, amount: r0(sum(`inc:${id}`)) })).filter((c) => c.amount > 0).sort((a, b) => b.amount - a.amount || (a.id < b.id ? -1 : 1)).slice(0, 4);
  const venues = [...(i.venues ?? [])].filter((v) => v.revenue > 0).sort((a, b) => b.revenue - a.revenue || (a.name < b.name ? -1 : 1)).slice(0, 3).map((v) => ({ name: v.name, revenue: r0(v.revenue) }));

  const incidents = sum('incCreated');
  const safety = { incidents, resolved: sum('incResolved'), hospitalised: sum('hospitalised'), per1000: guests > 0 ? round2((incidents * 1000) / guests) : 0 };

  // weather: snowiest 7-day window, longest run of warm days
  let snowiest: YearReport['weather']['snowiestWeek'] = null;
  for (let d = from; d + 6 <= to; d++) {
    let n = 0;
    for (let k = 0; k < 7; k++) { const c = h.at('weather', d + k); if (c === 2 || c === 3) n++; }
    if (n > 0 && (!snowiest || n > snowiest.snowDays)) snowiest = { startDay: d - y0, snowDays: n };
  }
  let warm: YearReport['weather']['warmSpell'] = null, run = 0;
  for (let d = from; d <= to; d++) {
    run = h.at('temp', d) >= WARM_SPELL_C ? run + 1 : 0;
    if (run > 0 && (!warm || run > warm.days)) warm = { startDay: d - run + 1 - y0, days: run };
  }

  const peakDays = []; for (let d = from; d <= to; d++) if (h.at('peak', d) > 0) peakDays.push(d);
  const meanOver = (m: string, ds: number[]): number => (ds.length ? ds.reduce((a, d) => a + h.at(m, d), 0) / ds.length : 0);
  const happiness = round2(meanOver('happiness', peakDays));
  const family = sum('family');
  const qualDays = peakDays.filter((d) => h.at('quality', d) > 0);
  const winterDays: number[] = []; for (let d = from; d <= to; d++) if (seasonOfAbs(d) === 'winter') winterDays.push(d);
  const restaurantRevenue = sum('inc:restaurants') + sum('inc:bars');
  let summerIncome = 0; for (let d = from; d <= to; d++) if (seasonOfAbs(d) === 'summer') summerIncome += h.at('income', d);
  const sightings = sum('wildlife'), attacks = sum('attacks');
  const metrics: YearMetrics = {
    guests, familyShare: guests > 0 ? family / guests : 0, happiness, incidents, incidentsPer1000: safety.per1000,
    pisteQuality: qualDays.length ? meanOver('quality', qualDays) : null,
    winterSkiable: winterDays.length >= 15 ? meanOver('skiable', winterDays) : null,
    restaurantRevenue, restaurantPerGuest: guests > 0 ? restaurantRevenue / guests : 0, summerIncome, income, profit, margin: income > 0 ? profit / income : 0,
    attacks, wildlifeSightings: sightings, guestGrowth: i.prev && i.prev.totals.guests > 0 ? guests / i.prev.totals.guests : null,
  };
  const provider = i.baselines ?? new StaticBaselines();
  const awards: AwardResult[] = AWARDS.map((a) => {
    const ratio = a.ratio(metrics, provider.baseline(a.metric, { mapSize: i.mapSize, year: i.year }));
    const tier: AwardTier = ratio === null ? 0 : tierOf(ratio);
    return { id: a.id, name: a.name, tier, ratio: ratio === null ? null : round2(ratio), blurb: tier > 0 ? a.blurb[tier - 1]! : '', how: a.how };
  });
  const points = awards.reduce((a, r) => a + r.tier, 0), maxPoints = awards.filter((a) => a.ratio !== null).length * 3;
  const partial = days < DAYS_PER_YEAR / 2;
  const rawTier = headlineOf(points, maxPoints), tier: HeadlineTier = partial && (rawTier === 'silver' || rawTier === 'gold') ? 'bronze' : rawTier;

  const ratingStart = live.length ? live[0]!.rating : 0, ratingEnd = live.length ? live[live.length - 1]!.rating : 0;
  const totals = { guests: r0(guests), income: r0(income), expense: r0(expense), profit: r0(profit), margin: round2(metrics.margin), runs: r0(sum('runs')), peakGuests: r0(h.summary('peak', range).max), happiness, ratingStart, ratingEnd };
  const p = i.prev ?? null;
  const chip = (key: DeltaChip['key'], label: string, cur: number, prev: number): DeltaChip => ({ key, label, delta: round2(cur - prev), pct: prev !== 0 ? round2(((cur - prev) / Math.abs(prev)) * 100) : null });
  const deltas: DeltaChip[] = p ? [
    chip('guests', 'Guests', totals.guests, p.totals.guests), chip('income', 'Income', totals.income, p.totals.income),
    chip('profit', 'Profit', totals.profit, p.totals.profit), chip('rating', 'Rating', totals.ratingEnd, p.totals.ratingEnd),
  ] : [];
  const goalsTotal = i.goalsTotal ?? 0;
  return {
    v: 1, year: i.year, name: i.name, days, partial, totals, months, bestMonth: best?.month ?? null, worstMonth: worst?.month ?? null, busiest, bestSeason,
    categories: cats, venues, safety, weather: { snowiestWeek: snowiest, warmSpell: warm }, wildlife: { sightings: r0(sightings), attacks: r0(attacks) },
    goalsCompleted: Math.max(0, goalsTotal - (p?.goalsTotal ?? 0)), goalsTotal, level: i.level ?? null,
    awards, points, maxPoints, headline: { tier, title: HEADLINE_TEXT[tier] }, deltas,
  };
}

/** Sim-side store of the last reports (save module `yearReports`). Generation is triggered by `StatsHistory.onYearEnd`. */
export interface YearReportSources {
  mapSize: number; name(year: number): string; level(): number | null; goalsTotal(): number;
  venues(): Array<{ id: number; name: string; revenue: number }>;
  /** Called after a report was stored (the game emits `year:report`). */
  ready(r: YearReport): void;
}
export class YearReports {
  private list: YearReport[] = [];
  private venueBase = new Map<number, number>();
  baselines: BaselineProvider = new StaticBaselines();
  constructor(private readonly hist: StatsHistory, private readonly src: YearReportSources | null = null) {
    hist.onYearEnd((year) => { if (this.src) this.generate(year); });
  }
  all(): readonly YearReport[] { return this.list; }
  latest(): YearReport | null { return this.list[this.list.length - 1] ?? null; }
  get(year: number): YearReport | null { return this.list.find((r) => r.year === year) ?? null; }
  /** Compute (or recompute) the report of `year` from the ring and store it. */
  generate(year: number): YearReport {
    const s = this.src!, prev = [...this.list].reverse().find((r) => r.year < year) ?? null;
    const vs = s.venues();
    const rep = computeYearReport({
      hist: this.hist, year, mapSize: s.mapSize, name: s.name(year), baselines: this.baselines, prev, level: s.level(), goalsTotal: s.goalsTotal(),
      venues: vs.map((v) => ({ name: v.name, revenue: v.revenue - (this.venueBase.get(v.id) ?? 0) })),
    });
    this.venueBase = new Map(vs.map((v) => [v.id, v.revenue]));
    this.list = this.list.filter((r) => r.year !== year); this.list.push(rep); this.list.sort((a, b) => a.year - b.year);
    while (this.list.length > MAX_REPORTS) this.list.shift();
    s.ready(rep);
    return rep;
  }
  /** Attach the cover JPEG (data URL, <= 30 kB) to a stored report. */
  setCover(year: number, dataUrl: string): boolean {
    const r = this.get(year);
    if (!r || dataUrl.length > 30_000) return false;
    r.cover = dataUrl; return true;
  }
  serialize(): unknown { return { reports: this.list.map((r) => ({ ...r })), venueBase: [...this.venueBase] }; }
  load(data: unknown): void {
    const o = data as { reports?: YearReport[]; venueBase?: Array<[number, number]> } | null;
    this.list = Array.isArray(o?.reports) ? o!.reports!.filter((r) => r && r.v === 1).slice(-MAX_REPORTS) : [];
    this.venueBase = new Map(o?.venueBase ?? []);
  }
  reset(): void { this.list = []; this.venueBase = new Map(); }
}
