import type { GameBus } from '../core/events';
import { DAYS_PER_MONTH } from '../config/balance';
import type { LastMonth } from '../sim/SessionMeta';
import { formatMoney } from './format';
import { MONTH_NAMES, formatSigned } from './financeFormat';
import { humanizeId, sentence } from './text';

/** Pure formatting for the "Welcome back" recap and the month-end card (M5.1). No DOM; no raw ids; every string starts uppercase. */
export type Tone = 'good' | 'bad' | 'neutral';
export interface RecapIssues { openIncidents: number; closedLifts: number; brokenLifts: number; closedPistes: number; lowCash: boolean }
export interface RecapInput {
  date: { year: number; day: number };
  season: string;
  cash: number; stars: number;
  /** Cash / stars when the running month began (undefined for an old save without sessionMeta). */
  monthStartMoney?: number; monthStartStars?: number;
  last?: LastMonth | null;
  goals: ReadonlyArray<{ title: string; progress: number }>;
  advice: ReadonlyArray<{ title: string }>;
  issues: RecapIssues;
}
export interface RecapModel {
  title: string; subtitle: string; stars: number;
  cash: string;
  /** Rating trend text ('Up half a star this month'); null when unknown. */
  trend: { text: string; tone: Tone } | null;
  /** Money change since the month began; null when unknown. */
  change: { text: string; tone: Tone } | null;
  lastMonth: { text: string; tone: Tone } | null;
  goals: Array<{ text: string; pct: number }>;
  advice: string[];
  issues: string[];
  reduced: boolean;
}

export const monthName = (m: number): string => MONTH_NAMES[((Math.trunc(m) % 12) + 12) % 12] ?? 'Month';
export const monthOfDay = (day: number): number => Math.floor(day / DAYS_PER_MONTH);
const tone = (n: number): Tone => (Math.round(n) > 0 ? 'good' : Math.round(n) < 0 ? 'bad' : 'neutral');
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** '+$1,200' / '-$300' / '$0' (zero has no sign). */
export const moneyDelta = (n: number): string => (Math.round(n) === 0 ? formatMoney(0) : formatSigned(n));

/** Star difference as words: 'Up 1 star', 'Down half a star', 'Steady'. */
export function ratingDelta(d: number): { text: string; tone: Tone } {
  const r = Math.round(d * 2) / 2;
  if (r === 0) return { text: 'Steady', tone: 'neutral' };
  const a = Math.abs(r), n = a === 0.5 ? 'half a star' : a === 1 ? '1 star' : `${a} stars`;
  return { text: `${r > 0 ? 'Up' : 'Down'} ${n}`, tone: r > 0 ? 'good' : 'bad' };
}

export function formatIssues(i: RecapIssues): string[] {
  const out: string[] = [];
  if (i.brokenLifts > 0) out.push(`${plural(i.brokenLifts, 'lift is', 'lifts are')} broken down`);
  if (i.openIncidents > 0) out.push(`${plural(i.openIncidents, 'incident is', 'incidents are')} still open`);
  const closed = i.closedLifts - i.brokenLifts;
  if (closed > 0) out.push(`${plural(closed, 'lift is', 'lifts are')} closed`);
  if (i.closedPistes > 0) out.push(`${plural(i.closedPistes, 'piste is', 'pistes are')} closed`);
  if (i.lowCash) out.push('Cash is running low');
  return out.map(sentence);
}

export function formatRecap(m: RecapInput): RecapModel {
  const known = m.monthStartMoney !== undefined && m.monthStartStars !== undefined;
  const last = m.last ?? null;
  return {
    title: 'Welcome back',
    subtitle: sentence(`${m.season} · ${monthName(monthOfDay(m.date.day))}, year ${m.date.year}`),
    stars: m.stars,
    cash: formatMoney(m.cash),
    trend: known ? ratingDelta(m.stars - m.monthStartStars!) : null,
    change: known ? { text: `${moneyDelta(m.cash - m.monthStartMoney!)} this month`, tone: tone(m.cash - m.monthStartMoney!) } : null,
    lastMonth: last ? { text: `${monthName(last.month)}: ${formatSigned(last.net)} net`, tone: tone(last.net) } : null,
    goals: m.goals.slice(0, 2).map((g) => ({ text: sentence(g.title), pct: Math.round(Math.max(0, Math.min(1, g.progress)) * 100) })),
    advice: m.advice.slice(0, 2).map((a) => sentence(a.title)),
    issues: formatIssues(m.issues),
    reduced: !known,
  };
}

/** Closed-month report (subset of Economy's MonthReport). */
export interface MonthCardInput {
  year: number; month: number; incomeTotal: number; expenseTotal: number; net: number; guests: number;
  income: Readonly<Record<string, number>>;
}
export interface MonthCardModel {
  title: string;
  income: { label: string; text: string; tone: Tone }; expense: { label: string; text: string; tone: Tone }; net: { label: string; text: string; tone: Tone };
  guests: string; rating: { text: string; tone: Tone } | null; highlight: string | null;
}
const CATEGORY_LABEL: Record<string, string> = { lifts: 'Lift tickets', passes: 'Season passes', lodging: 'Lodging', shops: 'Shops', restaurants: 'Restaurants', bars: 'Bars', recreation: 'Recreation', rental: 'Rentals', lessons: 'Lessons' };

/** The biggest earner of the month (grants and 'other' never count). */
export function bestCategory(income: Readonly<Record<string, number>>): { label: string; amount: number } | null {
  let best: string | null = null;
  for (const [k, v] of Object.entries(income)) if (k !== 'grant' && k !== 'other' && v > 0 && (best === null || v > income[best]!)) best = k;
  return best ? { label: CATEGORY_LABEL[best] ?? humanizeId(best), amount: income[best]! } : null;
}

export function formatMonthCard(r: MonthCardInput, ratingChange?: number, hint?: string): MonthCardModel {
  const best = bestCategory(r.income);
  return {
    title: `${monthName(r.month)} closed`,
    income: { label: 'Income', text: formatMoney(r.incomeTotal), tone: 'good' },
    expense: { label: 'Expenses', text: formatMoney(r.expenseTotal), tone: 'neutral' },
    net: { label: 'Net', text: formatSigned(r.net), tone: tone(r.net) },
    guests: `${r.guests.toLocaleString('en-US')} ${r.guests === 1 ? 'guest' : 'guests'} in the resort`,
    rating: ratingChange === undefined ? null : { ...ratingDelta(ratingChange) },
    highlight: hint ?? (best ? `Best earner: ${best.label} (${formatMoney(best.amount)})` : r.net >= 0 ? 'A quiet month' : 'No income this month'),
  };
}

/** Month-end wiring: on `finance:monthClosed` show the card for the matching report (setting + demo guarded). Returns the unsubscribe. */
export function wireMonthCard(bus: GameBus, d: {
  enabled(): boolean;
  report(): (MonthCardInput & { month: number; year: number }) | undefined;
  ratingDelta(): number | undefined;
  show(m: MonthCardModel, key: string): unknown;
  /** The Resort of the Year report of this closed year exists (shown on the last month's card). */
  yearReportReady?(year: number): boolean;
}): () => void {
  return bus.on('finance:monthClosed', (e) => {
    if (!d.enabled()) return;
    const r = d.report();
    if (!r || r.year !== e.year || r.month !== e.month) return;
    const hint = e.month === 11 && d.yearReportReady?.(e.year) ? 'Year report ready' : undefined;
    d.show(formatMonthCard(r, d.ratingDelta(), hint), `month:${e.year}:${e.month}`);
  });
}

/** The recap appears only after loading a save (Continue / Load / autosave resume): never on a new game, the title-screen demo or while the tutorial runs. */
export const shouldShowRecap = (o: { loadedSave: boolean; demo: boolean; tutorialMode: boolean; tutorialActive: boolean }): boolean =>
  o.loadedSave && !o.demo && !o.tutorialMode && !o.tutorialActive;
