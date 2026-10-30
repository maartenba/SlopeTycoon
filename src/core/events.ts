import type { EventBus } from './EventBus';

export type Speed = 0 | 1 | 2 | 3;
export type SeasonId = 'spring' | 'summer' | 'autumn' | 'winter';
export type WeatherKind = 'clear' | 'cloudy' | 'snow' | 'heavySnow' | 'rain' | 'storm';

/**
 * Typed gameplay event map. Every emitter/consumer goes through `GameBus`, so unknown events or wrong payloads are type errors.
 */
export interface GameEvents {
  /** A guest entered the resort. */
  'guest:arrived': { id: number };
  /** A guest left the resort. */
  'guest:left': { id: number; reason: 'satisfied' | 'bored' | 'broke' | 'injured' | 'closing' };
  /** A departing guest left a short review (~5% of departures, <= 6 per day). Not a toast and not a main news row: shown in the News 'Reviews' tab. `x`/`y` (tile) only when a place is known. */
  'guest:review': { guestId: number; stars: number; text: string; tone: 'plain' | 'light'; driver: string; x?: number; y?: number };
  /** A story guest's wish resolved (M5.4 Task 22). `text` is the plain-voice news line; a failure also emits a mild `guest:review`. `x`/`y` = where the guest was last seen (tiles). */
  'story:resolved': { guestId: number; name: string; wish: string; outcome: 'granted' | 'failed'; text: string; tone: 'plain' | 'light'; tip: number; x: number; y: number };
  /** A building was placed. */
  'building:placed': { id: number; type: string; x: number; y: number };
  /** A building was removed (bulldozed). */
  'building:removed': { id: number; type: string };
  /** A footpath/road/rail stroke was committed (or erased). `tiles` = tiles in the stroke. */
  'path:drawn': { kind: 'path' | 'road' | 'rail'; tiles: number; erase: boolean };
  /** A piste/trail stroke was painted (or erased). */
  /** A backcountry route opened / closed (avalanche danger, snow, override; docs/backcountry.md). */
  'backcountry:opened': { id: number; danger: number };
  'backcountry:closed': { id: number; danger: number; reason?: string };
  'piste:painted': { layer: 'ski' | 'mtb' | 'hike' | 'backcountry'; tiles: number; erase: boolean };
  /** A lift was built. */
  'lift:built': { id: number; kind: string };
  /** A lift was opened or closed. */
  'lift:opened': { id: number; open: boolean };
  /** A lift closed because of conditions (snow/altitude/mode); `lift:opened` with open=false is emitted too. */
  'lift:closed': { id: number; reason: string };
  /** An attraction/commercial building started accepting guests (conditions, staff and dependencies are fine). */
  'attraction:opened': { id: number; type: string };
  /** An attraction/commercial building stopped accepting guests; `reason` is the inspector text (e.g. 'Closed: no snow at 1,450 m'). */
  'attraction:closed': { id: number; type: string; reason: string };
  /** The day's weather kind changed (valley temperature in °C, snowline in world units). */
  'weather:changed': { kind: WeatherKind; previous: WeatherKind; temperature: number; snowline: number; precipitation: 'none' | 'snow' | 'rain' };
  /** A piste was opened or closed. */
  'piste:opened': { id: number; open: boolean };
  /** Cash changed; `delta` is the signed change. */
  'money:changed': { money: number; delta: number; reason?: string; category?: string };
  /** A loan was taken (`rate` = annual %, `total` = outstanding debt afterwards). */
  'loan:taken': { amount: number; total: number; rate: number; termMonths: number };
  /** Game speed changed (0 = paused). */
  'speed:changed': { speed: Speed; previous: Speed };
  /** The season changed (month-based). */
  'season:changed': { season: SeasonId; previous: SeasonId };
  /** An avalanche hit at tile (x, y). */
  'incident:avalanche': { x: number; y: number; severity: number; /** Tiles swept by the slide. */ tiles?: number; /** Guests buried (0 for controlled releases). */ buried?: number; controlled?: boolean; /** News is suppressed (rate-limited; events/sounds/closures still apply). */ quiet?: boolean };
  /** Wildlife appeared near tile (x, y). */
  'incident:wildlife': { x: number; y: number; kind: string; /** 'bear' | 'wolf'. */ animal?: string; guestId?: number; outcome?: 'sighting' | 'attack' | 'deterred' };
  /** A bear roamed near guests and scared them (aggregated: one per bear per few days). `tile` = y*size+x of the bear. */
  'wildlife:scare': { animal: string; id: number; x: number; y: number; tile: number; guests: number; areaName: string };
  /** Rangers hazed (non-lethal deterrent) a bear away from guests. */
  'wildlife:hazed': { animal: string; id: number; x: number; y: number; station: number };
  /** Rangers tranquilised a bear and moved it deep into the wilderness. */
  'wildlife:relocated': { animal: string; id: number; x: number; y: number; toX: number; toY: number; station: number; cost: number };
  /** A night's grooming finished: vehicles that drove and tiles groomed. */
  'ops:grooming': { vehicles: number; tiles: number };
  /** A guest was injured. */
  'incident:injury': { guestId: number; x: number; y: number };
  /** An incident entered the queue (kind injury|buried|attack|stranded; severity 0 minor, 1 major, 2 critical). */
  'incident:created': { id: number; kind: string; severity: number; x: number; y: number; guestId: number };
  /** An incident was resolved (outcome recovered|hospitalised|evacuated|left; `severe` = resolved late; responder patrol|firstAid|heli|none). */
  'incident:resolved': { id: number; responder: string; responseTicks: number; outcome: string; kind?: string; severe?: boolean };
  /** An incident was escalated to the helicopter. */
  'incident:escalated': { id: number; to: 'heli' };
  /** Finances are near bankruptcy. */
  'finance:bankruptcyWarning': { money: number; daysLeft: number };
  /** The bank forecloses (declared by the player or the automatic limit): the game ends. Kept as the dialog trigger. */
  'finance:bankrupt': { money: number; day: number };
  /** Cash is negative ('in debt'); level 1 = fresh, 2 = lingering (>=7 days), 3 = deep (>=15 days). Emitted on escalation + every 15 days (180-day year). */
  'finance:debtWarning': { money: number; negDays: number; level: 1 | 2 | 3 };
  /** The player declared bankruptcy (or the auto limit hit). */
  'finance:declaredBankrupt': { money: number; day: number; reason: 'declared' | 'auto' };
  /** A lift broke down (stranded = guests on the cable). */
  'lift:broken': { id: number; kind: string; stranded: number };
  /** A lift was repaired after `hours` hours of downtime. */
  'lift:repaired': { id: number; hours: number };
  /** Planned service: announced the day before the window opens (`count` lifts, real month index 0 = January, typical `days` of closure). */
  'ops:serviceSoon': { count: number; month: number; days: number };
  /** A planned service started (the lift is closed and empty; `cost` booked as maintenance). */
  'lift:serviceStarted': { id: number; days: number; cost: number };
  /** A planned service finished: condition restored to `condition`. */
  'lift:serviced': { id: number; days: number; condition: number };
  /** A lift went past its service interval: 'overdue' (risk rising) or 'critical' (long overdue). */
  'lift:serviceOverdue': { id: number; level: 'overdue' | 'critical'; days: number };
  /** Guests are stuck on a broken lift. Emitted once per breakdown. */
  'incident:stranded': { liftId: number; guests: number; x: number; y: number };
  /** The season's lift schedule applied: operating lifts out of total. */
  'ops:schedule': { profile: 'winter' | 'shoulder' | 'summer'; operating: number; total: number };
  /** A month was closed into a report. */
  'finance:monthClosed': { year: number; month: number; net: number; income: number; expense: number };
  /** The resort rating changed. */
  'rating:changed': { stars: number; previous: number; reason: string; /** 0..100 */ score?: number };
  /** A new in-game day began (day is 0-based day of year). */
  'day:changed': { year: number; day: number };
  /** A new in-game month began (0..11). */
  'month:changed': { year: number; month: number };
  /** A new in-game year began. */
  'year:changed': { year: number };
  /** A year closed and its Resort of the Year report was stored (`year` = the year that ended). */
  'year:report': { year: number };
  /** The in-game hour changed (0..23). */
  'time:hour': { hour: number };
  /** Parents dropped their kids at a venue (ski school / kids ground / playground / childcare). */
  'family:dropoff': { group: number; venueId: number; venue: string; kids: number; parents: number };
  /** Family reunited (lunch / after lessons / venue closed / pick-up before leaving). */
  'family:regroup': { group: number; reason: 'lunch' | 'lessonEnd' | 'venueClosed' | 'timeout' | 'leaving' | 'unhappy'; venueId: number };
  /** A ski-school lesson started / finished (kids = guest ids). */
  'lesson:started': { schoolId: number; kids: number[]; instructors: number };
  'lesson:finished': { schoolId: number; kids: number[]; fee: number };
  /** A marketing campaign started (cost paid upfront). */
  'marketing:started': { id: string; name: string; cost: number; days: number; effectiveness: number };
  /** A campaign ended; uplift = arrivals during the run minus the baseline (null when no baseline was known). */
  'marketing:ended': { id: string; name: string; arrivals: number; uplift: number | null; upliftPct: number | null };
  /** A running campaign was cancelled because a hard prerequisite disappeared (no refund). */
  'marketing:cancelled': { id: string; name: string; reason: string };
  /**
   * A goal/progress milestone was reached (emitted by the goals system). `major` = chapter completion, star-up or level-up: only those
   * get a short quiet chime + a confetti burst (and an important news row); minor ones are a quiet info row and no effects.
   */
  'milestone': { id: string; title: string; major: boolean };
  /** A scenario objective was met for the first time (scenarios only). */
  'scenario:objective': { id: string; title: string; met: boolean };
  /** The scenario ended (scenarios only). `medal` is 'none' on a loss. */
  'scenario:finished': { id: string; result: 'won' | 'lost'; medal: 'none' | 'bronze' | 'silver' | 'gold'; score: number; reason: string };
}

export type GameBus = EventBus<GameEvents>;
export type GameEventName = keyof GameEvents;

/** Every event name (used by the debug event log). `satisfies` + the check below keep it exhaustive. */
export const GAME_EVENT_NAMES = [
  'guest:arrived', 'guest:left', 'guest:review', 'building:placed', 'building:removed', 'path:drawn', 'piste:painted', 'lift:built', 'lift:opened',
  'piste:opened', 'backcountry:opened', 'backcountry:closed', 'money:changed', 'loan:taken', 'speed:changed', 'season:changed', 'incident:avalanche', 'incident:wildlife', 'wildlife:scare', 'wildlife:hazed', 'wildlife:relocated',
  'incident:injury', 'incident:created', 'incident:resolved', 'incident:escalated', 'finance:bankruptcyWarning', 'finance:bankrupt', 'finance:debtWarning', 'finance:declaredBankrupt', 'lift:broken', 'lift:repaired', 'ops:serviceSoon', 'lift:serviceStarted', 'lift:serviced', 'lift:serviceOverdue', 'incident:stranded', 'ops:schedule', 'finance:monthClosed', 'rating:changed', 'day:changed', 'month:changed', 'year:changed', 'year:report', 'time:hour', 'lift:closed', 'weather:changed', 'attraction:opened', 'attraction:closed',
  'ops:grooming', 'family:dropoff', 'family:regroup', 'lesson:started', 'lesson:finished', 'marketing:started', 'marketing:ended', 'marketing:cancelled', 'milestone', 'scenario:objective', 'scenario:finished', 'story:resolved',
] as const satisfies readonly GameEventName[];

type Missing = Exclude<GameEventName, (typeof GAME_EVENT_NAMES)[number]>;
/** Compile-time exhaustiveness: errors if an event is added to GameEvents but not to GAME_EVENT_NAMES. */
export const EVENT_NAMES_EXHAUSTIVE: [Missing] extends [never] ? true : never = true;
