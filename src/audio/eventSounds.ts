import { GAME_EVENT_NAMES, type GameEventName, type GameEvents } from '../core/events';
import type { PlayOpts, SfxName } from './Sfx';

export interface SoundCue { sfx: SfxName; opts?: PlayOpts }

/** Events that intentionally make no sound (high-frequency, covered by the news feed chimes, or purely informational). */
export const IGNORED_EVENTS = [
  'guest:arrived', 'guest:left', 'guest:review', 'lift:closed', 'attraction:opened', 'attraction:closed', 'weather:changed', 'piste:opened', 'backcountry:opened', 'backcountry:closed',
  'ops:grooming', 'ops:schedule', 'ops:serviceSoon', 'lift:serviceStarted', 'lift:serviced', 'lift:serviceOverdue', 'incident:injury', 'incident:wildlife', 'wildlife:scare', 'wildlife:hazed', 'wildlife:relocated', 'incident:stranded', 'finance:monthClosed',
  'day:changed', 'month:changed', 'year:changed', 'year:report', 'time:hour', 'family:dropoff', 'family:regroup', 'lesson:started', 'lesson:finished',
  'incident:resolved', 'finance:bankrupt', 'marketing:started', 'marketing:ended', 'marketing:cancelled', 'scenario:objective', 'story:resolved',
  // money:changed: the ka-ching is tied to the significant +$ popups (FX layer, throttled to 1 per 3 s), not to every sale.
  'money:changed',
] as const satisfies readonly GameEventName[];

type Ev<K extends GameEventName> = GameEvents[K];
type Mapper<K extends GameEventName> = (p: Ev<K>) => SoundCue[];

/** One mapper per event that sounds. Pure: payload -> cues. Exhaustiveness vs GAME_EVENT_NAMES is unit-tested. */
export const EVENT_SOUNDS: { [K in Exclude<GameEventName, (typeof IGNORED_EVENTS)[number]>]: Mapper<K> } = {
  // Soft thunk: a quiet confirmation, not a bang.
  'building:placed': () => [{ sfx: 'thud', opts: { gain: 0.45, pitch: 1.1 } }],
  // Major milestones only: one short quiet chime (shares the 'alert' limiter group with the news chime, so they never stack), no fanfare.
  'milestone': (p) => (p.major ? [{ sfx: 'chimeImportant', opts: { gain: 0.55 } }] : []),
  // Scenario won: the same one quiet chime (a lost scenario is silent).
  'scenario:finished': (p) => (p.result === 'won' ? [{ sfx: 'chimeImportant', opts: { gain: 0.55 } }] : []),
  'building:removed': () => [{ sfx: 'crunch' }],
  'path:drawn': (p) => [p.erase ? { sfx: 'scrape', opts: { gain: 0.6, pitch: 1.3 } } : { sfx: 'tick', opts: { pitch: 0.9 } }],
  'piste:painted': (p) => [p.erase ? { sfx: 'scrape', opts: { gain: 0.6 } } : { sfx: 'tick', opts: { pitch: 1.15 } }],
  'lift:built': () => [{ sfx: 'thud' }, { sfx: 'clank', opts: { delay: 0.12 } }],
  'lift:opened': (p) => (p.open ? [{ sfx: 'clank' }, { sfx: 'bell', opts: { delay: 0.15 } }] : [{ sfx: 'clank', opts: { pitch: 0.75 } }]),
  'lift:broken': () => [{ sfx: 'grind' }, { sfx: 'alarm', opts: { delay: 0.5 } }],
  'lift:repaired': () => [{ sfx: 'bell', opts: { pitch: 1.5 } }],
  'incident:avalanche': (p) => [{ sfx: 'avalanche', opts: { gain: p.controlled ? 0.5 : Math.min(1, 0.6 + p.severity * 0.2) } }],
  'incident:created': (p) => (p.severity >= 2 ? [{ sfx: 'chimeCritical' }] : p.severity === 1 ? [{ sfx: 'chimeImportant' }] : []),
  'incident:escalated': () => [{ sfx: 'rescue' }],
  'finance:bankruptcyWarning': () => [{ sfx: 'bankruptcy' }],
  'finance:debtWarning': (p) => [{ sfx: p.level >= 2 ? 'bankruptcy' : 'chimeImportant' }],
  'finance:declaredBankrupt': () => [{ sfx: 'bankruptcy' }],
  'rating:changed': (p) => (p.stars > p.previous ? [{ sfx: 'ratingUp' }] : p.stars < p.previous ? [{ sfx: 'ratingDown' }] : []),
  'loan:taken': () => [{ sfx: 'kaching', opts: { gain: 0.8 } }],
  'speed:changed': (p) => [{ sfx: 'blip', opts: { pitch: 0.85 + p.speed * 0.15 } }],
  'season:changed': () => [{ sfx: 'season' }],
};

export function soundsForEvent<K extends GameEventName>(name: K, payload: GameEvents[K]): SoundCue[] {
  const m = (EVENT_SOUNDS as Record<string, ((p: unknown) => SoundCue[]) | undefined>)[name];
  return m ? m(payload) : [];
}

export const MAPPED_EVENTS = (Object.keys(EVENT_SOUNDS)) as GameEventName[];
export const ALL_EVENTS_COVERED = GAME_EVENT_NAMES.every((n) => (MAPPED_EVENTS as string[]).includes(n) || (IGNORED_EVENTS as readonly string[]).includes(n));

/** News feed output -> chime. Only the critical / important tiers sound; the shared 'alert' limiter group dedups against event sounds. */
export function cueForNews(it: { tier: string }): SoundCue | null {
  if (it.tier === 'critical') return { sfx: 'chimeCritical' };
  if (it.tier === 'important') return { sfx: 'chimeImportant' };
  return null;
}
