import type { ViewpointSpec } from './viewpoints';

export type BuildingCategory =
  | 'core' | 'services' | 'lodging' | 'kids' | 'safety' | 'operations'
  | 'snow' | 'water' | 'recreation' | 'transport' | 'misc' | 'energy';

/** How a building must be connected. Missing access never blocks placement: the building is inactive ('Not connected'). */
export type AccessKind = 'road' | 'path' | 'rail+path' | 'pisteEdge' | 'trail' | 'none';
/** forbid: not on piste tiles; allow: on or off; edge: not ON a piste tile, meant to sit beside one. */
export type PisteRule = 'forbid' | 'allow' | 'edge';
export type SlopeKind = 'any' | 'flat' | 'gentleSlope';
/** default: auto-flatten is ON by default (toggle off allowed); optional: off by default; never: terrain is never touched. */
export type AutoFlattenPolicy = 'default' | 'optional' | 'never';

export interface SiteRule {
  /** Max corner spread across the footprint (half-steps) tolerated without flattening. Infinity = any slope. */
  maxSlope: number;
  slopeKind: SlopeKind;
  autoFlatten: AutoFlattenPolicy;
  /** never: no water tiles; lakeEdge: dry footprint touching a lake; shallow: may overlap lake tiles (never streams). */
  onWater: 'never' | 'lakeEdge' | 'shallow';
  /** Footprint may sit on Rock tiles. */
  allowRock?: boolean;
  /** Custom reason shown when the slope rule fails (default 'Too steep'). */
  slopeMessage?: string;
  /** Mean footprint corner height bounds (half-steps). */
  minAltitude?: number;
  maxAltitude?: number;
  /**
   * Needs forest around it (treehouse): at least `minTrees` real trees within `radius` tiles of the footprint (Chebyshev ring, footprint included).
   * Refused with 'Needs forest around it'. `keepTrees` (default true): the trees under the footprint and around it are NOT felled when placing.
   * Without tree data in the placement env the rule cannot be judged and passes.
   */
  forest?: { minTrees: number; radius: number; keepTrees?: boolean };
}

/** Chimney top in building-local mesh coordinates: x/z from the footprint centre, y above ground (before rotation). Drives winter wood-fire smoke. */
export interface ChimneySpec { x: number; y: number; z: number }

export type NeedCondition = 'snow' | 'snowFree' | 'cold' | 'warm';
/** When a building is useful: all year, ski season (winter), summer season, or on snow-free ground (spring to autumn: 'shoulder'). Drives the drawer ordering. */
export type SeasonUse = 'all' | 'winter' | 'summer' | 'shoulder';

export interface BuildingDef {
  id: string;
  name: string;
  category: BuildingCategory;
  w: number;
  h: number;
  cost: number;
  upkeep: number; // per day
  requires: string[]; // prerequisite building ids (hard unlock)
  access: AccessKind;
  /** Alternative accesses: satisfied if ANY of access/altAccess holds. */
  altAccess?: AccessKind[];
  pisteRule: PisteRule;
  site: SiteRule;
  /** Max simultaneous instances (e.g. one Base Lodge). */
  maxCount?: number;
  /** May stand on rail tiles (Train Station: the platform sits on the end of the line; the rail stays in Networks, drawn under the platform). */
  overRail?: boolean;
  /** Neutral ghost tip shown while access is missing. */
  placeTip?: string;
  lakeAdjacent?: boolean; // must touch lake tile (derived from site.onWater === 'lakeEdge')
  /** Must touch a stream tile (small hydro). Evaluated like the lake rule: breaking it makes the building inactive. */
  streamAdjacent?: boolean;
  /** @deprecated derived from `site` for older UI code; use `site` / describeRules(). */
  needsFlat: boolean;
  /** @deprecated derived: site.onWater === 'shallow'. */
  allowOnWater?: boolean;
  /** @deprecated mirrors site.minAltitude / site.maxAltitude. */
  minAltitude?: number;
  maxAltitude?: number;
  meshBuilder: string;
  needs?: NeedCondition[];
  /** Season relevance (see SeasonUse): sorts the Buildings drawer, never blocks placement. */
  season: SeasonUse;
  staff: number;
  capacity: number;
  /** Conditional dependency: active via depot or walking distance (see Dependencies). */
  shuttleDependent?: boolean;
  /** Needs a Reservoir or natural lake nearby instead of strict `requires`. */
  waterSource?: boolean;
  /** Service radius in tiles (euclidean, from footprint centre). See sim/Coverage. */
  serviceRadius?: number;
  /** Which coverage map this building feeds ('pipe' = reservoir pipe range, no map). */
  coverageKind?: 'firstAid' | 'patrol' | 'grooming' | 'snowmaking' | 'warning' | 'heli' | 'wildlife' | 'pipe';
  /** Chimney top offset (see ChimneySpec). Only buildings with a wood fire / stove have one. */
  chimney?: ChimneySpec;
  /** Viewpoint POI (Phase 6 Task 6, docs/viewpoints.md): hikers choose it as a goal, stop longer, gain happiness; a photo-mode spot. */
  viewpoint?: ViewpointSpec;
}

type SiteIn = Partial<SiteRule>;
interface Rules { access: AccessKind; pisteRule?: PisteRule; site?: SiteIn; altAccess?: AccessKind[]; maxCount?: number; overRail?: boolean; placeTip?: string }

const FLAT: SiteRule = { maxSlope: 1, slopeKind: 'flat', autoFlatten: 'default', onWater: 'never' };

/** Season relevance per id where the needs don't say it (winter operations, summer attractions); else derived from `needs`. */
const SEASON_OVERRIDE: Record<string, SeasonUse> = {
  apresBar: 'winter', skiSchoolHQ: 'winter', groomerGarage: 'winter', snowcatOutpost: 'winter',
  playground: 'shoulder', campground: 'summer', pettingZoo: 'summer',
};
function seasonFor(id: string, needs: NeedCondition[] | undefined): SeasonUse {
  const o = SEASON_OVERRIDE[id];
  if (o) return o;
  if (needs?.some((n) => n === 'snow' || n === 'cold')) return 'winter';
  if (needs?.some((n) => n === 'warm' || n === 'snowFree')) return 'summer';
  return 'all';
}

function b(id: string, name: string, category: BuildingCategory, w: number, h: number, cost: number, upkeep: number, rules: Rules, extra: Partial<BuildingDef> = {}): BuildingDef {
  const site: SiteRule = { ...FLAT, ...rules.site };
  return {
    id, name, category, w, h, cost, upkeep, requires: [], meshBuilder: id, staff: 0, capacity: 0, season: seasonFor(id, extra.needs),
    access: rules.access, altAccess: rules.altAccess, pisteRule: rules.pisteRule ?? 'forbid', site, maxCount: rules.maxCount, overRail: rules.overRail, placeTip: rules.placeTip,
    lakeAdjacent: site.onWater === 'lakeEdge' ? true : undefined,
    needsFlat: site.slopeKind === 'flat' && site.maxSlope <= 1, allowOnWater: site.onWater === 'shallow', minAltitude: site.minAltitude, maxAltitude: site.maxAltitude,
    ...extra,
  };
}

const HUT: SiteIn = { maxSlope: 2, slopeKind: 'any', autoFlatten: 'optional', allowRock: true };
const ANY: SiteIn = { maxSlope: Infinity, slopeKind: 'any', autoFlatten: 'never', allowRock: true };

export const BUILDINGS: Record<string, BuildingDef> = Object.fromEntries([
  b('baseLodge', 'Base Lodge', 'core', 4, 3, 8000, 40, { access: 'road', maxCount: 1 }, { staff: 4, capacity: 200, chimney: { x: -1.4, y: 1.8, z: -0.5 } }),
  b('lodge', 'Lodge/Restaurant', 'services', 4, 3, 6000, 30, { access: 'road' }, { staff: 3, capacity: 120, chimney: { x: 1.2, y: 1.7, z: -0.5 } }),
  b('cafe', 'Café', 'services', 2, 2, 2500, 12, { access: 'path', altAccess: ['pisteEdge'] }, { staff: 1, capacity: 30, chimney: { x: 0, y: 1.4, z: -0.1 } }),
  // Mid-mountain café (own mesh): reachable by a path or simply next to a piste.
  b('mountainHut', 'Mountain Hut', 'services', 2, 2, 3500, 14, { access: 'pisteEdge', altAccess: ['path', 'trail'], pisteRule: 'edge', site: HUT }, { staff: 1, capacity: 24, chimney: { x: 0.35, y: 1.25, z: -0.35 } }),
  // Après-Ski Bar: cosy timber bar with a terrace; the evening crowd magnet (winter 16:00-22:00). Road or path access.
  b('apresBar', 'Après-Ski Bar', 'services', 4, 3, 7000, 28, { access: 'road', altAccess: ['path'] }, { staff: 4, capacity: 70, chimney: { x: 1.25, y: 1.8, z: -0.45 } }),
  b('shop', 'Shop', 'services', 2, 2, 2000, 10, { access: 'path' }, { staff: 1, capacity: 20 }),
  b('rental', 'Rental', 'services', 3, 2, 3000, 15, { access: 'road' }, { staff: 2, capacity: 40 }),
  b('chalet', 'Chalet', 'lodging', 3, 3, 5000, 20, { access: 'path' }, { capacity: 12, chimney: { x: -0.7, y: 1.8, z: -0.5 } }),
  b('apartment', 'Apartment', 'lodging', 3, 4, 9000, 30, { access: 'path' }, { capacity: 40, chimney: { x: 1.0, y: 2.9, z: -0.7 } }),
  b('skiSchoolHQ', 'Ski School HQ', 'kids', 3, 3, 6000, 25, { access: 'path' }, { staff: 3, capacity: 30 }),
  b('magicCarpet', 'Magic Carpet', 'kids', 1, 6, 3000, 10, { access: 'path', altAccess: ['pisteEdge'], pisteRule: 'allow', site: { maxSlope: 2, slopeKind: 'gentleSlope', autoFlatten: 'never' } }, { requires: ['skiSchoolHQ'], needs: ['snow'], capacity: 10 }),
  b('kidsGround', 'Kids Ground', 'kids', 4, 4, 2500, 8, { access: 'path', site: { maxSlope: 2, slopeKind: 'any', autoFlatten: 'optional' } }, { requires: ['skiSchoolHQ'], needs: ['snow'], capacity: 25 }),
  b('playground', 'Playground', 'kids', 3, 3, 1800, 6, { access: 'path' }, { requires: ['skiSchoolHQ'], needs: ['snowFree'], capacity: 25 }),
  b('patrolHub', 'Ski Patrol Hub', 'safety', 3, 2, 4000, 20, { access: 'road' }, { staff: 2, serviceRadius: 30, coverageKind: 'patrol' }),
  b('firstAid', 'First-Aid Hut', 'safety', 2, 2, 1800, 8, { access: 'none', pisteRule: 'edge', site: HUT }, { requires: ['patrolHub'], staff: 1, serviceRadius: 18, coverageKind: 'firstAid' }),
  b('helipad', 'Helipad', 'safety', 3, 3, 7000, 30, { access: 'none' }, { requires: ['patrolHub'], staff: 1, serviceRadius: 64, coverageKind: 'heli' }),
  // Ranger Station: wildlife management (hazing, relocation, bear-proof bins). Works alone; better inside Ski Patrol coverage (shared dispatch, not required).
  b('rangerStation', 'Ranger Station', 'safety', 4, 3, 9000, 25, { access: 'road', altAccess: ['path', 'trail'], site: { maxSlope: 2, slopeKind: 'any', autoFlatten: 'default' } }, { staff: 2, serviceRadius: 35, coverageKind: 'wildlife', chimney: { x: -1.15, y: 1.5, z: -0.6 } }),
  b('groomerGarage', 'Groomer Garage', 'operations', 3, 3, 5000, 20, { access: 'road' }, { staff: 2 }),
  b('liftWorkshop', 'Lift Maintenance Workshop', 'operations', 3, 3, 6000, 25, { access: 'road' }, { staff: 2 }),
  b('snowcatOutpost', 'Snowcat Outpost', 'operations', 2, 2, 3000, 12, { access: 'none', site: HUT }, { requires: ['groomerGarage'], staff: 1, serviceRadius: 28, coverageKind: 'grooming' }),
  b('reservoir', 'Reservoir', 'snow', 4, 4, 7000, 15, { access: 'none' }, { staff: 1, serviceRadius: 24, coverageKind: 'pipe' }),
  b('snowCannon', 'Snowmaking Cannon', 'snow', 1, 1, 800, 5, { access: 'none', pisteRule: 'allow', site: ANY }, { waterSource: true, needs: ['cold'], serviceRadius: 10, coverageKind: 'snowmaking' }),
  b('boatRental', 'Boat Rental', 'water', 2, 2, 2500, 10, { access: 'path', site: { maxSlope: 2, onWater: 'lakeEdge', autoFlatten: 'optional' } }, { waterSource: true, needs: ['warm'], staff: 1 }),
  b('beach', 'Beach', 'water', 4, 3, 3000, 8, { access: 'path', site: { onWater: 'lakeEdge' } }, { waterSource: true, needs: ['warm'], capacity: 40 }),
  b('iceRink', 'Ice Rink', 'recreation', 5, 4, 5000, 18, { access: 'path' }, { needs: ['cold'], capacity: 40 }),
  b('heatedTerrace', 'Heated Terrace', 'recreation', 3, 3, 3500, 14, { access: 'path' }, { needs: ['cold'], capacity: 30, chimney: { x: 0, y: 1.3, z: -0.9 } }),
  b('stuntPark', 'Stunt Park', 'recreation', 6, 4, 9000, 25, { access: 'path', altAccess: ['pisteEdge'], pisteRule: 'allow' }, { needs: ['snow'], capacity: 30 }),
  b('adventurePark', 'Adventure Park', 'recreation', 6, 6, 9000, 25, { access: 'path', altAccess: ['trail'] }, { needs: ['snowFree'], capacity: 60 }),
  b('trainStation', 'Train Station', 'transport', 4, 2, 10000, 30, { access: 'rail+path', maxCount: 1, overRail: true, placeTip: 'Place the station on the end of a rail line, with a footpath next to it' }, { shuttleDependent: true, capacity: 150 }),
  b('altiport', 'Altiport', 'transport', 8, 3, 15000, 40, { access: 'road', maxCount: 1, site: { slopeMessage: 'Runway must be flat' } }, { shuttleDependent: true, capacity: 60 }),
  b('shuttleDepot', 'Shuttle Bus Depot', 'transport', 3, 3, 4000, 20, { access: 'road' }, { staff: 2 }),
  b('warningSign', 'Warning Sign', 'safety', 1, 1, 100, 0, { access: 'none', pisteRule: 'allow', site: ANY }, { serviceRadius: 8, coverageKind: 'warning' }),
  b('parking', 'Parking', 'services', 5, 4, 3000, 8, { access: 'road' }, { capacity: 80 }),
  // Alpine Farm: barn + shop + fenced pasture. Shop is a summer family attraction; its cheese/milk lifts restaurant income a little. Cows/sheep/goats graze the meadows (sim/nature/Livestock).
  b('alpineFarm', 'Alpine Farm', 'recreation', 6, 5, 7000, 20, { access: 'path', altAccess: ['road', 'trail'], site: { maxSlope: 2, slopeKind: 'any', autoFlatten: 'optional' } }, { needs: ['snowFree'], staff: 1, capacity: 30, chimney: { x: -2.3, y: 1.7, z: -1.6 } }),
  // ---- Energy group (item F, docs/energy.md): generators feed the resort grid (sim/Energy), capped so energy is never free; nursery + recycling are the other green parts ----
  // Solar array: ground-mounted field; a footpath or road for maintenance. Gentle slopes only (panels sit on frames).
  b('solarArray', 'Solar Array', 'energy', 3, 2, 6500, 1.5, { access: 'path', altAccess: ['road'], site: { maxSlope: 2, slopeKind: 'any', autoFlatten: 'optional' } }, {}),
  b('solarPlant', 'Solar Plant', 'energy', 5, 4, 16000, 4, { access: 'road', altAccess: ['path'], site: { maxSlope: 2, slopeKind: 'any', autoFlatten: 'optional' } }, {}),
  // Wind turbine: exposed ground only (the upper third of the terrain); tall, slim, spins with the wind, shuts down in a storm.
  b('windTurbine', 'Wind Turbine', 'energy', 2, 2, 10000, 3, { access: 'path', altAccess: ['road'], site: { maxSlope: 3, slopeKind: 'any', autoFlatten: 'optional', minAltitude: 20, allowRock: true } }, {}),
  // Small hydro: must stand on a stream bank (the stream stays free: never ON the water). Seasonal flow.
  b('smallHydro', 'Small Hydro', 'energy', 3, 2, 11000, 3, { access: 'path', altAccess: ['road'], site: { maxSlope: 3, slopeKind: 'any', autoFlatten: 'optional', allowRock: true } }, { streamAdjacent: true }),
  // Biomass heating: burns timber from cleared trees (and forestry residue); wood-fire smoke from the stack.
  b('biomassHeating', 'Biomass Heating', 'energy', 3, 3, 5000, 1.5, { access: 'road' }, { chimney: { x: 0.9, y: 2.3, z: -0.6 } }),
  b('treeNursery', 'Tree Nursery', 'energy', 3, 3, 3000, 2.5, { access: 'path', altAccess: ['road'], site: { maxSlope: 2, slopeKind: 'any', autoFlatten: 'optional' } }, {}),
  b('recyclingCentre', 'Recycling & Compost Centre', 'energy', 3, 2, 2500, 2, { access: 'road', altAccess: ['path'] }, {}),
  // Eco Centre (docs/eco.md): level-4 education centre; hosts the Eco programme (policies with running costs and a bounded sustainability payoff).
  b('ecoCentre', 'Eco Centre', 'energy', 4, 3, 20000, 18, { access: 'road', altAccess: ['path'], maxCount: 1, site: { maxSlope: 2, slopeKind: 'any', autoFlatten: 'optional' } }, {}),
  // Toilets (Phase 6 Task 7, docs/comfort.md): 1x1 hut on a path, a trail or beside a piste; free to use, small upkeep. Restores the comfort need.
  b('toilets', 'Toilets', 'services', 1, 1, 600, 3, { access: 'path', altAccess: ['trail', 'pisteEdge'], pisteRule: 'edge', site: HUT }, { capacity: 4, placeTip: 'Place toilets beside a path, a trail or a piste' }),
  // Campground (Phase 6 Task 19, docs/campground.md): budget summer lodging with a campfire as the centrepiece. Hikers pitch tents: footpath or trail (+25% upkeep when supplied on foot only). Lodging v2: seasonOpen summer, tier budget.
  b('campground', 'Campground', 'lodging', 5, 4, 3500, 8, { access: 'path', altAccess: ['trail'], site: { maxSlope: 2, slopeKind: 'any', autoFlatten: 'optional' } }, { capacity: 16, chimney: { x: 0.05, y: 0.42, z: 0.17 }, placeTip: 'Place the campground beside a footpath or hiking trail, on gentle ground' }),
  // Petting zoo (Phase 6 Task 20, docs/petting-zoo.md): 3x3 fenced pen with goats, sheep, rabbits and a donkey; a summer family attraction on a footpath. Standalone (no farm needed).
  b('pettingZoo', 'Petting Zoo', 'recreation', 3, 3, 3000, 10, { access: 'path', site: { maxSlope: 2, slopeKind: 'any', autoFlatten: 'optional' } }, { needs: ['snowFree'], staff: 1, capacity: 20 }),
  b('ticketOffice', 'Ticket Office', 'services', 2, 2, 2000, 10, { access: 'path' }, { staff: 1 }),
].map((d) => [d.id, d]));
