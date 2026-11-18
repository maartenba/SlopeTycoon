import { describe, expect, it } from 'vitest';
import { createSim } from '../../src/game/createSim';
import { encodeSave, decodeSave, makeMeta } from '../../src/persist/Serializer';
import { applySave, stateHash } from '../../src/game/saveState';
import { advanceTo, nextSaturday, raceFixture } from '../sim/race/helpers';

describe('race day save / load (raceCourse module v2)', () => {
  it('a save in the middle of a race reloads identically and the race ends the same way (closure, spectators, results, sponsor, rating bonus)', async () => {
    const { s, id } = raceFixture(3);
    const sat = nextSaturday(s);
    s.bookRaceDay(id, sat);
    advanceTo(s, sat, 11.5);
    expect(s.raceDay.session).not.toBeNull(); expect(s.raceDay.session!.spectators.length).toBeGreaterThan(0);
    const { bytes } = await encodeSave(s, makeMeta(s, 'x'), { compress: true, yieldBetween: false });
    const env = (await decodeSave(bytes, { yieldBetween: false })).envelope;
    expect(env.modules['raceCourse']!.v).toBe(2);
    const a = createSim({ size: env.mapSize, seed: env.seed, now: () => 0, fromSave: structuredClone(env.modules) });
    applySave(s, structuredClone(env.modules)); // control: the same save applied in place
    a.guestSim.spawner.rateMult = 4; // (the test knob is not saved)
    expect(a.raceDay.serialize()).toEqual(s.raceDay.serialize());
    const differing = (): string[] => { const x = stateHash(s).parts, y = stateHash(a).parts; return Object.keys({ ...x, ...y }).filter((k) => x[k] !== y[k]); };
    expect(differing()).toEqual([]);
    for (let d = 0; d < 120; d += 20) { s.ops.quality.attachTraffic(); s.tick(20); a.ops.quality.attachTraffic(); a.tick(20); expect(differing(), `after ${d + 20} ticks`).toEqual([]); }
    expect(a.raceDay.session).toBeNull(); expect(a.raceDay.results.length).toBe(1);
    expect(a.raceDay.results[0]).toEqual(s.raceDay.results[0]);
    expect(a.raceDay.ratingBonus()).toBeCloseTo(s.raceDay.ratingBonus(), 9);
  }, 180_000);
  it('a resort without a race day writes no race-day data; a v1 save (laps only) loads with no race day', async () => {
    const s = createSim({ size: 64, seed: 61, starterResort: true, now: () => 0 });
    s.tick(40);
    expect(s.raceDay.serialize()).toBeNull();
    expect(stateHash(s).parts['raceCourse']).toBeUndefined();
    const { bytes } = await encodeSave(s, makeMeta(s, 'old'), { compress: true, yieldBetween: false });
    const env = (await decodeSave(bytes, { yieldBetween: false })).envelope;
    (env.modules as Record<string, unknown>)['raceCourse'] = { v: 1, data: { laps: [[1, 2, 3]], total: 2, day: 1, today: 1, best: [] } };
    const b = createSim({ size: env.mapSize, seed: env.seed, now: () => 0, fromSave: structuredClone(env.modules) });
    expect(b.raceDay.bookings).toEqual([]); expect(b.raceDay.session).toBeNull(); expect(b.race.total).toBe(2);
    b.tick(20);
  });
});
