import { GEAR_OWNERS } from '../../config/prices';
import type { AttractionSpec } from './Attraction';

/** Ski/board/bike rental: a guest without gear visits once; afterwards `rented` remembers them. */
export const RENTAL_SPECS: Record<string, AttractionSpec> = {
  rental: { kind: 'rental', serviceTicks: 4, slots: 8, effects: { happiness: 0.02 }, appeal: [0.3, 0.3, 0.3, 0.3, 0.3, 0.3], grantsGear: true },
};

/** Share (%) of Snowboarders that bring their own board (Task 33): fewer than skiers (82 %) own gear, so the Rental sees them more (the 'board stock' of the rental is its ordinary gear grant). */
export const BOARD_OWNERS = 55;

/** Deterministic per-guest ownership of gear (about GEAR_OWNERS[kind] % of guests bring their own; 'board' = BOARD_OWNERS % of the Snowboarders). */
export function ownsGear(guestId: number, kind: 'ski' | 'bike' | 'board'): boolean {
  if (kind === 'board') return (Math.imul(guestId + 53, 2246822519) >>> 0) % 100 < BOARD_OWNERS;
  const h = (Math.imul(guestId + (kind === 'ski' ? 17 : 91), 2246822519) >>> 0) % 100;
  return h < GEAR_OWNERS[kind];
}
