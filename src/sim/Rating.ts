import type { GameBus } from '../core/events';
import type { GameState } from '../core/GameState';
import { DAYS_PER_YEAR } from '../config/balance';
import { DEBT } from '../config/prices';
import type { SimSystem } from './Systems';

/** Plain-data snapshot of everything the rating reads (gathered by RatingInputs adapters; tests feed it directly). */
export interface RatingInput {
  guests: { count: number; avgHappiness: number; /** share (0..1) of recent leavers that left 'satisfied'; -1 = unknown */ recentSatisfied: number };
  safety: { penalty: number; open: number; unresolved: number; meanResponseTicks: number; severe: number; patrolHubs: number; /** 0..1 recent wildlife scares (bears frightening guests); optional. */ wildlife?: number };
  variety: {
    attractionTypes: number; liftKinds: number;
    /** Open piste tiles per difficulty (green, blue, red, black). */
    pisteTiles: [number, number, number, number];
    /** 0..1 coverage of what the current season should offer (snow runs in winter, trails in summer). */
    seasonal: number;
  };
  pisteQuality: { goodShare: number; icyShare: number; tiles: number };
  queues: { meanWaitTicks: number; worst: { name: string; waitTicks: number } | null };
  /** Mean number of guests sharing a spatial-hash cell with a guest (crowding). */
  crowding: { avgNeighbours: number };
  /** Value for money 0..1 (0.5 neutral); stub until pricing (Task 32). */
  value: number;
  amenities: { restaurants: number; lodgingCapacity: number; lodgingDemand: number };
  openLifts: number;
  /** Optional 0..1 nature/scenery score (forest cover, wildlife, livestock); adds up to +2 rating points. */
  scenery?: number;
  /** 0..1 debt severity (0 = solvent); optional. */
  debt?: number;
  /** Sustainability facet (Task 23): score 0..100 + the hint of its weakest part. Absent (older tests, headless snapshots) = the facet is left out and the other weights are renormalised. */
  sustainability?: { score: number; hint: string };
}

/** Component hints that are good news, not advice (the advisor never shows them as a to-do). */
export const POSITIVE_HINTS: ReadonlySet<string> = new Set(['Guests are happy', 'Safe resort', 'Great variety', 'Pistes in good shape', 'Short queues', 'Comfortable', 'Fair prices', 'Gentle on the mountain']);

export interface RatingComponent { id: string; label: string; score: number; weight: number; hint: string }
export interface RatingBreakdown { score: number; stars: number; components: RatingComponent[]; bonus: number; bonusHints: string[]; hints: string[] }

const clamp = (v: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, v));
/**
 * Component weights (sum 1). Task 23 added `sustainability` (8 %) and renormalised the rest: old x 0.92 rounded to hundredths
 * (happiness .25 -> .23, safety .20 -> .18, variety .15 -> .14, pisteQuality .12 -> .11, queues .12 -> .11, crowding .04, value .12 -> .11). See docs/rating.md.
 */
export const WEIGHTS = { happiness: 0.23, safety: 0.18, variety: 0.14, pisteQuality: 0.11, queues: 0.11, crowding: 0.04, value: 0.11, sustainability: 0.08 } as const;
/** Weighted sum of component scores, renormalised over the components that are present (all 8 normally; 7 when the facet is not measured). */
export function weightedSum(comps: ReadonlyArray<{ score: number; weight: number }>): number {
  let s = 0, w = 0;
  for (const c of comps) { s += c.score * c.weight; w += c.weight; }
  return w > 0 ? s / w : 0;
}
/** Pistes: tiles per difficulty that count as a full offering. */
export const FULL_PISTE_TILES = 30;
export const starsOf = (score: number): number => Math.round(clamp(score, 0, 100) / 10) / 2;

/** Pure scoring of one input snapshot. */
export function scoreInput(i: RatingInput): RatingBreakdown {
  const out: RatingComponent[] = [];
  const add = (id: keyof typeof WEIGHTS, label: string, score: number, hint: string): void => { out.push({ id, label, score: Math.round(clamp(score, 0, 100) * 10) / 10, weight: WEIGHTS[id], hint }); };

  // happiness
  const hv = i.guests.count > 0 ? i.guests.avgHappiness : 0.5;
  const sat = i.guests.recentSatisfied >= 0 ? i.guests.recentSatisfied : hv;
  const hs = 100 * (0.75 * hv + 0.25 * sat);
  add('happiness', 'Guest happiness', hs, hs < 55 ? 'Guests are unhappy: check queues, food, rest areas and piste quality' : 'Guests are happy');

  // safety
  const respPen = clamp((i.safety.meanResponseTicks - 8) / 40, 0, 0.5);
  let ss = 100 * (1 - clamp(i.safety.penalty * 2 + respPen));
  let sh = 'Safe resort';
  if (i.safety.unresolved > 0) sh = `${i.safety.unresolved} unresolved incident${i.safety.unresolved === 1 ? '' : 's'}: send help faster`;
  else if (respPen > 0.2) sh = 'Slow rescue response: more patrol coverage or a helicopter';
  if (i.safety.patrolHubs === 0 && i.openLifts > 0) { ss = Math.min(ss, 60); sh = 'Add a Ski Patrol Hub'; }
  const wl = clamp(i.safety.wildlife ?? 0);
  if (wl > 0.02) { ss = Math.max(0, ss - 30 * wl); if (wl > 0.15 && ss > 40) sh = 'Wildlife is scaring guests: build a Ranger Station'; else if (wl > 0.15) sh = `${sh}; wildlife is scaring guests (Ranger Station)`; }
  add('safety', 'Safety', ss, sh);

  // variety
  const v = i.variety, cov = v.pisteTiles.map((t) => clamp(t / FULL_PISTE_TILES));
  const mix = cov.reduce((a, b) => a + b, 0) / 4;
  const vs = 100 * (0.25 * clamp(v.attractionTypes / 4) + 0.2 * clamp(v.liftKinds / 3) + 0.4 * mix + 0.15 * clamp(v.seasonal));
  let vh = 'Great variety';
  const total = v.pisteTiles.reduce((a, b) => a + b, 0);
  if (total > 0 && cov[0]! < 0.5) vh = 'Too few green runs';
  else if (total > 0 && cov[1]! < 0.5) vh = 'Too few blue runs';
  else if (total > 0 && cov[3]! < 0.3 && cov[2]! >= 0.5) vh = 'Add a black run for experts';
  else if (total === 0) vh = 'Open some pistes';
  else if (v.attractionTypes < 2) vh = 'Add attractions (tubing, kids ground, ice rink...)';
  else if (v.liftKinds < 2) vh = 'Try another lift type';
  add('variety', 'Variety', vs, vh);

  // piste quality
  const pq = i.pisteQuality;
  add('pisteQuality', 'Piste quality', pq.tiles > 0 ? 100 * clamp(pq.goodShare) : 50, pq.icyShare > 0.2 ? 'Icy pistes: add snowcats / snowmaking' : pq.goodShare < 0.5 && pq.tiles > 0 ? 'Groom more pistes' : 'Pistes in good shape');

  // queues (patience = 45 ticks)
  const q = i.queues;
  const qs = i.openLifts > 0 ? 100 * (1 - clamp(q.meanWaitTicks / 30)) : 40;
  add('queues', 'Queue times', qs, q.worst && q.worst.waitTicks > 15 ? `Long queues at ${q.worst.name}` : i.openLifts === 0 ? 'No lift is open' : 'Short queues');

  // crowding
  const cs = 100 * (1 - clamp((i.crowding.avgNeighbours - 6) / 30));
  add('crowding', 'Crowding', cs, cs < 60 ? 'Overcrowded: add paths, pistes and space' : 'Comfortable');

  // value
  add('value', 'Value for money', 100 * clamp(i.value), i.value < 0.4 ? 'Prices are high for the quality' : 'Fair prices');

  if (i.sustainability) add('sustainability', 'Sustainability', i.sustainability.score, i.sustainability.hint);

  let score = weightedSum(out);

  // bonuses
  const bonusHints: string[] = [];
  let bonus = 0;
  const am = i.amenities;
  bonus += Math.min(3, am.restaurants * 1);
  if (am.restaurants === 0) bonusHints.push('Build a restaurant');
  if (am.lodgingDemand > 0) bonus += 3 * clamp(am.lodgingCapacity / am.lodgingDemand); else bonus += Math.min(3, am.lodgingCapacity / 40);
  if (am.lodgingDemand > 0 && am.lodgingCapacity < am.lodgingDemand * 0.5) bonusHints.push('More lodging');
  if (i.scenery !== undefined) { bonus += 2 * clamp(i.scenery); if (i.scenery < 0.15) bonusHints.push('Plant trees or add farms for scenery'); }
  score += bonus;

  // unresolved incidents heavily hit the total on top of the component
  if (i.safety.unresolved > 0) score *= 1 - Math.min(0.35, 0.07 * i.safety.unresolved);
  if (i.safety.severe > 0) score *= 1 - Math.min(0.15, 0.03 * i.safety.severe);
  if (i.debt && i.debt > 0) { score *= 1 - DEBT.ratingPenaltyMax * clamp(i.debt); bonusHints.push('Get out of debt: suppliers and staff are unhappy'); }
  score = clamp(score, 0, 100);
  const hints = out.filter((c) => c.score <= 60 && c.hint && !POSITIVE_HINTS.has(c.hint)).sort((a, b) => a.score * a.weight - b.score * b.weight).map((c) => c.hint).concat(bonusHints);
  return { score: Math.round(score * 10) / 10, stars: starsOf(score), components: out, bonus: Math.round(bonus * 10) / 10, bonusHints, hints };
}

export interface RatingOptions {
  inputs: () => RatingInput;
  bus?: Pick<GameBus, 'emit'>;
  /** Per-day smoothing factor (exponential). */
  alpha?: number;
}

const HYST = 0.2; // points-in-stars margin: a half-star step needs to be crossed by this much to switch

/**
 * Resort rating 0..100 (stars = score/20, in half-star steps). Components are smoothed with a per-day exponential average; star
 * changes are emitted at most once per in-game day, only on a star-level change, with hysteresis. Deterministic: reads sim state only.
 */
export class Rating {
  private smooth: Map<string, number> = new Map();
  private last: RatingBreakdown | null = null;
  private smoothBonus = 0;
  private shownStars = 0;
  private lastEmitDay = -1e9;
  private inited = false;
  readonly alpha: number;

  constructor(private o: RatingOptions) { this.alpha = o.alpha ?? 0.35; }

  /** Smoothed score 0..100. */
  get score(): number { return this.last?.score ?? 0; }
  get stars(): number { return this.shownStars; }
  /** Component scores + hints for the UI. */
  breakdown(): RatingBreakdown { return this.last ?? { score: 0, stars: 0, components: [], bonus: 0, bonusHints: [], hints: [] }; }

  /** Attractiveness multiplier for the spawner (0.3..1.5); with no open lift hardly anybody comes. */
  attractiveness(openLifts: number, noLiftFactor = 0.15): number {
    const a = 0.3 + 1.2 * (this.score / 100);
    return openLifts > 0 ? a : a * noLiftFactor;
  }

  /** One daily evaluation (absolute day number). Returns true when `rating:changed` was emitted. */
  evaluate(day: number): boolean {
    const raw = scoreInput(this.o.inputs());
    const a = this.inited ? this.alpha : 1;
    this.inited = true;
    const comps = raw.components.map((c) => {
      const prev = this.smooth.get(c.id) ?? c.score;
      const s = prev + (c.score - prev) * a;
      this.smooth.set(c.id, s);
      return { ...c, score: Math.round(s * 10) / 10 };
    });
    this.smoothBonus += (raw.bonus - this.smoothBonus) * a;
    // recombine from smoothed parts, re-applying the incident multipliers through the raw/unsmoothed ratio
    const base = weightedSum(comps) + this.smoothBonus;
    const rawBase = weightedSum(raw.components) + raw.bonus;
    const mult = rawBase > 0 ? raw.score / rawBase : 1; // < 1 only while incidents are open
    const score = clamp(base * Math.min(1, mult), 0, 100);
    this.last = { ...raw, components: comps, score: Math.round(score * 10) / 10, stars: starsOf(score), bonus: Math.round(this.smoothBonus * 10) / 10 };
    return this.maybeEmit(day, score, raw);
  }

  private maybeEmit(day: number, score: number, raw: RatingBreakdown): boolean {
    const target = starsOf(score);
    if (this.lastEmitDay === -1e9) { this.shownStars = target; this.lastEmitDay = day - 1; return false; } // first sample: baseline
    if (target === this.shownStars) return false;
    // hysteresis: stay unless the raw score is clearly past the boundary of the displayed half-star band
    const lo = this.shownStars * 20 - 5 - HYST * 10, hi = this.shownStars * 20 + 5 + HYST * 10;
    if (score > lo && score < hi) return false;
    if (day - this.lastEmitDay < 1) return false;
    const prev = this.shownStars;
    this.shownStars = target;
    this.lastEmitDay = day;
    const worst = [...this.last!.components].sort((a, b) => (target > prev ? b.score * b.weight - a.score * a.weight : a.score * a.weight - b.score * b.weight))[0];
    const reason = target > prev ? `Improved: ${worst?.label ?? 'overall'} is strong` : (raw.hints[0] ?? `${worst?.label ?? 'Overall'} is suffering`);
    this.o.bus?.emit('rating:changed', { stars: target, previous: prev, reason, score: Math.round(score) });
    return true;
  }

  serialize(): unknown { return { s: [...this.smooth], b: this.smoothBonus, st: this.shownStars, e: this.lastEmitDay, i: this.inited, last: this.last }; }
  load(d: unknown): void {
    const x = d as { s: Array<[string, number]>; b: number; st: number; e: number; i: boolean; last?: RatingBreakdown | null } | undefined;
    if (!x) return;
    this.smooth = new Map(x.s); this.smoothBonus = x.b; this.shownStars = x.st; this.lastEmitDay = x.e; this.inited = x.i;
    if (x.last !== undefined) this.last = x.last;
  }
}

/** Sim system: re-evaluates once per in-game day (inputs are gathered only then — no per-tick work). */
export function createRatingSystem(r: Rating): SimSystem {
  let lastDay = -1;
  return {
    id: 'rating',
    serialize: () => ({ r: r.serialize(), lastDay }),
    load: (d) => { const o = d as { r?: unknown; lastDay?: number } | undefined; if (o && 'r' in o) { r.load(o.r); lastDay = o.lastDay ?? -1; } else r.load(d); },
    update: (state: GameState) => {
      const day = state.date.year * DAYS_PER_YEAR + state.date.day;
      if (day === lastDay) return;
      lastDay = day;
      r.evaluate(day);
    },
  };
}
