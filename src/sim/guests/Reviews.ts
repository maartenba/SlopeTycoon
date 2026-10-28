import { Rng } from '@/core/Rng';
import { REVIEW_TEMPLATES, type ReviewDriver, type ReviewSentiment, type ReviewTemplate, type ReviewTone } from '@/config/reviewTemplates';

/** Guest reviews (M5.1). Pure: no sim RNG, no DOM. A separate Rng seeded from (guest id, day) keeps the sim's RNG stream and stateHash untouched. */
export const REVIEW_RATE = 0.05;
export const REVIEWS_PER_DAY = 6;
/** Probability of picking a light-humour template (the share is hard-capped at 20% by the rules in the plan; the target is lower). */
export const LIGHT_WEIGHT = 0.15;
/** A template is not reused within this many reviews. */
export const NO_REPEAT = 12;

export type LeaveReasonName = 'satisfied' | 'bored' | 'broke' | 'injured' | 'closing';

/** What we know about a guest when they leave. */
export interface ReviewInput {
  id: number; day: number; reason: LeaveReasonName;
  /** 0..1 */
  happiness: number; hunger: number; fatigue: number;
  /** Comfort need at departure (0..1, optional: absent = 0). */
  urge?: number;
  budget: number; runs: number;
  /** Longest queue wait this visit, in minutes. */
  queueMin: number;
  /** Guests nearby when leaving. */
  crowd: number;
  weatherPenalty: number;
  /** Piste quality liking 0..1 where the guest was skiing (null = unknown). */
  pisteLike: number | null;
  x: number; y: number;
}

export interface Review { guestId: number; stars: number; text: string; tone: ReviewTone; driver: ReviewDriver; x?: number; y?: number }
export interface DriverScore { driver: ReviewDriver; sentiment: ReviewSentiment; impact: number }
export interface PlaceText { name: string; on: string }

/** Rank the drivers of a departure by impact (0..1). Pure. Always returns at least one driver ('general'). */
export function reviewDrivers(g: ReviewInput): DriverScore[] {
  const out: DriverScore[] = [];
  const add = (driver: ReviewDriver, sentiment: ReviewSentiment, impact: number): void => { if (impact > 0) out.push({ driver, sentiment, impact: Math.min(1, impact) }); };
  if (g.reason === 'injured') add('injury', 'neg', 1.5);
  if (g.reason === 'broke') add('price', 'neg', 1.2);
  if (g.reason === 'bored') add('general', 'neg', 0.5);
  if (g.queueMin >= 6) add('queue', 'neg', g.queueMin * 0.05); else if (g.runs >= 3 && g.queueMin < 2) add('queue', 'pos', 0.35);
  if (g.hunger > 0.6) add('hunger', 'neg', (g.hunger - 0.35) * 1.2); else if (g.hunger < 0.2 && g.happiness > 0.6) add('hunger', 'pos', 0.3);
  if ((g.urge ?? 0) > 0.75) add('comfort', 'neg', ((g.urge ?? 0) - 0.4) * 1.1);
  if (g.fatigue > 0.7) add('tired', g.happiness > 0.55 ? 'pos' : 'neg', (g.fatigue - 0.3) * 0.9);
  if (g.weatherPenalty >= 0.05) add('weather', 'neg', g.weatherPenalty * 5); else if (g.weatherPenalty < 0.03 && g.happiness > 0.75) add('weather', 'pos', 0.25);
  if (g.crowd > 30) add('crowd', 'neg', (g.crowd - 20) * 0.03); else if (g.crowd >= 8 && g.happiness > 0.7) add('crowd', 'pos', 0.2);
  if (g.pisteLike !== null) { if (g.pisteLike >= 0.7) add('piste', 'pos', g.pisteLike * 0.9); else if (g.pisteLike < 0.4) add('piste', 'neg', (0.6 - g.pisteLike) * 2); }
  if (g.budget > 150 && g.reason !== 'broke' && g.happiness > 0.6) add('price', 'pos', 0.3);
  add('general', g.happiness >= 0.5 ? 'pos' : 'neg', 0.15 + Math.abs(g.happiness - 0.5) * 0.3);
  return out.sort((a, b) => b.impact - a.impact || a.driver.localeCompare(b.driver));
}

/** 1..5 stars from happiness; bad exits cap the score. */
export function reviewStars(g: Pick<ReviewInput, 'happiness' | 'reason'>): number {
  let s = 1 + Math.round(Math.min(1, Math.max(0, g.happiness)) * 4);
  if (g.reason === 'injured' || g.reason === 'broke') s = Math.min(s, 2);
  if (g.reason === 'bored') s = Math.min(s, 3);
  return Math.max(1, Math.min(5, s));
}

const sentence = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const fill = (t: string, place: PlaceText | null): string => (place ? t.replace(/\{on\}/g, place.on).replace(/\{name\}/g, place.name) : t);

/** Pick a template for (driver, sentiment): light with probability LIGHT_WEIGHT, never one of `recent`. Falls back across tone/placeless/recent when empty. */
export function pickTemplate(driver: ReviewDriver, sentiment: ReviewSentiment, rng: Rng, recent: readonly string[], hasPlace: boolean, forcePlain = false): ReviewTemplate | null {
  const base = REVIEW_TEMPLATES.filter((t) => t.driver === driver && t.sentiment === sentiment && (hasPlace || !t.needsPlace));
  if (!base.length) return null;
  const fresh = base.filter((t) => !recent.includes(t.id));
  // Small pools: fall back to the least recently used templates (never an immediate repeat while the pool has >= 2).
  const oldest = Math.min(...base.map((t) => recent.lastIndexOf(t.id)));
  const pool = fresh.length ? fresh : base.filter((t) => recent.lastIndexOf(t.id) === oldest);
  const wantLight = !forcePlain && rng.next() < LIGHT_WEIGHT;
  const tone: ReviewTone = wantLight ? 'light' : 'plain';
  const sub = pool.filter((t) => t.tone === tone);
  const plain = pool.filter((t) => t.tone === 'plain');
  const basePlain = base.filter((t) => t.tone === 'plain');
  const lruPlain = basePlain.filter((t) => recent.lastIndexOf(t.id) === Math.min(...basePlain.map((u) => recent.lastIndexOf(u.id))));
  const from = sub.length ? sub : plain.length ? plain : lruPlain;
  const use = from.length ? from : pool;
  return use[Math.floor(rng.next() * use.length)] ?? null;
}

/** Seeded per-review RNG: depends only on guest id and day. */
export const reviewRng = (id: number, day: number): Rng => new Rng(((Math.imul(id | 0, 0x9e3779b1) ^ Math.imul((day | 0) + 1, 0x85ebca6b)) >>> 0) || 1);

/** Compose a review (top 1-2 drivers). Mutates `recent` (template ids, newest last). */
export function composeReview(g: ReviewInput, rng: Rng, recent: string[], place: PlaceText | null): Review | null {
  const ds = reviewDrivers(g);
  const top = ds[0]!;
  const t1 = pickTemplate(top.driver, top.sentiment, rng, recent, !!place);
  if (!t1) return null;
  const parts = [sentence(fill(t1.text, place))];
  recent.push(t1.id);
  // A second plain clause for a distinct strong driver (never light, never a repeat of the first one's sentiment).
  const second = ds.find((d) => d.driver !== top.driver && d.driver !== 'general' && d.impact >= 0.4 && d.sentiment === top.sentiment);
  if (second) {
    const t2 = pickTemplate(second.driver, second.sentiment, rng, recent, !!place, true);
    if (t2) { parts.push(sentence(fill(t2.text, place))); recent.push(t2.id); }
  }
  while (recent.length > NO_REPEAT) recent.shift();
  return { guestId: g.id, stars: reviewStars(g), text: parts.join(' '), tone: t1.tone, driver: top.driver, ...(place ? { x: g.x, y: g.y } : {}) };
}

/** Per-day rate-limited review source. `enabled = false` makes `consider` a no-op (stateHash is unaffected either way: nothing here touches the sim). */
export class ReviewDirector {
  enabled = true;
  rate = REVIEW_RATE;
  perDay = REVIEWS_PER_DAY;
  private day = -1;
  private today = 0;
  private recent: string[] = [];
  total = 0;

  consider(g: ReviewInput, place: PlaceText | null): Review | null {
    if (!this.enabled) return null;
    if (g.day !== this.day) { this.day = g.day; this.today = 0; }
    if (this.today >= this.perDay) return null;
    const rng = reviewRng(g.id, g.day);
    if (rng.next() >= this.rate) return null;
    const r = composeReview(g, rng, this.recent, place);
    if (r) { this.today++; this.total++; }
    return r;
  }
}
