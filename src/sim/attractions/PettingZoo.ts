import type { AttractionSpec } from './Attraction';

/**
 * Petting zoo (Phase 6 Task 20, docs/petting-zoo.md): a standalone 3x3 summer family attraction on a footpath (no farm needed).
 * Entry ticket $8 (`PRICE_TABLE.pettingZoo`), 20 places, one keeper. The catalog `snowFree` need closes it under snow, `seasonOpen` keeps it a summer attraction.
 */
export const PETTING_ZOO_SPECS: Record<string, AttractionSpec> = {
  pettingZoo: { kind: 'zoo', serviceTicks: 6, slots: 20, effects: { happiness: 0.12 }, appeal: [0.3, 0.55, 0.8, 0.3, 0.4, 0.1], seasonOpen: ['summer'] },
};

/**
 * Feeding (docs/petting-zoo.md): at the gate a visitor may buy a scoop of feed for $2 (shops income). Family and school guests (the kids) nearly always do (`kidShare`), everybody else rarely
 * (`otherShare`). A fed visit adds `happiness`; while guests are inside, the animals walk to the front fence (render only). Stateless hash roll per guest: no Rng draw, no save field besides the counter.
 */
export const ZOO_FEED = { price: 2, happiness: 0.05, kidShare: 0.7, otherShare: 0.15, kidTypes: [2, 9] as readonly number[] } as const;
export function buysFeed(guestId: number, guestType: number): boolean {
  const share = ZOO_FEED.kidTypes.includes(guestType) ? ZOO_FEED.kidShare : ZOO_FEED.otherShare;
  return (Math.imul(guestId + 211, 2246822519) >>> 0) % 1000 < share * 1000;
}
/** How many animals come to the fence for `users` guests inside (render only): one more per guest, at most 6 of the 8. */
export const fenceCrowd = (users: number): number => Math.min(6, Math.max(0, users));
/** Where animal `i` stands at the fence (building-local, facing out to the guests at +z). Spread along the front rail. */
export function fenceSpot(i: number): { x: number; z: number; yaw: number } { return { x: -0.9 + (i % 6) * 0.36, z: ZOO_PEN.z1, yaw: 0 }; }

/** The pen's residents (display only; the sim never reads them). 8 animals: goats, sheep, rabbits and a donkey. */
export type ZooKind = 'goat' | 'sheep' | 'rabbit' | 'donkey';
export const ZOO_ANIMALS: readonly ZooKind[] = ['goat', 'goat', 'sheep', 'sheep', 'rabbit', 'rabbit', 'rabbit', 'donkey'];

/** Walkable area inside the pen, building-local tiles from the footprint centre (the 3x3 footprint spans +-1.5; the fence stands at +-1.35, the shed at the back). */
export const ZOO_PEN = { x0: -1.05, x1: 1.05, z0: -0.35, z1: 1.1 } as const;
/** Animals open the day at 07:00 and sleep in the shed from 20:00. */
export const ZOO_HOURS = { from: 7, to: 20 } as const;

export interface ZooPose { x: number; z: number; /** Heading (radians, 0 = +z, like the nature meshes). */ yaw: number; /** 0..1 walk amount (0 = standing / grazing). */ moving: number }

const hash = (a: number, b: number, c: number): number => {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35) ^ Math.imul(c + 0x165667b1, 0x27d4eb2f);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
};
const waypoint = (seed: number, i: number, k: number): { x: number; z: number } => ({
  x: ZOO_PEN.x0 + hash(seed, i * 2 + 1, k) * (ZOO_PEN.x1 - ZOO_PEN.x0),
  z: ZOO_PEN.z0 + hash(seed, i * 2 + 2, k) * (ZOO_PEN.z1 - ZOO_PEN.z0),
});

/**
 * Pure, deterministic pose of animal `i` of the pen with `seed` (the building id) at time `t` seconds: it walks to a seeded waypoint during the first
 * part of each period (smoothstep, so it eases in and out) and then stands / grazes. No state, no RNG: any frame can be recomputed, always inside `ZOO_PEN`.
 */
export function zooPose(seed: number, i: number, t: number): ZooPose {
  const period = 7 + hash(seed, i, 99) * 6, k = Math.floor(t / period + hash(seed, i, 98) * 40), u = t / period + hash(seed, i, 98) * 40 - k;
  const a = waypoint(seed, i, k), b = waypoint(seed, i, k + 1);
  const walk = 0.5, f = Math.min(1, u / walk), e = f * f * (3 - 2 * f);
  const x = a.x + (b.x - a.x) * e, z = a.z + (b.z - a.z) * e;
  const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
  return { x, z, yaw: d > 1e-6 ? Math.atan2(dx, dz) : 0, moving: u < walk && d > 0.05 ? Math.sin(Math.PI * f) : 0 };
}
