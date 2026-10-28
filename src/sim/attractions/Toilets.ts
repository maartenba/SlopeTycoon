import type { AttractionSpec } from './Attraction';

/** Comfort need (docs/comfort.md): toilets are free, four cubicles, one-tick service. They restore the guest's comfort to 0 urge (a grubby block only to `GRUBBY_URGE`). */
export const TOILET_SPECS: Record<string, AttractionSpec> = {
  toilets: { kind: 'toilet', serviceTicks: 1, slots: 4, effects: { urgeTo: 0, happiness: 0.02 }, appeal: [0.3, 0.3, 0.3, 0.3, 0.3, 0.3] },
};

/** Guests one toilet block serves per day before it is 'overrun' (queues form, cleaning cannot keep up). */
export const TOILET_USES_PER_DAY = 70;
/** Urge left after using an overrun (grubby) block. */
export const GRUBBY_URGE = 0.3;
