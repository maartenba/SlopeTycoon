import type { PlayOpts } from './Sfx';

/**
 * When the rare visitor's call is heard (pure scheduling around `Sfx.play('distantCall')`; render / main.ts feed it the camera facts).
 * The first version played one quiet far-off call at the sighting event and only on the ambience bus: it was inaudible and, when the
 * player looked elsewhere (or the audio had not been unlocked yet), simply missed. Now:
 *  (a) the sighting: a quiet GLOBAL call, panned by where the visitor is relative to the screen, so it is heard from anywhere; if the engine
 *      is not running yet (locked until the first click) it stays pending and plays the moment audio runs while the visit is on;
 *  (b) a SPATIAL call once the camera comes within `spatialR` tiles (louder when closer);
 *  (c) 'Show me': the call again.
 * (a) and (b) share a 60 s rate limit; (c) is only held back a few seconds so a double click does not stack it.
 */
export const CALL = { minGapSec: 60, spatialR: 25, globalGain: 0.7, spatialNear: 1, spatialFar: 0.45, showMeGain: 0.9, showMeGapSec: 6, maxPan: 0.85, startDelaySec: 0.6 } as const;

export type CallKind = 'global' | 'spatial' | 'showMe';

export class VisitorCalls {
  private lastAuto = -Infinity; private lastAny = -Infinity;
  private pending = false; private spatialDone = false;
  /** Count of calls actually started, per kind (tests / debug). */
  readonly played: Record<CallKind, number> = { global: 0, spatial: 0, showMe: 0 };
  constructor(private play: (o: PlayOpts) => boolean, private now: () => number) {}

  /** A sighting began: the visitor can be heard from anywhere. */
  sighting(pan: number): void { this.pending = true; this.spatialDone = false; this.tryGlobal(pan); }
  private tryGlobal(pan: number): void {
    const t = this.now();
    if (t - this.lastAuto < CALL.minGapSec) { this.pending = false; return; } // inside the rate limit: skipped (the spatial / 'Show me' call can still come)
    if (this.play({ gain: CALL.globalGain, pan: clampPan(pan), delay: CALL.startDelaySec, noSample: true })) { this.lastAuto = this.lastAny = t; this.pending = false; this.played.global++; }
  }
  /** Every frame (cheap) while a visit may be on. `dist` = tiles from the camera target to the visitor; `pan` as in `sighting`. */
  frame(active: boolean, dist: number, pan: number): void {
    if (!active) { this.pending = false; return; }
    if (this.pending) this.tryGlobal(pan);
    if (this.spatialDone || dist > CALL.spatialR || this.pending) return;
    const t = this.now();
    if (t - this.lastAuto < CALL.minGapSec) return; // wait: tried again each frame once the limit has passed, while it stays near
    const k = Math.max(0, Math.min(1, dist / CALL.spatialR)), gain = CALL.spatialNear + (CALL.spatialFar - CALL.spatialNear) * k;
    if (this.play({ gain, pan: clampPan(pan), noSample: true })) { this.lastAuto = this.lastAny = t; this.spatialDone = true; this.played.spatial++; }
  }
  /** 'Show me' pressed. */
  showMe(pan: number): void {
    const t = this.now();
    if (t - this.lastAny < CALL.showMeGapSec) return;
    if (this.play({ gain: CALL.showMeGain, pan: clampPan(pan), noSample: true })) { this.lastAny = t; this.played.showMe++; }
  }
}
const clampPan = (p: number): number => Math.max(-CALL.maxPan, Math.min(CALL.maxPan, p));
