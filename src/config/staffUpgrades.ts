/**
 * Exactly six staff upgrades (M5.4 Task 20, D6; replaces the 12-node research tree). No tree, no tiers: one-off items, one trains at a time.
 * Effects are multipliers read through `mod(sim, key)` (1 = no effect). Each has an upkeep so none is a free pick. Docs: docs/staff.md.
 */
export type ModKey = 'instructorCapacity' | 'patrolSpeed' | 'groomCapacity' | 'groomFuel' | 'liftBreakdown' | 'liftRepairTime' | 'wildlifeScare' | 'hospitalitySpend';

export interface StaffUpgradeDef {
  id: 'instructorTraining' | 'patrolTraining' | 'groomerEfficiency' | 'liftMechanics' | 'rangers' | 'hospitality';
  name: string; icon: string; blurb: string;
  /** One-time cost ($). */
  cost: number;
  /** Training time in in-game days (one trains at a time). */
  days: number;
  /** Upkeep per day once trained ($, booked as staff wages). */
  upkeep: number;
  /** Resort level needed in Career (Sandbox ignores it). */
  minLevel: number;
  effects: Partial<Record<ModKey, number>>;
  /** Short effect text for the UI. */
  effect: string;
}

export const STAFF_UPGRADES: readonly StaffUpgradeDef[] = [
  { id: 'instructorTraining', name: 'Instructor training', icon: '🎿', blurb: 'Certified teachers manage bigger classes.', cost: 5000, days: 6, upkeep: 14, minLevel: 1, effects: { instructorCapacity: 1.25 }, effect: '+25% ski-school capacity' },
  { id: 'patrolTraining', name: 'Patrol training', icon: '⛑️', blurb: 'Rehearsed rescues, faster sleds.', cost: 6000, days: 6, upkeep: 16, minLevel: 1, effects: { patrolSpeed: 1.3 }, effect: 'Rescue sleds 30% faster' },
  { id: 'groomerEfficiency', name: 'Snowcat efficiency', icon: '🚜', blurb: 'Better routes, better tracks, less diesel.', cost: 7000, days: 8, upkeep: 12, minLevel: 2, effects: { groomCapacity: 1.3, groomFuel: 0.75 }, effect: '+30% tiles per cat, -25% fuel' },
  { id: 'liftMechanics', name: 'Lift mechanics', icon: '🔧', blurb: 'Preventive care and a well-stocked van.', cost: 8000, days: 8, upkeep: 16, minLevel: 2, effects: { liftBreakdown: 0.7, liftRepairTime: 0.75 }, effect: '-30% breakdowns, repairs 25% faster' },
  { id: 'rangers', name: 'Rangers & wildlife', icon: '🦌', blurb: 'Trained rangers keep animals and guests apart.', cost: 8000, days: 10, upkeep: 18, minLevel: 3, effects: { wildlifeScare: 0.7 }, effect: '-30% wildlife scares; habitat protection' },
  { id: 'hospitality', name: 'Hospitality', icon: '🍲', blurb: 'Friendly service, a smile with every soup.', cost: 9000, days: 10, upkeep: 18, minLevel: 3, effects: { hospitalitySpend: 1.12 }, effect: '+12% food, bar and shop spend' },
];

export const UPGRADE_BY_ID: Record<string, StaffUpgradeDef> = Object.fromEntries(STAFF_UPGRADES.map((u) => [u.id, u]));
/** Fixed purchase order of the balance bot (cheapest returns first). */
export const BOT_UPGRADE_ORDER: readonly StaffUpgradeDef['id'][] = ['liftMechanics', 'hospitality', 'groomerEfficiency', 'instructorTraining', 'patrolTraining', 'rangers'];
