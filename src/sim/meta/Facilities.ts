/**
 * Facilities facet of the rating (Phase 6 Task 8, docs/rating.md, docs/comfort.md). Pure: callers hand in plain data.
 * Score 0..100 = 45 % comfort satisfaction (share of the guests in the resort who are NOT desperate) + 25 % toilet cover of the open pistes
 * + 15 % cover of the village + 15 % facility-to-guest ratio. A toilet within `FACILITY.radius` tiles covers in full; a dining venue (it
 * restores part of the urge) covers at `venueCover`.
 */
export interface Pt { x: number; y: number }

export const FACILITY = {
  /** Walk radius (tiles) a toilet / venue covers. */
  radius: 20,
  /** Cover value of a dining venue where there is no toilet. */
  venueCover: 0.6,
  /** Guests one toilet block serves comfortably at the same time of day (the ratio term). */
  guestsPerToilet: 40,
  /** Urge above which a guest counts as desperate. */
  desperate: 0.8,
  weights: { satisfied: 0.45, pistes: 0.25, village: 0.15, ratio: 0.15 },
} as const;

export interface FacilityInput {
  toilets: Pt[];
  /** Active dining venues (partial cover). */
  venues: Pt[];
  lodge: Pt | null;
  /** Open piste tiles (callers may subsample: the cover is a share). */
  pisteTiles: Pt[];
  guests: { count: number; desperate: number };
  /** Toilet blocks that served more than the per-day figure today. */
  overrun: number;
}

export interface FacilityResult { score: number; hint: string; satisfied: number; pisteCover: number; villageCover: number; ratio: number }

const clamp = (v: number): number => Math.min(1, Math.max(0, v));

/** Cover of one point: 1 within a toilet radius, `venueCover` within a venue's, else 0. */
export function coverAt(p: Pt, toilets: readonly Pt[], venues: readonly Pt[]): number {
  const r2 = FACILITY.radius * FACILITY.radius;
  for (const t of toilets) if ((t.x - p.x) ** 2 + (t.y - p.y) ** 2 <= r2) return 1;
  for (const v of venues) if ((v.x - p.x) ** 2 + (v.y - p.y) ** 2 <= r2) return FACILITY.venueCover;
  return 0;
}

export function measureFacilities(i: FacilityInput): FacilityResult {
  const w = FACILITY.weights;
  const satisfied = i.guests.count >= 5 ? clamp(1 - i.guests.desperate / i.guests.count) : 0.8;
  const pisteCover = i.pisteTiles.length ? i.pisteTiles.reduce((a, p) => a + coverAt(p, i.toilets, i.venues), 0) / i.pisteTiles.length : 0.7;
  const villageCover = i.lodge ? coverAt(i.lodge, i.toilets, i.venues) : 0.7;
  const ratio = clamp((i.toilets.length * FACILITY.guestsPerToilet) / Math.max(FACILITY.guestsPerToilet, i.guests.count));
  const score = 100 * (w.satisfied * satisfied + w.pistes * pisteCover + w.village * villageCover + w.ratio * ratio);
  let hint = 'Well equipped';
  if (i.toilets.length === 0) hint = 'Build toilets near the village and the busy pistes';
  else if (satisfied < 0.8) hint = 'Guests are desperate for a toilet: add more';
  else if (i.overrun > 0) hint = 'Toilets are overrun: add more';
  else if (pisteCover < 0.5) hint = 'No toilets near the busiest pistes';
  else if (ratio < 0.5) hint = 'Too few toilets for this many guests';
  return { score: Math.round(score * 10) / 10, hint, satisfied, pisteCover, villageCover, ratio };
}
