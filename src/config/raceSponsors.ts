/**
 * Race sponsors (0.8.1, docs/race-course.md "Race days"). A POOL of made-up, harmless, Alpine-flavoured names (owner decision 2026-11-16): a course gets ONE sponsor,
 * picked by a seeded hash the first time a race day is booked on it. Every name is fictional: `tests/repo/raceSponsors.test.ts` checks them against a denylist of real
 * brands (and a human reviews the list when it changes). Humour is sparing: a line is only used in the news.
 */
export interface Sponsor {
  id: string;
  /** Shown on the timing board and in the news (<= 28 characters: the board is 256 px wide). */
  name: string;
  /** Short flavour for the news item (optional, used sparingly). */
  line?: string;
  /** Dollars paid per race day. */
  pay: number;
  /** Rating points (0..1 of a 100-point score = at most +0.05 stars) the sponsor adds for a while after a race. */
  rating: number;
}
export const SPONSORS: readonly Sponsor[] = [
  { id: 'hinterwald', name: 'Hinterwald Cheese Dairy', line: 'The finish area smells faintly of cheese.', pay: 290, rating: 0.8 },
  { id: 'gleit', name: 'Schmier & Gleit Ski Wax', pay: 320, rating: 0.9 },
  { id: 'zwiebelberg', name: 'Zwiebelberg Mountain Bakery', line: 'Fresh pretzels for every finisher.', pay: 260, rating: 0.7 },
  { id: 'murmel', name: 'Murmel Meadow Honey', pay: 270, rating: 0.8 },
  { id: 'tannenzapf', name: 'Tannenzapf Pine Tea', pay: 240, rating: 0.7 },
  { id: 'gams', name: 'Gams & Sons Cowbells', line: 'The cowbells are not part of the timing system.', pay: 280, rating: 0.8 },
  { id: 'fritz', name: 'Fondue Fritz & Co.', pay: 290, rating: 0.8 },
  { id: 'schneehase', name: 'Schneehase Goggles', pay: 330, rating: 1.0 },
  { id: 'oberhinterberg', name: 'Oberhinterberg Sausage Works', pay: 260, rating: 0.7 },
  { id: 'wollknaeuel', name: 'Wollknäuel Sock Mill', pay: 250, rating: 0.7 },
];
/** Tokens of real companies / brands that must never appear in a sponsor name (checked case-insensitively by a repo test). */
export const SPONSOR_DENYLIST: readonly string[] = [
  'red bull', 'milka', 'ricola', 'swarovski', 'atomic', 'rossignol', 'salomon', 'fischer', 'blizzard', 'nordica', 'burton', 'patagonia', 'north face', 'marmot', 'columbia', 'toko', 'swix', 'holmenkol',
  'dakine', 'oakley', 'uvex', 'giro', 'bolle', 'bollé', 'scott', 'mammut', 'ortovox', 'victorinox', 'lindt', 'toblerone', 'nestle', 'nestlé', 'emmi', 'migros', 'coop', 'spar', 'hofer', 'aldi', 'lidl',
  'tchibo', 'jagermeister', 'jägermeister', 'raiffeisen', 'swisscom', 'rolex', 'omega', 'tissot', 'audi', 'bmw', 'mercedes', 'porsche', 'volvo', 'skoda', 'audemars', 'longines', 'zurich', 'allianz', 'generali',
  'doppelmayr', 'leitner', 'garaventa', 'bartholet', 'poma', 'prinoth', 'pistenbully', 'kassbohrer', 'kässbohrer', 'coca', 'pepsi', 'fanta', 'sprite', 'nike', 'adidas', 'puma', 'gore', 'arcteryx', "arc'teryx",
  'google', 'garmin', 'gopro', 'suunto', 'petzl', 'black diamond', 'lowa', 'meindl', 'sherpa', 'kellogg', 'kraft', 'danone', 'muller', 'müller', 'ovomaltine', 'wander', 'knorr', 'maggi', 'haribo',
  'glidewell', 'moser', 'edelweiss', 'bergfrisch', 'almdudler', 'stiegl', 'gösser', 'gosser', 'zipfer', 'tegernseer', 'bergader', 'milram', 'kaernten', 'kärntner',
];
export const SPONSOR_BY_ID: Readonly<Record<string, Sponsor>> = Object.fromEntries(SPONSORS.map((s) => [s.id, s]));
