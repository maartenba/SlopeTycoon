import { describe, expect, it } from 'vitest';
import { COND_FISHING, CORE_TYPE_COUNT, GUEST_TYPE_DEFS, SHIPPED_TYPES, appealFor, coreOf, extraWeight, segmentKey, typeLabel } from '../../../src/config/guestTypes';
import { ICE_FISHING } from '../../../src/config/balance';
import { seasonStartDay } from '../../../src/sim/Clock';
import { prefFor, Pref } from '../../../src/sim/guests/Decision';
import { ATTRACTION_SPECS } from '../../../src/sim/attractions/registry';
import { appearanceOf, HairStyle } from '../../../src/render/guestAppearance';
import { building, fakeWorld, resetIds, rig } from './helpers';

const ANGLER = CORE_TYPE_COUNT + SHIPPED_TYPES.findIndex((d) => d.id === 'angler');
const def = SHIPPED_TYPES.find((d) => d.id === 'angler')!;

const mk = (season: 'winter' | 'summer' | 'spring' | 'autumn', flags: string[], level = 99) => {
  resetIds();
  const r = rig(fakeWorld([building('baseLodge', 60, 112), building('parking', 60, 100)]));
  r.state.date.day = seasonStartDay(season) + 3;
  r.sim.spawner.typesV2 = true; r.sim.spawner.levelFn = () => level; r.sim.spawner.flagsFn = () => flags;
  return r;
};
const share = (r: ReturnType<typeof rig>, n: number): number => {
  r.sim.spawner.benchFill(r.state, n, n);
  const s = r.sim.store; let all = 0, k = 0;
  for (let i = 0; i < s.limit; i++) if (s.alive[i]) { all++; if (s.type[i] === ANGLER) k++; }
  return k / Math.max(1, all);
};

describe('Angler type (Task 42)', () => {
  it('is the second shipped extra: solo segment, calm look (cap), label', () => {
    expect(ANGLER).toBe(CORE_TYPE_COUNT + 1);
    expect(GUEST_TYPE_DEFS[ANGLER - CORE_TYPE_COUNT]!.id).toBe('angler');
    expect(typeLabel(ANGLER)).toBe('Angler');
    expect(segmentKey(ANGLER)).toBe('solo'); expect(coreOf(ANGLER)).toBe(0);
    for (let id = 1; id < 40; id++) { const a = appearanceOf(id, ANGLER, false); if (a.age !== 0) expect(a.hairStyle).toBe(HairStyle.Cap); }
  });

  it('weight is 0 without an open tackle hut with fish (the @fishing condition)', () => {
    expect(share(mk('summer', []), 600)).toBe(0);
    expect(share(mk('autumn', []), 600)).toBe(0);
    expect(share(mk('summer', [COND_FISHING]), 900)).toBeGreaterThan(0.03);
  });

  it('season mix: summer main season, spring / autumn about half, winter only with ice fishing', () => {
    const w = (season: 'winter' | 'summer' | 'spring' | 'autumn'): number => extraWeight(def, { season, level: 99, hasBuilding: (id) => id === COND_FISHING });
    expect(w('summer')).toBeGreaterThan(0);
    expect(w('spring')).toBeCloseTo(w('summer') / 2); expect(w('autumn')).toBeCloseTo(w('summer') / 2);
    expect(w('winter') > 0).toBe(ICE_FISHING);
    expect(extraWeight(def, { season: 'summer', level: 1, hasBuilding: () => true })).toBe(0); // level 2
    expect(extraWeight(def, { season: 'summer', level: 99, hasBuilding: () => false })).toBe(0);
    const sum = share(mk('summer', [COND_FISHING]), 1200), aut = share(mk('autumn', [COND_FISHING]), 1200);
    expect(sum).toBeGreaterThan(aut);
    expect(share(mk('winter', [COND_FISHING]), 1200) > 0).toBe(ICE_FISHING);
    expect(sum).toBeLessThan(0.2); // quiet: a small share of the arrivals
  });

  it('anglers love the hut and water, dislike noise and sport, and never ski', () => {
    const a = (id: string): number => appealFor(ATTRACTION_SPECS[id]!, id, ANGLER)!;
    expect(a('tackleHut')).toBe(1.5);
    expect(a('tackleHut')).toBeGreaterThan(a('boatRental'));
    expect(a('beach')).toBeGreaterThan(a('stuntPark'));
    expect(a('restaurant') ?? 0).toBeGreaterThan(0.5);
    let ski = 0, bike = 0;
    for (let id = 1; id <= 400; id++) { const p = prefFor(id, ANGLER); if (p === Pref.Bike) bike++; else if (p === Pref.Ski) ski++; }
    expect(bike).toBe(0); expect(ski).toBeGreaterThan(200);
  });
});
