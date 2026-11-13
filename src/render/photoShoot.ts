/**
 * Photographer shooting pose + flash timing (docs/photographers.md "Camera and flash"). RENDER ONLY: started by the `photo:taken` event (the same moment as the
 * shutter click), never read by the simulation and never part of `stateHash`. All times are in RENDER seconds (the guest renderer's own clock, which only advances
 * while the sim clock does), so there is no `Math.random` and no wall clock. The figure swaps to the raised-camera gear (`Gear.Shoot`) while a session is running and
 * the guest stands still; a short glint (`flashLevel`) is emitted at each shot, only near the camera and never under reduced motion.
 * The maths is pure and unit-tested (tests/render/photoShoot.test.ts).
 */
import { dayHash } from './atmosphere/hash';

export const PHOTO_SHOOT = {
  /** Seconds from the event to the first shot (the arms come up first). */
  raiseS: 0.45,
  /** Seconds between shots (range, per shot hash). */
  gapS: [1.1, 2.3] as readonly [number, number],
  /** Length of one flash (s): a brief glint. */
  flashS: 0.12,
  /** Seconds the camera stays up after the last shot. */
  holdS: 0.7,
  /** Cap on the shots of a session that are shown (the sim may report more). */
  maxShots: 8,
  /** Flash sprite: height above the guest's feet (tiles, scaled by the figure), forward offset (tiles), size (tiles). */
  flashUp: 0.5, flashForward: 0.12, flashSize: 0.34,
  /** The flash only shows when the view is this close (view height in tiles, like `lodHeightFor`), ground cameras always. */
  nearView: 45,
} as const;

/** Offset (s) after the event of shot `k` (0-based) of guest `id`: raise time plus the summed per-shot gaps. */
export function shotTime(id: number, k: number): number {
  let t = PHOTO_SHOOT.raiseS;
  for (let j = 1; j <= k; j++) t += PHOTO_SHOOT.gapS[0] + (PHOTO_SHOOT.gapS[1] - PHOTO_SHOOT.gapS[0]) * dayHash(id, j, 0x5a17);
  return t;
}
/** Shots actually shown for an event that reports `shots`. */
export const shownShots = (shots: number): number => Math.max(1, Math.min(PHOTO_SHOOT.maxShots, Math.floor(shots)));
/** Seconds after the event at which the camera comes down again. */
export const sessionLength = (id: number, shots: number): number => shotTime(id, shownShots(shots) - 1) + PHOTO_SHOOT.holdS;
/** Is the camera up `age` seconds after the event? (Instant swap: the pose set has no in-between.) */
export const posing = (id: number, shots: number, age: number): boolean => age >= 0 && age < sessionLength(id, shots);
/** Brightness 0..1 of the flash at `age` seconds after the event: 1 at the instant of a shot, linear down to 0 over `flashS`. */
export function flashLevel(id: number, shots: number, age: number): number {
  const n = shownShots(shots); let best = 0;
  for (let k = 0; k < n; k++) { const d = age - shotTime(id, k); if (d >= 0 && d < PHOTO_SHOOT.flashS) best = Math.max(best, 1 - d / PHOTO_SHOOT.flashS); }
  return best;
}
/** Index of the first shot at or after `age` (shots 0..n-1; n = all done). Used to fire each flash exactly once. */
export function nextShotAfter(id: number, shots: number, age: number): number {
  const n = shownShots(shots);
  for (let k = 0; k < n; k++) if (shotTime(id, k) >= age) return k;
  return n;
}

interface Session { t0: number; shots: number; next: number }
/** The running sessions of a renderer (guest id -> session). No per-frame allocation once warmed up. */
export class PhotoShoots {
  private readonly map = new Map<number, Session>();
  get size(): number { return this.map.size; }
  start(id: number, clock: number, shots: number): void {
    if (this.map.size > 48) for (const [k, v] of this.map) if (clock - v.t0 > sessionLength(k, v.shots) + 5) this.map.delete(k); // sessions of guests nobody looked at
    this.map.set(id, { t0: clock, shots, next: 0 });
  }
  clear(): void { this.map.clear(); }
  /** Is guest `id` posing at `clock`? Expired sessions are dropped here. */
  isPosing(id: number, clock: number): boolean {
    const s = this.map.get(id);
    if (!s) return false;
    const age = clock - s.t0;
    if (age >= sessionLength(id, s.shots)) { this.map.delete(id); return false; }
    return posing(id, s.shots, age);
  }
  /** Number of shots of guest `id` that became due since the last call (each shot is reported once; a shot already older than `staleS` is skipped, not reported). */
  dueShots(id: number, clock: number, staleS = 0.3): number {
    const s = this.map.get(id);
    if (!s) return 0;
    const age = clock - s.t0, n = shownShots(s.shots);
    let due = 0;
    while (s.next < n && shotTime(id, s.next) <= age) { if (age - shotTime(id, s.next) <= staleS) due++; s.next++; }
    return due;
  }
}
