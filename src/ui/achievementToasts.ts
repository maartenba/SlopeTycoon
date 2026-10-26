/**
 * Quiet unlock announcements (M5.3 Task 16). Pure queue (time injected): at most ONE announcement per `minGapMs` (10 s), nothing while `hold()` is true
 * (the tutorial runs, or a blocking dialog is open): unlocks are recorded silently by the engine and announced later. Tier-3 (rare) achievements also ask
 * for the confetti burst, which the feedback layer still gates by the intensity policy / reduced motion (`confettiAllowed`).
 */
import type { AchievementDef } from '../config/achievements';

export interface AnnouncerDeps {
  show(def: AchievementDef): void;
  /** Rare unlock: the host forwards to the feedback layer, which applies the policy. */
  confetti(def: AchievementDef): void;
  hold(): boolean;
  now(): number;
  minGapMs?: number;
  /** Queue cap: older entries beyond it are dropped from the TOAST queue (the shelf still has them). */
  maxQueue?: number;
}
export const ANNOUNCE_GAP_MS = 10_000;

export class AchievementAnnouncer {
  private queue: AchievementDef[] = [];
  private last = -Infinity;
  shown = 0;
  constructor(private readonly d: AnnouncerDeps) {}
  get pending(): number { return this.queue.length; }
  push(def: AchievementDef): void {
    if (this.queue.some((q) => q.id === def.id)) return;
    this.queue.push(def);
    const cap = this.d.maxQueue ?? 8;
    while (this.queue.length > cap) this.queue.shift();
    this.pump();
  }
  /** Call regularly (every second or so): shows the next one when allowed. Returns the announced def. */
  pump(): AchievementDef | null {
    if (!this.queue.length || this.d.hold()) return null;
    const now = this.d.now();
    if (now - this.last < (this.d.minGapMs ?? ANNOUNCE_GAP_MS)) return null;
    const def = this.queue.shift()!;
    this.last = now; this.shown++;
    this.d.show(def);
    if (def.tier === 3) this.d.confetti(def);
    return def;
  }
}
