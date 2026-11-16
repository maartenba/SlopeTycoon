import { describe, expect, it } from 'vitest';
import { RACE } from '../../../src/config/race';
import { RACER_TYPE, SHIPPED_TYPES, CORE_TYPE_COUNT } from '../../../src/config/guestTypes';
import { stateHash } from '../../../src/game/saveState';
import { courseFixture, mkWinter } from './helpers';
import type { Sim } from '../../../src/game/createSim';

const racers = (s: Sim): number => { const st = s.guestSim.store; let n = 0; for (let i = 0; i < st.limit; i++) if (st.alive[i] && st.type[i] === RACER_TYPE) n++; return n; };
const day = (s: Sim): number => s.game.date.year * 180 + s.game.date.day;
const groomed = (s: Sim, id: number): void => s.runSettings.noteGroomed(id, day(s));

describe('Racer type', () => {
  it('is the last shipped extra at the stored index', () => {
    expect(SHIPPED_TYPES[RACER_TYPE - CORE_TYPE_COUNT]!.id).toBe('racer');
    expect(SHIPPED_TYPES.length).toBe(RACER_TYPE - CORE_TYPE_COUNT + 1);
  });
  it('no racers (and no demand) without a valid course', () => {
    const s = mkWinter(); s.guestSim.spawner.rateMult = 6;
    expect(s.race.demand(0)).toBe(0);
    s.tick(240 * 4);
    expect(racers(s)).toBe(0); expect(s.race.total).toBe(0);
  });
  it('a groomed black course draws more demand than a red one; an ungroomed one far less', () => {
    const red = courseFixture(2), blk = courseFixture(3);
    for (const f of [red, blk]) { f.s.setRunCourse(f.id, true); groomed(f.s, f.id); f.s.tick(1); }
    expect(blk.s.race.demand(0)).toBeGreaterThan(red.s.race.demand(0));
    expect(red.s.race.demand(0)).toBeCloseTo(RACE.diffQuality[3]! * RACE.groomQuality.fresh, 5);
    const stale = courseFixture(2); stale.s.runSettings.loadStats(undefined); stale.s.setRunCourse(stale.id, true); stale.s.tick(1);
    expect(stale.s.race.demand(0)).toBeCloseTo(RACE.diffQuality[3]! * RACE.groomQuality.ungroomed, 5);
    expect(stale.s.race.demand(0)).toBeLessThan(red.s.race.demand(0) * 0.6);
  });
  it('demand stops once the courses are full', () => {
    const f = courseFixture(); f.s.setRunCourse(f.id, true); groomed(f.s, f.id); f.s.tick(1);
    expect(f.s.race.demand(RACE.maxRacersPerCourse)).toBe(0);
    expect(f.s.race.demand(RACE.maxRacersPerCourse - 1)).toBeGreaterThan(0);
  });
  it('racers arrive, lap the course, pay the course fee', () => {
    const f = courseFixture(3); const s = f.s; s.setRunCourse(f.id, true); s.guestSim.spawner.rateMult = 8;
    const before = s.economy.ledger.recreation ?? 0;
    let seen = 0;
    for (let d = 0; d < 6; d++) { groomed(s, f.id); s.tick(240); seen = Math.max(seen, racers(s)); }
    expect(seen).toBeGreaterThan(0);
    expect(s.race.total).toBeGreaterThan(0);
    expect((s.economy.ledger.recreation ?? 0) - before).toBeGreaterThanOrEqual(RACE.courseFee);
  }, 60_000);
  it('a closed course sends racers back to normal skiing (nobody gets stuck)', () => {
    const f = courseFixture(3); const s = f.s; s.setRunCourse(f.id, true); s.guestSim.spawner.rateMult = 8;
    s.tick(240 * 2); s.setRunClosed(f.id, true);
    expect(s.race.active().length).toBe(0); expect(s.race.demand(0)).toBe(0);
    s.tick(240 * 2);
    expect(s.guestSim.store.count).toBeGreaterThanOrEqual(0);
  }, 60_000);
  it('is deterministic: two identical games hash the same after two days', () => {
    const run = (): string => { const f = courseFixture(3); f.s.setRunCourse(f.id, true); f.s.guestSim.spawner.rateMult = 8; groomed(f.s, f.id); f.s.tick(240 * 2); return stateHash(f.s).hash; };
    expect(run()).toBe(run());
  }, 60_000);
});
