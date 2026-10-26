import { chaseK } from './chase';
import type { Grooming } from '@/sim/ops/Grooming';
import { SnowcatFleet } from './meshes/Snowcat';

/** Animates the snowcat fleet from sim state (positions smoothed per frame; visual only). NOT verified at runtime (no WebGL). */
export class GroomingView {
  readonly fleet = new SnowcatFleet();
  get group() { return this.fleet.group; }
  private sm: Array<{ x: number; y: number; yaw: number }> = [];

  constructor(private grooming: Grooming, private groundAt: (x: number, y: number) => number, private isNight: () => boolean) {}

  update(dt = 1 / 60, ticksPerSecond = 10): void {
    const kc = chaseK(dt, ticksPerSecond);
    const cats = this.grooming.cats;
    for (let i = 0; i < cats.length; i++) {
      const c = cats[i]!;
      let s = this.sm[i];
      if (!s) s = this.sm[i] = { x: c.x, y: c.y, yaw: 0 };
      const dx = c.x - s.x, dy = c.y - s.y;
      if (dx * dx + dy * dy > 16) { s.x = c.x; s.y = c.y; } // teleport after replan / load
      else {
        if (dx * dx + dy * dy > 1e-4) { const target = Math.atan2(dx, dy); let d = target - s.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); s.yaw += d * Math.max(0.3, kc); }
        s.x += dx * kc; s.y += dy * kc;
      }
      this.fleet.set(i, s.x, this.groundAt(s.x, s.y) + 0.03, s.y, s.yaw);
    }
    this.sm.length = Math.min(this.sm.length, cats.length);
    this.fleet.commit(cats.length, this.isNight());
  }

  dispose(): void { this.fleet.dispose(); }
}
