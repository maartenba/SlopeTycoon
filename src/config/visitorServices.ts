/** M7.4 visitor services (docs/m74-buildings.md): the Tourist Office arrival effect and the Bakery breakfast bonus. Config is the source of truth. */

/** Tourist Office (owner decision): ONE per resort (catalog `maxCount: 1`), ALWAYS +6 % arrivals while it is active and staffed. A constant factor, so it can never stack. */
export const TOURIST_OFFICE = { arrivalMult: 1.06 } as const;

/**
 * Bakery: opens 06:00 - 12:00 (a morning peak). Breakfast for the lodgings nearby: an active bakery within `radius` tiles of an active lodging
 * (chalet, apartment, hotel, base lodge) adds `facilities` points to the Facilities facet (0..100, capped), once (a second bakery adds nothing).
 */
export const BAKERY = { open: 6, close: 12, radius: 9, facilities: 4, lodgings: ['chalet', 'apartment', 'smallHotel', 'luxuryHotel', 'baseLodge'] as readonly string[] } as const;
