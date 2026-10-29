/**
 * Campground tuning (Phase 6 Task 19, docs/campground.md). The building itself is a Lodging v2 row (`LODGING_SPECS.campground`: 16 pitches, budget tier, summer only);
 * this file holds the numbers of the campfire evening and the check-in preference.
 */
export const CAMP = {
  /** Hour from which the campfire gathering runs (once per evening; the fire burns 19:00-22:00 in the render). */
  gatherFrom: 19, fireFrom: 18.5, fireTo: 22.5,
  /** Happiness gained by every camper at the evening campfire; toilets within `toiletRadius` tiles add `toiletBonus` (and a camp without any loses `noToiletMalus`). */
  happiness: 0.05, toiletBonus: 0.04, noToiletMalus: 0.02, toiletRadius: 10,
  /** Guest types whose appeal for a tiered (budget) house is at least `likes` pitch there first; at or below `avoids` they never do (a VIP's tier-shifted appeal is 0: VIPs stay out of tents). */
  likes: 0.65, avoids: 0.05,
} as const;

/** Pure: happiness a camper gains at the evening fire (toilets nearby = a better night, none = a small grumble). */
export function campFireHappiness(toiletsNearby: boolean): number {
  return toiletsNearby ? CAMP.happiness + CAMP.toiletBonus : CAMP.happiness - CAMP.noToiletMalus;
}
