/**
 * Career unlocks (M5.3, Task 14): the SHORT list of items gated by resort level (D2 = selective). Everything not listed here is ALWAYS available:
 * the starter chain (road, footpath, piste, T-bar, chair2/chair4/chair4d, lodge, ticket office, parking, ski school, Ski Patrol Hub, First-Aid Hut,
 * first restaurant), terraforming and tree planting, and the Ranger Station (a goal needs it before level 3). Rationale per item: docs/progression.md.
 * Sandbox ignores this table. The tutorial runs with `unlockAll`.
 */
import { BUILDINGS } from './buildings';
import { LIFTS, type LiftKind } from './lifts';
import { CAMPAIGNS } from './marketing';
import { levelName } from './progression';

export type UnlockKind = 'building' | 'lift' | 'campaign' | 'landscape';
export interface UnlockDef { kind: UnlockKind; id: string; level: number }

export const UNLOCKS: readonly UnlockDef[] = [
  // Level 2 (Local favourite): bigger detachable lifts.
  { kind: 'lift', id: 'chair6', level: 2 },
  { kind: 'lift', id: 'gondola6', level: 2 },
  // Level 2: wind power (the solar array, nursery, recycling and biomass are always open; the Advisor suggests the solar array).
  { kind: 'building', id: 'windTurbine', level: 2 },
  // Level 2: the summer quad tours (Phase 6 Task 22; an optional motorised extra: no goal or Advisor rule needs it).
  { kind: 'building', id: 'quadBase', level: 2 },
  // Winter tours (Phase 6 Task 31): optional extras, no goal / advisor build action needs them.
  { kind: 'building', id: 'sleighStable', level: 2 },
  { kind: 'building', id: 'snowshoeHut', level: 2 },
  { kind: 'building', id: 'snowscooterBase', level: 3 },
  // Level 2: the Tackle & bait hut (Phase 6 Task 49; angling is optional: no goal or Advisor rule needs it; the fishing pier needs the hut first).
  { kind: 'building', id: 'tackleHut', level: 2 },
  // Level 2: the climbing crag (Phase 6 Task 23; needs a rock face, an optional adventure extra: no goal or Advisor rule needs it).
  { kind: 'building', id: 'crag', level: 2 },
  // Level 3: the water tours (Phase 6 Task 24; optional summer adventure extras that need a river / steep stream: no goal or Advisor rule needs them).
  { kind: 'building', id: 'raftingBase', level: 3 },
  { kind: 'building', id: 'canyoningBase', level: 3 },
  // Level 2: digging ponds (the rest of the Landscape drawer is always available).
  { kind: 'landscape', id: 'pond', level: 2 },
  // Level 2: digging rivers + placing springs (Phase 6, like ponds; no goal or Advisor rule needs a river).
  { kind: 'landscape', id: 'river', level: 2 },
  // Level 2: the treehouse (Phase 6 Task 21; a hiker / family extra that needs a forest: no goal or Advisor rule needs it; the viewpoint platform is never gated).
  { kind: 'building', id: 'treehouse', level: 2 },
  // Level 3: the Small Hotel (Phase 6 Task 27; an optional lodging tier: chalets and apartments still house everybody, no goal or Advisor rule needs it).
  { kind: 'building', id: 'smallHotel', level: 3 },
  // Level 3: backcountry routes (Phase 6 Task 32; winter ski-touring / off-piste extra, no goal or Advisor rule needs it: the Advisor only WARNS about routes you built).
  { kind: 'landscape', id: 'backcountry', level: 3 },
  // Level 3: the suspension footbridge (Phase 6 Task 46; a hiker attraction, nothing a goal or Advisor rule needs; regular bridges are always available).
  { kind: 'landscape', id: 'suspension', level: 3 },
  // Level 3 (Regional name): the heavy transport.
  { kind: 'lift', id: 'funicular', level: 3 },
  // Level 3: the high-speed six-seat chair (Phase 6, Task 47; no goal or Advisor rule needs it).
  { kind: 'lift', id: 'chair6d', level: 3 },
  // Level 3: the big solar plant (small hydro needs a stream and $11k: self-limiting, always open).
  { kind: 'building', id: 'solarPlant', level: 3 },
  // Level 4 (Alpine destination): rescue by air and the biggest cabins / chairs.
  { kind: 'building', id: 'ecoCentre', level: 4 },
  // Level 4: the Luxury Hotel with its heated pool (Phase 6 Task 27; VIP lodging, optional: no goal or Advisor rule needs it).
  { kind: 'building', id: 'luxuryHotel', level: 4 },
  { kind: 'building', id: 'helipad', level: 4 },
  { kind: 'lift', id: 'gondola10', level: 4 },
  { kind: 'lift', id: 'chair8b', level: 4 },
  // Level 5 (International resort): the glamorous end.
  { kind: 'lift', id: 'cablecar', level: 5 },
  { kind: 'building', id: 'altiport', level: 5 },
  { kind: 'campaign', id: 'vip', level: 5 },
];

export const key = (kind: UnlockKind, id: string): string => `${kind}:${id}`;
const BY_KEY = new Map(UNLOCKS.map((u) => [key(u.kind, u.id), u.level]));

/** Level at which an item unlocks (1 = always available). */
export const unlockLevel = (kind: UnlockKind, id: string): number => BY_KEY.get(key(kind, id)) ?? 1;
export const isGated = (kind: UnlockKind, id: string): boolean => unlockLevel(kind, id) > 1;
/** Items that unlock exactly at `level`. */
export const unlocksAt = (level: number): UnlockDef[] => UNLOCKS.filter((u) => u.level === level);

export function unlockName(kind: UnlockKind, id: string): string {
  if (kind === 'building') return BUILDINGS[id]?.name ?? id;
  if (kind === 'lift') return LIFTS[id as LiftKind]?.name ?? id;
  if (kind === 'landscape') return id === 'pond' ? 'Ponds & lakes (Landscape)' : id === 'river' ? 'Rivers & springs (Landscape)' : id === 'suspension' ? 'Suspension footbridges (Paths & trails)' : id === 'backcountry' ? 'Backcountry routes (Pistes & trails)' : id;
  return CAMPAIGNS.find((c) => c.id === id)?.name ?? id;
}
export const unlockIcon = (kind: UnlockKind, id: string): string => (kind === 'campaign' ? CAMPAIGNS.find((c) => c.id === id)?.icon ?? '📣' : kind === 'lift' ? '🚡' : kind === 'landscape' ? '💧' : '🏗️');

/** Text shown in tooltips / ghost tips / disabled buttons: 'Unlocks at level 3: Regional name'. */
export const lockedReason = (level: number): string => `Unlocks at level ${level}: ${levelName(level)}`;

/** The check the validators use (placement, lifts, marketing). `null` = available. Implemented by `sim/progression/Progression`. */
export interface UnlockGate { locked(kind: UnlockKind, id: string): string | null }
