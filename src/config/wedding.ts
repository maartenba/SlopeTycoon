/**
 * Chapel + weddings (0.7.1, docs/chapel.md). Config is the source of truth. A wedding is a rare, seeded event: the schedule is a pure function of
 * (seed, day), so the same seed + inputs always give the same weddings; the plain bot builds no chapel, so nothing here runs in the balance goldens.
 */
export const CHAPEL = {
  /** Village charm: added to the 0..1 scenery value that feeds the Rating's scenery bonus (up to +2 rating points for a full 1.0). One chapel counts (catalog `maxCount: 1`), only while it is connected. */
  charm: 0.06,
  /** The chapel's own footprint (tiles): 2 wide, 3 deep, the door and the tower on the front (+z, the 's' side before rotation). */
  halfDepth: 1.5,
} as const;

export const WEDDING = {
  /** Chance of a wedding on a given Saturday, by season (the calendar has weekdays: day 5 of 0..6 = Saturday). Summer-weighted, winter rare. */
  saturdayChance: { summer: 0.45, spring: 0.2, autumn: 0.2, winter: 0.08 } as const,
  /** The party sets out at this hour (9 or 10, seeded). */
  departHours: [9, 10] as readonly number[],
  /** Party size, bride and groom included (4..6, seeded). */
  partyMin: 4, partyMax: 6,
  /** Walking speed in tiles per game minute (about 1.1 tiles per second at 1x). */
  walkTilesPerMin: 0.16,
  /** The ceremony starts on the first whole hour after the party arrives (the bell rings) and lasts this long. */
  ceremonyMin: 120,
  /** After the ceremony: this long inside the restaurant / lodge before the party is gone. */
  feastMin: 60,
  /** Income per person at the feast (restaurants category). Without a lodge or restaurant within `feastReach` tiles the party just leaves. */
  feastPerPerson: 110,
  feastReach: 48,
  /** The party starts at the Base Lodge when it is within this many tiles (else it arrives from the valley road side). */
  originReach: 60,
  /** Strikes of the synthesised bell at the start and at the end of the ceremony (the audio caps still apply: AMB.church). */
  bellStrikes: 2,
  /** No wedding in these weather kinds (the day is simply skipped). */
  badWeather: ['storm', 'heavySnow', 'rain'] as readonly string[],
  /** Buildings that serve the wedding feast. */
  feastTypes: ['lodge', 'cafe', 'pizzeria', 'baseLodge'] as readonly string[],
  /** Achievement 'Wedding bells': weddings held in one game. */
  achievementCount: 3,
} as const;
