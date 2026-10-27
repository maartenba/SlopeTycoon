import { EVENING } from '../config/balance';
import { coreOf, GuestType } from './guests/Guest';
import { summerness } from './Daylight';

/** Pure evening / après-ski model (no RNG: everything derives from guest id + day). See docs/balance.md "Evenings". */
export type VenueKind = 'dine' | 'bar' | 'terrace';
export const venueKindOf = (type: string): VenueKind => (type === 'apresBar' ? 'bar' : type === 'heatedTerrace' ? 'terrace' : 'dine');

type Curve = ReadonlyArray<readonly [number, number]>;
function sample(c: Curve, h: number): number {
  if (h < c[0]![0] || h >= c[c.length - 1]![0]) return 0;
  for (let i = 1; i < c.length; i++) {
    const [h1, v1] = c[i]!;
    if (h <= h1) { const [h0, v0] = c[i - 1]!; return v0 + ((v1 - v0) * (h - h0)) / (h1 - h0); }
  }
  return 0;
}

/** Demand multiplier of a venue kind at `hour` on `day` (1 = a normal busy hour; blends the winter and summer curves by day length). */
export function venueDemand(kind: VenueKind, day: number, hour: number): number {
  const k = summerness(day), set = kind === 'bar' ? EVENING.bar : EVENING.dine;
  const dine = (1 - k) * sample(set.winter, hour) + k * sample(set.summer, hour);
  if (kind !== 'terrace') return dine;
  return 0.5 * dine + 0.5 * ((1 - k) * sample(EVENING.bar.winter, hour) + k * sample(EVENING.bar.summer, hour));
}

const lerp = (w: number, s: number, day: number): number => w + (s - w) * summerness(day);
export const closeHour = (day: number): number => lerp(EVENING.closeWinter, EVENING.closeSummer, day);
export const sleepHour = (day: number): number => lerp(EVENING.sleepWinter, EVENING.sleepSummer, day);
export const eveningStart = (day: number): number => lerp(EVENING.startWinter, EVENING.startSummer, day);
/** Is a food/drink venue serving at this hour? */
export const venueServing = (day: number, hour: number): boolean => hour >= EVENING.openHour && hour < closeHour(day);
/** Price multiplier for the evening ("drinks premium"). */
export const eveningPremium = (hour: number): number => (hour >= EVENING.premiumFrom ? 1 + EVENING.premium : 1);

const hash = (id: number, salt: number): number => (Math.imul(id + salt, 2654435761) >>> 0) % 100;
/** Is this day guest an après-ski guest today? Deterministic in (id, type, day). */
export function isApres(id: number, type: number, day: number): boolean {
  const share = lerp(EVENING.apresWinter, EVENING.apresSummer, day) * (EVENING.apresTypeBias[type] ?? 1);
  return hash(id, 7919) < share;
}
/** Hour an après guest finally heads home (19:00-20:00 in winter). */
export const apresEnd = (id: number, day: number): number => lerp(EVENING.apresEndWinter, EVENING.apresEndSummer, day) + hash(id, 104729) / 100;
/** Extra pull of the evening for a guest type (couples, VIPs and adventurers like a night out). */
export const eveningTypeBias = (type: number): number => { const t = coreOf(type); return t === GuestType.Couple || t === GuestType.VIP || t === GuestType.Adventure ? 0.25 : t === GuestType.Budget ? -0.2 : 0; };
