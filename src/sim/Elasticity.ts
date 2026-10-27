import { segmentKey } from '../config/guestTypes';
import { AFFORD_SHARE, ELASTICITY, GUEST_TYPE_KEYS, SENSITIVITY, type GuestTypeKey } from '../config/marketing';

/** Price elasticity per guest type (pure functions, no state). `ratio` = price / fair value. */
const keyOf = (t: GuestTypeKey | number): GuestTypeKey => (typeof t === 'number' ? (t < GUEST_TYPE_KEYS.length ? GUEST_TYPE_KEYS[t]! : segmentKey(t)) : t);

/** Demand multiplier for one guest type: exp(-k (ratio-1)), capped by crowding (maxVolume); luxury guests shy away from cheap offers. */
export function demandMultiplier(type: GuestTypeKey | number, ratio: number, sens = 1): number {
  const k = SENSITIVITY[keyOf(type)] * sens;
  const r = Math.max(0, Number.isFinite(ratio) ? ratio : 1);
  let m = Math.exp(-k * (r - 1));
  if (keyOf(type) === 'vip' && r < ELASTICITY.vipCheapRatio) m *= ELASTICITY.vipCheapFloor + (1 - ELASTICITY.vipCheapFloor) * (r / ELASTICITY.vipCheapRatio);
  return Math.max(ELASTICITY.minVolume, Math.min(ELASTICITY.maxVolume, m));
}

/** Mix-weighted volume multiplier (weights in GUEST_TYPE_KEYS order). Equals 1 at fair value. */
export function mixVolume(weights: readonly number[], ratio: number, sens = 1): number {
  let num = 0, den = 0;
  for (let k = 0; k < GUEST_TYPE_KEYS.length; k++) { const w = weights[k] ?? 0; num += w * demandMultiplier(k, ratio, sens); den += w; }
  return den > 0 ? num / den : 1;
}

/** Value-for-money 0..1: 0.5 at the fair price, ~0.8 at half price, ~0.2 at double. A free ticket is capped (no quality signal / crowding). */
export function valueFromRatio(ratio: number, free = false): number {
  const r = Math.max(0, ratio);
  const v = 1 / (1 + r * r);
  return free ? Math.min(v, ELASTICITY.freeValueCap) : v;
}

/** Fraction of its budget a guest type will put into one ticket. */
export const affordShare = (type: GuestTypeKey | number): number => AFFORD_SHARE[keyOf(type)];

/** Deterministic [0,1) roll from (id, salt) — no RNG consumption. */
export function roll(id: number, salt: number): number {
  let h = (Math.imul(id + 1, 2654435761) ^ Math.imul(salt + 7, 40503)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
  return ((h ^ (h >>> 13)) >>> 0) % 10000 / 10000;
}

/** Does this guest buy/use at this price? (probability = min(1, multiplier)) */
export function accepts(type: GuestTypeKey | number, ratio: number, id: number, salt: number, sens = 1): boolean {
  return roll(id, salt) < Math.min(1, demandMultiplier(type, ratio, sens));
}

/** Verdict label for a price ratio. */
export function verdictOf(ratio: number): 'cheap' | 'fair' | 'expensive' { return ratio < 0.85 ? 'cheap' : ratio > 1.2 ? 'expensive' : 'fair'; }
