import type { SeasonId, WeatherKind } from '../core/events';

/**
 * Guest-type framework (Phase 6, Task 9; docs/guest-types.md).
 *
 * The six CORE types (solo, couple, family, vip, budget, adventure; indices 0..5) keep their hand-tuned tables in Spawner / Marketing / the attraction
 * specs and are untouched. EXTRA types (index 6+) are plain data rows in `GUEST_TYPE_DEFS`: season shares, a minimum resort level, required buildings,
 * a weather response, an appeal profile (by attraction kind or id, falling back to a core column), a marketing segment, group / budget / overnight
 * numbers and look hooks (top colour, gear, outfit). The list is EMPTY by default and the spawner always runs the v2 path (`Spawner.typesV2`, on in `createSim`), so an empty list is a no-op until a milestone adds a type (then re-record goldens).
 *
 * Config module: no sim / render imports (only event id types).
 */
export const CORE_TYPE_NAMES = ['solo', 'couple', 'family', 'vip', 'budget', 'adventure'] as const;
export type CoreTypeName = (typeof CORE_TYPE_NAMES)[number];
export const CORE_TYPE_COUNT = CORE_TYPE_NAMES.length;

/** Gear a type uses on snow: `ski` / `board` override the per-guest ~30 % boarder cosmetic; undefined keeps it. */
export type TypeGear = 'ski' | 'board';
export interface TypeLook {
  /** Cloth-palette index (0..15) favoured for the top (about half of the guests wear it, like the core types). */
  top?: number;
  /** Legend / impostor colour (hex). Defaults to the fallback core type colour. */
  colour?: number;
  /** Snow gear override. */
  gear?: TypeGear;
  /** Forced outfit regardless of season (0 warm, 1 summer, 2 swim); undefined = by season / state. */
  outfit?: number;
  /** Always a helmet (any season): mountain bikers. */
  helmet?: boolean;
  /** Carries a fishing rod (view-only prop): anglers. */
  rod?: boolean;
  /** Head-wear forced for the type (HairStyle value); anglers favour caps / sun hats. */
  hat?: number;
}

export interface GuestTypeDef {
  /** Stable key (saved nowhere: the SoA stores the index = CORE_TYPE_COUNT + position in the list). Lower-case. */
  id: string;
  /** Singular label for inspectors / legends. */
  label: string;
  /** Relative arrival weight per season, in the same units as `TYPE_MIX` (core weights sum to 1). Missing / 0 = never that season. */
  seasons: Partial<Record<SeasonId, number>>;
  /** Minimum resort level (Career); Sandbox / open games count as max. */
  minLevel: number;
  /** The type appears only while at least one of these building ids is placed and active (any-of). Omitted = no requirement. */
  requires?: readonly string[];
  /** Core type whose behaviour and appeal column it inherits where nothing more specific is given (`coreOf`). */
  fallback: CoreTypeName;
  /** Marketing segment: campaigns, price elasticity and the arrival log treat the type like this core type. Defaults to `fallback`. */
  segment?: CoreTypeName;
  /** Arrival multiplier by weather kind (default 1). */
  weather?: Partial<Record<WeatherKind, number>>;
  /** Appeal 0..1.5 per attraction kind (`AttractionSpec.kind`) or building id; wins over the fallback column. */
  appeal?: Readonly<Record<string, number>>;
  group?: readonly [number, number];
  budget?: readonly [number, number];
  /** Probability of staying overnight when lodging is free. */
  overnight?: number;
  /** Skill distribution [beginner, intermediate, advanced, expert] (sums to 1); omitted = the fallback type's. */
  skill?: readonly [number, number, number, number];
  look?: TypeLook;
  /** Activity preference in percent [hike, bike]; the rest skis. Omitted = the fallback type's (`prefFor`). */
  pref?: readonly [number, number];
}

/**
 * Pseudo building ids a type may list in `requires` (conditions the spawner computes from the world, not placed buildings):
 * `@mtbBikeLift` = a rideable MTB trail AND an open bike-capable lift (Mountain biker).
 */
export const COND_MTB_BIKE_LIFT = '@mtbBikeLift';

/**
 * The extra types the game ships, in index order (index = CORE_TYPE_COUNT + position; NEVER reorder, append only).
 * 6 = Mountain biker (Phase 6 Task 25).
 */
export const SHIPPED_TYPES: readonly GuestTypeDef[] = [
  {
    id: 'mtb', label: 'Mountain biker', seasons: { summer: 0.18 }, minLevel: 1, requires: [COND_MTB_BIKE_LIFT], fallback: 'adventure', segment: 'adventure',
    weather: { rain: 0.4, storm: 0.1, cloudy: 0.9 },
    // Loves the bike park and the MTB trails (trail goals come from `pref`), rents gear, eats out; ignores snow-only and lodging-heavy things.
    appeal: { adventure: 1.3, rental: 0.9, restaurant: 0.7, bar: 0.8, terrace: 0.7, hike: 0.5, shop: 0.4, kidsGround: 0.1, playground: 0.1, carpet: 0.05, rink: 0.1, stunt: 0.2, beach: 0.5, boats: 0.4 },
    group: [1, 3], budget: [220, 420], overnight: 0.35, skill: [0.05, 0.3, 0.45, 0.2], pref: [5, 88],
    look: { top: 3, colour: 0x9acd32, helmet: true, outfit: 1 },
  },
];

/** Extra types, in index order (index = CORE_TYPE_COUNT + position). Starts as the shipped list; tests may reset / register more. */
export const GUEST_TYPE_DEFS: GuestTypeDef[] = [...SHIPPED_TYPES];

/** Register an extra type (tests, mods, later milestones that prefer code over the table). Returns its type index. */
export function registerGuestType(def: GuestTypeDef): number {
  const at = GUEST_TYPE_DEFS.findIndex((d) => d.id === def.id);
  if (at >= 0) { GUEST_TYPE_DEFS[at] = def; return CORE_TYPE_COUNT + at; }
  GUEST_TYPE_DEFS.push(def);
  return CORE_TYPE_COUNT + GUEST_TYPE_DEFS.length - 1;
}
/** Remove every extra type again (test hygiene). */
export function resetGuestTypes(): void { GUEST_TYPE_DEFS.length = 0; }
/** Back to the shipped list (test hygiene after `resetGuestTypes`). */
export function restoreShippedTypes(): void { GUEST_TYPE_DEFS.length = 0; GUEST_TYPE_DEFS.push(...SHIPPED_TYPES); }

export const guestTypeCount = (): number => CORE_TYPE_COUNT + GUEST_TYPE_DEFS.length;
export const extraDef = (type: number): GuestTypeDef | undefined => (type >= CORE_TYPE_COUNT ? GUEST_TYPE_DEFS[type - CORE_TYPE_COUNT] : undefined);
const idx = (n: CoreTypeName): number => CORE_TYPE_NAMES.indexOf(n);

/** Core type a type behaves like (identity for the core types, the fallback for extras, solo for unknown values). */
export function coreOf(type: number): number {
  if (type < CORE_TYPE_COUNT) return type;
  const d = extraDef(type);
  return d ? idx(d.fallback) : 0;
}
/** Marketing segment index (0..5) of a type. */
export function segmentIndex(type: number): number {
  if (type < CORE_TYPE_COUNT) return type;
  const d = extraDef(type);
  return d ? idx(d.segment ?? d.fallback) : 0;
}
export const segmentKey = (type: number): CoreTypeName => CORE_TYPE_NAMES[segmentIndex(type)]!;
/** Stable key of a type ('solo' ... 'adventure', then the extra ids). */
export function typeKey(type: number): string { return type < CORE_TYPE_COUNT ? CORE_TYPE_NAMES[type]! : extraDef(type)?.id ?? 'guest'; }
/** Display label ("Solo", ..., extra label). Core labels are the capitalised key, as the UI always showed. */
export function typeLabel(type: number): string {
  if (type < CORE_TYPE_COUNT) { const k = CORE_TYPE_NAMES[type]!; return k === 'vip' ? 'VIP' : k[0]!.toUpperCase() + k.slice(1); }
  return extraDef(type)?.label ?? 'Guest';
}
/** Every type index in order (core + extras). */
export function allTypes(): number[] { return Array.from({ length: guestTypeCount() }, (_, i) => i); }

export interface ActiveCtx { season: SeasonId; level: number; hasBuilding: (id: string) => boolean; weather?: WeatherKind }
/** Arrival weight of an extra type right now (0 = not eligible): season share x weather. Level / requirement gates apply first. */
export function extraWeight(def: GuestTypeDef, c: ActiveCtx): number {
  const share = def.seasons[c.season] ?? 0;
  if (share <= 0 || c.level < def.minLevel) return 0;
  if (def.requires && def.requires.length && !def.requires.some((r) => c.hasBuilding(r))) return 0;
  return share * (c.weather ? def.weather?.[c.weather] ?? 1 : 1);
}

/** Appeal of an attraction (kind / id / explicit core columns) for a type. Core types read their column untouched. */
export function appealFor(spec: { kind: string; appeal: readonly number[] }, buildingId: string | undefined, type: number): number | undefined {
  if (type < CORE_TYPE_COUNT) return spec.appeal[type];
  const d = extraDef(type);
  if (!d) return spec.appeal[0];
  const own = d.appeal;
  if (own) { const v = (buildingId !== undefined ? own[buildingId] : undefined) ?? own[spec.kind]; if (v !== undefined) return v; }
  return spec.appeal[idx(d.fallback)];
}
