import type { AttractionSpec } from './Attraction';

/** Alpine Farm shop: a summer family attraction (closed in snow via the catalog `snowFree` need). Cheese & milk snacks. */
export const FARM_SPECS: Record<string, AttractionSpec> = {
  alpineFarm: { kind: 'farm', serviceTicks: 5, slots: 12, effects: { hungerTo: 0.05, happiness: 0.1 }, appeal: [0.4, 0.6, 1, 0.4, 0.6, 0.2] },
};
