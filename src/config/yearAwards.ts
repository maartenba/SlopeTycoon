/**
 * Resort of the Year awards (M5.3 Task 17): data-driven definitions, tier thresholds and the static regional baselines.
 * Every award has a ratio r = (your value) / (the benchmark): r >= 1 means "as good as the region's average resort".
 * Tiers are cut on r (see `tierOf`); the headline is cut on the share of the possible award points (`headlineOf`).
 * Rivals (Task 23) replace the static table by implementing {@link BaselineProvider}. How to tune: docs/year-report.md.
 */
export type AwardTier = 0 | 1 | 2 | 3; // none | bronze | silver | gold
export const TIER_NAMES = ['none', 'bronze', 'silver', 'gold'] as const;
export type TierName = (typeof TIER_NAMES)[number];

/** Minimum ratio for bronze / silver / gold (inclusive). */
export const TIER_RATIO = { bronze: 0.9, silver: 1.2, gold: 1.6 } as const;

/** Tier of a ratio. NaN / negative = none. The thresholds are inclusive. */
export function tierOf(ratio: number): AwardTier {
  if (!(ratio >= 0)) return 0;
  return ratio >= TIER_RATIO.gold ? 3 : ratio >= TIER_RATIO.silver ? 2 : ratio >= TIER_RATIO.bronze ? 1 : 0;
}

/** Headline cuts on points / max points (max = 3 per award that could be judged this year). */
export const HEADLINE_SHARE = { bronze: 0.22, silver: 0.4, gold: 0.62 } as const;
export type HeadlineTier = 'none' | 'bronze' | 'silver' | 'gold';
export function headlineOf(points: number, maxPoints: number): HeadlineTier {
  if (maxPoints <= 0) return 'none';
  const s = points / maxPoints;
  return s >= HEADLINE_SHARE.gold ? 'gold' : s >= HEADLINE_SHARE.silver ? 'silver' : s >= HEADLINE_SHARE.bronze ? 'bronze' : 'none';
}
export const HEADLINE_TEXT: Record<HeadlineTier, string> = {
  gold: 'Resort of the Year: Gold', silver: 'Resort of the Year: Silver', bronze: 'Resort of the Year: Bronze', none: 'A year on the mountain',
};

/** Benchmarks the awards compare against. `kind` says how the value is scaled by map size. */
export type BaselineMetric =
  | 'familyHappiness' | 'incidentsPer1000' | 'pisteQuality' | 'winterSkiable' | 'restaurantPerGuest'
  | 'summerIncome' | 'profitMargin' | 'wildlifeSightings' | 'guestGrowth';
export interface BaselineContext { mapSize: number; /** the year being judged */ year: number }
/** Source of the benchmark values. The default is the static table below; rivals take over in Task 23. */
export interface BaselineProvider { baseline(metric: BaselineMetric, ctx: BaselineContext): number }

/** Regional table for a 128 map. `scale`: 'area' = scales with the map's guest capacity, 'none' = size independent. */
export const REGIONAL_BASELINES: Record<BaselineMetric, { value: number; scale: 'area' | 'none' }> = {
  familyHappiness: { value: 0.34, scale: 'none' },   // family guest share (0..1) x mean happiness (0..1)
  incidentsPer1000: { value: 4, scale: 'none' },     // incidents per 1,000 guests (lower is better)
  pisteQuality: { value: 0.66, scale: 'none' },       // mean piste surface score 0..1
  winterSkiable: { value: 0.6, scale: 'none' },      // share of piste tiles open for skiing on winter days
  restaurantPerGuest: { value: 12, scale: 'none' },  // restaurant + bar revenue per arriving guest ($)
  summerIncome: { value: 70_000, scale: 'area' },     // income over the summer months ($) on a 128 map
  profitMargin: { value: 0.28, scale: 'none' },       // profit / income
  wildlifeSightings: { value: 6, scale: 'none' },     // sightings that did not turn into attacks
  guestGrowth: { value: 1.08, scale: 'none' },        // arrivals this year / last year
};

/** Static provider: the table above; 'area' values scale with (mapSize / 128)^0.5 (clamped 0.5..2). */
export class StaticBaselines implements BaselineProvider {
  baseline(metric: BaselineMetric, ctx: BaselineContext): number {
    const row = REGIONAL_BASELINES[metric];
    if (row.scale === 'none') return row.value;
    return row.value * Math.min(2, Math.max(0.5, (ctx.mapSize / 128) ** 0.5));
  }
}

/** Flat numbers for one judged year (derived from StatsHistory by YearReport). */
export interface YearMetrics {
  guests: number; familyShare: number; happiness: number; incidents: number; incidentsPer1000: number; pisteQuality: number | null;
  winterSkiable: number | null; restaurantRevenue: number; restaurantPerGuest: number; summerIncome: number; income: number; profit: number; margin: number;
  attacks: number; wildlifeSightings: number; guestGrowth: number | null;
}

export interface AwardDef {
  id: string; name: string; metric: BaselineMetric;
  /** The ratio (>= 0) or null when the award cannot be judged this year. */
  ratio(m: YearMetrics, base: number): number | null;
  /** Plain one-liner per tier (index 1..3); light humour is sparing (D4). */
  blurb: readonly [string, string, string];
  /** What counts, for the tooltip. */
  how: string;
}

const cap = (r: number): number => Math.max(0, Math.min(3, r));
export const AWARDS: readonly AwardDef[] = [
  { id: 'family', name: 'Best Family Resort', metric: 'familyHappiness', how: 'Family guest share x average happiness.',
    ratio: (m, b) => (m.guests < 20 ? null : cap((m.familyShare * m.happiness) / b)),
    blurb: ['Families came and mostly stayed.', 'Parents relaxed. Kids did not.', 'Hot chocolate sales were strong.'] },
  { id: 'safety', name: 'Safest Slopes', metric: 'incidentsPer1000', how: 'Incidents per 1,000 guests (fewer is better).',
    ratio: (m, b) => (m.guests < 20 ? null : cap(b / Math.max(0.05 * b, m.incidentsPer1000))),
    blurb: ['Few incidents, quickly handled.', 'The patrol had a quiet year.', 'Plasters stayed in the drawer.'] },
  { id: 'pistes', name: 'Best Piste Quality', metric: 'pisteQuality', how: 'Average surface score of your pistes.',
    ratio: (m, b) => (m.pisteQuality === null ? null : cap(m.pisteQuality / b)),
    blurb: ['Good surfaces most days.', 'Well groomed from top to bottom.', 'Corduroy that guests wrote home about.'] },
  { id: 'snow', name: 'Snow-Sure Resort', metric: 'winterSkiable', how: 'Proportion of piste tiles open for skiing on winter days.',
    ratio: (m, b) => (m.winterSkiable === null ? null : cap(m.winterSkiable / b)),
    blurb: ['Snow on most winter days.', 'Reliable snow all winter.', 'Winter never let you down.'] },
  { id: 'gourmet', name: 'Gourmet Mountain', metric: 'restaurantPerGuest', how: 'Restaurant and bar revenue per arriving guest.',
    ratio: (m, b) => (m.guests < 20 ? null : cap(m.restaurantPerGuest / b)),
    blurb: ['Guests ate well.', 'Full tables at lunchtime.', 'Worth the walk for the soup alone.'] },
  { id: 'summer', name: 'Summer Star', metric: 'summerIncome', how: 'Income over the summer months, scaled to the map.',
    ratio: (m, b) => cap(m.summerIncome / b),
    blurb: ['Summer paid its share.', 'Green slopes, busy tills.', 'Who needs snow?'] },
  { id: 'efficient', name: 'Efficient Operator', metric: 'profitMargin', how: 'Profit as a share of income.',
    ratio: (m, b) => (m.income <= 0 ? null : cap(Math.max(0, m.margin) / b)),
    blurb: ['The books balanced.', 'Costs under control.', 'Tight budget, wide smiles.'] },
  { id: 'wildlife', name: 'Wildlife Friendly', metric: 'wildlifeSightings', how: 'No wildlife attacks, plus sightings of animals living nearby.',
    ratio: (m, b) => (m.attacks > 0 ? 0 : cap(0.95 + 0.65 * Math.min(1, m.wildlifeSightings / b))),
    blurb: ['No attacks on the books.', 'Bears and guests kept their distance.', 'The marmots approve.'] },
  { id: 'rising', name: 'Rising Star', metric: 'guestGrowth', how: 'Guest arrivals compared with the year before.',
    ratio: (m, b) => (m.guestGrowth === null ? null : cap(1 + (m.guestGrowth - b) * 2.5)),
    blurb: ['More guests than last year.', 'Word is getting around.', 'The car park is a talking point.'] },
];
