import type { AttractionSpec } from './Attraction';

/** Lake beach: needs warm weather AND an unfrozen lake. */
export const BEACH_SPECS: Record<string, AttractionSpec> = {
  beach: { kind: 'beach', serviceTicks: 10, effects: { fatigue: -0.1, happiness: 0.14 }, appeal: [0.5, 0.7, 0.9, 0.5, 0.6, 0.4], extra: 'lake' },
};
