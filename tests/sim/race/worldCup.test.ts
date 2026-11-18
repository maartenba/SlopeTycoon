import { describe, expect, it } from 'vitest';
import { RACE_DAY } from '../../../src/config/race';
import { FESTIVAL_BY_ID } from '../../../src/config/festivals';
import { absDay, advanceTo, mkWinter, raceFixture } from './helpers';

describe('World Cup on the player course (0.8.1)', () => {
  it('needs a race course (red or black) instead of a bare black piste; a course on a red run is enough', () => {
    expect(FESTIVAL_BY_ID.worldCup.needs).toEqual(['lodge', 'raceCourse']);
    const s = mkWinter();
    expect(s.events.requirement('worldCup')).toMatch(/race course|Base Lodge/);
    const { s: r } = raceFixture(2); // red
    expect(r.race.courses().some((c) => c.valid)).toBe(true);
    expect(r.events.requirement('worldCup') ?? '').not.toMatch(/race course/);
  });
  it('a World Cup day runs the race on the best course (a black one), closes it, draws spectators up to 40 and posts a result', () => {
    const { s, id } = raceFixture(3);
    s.events.debugStart('worldCup', 1);
    const d = absDay(s);
    advanceTo(s, d + 1, 3); // the forced event runs from today; make sure the race happens on its day
    s.events.debugStart('worldCup', 1);
    const day = absDay(s);
    advanceTo(s, day, 10.2);
    const ses = s.raceDay.session;
    expect(ses).not.toBeNull();
    expect(ses!.kind).toBe('worldCup'); expect(ses!.course).toBe(id); expect(ses!.difficulty).toBe(4);
    expect(ses!.field).toBeGreaterThanOrEqual(RACE_DAY.fieldWorldCup[0]);
    advanceTo(s, day, 13);
    expect(s.raceDay.session!.spectators.length).toBeLessThanOrEqual(RACE_DAY.maxSpectators);
    advanceTo(s, day, 14.2);
    expect(s.raceDay.results[0]!.kind).toBe('worldCup');
  }, 120_000);
  it('a black course gives the World Cup a bigger arrival multiplier than a red one', () => {
    const blk = raceFixture(3).s, red = raceFixture(2).s;
    blk.events.debugStart('worldCup', 3); red.events.debugStart('worldCup', 3);
    expect(blk.events.arrivalMult()).toBeCloseTo(FESTIVAL_BY_ID.worldCup.arrivalMult * RACE_DAY.worldCupBlackMult, 6);
    expect(red.events.arrivalMult()).toBeCloseTo(FESTIVAL_BY_ID.worldCup.arrivalMult, 6);
  });
  it('without a course the World Cup keeps its old behaviour (no race session, no error)', () => {
    const s = mkWinter();
    s.events.debugStart('worldCup', 3);
    advanceTo(s, absDay(s) + 1, 15);
    expect(s.raceDay.session).toBeNull(); expect(s.raceDay.results.length).toBe(0);
  });
});
