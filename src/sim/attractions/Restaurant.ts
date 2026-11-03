import type { AttractionSpec } from './Attraction';
import { tierAppeal } from './Lodging';
import { BAKERY } from '../../config/visitorServices';
import { SCHIRMBAR } from '../../config/schirmbar';

const dine = (serviceTicks: number, appeal: AttractionSpec['appeal'], slots?: number, happiness = 0.06): AttractionSpec =>
  ({ kind: 'restaurant', serviceTicks, slots, effects: { hungerTo: 0.05, urgeTo: 0.25, happiness }, appeal, eveningShift: true });

/** Dining: Lodge/Restaurant, Base Lodge (also lodging), Café, Mountain Hut and the Heated Terrace dining variant. */
export const RESTAURANT_SPECS: Record<string, AttractionSpec> = {
  lodge: dine(6, [0.5, 0.6, 0.6, 0.7, 0.3, 0.4]),
  baseLodge: { ...dine(6, [0.5, 0.5, 0.5, 0.6, 0.4, 0.4], 60), rooms: 20 },
  /** Small Hotel (Phase 6 Task 27, docs/hotels.md): 40 rooms (standard tier) over a lobby restaurant that also feeds day guests. Rooms: `rooms` + `tier`; nights are billed by NIGHTLY_RATE. */
  smallHotel: { ...dine(6, tierAppeal([0.5, 0.55, 0.6, 0.55, 0.4, 0.4], 'standard'), 24), rooms: 40, tier: 'standard' },
  /** Coffee Stand (Phase 6 Task 28, docs/coffee-stand.md): a quick cup and a bite at the piste edge: 2 ticks, a few places, takes 0.3 off the hunger (the cafe is the real meal: hunger to 0.05), no evening shift. */
  coffeeStand: { kind: 'restaurant', serviceTicks: 2, slots: 4, effects: { hungerBy: 0.3, happiness: 0.04 }, appeal: [0.55, 0.5, 0.5, 0.3, 0.7, 0.55] },
  /** Schirmbar (M7.8, docs/schirmbar.md): a quick drink on the slopes: 8 places, 3 ticks, mood up, a little hunger and tiredness off. Open rules: `schirmbarStatus` (winter, weather, the player's switch); at most `dailyCap` guests a day. */
  schirmbar: { kind: 'restaurant', serviceTicks: SCHIRMBAR.serviceTicks, slots: SCHIRMBAR.slots, effects: { hungerBy: SCHIRMBAR.hungerBy, happiness: SCHIRMBAR.happiness, fatigue: SCHIRMBAR.fatigue }, appeal: [0.6, 0.8, 0.4, 0.5, 0.6, 0.8], hours: SCHIRMBAR.hours, schirmbar: true, dailyCap: SCHIRMBAR.dailyCap },
  /** Pizzeria (M7.4, docs/m74-buildings.md): a real meal, cheaper and smaller than the Lodge (20 places, $9), a family / budget favourite with an evening shift. */
  pizzeria: dine(5, [0.45, 0.55, 0.9, 0.2, 0.9, 0.5], 20, 0.07),
  /** Bakery (M7.4): a roll and a coffee in the morning only (06:00 - 12:00): quick, 6 places, takes 0.3 off the hunger like the Coffee Stand. */
  bakery: { kind: 'restaurant', serviceTicks: 2, slots: 6, effects: { hungerBy: 0.3, happiness: 0.05 }, appeal: [0.6, 0.6, 0.6, 0.4, 0.7, 0.4], hours: [BAKERY.open, BAKERY.close] },
  cafe: dine(4, [0.5, 0.5, 0.5, 0.4, 0.7, 0.5]),
  /** Après-Ski Bar: drinks + snacks; evening crowd magnet (hunger only partly satisfied, big happiness). */
  apresBar: { kind: 'bar', serviceTicks: 5, slots: 28, effects: { hungerTo: 0.25, happiness: 0.1 }, appeal: [0.6, 0.8, 0.3, 0.7, 0.5, 0.8], eveningShift: true },
  mountainHut: { ...dine(5, [0.6, 0.6, 0.5, 0.5, 0.5, 0.8], undefined, 0.08), beds: 12 },
};
