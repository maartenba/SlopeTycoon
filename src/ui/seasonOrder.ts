import type { SeasonId } from '@/core/events';

/** When a thing is useful: all year, the ski season (winter), the summer season, or snow-free ground (spring to autumn). */
export type SeasonTag = 'all' | 'winter' | 'summer' | 'shoulder';
/** now: usable this season; later: not yet / not strictly in season but never dimmed (spring, autumn); off: unusable until another season. */
export type Relevance = 'now' | 'later' | 'off';
/** Drawer ordering mode: 'now' = in-season first (off-season last, dimmed); 'all' = the original catalog order. */
export type SeasonMode = 'now' | 'all';

/**
 * Relevance of a season tag in the current season.
 * Winter: winter + all are 'now', summer/shoulder are 'off'. Summer: summer + shoulder + all are 'now', winter is 'off'.
 * Spring/autumn are transitional (skiing may still run, hiking starts): nothing is 'off'; the tag of the upcoming season is 'now'
 * (build ahead), the other 'later'; shoulder items count as 'now'.
 */
export function relevance(tag: SeasonTag, season: SeasonId): Relevance {
  if (tag === 'all') return 'now';
  if (season === 'winter') return tag === 'winter' ? 'now' : 'off';
  if (season === 'summer') return tag === 'winter' ? 'off' : 'now';
  if (tag === 'shoulder') return 'now';
  const upcoming: SeasonTag = season === 'autumn' ? 'winter' : 'summer';
  return tag === upcoming ? 'now' : 'later';
}

const RANK: Record<Relevance, number> = { now: 0, later: 1, off: 2 };

/** Stable sort by relevance ('now' mode); 'all' mode returns the input order unchanged. Pure. */
export function seasonSort<T>(items: readonly T[], tagOf: (t: T) => SeasonTag, season: SeasonId, mode: SeasonMode): T[] {
  if (mode === 'all') return items.slice();
  return items.map((t, i) => ({ t, i, r: RANK[relevance(tagOf(t), season)] })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.t);
}

/** Season a tag next becomes usable in (summer items: summer; snow-free 'shoulder' items: spring), for 'Mostly used from summer on' hints; null when usable now. */
export function usableFrom(tag: SeasonTag, season: SeasonId): string | null {
  if (relevance(tag, season) !== 'off') return null;
  return tag === 'winter' ? 'winter' : tag === 'shoulder' ? 'spring' : 'summer';
}

/** Badge text of an off-season item ('Summer' / 'Winter'); null when not off-season. */
export function seasonBadge(tag: SeasonTag, season: SeasonId): 'Summer' | 'Winter' | null {
  if (relevance(tag, season) !== 'off') return null;
  return tag === 'winter' ? 'Winter' : 'Summer';
}
