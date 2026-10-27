import type { SeasonId } from '../core/events';

/**
 * Festivals, critic visits and powder days (M5.4 Task 21). Documented in docs/festivals.md; every number here is tunable.
 *
 * `booked` festivals are scheduled by the player in the Events calendar (cost, season window, prerequisites, a few days of lead time).
 * `auto` events happen by themselves: Almabtrieb (derived from the livestock calendar), New Year, critic visits (announced 3 days ahead) and
 * powder days (a snowfall).
 * Every festival carries a `dressing` spec: the render layer dresses the road / plaza near the base station with instanced bunting, flags,
 * banners (festival name), market stalls, a procession or a grandstand for the festival's duration (render/festival/*).
 */
export type FestivalId = 'almabtrieb' | 'christmasMarket' | 'carnival' | 'musicFestival' | 'worldCup' | 'newYear' | 'critic' | 'powder';
export const FESTIVAL_IDS: readonly FestivalId[] = ['almabtrieb', 'christmasMarket', 'carnival', 'musicFestival', 'worldCup', 'newYear', 'critic', 'powder'];

export type Range = readonly [min: number, max: number];

export interface DressingSpec {
  /** Road / path tiles strung with bunting (up to). */
  bunting: Range;
  flags: Range;
  /** Banners that carry the festival name. */
  banners: Range;
  stalls: Range;
  /** Cosmetic procession walking a loop along the dressed road (daytime). 'racer' = World Cup racers running down the black piste. */
  procession?: { kind: 'cow' | 'costume' | 'racer'; count: Range };
  /** World Cup: grandstand + finish banner at the foot of the black piste. */
  grandstand?: boolean;
  /** Pennant / flag / canopy colours. */
  palette: readonly number[];
}

export type FestivalNeed = 'lodge' | 'blackPiste';

export interface FestivalDef {
  id: FestivalId;
  name: string;
  icon: string;
  blurb: string;
  kind: 'booked' | 'auto';
  /** Booked: the season the festival may start in. */
  seasons: readonly SeasonId[];
  /** Booked: sim day-of-year window (inclusive) the festival may START in (0..179; sim day 0 = 1 April, see sim/calendar.ts and the table in docs/festivals.md). */
  startWindow?: Range;
  days: number;
  /** Booked: days between booking and the earliest start. */
  leadDays: number;
  cost: number;
  /** Arrival multiplier while it runs (1 = none). */
  arrivalMult: number;
  /** Happiness every guest in the resort gains per festival day (0..1 scale, small). */
  cheer: number;
  minStars: number;
  /** Resort level needed (Career; Sandbox ignores it). */
  minLevel: number;
  needs: readonly FestivalNeed[];
  dressing?: DressingSpec;
  /** Restrained fireworks: at night on the last day ('finale'), the first day ('first') or never. */
  fireworks: 'finale' | 'first' | 'none';
}

const WARM = [0xd9534a, 0xf2c14e, 0x4f86a8, 0xf4efe2, 0x6fae5a] as const;

export const FESTIVALS: readonly FestivalDef[] = [
  {
    id: 'almabtrieb', name: 'Almabtrieb', icon: '🐄', kind: 'auto', seasons: ['autumn'], days: 10, leadDays: 0, cost: 0, arrivalMult: 1.06, cheer: 0, minStars: 0, minLevel: 1, needs: [],
    blurb: 'The decorated cows come down from the alpine pastures. Needs an Alpine Farm; runs by itself on 1-11 October, announced 3 days ahead.',
    dressing: { bunting: [8, 12], flags: [6, 8], banners: [1, 1], stalls: [0, 0], procession: { kind: 'cow', count: [6, 10] }, palette: [0xf4efe2, 0xd9534a, 0x6fae5a, 0xf2c14e] },
    fireworks: 'none',
  },
  {
    id: 'christmasMarket', name: 'Christmas Market', icon: '🎄', kind: 'booked', seasons: ['winter'], startWindow: [120, 128], days: 8, leadDays: 3, cost: 3_000, arrivalMult: 1.18, cheer: 0.01, minStars: 2, minLevel: 2, needs: ['lodge'],
    blurb: 'Wooden stalls, mulled wine and fairy lights around the village. A cosy winter draw.',
    dressing: { bunting: [12, 18], flags: [4, 6], banners: [1, 1], stalls: [4, 6], palette: [0xc0392b, 0x2f7d46, 0xf2c14e, 0xf4efe2] },
    fireworks: 'finale',
  },
  {
    id: 'carnival', name: 'Winter Carnival', icon: '🎭', kind: 'booked', seasons: ['winter'], startWindow: [150, 160], days: 5, leadDays: 3, cost: 4_000, arrivalMult: 1.2, cheer: 0.015, minStars: 2.5, minLevel: 3, needs: ['lodge'],
    blurb: 'Banners, stalls and a costumed procession through the village.',
    dressing: { bunting: [14, 20], flags: [6, 8], banners: [2, 2], stalls: [3, 4], procession: { kind: 'costume', count: [8, 12] }, palette: [0xe8453c, 0xf2c14e, 0x8e5bd0, 0x2ba6a0, 0xf08a24] },
    fireworks: 'finale',
  },
  {
    id: 'musicFestival', name: 'Summer Music Festival', icon: '🎵', kind: 'booked', seasons: ['summer'], startWindow: [30, 70], days: 4, leadDays: 4, cost: 6_000, arrivalMult: 1.35, cheer: 0.015, minStars: 3, minLevel: 3, needs: ['lodge'],
    blurb: 'Open-air concerts on the village green. A big off-season crowd for a few days.',
    dressing: { bunting: [10, 16], flags: [6, 8], banners: [2, 2], stalls: [4, 6], palette: [0xf06292, 0x4fc3f7, 0xf2c14e, 0xaed581, 0xba68c8] },
    fireworks: 'finale',
  },
  {
    id: 'worldCup', name: 'World Cup Race', icon: '🏆', kind: 'booked', seasons: ['winter'], startWindow: [140, 164], days: 3, leadDays: 5, cost: 15_000, arrivalMult: 1.3, cheer: 0.01, minStars: 3.5, minLevel: 4, needs: ['lodge', 'blackPiste'],
    blurb: 'Racers on a black piste, a grandstand and a finish banner. Needs a black piste.',
    dressing: { bunting: [8, 12], flags: [8, 10], banners: [1, 2], stalls: [0, 0], procession: { kind: 'racer', count: [6, 8] }, grandstand: true, palette: WARM },
    fireworks: 'finale',
  },
  {
    id: 'newYear', name: 'New Year', icon: '🎆', kind: 'auto', seasons: ['winter'], days: 2, leadDays: 0, cost: 0, arrivalMult: 1.1, cheer: 0.01, minStars: 0, minLevel: 1, needs: [],
    blurb: 'A small fireworks show on New Year\'s Eve (last day of December).',
    dressing: { bunting: [6, 8], flags: [4, 4], banners: [1, 1], stalls: [0, 0], palette: [0xf4efe2, 0xf2c14e, 0x4f86a8] },
    fireworks: 'first',
  },
  {
    id: 'critic', name: 'Critic visit', icon: '📝', kind: 'auto', seasons: [], days: 1, leadDays: 0, cost: 0, arrivalMult: 1, cheer: 0, minStars: 0, minLevel: 1, needs: [],
    blurb: 'A travel critic tours the resort (announced 3 days ahead). A good review brings guests, a bad one scares some off.',
    fireworks: 'none',
  },
  {
    id: 'powder', name: 'Powder day', icon: '❄️', kind: 'auto', seasons: ['winter'], days: 1, leadDays: 0, cost: 0, arrivalMult: 1.2, cheer: 0.02, minStars: 0, minLevel: 1, needs: [],
    blurb: 'Fresh snow! More guests turn up for a day.',
    fireworks: 'none',
  },
];

export const FESTIVAL_BY_ID: Record<FestivalId, FestivalDef> = Object.fromEntries(FESTIVALS.map((f) => [f.id, f])) as Record<FestivalId, FestivalDef>;
export const BOOKABLE_FESTIVALS: readonly FestivalDef[] = FESTIVALS.filter((f) => f.kind === 'booked');

export const EVENTS = {
  /** Critic: days announced ahead, first visit window and the gap between visits (days). */
  criticAnnounceDays: 3, almAnnounceDays: 3, criticFirst: [25, 70] as Range, criticGap: [80, 140] as Range,
  /** Review score (0..5, half steps) at or above / at or below which the review changes arrivals, the multiplier and how many days it lasts. */
  goodReview: 4, badReview: 2, goodMult: 1.12, badMult: 0.92, reviewDays: 10,
  /** Powder day: minimum days between two, and the earliest hour of day it can be declared. */
  powderCooldown: 8,
  /** Refund share when a booking is cancelled before it starts. */
  refund: 0.8,
  /** Earliest hour of day (game hours) a fireworks show may start (and it must be dark). */
  fireworksFrom: 17,
  /** Months... the horizon (days) the calendar lists. */
  horizonDays: 150,
} as const;
