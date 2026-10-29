import type { AccessKind, PisteRule } from './buildings';

export type LiftKind = 'tbar' | 'chair2' | 'chair4' | 'chair4d' | 'chair6' | 'chair6b' | 'chair8b' | 'gondola6' | 'gondola10' | 'cablecar' | 'funicular';

/** Old ids kept loadable (saves, tests): 'chairlift' -> 'chair4', 'gondola' -> 'gondola6'. */
export const LIFT_ALIASES: Record<string, LiftKind> = { chairlift: 'chair4', gondola: 'gondola6' };
export const LIFT_KIND_IDS: readonly LiftKind[] = ['tbar', 'chair2', 'chair4', 'chair4d', 'chair6', 'chair6b', 'chair8b', 'gondola6', 'gondola10', 'cablecar', 'funicular'];
/** Map any (possibly legacy) id to a canonical LiftKind. */
export function normalizeLiftKind(k: string): LiftKind { return (LIFT_ALIASES[k] ?? k) as LiftKind; }
/** Visual family of a kind (mesh / station styling). */
export type LiftFamily = 'tbar' | 'chair' | 'gondola' | 'cablecar' | 'funicular';

export interface LiftDef {
  id: LiftKind;
  name: string;
  family: LiftFamily;
  speed: number; // tiles/s
  /** Riders per carrier (chair seats / cabin size). */
  capacityPerCarrier: number;
  carrierSpacing: number; // tiles between carriers
  maxLength: number; // tiles
  /** Max AVERAGE gradient (rise/run of bottom->top station ground). See balance.ts 'Lift gradients'. */
  maxGradient: number;
  /** Max LOCAL gradient of any cable/track segment between supports (towers/trestles may steepen short sections). */
  maxLocalGradient: number;
  towerSpacing: number; // tiles
  carriesBikes: boolean;
  costPerMetre: number;
  /** Cost of ONE station (two are built). */
  stationCost: number;
  reversible: boolean;
  /** Detachable grips: carriers slow down in stations => easier boarding, faster line speed. Fixed-grip: false. */
  detachable: boolean;
  /** May have 1-2 intermediate stations (N-station lifts, docs/mid-stations.md): gondolas, cable cars and detachable chairs. Derived in `mk`. */
  midStations: boolean;
  /** Weather bubble / enclosed cabin. */
  bubble: boolean;
  /** Ride comfort 0..1 (guest happiness while riding). */
  comfort: number;
  /** Wind tolerance 0..1: closes in a storm when the wind (0.55..1) exceeds this. 1 = never closes. */
  windTolerance: number;
  /** Running energy cost, dollars per operating hour at 500 m length, full speed. */
  energyPerHour: number;
  /** Upkeep multiplier vs the base per-metre rate. */
  upkeepFactor: number;
  /** Wear multiplier (1 = chairlift). */
  wearRate: number;
  /** Boarding duration (s) added to the cycle for fixed grips: 0 for detachable. */
  loadTimeS: number;
  /** Bottom station: guests walk to it. Missing access => lift reported 'Not connected' (never blocks building). */
  bottomAccess: AccessKind;
  /** Top station: reached by lift/piste, no access needed. */
  topAccess: AccessKind;
  /** Stations/towers may stand on piste tiles (they sit at piste ends / pistes run under cables). Never on buildings/water. */
  stationPiste: PisteRule;
  towerPiste: PisteRule;
  /** Stations: flat footprint with auto-flatten default ON; towers never flatten. */
  stationAutoFlatten: 'default';
}

type Row = Omit<LiftDef, 'id' | 'name' | 'bottomAccess' | 'topAccess' | 'stationPiste' | 'towerPiste' | 'stationAutoFlatten' | 'reversible' | 'family' | 'midStations'>;
const mk = (id: LiftKind, name: string, family: LiftFamily, r: Row, reversible = false): LiftDef => ({
  id, name, family, ...r, reversible, midStations: family === 'gondola' || family === 'cablecar' || (family === 'chair' && r.detachable), bottomAccess: 'path', topAccess: 'none', stationPiste: 'allow', towerPiste: 'allow', stationAutoFlatten: 'default',
});

export const LIFTS: Record<LiftKind, LiftDef> = {
  tbar: mk('tbar', 'T-Bar', 'tbar', { speed: 2.5, capacityPerCarrier: 2, carrierSpacing: 6, maxLength: 40, maxGradient: 0.6, maxLocalGradient: 0.9, towerSpacing: 8, carriesBikes: false, costPerMetre: 40, stationCost: 1500, detachable: false, bubble: false, comfort: 0.3, windTolerance: 0.55, energyPerHour: 5, upkeepFactor: 0.8, wearRate: 0.9, loadTimeS: 4 }),
  chair2: mk('chair2', 'Chairlift (2-seat, fixed)', 'chair', { speed: 3, capacityPerCarrier: 2, carrierSpacing: 6, maxLength: 60, maxGradient: 0.9, maxLocalGradient: 1.3, towerSpacing: 9, carriesBikes: true, costPerMetre: 65, stationCost: 3000, detachable: false, bubble: false, comfort: 0.4, windTolerance: 0.6, energyPerHour: 6, upkeepFactor: 0.9, wearRate: 1.0, loadTimeS: 4 }),
  chair4: mk('chair4', 'Chairlift (4-seat, fixed)', 'chair', { speed: 4, capacityPerCarrier: 4, carrierSpacing: 8, maxLength: 80, maxGradient: 0.9, maxLocalGradient: 1.3, towerSpacing: 10, carriesBikes: true, costPerMetre: 90, stationCost: 6000, detachable: false, bubble: false, comfort: 0.5, windTolerance: 0.65, energyPerHour: 10, upkeepFactor: 1.0, wearRate: 1.0, loadTimeS: 4 }),
  chair4d: mk('chair4d', 'Chairlift (4-seat, detachable)', 'chair', { speed: 5, capacityPerCarrier: 4, carrierSpacing: 8, maxLength: 90, maxGradient: 0.95, maxLocalGradient: 1.4, towerSpacing: 11, carriesBikes: true, costPerMetre: 120, stationCost: 12000, detachable: true, bubble: false, comfort: 0.62, windTolerance: 0.7, energyPerHour: 14, upkeepFactor: 1.1, wearRate: 1.1, loadTimeS: 0 }),
  chair6: mk('chair6', 'Chairlift (6-seat, detachable)', 'chair', { speed: 5.5, capacityPerCarrier: 6, carrierSpacing: 9, maxLength: 100, maxGradient: 0.95, maxLocalGradient: 1.4, towerSpacing: 12, carriesBikes: true, costPerMetre: 150, stationCost: 18000, detachable: true, bubble: false, comfort: 0.7, windTolerance: 0.75, energyPerHour: 18, upkeepFactor: 1.2, wearRate: 1.15, loadTimeS: 0 }),
  chair6b: mk('chair6b', 'Chairlift (6-seat, bubble)', 'chair', { speed: 5.5, capacityPerCarrier: 6, carrierSpacing: 9, maxLength: 100, maxGradient: 0.95, maxLocalGradient: 1.4, towerSpacing: 12, carriesBikes: true, costPerMetre: 180, stationCost: 22000, detachable: true, bubble: true, comfort: 0.85, windTolerance: 0.85, energyPerHour: 20, upkeepFactor: 1.3, wearRate: 1.2, loadTimeS: 0 }),
  chair8b: mk('chair8b', 'Chairlift (8-seat, bubble)', 'chair', { speed: 6, capacityPerCarrier: 8, carrierSpacing: 10, maxLength: 110, maxGradient: 1.0, maxLocalGradient: 1.45, towerSpacing: 13, carriesBikes: true, costPerMetre: 220, stationCost: 30000, detachable: true, bubble: true, comfort: 0.9, windTolerance: 0.88, energyPerHour: 26, upkeepFactor: 1.4, wearRate: 1.25, loadTimeS: 0 }),
  gondola6: mk('gondola6', 'Gondola (6-person)', 'gondola', { speed: 6, capacityPerCarrier: 6, carrierSpacing: 10, maxLength: 140, maxGradient: 1.1, maxLocalGradient: 1.6, towerSpacing: 14, carriesBikes: true, costPerMetre: 170, stationCost: 25000, detachable: true, bubble: true, comfort: 0.92, windTolerance: 0.9, energyPerHour: 24, upkeepFactor: 1.3, wearRate: 1.2, loadTimeS: 0 }),
  gondola10: mk('gondola10', 'Gondola (10-person)', 'gondola', { speed: 6.5, capacityPerCarrier: 10, carrierSpacing: 12, maxLength: 160, maxGradient: 1.1, maxLocalGradient: 1.6, towerSpacing: 15, carriesBikes: true, costPerMetre: 240, stationCost: 40000, detachable: true, bubble: true, comfort: 0.95, windTolerance: 0.92, energyPerHour: 34, upkeepFactor: 1.5, wearRate: 1.3, loadTimeS: 0 }),
  cablecar: mk('cablecar', 'Cable Car', 'cablecar', { speed: 7, capacityPerCarrier: 40, carrierSpacing: 60, maxLength: 200, maxGradient: 1.5, maxLocalGradient: 3.0, towerSpacing: 40, carriesBikes: true, costPerMetre: 350, stationCost: 60000, detachable: false, bubble: true, comfort: 0.9, windTolerance: 0.95, energyPerHour: 40, upkeepFactor: 1.6, wearRate: 1.4, loadTimeS: 0 }, true),
  funicular: mk('funicular', 'Funicular', 'funicular', { speed: 5, capacityPerCarrier: 60, carrierSpacing: 50, maxLength: 100, maxGradient: 0.7, maxLocalGradient: 1.0, towerSpacing: 0, carriesBikes: false, costPerMetre: 300, stationCost: 50000, detachable: false, bubble: true, comfort: 0.95, windTolerance: 1, energyPerHour: 35, upkeepFactor: 1.4, wearRate: 0.8, loadTimeS: 0 }, true),
};

/** Definition by (possibly legacy) id. */
export function liftDef(kind: string): LiftDef { return LIFTS[normalizeLiftKind(kind)]; }

/** Uphill riders per hour of a loop lift at nominal speed over a cable of `pathLength` tiles (carriers/hour x capacity). */
export function nominalThroughput(def: LiftDef, pathLength: number): number {
  if (def.reversible) return 0;
  const carriers = Math.max(2, Math.floor((2 * pathLength) / def.carrierSpacing));
  return (def.speed / ((2 * pathLength) / carriers)) * 3600 * def.capacityPerCarrier;
}
