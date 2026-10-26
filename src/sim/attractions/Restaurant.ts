import type { AttractionSpec } from './Attraction';

const dine = (serviceTicks: number, appeal: AttractionSpec['appeal'], slots?: number, happiness = 0.06): AttractionSpec =>
  ({ kind: 'restaurant', serviceTicks, slots, effects: { hungerTo: 0.05, happiness }, appeal, eveningShift: true });

/** Dining: Lodge/Restaurant, Base Lodge (also lodging), Café, Mountain Hut and the Heated Terrace dining variant. */
export const RESTAURANT_SPECS: Record<string, AttractionSpec> = {
  lodge: dine(6, [0.5, 0.6, 0.6, 0.7, 0.3, 0.4]),
  baseLodge: { ...dine(6, [0.5, 0.5, 0.5, 0.6, 0.4, 0.4], 60), rooms: 20 },
  cafe: dine(4, [0.5, 0.5, 0.5, 0.4, 0.7, 0.5]),
  /** Après-Ski Bar: drinks + snacks; evening crowd magnet (hunger only partly satisfied, big happiness). */
  apresBar: { kind: 'bar', serviceTicks: 5, slots: 28, effects: { hungerTo: 0.25, happiness: 0.1 }, appeal: [0.6, 0.8, 0.3, 0.7, 0.5, 0.8], eveningShift: true },
  mountainHut: { ...dine(5, [0.6, 0.6, 0.5, 0.5, 0.5, 0.8], undefined, 0.08), beds: 12 },
};
