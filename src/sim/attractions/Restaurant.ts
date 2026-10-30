import type { AttractionSpec } from './Attraction';
import { tierAppeal } from './Lodging';

const dine = (serviceTicks: number, appeal: AttractionSpec['appeal'], slots?: number, happiness = 0.06): AttractionSpec =>
  ({ kind: 'restaurant', serviceTicks, slots, effects: { hungerTo: 0.05, urgeTo: 0.25, happiness }, appeal, eveningShift: true });

/** Dining: Lodge/Restaurant, Base Lodge (also lodging), Café, Mountain Hut and the Heated Terrace dining variant. */
export const RESTAURANT_SPECS: Record<string, AttractionSpec> = {
  lodge: dine(6, [0.5, 0.6, 0.6, 0.7, 0.3, 0.4]),
  baseLodge: { ...dine(6, [0.5, 0.5, 0.5, 0.6, 0.4, 0.4], 60), rooms: 20 },
  /** Small Hotel (Phase 6 Task 27, docs/hotels.md): 40 rooms (standard tier) over a lobby restaurant that also feeds day guests. Rooms: `rooms` + `tier`; nights are billed by NIGHTLY_RATE. */
  smallHotel: { ...dine(6, tierAppeal([0.5, 0.55, 0.6, 0.55, 0.4, 0.4], 'standard'), 24), rooms: 40, tier: 'standard' },
  cafe: dine(4, [0.5, 0.5, 0.5, 0.4, 0.7, 0.5]),
  /** Après-Ski Bar: drinks + snacks; evening crowd magnet (hunger only partly satisfied, big happiness). */
  apresBar: { kind: 'bar', serviceTicks: 5, slots: 28, effects: { hungerTo: 0.25, happiness: 0.1 }, appeal: [0.6, 0.8, 0.3, 0.7, 0.5, 0.8], eveningShift: true },
  mountainHut: { ...dine(5, [0.6, 0.6, 0.5, 0.5, 0.5, 0.8], undefined, 0.08), beds: 12 },
};
