/** Trail usage counters (hiking and MTB trails are painted layers, not buildings). */
export interface TrailCounters { uses: number; revenue: number; lastDay: number; today: number }

export class TrailUsage {
  hiking: TrailCounters = { uses: 0, revenue: 0, lastDay: -1, today: 0 };
  mtb: TrailCounters = { uses: 0, revenue: 0, lastDay: -1, today: 0 };

  record(kind: 'hike' | 'bike', fee: number, absDay: number): void {
    const c = kind === 'hike' ? this.hiking : this.mtb;
    if (c.lastDay !== absDay) { c.lastDay = absDay; c.today = 0; }
    c.uses++; c.today++; c.revenue += fee;
  }
  serialize(): { hiking: TrailCounters; mtb: TrailCounters } { return { hiking: { ...this.hiking }, mtb: { ...this.mtb } }; }
  load(d: { hiking: TrailCounters; mtb: TrailCounters }): void { this.hiking = { ...d.hiking }; this.mtb = { ...d.mtb }; }
}
