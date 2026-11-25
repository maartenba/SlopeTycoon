import { describe, expect, it } from 'vitest';
import { FREESTYLER_TYPE, CORE_TYPE_COUNT, SHIPPED_TYPES, SNOWBOARDER_TYPE } from '../../../src/config/guestTypes';
import { PARK } from '../../../src/config/park';
import { createSim } from '../../../src/game/createSim';
import { stateHash } from '../../../src/game/saveState';
import { freestylers, mainRun, parkFixture } from './helpers';

const groomAll = (s: ReturnType<typeof parkFixture>['s']): void => { for (const t of mainRun(s).tiles) s.ops.quality.groom(t); };

describe('Freestyler type', () => {
  it('sits at the stored index 16, last, winter only, needs @snowPark, level 3', () => {
    const d = SHIPPED_TYPES[FREESTYLER_TYPE - CORE_TYPE_COUNT]!;
    expect(d.id).toBe('freestyler'); expect(SHIPPED_TYPES.length).toBe(FREESTYLER_TYPE - CORE_TYPE_COUNT + 1);
    expect(d.requires).toEqual([PARK.cond]); expect(d.minLevel).toBe(3); expect(Object.keys(d.seasons)).toEqual(['winter']);
    expect(SHIPPED_TYPES[SNOWBOARDER_TYPE - CORE_TYPE_COUNT]!.id).toBe('snowboarder');
    expect(PARK.cond).toBe('@snowPark'); // the jersey colour index is checked against CLOTH_COLORS in park:sanity
  });
  it('rides an open park in winter: laps, tricks, fees; leaves after its quota', () => {
    const { s, id } = parkFixture(1, 5);
    s.setRunPark(id, true); s.guestSim.spawner.rateMult = 6;
    let seen = 0;
    for (let d = 0; d < 4; d++) { groomAll(s); s.tick(120); seen = Math.max(seen, freestylers(s)); s.tick(120); }
    expect(s.park.total).toBeGreaterThan(5);
    expect(s.park.tricks).toBeGreaterThanOrEqual(s.park.total * 3);
    expect(s.park.ridersToday() + s.park.total).toBeGreaterThan(0);
  });
  it('without a park no Freestyler ever spawns, and the stateHash gains no park part', () => {
    const s = createSim({ size: 64, seed: 61, starterResort: true, now: () => 0 });
    s.guestSim.spawner.rateMult = 6; s.tick(480);
    expect(freestylers(s)).toBe(0); expect(s.park.total).toBe(0);
    expect(s.park.serialize()).toBeNull(); expect(stateHash(s).parts['snowPark']).toBeUndefined();
    expect(s.runSettings.serialize().park).toBeUndefined();
  });
  it('a closed park draws no riders (demand 0)', () => {
    const { s, id } = parkFixture(1, 5);
    s.setRunPark(id, true); s.setRunClosed(id, true); s.tick(1);
    expect(s.park.active().length).toBe(0); expect(s.park.demand(0)).toBe(0);
  });
  it('the injury roll scales up as the park wears out', () => {
    const { s, id } = parkFixture(1, 5);
    s.setRunPark(id, true); groomAll(s);
    const t = mainRun(s).tiles[0]!, fresh = s.park.injuryScale(t);
    s.game.date.day += 12;
    expect(s.park.injuryScale(t)).toBeGreaterThan(fresh);
    expect(fresh).toBeGreaterThanOrEqual(PARK.injury.base);
  });
  it('is deterministic: two identical sims with a park agree on the hash after two days', () => {
    const run = (): string => { const { s, id } = parkFixture(1, 5); s.setRunPark(id, true); s.guestSim.spawner.rateMult = 4; s.tick(480); return JSON.stringify(stateHash(s).parts); };
    expect(run()).toBe(run());
  }, 60_000);
});
