import type { FeedbackPolicy } from './feedbackPolicy';

export interface Popup { key: number; amount: number; x: number; y: number; z: number }
interface Bin { amount: number; start: number; x: number; y: number; z: number }

/**
 * Sums income per source (building) over a window; a bin becomes a popup only when its sum is significant:
 * >= max(policy.moneyMin, policy.moneyRel x rolling daily-revenue average). Time is passed in (seconds), so it is pure and testable.
 */
export class MoneyAggregator {
  private bins = new Map<number, Bin>();
  private days: number[] = [];
  private today = 0;
  constructor(private readonly keepDays = 7) {}

  /** Rolling average of the completed days' revenue (0 before the first day closes: then only `moneyMin` applies). */
  get dailyAverage(): number { return this.days.length ? this.days.reduce((a, b) => a + b, 0) / this.days.length : 0; }
  /** Call when a game day ends. */
  rollDay(): void { this.days.push(this.today); if (this.days.length > this.keepDays) this.days.shift(); this.today = 0; }
  threshold(p: FeedbackPolicy): number { return Math.max(p.moneyMin, p.moneyRel * this.dailyAverage); }

  /** Record income (dollars > 0) of source `key` at world (x, z). */
  add(key: number, amount: number, x: number, z: number, now: number, y = 0): void {
    if (!(amount > 0)) return;
    this.today += amount;
    const b = this.bins.get(key);
    if (b) { b.amount += amount; b.x = x; b.y = y; b.z = z; } else this.bins.set(key, { amount, start: now, x, y, z });
  }
  /** Income without a location: counts towards the daily average only (no popup). */
  noteIncome(amount: number): void { if (amount > 0) this.today += amount; }

  /** Close bins whose window elapsed; returns the significant ones (at most `room`, largest first). Insignificant bins are dropped. */
  flush(now: number, p: FeedbackPolicy, room: number): Popup[] {
    const out: Popup[] = [];
    const th = this.threshold(p);
    for (const [key, b] of this.bins) {
      if (now - b.start < p.aggregateS) continue;
      this.bins.delete(key);
      if (p.maxPopups > 0 && b.amount >= th) out.push({ key, amount: b.amount, x: b.x, y: b.y, z: b.z });
    }
    out.sort((a, b) => b.amount - a.amount);
    return out.slice(0, Math.max(0, room));
  }
  clear(): void { this.bins.clear(); }
  get pending(): number { return this.bins.size; }
}
