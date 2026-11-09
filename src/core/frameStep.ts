/**
 * Frame-step virtual clock (QA / promo capture only, `__slope.frameStep`, docs/promo-video.md).
 * While stepping, the page owns ONE clock: every `performance.now()` read (water, tree cross-fades, UI cadences) returns the virtual time, and the
 * renderer is driven with an exact `dt` per frame, so the same start state + the same dt list gives the same frames (state hash and pixels).
 * Pure: no DOM, no three.js.
 */
export class FrameClock {
  /** Virtual seconds since `begin`. */
  t = 0;
  /** Frames stepped since `begin`. */
  frame = 0;
  /** Virtual `performance.now()` at `begin` (ms), so the clock stays continuous with the real one. */
  baseMs = 0;

  begin(realNowMs: number): void { this.t = 0; this.frame = 0; this.baseMs = realNowMs; }
  /** Advance one frame of exactly `dt` seconds. */
  step(dt: number): void { this.t += dt; this.frame++; }
  /** Virtual `performance.now()` in ms. */
  nowMs(): number { return this.baseMs + this.t * 1000; }
}

/** Replace `target.now` with the virtual clock; returns the restore function (idempotent). */
export function installVirtualNow(clock: FrameClock, target: { now: () => number }): () => void {
  const real = target.now;
  target.now = (): number => clock.nowMs();
  let done = false;
  return (): void => { if (done) return; done = true; target.now = real; };
}
