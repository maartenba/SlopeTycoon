import type { AttractionSpec } from './Attraction';

/** Ice rink: billed per hour (1 h session), needs cold. */
export const ICE_RINK_SPECS: Record<string, AttractionSpec> = {
  iceRink: { kind: 'rink', serviceTicks: 10, effects: { fatigue: 0.05, happiness: 0.14 }, appeal: [0.4, 0.8, 0.9, 0.4, 0.4, 0.3] },
};
