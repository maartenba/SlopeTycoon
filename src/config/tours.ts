import type { SeasonId } from '../core/events';
import type { Appeal } from '../sim/attractions/Attraction';

/**
 * Tour attractions (Phase 6 Task 5; docs/tours.md): guided rides / hikes along a route that the planner finds from the base building over
 * attached network tiles. A tour def is keyed by the id of its BASE BUILDING (config/buildings.ts); price, upkeep and staff live in the usual
 * building / price tables. Content tasks (sleigh, snowshoe, scooter, quad, canyoning, rafting) add rows; quads were the first.
 */
export type TourRouteKind = 'road' | 'path' | 'trail' | 'piste' | 'water';
export type TourVehicleKind = 'sleigh' | 'walkers' | 'scooter' | 'quad' | 'raft';

export interface TourDef {
  /** Base building id (the key of this def). */
  id: string;
  /** Layers the route may use (a tile qualifies when ANY applies). 'water' = waterway segments (stub until Task 24). */
  routes: readonly TourRouteKind[];
  /** Layer bit for 'trail' (Layer.Hike = 4, Layer.Mtb = 2). Default Hike. */
  trailLayer?: 2 | 4;
  /** Motorised tours never use piste tiles, disturb wildlife and add the capped sustainability sub-input. */
  motorised: boolean;
  /** Route length in tiles, one way (the vehicles go out and come back the same way). */
  minLen: number; maxLen: number;
  /** Ride duration in ticks (10 ticks = 1 in-game hour). */
  durationTicks: number;
  /** Ticks between departures; first / last departure hour of the day. */
  intervalTicks: number; firstHour: number; lastHour: number;
  /** Seats per departure (all vehicles together); staffing scales it like any attraction. */
  seats: number;
  /** Minimum riders for a departure to leave (1 = leaves with anyone). */
  minRiders: number;
  /** Seasons in which the tour runs. */
  seasons: readonly SeasonId[];
  /** Closure thresholds: wind (0..1, storm = 1), avalanche instability on any route tile (AVA scale; > 1 releases). */
  maxWind: number; maxInstability: number;
  /** Guest-type appeal [solo, couple, family, vip, budget, adventure]. */
  appeal: Appeal;
  /** Happiness gained by a rider on return (0..1). */
  happiness: number;
  /** Sustainability facet points booked per motorised departure (summed over the day, total capped at TOURS.maxSustainPenalty). */
  sustainPerDeparture: number;
  /** Wildlife flee radius (tiles) around the route at each motorised departure. */
  noiseRadius: number;
  /** Cosmetic carriers shown on the route. */
  vehicle: TourVehicleKind;
  /** Carriers drawn per departure (view only). */
  vehicles: number;
}

/**
 * The tour catalogue. Tests register a dummy def here and remove it again.
 * Quad Base (Phase 6 Task 22, docs/quads.md): summer guided quad rides out and back along attached ROAD / FOOTPATH tiles (never trails or pistes), 8 seats
 * (4 quads x 2), 10 to 16 h every 2 h, 1.5 h rides. Motorised: scares wildlife and books a small, capped sustainability penalty.
 */
export const TOUR_DEFS: Record<string, TourDef> = {
  quadBase: {
    id: 'quadBase', routes: ['road', 'path'], motorised: true, minLen: 8, maxLen: 26,
    durationTicks: 15, intervalTicks: 20, firstHour: 10, lastHour: 16, seats: 8, minRiders: 2,
    seasons: ['summer'], maxWind: 0.7, maxInstability: 0.8,
    appeal: [0.35, 0.5, 0.3, 0.3, 0.1, 1], happiness: 0.2,
    sustainPerDeparture: 0.35, noiseRadius: 9, vehicle: 'quad', vehicles: 4,
  },
};

export const TOURS = {
  /** Total sustainability facet points all motorised tours can ever take (D-P8: small). */
  maxSustainPenalty: 3,
  /** Wildlife is disturbed along the route every this many tiles. */
  noiseEvery: 6,
  /** Hard cap of cosmetic carriers drawn over the whole map. */
  maxCarriers: 48,
  /** Dynamic closure verdicts (wind / instability) are re-evaluated every this many ticks. */
  checkEvery: 10,
  /** Message for the water validator stub (filled in Task 24). */
  waterStub: 'Needs a river with enough flow: dig one in Landscape',
} as const;

export const tourDefOf = (buildingType: string): TourDef | undefined => TOUR_DEFS[buildingType];
