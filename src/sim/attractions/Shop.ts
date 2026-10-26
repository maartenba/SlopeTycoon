import type { AttractionSpec } from './Attraction';

export const SHOP_SPECS: Record<string, AttractionSpec> = {
  shop: { kind: 'shop', serviceTicks: 3, slots: 6, effects: { happiness: 0.05 }, appeal: [0.3, 0.5, 0.5, 0.7, 0.2, 0.3] },
};
