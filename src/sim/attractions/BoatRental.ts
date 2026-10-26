import type { AttractionSpec } from './Attraction';

/** Boats: 8 boats, billed per hour (1.5 h), needs warm weather AND an unfrozen lake. */
export const BOAT_RENTAL_SPECS: Record<string, AttractionSpec> = {
  boatRental: { kind: 'boats', serviceTicks: 15, slots: 8, effects: { fatigue: 0.03, happiness: 0.16 }, appeal: [0.4, 0.9, 0.6, 0.6, 0.2, 0.5], extra: 'lake' },
};
