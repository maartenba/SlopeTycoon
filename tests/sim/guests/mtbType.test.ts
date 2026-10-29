import { describe, expect, it } from 'vitest';
import { CORE_TYPE_COUNT, COND_MTB_BIKE_LIFT, GUEST_TYPE_DEFS, SHIPPED_TYPES, appealFor, coreOf, guestTypeCount, segmentKey, typeLabel } from '../../../src/config/guestTypes';
import { seasonStartDay } from '../../../src/sim/Clock';
import { Pref, prefFor } from '../../../src/sim/guests/Decision';
import { ATTRACTION_SPECS } from '../../../src/sim/attractions/registry';
import { appearanceOf, HairStyle, typeOutfitOf } from '../../../src/render/guestAppearance';
import { stateHash } from '../../../src/sim/Systems';
import { createSim } from '../../../src/game/createSim';
import { building, fakeWorld, resetIds, rig } from './helpers';

const MTB = CORE_TYPE_COUNT + SHIPPED_TYPES.findIndex((d) => d.id === 'mtb');

const mk = (season: 'winter' | 'summer' | 'spring' | 'autumn', flags: string[]) => {
  resetIds();
  const bs = [building('baseLodge', 60, 112), building('parking', 60, 100)];
  const r = rig(fakeWorld(bs));
  r.state.date.day = seasonStartDay(season) + 3;
  r.sim.spawner.typesV2 = true; r.sim.spawner.levelFn = () => 99; r.sim.spawner.flagsFn = () => flags;
  return r;
};
const share = (r: ReturnType<typeof rig>, n: number): number => {
  r.sim.spawner.benchFill(r.state, n, n);
  const s = r.sim.store; let all = 0, k = 0;
  for (let i = 0; i < s.limit; i++) if (s.alive[i]) { all++; if (s.type[i] === MTB) k++; }
  return k / Math.max(1, all);
};

describe('Mountain biker type (Task 25)', () => {
  it('is a shipped extra row with an adventure segment and look hooks', () => {
    expect(MTB).toBeGreaterThanOrEqual(CORE_TYPE_COUNT);
    expect(GUEST_TYPE_DEFS[MTB - CORE_TYPE_COUNT]!.id).toBe('mtb');
    expect(guestTypeCount()).toBeGreaterThan(CORE_TYPE_COUNT);
    expect(typeLabel(MTB)).toBe('Mountain biker');
    expect(segmentKey(MTB)).toBe('adventure'); // Hike & Bike Weekends / Summer Adventure campaigns
    expect(coreOf(MTB)).toBe(5);
    expect(typeOutfitOf(MTB)).toBe(1);
    expect(appearanceOf(77, MTB, true).hairStyle).toBe(HairStyle.Helmet);
  });

  it('spawns only in summer and only with an MTB trail + bike lift', () => {
    expect(share(mk('winter', [COND_MTB_BIKE_LIFT]), 500)).toBe(0);
    expect(share(mk('autumn', [COND_MTB_BIKE_LIFT]), 500)).toBe(0);
    expect(share(mk('spring', [COND_MTB_BIKE_LIFT]), 500)).toBe(0);
    expect(share(mk('summer', []), 500)).toBe(0);
    const s = share(mk('summer', [COND_MTB_BIKE_LIFT]), 800);
    expect(s).toBeGreaterThan(0.07); expect(s).toBeLessThan(0.25); // 10-20 % of the summer arrivals
  });

  it('almost always prefers the bike, and likes the adventure park / rental over the snow-only things', () => {
    let bike = 0;
    for (let id = 1; id <= 400; id++) if (prefFor(id, MTB) === Pref.Bike) bike++;
    expect(bike / 400).toBeGreaterThan(0.8);
    const a = (id: string) => appealFor(ATTRACTION_SPECS[id]!, id, MTB)!;
    expect(a('adventurePark')).toBeGreaterThan(a('rental') - 0.0001);
    expect(a('rental')).toBeGreaterThan(a('playground'));
  });

  it('createSim: no trail / lift = no mountain biker; deterministic', () => {
    const a = createSim({ seed: 3, size: 64 }), b = createSim({ seed: 3, size: 64 });
    expect(a.guestSim.spawner.flagsFn!()).toEqual([]);
    for (let i = 0; i < 40; i++) { a.tick(1); b.tick(1); }
    expect(stateHash(a.game, a.registry)).toBe(stateHash(b.game, b.registry));
  });
});
