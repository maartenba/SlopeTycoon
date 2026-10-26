import type { AttractionSpec } from './Attraction';

export const ADVENTURE_PARK_SPECS: Record<string, AttractionSpec> = {
  adventurePark: { kind: 'adventure', serviceTicks: 10, effects: { fatigue: 0.1, happiness: 0.16 }, appeal: [0.4, 0.4, 0.6, 0.2, 0.3, 1] },
};
