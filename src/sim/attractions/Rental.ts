import { GEAR_OWNERS } from '../../config/prices';
import type { AttractionSpec } from './Attraction';

/** Ski/board/bike rental: a guest without gear visits once; afterwards `rented` remembers them. */
export const RENTAL_SPECS: Record<string, AttractionSpec> = {
  rental: { kind: 'rental', serviceTicks: 4, slots: 8, effects: { happiness: 0.02 }, appeal: [0.3, 0.3, 0.3, 0.3, 0.3, 0.3], grantsGear: true },
};

/**
 * Rental stock (docs/rental.md): every OPEN rental building holds `skis` pairs and `boards` boards (bikes are not counted). A rented set is out until the guest leaves the resort. When a guest's kind
 * is out of stock the visit is refused and counted as a shortage (inspector + Advisor 'rental.boards'); guests without gear do gear-free things, exactly as with no rental at all. Boarders
 * (Snowboarder type) take boards, everybody else skis, so a board shortage never eats the ski stock.
 */
export const RENTAL_STOCK = { skis: 30, boards: 16 } as const;
export type StockKind = 'skis' | 'boards';
export interface RentalStockInfo { skis: { out: number; cap: number }; boards: { out: number; cap: number }; /** Guests turned away for lack of gear today / ever. */ shortToday: number; shortBoardsToday: number; short: number }

/** Share (%) of Snowboarders that bring their own board (Task 33): fewer than skiers (82 %) own gear, so the Rental sees them more (the 'board stock' of the rental is its ordinary gear grant). */
export const BOARD_OWNERS = 55;

/** Deterministic per-guest ownership of gear (about GEAR_OWNERS[kind] % of guests bring their own; 'board' = BOARD_OWNERS % of the Snowboarders). */
export function ownsGear(guestId: number, kind: 'ski' | 'bike' | 'board'): boolean {
  if (kind === 'board') return (Math.imul(guestId + 53, 2246822519) >>> 0) % 100 < BOARD_OWNERS;
  const h = (Math.imul(guestId + (kind === 'ski' ? 17 : 91), 2246822519) >>> 0) % 100;
  return h < GEAR_OWNERS[kind];
}
