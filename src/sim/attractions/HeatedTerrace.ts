import type { AttractionSpec } from './Attraction';

/** Heated Terrace: premium dining outdoors; needs cold (otherwise nobody wants the heaters). VIP favourite. */
export const HEATED_TERRACE_SPECS: Record<string, AttractionSpec> = {
  heatedTerrace: { kind: 'terrace', serviceTicks: 6, effects: { hungerTo: 0.05, happiness: 0.1 }, appeal: [0.5, 0.8, 0.5, 1, 0.2, 0.4], eveningShift: true },
};
