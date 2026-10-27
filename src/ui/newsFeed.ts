import type { CounterId, NewsItem, Tier } from './newsFormat';
import { dayOfYearLabel } from '../sim/calendar';
import { TIER_RANK } from './newsFormat';

/** Feed filter: 'important' (default) shows important + critical, 'critical' only critical, 'all' also info rows (digests, sightings...). */
export type FeedFilter = 'all' | 'important' | 'critical';
export const FEED_FILTERS: readonly FeedFilter[] = ['all', 'important', 'critical'];
const FILTER_MIN: Record<FeedFilter, number> = { all: TIER_RANK.info, important: TIER_RANK.important, critical: TIER_RANK.critical };

export interface FeedRow extends NewsItem {
  id: number;
  stamp: string;
  /** Absolute in-game day the row (first) happened on. */
  day: number;
  count: number;
  /** Text of the first occurrence (`many` rewrites `text` when count > 1). */
  baseText: string;
}

export type FeedResult = 'row' | 'coalesced' | 'counted' | 'muted';
export type Counters = Record<CounterId, number>;
const zero = (): Counters => ({ arrived: 0, left: 0, rescues: 0, injuries: 0, grooming: 0, wildlife: 0, avalancheControl: 0 });

export interface FeedOpts {
  maxRows?: number;
  muted?: () => ReadonlySet<string>;
  stamp?: () => string;
}

/**
 * Pure news feed model (no DOM, no wall clock: time is the in-game day). Rules:
 *  - trivial items and per-guest events only increment digest counters;
 *  - identical keys coalesce into one row (×N) within the same in-game day (cooldown: one row per kind per day, one per piste/lift via the key);
 *  - muted categories hide rows (critical items are never muted); counters still count;
 *  - at most `maxRows` (30) rows are kept, evicting the lowest tier / oldest first;
 *  - a daily digest row ('Day 12: 34 guests arrived, 12 left') and a weekly summary replace per-event rows.
 */
export class NewsFeed {
  private list: FeedRow[] = [];
  private nextId = 1;
  private week = zero();
  today = zero();
  readonly maxRows: number;
  constructor(private o: FeedOpts = {}) { this.maxRows = o.maxRows ?? 30; }

  get rows(): readonly FeedRow[] { return this.list; }

  push(item: NewsItem, day: number): FeedResult {
    if (item.counter) { this.today[item.counter]++; this.week[item.counter]++; }
    if (item.tier === 'trivial') return 'counted';
    if (item.tier !== 'critical' && item.severity !== 'bad' && this.o.muted?.().has(item.category)) return 'muted';
    const dup = this.list.find((r) => r.key === item.key && r.day === day);
    if (dup) {
      dup.count++;
      if (dup.many) dup.text = dup.many(dup.count);
      if (TIER_RANK[item.tier] > TIER_RANK[dup.tier]) dup.tier = item.tier;
      return 'coalesced';
    }
    this.list.unshift({ ...item, id: this.nextId++, stamp: this.o.stamp?.() ?? '', day, count: 1, baseText: item.text });
    this.trim();
    return 'row';
  }

  /** Call once per new in-game day (absolute day index): emits the digest of the day that just ended. Returns the digest row (if any). */
  newDay(day: number, dayOfYear: number): FeedRow | null {
    const t = this.today;
    this.today = zero();
    const text = digestText(t, dayOfYear);
    let row: FeedRow | null = null;
    if (text) {
      this.list.unshift(row = { text, severity: 'info', tier: 'info', icon: '🗒️', key: 'digest:day', category: 'milestone', id: this.nextId++, stamp: this.o.stamp?.() ?? '', day, count: 1, baseText: text });
      this.trim();
    }
    if (day > 0 && day % 7 === 0) {
      const w = this.week; this.week = zero();
      const wt = digestText(w, -1);
      if (wt) { this.list.unshift({ text: `Week summary: ${wt}`, severity: 'info', tier: 'important', icon: '📆', key: 'digest:week', category: 'milestone', id: this.nextId++, stamp: this.o.stamp?.() ?? '', day, count: 1, baseText: wt }); this.trim(); }
    }
    return row;
  }

  visible(filter: FeedFilter): FeedRow[] {
    const min = FILTER_MIN[filter];
    return this.list.filter((r) => TIER_RANK[r.tier] >= min);
  }

  clear(): void { this.list = []; }

  private trim(): void {
    while (this.list.length > this.maxRows) {
      let victim = this.list.length - 1; // oldest
      let low: Tier = this.list[victim]!.tier;
      for (let i = this.list.length - 1; i >= 0; i--) if (TIER_RANK[this.list[i]!.tier] < TIER_RANK[low]) { low = this.list[i]!.tier; victim = i; }
      this.list.splice(victim, 1);
    }
  }
}

/** 'Dec 12: 34 guests arrived, 12 left, 5 rescues' (null when nothing happened). `dayOfYear` < 0 omits the prefix. */
export function digestText(c: Counters, dayOfYear: number): string | null {
  const parts: string[] = [];
  if (c.arrived) parts.push(`${c.arrived} guest${c.arrived === 1 ? '' : 's'} arrived`);
  if (c.left) parts.push(`${c.left} left`);
  if (c.rescues) parts.push(`Rescues: ${c.rescues}`);
  if (c.injuries) parts.push(`${c.injuries} injur${c.injuries === 1 ? 'y' : 'ies'}`);
  if (c.wildlife) parts.push(`${c.wildlife} wildlife sighting${c.wildlife === 1 ? '' : 's'}`);
  if (c.avalancheControl) parts.push(`${c.avalancheControl} avalanche control${c.avalancheControl === 1 ? '' : 's'}`);
  if (c.grooming) parts.push(`${c.grooming} grooming run${c.grooming === 1 ? '' : 's'}`);
  if (!parts.length) return null;
  return `${dayOfYear >= 0 ? `${dayOfYearLabel(dayOfYear)}: ` : ''}${parts.join(', ')}`;
}

/** Review tab filter: all / at most 2 stars / at least 4 stars. */
export type ReviewFilter = 'all' | 'low' | 'high';
export const REVIEW_FILTERS: readonly ReviewFilter[] = ['all', 'low', 'high'];
export interface ReviewRow { id: number; stamp: string; stars: number; text: string; tone: 'plain' | 'light'; driver: string; guestId: number; loc?: { x: number; y: number } }
export const MAX_REVIEWS = 100;

/** Bounded (ring buffer, newest first) list of guest reviews. Separate from the news rows: reviews never reach toasts or the importance tiers. */
export class ReviewFeed {
  private list: ReviewRow[] = [];
  private nextId = 1;
  constructor(readonly max = MAX_REVIEWS) {}
  get rows(): readonly ReviewRow[] { return this.list; }
  add(r: { guestId: number; stars: number; text: string; tone: 'plain' | 'light'; driver: string; x?: number; y?: number }, stamp = ''): ReviewRow {
    const row: ReviewRow = { id: this.nextId++, stamp, stars: r.stars, text: r.text, tone: r.tone, driver: r.driver, guestId: r.guestId, ...(r.x !== undefined && r.y !== undefined ? { loc: { x: r.x, y: r.y } } : {}) };
    this.list.unshift(row);
    if (this.list.length > this.max) this.list.length = this.max;
    return row;
  }
  visible(f: ReviewFilter): ReviewRow[] { return f === 'low' ? this.list.filter((r) => r.stars <= 2) : f === 'high' ? this.list.filter((r) => r.stars >= 4) : [...this.list]; }
  clear(): void { this.list = []; }
}
