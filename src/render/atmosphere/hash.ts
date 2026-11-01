/** Render-side deterministic hash of (seed, dayKey, salt) -> [0, 1). Never touches the sim Rng (so no stateHash change). */
export function dayHash(seed: number, dayKey: number, salt: number): number {
  let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul((dayKey | 0) + 0x7f4a7c15, 0x85ebca6b) ^ Math.imul(salt + 0x165667b1, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d) >>> 0; h ^= h >>> 15; h = Math.imul(h, 0x846ca68b) >>> 0; h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
export const smoothstep = (a: number, b: number, x: number): number => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
/** A (seed, dayKey) key: absolute sim day. */
export const dayKeyOf = (year: number, day: number): number => year * 180 + day;
