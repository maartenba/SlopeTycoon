import { PHOTO } from '../../config/photographers';
import type { GameBus } from '../../core/events';

export interface PhotoBuzzSave { level: number; day: number; sessions: number; golden: boolean; seen: boolean }

/**
 * Photo buzz (docs/photographers.md): satisfied photographers talk. Every session adds `perSession x light` to a small decaying arrival bonus (capped at `PHOTO.maxBuzz`, decays by
 * `decayPerDay` a day). Also the first-time news ("Photographers have arrived for the light") and the Golden Hour count (20 sessions on one special-sky day).
 * Observer state: saved (omitted while pristine, so a world without a photographer saves and hashes exactly as before), never part of `stateHash`.
 */
export class PhotoBuzz {
  level = 0;
  private day = -1; private sessions = 0; private golden = false; private seen = false;
  constructor(private bus: Pick<GameBus, 'emit'>) {}

  /** Arrival multiplier (>= 1). */
  mult(): number { return 1 + this.level; }
  session(info: { q: number; day: number }): void {
    this.roll(info.day);
    this.level = Math.min(PHOTO.maxBuzz, this.level + PHOTO.perSession * info.q);
    if (!this.seen) { this.seen = true; this.bus.emit('milestone', { id: 'photo.first', title: 'Photographers have arrived for the light', major: false }); }
    if (info.q >= PHOTO.goldenLight) {
      this.sessions++;
      if (!this.golden && this.sessions >= PHOTO.goldenCount) { this.golden = true; this.bus.emit('photo:golden', { day: info.day }); }
    }
  }
  /** A new sim day: the buzz fades. */
  newDay(day: number): void { this.roll(day); }
  private roll(day: number): void {
    if (day === this.day) return;
    const gap = this.day < 0 ? 1 : Math.max(1, day - this.day);
    this.level *= Math.pow(PHOTO.decayPerDay, gap);
    if (this.level < 1e-5) this.level = 0;
    this.day = day; this.sessions = 0; this.golden = false;
  }
  serialize(): PhotoBuzzSave | null { return this.seen ? { level: this.level, day: this.day, sessions: this.sessions, golden: this.golden, seen: true } : null; }
  load(d: unknown): void {
    const s = (d ?? {}) as Partial<PhotoBuzzSave>;
    this.level = Number.isFinite(s.level) ? Math.min(PHOTO.maxBuzz, Math.max(0, s.level!)) : 0;
    this.day = Number.isFinite(s.day) ? s.day! : -1; this.sessions = Number.isFinite(s.sessions) ? s.sessions! : 0; this.golden = !!s.golden; this.seen = !!s.seen;
  }
  reset(): void { this.load(null); }
}
