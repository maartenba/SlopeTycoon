import { describe, expect, it } from 'vitest';
import { RACE_DAY } from '../../../src/config/race';
import { advanceTo, nextSaturday, raceFixture } from './helpers';
import type { Sim } from '../../../src/game/createSim';

const near = (s: Sim, ids: readonly number[], x: number, y: number, r: number): number => { const st = s.guestSim.store; let n = 0; for (const id of ids) { const i = st.slotOf(id); if (i >= 0 && Math.hypot(st.x[i]! - x, st.y[i]! - y) <= r) n++; } return n; };

describe('race day spectators + sponsor', () => {
  it('existing guests walk to the Timing Hut and stand there; capped; hungry afterwards', () => {
    const { s, id } = raceFixture(3);
    const sat = nextSaturday(s);
    s.bookRaceDay(id, sat);
    advanceTo(s, sat, 9.9);
    const t = s.race.courses()[0]!.timing!;
    const before = s.guestSim.store.count ?? 0;
    advanceTo(s, sat, 10.1);
    const sess = s.raceDay.session!;
    expect(sess.spectators.length).toBeGreaterThan(0);
    expect(sess.spectators.length).toBeLessThanOrEqual(RACE_DAY.perWave);
    advanceTo(s, sat, 13);
    expect(s.raceDay.session!.spectators.length).toBeLessThanOrEqual(s.raceDay.capFor('club', 4));
    expect(s.raceDay.session!.spectators.length).toBeLessThanOrEqual(RACE_DAY.maxSpectators);
    const ids = [...s.raceDay.session!.spectators];
    expect(near(s, ids, t.x + t.w / 2, t.y + t.h / 2, 8)).toBeGreaterThan(0);
    void before;
    advanceTo(s, sat, 14.1);
    const st = s.guestSim.store; let hungry = 0, alive = 0;
    for (const g of ids) { const i = st.slotOf(g); if (i >= 0 && st.alive[i]) { alive++; if (st.hunger[i]! >= 0.3) hungry++; } }
    expect(alive).toBeGreaterThan(0); expect(hungry).toBeGreaterThan(0);
    expect(s.raceDay.results[0]!.spectators).toBe(ids.length);
  }, 120_000);
  it('the rating bonus is bounded (<= 1 point = 0.05 stars) and fades to nothing', () => {
    const { s, id } = raceFixture();
    const sat = nextSaturday(s);
    s.bookRaceDay(id, sat);
    expect(s.raceDay.ratingBonus()).toBe(0);
    advanceTo(s, sat, 14.2);
    const b = s.raceDay.ratingBonus();
    expect(b).toBeGreaterThan(0); expect(b).toBeLessThanOrEqual(1);
    advanceTo(s, sat + 8, 12);
    expect(s.raceDay.ratingBonus()).toBeLessThan(b);
    advanceTo(s, sat + RACE_DAY.bonusDays + 1, 1);
    expect(s.raceDay.ratingBonus()).toBe(0);
  }, 120_000);
});
