import type { AttractionSpec } from './Attraction';

export const KIDS_GROUND_SPECS: Record<string, AttractionSpec> = {
  kidsGround: { kind: 'kidsGround', serviceTicks: 8, effects: { fatigue: 0.05, happiness: 0.12 }, appeal: [0.1, 0.2, 1, 0.2, 0.4, 0.1] },
};
