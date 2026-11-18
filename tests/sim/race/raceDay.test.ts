import { describe, expect, it } from 'vitest';
import { RACE, RACE_DAY } from '../../../src/config/race';
import { SPONSORS } from '../../../src/config/raceSponsors';
import { absDay, advanceTo, nextSaturday, raceFixture } from './helpers';
import { raceTimes } from '../../../src/sim/race/RaceDay';

describe('race days (0.8.1)', () => {
  it('books on a weekend only, 2 days ahead, one a week, winter, paid', () => {
    const { s, id } = raceFixture();
    const sat = nextSaturday(s);
    expect(s.raceDay.blocker(id, absDay(s) + 1)).toMatch(/notice|weekend|Saturday/);
    expect(s.raceDay.blocker(id, sat + 2)).toMatch(/Saturday or Sunday/); // a Monday
    const money = s.game.money;
    expect(s.bookRaceDay(id, sat)).toBeNull();
    expect(money - s.game.money).toBe(RACE_DAY.cost);
    expect(s.raceDay.blocker(id, sat + 1)).toMatch(/one race day a week/i); // the Sunday of the same week
    expect(s.raceDay.blocker(id, sat + 7)).toBeNull(); // the next week is fine
    expect(s.raceDay.cancel(id, sat)).toBe(true);
    expect(money - s.game.money).toBe(RACE_DAY.cost - Math.round(RACE_DAY.cost * RACE_DAY.refund));
  });
  it('needs a valid course; an invalid course id is refused', () => {
    const { s } = raceFixture();
    expect(s.raceDay.blocker(999999, nextSaturday(s))).toMatch(/Pick a race course/);
  });
  it('closes the course 10:00-14:00 (reason Race day), opens it again at 14:00, posts results and pays', () => {
    const { s, id } = raceFixture();
    const sat = nextSaturday(s);
    s.bookRaceDay(id, sat);
    advanceTo(s, sat, 9);
    expect(s.race.active().length).toBe(1);
    const earn0 = (s.economy.ledger.recreation ?? 0);
    advanceTo(s, sat, 10.2);
    const st = s.openStatus.pisteAt(s.runIndex.runs()[0]!.tiles[0]! % s.size, (s.runIndex.runs()[0]!.tiles[0]! / s.size) | 0);
    expect(s.raceDay.session).not.toBeNull();
    expect(s.raceDay.session!.field).toBeGreaterThanOrEqual(RACE_DAY.field[0]);
    expect(s.raceDay.session!.field).toBeLessThanOrEqual(RACE_DAY.field[1]);
    expect(st?.open).toBe(false); expect(st?.reason).toMatch(/Race day/);
    expect(s.race.active().length).toBe(0); // closed to the public
    advanceTo(s, sat, 14.2);
    expect(s.raceDay.session).toBeNull();
    expect(s.raceDay.results[0]!.course).toBe(id);
    expect(s.raceDay.results[0]!.winnerMs).toBeGreaterThan(30_000);
    expect((s.economy.ledger.recreation ?? 0) - earn0).toBeGreaterThanOrEqual(s.raceDay.results[0]!.field * RACE_DAY.entryFee);
    expect(s.openStatus.pisteAt(s.runIndex.runs()[0]!.tiles[0]! % s.size, (s.runIndex.runs()[0]!.tiles[0]! / s.size) | 0)?.reason ?? '').not.toMatch(/Race day/);
  }, 120_000);
  it('a course that is closed on the day cancels the race and refunds the fee', () => {
    const { s, id } = raceFixture();
    const sat = nextSaturday(s);
    s.bookRaceDay(id, sat);
    const money = s.game.money;
    advanceTo(s, sat, 8);
    s.setRunClosed(id, true);
    advanceTo(s, sat, 10.2);
    expect(s.raceDay.session).toBeNull();
    expect(s.raceDay.bookings.length).toBe(0);
    expect(s.game.money).toBeGreaterThanOrEqual(money - 5_000); // refunded (the rest is a day of operation)
  }, 120_000);
  it('times are a pure function of (seed, day, course): fixed field, quality helps', () => {
    const a = raceTimes(61, 100, 7, 500, 1, 24, RACE.boardBaseS, RACE.boardMps), b = raceTimes(61, 100, 7, 500, 1, 24, RACE.boardBaseS, RACE.boardMps);
    expect(a).toEqual(b); expect(a.length).toBe(24);
    expect(a[0]!).toBeLessThanOrEqual(a[23]!);
    expect(raceTimes(61, 100, 7, 500, 0.4, 24, RACE.boardBaseS, RACE.boardMps)[0]!).toBeGreaterThanOrEqual(a[0]! - 1);
    expect(raceTimes(62, 100, 7, 500, 1, 24, RACE.boardBaseS, RACE.boardMps)).not.toEqual(a);
  });
  it('one sponsor per course from the pool, never shared while the pool lasts', () => {
    const { s, id } = raceFixture();
    expect(s.raceDay.sponsorOf(id)).toBeNull();
    s.bookRaceDay(id, nextSaturday(s));
    const sp = s.raceDay.sponsorOf(id)!;
    expect(SPONSORS.map((x) => x.id)).toContain(sp.id);
    s.bookRaceDay(id, nextSaturday(s) + 7);
    expect(s.raceDay.sponsorOf(id)!.id).toBe(sp.id); // one sponsor per course, kept
  });
});
