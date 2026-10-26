import type { GameBus } from '../core/events';

/** Result of the last closed month (dollars). */
export interface LastMonth { year: number; month: number; net: number; income: number; expense: number; guests: number; /** Stars change over the month; absent for the first closed month of a game (no earlier reference). */ ratingDelta?: number }
export interface SessionMetaData {
  /** Cash and stars at the moment the running month began (= when the previous month closed). */
  monthStartMoney: number; monthStartStars: number;
  last: LastMonth | null;
}

/**
 * Small additive record for the "Welcome back" recap (M5.1): what the last month looked like and the cash / rating at its start.
 * Saved as the `sessionMeta` module; saves without it load as `null` (reduced recap). Read-only for the sim: it only listens to
 * `finance:monthClosed`, so it never changes simulation state or the determinism of a run.
 */
export class SessionMeta {
  private data: SessionMetaData | null = null;
  constructor(bus: GameBus, private d: { money: () => number; stars: () => number; guests?: () => number }) {
    bus.on('finance:monthClosed', (e) => {
      const stars = d.stars(), prev = this.data?.monthStartStars;
      this.data = {
        monthStartMoney: d.money(), monthStartStars: stars,
        last: { year: e.year, month: e.month, net: e.net, income: e.income, expense: e.expense, guests: d.guests?.() ?? 0, ...(prev === undefined ? {} : { ratingDelta: stars - prev }) },
      };
    });
  }
  get(): Readonly<SessionMetaData> | null { return this.data; }
  serialize(): SessionMetaData | null { return this.data ? { ...this.data, last: this.data.last ? { ...this.data.last } : null } : null; }
  load(d: unknown): void {
    const o = d as Partial<SessionMetaData> | null;
    this.data = o && typeof o.monthStartMoney === 'number' && typeof o.monthStartStars === 'number'
      ? { monthStartMoney: o.monthStartMoney, monthStartStars: o.monthStartStars, last: o.last ?? null } : null;
  }
  reset(): void { this.data = null; }
}
