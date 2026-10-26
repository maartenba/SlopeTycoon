import type { AttractionSpec } from './Attraction';

export const PLAYGROUND_SPECS: Record<string, AttractionSpec> = {
  playground: { kind: 'playground', serviceTicks: 6, effects: { fatigue: 0.03, happiness: 0.12 }, appeal: [0.1, 0.2, 1, 0.1, 0.4, 0.1] },
};
