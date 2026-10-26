import type { AttractionSpec } from './Attraction';

export const STUNT_PARK_SPECS: Record<string, AttractionSpec> = {
  stuntPark: { kind: 'stunt', serviceTicks: 8, effects: { fatigue: 0.08, happiness: 0.15 }, appeal: [0.4, 0.3, 0.2, 0.2, 0.5, 1] },
};
