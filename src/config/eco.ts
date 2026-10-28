/**
 * Eco Centre + Eco programme (docs/eco.md). Data + tuning only; the logic lives in `sim/meta/Eco.ts`.
 *
 * The Eco Centre is a mid-game building (resort level 4). While it stands and is connected, the player may fund up to five policies, each with a
 * one-off start fee and a running cost per day, a real trade-off and a bounded sustainability payoff (facet points, added after the weighted
 * parts and clamped so the facet never exceeds 100; `SUSTAIN.weights` are untouched). A sixth item, the carbon-neutral certification, needs three
 * policies and a renewable share and earns a last block of points plus a small, lasting arrivals boost.
 */
export type EcoPolicyId = 'electricFleet' | 'carFree' | 'habitat' | 'localProduce' | 'smartSnow';

export interface EcoPolicyDef {
  id: EcoPolicyId;
  name: string;
  icon: string;
  /** One line: what it does. */
  effect: string;
  /** The honest downside. */
  tradeoff: string;
  /** One-off fee to start it (dollars). Switching it off and on again pays it again. */
  fee: number;
  /** Running cost per day while on (dollars). */
  perDay: number;
  /** Sustainability facet points while on (0..). */
  points: number;
}

export const ECO_POLICIES: readonly EcoPolicyDef[] = [
  { id: 'electricFleet', name: 'Electric snowcats & groomers', icon: '🔋', effect: 'Grooming fuel use -50%, quieter nights on the mountain', tradeoff: 'Charging points and battery servicing cost running money every day', fee: 3500, perDay: 14, points: 4 },
  { id: 'carFree', name: 'Car-free village', icon: '🚌', effect: 'Parking is rationed, the village is calm and clean', tradeoff: 'About 4% fewer arrivals (only 1.5% with a Train Station or Shuttle Depot) and a shuttle subsidy', fee: 4000, perDay: 12, points: 5 },
  { id: 'habitat', name: 'Habitat corridors & wildlife protection', icon: '🦌', effect: 'Plants 1.2 trees a day against the forest you cleared; counts toward the habitat score', tradeoff: 'Forestry crew, fencing and monitoring', fee: 3000, perDay: 12, points: 7 },
  { id: 'localProduce', name: 'Local produce & zero-waste kitchens', icon: '🥕', effect: 'Restaurant income +3% (guests love regional food); lifts the sustainability score', tradeoff: 'Regional suppliers and composting cost more than the wholesale truck', fee: 2500, perDay: 8, points: 4 },
  { id: 'smartSnow', name: 'Smart snowmaking & dimmed lifts', icon: '💡', effect: 'Snowmaking energy -12%, lift energy -8%', tradeoff: 'Sensors and controls: the saving is smaller than the running cost at first', fee: 3000, perDay: 8, points: 5 },
];
export const ECO_POLICY_BY_ID: Readonly<Record<string, EcoPolicyDef>> = Object.fromEntries(ECO_POLICIES.map((p) => [p.id, p]));

export const ECO = {
  /** Resort level that unlocks the Eco Centre (docs/progression.md). */
  centreLevel: 4,
  /** Hard cap on the eco term of the facet (points). The policies add up to 25, the certification 4; 30 is the ceiling. */
  maxPoints: 30,
  /** Policy effects. */
  groomFuelMult: 0.5,
  /** Arrivals multiplier of the car-free village without / with a Train Station or Shuttle Depot. */
  carFreeArrivals: 0.96, carFreeArrivalsTransit: 0.985,
  /** Trees credited per day while the habitat policy runs (only ever against the net deficit felled - planted). */
  habitatSaplingsPerDay: 1.2,
  produceRestaurantMult: 1.03,
  smartSnowMult: 0.88, smartLiftMult: 0.92,
  /** Carbon-neutral certification. */
  cert: {
    fee: 5000, perDay: 5, points: 4,
    /** Policies that must run, and the share of the energy demand that renewables take off the bill (rolling), held for `holdDays` days in a row. */
    policies: 3, renewableShare: 0.2, holdDays: 10,
    /** Lasting arrivals boost (eco-tourists) while the certificate holds. */
    arrivals: 1.06,
    /** Rolling-share smoothing (per day). */
    decay: 0.08,
  },
} as const;
