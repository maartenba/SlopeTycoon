import type { FeedbackPolicy } from './feedbackPolicy';

/** Emote glyphs (index = atlas cell). */
export const EMOTES = ['hungry', 'cold', 'tired', 'happy', 'angry', 'scared', 'wildlife'] as const;
export type EmoteKind = (typeof EMOTES)[number];

/** Strong-crossing thresholds. Deliberately high: an emote must be a rare, readable moment. */
export const EMOTE_T = {
  /** Queue wait in queue-minutes (~ p90 of waits in the starter-resort bot runs; 4 ticks = 1 min). */
  queueMin: 12,
  /** 0..1 coldness (see `coldness`). */
  cold: 0.75,
  hunger: 0.85,
  fatigue: 0.85,
  /** Happiness needed after a completed run to count as delight. */
  delight: 0.85,
  /** Wildlife: a bear is 'seen' within 7 tiles, a deer within 3.5 (a closer deer would already flee: `fleeOffset` 6). */
  bearRange: 7,
  deerRange: 3.5,
  /** Chance a first sighting shows the paw, and the minimum sim ticks between two paws anywhere (~ one a day at most per 4 ticks/min). */
  wildlifeChance: 0.35,
  wildlifeGapTicks: 160,
} as const;

/** Pure gate for the wildlife paw: rare (chance) and quiet (global cooldown in sim ticks). */
export function wildlifeAllowed(tick: number, lastTick: number, roll: number): boolean {
  return tick - lastTick >= EMOTE_T.wildlifeGapTicks && roll < EMOTE_T.wildlifeChance;
}

/** What the picker looks at: a plain snapshot of one guest (read from the sim, never written back). */
export interface EmoteNeeds {
  day: number;
  hunger: number; fatigue: number; happiness: number;
  /** Minutes in the current lift queue (0 = not queueing). */
  queueMin: number;
  /** 0..1, see `coldness`. */
  cold: number;
  /** A run was completed since the previous snapshot. */
  runDone: boolean;
  /** First sight of wildlife (a bear / deer came close). */
  sighting: boolean;
  /** A bear / deer is within sight range (edge-triggered like everything else; see `wildlifeAllowed`). */
  wildlife?: boolean;
}
export interface EmoteMemo { day: number; count: number }

/** Air temperature -> 0..1 coldness: 0 at -4 °C or warmer, 1 at -14 °C or colder. */
export const coldness = (tempC: number): number => Math.min(1, Math.max(0, (-4 - tempC) / 10));

/**
 * Which emote (if any) should this guest show now? Fires only when a need crosses a strong threshold between `prev` and `needs`
 * (edge, not level), at most `policy.emotePerGuestPerDay` times per in-game day. Priority: scared > angry > cold > hungry > tired > happy > wildlife.
 */
export function pickEmote(needs: EmoteNeeds, prev: EmoteNeeds, last: EmoteMemo, policy: FeedbackPolicy): EmoteKind | null {
  if (policy.maxEmotes <= 0 || policy.emotePerGuestPerDay <= 0) return null;
  if (last.day === needs.day && last.count >= policy.emotePerGuestPerDay) return null;
  if (needs.sighting && !prev.sighting) return 'scared';
  if (needs.queueMin >= EMOTE_T.queueMin && prev.queueMin < EMOTE_T.queueMin) return 'angry';
  if (needs.cold >= EMOTE_T.cold && prev.cold < EMOTE_T.cold) return 'cold';
  if (needs.hunger >= EMOTE_T.hunger && prev.hunger < EMOTE_T.hunger) return 'hungry';
  if (needs.fatigue >= EMOTE_T.fatigue && prev.fatigue < EMOTE_T.fatigue) return 'tired';
  if (needs.runDone && needs.happiness >= EMOTE_T.delight) return 'happy';
  if (needs.wildlife && !prev.wildlife) return 'wildlife';
  return null;
}

export interface EmoteCandidate { slot: number; x: number; z: number; kind: EmoteKind }
/** Spatial cell key (queue clusters share a cell). */
export const clusterKey = (x: number, z: number, cell: number): number => (Math.floor(x / cell) + 4096) * 8192 + (Math.floor(z / cell) + 4096);
/**
 * One representative emote per cluster cell: the first candidate of a cell wins; cells already holding a live emote (`busy`) get none.
 * At most `room` are returned.
 */
export function clusterRepresentatives(cands: readonly EmoteCandidate[], cell: number, busy: ReadonlySet<number>, room: number): EmoteCandidate[] {
  const out: EmoteCandidate[] = [], seen = new Set<number>(busy);
  for (const c of cands) {
    if (out.length >= room) break;
    const k = clusterKey(c.x, c.z, cell);
    if (seen.has(k)) continue;
    seen.add(k); out.push(c);
  }
  return out;
}
