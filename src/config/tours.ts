import type { SeasonId } from '../core/events';
import type { Appeal } from '../sim/attractions/Attraction';

/**
 * Tour attractions (Phase 6 Task 5; docs/tours.md): guided rides / hikes along a route that the planner finds from the base building over
 * attached network tiles. A tour def is keyed by the id of its BASE BUILDING (config/buildings.ts); price, upkeep and staff live in the usual
 * building / price tables. Content tasks (sleigh, snowshoe, scooter, quad, canyoning, rafting) add rows; quads were the first.
 */
export type TourRouteKind = 'road' | 'path' | 'trail' | 'piste' | 'water';
export type TourVehicleKind = 'sleigh' | 'walkers' | 'scooter' | 'quad' | 'raft' | 'canyoner';

/**
 * Requirements of a WATER route (Phase 6 Task 24, docs/water-tours.md): the route is a slice of a waterway, downstream from a put-in tile within
 * `putIn` tiles of the base footprint, to a take-out. `minLen` / `maxLen` of the def bound the slice (tiles).
 */
export interface WaterReq {
  /** Put-in reach: a waterway tile within this many tiles (Chebyshev) of the footprint. */
  putIn: number;
  /** Rafting: tiles of flow class >= `minClass` (0 calm, 1 brisk, 2 rapids) needed on the slice. Absent = no flow requirement. */
  flow?: { minClass: 1 | 2; minTiles: number };
  /** Canyoning: tiles whose drop is >= `minDrop` half-steps per tile (over a +-1 tile window) needed on the slice. */
  steep?: { minDrop: number; minTiles: number };
  /** Canyoning: rock / steep-bank tiles (a gorge) within `radius` of the slice, at least `minTiles` of them. */
  gorge?: { radius: number; minTiles: number };
  /** Tiles kept downstream of the last qualifying tile (the take-out). */
  tail: number;
  /** Thrill: extra happiness of a full rapids run (scaled by rapids tiles / `thrillTiles`) and the share by which the price the guests find fair rises. */
  thrill?: { happiness: number; tolerance: number; tiles: number };
  /** Minor mishap chance per finished ride (guided / unguided); a MINOR injury incident, nobody dies. */
  mishap?: { guided: number; unguided: number };
  /** Message shown when the placement / route fails (the reason; the detail says what is missing). */
  need: string;
}

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
  /** Water tours (Task 24): the route is a waterway slice; see `WaterReq`. */
  water?: WaterReq;
  /** One way ride (water: downstream then shuttle back): carriers do not turn around at the end. */
  oneWay?: boolean;
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
  /**
   * Rafting Base (Phase 6 Task 24, docs/water-tours.md): guided summer raft runs DOWNSTREAM along a river or stream from a put-in within 3 tiles of the base.
   * Needs brisk (or rapids) flow on 6+ tiles, 12-40 tiles long. Quiet (not motorised: no wildlife scare, sustainability neutral). Rapids raise the thrill:
   * more happiness and a higher price the guests find fair. Closes when the water runs low (late summer), freezes, or in a storm.
   */
  raftingBase: {
    id: 'raftingBase', routes: ['water'], oneWay: true, motorised: false, minLen: 12, maxLen: 40,
    durationTicks: 14, intervalTicks: 20, firstHour: 10, lastHour: 16, seats: 8, minRiders: 2,
    seasons: ['summer'], maxWind: 0.7, maxInstability: 1.5,
    appeal: [0.5, 0.45, 0.35, 0.3, 0.2, 1], happiness: 0.16,
    sustainPerDeparture: 0, noiseRadius: 0, vehicle: 'raft', vehicles: 2,
    water: {
      putIn: 3, flow: { minClass: 1, minTiles: 6 }, tail: 2,
      thrill: { happiness: 0.12, tolerance: 0.25, tiles: 6 },
      mishap: { guided: 0.004, unguided: 0.012 },
      need: 'Needs a river or stream with brisk flow within 3 tiles',
    },
  },
  /**
   * Canyoning Base (Phase 6 Task 24): guided summer descents of a steep stream through a rocky gorge (abseils and water slides). Needs 5+ steep tiles
   * (>= 1 half-step drop per tile) and a gorge (rock or steep banks, 6+ tiles) along 8-30 tiles of stream. Works on natural or dug streams at any flow.
   */
  canyoningBase: {
    id: 'canyoningBase', routes: ['water'], oneWay: true, motorised: false, minLen: 8, maxLen: 30,
    durationTicks: 18, intervalTicks: 30, firstHour: 10, lastHour: 15, seats: 6, minRiders: 2,
    seasons: ['summer'], maxWind: 0.7, maxInstability: 1.5,
    appeal: [0.6, 0.35, 0.05, 0.1, 0.25, 1], happiness: 0.2,
    sustainPerDeparture: 0, noiseRadius: 0, vehicle: 'canyoner', vehicles: 3,
    water: {
      putIn: 3, steep: { minDrop: 1, minTiles: 5 }, gorge: { radius: 2, minTiles: 6 }, tail: 1,
      thrill: { happiness: 0.08, tolerance: 0.15, tiles: 6 },
      mishap: { guided: 0.005, unguided: 0.015 },
      need: 'Needs a steep stream through rock within 3 tiles',
    },
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
  /** Message when no water slice qualifies (Task 24); the per-def `water.need` is the precise one. */
  waterStub: 'Needs a river with enough flow: dig one in Landscape',
} as const;

export const tourDefOf = (buildingType: string): TourDef | undefined => TOUR_DEFS[buildingType];
