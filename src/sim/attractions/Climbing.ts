import type { AttractionSpec } from './Attraction';

/**
 * Climbing Crag (Phase 6 Task 23, docs/climbing.md): a 2x2 base hut at the foot of a natural rock face (SiteRule.nearRock). Eight climbers at a time, a
 * $30 ticket, summer only (`seasonOpen` + the catalog `snowFree` need). The instructor is OPTIONAL: without one the crag runs at half capacity and the
 * mishap chance is higher. A rare twisted ankle ("mishap") is a MINOR incident that the Ski Patrol answers; nothing here can seriously hurt anyone.
 */
export const CLIMB = {
  /** Mishap chance per finished climb: with an instructor on duty / without. */
  guided: 0.004, unguided: 0.012,
  /** Capacity share without any instructor (the staff factor runs 0.5 .. 1). */
  unguidedShare: 0.5,
  /** Ticks per climb (10 ticks = 1 hour). */
  serviceTicks: 6,
} as const;

export const CLIMBING_SPECS: Record<string, AttractionSpec> = {
  crag: {
    kind: 'climbing', serviceTicks: CLIMB.serviceTicks, slots: 8, effects: { fatigue: 0.12, happiness: 0.2 },
    // [solo, couple, family, vip, budget, adventure]: adventure seekers and soloists love it, families and VIPs hardly
    appeal: [0.8, 0.45, 0.12, 0.15, 0.3, 1], seasonOpen: ['summer'], optionalStaff: true, mishap: { guided: CLIMB.guided, unguided: CLIMB.unguided },
  },
};

/** Stateless 0..1 roll for one finished climb (no Rng stream is drawn, nothing is saved): the same crag, climber and tick always roll the same. */
export function mishapRoll(buildingId: number, guestId: number, tick: number): number {
  let h = Math.imul(buildingId ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(guestId + 0x7f4a7c15, 0xc2b2ae35) ^ Math.imul(tick + 0x165667b1, 0x27d4eb2f);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
