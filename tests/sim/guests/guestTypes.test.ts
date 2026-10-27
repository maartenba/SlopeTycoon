import { afterEach, describe, expect, it } from 'vitest';
import {
  CORE_TYPE_COUNT, appealFor, coreOf, extraWeight, guestTypeCount, registerGuestType, resetGuestTypes, segmentIndex, typeKey, typeLabel, type GuestTypeDef,
} from '../../../src/config/guestTypes';
import { seasonStartDay } from '../../../src/sim/Clock';
import { demandMultiplier } from '../../../src/sim/Elasticity';
import { GUEST_TYPE_NAMES, GuestStore } from '../../../src/sim/guests/Guest';
import { guestTypeBreakdown } from '../../../src/sim/guests/TypeBreakdown';
import { guestInspectorModel } from '../../../src/ui/guestInfo';
import { gearFor, Gear, appearanceOf, typeGearOf, typeOutfitOf } from '../../../src/render/guestAppearance';
import { createSim } from '../../../src/game/createSim';
import { stateHash } from '../../../src/sim/Systems';
import { building, fakeWorld, resetIds, rig, withStatus } from './helpers';

const DUMMY: GuestTypeDef = {
  id: 'dummy', label: 'Dummy', seasons: { summer: 1 }, minLevel: 1, fallback: 'adventure', segment: 'adventure',
  appeal: { stunt: 1.4, shop: 0.9 }, group: [2, 2], look: { top: 3, colour: 0x112233, gear: 'board', outfit: 1 },
};
const DUMMY_IDX = CORE_TYPE_COUNT;

afterEach(() => resetGuestTypes());

const mkRig = (season: 'winter' | 'summer', v2: boolean, level = 99) => {
  resetIds();
  const bs = [building('baseLodge', 60, 112), building('parking', 60, 100)];
  const r = rig(fakeWorld(bs));
  r.state.date.day = seasonStartDay(season) + 3;
  r.sim.spawner.typesV2 = v2; r.sim.spawner.levelFn = () => level;
  return { r, bs };
};
const histogram = (r: ReturnType<typeof rig>, n: number): number[] => {
  const h = new Array<number>(guestTypeCount()).fill(0);
  r.sim.spawner.benchFill(r.state, n, n);
  const s = r.sim.store;
  for (let i = 0; i < s.limit; i++) if (s.alive[i]) h[s.type[i]!]!++;
  return h;
};

describe('guest-type framework (Task 9)', () => {
  it('ships with no extra types and the six core names unchanged', () => {
    expect(guestTypeCount()).toBe(6);
    expect([...GUEST_TYPE_NAMES]).toEqual(['solo', 'couple', 'family', 'vip', 'budget', 'adventure']);
    expect(typeLabel(3)).toBe('VIP'); expect(typeLabel(0)).toBe('Solo'); expect(typeKey(5)).toBe('adventure');
    expect(coreOf(4)).toBe(4); expect(segmentIndex(2)).toBe(2);
  });

  it('a registered type changes nothing while the flag is off (same draws, same rng state)', () => {
    const base = mkRig('summer', false);
    const a = histogram(base.r, 150); const sa = base.r.state.rng.getState();
    registerGuestType(DUMMY);
    const off = mkRig('summer', false);
    const b = histogram(off.r, 150); const sb = off.r.state.rng.getState();
    expect(b.slice(0, 6)).toEqual(a);
    expect(b[DUMMY_IDX]).toBe(0);
    expect(sb).toBe(sa);
  });

  it('with the flag on the core draw still consumes the same rng, and the extra spawns only in its season', () => {
    registerGuestType(DUMMY);
    const summer = mkRig('summer', true);
    const hs = histogram(summer.r, 600);
    expect(hs[DUMMY_IDX]).toBeGreaterThan(20);
    expect(hs[DUMMY_IDX]).toBeLessThan(300);
    const winter = mkRig('winter', true);
    expect(histogram(winter.r, 600)[DUMMY_IDX]).toBe(0);
    // group of 2 from the def
    const s = summer.r.sim.store; const groups = new Map<number, number>();
    for (let i = 0; i < s.limit; i++) if (s.alive[i] && s.type[i] === DUMMY_IDX) groups.set(s.group[i]!, (groups.get(s.group[i]!) ?? 0) + 1);
    expect([...groups.values()].every((n) => n === 2)).toBe(true);
  });

  it('is gated by resort level and by a required building', () => {
    registerGuestType({ ...DUMMY, minLevel: 3, requires: ['stuntPark'] });
    expect(histogram(mkRig('summer', true, 2).r, 400)[DUMMY_IDX]).toBe(0); // level too low
    expect(histogram(mkRig('summer', true, 3).r, 400)[DUMMY_IDX]).toBe(0); // no stunt park
    const { r, bs } = mkRig('summer', true, 3);
    bs.push(building('stuntPark', 80, 90)); withStatus(bs);
    expect(histogram(r, 400)[DUMMY_IDX]).toBeGreaterThan(0);
  });

  it('weights: weather multiplier and zero shares', () => {
    const ctx = { season: 'summer' as const, level: 5, hasBuilding: () => true };
    expect(extraWeight({ ...DUMMY, weather: { rain: 0.5 } }, { ...ctx, weather: 'rain' })).toBe(0.5);
    expect(extraWeight(DUMMY, { ...ctx, season: 'winter' })).toBe(0);
  });

  it('appeal: core columns untouched, extras use kind / id overrides then the fallback column', () => {
    registerGuestType(DUMMY);
    const spec = { kind: 'stunt', appeal: [0.4, 0.3, 0.2, 0.2, 0.5, 1] as const };
    expect(appealFor(spec, 'stuntPark', 4)).toBe(0.5);
    expect(appealFor(spec, 'stuntPark', DUMMY_IDX)).toBe(1.4);
    expect(appealFor({ kind: 'rink', appeal: spec.appeal }, 'iceRink', DUMMY_IDX)).toBe(1); // adventure column
    expect(appealFor({ kind: 'shop', appeal: spec.appeal }, 'shop', DUMMY_IDX)).toBe(0.9);
  });

  it('marketing segment: elasticity and arrival log treat the extra like its segment', () => {
    registerGuestType({ ...DUMMY, segment: 'budget' });
    expect(segmentIndex(DUMMY_IDX)).toBe(4);
    expect(demandMultiplier(DUMMY_IDX, 1.5)).toBeCloseTo(demandMultiplier('budget', 1.5), 10);
  });

  it('inspector label, breakdown and look hooks', () => {
    registerGuestType(DUMMY);
    const s = new GuestStore(50);
    const add = (type: number): number => s.add({ x: 1, y: 1, z: 0, type, skill: 1, budget: 100, group: 1, mode: 0, overnight: false, leaveDay: 3, tick: 0, happiness: 0.5 });
    const sl = add(DUMMY_IDX); add(0); add(DUMMY_IDX);
    expect(guestInspectorModel(s, sl)!.type).toBe('Dummy');
    expect(guestInspectorModel(s, add(2))!.type).toBe('family');
    const rows = guestTypeBreakdown(s);
    expect(rows).toHaveLength(7);
    expect(rows[DUMMY_IDX]).toMatchObject({ label: 'Dummy', count: 2 });
    expect(rows.reduce((a, r) => a + r.share, 0)).toBeCloseTo(1, 6);
    // look
    expect(typeGearOf(DUMMY_IDX)).toBe('board'); expect(typeGearOf(0)).toBeUndefined(); expect(typeOutfitOf(DUMMY_IDX)).toBe(1);
    expect(gearFor(5, 3, 1, 0, 'ski')).toBe(Gear.Sit);
    expect(gearFor(0, 3, 1, 0, 'ski')).toBe(Gear.Ski); expect(gearFor(0, 3, 1, 0, 'board')).toBe(Gear.Board);
    let tops = 0; for (let id = 1; id <= 400; id++) if (appearanceOf(id, DUMMY_IDX, true).top === 3) tops++;
    expect(tops).toBeGreaterThan(150);
  });

  it('unknown type values degrade safely', () => {
    expect(coreOf(42)).toBe(0); expect(typeLabel(42)).toBe('Guest'); expect(segmentIndex(42)).toBe(0);
  });

  it('createSim: guestTypesV2 with no types defined leaves the state hash identical (goldens)', () => {
    const run = (v2: boolean): string => {
      const sim = createSim({ size: 64, seed: 7, startSeason: 'summer', guestTypesV2: v2, now: () => 0 });
      for (let i = 0; i < 400; i++) sim.tick(1);
      return stateHash(sim.game, sim.registry);
    };
    expect(run(true)).toBe(run(false));
  });
});
