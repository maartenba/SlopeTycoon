import { TIER_NAMES, type AwardTier } from '../config/yearAwards';
import { DAYS_PER_MONTH } from '../config/balance';
import type { DeltaChip, YearReport } from '../sim/meta/YearReport';
import { MONTH_NAMES, formatSigned } from './financeFormat';
import { formatMoney } from './format';

/** Pure view-model + SVG-string helpers for the Resort of the Year report (no DOM access: unit-tested in node). */
export type Tone = 'good' | 'bad' | 'neutral';
export interface StatTile { key: string; label: string; value: string; tone: Tone; chip?: { text: string; tone: Tone } }

const pctText = (c: DeltaChip): string => (c.pct === null ? '' : `${c.pct >= 0 ? '+' : ''}${Math.round(c.pct)}%`);
const chipOf = (chips: readonly DeltaChip[], key: DeltaChip['key']): StatTile['chip'] => {
  const c = chips.find((x) => x.key === key);
  if (!c) return undefined;
  if (key === 'rating') return { text: `${c.delta >= 0 ? '+' : ''}${c.delta.toFixed(1)}★ vs last year`, tone: c.delta > 0 ? 'good' : c.delta < 0 ? 'bad' : 'neutral' };
  const t = pctText(c);
  return { text: `${t || (c.delta >= 0 ? '+' : '') + Math.round(c.delta)} vs last year`, tone: c.delta > 0 ? 'good' : c.delta < 0 ? 'bad' : 'neutral' };
};

export function statTiles(r: YearReport): StatTile[] {
  const t = r.totals;
  return [
    { key: 'guests', label: 'Guests', value: t.guests.toLocaleString('en-US'), tone: 'neutral', chip: chipOf(r.deltas, 'guests') },
    { key: 'income', label: 'Income', value: formatMoney(t.income), tone: 'neutral', chip: chipOf(r.deltas, 'income') },
    { key: 'profit', label: 'Profit', value: formatSigned(t.profit), tone: t.profit >= 0 ? 'good' : 'bad', chip: chipOf(r.deltas, 'profit') },
    { key: 'rating', label: 'Rating', value: `${t.ratingEnd.toFixed(1)}★`, tone: 'neutral', chip: chipOf(r.deltas, 'rating') },
  ];
}

const dayLabel = (day: number): string => `${MONTH_NAMES[Math.min(11, Math.floor(day / DAYS_PER_MONTH))]!.slice(0, 3)} ${(day % DAYS_PER_MONTH) + 1}`;
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Plain highlight lines (the humour is in the awards, not here). */
export function highlightLines(r: YearReport): string[] {
  const out: string[] = [];
  if (r.bestMonth !== null) out.push(`Best month: ${MONTH_NAMES[r.bestMonth]} (${formatSigned(r.months[r.bestMonth]!.net)})`);
  if (r.worstMonth !== null && r.worstMonth !== r.bestMonth) out.push(`Toughest month: ${MONTH_NAMES[r.worstMonth]} (${formatSigned(r.months[r.worstMonth]!.net)})`);
  if (r.busiest) out.push(`Busiest day: ${dayLabel(r.busiest.day)}, ${r.busiest.guests} guests in the resort`);
  if (r.bestSeason) out.push(`Best season: ${cap(r.bestSeason.season)} (${formatSigned(r.bestSeason.net)})`);
  if (r.venues.length) out.push(`Top earner: ${r.venues[0]!.name} (${formatMoney(r.venues[0]!.revenue)})`);
  if (r.categories.length) out.push(`Biggest income: ${cap(r.categories[0]!.id)} (${formatMoney(r.categories[0]!.amount)})`);
  out.push(r.safety.incidents === 0 ? 'Safety: no incidents this year' : `Safety: ${r.safety.incidents} incident${r.safety.incidents === 1 ? '' : 's'}, ${r.safety.hospitalised} hospitalised`);
  if (r.weather.snowiestWeek) out.push(`Snowiest week: from ${dayLabel(r.weather.snowiestWeek.startDay)} (${r.weather.snowiestWeek.snowDays} snow days)`);
  if (r.weather.warmSpell && r.weather.warmSpell.days >= 5) out.push(`Longest warm spell: ${r.weather.warmSpell.days} days from ${dayLabel(r.weather.warmSpell.startDay)}`);
  if (r.wildlife.sightings > 0) out.push(`Wildlife: ${r.wildlife.sightings} sighting${r.wildlife.sightings === 1 ? '' : 's'}${r.wildlife.attacks ? `, ${r.wildlife.attacks} attack${r.wildlife.attacks === 1 ? '' : 's'}` : ''}`);
  if (r.goalsCompleted > 0) out.push(`Goals completed: ${r.goalsCompleted}`);
  if (r.level !== null) out.push(`Resort level: ${r.level}`);
  return out;
}

export const yearTitle = (r: YearReport): string => `Year ${r.year} report`;
export const yearSubtitle = (r: YearReport, region = ''): string => `${r.name}${region ? ` · ${region}` : ''} · ${r.partial ? `${r.days} days recorded (first year)` : 'a full year on the mountain'}`;

// ---------------------------------------------------------------- charts (SVG strings; numbers only, nothing user-typed)
const f1 = (n: number): string => (Math.round(n * 10) / 10).toString();
export interface ChartOpts { w: number; h: number; pad?: number }

/** Monthly bars around a zero line: green above, red below. Empty input draws just the frame. */
export function barChartSvg(values: readonly number[], o: ChartOpts): string {
  const pad = o.pad ?? 6, w = o.w, h = o.h;
  const max = Math.max(1, ...values.map((v) => Math.abs(v)));
  const hasNeg = values.some((v) => v < 0), zero = hasNeg ? pad + (h - 2 * pad) / 2 : h - pad, scale = (hasNeg ? (h - 2 * pad) / 2 : h - 2 * pad) / max;
  const bw = (w - 2 * pad) / Math.max(1, values.length);
  const bars = values.map((v, i) => {
    const bh = Math.max(v === 0 ? 0 : 1, Math.abs(v) * scale), x = pad + i * bw + bw * 0.12;
    return `<rect x="${f1(x)}" y="${f1(v >= 0 ? zero - bh : zero)}" width="${f1(bw * 0.76)}" height="${f1(bh)}" rx="1.5" fill="${v >= 0 ? '#7fd68a' : '#ff9a8a'}"/>`;
  }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img" preserveAspectRatio="none"><line x1="${pad}" x2="${w - pad}" y1="${f1(zero)}" y2="${f1(zero)}" stroke="#5a7090" stroke-width="1"/>${bars}</svg>`;
}

/** Line through the points (NaN / zero-day months are skipped); y range [min, max] defaults to the data. */
export function lineChartSvg(values: ReadonlyArray<number | null>, o: ChartOpts & { min?: number; max?: number; color?: string }): string {
  const pad = o.pad ?? 6, w = o.w, h = o.h;
  const real = values.filter((v): v is number => v !== null && Number.isFinite(v));
  const lo = o.min ?? Math.min(...real, 0), hi = Math.max(o.max ?? Math.max(...real, 1), lo + 0.001);
  const px = (i: number): number => pad + (values.length <= 1 ? 0.5 : i / (values.length - 1)) * (w - 2 * pad);
  const py = (v: number): number => h - pad - ((v - lo) / (hi - lo)) * (h - 2 * pad);
  const pts: string[] = [];
  values.forEach((v, i) => { if (v !== null && Number.isFinite(v)) pts.push(`${f1(px(i))},${f1(py(v))}`); });
  const dots = pts.map((p) => { const [x, y] = p.split(','); return `<circle cx="${x}" cy="${y}" r="2.2" fill="${o.color ?? '#ffd070'}"/>`; }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img" preserveAspectRatio="none"><line x1="${pad}" x2="${w - pad}" y1="${h - pad}" y2="${h - pad}" stroke="#5a7090"/>${pts.length > 1 ? `<polyline points="${pts.join(' ')}" fill="none" stroke="${o.color ?? '#ffd070'}" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>` : ''}${dots}</svg>`;
}

/** Plain columns (guests per month). */
export function columnChartSvg(values: readonly number[], o: ChartOpts & { color?: string }): string {
  const pad = o.pad ?? 6, w = o.w, h = o.h, max = Math.max(1, ...values), bw = (w - 2 * pad) / Math.max(1, values.length);
  const bars = values.map((v, i) => { const bh = v > 0 ? Math.max(1, (v / max) * (h - 2 * pad)) : 0; return `<rect x="${f1(pad + i * bw + bw * 0.12)}" y="${f1(h - pad - bh)}" width="${f1(bw * 0.76)}" height="${f1(bh)}" rx="1.5" fill="${o.color ?? '#7fb6ff'}"/>`; }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img" preserveAspectRatio="none"><line x1="${pad}" x2="${w - pad}" y1="${h - pad}" y2="${h - pad}" stroke="#5a7090"/>${bars}</svg>`;
}

export const MEDAL_COLORS: Record<AwardTier, { fill: string; rim: string; ribbon: string }> = {
  0: { fill: '#3a475a', rim: '#4f6078', ribbon: '#2a3646' },
  1: { fill: '#c98a55', rim: '#e6ad7a', ribbon: '#8e5a38' },
  2: { fill: '#c5d0dc', rim: '#eef3f8', ribbon: '#7d8da1' },
  3: { fill: '#f2c14a', rim: '#ffe28a', ribbon: '#b98a1e' },
};
/** Medal icon (inline SVG string, 32x32 viewBox). Tier 0 = a dim, empty medal. */
export function medalSvg(tier: AwardTier, size = 32): string {
  const c = MEDAL_COLORS[tier];
  return `<svg viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true" focusable="false"><path d="M9 2h5l2 8-5 2zM23 2h-5l-2 8 5 2z" fill="${c.ribbon}"/><circle cx="16" cy="20" r="9" fill="${c.fill}" stroke="${c.rim}" stroke-width="2"/>${tier > 0 ? `<path d="M16 14.6l1.6 3.3 3.6.5-2.6 2.5.6 3.6-3.2-1.7-3.2 1.7.6-3.6-2.6-2.5 3.6-.5z" fill="${c.rim}"/>` : ''}</svg>`;
}
export const tierName = (t: AwardTier): string => TIER_NAMES[t];

// ---------------------------------------------------------------- auto-pause gate
export type GameSpeed = 0 | 1 | 2 | 3;
export interface GateDeps {
  getSpeed(): GameSpeed; setSpeed(s: GameSpeed): void;
  enabled(): boolean; tutorialActive(): boolean; ended(): boolean; demo(): boolean;
  /** Dialogs currently open (the report queues behind them). */
  dialogsOpen(): number;
  /** Show the dialog for this year. */
  show(year: number): void;
}
/**
 * Pure decision logic for the year-end modal: show once per year, never during the tutorial / demo / bankruptcy, queue behind other dialogs,
 * pause on open and restore the previous speed on close only if the clock is still paused (the player may have changed it meanwhile) and
 * the game did not end.
 */
export class YearReportGate {
  private queue: number[] = [];
  private showing: number | null = null;
  private prevSpeed: GameSpeed = 1;
  private pausedByUs = false;
  constructor(private readonly d: GateDeps) {}
  get pending(): readonly number[] { return this.queue; }
  get current(): number | null { return this.showing; }
  /** A report is ready. Returns what happened to it. */
  onReport(year: number): 'shown' | 'queued' | 'skipped' {
    if (!this.d.enabled() || this.d.demo() || this.d.ended()) return 'skipped';
    if (!this.queue.includes(year) && this.showing !== year) this.queue.push(year);
    return this.pump() ? 'shown' : 'queued';
  }
  /** Try to show the next queued report (call periodically and when a dialog closes). */
  pump(): boolean {
    if (this.showing !== null || !this.queue.length) return false;
    if (this.d.ended()) { this.queue = []; return false; }
    if (this.d.tutorialActive() || this.d.dialogsOpen() > 0 || !this.d.enabled()) return false;
    const year = this.queue.shift()!;
    this.showing = year;
    const sp = this.d.getSpeed();
    this.pausedByUs = sp !== 0; this.prevSpeed = sp === 0 ? 1 : sp;
    if (this.pausedByUs) this.d.setSpeed(0);
    this.d.show(year);
    return true;
  }
  /** The dialog closed (Continue, Remind me later, Esc, X). */
  closed(): void {
    if (this.showing === null) return;
    this.showing = null;
    if (this.pausedByUs && !this.d.ended() && this.d.getSpeed() === 0 && !this.d.tutorialActive()) this.d.setSpeed(this.prevSpeed);
    this.pausedByUs = false;
  }
}
