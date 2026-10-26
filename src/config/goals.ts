/**
 * Resort goal chain (M5.1 Task 3): the career of a resort director in four chapters, 20 goals. Engine: `src/sim/goals/Goals.ts`.
 * Tone (decision D4): plain career voice, a light joke now and then, never more than one short line. Rewards are small grants
 * (`grant` ledger category); the whole chain pays about 67,500 dollars (`TOTAL_REWARDS`) over several years; the balance bot earns about 4.5 % of its year-1 revenue from grants (limit 10 %, tests/sim/goals.test.ts).
 * Every goal must be reachable by normal play (no luck-based goals such as "survive an avalanche"), because a chapter ends when all its goals are done.
 */
import type { GoalCtx, GoalWorld, Pt } from '../sim/goals/Goals';

export interface ChapterDef {
  id: string;
  /** Short career title ("Season 1: Open for business"). */
  title: string;
  /** One line printed in the news when the chapter is complete. */
  outro: string;
}

export interface GoalDef {
  id: string;
  chapter: string;
  title: string;
  /** Short career-style flavour line. */
  flavour: string;
  /** What to do, in one plain sentence. */
  todo: string;
  /** Grant in dollars. */
  reward: number;
  /** Progress 0..1 (>= 1 completes the goal). Derived from sim state / latched facts only. */
  check(c: GoalCtx): number;
  /** Where "Show me" looks (a tile), or null when nothing exists yet. */
  focus?(w: GoalWorld): Pt | null;
}

export const CHAPTERS: readonly ChapterDef[] = [
  { id: 's1', title: 'Season 1: Open for business', outro: 'The valley has noticed the new lifts.' },
  { id: 'local', title: 'Local favourite', outro: 'The regional paper has noticed you.' },
  { id: 'regional', title: 'Regional name', outro: 'Tour operators now ask for you by name.' },
  { id: 'alpine', title: 'Alpine destination', outro: 'The board calls it a resort worth a trip. Congratulations, director.' },
];

const ratio = (v: number, target: number): number => Math.min(1, Math.max(0, v / target));
const has = (w: GoalWorld, ...types: string[]): boolean => w.buildings().some((b) => b.active && types.includes(b.type));
const firstOf = (w: GoalWorld, ...types: string[]): Pt | null => { const b = w.buildings().find((x) => types.includes(x.type)); return b ? { x: b.x + (b.w >> 1), y: b.y + (b.h >> 1) } : null; };
const lodge = (w: GoalWorld): Pt | null => firstOf(w, 'baseLodge');
const pistePt = (w: GoalWorld, d: number): Pt | null => { const p = w.pistes().find((x) => x.difficulty === d); return p ? { x: p.x, y: p.y } : null; };
const pisteTiles = (w: GoalWorld, d: number): number => w.pistes().filter((p) => p.difficulty === d).reduce((a, p) => a + p.tiles, 0);
const PISTE_FULL = 12;
/** Tiles of each of green / blue / red for the 'mixed runs' goal. */
const MIXED_TILES = 5;
const liftPt = (w: GoalWorld): Pt | null => { const l = w.lifts()[0]; return l ? { x: l.x, y: l.y } : lodge(w); };
const stars = (w: GoalWorld, s: number): number => ratio(w.stars(), s);
const dayGuests = (c: GoalCtx, n: number): number => ratio(c.f.bestDay, n);
const SUMMER_TYPES = ['adventurePark', 'beach', 'boatRental'];

export const GOALS: readonly GoalDef[] = [
  // ---- Season 1: Open for business ----
  { id: 'firstLift', chapter: 's1', title: 'Open your first lift', flavour: 'Cut the ribbon. Somebody will have to hold the scissors.', todo: 'Build a lift from the base to higher ground and keep it open.', reward: 1000,
    check: ({ w }) => (w.lifts().some((l) => l.open) ? 1 : w.lifts().length > 0 ? 0.5 : 0), focus: liftPt },
  { id: 'greenRun', chapter: 's1', title: 'Paint an easy run', flavour: 'Every director starts on the nursery slope.', todo: 'Paint a connected, gentle piste (green or blue) next to your lift.', reward: 1000,
    // Easy = green + blue tiles (difficulty codes 1 and 2). Before the 0.1.0-m5.4 difficulty fix this was "difficulty 1", which in practice also meant green + blue.
    check: ({ w }) => ratio(pisteTiles(w, 1) + pisteTiles(w, 2), PISTE_FULL), focus: (w) => pistePt(w, 1) ?? pistePt(w, 2) ?? liftPt(w) },
  { id: 'patrol', chapter: 's1', title: 'Safety first: Ski Patrol Hub', flavour: 'The insurer asks about it before anything else.', todo: 'Build a Ski Patrol Hub on a road.', reward: 1500,
    check: ({ w }) => (has(w, 'patrolHub') ? 1 : 0), focus: (w) => firstOf(w, 'patrolHub') ?? lodge(w) },
  { id: 'guests30', chapter: 's1', title: 'Welcome 30 guests in a day', flavour: 'The first proper queue at the ticket window.', todo: 'Open lifts and pistes and keep the base easy to reach.', reward: 1500,
    check: (c) => dayGuests(c, 30), focus: lodge },

  // ---- Local favourite ----
  { id: 'stars3', chapter: 'local', title: 'Reach a 3-star rating', flavour: 'Guests start recommending you to friends.', todo: 'Keep queues short, pistes in shape and guests fed. The rating panel shows what to fix.', reward: 2000,
    check: ({ w }) => stars(w, 3), focus: lodge },
  { id: 'mixedRuns', chapter: 'local', title: 'Green, blue and red runs', flavour: 'Something for the cautious, the keen and the show-offs.', todo: 'Open at least one connected piste of each of these three difficulties.', reward: 2000,
    check: ({ w }) => ([1, 2, 3].reduce((a, d) => a + ratio(pisteTiles(w, d), MIXED_TILES), 0)) / 3,
    focus: (w) => pistePt(w, 2) ?? pistePt(w, 3) ?? liftPt(w) },
  { id: 'guests80', chapter: 'local', title: 'Welcome 80 guests in a day', flavour: 'The car park is the busiest place in the valley.', todo: 'More lift capacity and parking carry more guests.', reward: 2500,
    check: (c) => dayGuests(c, 80), focus: (w) => firstOf(w, 'parking') ?? lodge(w) },
  { id: 'profitMonth', chapter: 'local', title: 'Close a month in profit', flavour: 'The accountant smiled. Briefly.', todo: 'Keep income above upkeep, wages and energy. Check the Finance drawer.', reward: 2500,
    check: (c) => (c.f.profitMonths > 0 ? 1 : 0), focus: lodge },
  { id: 'skiSchool', chapter: 'local', title: 'Run a ski school', flavour: 'Tomorrow\u2019s regulars are learning to snowplough today.', todo: 'Build a Ski School HQ on a path.', reward: 2500,
    check: ({ w }) => (has(w, 'skiSchoolHQ') ? 1 : 0), focus: (w) => firstOf(w, 'skiSchoolHQ') ?? lodge(w) },

  // ---- Regional name ----
  { id: 'groomed', chapter: 'regional', title: 'Groom a night', flavour: 'Fresh corduroy at dawn is a promise to the guests.', todo: 'Build a Groomer Garage so the snowcats can work overnight.', reward: 3000,
    check: (c) => (c.f.groomedNights > 0 ? 1 : has(c.w, 'groomerGarage') ? 0.5 : 0), focus: (w) => firstOf(w, 'groomerGarage') ?? lodge(w) },
  { id: 'stars4', chapter: 'regional', title: 'Reach a 4-star rating', flavour: 'Guide books begin to mention the resort.', todo: 'Fix the weakest bar in the rating panel first.', reward: 3500,
    check: ({ w }) => stars(w, 4), focus: lodge },
  { id: 'blackRun', chapter: 'regional', title: 'Open a black run', flavour: 'For the guests who read warning signs as invitations.', todo: 'Paint a steep, connected piste for experts.', reward: 3000,
    check: ({ w }) => ratio(pisteTiles(w, 4), 8), focus: (w) => pistePt(w, 4) ?? liftPt(w) },
  { id: 'rescue', chapter: 'regional', title: 'Complete a rescue', flavour: 'Training pays off when it is needed.', todo: 'Keep the patrol hub staffed; a rescue happens when a guest gets hurt.', reward: 3000,
    check: (c) => (c.f.rescues > 0 ? 1 : 0), focus: (w) => firstOf(w, 'patrolHub') ?? lodge(w) },
  { id: 'debtFree', chapter: 'regional', title: 'Debt-free with $50,000 in the bank', flavour: 'The bank manager now sends birthday cards.', todo: 'Repay your loans and keep a cash cushion.', reward: 4000,
    check: ({ w }) => (w.debt() <= 0 ? 0.5 : 0) + 0.5 * ratio(w.money(), 50_000), focus: lodge },

  // ---- Alpine destination ----
  { id: 'guests200', chapter: 'alpine', title: 'Welcome 200 guests in a day', flavour: 'A full valley. Please mind the shuttle bus.', todo: 'Capacity everywhere: lifts, parking, restaurants and beds.', reward: 5000,
    check: (c) => dayGuests(c, 200), focus: lodge },
  { id: 'stars45', chapter: 'alpine', title: 'Reach a 4.5-star rating', flavour: 'Postcards of your resort are now sold in the valley.', todo: 'Aim for top marks in every rating component.', reward: 7000,
    check: ({ w }) => stars(w, 4.5), focus: lodge },
  { id: 'summer', chapter: 'alpine', title: 'Open a summer attraction', flavour: 'The mountain works in July, too.', todo: 'Build an Adventure Park, a Beach or a Boat Rental, or open a bike trail.', reward: 5000,
    check: ({ w }) => (has(w, ...SUMMER_TYPES) || w.trailTiles() > 0 ? 1 : 0), focus: (w) => firstOf(w, ...SUMMER_TYPES) ?? lodge(w) },
  { id: 'liftKinds', chapter: 'alpine', title: 'Three kinds of lift', flavour: 'From drag lift to gondola, the whole family is here.', todo: 'Build lifts of three different kinds, such as a T-bar, a chairlift and a gondola.', reward: 5500,
    check: ({ w }) => ratio(new Set(w.lifts().map((l) => l.kind)).size, 3), focus: liftPt },
  { id: 'ranger', chapter: 'alpine', title: 'Ranger Station on duty', flavour: 'Ranger Rudi finally has a roof over his head.', todo: 'Build a Ranger Station to keep wildlife and guests apart.', reward: 5000,
    check: ({ w }) => (has(w, 'rangerStation') ? 1 : 0), focus: (w) => firstOf(w, 'rangerStation') ?? lodge(w) },
  { id: 'guests5000', chapter: 'alpine', title: 'Welcome 5,000 guests in total', flavour: 'Five thousand stories, and none of them is about a lost glove.', todo: 'Keep the resort open and the guests happy.', reward: 7000,
    check: (c) => ratio(c.f.lifetime, 5000), focus: lodge },
];

/** Sum of every reward (dollars). */
export const TOTAL_REWARDS = GOALS.reduce((a, g) => a + g.reward, 0);
