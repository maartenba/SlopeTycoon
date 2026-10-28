import { BUILDINGS } from '../config/buildings';
import type { LiftKind } from '../config/lifts';
import type { MapSize } from '../core/GameState';
import { Rng } from '../core/Rng';
import { Layer, NetKind, interpolateStroke, sweepBrush } from '../world/Networks';
import type { TerrainPresetId } from '../world/TerrainPresets';
import { trainStation } from './demoResort';
import { buildStarterResort, type ResortKit } from './starterResort';
import type { Sim } from './createSim';
import { pathQuality, tidyPaths, type PathQuality } from './townPaths';
import type { GuestMix } from './demoResort';

export type TownId = 'alpine' | 'family' | 'luxury' | 'hiking' | 'lakeside' | 'fortress' | 'bigmountain' | 'hamlet' | 'festival' | 'rescue';

/** Where an item is placed relative to the terrain / the already built layout (never fixed coordinates). */
export type Anchor = 'village' | 'road' | 'piste' | 'foot' | 'top' | 'lake' | 'hill' | 'pasture';

export interface TownItem {
  type: string;
  /** Count range (scaled by map size, drawn from the seeded RNG). */
  n: [number, number];
  at: Anchor;
  /** Ring radius (tiles) candidate sites are scattered in. */
  spread?: number;
  /** How far the fallback spiral search may wander. */
  rmax?: number;
}

export interface TownArchetype {
  id: TownId;
  name: string;
  tagline: string;
  /** Recommended map size and every size it is tested on. */
  size: MapSize;
  sizes: readonly MapSize[];
  season: 'winter' | 'summer';
  preset: TerrainPresetId;
  /** Relative pick weight on the title screen. */
  titleWeight: number;
  lifts: LiftKind[];
  pisteDifficulties: number[];
  /** Snowmaking cannons range (0 = none). */
  cannons: [number, number];
  reservoir: boolean;
  /** Hike / MTB trail counts. */
  hike: [number, number];
  mtb: [number, number];
  rail: boolean;
  items: TownItem[];
  guests: GuestMix;
  /** Title guest cap on 128 (scaled down on 64). */
  guestCount: number;
  /** Winter <-> summer flip loop is pleasant for this town (winter towns with summer-friendly content). */
  seasonLoop: boolean;
  /** Failures tolerated per build in tests (arbitrary seeds can lack a lake, flat spot ...). */
  maxFailures: number;
}

const CORE: TownItem[] = [
  { type: 'parking', n: [1, 1], at: 'road', spread: 4, rmax: 14 },
  { type: 'ticketOffice', n: [1, 1], at: 'village', spread: 3, rmax: 12 },
  { type: 'lodge', n: [1, 1], at: 'village', spread: 7, rmax: 14 },
];
const SNOW_SERVICES: TownItem[] = [
  { type: 'skiSchoolHQ', n: [1, 1], at: 'village', spread: 7, rmax: 12 },
  { type: 'magicCarpet', n: [1, 1], at: 'foot', spread: 5, rmax: 16 },
  { type: 'patrolHub', n: [1, 1], at: 'road', spread: 5, rmax: 16 },
  { type: 'firstAid', n: [1, 1], at: 'piste', spread: 4, rmax: 16 },
  { type: 'groomerGarage', n: [1, 1], at: 'road', spread: 6, rmax: 18 },
  { type: 'snowcatOutpost', n: [1, 1], at: 'piste', spread: 5, rmax: 10 },
];

export const TOWNS: readonly TownArchetype[] = [
  {
    id: 'alpine', name: 'Alpine Village', tagline: 'Compact chalet cluster, a chair and a T-bar, a church-like lodge and the farm next door',
    size: 128, sizes: [64, 128], season: 'winter', preset: 'balanced', titleWeight: 3,
    lifts: ['chair4d', 'tbar'], pisteDifficulties: [1, 0, 2], cannons: [3, 5], reservoir: true, hike: [1, 1], mtb: [1, 1], rail: true,
    guests: 'skiers', guestCount: 240, seasonLoop: true, maxFailures: 5,
    items: [...CORE, ...SNOW_SERVICES,
      { type: 'chalet', n: [4, 6], at: 'village', spread: 9, rmax: 22 }, { type: 'alpineFarm', n: [1, 1], at: 'pasture', spread: 10, rmax: 30 },
      { type: 'mountainHut', n: [1, 1], at: 'piste', spread: 5, rmax: 12 }, { type: 'cafe', n: [1, 1], at: 'village', spread: 8, rmax: 14 },
      { type: 'shop', n: [1, 2], at: 'village', spread: 7, rmax: 14 }, { type: 'rental', n: [1, 1], at: 'village', spread: 6, rmax: 14 },
      { type: 'heatedTerrace', n: [1, 1], at: 'foot', spread: 5, rmax: 14 }],
  },
  {
    id: 'family', name: 'Family Valley', tagline: 'Ski school, kids ground, playground, magic carpets, an ice rink and many greens',
    size: 128, sizes: [64, 128], season: 'winter', preset: 'gentle', titleWeight: 3,
    lifts: ['chair4', 'tbar', 'chair4d'], pisteDifficulties: [0, 0, 1, 0], cannons: [3, 4], reservoir: true, hike: [1, 1], mtb: [1, 1], rail: false,
    guests: 'mixed', guestCount: 240, seasonLoop: true, maxFailures: 5,
    items: [...CORE, ...SNOW_SERVICES,
      { type: 'kidsGround', n: [1, 1], at: 'foot', spread: 6, rmax: 16 }, { type: 'playground', n: [1, 1], at: 'village', spread: 8, rmax: 26 },
      { type: 'magicCarpet', n: [1, 2], at: 'foot', spread: 7, rmax: 18 }, { type: 'iceRink', n: [1, 1], at: 'village', spread: 9, rmax: 18 },
      { type: 'chalet', n: [2, 3], at: 'village', spread: 9, rmax: 20 }, { type: 'apartment', n: [1, 2], at: 'village', spread: 10, rmax: 20 },
      { type: 'cafe', n: [1, 2], at: 'village', spread: 8, rmax: 16 }, { type: 'heatedTerrace', n: [1, 2], at: 'foot', spread: 7, rmax: 16 },
      { type: 'rental', n: [1, 1], at: 'village', spread: 6, rmax: 14 }, { type: 'shop', n: [1, 1], at: 'village', spread: 7, rmax: 14 }],
  },
  {
    id: 'luxury', name: 'Luxury Resort', tagline: 'Gondola and bubble chair, heated terraces, apartments, an altiport and a VIP après bar',
    size: 128, sizes: [128], season: 'winter', preset: 'gentle', titleWeight: 2,
    lifts: ['gondola10', 'chair6b', 'chair4d'], pisteDifficulties: [2, 1, 3], cannons: [4, 6], reservoir: true, hike: [1, 1], mtb: [0, 1], rail: false,
    guests: 'skiers', guestCount: 220, seasonLoop: true, maxFailures: 6,
    items: [...CORE, ...SNOW_SERVICES,
      { type: 'apartment', n: [3, 4], at: 'village', spread: 11, rmax: 24 }, { type: 'apresBar', n: [1, 1], at: 'foot', spread: 7, rmax: 16 },
      { type: 'heatedTerrace', n: [2, 3], at: 'foot', spread: 8, rmax: 18 }, { type: 'altiport', n: [1, 1], at: 'road', spread: 16, rmax: 44 },
      { type: 'chalet', n: [2, 3], at: 'village', spread: 10, rmax: 22 }, { type: 'shop', n: [1, 2], at: 'village', spread: 8, rmax: 16 },
      { type: 'cafe', n: [1, 1], at: 'village', spread: 8, rmax: 16 }, { type: 'mountainHut', n: [1, 1], at: 'piste', spread: 5, rmax: 12 }],
  },
  {
    id: 'hiking', name: 'Summer Hiking Hub', tagline: 'Hiking and MTB trails, bike lifts, adventure park, a lake beach, huts and cows on the pasture',
    size: 128, sizes: [64, 128], season: 'summer', preset: 'lakeland', titleWeight: 3,
    lifts: ['chair4d', 'gondola6', 'tbar'], pisteDifficulties: [1, 2, 1], cannons: [0, 0], reservoir: false, hike: [3, 4], mtb: [3, 4], rail: false,
    guests: 'hikers', guestCount: 200, seasonLoop: false, maxFailures: 6,
    items: [...CORE,
      { type: 'adventurePark', n: [1, 1], at: 'village', spread: 10, rmax: 24 }, { type: 'beach', n: [1, 1], at: 'lake', spread: 4, rmax: 16 },
      { type: 'boatRental', n: [1, 1], at: 'lake', spread: 5, rmax: 16 }, { type: 'mountainHut', n: [2, 3], at: 'piste', spread: 7, rmax: 14 },
      { type: 'rangerStation', n: [1, 1], at: 'road', spread: 8, rmax: 20 }, { type: 'alpineFarm', n: [1, 1], at: 'pasture', spread: 10, rmax: 30 },
      { type: 'chalet', n: [2, 3], at: 'village', spread: 9, rmax: 20 }, { type: 'patrolHub', n: [1, 1], at: 'road', spread: 6, rmax: 16 },
      { type: 'cafe', n: [1, 2], at: 'village', spread: 8, rmax: 16 }, { type: 'rental', n: [1, 1], at: 'village', spread: 6, rmax: 14 },
      { type: 'shop', n: [1, 1], at: 'village', spread: 7, rmax: 14 }, { type: 'firstAid', n: [1, 1], at: 'piste', spread: 4, rmax: 16 }],
  },
  {
    id: 'lakeside', name: 'Lakeside Beach Town', tagline: 'A lake with beach and boat rental, sightseeing lifts and terraces by the water',
    size: 128, sizes: [128], season: 'summer', preset: 'lakeland', titleWeight: 3,
    lifts: ['gondola6', 'chair4d'], pisteDifficulties: [1, 0], cannons: [0, 0], reservoir: false, hike: [2, 3], mtb: [1, 2], rail: false,
    guests: 'mixed', guestCount: 200, seasonLoop: false, maxFailures: 6,
    items: [...CORE,
      { type: 'beach', n: [1, 1], at: 'lake', spread: 3, rmax: 20 }, { type: 'boatRental', n: [1, 2], at: 'lake', spread: 5, rmax: 20 },
      { type: 'cafe', n: [1, 2], at: 'lake', spread: 8, rmax: 20 }, { type: 'heatedTerrace', n: [1, 1], at: 'lake', spread: 9, rmax: 20 },
      { type: 'boatRental', n: [1, 1], at: 'lake', spread: 8, rmax: 20 }, { type: 'chalet', n: [3, 4], at: 'village', spread: 10, rmax: 22 },
      { type: 'apartment', n: [1, 2], at: 'village', spread: 10, rmax: 22 }, { type: 'shop', n: [1, 2], at: 'village', spread: 7, rmax: 14 },
      { type: 'rental', n: [1, 1], at: 'village', spread: 6, rmax: 14 }, { type: 'mountainHut', n: [1, 1], at: 'piste', spread: 6, rmax: 12 }],
  },
  {
    id: 'fortress', name: 'Snow Fortress', tagline: 'Cannons and a reservoir, groomers and snowcats, a big piste network and a stunt park',
    size: 128, sizes: [64, 128], season: 'winter', preset: 'peaks', titleWeight: 2,
    lifts: ['chair4d', 'chair6b', 'tbar', 'chair4'], pisteDifficulties: [1, 2, 3, 0], cannons: [8, 12], reservoir: true, hike: [0, 1], mtb: [0, 1], rail: false,
    guests: 'skiers', guestCount: 260, seasonLoop: false, maxFailures: 6,
    items: [...CORE, ...SNOW_SERVICES,
      { type: 'stuntPark', n: [1, 1], at: 'piste', spread: 7, rmax: 18 }, { type: 'snowcatOutpost', n: [1, 2], at: 'top', spread: 6, rmax: 14 },
      { type: 'groomerGarage', n: [1, 1], at: 'foot', spread: 8, rmax: 20 }, { type: 'reservoir', n: [1, 1], at: 'top', spread: 7, rmax: 18 },
      { type: 'liftWorkshop', n: [1, 1], at: 'road', spread: 8, rmax: 20 }, { type: 'mountainHut', n: [1, 2], at: 'piste', spread: 6, rmax: 12 },
      { type: 'chalet', n: [1, 2], at: 'village', spread: 9, rmax: 20 }, { type: 'apresBar', n: [1, 1], at: 'foot', spread: 7, rmax: 16 },
      { type: 'rental', n: [1, 1], at: 'village', spread: 6, rmax: 14 }],
  },
  {
    id: 'bigmountain', name: 'Big Mountain', tagline: 'Funicular and cable car, four more lifts, eight pistes, a station, a bus depot and a sprawling village',
    size: 256, sizes: [128, 256], season: 'winter', preset: 'peaks', titleWeight: 2,
    lifts: ['funicular', 'cablecar', 'gondola10', 'chair6b', 'chair4d', 'chair4', 'tbar', 'chair4d'], pisteDifficulties: [1, 2, 3, 0, 2, 1, 0, 2], cannons: [8, 12], reservoir: true, hike: [2, 3], mtb: [1, 2], rail: true,
    guests: 'skiers', guestCount: 300, seasonLoop: true, maxFailures: 10,
    items: [...CORE, ...SNOW_SERVICES,
      { type: 'shuttleDepot', n: [1, 1], at: 'road', spread: 8, rmax: 24 }, { type: 'chalet', n: [5, 7], at: 'village', spread: 14, rmax: 34 },
      { type: 'apartment', n: [3, 4], at: 'village', spread: 14, rmax: 34 }, { type: 'mountainHut', n: [2, 3], at: 'piste', spread: 8, rmax: 16 },
      { type: 'cafe', n: [2, 3], at: 'village', spread: 12, rmax: 26 }, { type: 'shop', n: [2, 3], at: 'village', spread: 12, rmax: 26 },
      { type: 'apresBar', n: [1, 2], at: 'foot', spread: 9, rmax: 20 }, { type: 'liftWorkshop', n: [1, 1], at: 'road', spread: 10, rmax: 26 },
      { type: 'rangerStation', n: [1, 1], at: 'road', spread: 10, rmax: 26 }, { type: 'rental', n: [1, 2], at: 'village', spread: 9, rmax: 24 },
      { type: 'heatedTerrace', n: [1, 2], at: 'foot', spread: 9, rmax: 22 }, { type: 'alpineFarm', n: [1, 1], at: 'pasture', spread: 14, rmax: 40 }],
  },
  {
    id: 'hamlet', name: 'Cosy Hut Hamlet', tagline: 'A tiny hamlet: mountain huts, one T-bar, a few chalets, the ranger station and deer',
    size: 64, sizes: [64, 128], season: 'winter', preset: 'forested', titleWeight: 2,
    lifts: ['tbar'], pisteDifficulties: [0, 1], cannons: [0, 0], reservoir: false, hike: [1, 2], mtb: [0, 1], rail: false,
    guests: 'skiers', guestCount: 120, seasonLoop: true, maxFailures: 4,
    items: [
      { type: 'parking', n: [1, 1], at: 'road', spread: 4, rmax: 14 }, { type: 'ticketOffice', n: [1, 1], at: 'village', spread: 3, rmax: 12 },
      { type: 'lodge', n: [1, 1], at: 'village', spread: 6, rmax: 14 }, { type: 'mountainHut', n: [2, 3], at: 'piste', spread: 6, rmax: 12 },
      { type: 'chalet', n: [2, 3], at: 'village', spread: 8, rmax: 18 }, { type: 'rangerStation', n: [1, 1], at: 'road', spread: 6, rmax: 18 },
      { type: 'skiSchoolHQ', n: [1, 1], at: 'village', spread: 6, rmax: 12 },
      { type: 'magicCarpet', n: [1, 1], at: 'foot', spread: 5, rmax: 16 }, { type: 'cafe', n: [1, 1], at: 'village', spread: 7, rmax: 14 }],
  },
  {
    id: 'festival', name: 'Festival Town', tagline: 'Après bar, terraces, cafés and market shops around a lively square',
    size: 128, sizes: [64, 128], season: 'winter', preset: 'balanced', titleWeight: 2,
    lifts: ['chair4d', 'chair6b'], pisteDifficulties: [1, 2], cannons: [3, 5], reservoir: true, hike: [1, 2], mtb: [1, 1], rail: true,
    guests: 'mixed', guestCount: 260, seasonLoop: true, maxFailures: 5,
    items: [...CORE, ...SNOW_SERVICES,
      { type: 'apresBar', n: [1, 2], at: 'village', spread: 6, rmax: 14 }, { type: 'heatedTerrace', n: [2, 3], at: 'village', spread: 8, rmax: 16 },
      { type: 'cafe', n: [2, 3], at: 'village', spread: 7, rmax: 16 }, { type: 'shop', n: [3, 4], at: 'village', spread: 8, rmax: 16 },
      { type: 'iceRink', n: [1, 1], at: 'village', spread: 10, rmax: 18 }, { type: 'chalet', n: [2, 3], at: 'village', spread: 10, rmax: 20 },
      { type: 'apartment', n: [1, 2], at: 'village', spread: 11, rmax: 22 }, { type: 'rental', n: [1, 1], at: 'village', spread: 6, rmax: 14 }],
  },
  {
    id: 'rescue', name: 'Rescue Base', tagline: 'Patrol hub, heli pad, first aid and rangers: a resort that is ready when it matters',
    size: 128, sizes: [64, 128], season: 'winter', preset: 'peaks', titleWeight: 1.5,
    lifts: ['chair4d', 'gondola6', 'tbar'], pisteDifficulties: [3, 2, 3], cannons: [2, 4], reservoir: true, hike: [1, 2], mtb: [0, 1], rail: false,
    guests: 'skiers', guestCount: 220, seasonLoop: true, maxFailures: 6,
    items: [...CORE, ...SNOW_SERVICES,
      { type: 'helipad', n: [1, 1], at: 'village', spread: 9, rmax: 22 }, { type: 'firstAid', n: [2, 3], at: 'piste', spread: 5, rmax: 16 },
      { type: 'patrolHub', n: [1, 2], at: 'top', spread: 6, rmax: 16 }, { type: 'rangerStation', n: [1, 1], at: 'road', spread: 7, rmax: 20 },
      { type: 'mountainHut', n: [1, 2], at: 'piste', spread: 6, rmax: 12 }, { type: 'chalet', n: [1, 2], at: 'village', spread: 9, rmax: 20 },
      { type: 'warningSign', n: [3, 5], at: 'piste', spread: 4, rmax: 6 }, { type: 'cafe', n: [1, 1], at: 'village', spread: 8, rmax: 16 }],
  },
];

export const TOWN_IDS: readonly TownId[] = TOWNS.map((t) => t.id);
export const townOf = (id: string): TownArchetype | undefined => TOWNS.find((t) => t.id === id);

type Pt = { x: number; y: number };

export interface TownReport {
  archetype: TownId;
  seed: number;
  placed: Record<string, number>;
  lifts: Array<{ id: number; kind: string }>;
  pisteTiles: number;
  pisteMids: Pt[];
  hikeTiles: number;
  mtbTiles: number;
  failures: string[];
  log: string[];
  /** Named sites (camera POIs, checklist). */
  sites: Record<string, Pt>;
  /** 'Niceness' 0..1 (variety, density, piste coverage). */
  score: number;
  /** Footpath tidiness (holes, 2x2 blocks, adjacency, longest spur; docs/demo-towns.md). */
  paths?: PathQuality;
  /** Footpath tiles taken back by the tidy pass. */
  tidied?: number;
  buildMs: number;
}

const rangeOf = (rng: Rng, r: [number, number], scale: number): number => Math.max(r[0] === 0 && r[1] === 0 ? 0 : 1, Math.round(rng.int(r[0], r[1]) * scale));

/** Pure: count multiplier for a map size (64: 0.7, 128: 1, 256: 1.6). */
export const sizeScale = (size: number): number => (size >= 256 ? 1.6 : size >= 128 ? 1 : 0.7);

/** Named sites from a building list: pure, so debug-built towns and tests share it. First building of each kind wins. */
export function townSites(buildings: ReadonlyArray<{ type: string; x: number; y: number; w: number; h: number }>): Record<string, Pt> {
  const map: Record<string, string> = {
    alpineFarm: 'farm', mountainHut: 'hut', beach: 'beach', boatRental: 'boat', trainStation: 'station', altiport: 'altiport', helipad: 'heli',
    apresBar: 'festival', heatedTerrace: 'terrace', stuntPark: 'stunt', adventurePark: 'adventure', rangerStation: 'ranger', iceRink: 'rink', shuttleDepot: 'bus',
  };
  const out: Record<string, Pt> = {};
  for (const b of buildings) {
    const k = map[b.type];
    if (k && !out[k]) out[k] = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }
  return out;
}

/** 'Niceness' of a built town in 0..1: building-type variety, density near the village and piste coverage. */
export function townScore(sim: Sim, pisteTiles: number): number {
  const bs = sim.buildings.all().filter((b) => b.active);
  const types = new Set(bs.map((b) => b.type)).size;
  const lc = bs.find((b) => b.type === 'baseLodge');
  const near = lc ? bs.filter((b) => Math.hypot(b.x - lc.x, b.y - lc.y) < sim.size * 0.2).length : 0;
  const k = sim.size / 128;
  const variety = Math.min(1, types / 14), density = Math.min(1, near / (12 * Math.max(0.6, k))), piste = Math.min(1, pisteTiles / (320 * Math.max(0.6, k)));
  return +(0.4 * variety + 0.3 * density + 0.3 * piste).toFixed(3);
}

/** Validity of a built town (used by tests and the scan): inactive buildings, disconnected pistes, lifts without a piste. */
export function townIssues(sim: Sim): string[] {
  const out: string[] = [];
  for (const b of sim.buildings.all()) if (!b.active) out.push(`inactive ${b.type}: ${b.reason ?? ''}`);
  for (const c of sim.networks.pisteComponents()) if (c.count >= 4 && c.disconnected) out.push(`disconnected piste (${c.count} tiles)`);
  return out;
}

/**
 * Builds a themed town on the sim's map through the real placement / lift / network APIs (free; sim only). Never throws; every step is a
 * site search around terrain anchors (village, road, pistes, lake, pasture) so it works on any map size / seed. Deterministic per (sim, id, seed).
 */
export function buildTown(sim: Sim, id: TownId | string, seed = 1): TownReport {
  const t = townOf(id);
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const out: TownReport = { archetype: (t?.id ?? 'alpine'), seed, placed: {}, lifts: [], pisteTiles: 0, pisteMids: [], hikeTiles: 0, mtbTiles: 0, failures: [], log: [], sites: {}, score: 0, buildMs: 0 };
  if (!t) { out.failures.push(`unknown town "${id}"`); return out; }
  const moneyBefore = sim.game.money;
  sim.progression.withBypass(() => run(sim, t, seed, out));
  sim.game.money = moneyBefore;
  out.sites = townSites(sim.buildings.all());
  out.score = townScore(sim, out.pisteTiles);
  out.paths = pathQuality(sim);
  out.buildMs = typeof performance !== 'undefined' ? performance.now() - t0 : 0;
  return out;
}

function run(sim: Sim, t: TownArchetype, seed: number, out: TownReport): void {
  const rng = new Rng((Math.imul(seed, 0x9e3779b1) ^ (sim.seed * 31) ^ (t.id.length * 977)) >>> 0);
  const scale = sizeScale(sim.size);
  const log = (m: string): void => { out.log.push(m); };
  const existing = new Set(sim.buildings.all().map((b) => b.id));
  const already = sim.lifts.all().length > 0;
  let feet: Pt[] = [];
  try {
    const rep = buildStarterResort(sim, {
      curvedPaths: true,
      lifts: already ? 0 : t.lifts.length, liftKinds: t.lifts, pisteDifficulties: t.pisteDifficulties, skipCore: true,
      pre: (kit) => { if (t.rail) trainStation(sim, kit, { rail: true }, out, log); },
      extra: (kit) => { feet = kit.pisteStroke.filter((l) => l.length).map((l) => ({ ...l[l.length - 1]! })); extras(sim, kit, t, rng, scale, out, log); },
    });
    for (const [k, v] of Object.entries(rep.placed)) out.placed[k] = (out.placed[k] ?? 0) + v;
    out.pisteTiles += rep.pisteTiles;
    for (const l of rep.lifts) out.lifts.push({ id: l.id, kind: l.kind });
    out.failures.push(...rep.failures.filter((f) => !/^cannot place/.test(f))); // attempts that failed on one candidate are retried elsewhere: the counts below are what matters
  } catch (e) {
    out.failures.push(`exception: ${e instanceof Error ? e.message : String(e)}`);
  }
  // never leave dead weight: sites that could not be wired up are taken back
  let swept = false;
  for (const b of [...sim.buildings.all()]) {
    if (existing.has(b.id) || b.active) continue;
    sim.buildings.remove(b.id);
    out.placed[b.type] = Math.max(0, (out.placed[b.type] ?? 1) - 1);
    out.failures.push(`${b.type}: removed (${b.reason ?? 'not connected'})`);
    swept = true;
  }
  const tidied = tidyPaths(sim, feet);
  if (tidied) { out.tidied = tidied; log(`tidied ${tidied} footpath tiles (leftover strokes, ladders, parallel runs)`); }
  const pruned = pruneRoads(sim);
  if (pruned) log(`pruned ${pruned} road tiles (spurs / loops that serve nothing)`);
  if (swept || pruned || tidied) { sim.buildings.reevaluate(); sim.refreshCoverage(undefined, true); }
  // lifts requested but not built are visible in the failure list already ('no lift line N')
}

/**
 * Roads are laid per building while the town is built, and a candidate site that is later rejected (or a second building next to an old road) leaves
 * its road behind: a long spur or an extra U-shaped loop that serves nothing. Keep only the BFS tree paths (from the road entry) to road tiles that
 * touch a building; everything else of the entry's road network is taken back. Deterministic (fixed neighbour order); reverts itself when any
 * building would lose its road service. Returns the number of removed tiles.
 */
export function pruneRoads(sim: Sim): number {
  const net = sim.networks, n = net.size, e = net.roadEntry;
  if (!e) return 0;
  const isRoad = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < n && y < n && net.kind[y * n + x] === NetKind.Road;
  const start = e.y * n + e.x;
  if (!isRoad(e.x, e.y)) return 0;
  const parent = new Int32Array(n * n).fill(-2);
  parent[start] = -1;
  const q = [start];
  const DXY: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  for (let h = 0; h < q.length; h++) {
    const i = q[h]!, x = i % n, y = (i / n) | 0;
    for (const [dx, dy] of DXY) { const nx = x + dx, ny = y + dy; if (!isRoad(nx, ny)) continue; const j = ny * n + nx; if (parent[j] !== -2) continue; parent[j] = i; q.push(j); }
  }
  const keep = new Uint8Array(n * n);
  const need = (x: number, y: number): void => { if (!isRoad(x, y)) return; for (let k = y * n + x; k >= 0 && !keep[k] && parent[k] !== -2; k = parent[k]!) keep[k] = 1; };
  keep[start] = 1;
  const bs = sim.buildings.all();
  for (const b of bs) {
    for (let x = b.x; x < b.x + b.w; x++) { need(x, b.y - 1); need(x, b.y + b.h); }
    for (let y = b.y; y < b.y + b.h; y++) { need(b.x - 1, y); need(b.x + b.w, y); }
  }
  const served = (): number[] => bs.filter((b) => net.isRoadServed(b.id)).map((b) => b.id);
  const before = served(), drop: number[] = [], active0 = new Map(bs.map((b) => [b.id, b.active] as const));
  for (const i of q) if (!keep[i]) drop.push(i);
  if (!drop.length) return 0;
  for (const i of drop) net.unbuild(i % n, (i / n) | 0);
  sim.buildings.reevaluate(); // trails / huts attach through roads too: nothing that was active may go dark
  if (served().length < before.length || bs.some((b) => active0.get(b.id) && !b.active)) { for (const i of drop) net.build(NetKind.Road, i % n, (i / n) | 0); sim.buildings.reevaluate(); return 0; }
  return drop.length;
}

/** Mean corner-height spread over a footprint-sized window (lower = flatter). */
function roughness(sim: Sim, x: number, y: number, r: number): number {
  let lo = Infinity, hi = -Infinity;
  for (let j = -r; j <= r; j += 2) for (let i = -r; i <= r; i += 2) {
    const px = Math.max(0, Math.min(sim.size, x + i)), py = Math.max(0, Math.min(sim.size, y + j));
    const h = sim.grid.getCorner(px, py);
    if (h < lo) lo = h; if (h > hi) hi = h;
  }
  return hi - lo;
}

function extras(sim: Sim, kit: ResortKit, t: TownArchetype, rng: Rng, scale: number, out: TownReport, log: (m: string) => void): void {
  const { lc, roadTile } = kit;
  const n = sim.networks;
  out.pisteMids = kit.pisteStroke.filter((l) => l.length).map((l) => ({ ...l[l.length >> 1]! }));
  const strokes = kit.pisteStroke.filter((l) => l.length > 3);
  const placedCentres = (): Pt[] => sim.buildings.all().map((b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 }));
  // lake anchor: the lake tile nearest the village
  let lake: Pt | null = null;
  for (const lk of sim.terrainInfo.lakes) for (const i of lk.tileIdx) {
    const p = { x: i % sim.size, y: (i / sim.size) | 0 };
    if (!lake || Math.hypot(p.x - lc.x, p.y - lc.y) < Math.hypot(lake.x - lc.x, lake.y - lc.y)) lake = p;
  }
  const anchorOf = (at: Anchor, k: number): Pt => {
    const st = strokes.length ? strokes[(k + rng.int(0, 2)) % strokes.length]! : null;
    switch (at) {
      case 'road': return roadTile;
      case 'piste': return st ? st[Math.floor(st.length * (0.25 + rng.next() * 0.5))]! : lc;
      case 'foot': return st ? st[Math.floor(st.length * (0.8 + rng.next() * 0.15))]! : lc;
      case 'top': return st ? st[Math.floor(st.length * (0.05 + rng.next() * 0.12))]! : lc;
      case 'lake': return lake ?? lc;
      case 'hill': return { x: lc.x + rng.int(-12, 12), y: lc.y - rng.int(8, 18) };
      case 'pasture': return { x: lc.x + (rng.next() < 0.5 ? -1 : 1) * rng.int(7, 14), y: lc.y + rng.int(3, 12) };
      default: return lc;
    }
  };
  /** Candidate anchors around `a`, best site score first: flat, hugging the paths / road, not crowding other buildings. */
  const candidates = (a: Pt, spread: number): Pt[] => {
    const cs = placedCentres();
    const cand: Array<{ p: Pt; s: number }> = [];
    for (let i = 0; i < 12; i++) {
      const ang = rng.next() * Math.PI * 2, rad = spread * (0.35 + 0.65 * rng.next());
      const p = { x: Math.round(Math.max(4, Math.min(sim.size - 5, a.x + Math.cos(ang) * rad))), y: Math.round(Math.max(4, Math.min(sim.size - 5, a.y + Math.sin(ang) * rad))) };
      let near = 99;
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const x = p.x + dx, y = p.y + dy;
        if (!n.inBounds(x, y)) continue;
        const k = n.kind[n.idxOf(x, y)];
        if (k === NetKind.Path || k === NetKind.Road) near = Math.min(near, Math.hypot(dx, dy));
      }
      let crowd = 0;
      for (const c of cs) { const d = Math.hypot(c.x - p.x, c.y - p.y); if (d < 5) crowd += (5 - d); }
      const s = -roughness(sim, p.x, p.y, 3) * 1.2 - Math.min(near, 9) * 0.25 - crowd * 0.8 - Math.hypot(p.x - a.x, p.y - a.y) * 0.05;
      cand.push({ p, s });
    }
    cand.sort((x, y) => y.s - x.s);
    return cand.map((c) => c.p);
  };
  const place1 = (item: TownItem, k: number): boolean => {
    const a = anchorOf(item.at, k);
    const tryAt = (p: Pt, rmax: number): boolean => {
      const flat = item.type === 'magicCarpet' ? false : undefined; // carpets need the natural gentle slope
      const b = kit.place(item.type, p.x, p.y, rmax, flat, 0, item.type === 'magicCarpet');
      if (!b) return false;
      const acc = BUILDINGS[item.type]!.access;
      if (acc === 'road') kit.ensureRoad(b); else if (acc === 'path' || acc === 'pisteEdge' || acc === 'rail+path') kit.ensurePath(b);
      kit.settle();
      if (!b.active && acc === 'road') { kit.ensurePath(b); kit.settle(); }
      if (!b.active && acc !== 'road') { kit.ensureRoad(b); kit.settle(); }
      if (b.active) return true;
      sim.buildings.remove(b.id);
      kit.report.placed[item.type] = Math.max(0, (kit.report.placed[item.type] ?? 1) - 1);
      kit.settle();
      return false;
    };
    const cs = candidates(a, item.spread ?? 8);
    for (const p of cs.slice(0, 3)) if (tryAt(p, 3)) return true;
    if (tryAt(a, item.rmax ?? 16)) return true;
    for (const alt of (['village', 'pasture', 'road', 'hill'] as const).filter((q) => q !== item.at)) if (tryAt(anchorOf(alt, k), (item.rmax ?? 16) + 8)) return true; // flat-hungry sites (runway, pasture) may need another corner of the map
    return false;
  };
  const countOf = (ty: string): number => sim.buildings.all().filter((b) => b.type === ty).length;
  let failed = 0;
  // exclusive sites first (rail stub station already done in pre()), then in listed order
  const order = [...t.items].sort((x, y) => (x.at === 'lake' ? -1 : 0) - (y.at === 'lake' ? -1 : 0));
  const wantedByType = new Map<string, number>();
  for (const it of order) {
    const want = rangeOf(rng, it.n, BUILDINGS[it.type]!.maxCount === 1 ? 1 : it.type === 'warningSign' || it.n[1] <= 1 ? 1 : scale);
    wantedByType.set(it.type, (wantedByType.get(it.type) ?? 0) + want);
    let have = countOf(it.type);
    const target = wantedByType.get(it.type)!;
    let guard = 0;
    while (have < target && guard++ < target + 3) {
      if (!place1(it, have + guard)) { if (guard >= 3) break; }
      have = countOf(it.type);
    }
    log(`${it.type}: ${have}/${target}`);
    if (have < target) { failed++; out.failures.push(`only ${have}/${target} ${it.type}`); }
  }
  if (failed) log(`${failed} item types short`);
  kit.settle();
  // snowmaking: reservoir (if not an item) + cannons along the pistes
  if (t.cannons[1] > 0 && strokes.length) {
    const want = Math.max(1, Math.round(rng.int(t.cannons[0], t.cannons[1]) * scale));
    if (t.reservoir && countOf('reservoir') === 0) {
      const mid = strokes[0]![Math.floor(strokes[0]!.length / 2)]!;
      if (!kit.place('reservoir', mid.x, mid.y, 18)) out.failures.push('cannot place reservoir');
    }
    let made = 0;
    for (let k = 1; k <= want * 3 && made < want; k++) {
      const ln = strokes[k % strokes.length]!;
      const p = ln[Math.min(ln.length - 1, Math.floor((ln.length * ((Math.floor(k / strokes.length) % (want + 1)) + 1)) / (want + 2)))];
      if (p && kit.place('snowCannon', p.x, p.y, 2)) made++;
    }
    if (made < Math.ceil(want / 2)) out.failures.push(`only ${made}/${want} cannons`);
  }
  // hiking / MTB trails
  const nh = t.hike[1] ? Math.max(t.hike[0] > 0 ? 1 : 0, Math.round(rng.int(t.hike[0], t.hike[1]) * scale)) : 0;
  const nm = t.mtb[1] ? Math.max(t.mtb[0] > 0 ? 1 : 0, Math.round(rng.int(t.mtb[0], t.mtb[1]) * scale)) : 0;
  const trailTiles = paintTrails(sim, lc, nh, nm, rng);
  out.hikeTiles += trailTiles.hike; out.mtbTiles += trailTiles.mtb;
  kit.settle();
  log(`trails: ${out.hikeTiles} hike / ${out.mtbTiles} mtb`);
}

/** Best-of-12 candidate arcs from the village per trail (water / cliffs veto tiles); alternates hike and MTB layers. */
function paintTrails(sim: Sim, lc: Pt, nHike: number, nMtb: number, rng: Rng): { hike: number; mtb: number } {
  const sz = sim.size;
  const res = { hike: 0, mtb: 0 };
  const total = nHike + nMtb;
  for (let k = 0; k < total; k++) {
    const layer = k < nHike && (k % 2 === 0 || nMtb === 0 || k >= nMtb * 2) ? Layer.Hike : nMtb > 0 && k - nHike >= 0 ? Layer.Mtb : Layer.Hike;
    let best: Pt[] = [];
    const base = rng.next() * Math.PI * 2;
    for (let j = 0; j < 12; j++) {
      const ang = base + (k / Math.max(1, total)) * Math.PI * 2 + j * 0.52;
      const r = sz * (0.14 + 0.04 * ((k + j) % 3));
      const a: Pt = { x: Math.round(lc.x + Math.cos(ang) * 4), y: Math.round(lc.y + Math.sin(ang) * 4) };
      const b: Pt = { x: Math.max(3, Math.min(sz - 4, Math.round(lc.x + Math.cos(ang + 0.5) * r))), y: Math.max(3, Math.min(sz - 4, Math.round(lc.y + Math.sin(ang + 0.5) * r))) };
      const mid: Pt = { x: Math.round((a.x + b.x) / 2 + Math.sin(ang) * 3), y: Math.round((a.y + b.y) / 2 - Math.cos(ang) * 3) };
      const line = sweepBrush(interpolateStroke([a, mid, b]), 0, sz);
      const ok = line.filter((p) => sim.networks.canPaint(p.x, p.y, layer).ok);
      if (ok.length > best.length && ok.length >= line.length * 0.8) best = line;
      else if (!best.length && ok.length > 0 && j === 11) best = line;
    }
    const r = sim.networks.paint(layer, best);
    if (layer === Layer.Hike) res.hike += r.painted; else res.mtb += r.painted;
  }
  return res;
}

/** Terrain preset / size / season a town wants (for `createSim` and the title). */
export const townSimOptions = (id: string, size?: MapSize): { size: MapSize; preset: TerrainPresetId; startSeason: 'winter' | 'summer' } => {
  const t = townOf(id) ?? TOWNS[0]!;
  return { size: size ?? t.size, preset: t.preset, startSeason: t.season };
};
