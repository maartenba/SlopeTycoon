import type { AttractionSpec } from './Attraction';

/** Beginner conveyor: short ride, low price. */
export const MAGIC_CARPET_SPECS: Record<string, AttractionSpec> = {
  magicCarpet: { kind: 'carpet', serviceTicks: 3, effects: { fatigue: 0.01, happiness: 0.03 }, appeal: [0.1, 0.2, 0.9, 0.1, 0.4, 0.1] },
};
