/**
 * Achievements (M5.3 Task 16): 40 profile-wide, data-driven achievements in three tiers. The engine is `sim/meta/Achievements.ts`
 * (pure event trackers: no RNG, never writes the sim). Add one = add a row here (+ a doc line in docs/achievements.md); the table-driven
 * test checks every row has a valid tracker, known event names and a unique reward.
 *
 * tier 1 = common (1 pt), tier 2 = notable (3 pts), tier 3 = rare / hard (5 pts; the only tier that may show confetti).
 * scope: 'any' = can be earned anywhere (a SANDBOX unlock is tagged `sandbox`), 'career' = career games only (sandbox / free-play never earns it),
 *        'scenario' = only inside scenario runs.
 * Tracker kinds (see Achievements.ts for the exact semantics):
 *   event    count matching bus events (per profile = lifetime counter, per game = in the save's `achievementsRun` module)
 *   render   a render-only counter noted by the page (photos, walk distance, ride-alongs); never counted headless
 *   fact     a number from the daily facts (checked at each day change)
 *   streak   consecutive game days without a matching event (per game)
 *   window   a span between two events in which a violation event must not happen (per game)
 *   distinct distinct values of an event field (per game)
 *   report   the Resort of the Year report of the year that just ended
 *   scenario scenario medals recorded in the profile (a single scenario or all of them)
 */
import type { GameEventName } from '../core/events';
import type { IconName } from '../ui/icons';
import { SCENARIOS } from './scenarios';

export type AchTier = 1 | 2 | 3;
export type AchScope = 'any' | 'career' | 'scenario';
export type Op = '>=' | '<=' | '==' | '!=';
/** A condition on one payload field (or fact). */
export interface Cond { f: string; op: Op; v: string | number | boolean }
export type MedalRank = 1 | 2 | 3;

export type FactKey = 'stars' | 'level' | 'guests' | 'openLifts' | 'money' | 'festivals';
export type Tracker =
  | { kind: 'event'; event: GameEventName; where?: readonly Cond[]; n?: number; per?: 'profile' | 'game'; /** payload field to add instead of 1 */ by?: string; counter?: string }
  | { kind: 'render'; counter: string; n: number }
  | { kind: 'fact'; fact: FactKey; op: '>=' | '<='; v: number }
  | { kind: 'streak'; reset: GameEventName; where?: readonly Cond[]; days: number; /** facts that must hold when the streak is counted */ needs?: readonly FactCond[] }
  | { kind: 'window'; start: GameEventName; startWhere?: readonly Cond[]; end: GameEventName; endWhere?: readonly Cond[]; violate?: GameEventName; violateWhere?: readonly Cond[]; needs?: readonly FactCond[]; /** needs not met at the end event: stay open instead of closing */ retry?: boolean }
  | { kind: 'distinct'; event: GameEventName; key: string; n: number; where?: readonly Cond[] }
  | { kind: 'report'; metric: 'profit' | 'headline' | 'award'; /** headline: 1..3; award: award id + min tier; profit: > 0 */ award?: string; min?: MedalRank }
  | { kind: 'scenario'; /** a scenario id, or 'all' */ scenario: string; min: MedalRank };
export interface FactCond { fact: FactKey; op: '>=' | '<='; v: number }

export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  tier: AchTier;
  icon: IconName;
  scope: AchScope;
  tracker: Tracker;
  /** Shown as '???' on the shelf until unlocked. */
  hidden?: boolean;
  /** Cosmetic id (config/cosmetics.ts) granted by this achievement. At most one per cosmetic. */
  reward?: string;
}

export const TIER_POINTS: Record<AchTier, number> = { 1: 1, 2: 3, 3: 5 };
export const TIER_NAME: Record<AchTier, string> = { 1: 'Common', 2: 'Notable', 3: 'Rare' };

/** Ticks a stranded-lift evacuation may take to count as "within 30 minutes" (6 game minutes per tick). */
export const EVAC_TICKS = 5;
const ALL = 'all';
const SC = SCENARIOS.map((s) => s.id);

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  // ---- tier 1: common
  { id: 'first-guest', title: 'Welcome!', description: 'Greet your very first guest.', tier: 1, icon: 'guests', scope: 'any', tracker: { kind: 'event', event: 'guest:arrived', n: 1, per: 'profile', counter: 'arrivals1' } },
  { id: 'first-lift', title: 'First lift opened', description: 'Build a lift and see it open for business.', tier: 1, icon: 'lift', scope: 'any', tracker: { kind: 'window', start: 'lift:built', end: 'day:changed', needs: [{ fact: 'openLifts', op: '>=', v: 1 }], retry: true }, reward: 'chair:blue' },
  { id: 'first-piste', title: 'First tracks', description: 'Paint your first ski piste.', tier: 1, icon: 'flake', scope: 'any', tracker: { kind: 'event', event: 'piste:painted', where: [{ f: 'layer', op: '==', v: 'ski' }, { f: 'erase', op: '==', v: false }], n: 1, per: 'profile', counter: 'pistesPainted' } },
  { id: 'first-groom', title: 'Fresh corduroy', description: 'See the groomers finish a night shift.', tier: 1, icon: 'snow', scope: 'any', tracker: { kind: 'event', event: 'ops:grooming', where: [{ f: 'vehicles', op: '>=', v: 1 }], n: 1, per: 'profile', counter: 'groomNights' } },
  { id: 'first-rescue', title: 'First responder', description: 'Resolve a guest incident.', tier: 1, icon: 'cross', scope: 'any', tracker: { kind: 'event', event: 'incident:resolved', n: 1, per: 'profile', counter: 'rescues' } },
  { id: 'black-month', title: 'In the black', description: 'Close a month with a profit.', tier: 1, icon: 'coin', scope: 'any', tracker: { kind: 'event', event: 'finance:monthClosed', where: [{ f: 'net', op: '>=', v: 1 }], n: 1, per: 'profile', counter: 'blackMonths' } },
  { id: 'first-marketing', title: 'Spread the word', description: 'Start a marketing campaign.', tier: 1, icon: 'news', scope: 'any', tracker: { kind: 'event', event: 'marketing:started', n: 1, per: 'profile', counter: 'campaigns' } },
  { id: 'first-photo', title: 'Say cheese', description: 'Take a photo in photo mode.', tier: 1, icon: 'camera', scope: 'any', tracker: { kind: 'render', counter: 'photos', n: 1 }, reward: 'frame:alpine' },
  { id: 'first-farm', title: 'Farm fresh', description: 'Build an alpine farm.', tier: 1, icon: 'paw', scope: 'any', tracker: { kind: 'event', event: 'building:placed', where: [{ f: 'type', op: '==', v: 'alpineFarm' }], n: 1, per: 'profile', counter: 'farms' } },
  { id: 'first-ranger', title: 'Ranger on duty', description: 'Build a ranger station.', tier: 1, icon: 'mountain', scope: 'any', tracker: { kind: 'event', event: 'building:placed', where: [{ f: 'type', op: '==', v: 'rangerStation' }], n: 1, per: 'profile', counter: 'rangers' } },
  { id: 'snow-cannon', title: 'Snow on demand', description: 'Install a snow cannon.', tier: 1, icon: 'flake', scope: 'any', tracker: { kind: 'event', event: 'building:placed', where: [{ f: 'type', op: '==', v: 'snowCannon' }], n: 1, per: 'profile', counter: 'cannons' } },
  { id: 'guests-1000', title: 'Busy slopes', description: 'Welcome 1,000 guests, across all your games.', tier: 1, icon: 'guests', scope: 'any', tracker: { kind: 'event', event: 'guest:arrived', n: 1000, per: 'profile', counter: 'guests' } },
  { id: 'ride-gondola', title: 'Gondola ride', description: 'Ride along with a guest on a gondola.', tier: 1, icon: 'lift', scope: 'any', tracker: { kind: 'render', counter: 'rideGondola', n: 1 } },
  { id: 'first-medal', title: 'Medal rack', description: 'Win any scenario with a medal.', tier: 1, icon: 'medal', scope: 'scenario', tracker: { kind: 'scenario', scenario: 'any', min: 1 }, reward: 'flags:tricolour' },
  { id: 'boom', title: 'Controlled release', description: 'Trigger a controlled avalanche release before it triggers itself.', tier: 1, icon: 'flake', scope: 'any', hidden: true, tracker: { kind: 'event', event: 'incident:avalanche', where: [{ f: 'controlled', op: '==', v: true }], n: 1, per: 'profile', counter: 'controlled' } },
  // ---- tier 2: notable
  { id: 'four-stars', title: 'Four-star resort', description: 'Reach a 4-star rating.', tier: 2, icon: 'star', scope: 'any', tracker: { kind: 'event', event: 'rating:changed', where: [{ f: 'stars', op: '>=', v: 4 }], n: 1, per: 'profile', counter: 'fourStars' }, reward: 'palette:slate' },
  { id: 'level-4', title: 'Rising resort', description: 'Reach resort level 4.', tier: 2, icon: 'mountain', scope: 'career', tracker: { kind: 'fact', fact: 'level', op: '>=', v: 4 } },
  { id: 'guests-10000', title: 'Ten thousand welcomed', description: 'Welcome 10,000 guests, across all your games.', tier: 2, icon: 'guests', scope: 'any', tracker: { kind: 'event', event: 'guest:arrived', n: 10000, per: 'profile', counter: 'guests' } },
  { id: 'rescues-100', title: 'Mountain rescue', description: 'Resolve 100 guest incidents.', tier: 2, icon: 'cross', scope: 'any', tracker: { kind: 'event', event: 'incident:resolved', n: 100, per: 'profile', counter: 'rescues' }, reward: 'chair:yellow' },
  { id: 'photos-10', title: 'Shutterbug', description: 'Take 10 photos.', tier: 2, icon: 'camera', scope: 'any', tracker: { kind: 'render', counter: 'photos', n: 10 }, reward: 'frame:noir' },
  { id: 'walk-5km', title: 'Five kilometres on foot', description: 'Walk 5 km around your resort in walk mode.', tier: 2, icon: 'walk', scope: 'any', tracker: { kind: 'render', counter: 'walkM', n: 5000 }, reward: 'palette:sunset' },
  { id: 'farm-parade', title: 'Cow parade', description: 'See the Almabtrieb: the decorated cows coming down from the pastures.', tier: 2, icon: 'paw', scope: 'any', tracker: { kind: 'fact', fact: 'festivals', op: '>=', v: 1 }, reward: 'flags:festival' },
  { id: 'bear-relocated', title: 'Gentle relocation', description: 'Have your rangers relocate a bear safely.', tier: 2, icon: 'paw', scope: 'any', tracker: { kind: 'event', event: 'wildlife:relocated', n: 1, per: 'profile', counter: 'bearsMoved' }, reward: 'chair:green' },
  { id: 'evac-30', title: 'Quick evacuation', description: 'Evacuate guests stranded on a broken lift within 30 minutes.', tier: 2, icon: 'lift', scope: 'any', tracker: { kind: 'event', event: 'incident:resolved', where: [{ f: 'kind', op: '==', v: 'stranded' }, { f: 'outcome', op: '==', v: 'evacuated' }, { f: 'responseTicks', op: '<=', v: EVAC_TICKS }], n: 1, per: 'profile', counter: 'quickEvac' } },
  { id: 'safe-winter', title: 'A safe winter', description: 'Get through a whole winter without a hospitalised guest.', tier: 2, icon: 'cross', scope: 'any', tracker: { kind: 'window', start: 'season:changed', startWhere: [{ f: 'season', op: '==', v: 'winter' }], end: 'season:changed', endWhere: [{ f: 'previous', op: '==', v: 'winter' }], violate: 'incident:resolved', violateWhere: [{ f: 'outcome', op: '==', v: 'hospitalised' }], needs: [{ fact: 'guests', op: '>=', v: 10 }, { fact: 'openLifts', op: '>=', v: 1 }] } },
  { id: 'quiet-mountain', title: 'Quiet mountain', description: 'Go 50 days without an avalanche closing a piste.', tier: 2, icon: 'snow', scope: 'any', tracker: { kind: 'streak', reset: 'incident:avalanche', where: [{ f: 'controlled', op: '!=', v: true }], days: 50, needs: [{ fact: 'openLifts', op: '>=', v: 1 }] } },
  { id: 'year-profit', title: 'A year in profit', description: 'Finish a full year with a profit.', tier: 2, icon: 'coin', scope: 'career', tracker: { kind: 'report', metric: 'profit' } },
  { id: 'scenario-silver', title: 'Silver finish', description: 'Win any scenario with at least a silver medal.', tier: 2, icon: 'medal', scope: 'scenario', tracker: { kind: 'scenario', scenario: 'any', min: 2 } },
  { id: 'scenarios-all', title: 'Six for six', description: 'Win every scenario with at least bronze.', tier: 2, icon: 'medal', scope: 'scenario', tracker: { kind: 'scenario', scenario: ALL, min: 1 } },
  { id: 'wildlife-friendly', title: 'Wildlife friendly', description: 'Earn the Wildlife Friendly award in a year report.', tier: 2, icon: 'paw', scope: 'career', tracker: { kind: 'report', metric: 'award', award: 'wildlife', min: 1 }, reward: 'palette:forest-green' },
  { id: 'zero-debt', title: 'Debt-free year', description: 'Get through a whole year without ever going into debt.', tier: 2, icon: 'coin', scope: 'career', tracker: { kind: 'window', start: 'year:changed', end: 'year:changed', violate: 'finance:debtWarning', needs: [{ fact: 'guests', op: '>=', v: 10 }] } },
  { id: 'bear-necessities', title: 'Bear necessities', description: 'Have rangers haze a bear away from your guests three times.', tier: 2, icon: 'paw', scope: 'any', hidden: true, tracker: { kind: 'event', event: 'wildlife:hazed', n: 3, per: 'profile', counter: 'hazed' } },
  { id: 'eye-of-storm', title: 'Eye of the storm', description: 'Keep a lift open while a storm rages over a busy resort.', tier: 2, icon: 'storm', scope: 'any', hidden: true, tracker: { kind: 'window', start: 'weather:changed', startWhere: [{ f: 'kind', op: '==', v: 'storm' }], end: 'weather:changed', endWhere: [{ f: 'previous', op: '==', v: 'storm' }], needs: [{ fact: 'guests', op: '>=', v: 40 }, { fact: 'openLifts', op: '>=', v: 1 }] } },
  { id: 'back-from-brink', title: 'Back from the brink', description: 'Recover after a long stretch in debt.', tier: 2, icon: 'coin', scope: 'any', hidden: true, tracker: { kind: 'window', start: 'finance:debtWarning', startWhere: [{ f: 'level', op: '>=', v: 2 }], end: 'month:changed', needs: [{ fact: 'money', op: '>=', v: 1 }], retry: true } },
  // ---- tier 3: rare
  { id: 'roy-gold', title: 'Resort of the Year: Gold', description: 'Be named Resort of the Year with a gold headline.', tier: 3, icon: 'trophy', scope: 'career', tracker: { kind: 'report', metric: 'headline', min: 3 }, reward: 'flags:golden' },
  { id: 'level-6', title: 'Alpine destination', description: 'Reach resort level 6.', tier: 3, icon: 'mountain', scope: 'career', tracker: { kind: 'fact', fact: 'level', op: '>=', v: 6 } },
  { id: 'all-lifts', title: 'Every kind of lift', description: 'Build every lift type in one game.', tier: 3, icon: 'lift', scope: 'any', tracker: { kind: 'distinct', event: 'lift:built', key: 'kind', n: 12 } },
  { id: 'scenario-gold', title: 'Gold standard', description: 'Win any scenario with a gold medal.', tier: 3, icon: 'medal', scope: 'scenario', tracker: { kind: 'scenario', scenario: 'any', min: 3 }, reward: 'frame:gold' },
  { id: 'scenarios-gold', title: 'Grand slam', description: 'Win every scenario with a gold medal.', tier: 3, icon: 'trophy', scope: 'scenario', tracker: { kind: 'scenario', scenario: ALL, min: 3 } },
  { id: 'guests-100000', title: 'A hundred thousand', description: 'Welcome 100,000 guests, across all your games.', tier: 3, icon: 'guests', scope: 'any', tracker: { kind: 'event', event: 'guest:arrived', n: 100000, per: 'profile', counter: 'guests' }, reward: 'palette:alpine-red' },
];

export const ACHIEVEMENT_BY_ID: Readonly<Record<string, AchievementDef>> = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));
export const ACHIEVEMENT_COUNT = ACHIEVEMENTS.length;
/** The achievement that grants a cosmetic (null for the defaults). */
export const cosmeticUnlockedBy = (cosmeticId: string): AchievementDef | null => ACHIEVEMENTS.find((a) => a.reward === cosmeticId) ?? null;
/** Scenario ids the 'all six' trackers look at. */
export const SCENARIO_IDS: readonly string[] = SC;
export const MEDAL_RANK_NAME: Record<MedalRank, string> = { 1: 'bronze', 2: 'silver', 3: 'gold' };
