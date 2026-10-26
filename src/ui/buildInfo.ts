import { BUILDINGS, type BuildingDef } from '@/config/buildings';
import { LIFTS, nominalThroughput, type LiftKind } from '@/config/lifts';
import { describeRules } from '@/sim/PlacementRules';
import type { SeasonId } from '@/core/events';
import { usableFrom, type SeasonTag } from './seasonOrder';

/** Sub-tabs of the Buildings drawer. */
export type BuildingTab = 'services' | 'kids' | 'safety' | 'recreation' | 'transport' | 'utilities';
export const BUILDING_TABS: ReadonlyArray<{ id: BuildingTab; label: string; icon: string }> = [
  { id: 'services', label: 'Services', icon: '🍽️' },
  { id: 'kids', label: 'Ski School & Kids', icon: '🎿' },
  { id: 'safety', label: 'Safety & Ops', icon: '⛑️' },
  { id: 'recreation', label: 'Recreation', icon: '🎡' },
  { id: 'transport', label: 'Transport Hubs', icon: '🚉' },
  { id: 'utilities', label: 'Utilities', icon: '💧' },
];

const CATEGORY_TAB: Record<string, BuildingTab> = {
  core: 'services', services: 'services', lodging: 'services',
  kids: 'kids', safety: 'safety', operations: 'safety',
  recreation: 'recreation', water: 'recreation',
  transport: 'transport', snow: 'utilities', misc: 'utilities',
};
/** Per-id overrides of the category mapping (kept minimal). */
const ID_TAB: Record<string, BuildingTab> = { parking: 'transport', shuttleDepot: 'transport' };

/** Every catalog id maps to exactly one tab (override, else its category, else utilities). */
export function buildingTab(def: Pick<BuildingDef, 'id' | 'category'>): BuildingTab {
  return ID_TAB[def.id] ?? CATEGORY_TAB[def.category] ?? 'utilities';
}
export function buildingsInTab(tab: BuildingTab): BuildingDef[] {
  return Object.values(BUILDINGS).filter((d) => buildingTab(d) === tab);
}

export const BUILDING_ICONS: Record<string, string> = {
  baseLodge: '🏠', lodge: '🍲', cafe: '☕', shop: '🛍️', rental: '🎿', chalet: '🏡', apartment: '🏢', ticketOffice: '🎫', parking: '🅿️',
  skiSchoolHQ: '🏫', magicCarpet: '🧒', kidsGround: '⛷️', playground: '🛝', patrolHub: '⛑️', rangerStation: '🐻', firstAid: '🩹', helipad: '🚁',
  groomerGarage: '🚜', liftWorkshop: '🛠️', snowcatOutpost: '🛻', warningSign: '⚠️', iceRink: '⛸️', heatedTerrace: '🔥', stuntPark: '🏂', adventurePark: '🧗',
  alpineFarm: '🐄', boatRental: '🚣', beach: '🏖️', trainStation: '🚆', altiport: '🛩️', shuttleDepot: '🚌', reservoir: '💧', snowCannon: '❄️',
};
export const LIFT_ICONS: Record<LiftKind, string> = { tbar: '⛷️', chair2: '🚡', chair4: '🚡', chair4d: '🚡', chair6: '🚡', chair6b: '🚡', chair8b: '🚡', gondola6: '🚠', gondola10: '🚠', cablecar: '🚞', funicular: '🚋' };

const DESCRIPTIONS: Record<string, string> = {
  baseLodge: 'Resort core: tickets, lockers and the heart of the village.',
  lodge: 'Restaurant and lounge; feeds hungry skiers.',
  cafe: 'Quick coffee and snacks.',
  shop: 'Gear, souvenirs and sunscreen.',
  rental: 'Rent skis, boards and bikes.',
  chalet: 'Small guest lodging.',
  apartment: 'Large lodging block for many guests.',
  ticketOffice: 'Sells lift passes away from the lodge.',
  parking: 'Car park for day visitors.',
  skiSchoolHQ: 'Lessons for beginners. Unlocks kids facilities.',
  magicCarpet: 'Gentle conveyor for first-timers.',
  kidsGround: 'Snow play area for children.',
  playground: 'Snow-free play area for children.',
  patrolHub: 'Ski patrol base. Unlocks first aid and helipad.',
  rangerStation: 'Wildlife management: rangers haze or relocate bears that scare guests, bear-proof bins. Works best near trails.',
  firstAid: 'Treats injured guests within its radius.',
  helipad: 'Air rescue for remote accidents.',
  groomerGarage: 'Houses piste groomers.',
  liftWorkshop: 'Crews for lift repairs and inspections: faster, cheaper fixes than a contractor.',
  snowcatOutpost: 'Extends grooming coverage.',
  warningSign: 'Warns skiers of hazards nearby.',
  iceRink: 'Skating when it is cold.',
  heatedTerrace: 'Warm outdoor seating.',
  stuntPark: 'Jumps and rails on snow.',
  adventurePark: 'Summer ropes course and zip-lines.',
  alpineFarm: 'Cows, sheep and goats graze the alpine pastures in summer; the farm shop attracts families; restaurants near farms earn more.',
  boatRental: 'Summer lake boats; must touch a lake.',
  beach: 'Summer lakeside beach; must touch a lake.',
  trainStation: 'Brings guests by rail.',
  altiport: 'Short runway for small aircraft.',
  shuttleDepot: 'Runs buses to distant buildings.',
  reservoir: 'Water storage for snowmaking.',
  snowCannon: 'Makes snow in cold weather; needs water.',
};
export const LIFT_DESCRIPTIONS: Record<LiftKind, string> = {
  tbar: 'Cheap drag lift for short, gentle slopes.',
  chair2: 'Slow fixed-grip double chair: cheap, short lines.',
  chair4: 'Workhorse fixed-grip quad; carries bikes in summer.',
  chair4d: 'Detachable quad: faster line, gentle loading.',
  chair6: 'Detachable six-pack: high capacity, quick and comfortable.',
  chair6b: 'Six-pack with a weather bubble: comfortable, copes with wind.',
  chair8b: 'Eight-seat bubble chair: top chairlift capacity.',
  gondola6: 'Fast enclosed 6-person cabins, long runs, wind tolerant.',
  gondola10: 'Large 10-person cabins: high capacity, very comfortable.',
  cablecar: 'Huge cabins across steep terrain.',
  funicular: 'Rail-borne lift for moderate slopes.',
};

export interface NetworkItem { key: 'path' | 'road' | 'rail' | 'ski' | 'mtb' | 'hike'; name: string; icon: string; costPerTile: number; desc: string; group: 'paths' | 'pistes' }
export const NETWORK_ITEMS: NetworkItem[] = [
  { key: 'path', name: 'Footpath', icon: '🚶', costPerTile: 20, desc: 'Walkway connecting buildings to the village.', group: 'paths' },
  { key: 'road', name: 'Road', icon: '🛣️', costPerTile: 60, desc: 'Road for buses and cars. Connects to the road entry.', group: 'paths' },
  { key: 'rail', name: 'Rail', icon: '🚂', costPerTile: 100, desc: 'Railway line from the rail entry.', group: 'paths' },
  { key: 'ski', name: 'Ski piste', icon: '⛷️', costPerTile: 0, desc: 'Paint skiable runs. Difficulty follows slope unless overridden.', group: 'pistes' },
  { key: 'mtb', name: 'MTB trail', icon: '🚵', costPerTile: 0, desc: 'Summer mountain-bike trail.', group: 'pistes' },
  { key: 'hike', name: 'Hiking trail', icon: '🥾', costPerTile: 0, desc: 'Summer hiking trail.', group: 'pistes' },
];

/** Placement-rule lines: PlacementRules.describeRules (rules audit); catalog-derived fallback if it yields nothing. */
export function ruleLines(typeId: string): string[] {
  const out = describeRules(typeId);
  return out.length ? out : catalogRules(typeId);
}

export function catalogRules(typeId: string): string[] {
  const d = BUILDINGS[typeId];
  if (!d) return [];
  const out: string[] = [];
  out.push(d.needsFlat ? 'Needs flat ground (or auto-flatten)' : 'Tolerates uneven ground');
  if (d.lakeAdjacent) out.push('Must touch a lake');
  else if (d.allowOnWater === false) out.push('Not on water');
  if (d.waterSource) out.push('Needs a Reservoir or lake nearby');
  if (d.shuttleDependent) out.push('Needs a shuttle depot or to be within walking distance of the lodge');
  if (d.minAltitude !== undefined) out.push(`Altitude ≥ ${d.minAltitude}`);
  if (d.maxAltitude !== undefined) out.push(`Altitude ≤ ${d.maxAltitude}`);
  const need: Record<string, string> = { snow: 'Works on snow', snowFree: 'Needs snow-free ground', cold: 'Cold season only', warm: 'Warm season only' };
  for (const n of d.needs ?? []) out.push(need[n] ?? n);
  if (d.serviceRadius) out.push(`Service radius ${d.serviceRadius} tiles`);
  return out;
}

export interface InfoModel {
  id: string;
  title: string;
  desc: string;
  icon: string;
  /** [label, value] pairs: cost, upkeep, footprint... */
  stats: Array<[string, string]>;
  reqs: Array<{ text: string; ok: boolean }>;
  rules: string[];
  /** Career level lock ('Unlocks at level 4: Alpine destination'): shown right under the title (M5.3), so it is never scrolled out of the popover. */
  note?: string;
}

const LEVEL_NOTE = /^Unlocks at level \d/;
const money = (n: number): string => '$' + Math.round(n).toLocaleString('en-US');

/** Season relevance of lifts (winter-only drag lifts vs bike-capable chairs/gondolas) and network tools (pistes winter, MTB/hiking summer). */
export const liftSeason = (k: LiftKind): SeasonTag => (LIFTS[k].carriesBikes ? 'all' : 'winter');
export const networkSeason = (key: NetworkItem['key']): SeasonTag => (key === 'ski' ? 'winter' : key === 'mtb' || key === 'hike' ? 'summer' : 'all');
/** 'Mostly used from summer on' hint line for an off-season item; null when usable now. */
export function seasonHint(tag: SeasonTag, season: SeasonId | undefined): string | null {
  const u = season ? usableFrom(tag, season) : null;
  return u ? `Mostly used from ${u} on; you can build it any time` : null;
}

/** One-line note for the Pistes & Trails drawer: trails and pistes can always be built (plan ahead); they are only used in their season. null = nothing to say. */
export function trailSeasonNote(season: SeasonId | undefined): string | null {
  if (season === 'winter') return 'Trails can be built any time; bikers and hikers use them once the snow is gone.';
  if (season === 'summer') return 'Ski pistes can be painted any time, even on bare ground; they open for skiers once there is snow.';
  return null;
}

export interface BuildingInfoCtx {
  /** Lock reasons from Dependencies.canPlace (empty = unlocked). */
  locked(type: string): string[];
  cost(type: string): number;
  multiplier(): number;
  season?: SeasonId;
}
export function buildingInfo(id: string, ctx: BuildingInfoCtx): InfoModel | null {
  const d = BUILDINGS[id];
  if (!d) return null;
  const lock = ctx.locked(id);
  const m = ctx.multiplier();
  const cost = ctx.cost(id);
  const reqs = d.requires.map((r) => ({ text: BUILDINGS[r]?.name ?? r, ok: !lock.some((l) => l.includes(BUILDINGS[r]?.name ?? r)) }));
  for (const l of lock) if (!reqs.some((r) => l.includes(r.text))) reqs.push({ text: l, ok: false });
  const costTxt = m !== 1 ? `${money(cost)} (was ${money(d.cost)}, ${m < 1 ? `season −${Math.round((1 - m) * 100)}%` : `season +${Math.round((m - 1) * 100)}%`})` : money(cost);
  return {
    id, title: d.name, desc: DESCRIPTIONS[id] ?? '', icon: BUILDING_ICONS[id] ?? d.name.charAt(0),
    stats: [['Cost', costTxt], ['Upkeep', `${money(d.upkeep)}/day`], ['Footprint', `${d.w}×${d.h}`], ...(d.staff ? [['Staff', String(d.staff)] as [string, string]] : []), ...(d.capacity ? [['Capacity', String(d.capacity)] as [string, string]] : [])],
    note: lock.find((l) => LEVEL_NOTE.test(l)), reqs: reqs.filter((r) => !LEVEL_NOTE.test(r.text)), rules: [...(seasonHint(d.season, ctx.season) ? [seasonHint(d.season, ctx.season)!] : []), ...ruleLines(id)],
  };
}
export function liftInfo(kind: LiftKind, costPer100m: number, season?: SeasonId, lock: readonly string[] = []): InfoModel {
  const d = LIFTS[kind];
  return {
    id: kind, title: d.name, desc: LIFT_DESCRIPTIONS[kind], icon: LIFT_ICONS[kind],
    stats: [['Cost', `${money(costPer100m)} / 100 m`], ['Max length', `${d.maxLength} tiles`], ['Max gradient', `${Math.round(d.maxGradient * 100)}%`], ['Speed', `${d.speed} tiles/s`], ['Capacity', `${d.capacityPerCarrier}/carrier`],
      ...(d.reversible ? [] : [['Throughput', `≈${Math.round(nominalThroughput(d, 40))}/h (40-tile line)`] as [string, string]]), ['Stations', `${money(d.stationCost)} each`], ['Energy', `${money(d.energyPerHour)}/h running`],
      ['Comfort', `${Math.round(d.comfort * 100)}%`], ['Wind limit', `${Math.round(d.windTolerance * 100)}%`], ['Grips', d.detachable ? 'detachable' : 'fixed'], ['Bubble', d.bubble ? 'yes' : 'no'], ['Bikes', d.carriesBikes ? 'yes' : 'no']],
    note: lock.find((l) => LEVEL_NOTE.test(l)), reqs: lock.filter((l) => !LEVEL_NOTE.test(l)).map((text) => ({ text, ok: false })), rules: [...(seasonHint(liftSeason(kind), season) ? [seasonHint(liftSeason(kind), season)!] : []), 'Click bottom station, then top station', 'Stations need flat ground (or auto-flatten)'],
  };
}
export function networkInfo(it: NetworkItem, pisteCost: number, season?: SeasonId): InfoModel {
  const c = it.costPerTile || pisteCost, h = seasonHint(networkSeason(it.key), season);
  return { id: it.key, title: it.name, desc: it.desc, icon: it.icon, stats: [['Cost', `${money(c)}/tile`]], reqs: [], rules: [...(h ? [h] : []), ...(it.key === 'path' || it.key === 'road' || it.key === 'rail' ? ['Drag to draw; R flips the L-corner'] : ['Drag to paint with the brush'])] };
}

/** Auto-flatten tooltip. */
export const AUTO_FLATTEN_TIP = 'Level the ground under the footprint automatically. You pay for the terraforming on top of the build cost; the exact flatten cost is shown on the ghost when known. Shortcut: F';
