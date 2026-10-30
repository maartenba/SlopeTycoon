import { budget } from '../../perfMode';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../src/core/EventBus';
import type { GameEvents } from '../../../src/core/events';
import { emptyBuckets } from '../../../src/sim/Economy';
import { StatsHistory, STATS_DAYS, type StatsSources } from '../../../src/sim/meta/StatsHistory';

/** A fake world: day `d` earns 100 + d, spends 40, 1 incident every 10th day. */
function fake(): { h: StatsHistory; bus: EventBus<GameEvents>; w: { day: number; created: number; guests: number } } {
  const w = { day: 5, created: 0, guests: 10 };
  const src: StatsSources = {
    guests: () => ({ count: w.guests, happiness: 0.8 }), stars: () => 3.5, today: () => w.day,
    day: () => { const b = emptyBuckets(); b.income.lifts = 100 + w.day; b.income.restaurants = 10; b.expense.upkeep = 40; return b; },
    incidents: () => ({ created: w.created, resolved: w.created, hospitalised: 0 }), runs: () => w.day * 10, terrain: () => ({ snow: 0.5, skiable: 0.9, quality: 0.7 }),
    weather: () => ({ code: 2, temp: -3 }), attacks: () => 0, queueMinutes: () => 2, isFamily: (id) => id % 2 === 0,
  };
  const h = new StatsHistory(src), bus = new EventBus<GameEvents>();
  h.attach(bus);
  return { h, bus, w };
}
const closeDays = (f: ReturnType<typeof fake>, n: number): void => { for (let i = 0; i < n; i++) { f.w.day++; if (f.w.day % 10 === 0) f.w.created++; f.h.captureDay(); } };

describe('StatsHistory', () => {
  it('starts empty and numbers days from the date (the first close is the day before today)', () => {
    const f = fake();
    expect(f.h.len).toBe(0); expect(f.h.series('income').length).toBe(0);
    f.h.captureDay();
    expect(f.h.lastAbs).toBe(4); expect(f.h.len).toBe(1);
  });

  it('is a ring: keeps the last 360 days, oldest first', () => {
    const f = fake();
    closeDays(f, STATS_DAYS + 40);
    expect(f.h.len).toBe(STATS_DAYS);
    expect(f.h.lastAbs).toBe(4 + STATS_DAYS + 40);
    expect(f.h.firstAbs).toBe(f.h.lastAbs - STATS_DAYS + 1);
    expect(f.h.has(f.h.firstAbs - 1)).toBe(false);
    const s = f.h.series('income');
    expect(s.length).toBe(STATS_DAYS);
    // income of day abs d was booked as 100 + (d + 1) + 10 (the fake world reads w.day at capture)
    expect(s[s.length - 1]).toBe(100 + (f.h.lastAbs + 1) + 10);
    expect(s[0]).toBe(100 + (f.h.firstAbs + 1) + 10);
    expect(Number.isNaN(f.h.at('income', f.h.firstAbs - 1))).toBe(true);
  });

  it('feeds arrivals (family share), the hourly peak, queue samples and wildlife from the bus', () => {
    const f = fake();
    for (const id of [1, 2, 3, 4]) f.bus.emit('guest:arrived', { id });
    f.w.guests = 42; f.bus.emit('time:hour', { hour: 10 }); f.w.guests = 7; f.bus.emit('time:hour', { hour: 11 });
    f.bus.emit('incident:wildlife', { x: 1, y: 1, kind: 'bear', outcome: 'sighting' }); f.bus.emit('incident:wildlife', { x: 1, y: 1, kind: 'bear', outcome: 'attack' });
    f.h.captureDay();
    expect(f.h.at('arrivals', 4)).toBe(4); expect(f.h.at('family', 4)).toBe(2); expect(f.h.at('peak', 4)).toBe(42);
    expect(f.h.at('queue', 4)).toBe(2); expect(f.h.at('wildlife', 4)).toBe(1);
    f.h.captureDay(); // accumulators were reset
    expect(f.h.at('arrivals', 5)).toBe(0);
  });

  it('aggregates: summary, monthly (15 days), yearly, min / max / mean / sum', () => {
    const f = fake();
    f.w.day = 180; // year 1 day 0 of the calendar is abs 180 -> the first capture closes abs 179 (year 0)
    closeDays(f, 200);
    const s = f.h.summary('income', { from: 180, to: 189 });
    expect(s.n).toBe(10); expect(s.min).toBe(100 + 181 + 10); expect(s.max).toBe(100 + 190 + 10); expect(s.sum).toBeCloseTo(s.mean * 10, 6);
    const m = f.h.monthly('expense', 'sum', { from: 180, to: 209 });
    expect(m.map((x) => x.index)).toEqual([12, 13]); expect(m.map((x) => x.value)).toEqual([600, 600]); expect(m[0]!.days).toBe(15);
    expect(f.h.yearAgg('expense', 1, 'sum')).toBe(40 * 180);
    expect(f.h.yearAgg('rating', 1, 'mean')).toBe(3.5);
    expect(f.h.aggregate('incCreated', 'max')).toBe(1);
    expect(f.h.hasYear(1)).toBe(true); expect(f.h.hasYear(2)).toBe(false);
  });

  it('hasYear is true only when the whole calendar year is kept', () => {
    const f = fake();
    f.w.day = 180; closeDays(f, 300); // abs 180..479
    expect(f.h.hasYear(1)).toBe(true); expect(f.h.hasYear(0)).toBe(false); expect(f.h.hasYear(2)).toBe(false);
    closeDays(f, 70); // abs ..549: year 1 starts to fall out of the 360-day window (first kept = 190)
    expect(f.h.hasYear(1)).toBe(false); expect(f.h.hasYear(2)).toBe(true);
  });

  it('fires onYearEnd with the finished year at the last day of a year', () => {
    const f = fake(), ended: number[] = [];
    f.h.onYearEnd((y) => ended.push(y));
    f.w.day = 1; closeDays(f, 400);
    expect(ended).toEqual([0, 1]); // abs 179 and 359
  });

  it('serialises and restores exactly; an old save (null) loads as an empty history', () => {
    const f = fake();
    closeDays(f, 200);
    const data = JSON.parse(JSON.stringify(f.h.serialize(), (_k, v) => (ArrayBuffer.isView(v) ? Array.from(v as unknown as ArrayLike<number>) : v)));
    const g = new StatsHistory(null);
    g.load(data);
    expect(g.lastAbs).toBe(f.h.lastAbs); expect(g.len).toBe(f.h.len);
    for (const m of ['income', 'arrivals', 'rating', 'inc:lifts', 'exp:upkeep']) expect(Array.from(g.series(m))).toEqual(Array.from(f.h.series(m)));
    g.load(null);
    expect(g.len).toBe(0); expect(g.lastAbs).toBe(-1);
    g.load(data); g.reset();
    expect(g.len).toBe(0);
    expect(() => g.series('nope')).toThrow();
  });

  it('perf: a day capture costs well under 0.2 ms', () => {
    const f = fake();
    for (let i = 0; i < 50; i++) f.h.captureDay(); // warm up
    const t0 = performance.now(), n = 2000;
    for (let i = 0; i < n; i++) f.h.captureDay();
    const per = (performance.now() - t0) / n;
    console.info(`stats capture (fake sources): ${per.toFixed(4)} ms`);
    expect(per, `${per.toFixed(4)} ms per capture`).toBeLessThan(budget(0.2));
  });
});
