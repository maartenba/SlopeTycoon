import type { FocusTarget, SeasonalClosure } from './newsFormat';

export interface ClosureGroup { text: string; focus?: FocusTarget; count: number }
interface Entry { id: number; name: string; kind: SeasonalClosure['kind']; focus?: FocusTarget; text: string }

/**
 * Seasonal closures ('no snow', 'too warm', closed for the season) are expected, not surprises. Pure + time-injected:
 *  - closures arriving within `windowMs` of the first one are collected and flushed as ONE toast ('3 winter attractions closed for summer: A, B, C');
 *  - each attraction toasts once per season (re-closing the next day stays silent); a season change resets that;
 *  - breakdowns, storms and avalanches never come through here.
 */
export class SeasonalClosureGrouper {
  private pending: Entry[] = [];
  private since = -1;
  private seen = new Set<number>();
  private season = '';
  constructor(readonly windowMs = 4000) {}

  /** Returns false when this attraction already toasted in the current season (nothing to show). */
  add(c: SeasonalClosure & { text: string; focus?: FocusTarget }, season: string, now: number): boolean {
    if (season !== this.season) { this.season = season; this.seen.clear(); }
    if (this.seen.has(c.id)) return false;
    this.seen.add(c.id);
    if (!this.pending.length) this.since = now;
    this.pending.push({ id: c.id, name: c.name, kind: c.kind, text: c.text, ...(c.focus ? { focus: c.focus } : {}) });
    return true;
  }

  /** The group to toast once the window has elapsed (or immediately with `force`), else null. */
  flush(now: number, force = false): ClosureGroup | null {
    if (!this.pending.length || (!force && now - this.since < this.windowMs)) return null;
    const list = this.pending; this.pending = [];
    const first = list[0]!;
    if (list.length === 1) return { text: first.text, ...(first.focus ? { focus: first.focus } : {}), count: 1 };
    const winter = list.every((e) => e.kind === 'snow' || e.kind === 'warm') && this.season !== 'winter';
    const names = list.length > 4 ? `${list.slice(0, 3).map((e) => e.name).join(', ')} and ${list.length - 3} more` : list.map((e) => e.name).join(', ');
    const head = winter ? `${list.length} winter attractions closed for ${this.season}` : `${list.length} attractions closed for the season`;
    return { text: `${head}: ${names}`, ...(first.focus ? { focus: first.focus } : {}), count: list.length };
  }
  get waiting(): number { return this.pending.length; }
}
