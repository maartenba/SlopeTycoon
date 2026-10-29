import type { GameEventName, GameEvents } from '@/core/events';
import { GAME_EVENT_NAMES } from '@/core/events';
import { displayName, sentence } from './text';
import { SIM_MONTHS_SHORT, REAL_MONTHS } from '../sim/calendar';

export type Severity = 'info' | 'good' | 'warn' | 'bad';
/**
 * Importance tiers (M3 playtest: 'so much news'). The feed shows important + critical rows by default; info items are collapsed into the
 * daily digest / 'Today' counters (shown under the 'All' filter); trivial items only feed counters. Toasts: critical + important only.
 */
export type Tier = 'critical' | 'important' | 'info' | 'trivial';
export const TIER_RANK: Record<Tier, number> = { trivial: 0, info: 1, important: 2, critical: 3 };
export type NewsCategory = 'incident' | 'closure' | 'weather' | 'finance' | 'rating' | 'milestone' | 'ops' | 'building';
export const NEWS_CATEGORIES: readonly NewsCategory[] = ['incident', 'closure', 'weather', 'finance', 'rating', 'milestone', 'ops', 'building'];
/** Categories muted (no rows, no toasts) until the player enables them. Critical items are never muted. */
export const DEFAULT_MUTED: readonly NewsCategory[] = ['weather', 'ops'];

/** Counters that feed the daily digest ('Day 12: 34 guests arrived, 12 left'). */
export type CounterId = 'arrived' | 'left' | 'rescues' | 'injuries' | 'grooming' | 'wildlife' | 'avalancheControl';

/** Camera/selection target of a location-bearing message. Tile coordinates (x, y); an entity is selected when the kind supports it. */
export interface FocusTarget { x: number; y: number; entityKind?: 'building' | 'lift' | 'guest'; entityId?: number; /** Footprint to outline (a suggested building site); default is a 3x3 ring around the point. */ rect?: { x: number; y: number; w: number; h: number } }

export interface NewsItem {
  text: string;
  severity: Severity;
  tier: Tier;
  icon: string;
  /** Coalescing key: identical keys within the cooldown window merge into one entry with a count badge. */
  key: string;
  category: NewsCategory;
  /** Tile location when the event has one (click-to-focus). Mirrors `focus` (kept for older callers). */
  loc?: { x: number; y: number };
  /** Where to look ('Go to' button / click): tile + optional entity to select. */
  focus?: FocusTarget;
  /** Increments a digest counter instead of (or besides) showing a row. */
  counter?: CounterId;
  /** Aggregated wording when the key coalesces N times ('3 pistes closed'). Falls back to 'text ×N'. */
  many?: (n: number) => string;
  /** Expected seasonal closure of an attraction (no snow / too warm / out of season): grouped into one quiet toast, one news row per kind and day. */
  seasonal?: SeasonalClosure;
}

export interface SeasonalClosure { id: number; name: string; kind: 'snow' | 'warm' | 'season' }
/** Classifies a closure reason as seasonal (null for genuine surprises such as staff, breakdowns, storms). */
export const seasonalKind = (reason: string): SeasonalClosure['kind'] | null => /no snow/i.test(reason) ? 'snow' : /too warm/i.test(reason) ? 'warm' : /for the season|lake is frozen/i.test(reason) ? 'season' : null;

/** Where something happened: 'on Blue Run 3', 'near the Mountain Hut 2', 'in the northern upper bowl'. */
export interface PlaceText { name: string; on: string; near: string }
/** Optional name lookups (lifts, pistes, places) so messages can say 'Chairlift 1' / 'Blue Run 3'. */
export interface NewsCtx {
  /** Tile position of a lift (bottom station) or building (centre); null when unknown/removed. */
  locate?: (kind: 'lift' | 'building', id: number) => { x: number; y: number } | null;
  liftName?: (id: number) => string | undefined; money?: (n: number) => string; where?: (x: number, y: number) => PlaceText }
const MONTHS = SIM_MONTHS_SHORT;

type Formatter<K extends GameEventName> = (e: GameEvents[K], c: NewsCtx) => NewsItem | null;
type Table = { [K in GameEventName]: Formatter<K> | 'ignored' };
const SEVERITY_RANK: Record<Severity, number> = { info: 0, good: 1, warn: 2, bad: 3 };
export const severityRank = (s: Severity): number => SEVERITY_RANK[s];

const money = (c: NewsCtx, n: number): string => (c.money ? c.money(n) : `$${Math.round(n).toLocaleString('en-US')}`);
const liftLabel = (c: NewsCtx, id: number): string => c.liftName?.(id) ?? `Lift ${id}`;
const place = (c: NewsCtx, x: number, y: number): PlaceText => c.where?.(x, y) ?? { name: 'the slopes', on: 'on the slopes', near: 'near the slopes' };
/** Closed/inactive reason without the 'Closed:' prefix, sentence-cased ('No snow at 1,450 m'). */
export const reasonText = (r: string): string => sentence(r.replace(/^(Closed|Inactive):\s*/, ''));
const at = (c: NewsCtx, kind: 'lift' | 'building', id: number): FocusTarget | undefined => { const p = c.locate?.(kind, id); return p ? { x: p.x, y: p.y, entityKind: kind === 'building' ? 'building' : 'lift', entityId: id } : undefined; };
const xy = (x: number, y: number, entityKind?: FocusTarget['entityKind'], entityId?: number): FocusTarget => ({ x, y, ...(entityKind ? { entityKind, entityId } : {}) });
const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Every GameEvents name is either formatted or explicitly 'ignored' (enforced by the type and by tests). */
/** Plain wording for incident kinds (the internal `buried` state reads as trapped in the snow). */
const INCIDENT_KIND_TEXT: Record<string, string> = { buried: 'guest trapped in the snow', injury: 'guest injured', attack: 'animal encounter', stranded: 'riders stranded on a lift' };

export const NEWS_FORMATTERS: Table = {
  'guest:arrived': (): NewsItem => ({ text: 'Guest arrived', severity: 'info', tier: 'trivial', icon: '🎿', key: 'guest:arrived', category: 'milestone', counter: 'arrived' }), // rows only via MilestoneTracker
  'guest:left': () => ({ text: 'Guest left', severity: 'info', tier: 'trivial', icon: '🚶', key: 'guest:left', category: 'milestone', counter: 'left' }),
  'guest:review': 'ignored', // shown in the News 'Reviews' tab (StNews), not in the main feed
  'story:resolved': (e) => ({ text: e.text, severity: e.outcome === 'granted' ? 'good' : 'info', tier: 'info', icon: '🎿', key: `story:${e.guestId}`, category: 'milestone', focus: xy(e.x, e.y) }),
  'building:placed': 'ignored', 'building:removed': 'ignored', 'path:drawn': 'ignored', 'piste:painted': 'ignored', 'lift:built': 'ignored',
  'lift:opened': 'ignored', // see formatLiftOpened
  'lift:closed': (e, c) => ({ text: `${liftLabel(c, e.id)} closed. ${reasonText(e.reason)}`, severity: 'warn', tier: 'important', icon: '🚡', key: `lift:closed:${e.id}`, category: 'closure', focus: at(c, 'lift', e.id) }),
  'attraction:opened': (e, c) => ({ text: `${displayName(e.type)} opened`, severity: 'good', tier: 'info', icon: '🎡', key: `attr:open:${e.id}`, category: 'closure', focus: at(c, 'building', e.id) }),
  'attraction:closed': (e, c) => {
    const kind = seasonalKind(e.reason), name = displayName(e.type), text = `${name} closed. ${reasonText(e.reason)}`;
    if (!kind) return { text, severity: 'warn', tier: 'important', icon: '🎡', key: `attr:closed:${e.id}`, category: 'closure', focus: at(c, 'building', e.id) };
    // Seasonal: one news row per kind and day ('3 attractions closed: no snow'), grouped toast (see closureGrouper).
    const why = kind === 'snow' ? 'no snow' : kind === 'warm' ? 'too warm' : 'out of season';
    return { text, severity: 'warn', tier: 'important', icon: '🎡', key: `attr:closed:seasonal:${kind}`, category: 'closure', focus: at(c, 'building', e.id), seasonal: { id: e.id, name, kind }, many: (n) => `${n} attractions closed: ${why}` };
  },
  'piste:opened': (e) => (e.open
    ? { text: 'A piste opened', severity: 'good', tier: 'info', icon: '⛷️', key: 'piste:opened', category: 'closure', many: (n) => `${plural(n, 'piste')} opened` }
    : { text: 'A piste closed', severity: 'warn', tier: 'important', icon: '⛷️', key: 'piste:closed', category: 'closure', many: (n) => `${plural(n, 'piste')} closed` }),
  'weather:changed': (e) => {
    if (e.kind === 'heavySnow') return { text: 'Powder day! Heavy snowfall', severity: 'good', tier: 'info', icon: '❄️', key: 'weather:powder', category: 'weather' };
    if (e.kind === 'snow') return { text: e.previous === 'heavySnow' ? 'Snowfall eases' : 'Snowfall begins', severity: 'good', tier: 'trivial', icon: '🌨️', key: 'weather:snow', category: 'weather' };
    if (e.kind === 'storm') return { text: 'Storm warning', severity: 'bad', tier: 'important', icon: '⛈️', key: 'weather:storm', category: 'weather' };
    if (e.kind === 'rain' && (e.previous === 'snow' || e.previous === 'heavySnow')) return { text: 'Thaw: rain is melting the snow', severity: 'warn', tier: 'info', icon: '🌧️', key: 'weather:thaw', category: 'weather' };
    if (e.kind === 'rain') return { text: 'Rain', severity: 'info', tier: 'trivial', icon: '🌧️', key: 'weather:rain', category: 'weather' };
    return { text: e.kind === 'clear' ? 'Skies clear' : 'Clouds roll in', severity: 'info', tier: 'trivial', icon: e.kind === 'clear' ? '☀️' : '☁️', key: `weather:${e.kind}`, category: 'weather' };
  },
  'money:changed': 'ignored', // far too frequent; finance news comes from monthClosed / loan / bankruptcy events
  'loan:taken': (e, c) => ({ text: `Loan taken: ${money(c, e.amount)} at ${e.rate}% (debt ${money(c, e.total)})`, severity: 'info', tier: 'important', icon: '🏦', key: 'loan:taken', category: 'finance' }),
  'speed:changed': 'ignored',
  'season:changed': (e) => ({ text: `${e.season[0]!.toUpperCase()}${e.season.slice(1)} has begun`, severity: 'info', tier: 'info', icon: '🗓️', key: `season:${e.season}`, category: 'weather' }),
  'incident:avalanche': (e, c) => {
    if (e.quiet) return null;
    const w = place(c, e.x, e.y), loc = xy(e.x, e.y);
    if (e.controlled) return { text: `Avalanche control blast released a slide ${w.on}`, severity: 'info', tier: 'info', icon: '🏔️', key: 'avalanche:control', category: 'incident', focus: loc, counter: 'avalancheControl' };
    if (e.buried) return { text: `Avalanche ${w.on} – ${plural(e.buried, 'skier')} trapped in the snow`, severity: 'bad', tier: 'critical', icon: '🏔️', key: 'avalanche:buried', category: 'incident', focus: loc };
    return { text: `Avalanche ${w.on}; pistes closed`, severity: 'warn', tier: 'important', icon: '🏔️', key: 'avalanche:slide', category: 'incident', focus: loc };
  },
  'incident:wildlife': (e, c) => {
    const w = place(c, e.x, e.y), loc = xy(e.x, e.y), an = e.animal ?? e.kind, A = `${an[0]!.toUpperCase()}${an.slice(1)}`;
    return e.outcome === 'attack' ? { text: `A ${an} attacked a guest ${w.near}`, severity: 'bad', tier: 'critical', icon: '🐻', key: 'wildlife:attack', category: 'incident', focus: loc }
      : e.outcome === 'deterred' ? { text: `${A} deterred ${w.near}`, severity: 'info', tier: 'info', icon: '🐺', key: 'wildlife:deterred', category: 'incident', focus: loc, counter: 'wildlife' }
        : { text: `${A} spotted ${w.near}`, severity: 'info', tier: 'info', icon: '🐾', key: 'wildlife:sighting', category: 'incident', focus: loc, counter: 'wildlife' };
  },
  'wildlife:scare': (e, c) => {
    const w = place(c, e.x, e.y), an = e.animal, loc = xy(e.x, e.y);
    return e.guests >= 4
      ? { text: `A ${an} is roaming near ${e.areaName || w.name}: hikers are avoiding the area`, severity: 'warn', tier: 'important', icon: '🐻', key: `wildlife:scare:${e.id}`, category: 'incident', focus: loc, counter: 'wildlife' }
      : { text: `A ${an} scared ${plural(e.guests, 'guest')} near ${e.areaName || w.name}`, severity: 'info', tier: 'info', icon: '🐾', key: `wildlife:scare:${e.id}`, category: 'incident', focus: loc, counter: 'wildlife' };
  },
  'wildlife:hazed': (e) => ({ text: `Rangers hazed a ${e.animal} away from guests`, severity: 'good', tier: 'trivial', icon: '🧑‍🌾', key: 'wildlife:hazed', category: 'incident', focus: xy(e.x, e.y), counter: 'wildlife' }),
  'wildlife:relocated': (e, c) => ({ text: `Rangers relocated a ${e.animal} away from ${place(c, e.x, e.y).name} (${money(c, e.cost)})`, severity: 'good', tier: 'important', icon: '🐻', key: 'wildlife:relocated', category: 'incident', focus: xy(e.toX, e.toY) }),
  'ops:grooming': (e) => (e.tiles > 0 ? { text: `Grooming done: ${e.vehicles} snowcat${e.vehicles === 1 ? '' : 's'}, ${e.tiles} tiles`, severity: 'info', tier: 'trivial', icon: '🚜', key: 'grooming', category: 'ops', counter: 'grooming' } : null),
  'incident:injury': (e) => ({ text: 'A guest was injured on the slopes', severity: 'warn', tier: 'trivial', icon: '🤕', key: 'injury', category: 'incident', focus: xy(e.x, e.y, 'guest', e.guestId), counter: 'injuries' }),
  'incident:created': (e, c) => (e.severity >= 1
    ? { text: `${e.severity >= 2 ? 'Critical' : 'Serious'} incident: ${INCIDENT_KIND_TEXT[e.kind] ?? e.kind} ${place(c, e.x, e.y).on}`, severity: e.severity >= 2 ? 'bad' : 'warn', tier: e.severity >= 2 ? 'critical' : 'important', icon: '🚨', key: `incident:${e.kind}:${e.severity}`, category: 'incident', focus: xy(e.x, e.y, 'guest', e.guestId) }
    : null),
  'incident:resolved': (e) => {
    if (e.outcome === 'left') return null;
    if (e.severe) return { text: 'A guest needed hospital care after waiting too long for help. Build more patrol/helicopter coverage.', severity: 'bad', tier: 'critical', icon: '🏥', key: 'incident:severe', category: 'incident' };
    if (e.outcome === 'evacuated') return { text: 'Guests evacuated safely', severity: 'good', tier: 'info', icon: '🚑', key: 'rescue:evacuated', category: 'incident', counter: 'rescues' };
    const verb = e.kind === 'buried' ? 'Dug out' : e.outcome === 'hospitalised' ? 'Hospitalised' : 'Rescued';
    return { text: `${verb} (${e.responder}, ${e.outcome})`, severity: 'good', tier: 'info', icon: '🚑', key: `rescue:${e.responder}`, category: 'incident', counter: 'rescues' };
  },
  'incident:escalated': () => ({ text: 'Helicopter called for a critical incident', severity: 'warn', tier: 'important', icon: '🚁', key: 'incident:heli', category: 'incident' }),
  'finance:bankruptcyWarning': (e, c) => ({ text: `Bankruptcy warning: cash ${money(c, e.money)}, ${e.daysLeft} days left`, severity: e.daysLeft <= 7 ? 'bad' : 'warn', tier: e.daysLeft <= 7 ? 'critical' : 'important', icon: '⚠️', key: 'bankruptcy:warn', category: 'finance' }),
  'finance:bankrupt': (e, c) => ({ text: `Bankrupt! Cash ${money(c, e.money)}`, severity: 'bad', tier: 'critical', icon: '💥', key: 'bankrupt', category: 'finance' }),
  'finance:monthClosed': (e, c) => ({ text: `${MONTHS[e.month] ?? 'Month'} closed: ${e.net >= 0 ? '+' : '-'}${money(c, Math.abs(e.net))} net`, severity: e.net >= 0 ? 'good' : 'warn', tier: 'important', icon: '📒', key: 'month:closed', category: 'finance' }),
  'finance:debtWarning': (e, c) => ({ text: `In debt: cash ${money(c, e.money)} (${e.negDays} days negative)`, severity: e.level >= 2 ? 'bad' : 'warn', tier: e.level >= 2 ? 'critical' : 'important', icon: '⚠️', key: `debt:${e.level}`, category: 'finance' }),
  'finance:declaredBankrupt': (e, c) => ({ text: `Bankruptcy ${e.reason === 'auto' ? 'forced by the bank' : 'declared'}. Cash ${money(c, e.money)}`, severity: 'bad', tier: 'critical', icon: '💥', key: 'bankrupt:declared', category: 'finance' }),
  'lift:broken': (e, c) => ({ text: `${liftLabel(c, e.id)} broke down${e.stranded ? ` (${plural(e.stranded, 'guest')} stranded)` : ''}`, severity: 'bad', tier: e.stranded ? 'critical' : 'important', icon: '🔧', key: `lift:broken:${e.id}`, category: 'incident', focus: at(c, 'lift', e.id) }),
  'lift:repaired': (e, c) => ({ text: `${liftLabel(c, e.id)} repaired after ${e.hours} h`, severity: 'good', tier: 'info', icon: '🔧', key: `lift:repaired:${e.id}`, category: 'incident', focus: at(c, 'lift', e.id) }),
  'incident:stranded': (e, c) => ({ text: `${plural(e.guests, 'guest')} stuck on ${liftLabel(c, e.liftId)}`, severity: 'warn', tier: 'important', icon: '🚠', key: `stranded:${e.liftId}`, category: 'incident', focus: xy(e.x, e.y, 'lift', e.liftId) }),
  'ops:schedule': () => null,
  'ops:serviceSoon': (e) => ({ text: `Lift service starts tomorrow: ${plural(e.count, 'lift')} closed for ~${e.days} days in ${REAL_MONTHS[e.month] ?? 'the next month'}`, severity: 'info', tier: 'important', icon: '🛠️', key: 'lift:serviceSoon', category: 'incident' }),
  'lift:serviceStarted': 'ignored', // announced the day before; the lift status says "service"
  'lift:serviced': (e, c) => ({ text: `${liftLabel(c, e.id)} serviced (${e.days} d): condition ${Math.round(e.condition)}%`, severity: 'good', tier: 'info', icon: '🛠️', key: `lift:serviced:${e.id}`, category: 'incident', focus: at(c, 'lift', e.id) }),
  'lift:serviceOverdue': (e, c) => ({ text: `${liftLabel(c, e.id)} service ${e.level === 'critical' ? 'long overdue' : 'overdue'} (${e.days} d late): breakdowns more likely`, severity: e.level === 'critical' ? 'bad' : 'warn', tier: 'important', icon: '🛠️', key: `lift:serviceOverdue:${e.id}`, category: 'incident', focus: at(c, 'lift', e.id) }),
  'scenario:objective': (e) => ({ text: `Objective complete: ${e.title}`, severity: 'good', tier: 'info', icon: '✔️', key: `scenario:${e.id}`, category: 'milestone' }),
  'scenario:finished': 'ignored', // the result dialog covers it
  'milestone': (e) => ({ text: e.major ? `Milestone: ${e.title}` : e.title, severity: 'good', tier: e.major ? 'important' : 'info', icon: e.major ? '🏁' : '✔️', key: `milestone:${e.id}`, category: 'milestone' }),
  'marketing:started': (e, c) => ({ text: `Campaign started: ${e.name} (${money(c, e.cost)}, ${e.days} days)`, severity: 'info', tier: 'important', icon: '📣', key: `marketing:${e.id}`, category: 'finance' }),
  'marketing:cancelled': (e) => ({ text: `Campaign cancelled: ${e.name}. ${sentence(e.reason)}`, severity: 'warn', tier: 'important', icon: '📣', key: `marketing:cancel:${e.id}`, category: 'finance' }),
  'marketing:ended': (e) => ({ text: `Campaign ended: ${e.name}${e.uplift === null ? '' : ` (${e.uplift >= 0 ? '+' : ''}${e.uplift} guests vs baseline)`}`, severity: e.uplift !== null && e.uplift > 0 ? 'good' : 'info', tier: 'important', icon: '📣', key: `marketing:end:${e.id}`, category: 'finance' }),
  'rating:changed': (e) => ({
    text: `Resort rating ${e.stars > e.previous ? 'rose' : 'fell'} to ${e.stars}★. ${e.reason}`, severity: e.stars > e.previous ? 'good' : 'warn', tier: 'important', icon: '⭐', key: 'rating', category: 'rating',
  }),
  'day:changed': 'ignored', 'month:changed': 'ignored', 'year:changed': 'ignored', 'year:report': 'ignored', 'time:hour': 'ignored',
  'family:dropoff': 'ignored', 'family:regroup': 'ignored', 'lesson:started': 'ignored', 'lesson:finished': 'ignored',
};

/** Compile-time + runtime exhaustiveness helper (tests iterate GAME_EVENT_NAMES). */
export const isFormatted = (n: GameEventName): boolean => NEWS_FORMATTERS[n] !== 'ignored';
export const NEWS_EVENT_NAMES = GAME_EVENT_NAMES;

/** Sink point: sentence-case the text, drop an unresolved focus and mirror `focus` into `loc`. */
function finish(it: NewsItem | null): NewsItem | null {
  if (!it) return it;
  it.text = sentence(it.text);
  if (it.many) { const m = it.many; it.many = (n) => sentence(m(n)); }
  if (!it.focus) delete it.focus;
  if (it.focus) it.loc = { x: it.focus.x, y: it.focus.y };
  return it;
}

export function formatEvent<K extends GameEventName>(name: K, payload: GameEvents[K], ctx: NewsCtx = {}): NewsItem | null {
  const f = NEWS_FORMATTERS[name] as Formatter<K> | 'ignored';
  return f === 'ignored' ? null : finish(f(payload, ctx));
}

/** Events whose message carries no single place to look at (explicit, enforced by tests; everything else must give a `focus`). */
export const NON_SPATIAL_EVENTS: ReadonlySet<GameEventName> = new Set<GameEventName>([
  'guest:arrived', 'guest:left', 'guest:review', 'building:placed', 'building:removed', 'path:drawn', 'piste:painted', 'lift:built', 'lift:opened', 'piste:opened',
  'weather:changed', 'money:changed', 'loan:taken', 'speed:changed', 'season:changed', 'ops:grooming', 'incident:resolved', 'incident:escalated',
  'finance:bankruptcyWarning', 'finance:bankrupt', 'finance:debtWarning', 'finance:declaredBankrupt', 'ops:schedule', 'ops:serviceSoon', 'lift:serviceStarted', 'finance:monthClosed', 'rating:changed',
  'day:changed', 'month:changed', 'year:changed', 'year:report', 'time:hour', 'family:dropoff', 'family:regroup', 'lesson:started', 'lesson:finished', 'marketing:started', 'marketing:ended', 'marketing:cancelled', 'milestone', 'scenario:objective', 'scenario:finished',
]);

/** Counts arrivals and yields a milestone item at 100 / 500 / 1,000 / 2,500 guests (first time only). */
export class MilestoneTracker {
  private n = 0;
  constructor(private marks: readonly number[] = [100, 500, 1000, 2500]) {}
  arrived(): NewsItem | null {
    this.n++;
    if (!this.marks.includes(this.n)) return null;
    return { text: `Milestone: ${this.n.toLocaleString('en-US')} guests have visited!`, severity: 'good', tier: 'important', icon: '🎉', key: `milestone:${this.n}`, category: 'milestone' };
  }
  get total(): number { return this.n; }
}

/** Is a guest-visible lift reopening interesting enough for the feed? (lift:opened true) */
export function formatLiftOpened(e: GameEvents['lift:opened'], c: NewsCtx = {}): NewsItem | null {
  return e.open ? finish({ text: `${liftLabel(c, e.id)} opened`, severity: 'good', tier: 'info', icon: '🚡', key: `lift:open:${e.id}`, category: 'closure', focus: at(c, 'lift', e.id) }) : null;
}
