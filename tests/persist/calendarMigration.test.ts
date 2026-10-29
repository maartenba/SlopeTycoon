import { describe, expect, it } from 'vitest';
import { mapAbsDay, mapDayKey, mapDayOfYear, migrate, SAVE_FORMAT_VERSION, type RawEnvelope } from '../../src/persist/migrations';
import { SAVE_MAGIC } from '../../src/persist/Serializer';
import { DAYS_PER_MONTH, DAYS_PER_YEAR } from '../../src/config/balance';
import { monthIndex, seasonOf } from '../../src/sim/Clock';
import { createSim } from '../../src/game/createSim';
import { collectSave, applySave } from '../../src/game/saveState';

/** v1 -> v2: 30-day months / 360-day year -> 15-day months / 180-day year (docs/time-flow.md). */
describe('calendar compression save migration (v1 -> v2)', () => {
  it('maps day of year keeping the month index, halving the day within the month', () => {
    expect(SAVE_FORMAT_VERSION).toBeGreaterThanOrEqual(2);
    for (let d = 0; d < 360; d++) {
      const n = mapDayOfYear(d);
      expect(Math.floor(n / DAYS_PER_MONTH)).toBe(Math.floor(d / 30)); // month preserved
      expect(n).toBe(Math.floor(d / 30) * 15 + Math.floor((d % 30) / 2));
      expect(n).toBeLessThan(DAYS_PER_YEAR);
    }
    expect(mapDayOfYear(0)).toBe(0); expect(mapDayOfYear(29)).toBe(14); expect(mapDayOfYear(30)).toBe(15); expect(mapDayOfYear(240)).toBe(120); expect(mapDayOfYear(359)).toBe(179);
    for (const d of [0, 59, 60, 179, 180, 239, 240, 359]) expect(seasonOf({ day: mapDayOfYear(d) })).toBe(seasonOfOld(d)); // season preserved
  });
  const seasonOfOld = (d: number): string => (d < 60 ? 'spring' : d < 180 ? 'summer' : d < 240 ? 'autumn' : 'winter');
  it('absolute days and keys, sentinels untouched', () => {
    expect(mapAbsDay(360 + 270)).toBe(180 + 135); expect(mapAbsDay(0)).toBe(0); expect(mapAbsDay(-1)).toBe(-1); expect(mapAbsDay(-1e9)).toBe(-1e9);
    expect(mapDayKey(2 * 1000 + 270)).toBe(2 * 1000 + 135);
    // monotone, so "leaveDay >= today" comparisons keep their order
    let prev = -1; for (let a = 0; a < 1500; a++) { const m = mapAbsDay(a); expect(m).toBeGreaterThanOrEqual(prev); prev = m; }
  });

  const oldSave = (): RawEnvelope => ({
    magic: SAVE_MAGIC, version: 1, createdAt: 1, seed: 7, mapSize: 64,
    meta: { name: 'old', date: { year: 2, day: 275, minute: 600 }, money: 1, rating: 3, guests: 2, mapSize: 64, savedAt: 1 },
    modules: {
      core: { v: 1, data: { date: { year: 2, day: 275, minute: 600, tick: 99999 }, money: 5 } },
      'sys.guests': { v: 1, data: { cols: { leaveDay: Int32Array.from([0, 360 + 275, 360 + 277, 720 + 10]), id: Int32Array.from([1, 2, 3, 4]) }, trek: [[2, 5, 1, 360 + 276, [1, 2]]] } },
      'sys.economy': { v: 1, data: {
        lastDay: 360 + 275, firstDay: 8, lastMonth: 9, lastYear: 2, negDays: 4, deepDays: 3,
        ticketing: { passDay: [[2, 360 + 275], [3, 360 + 270]], hikerDay: [[5, 360 + 100]], holders: [1] },
        marketing: { active: [{ id: 'a', start: 360 + 270, end: 360 + 284 }], tails: [{ id: 'b', end: 360 + 200 }], history: [{ id: 'c', start: 100 }], cooldown: [['a', 360 + 300]], log: [{ day: 360 + 274, total: 3 }], cur: 360 + 275 },
        liftOps: { absDay: 360 + 275, rng: 1, profile: null },
      } },
      'sys.rating': { v: 1, data: { lastDay: 360 + 275, r: { e: 360 + 270, s: [] } } },
      'sys.attractions': { v: 1, data: { last: 360 + 275 } },
      'sys.ops': { v: 1, data: { lastDay: 360 + 275, lastStamp: (360 + 275) * 24 + 10, lastRow: 3, groom: { nightKey: 360 + 274 }, safety: { ava: { lastReleaseDay: -1e9, lastNewsDay: 360 + 260, curDay: 360 + 275, lastBlastDay: 360 + 250, countDay: -1, cool: [11, 360 + 280, 12, 360 + 281] }, wild: { lastDay: 360 + 275, stations: [[4, { month: 20, staff: 2 }]] } } } },
      lifts: { v: 1, data: { items: [{ id: 1, ops: { lastInspection: 360 + 250, ageDays: 77 } }, { id: 2, ops: { lastInspection: -1, ageDays: 3 } }] } },
      'sys.weather': { v: 1, data: { weather: { lastDay: 2000 + 275, rng: 1 }, lastDay: 2000 + 275, lastRow: 5 } },
      nature: { v: 1, data: { now: 360 + 275, growth: { last: 360 + 270 } } },
      props: { v: 1, data: { now: 360 + 275, chunks: [{ born: Int32Array.from([-1, 360 + 200, 360 + 270]) }] } },
      advisor: { v: 1, data: { snooze: [['x', 360 + 290]], dismissed: 2 } },
      families: { v: 1, data: { schools: [[7, { day: 360 + 275, lessonsToday: 2 }]] } },
    },
  });
  it('remaps every stored absolute-day field of a synthetic v1 blob; month counters and durations stay', () => {
    const { env: e, applied } = migrate(oldSave());
    expect(applied).toEqual([1, 2]); expect(e.version).toBe(SAVE_FORMAT_VERSION);
    const m = e.modules as Record<string, { data: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const A = (n: number): number => mapAbsDay(n), T = 360 + 275, N = A(T); // "today" in the new calendar (year 2, day 137)
    expect(N).toBe(180 + 137);
    expect(m.core!.data.date).toMatchObject({ year: 2, day: 137, minute: 600, tick: 99999 });
    expect(monthIndex(m.core!.data.date)).toBe(9); // month 9 before and after
    expect(e.meta.date.day).toBe(137);
    expect(Array.from(m['sys.guests']!.data.cols.leaveDay)).toEqual([0, N, A(360 + 277), A(720 + 10)]);
    expect(m['sys.guests']!.data.cols.leaveDay).toBeInstanceOf(Int32Array);
    expect(Array.from(m['sys.guests']!.data.cols.id)).toEqual([1, 2, 3, 4]);
    expect(m['sys.guests']!.data.trek[0]).toEqual([2, 5, 1, A(360 + 276), [1, 2]]);
    const f = m['sys.economy']!.data;
    expect(f.lastDay).toBe(N); expect(f.firstDay).toBe(4); expect(f.lastMonth).toBe(9); expect(f.lastYear).toBe(2);
    expect(f.negDays).toBe(4); expect(f.deepDays).toBe(3); // durations unchanged
    expect(f.ticketing.passDay).toEqual([[2, N], [3, A(360 + 270)]]);
    expect(f.ticketing.hikerDay).toEqual([[5, A(460)]]); expect(f.ticketing.holders).toEqual([1]);
    expect(f.marketing.active[0]).toMatchObject({ id: 'a', start: A(630), end: A(644) });
    expect(f.marketing.cooldown).toEqual([['a', A(660)]]); expect(f.marketing.cur).toBe(N); expect(f.marketing.log[0].day).toBe(A(634)); expect(f.marketing.history[0].start).toBe(A(100));
    expect(f.liftOps.absDay).toBe(N);
    expect(m['sys.rating']!.data.lastDay).toBe(N); expect(m['sys.rating']!.data.r.e).toBe(A(630));
    expect(m['sys.attractions']!.data.last).toBe(N);
    const o = m['sys.ops']!.data;
    expect(o.lastDay).toBe(N); expect(o.lastStamp).toBe(N * 24 + 10); expect(o.groom.nightKey).toBe(A(634));
    expect(o.safety.ava.lastReleaseDay).toBe(-1e9); expect(o.safety.ava.countDay).toBe(-1); expect(o.safety.ava.curDay).toBe(N);
    expect(o.safety.ava.cool).toEqual([11, A(640), 12, A(641)]);
    expect(o.safety.wild.lastDay).toBe(N); expect(o.safety.wild.stations[0][1].month).toBe(40);
    expect(m.lifts!.data.items[0].ops).toMatchObject({ lastInspection: A(610), ageDays: 77 }); expect(m.lifts!.data.items[1].ops.lastInspection).toBe(-1);
    expect(m['sys.weather']!.data.lastDay).toBe(2000 + 137); expect(m['sys.weather']!.data.weather.lastDay).toBe(2000 + 137);
    expect(m.nature!.data.now).toBe(N); expect(m.nature!.data.growth.last).toBe(A(630));
    expect(Array.from(m.props!.data.chunks[0].born)).toEqual([-1, A(560), A(630)]);
    expect(m.advisor!.data.snooze).toEqual([['x', A(650)]]);
    expect(m.families!.data.schools[0][1]).toMatchObject({ day: N, lessonsToday: 2 });
  });
  it('tree ages halve (growth days are scaled the same way): a tree born 100 old days ago is 50 days old now', () => {
    const born = 360 + 150, now = 360 + 250;
    expect(mapAbsDay(now) - mapAbsDay(born)).toBe(50);
  });
  it('a real v2 save round-trips and a v1-style blob loads into a sim whose clock continues (no frozen daily systems)', () => {
    const a = createSim({ size: 64, seed: 5, now: () => 0 });
    a.tick(240 * 3);
    const modules = collectSave(a) as Record<string, { v: number; data: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any
    // downgrade the date fields of the fresh save to the old calendar (inverse mapping) and migrate it back
    const fin = modules['sys.economy']!.data, d = modules.core!.data.date;
    const oldDay = (n: number): number => Math.floor(n / DAYS_PER_YEAR) * 360 + Math.floor((n % DAYS_PER_YEAR) / DAYS_PER_MONTH) * 30 + ((n % DAYS_PER_YEAR) % DAYS_PER_MONTH) * 2;
    const day0 = d.day; d.day = oldDay(d.day);
    fin.lastDay = oldDay(fin.lastDay); fin.firstDay = oldDay(fin.firstDay);
    const env: RawEnvelope = { magic: SAVE_MAGIC, version: 1, createdAt: 1, seed: 5, mapSize: 64, meta: { name: 'x', date: { year: d.year, day: d.day, minute: d.minute }, money: 0, rating: 0, guests: 0, mapSize: 64, savedAt: 1 }, modules };
    const up = migrate(env).env;
    expect((up.modules.core!.data as any).date.day).toBe(day0); // eslint-disable-line @typescript-eslint/no-explicit-any
    const b = createSim({ size: 64, seed: 5, now: () => 0 });
    applySave(b, up.modules);
    const days0 = b.game.date.day;
    b.tick(240 * 2);
    expect((b.game.date.day - days0 + DAYS_PER_YEAR) % DAYS_PER_YEAR).toBe(2);
    expect(b.finance.ended).toBe(false);
  }, 60000);
});
