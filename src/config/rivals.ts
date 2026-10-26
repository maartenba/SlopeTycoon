/**
 * Rival resorts, market share and the sustainability facet (M5.4 Task 23, D7). Data + tuning only; logic in `sim/meta/Rivals.ts` and
 * `sim/meta/Sustainability.ts`. Rationale and numbers: docs/rivals.md, docs/rating.md.
 */

/** Rival name parts (a name = one prefix + one suffix, drawn from the map seed). */
export const RIVAL_PREFIXES = ['Silberhorn', 'Gletscher', 'Almrausch', 'Edelweiss', 'Steinbock', 'Kaiserwald', 'Zirbenhof', 'Murmeltal', 'Hochjoch', 'Lärchenwiese'] as const;
export const RIVAL_SUFFIXES = ['Ski Area', 'Resort', 'Peaks', 'Lifts', 'Snowfields'] as const;

export const RIVALS = {
  /** 2 or 3 rivals, chosen from the seed. */
  minCount: 2, maxCount: 3,
  /** A rival's long-run star level is drawn from this range; it improves a little every year up to `capStars`. */
  starsRange: [3.0, 4.0] as const, yearlyGain: 0.1, capStars: 4.6,
  /** Day-pass price ratio (1 = fair) of a rival, drawn from this range; wobbles a little each month. */
  priceRange: [0.9, 1.15] as const,
  /** Monthly (every 15 days) step: pull toward the long-run level, plus noise (stars). */
  pull: 0.25, noise: 0.18,
  /** Multinomial-logit utility of a resort: `starSlope x (stars - 3) - priceSlope x (priceRatio - 1)`. */
  starSlope: 0.9, priceSlope: 1.2,
  /** Arrival multiplier = 1 + gain x (share / fair share - 1), clamped to [min, max]. Exactly 1 inside the grace period and in scenarios / tutorial. */
  gain: 0.25, min: 0.9, max: 1.12,
  /** Days of a new game with no market effect at all, then a linear ramp to full strength. */
  graceDays: 30, rampDays: 150,
  /** News: at most one rival item per this many days; only when the leader changes (restrained). */
  newsEveryDays: 90,
} as const;

export const SUSTAIN = {
  /** Facet weights inside the sustainability score (sum 1). */
  weights: { energy: 0.4, trees: 0.3, habitat: 0.3 } as const,
  /** Energy: dollars of energy + snowmaking per guest (rolling; guests = the larger of the day's arrivals and the guests present at noon). Score 1 at <= `good`, 0 at >= `bad`. */
  energy: { good: 2, bad: 12, decay: 0.06 },
  /** Trees: net share of the original forest lost (felled - planted). `allowance` is free (every resort has to build somewhere); 0 at allowance + span. */
  trees: { allowance: 0.03, span: 0.18 },
  /** Habitat: share of forest-habitat tiles that carry a piste / trail / path / road / building / lift. `free` is not punished; 0 at free + span. */
  habitat: { forestMin: 64, free: 0.06, span: 0.2, /** how much of the overlap a trained rangers crew takes off */ protection: 0.5 },
  /** Neutral energy score while there are no guests to measure against. */
  idleEnergy: 0.7,
} as const;
