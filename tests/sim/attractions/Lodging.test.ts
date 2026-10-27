import { afterEach, describe, expect, it } from 'vitest';
import { BUILDINGS } from '../../../src/config/buildings';
import { LODGING_TIER_MULT, NIGHTLY_RATE, tieredNightly } from '../../../src/config/prices';
import { ATTRACTION_SPECS as SPECS } from '../../../src/sim/attractions/registry';
import type { AttractionSpec } from '../../../src/sim/attractions/Attraction';

const ATTRACTION_SPECS = SPECS as Record<string, AttractionSpec>;
import { tierAppeal } from '../../../src/sim/attractions/Lodging';
import { seasonOf } from '../../../src/sim/Clock';
import { RoomBook } from '../../../src/sim/attractions/Lodging';
import { GState } from '../../../src/sim/guests/Guest';
import { harness } from './harness';

describe('lodging', () => {
  it('overnight guests check in to open lodging with capacity; nightly revenue; the rest get no room', () => {
    const h = harness();
    const b = h.add('chalet'); // 12 rooms
    h.run(1);
    h.state.date.minute = 18 * 60 + 30;
    const gs = Array.from({ length: 15 }, () => h.guest({ overnight: true }));
    h.run(1);
    const a = h.sys.get(b.id)!;
    expect(h.sys.rooms.occupied(b.id)).toBe(12);
    expect(a.stats.nights).toBe(12);
    expect(h.econ.ledger.lodging).toBe(12 * NIGHTLY_RATE.chalet!.price);
    expect(gs.filter((g) => h.sys.rooms.roomOf(h.store.id[g]!) === b.id)).toHaveLength(12);
    expect(h.sys.lodgingCapacity()).toBe(12);
    h.run(3);
    expect(h.econ.ledger.lodging).toBe(12 * NIGHTLY_RATE.chalet!.price); // once per night
  });

  it('closed lodging sells nothing; day guests cannot use rooms; returning guests pay per night', () => {
    const h = harness();
    const b = h.add('apartment');
    h.status.set(b.id, { open: false, reason: 'Closed: test' });
    h.run(1);
    h.state.date.minute = 19 * 60;
    h.guest({ overnight: true });
    h.run(1);
    expect(h.econ.ledger.lodging).toBe(0);
    expect(h.sys.lodgingCapacity()).toBe(0);
    h.status.delete(b.id);
    h.run(1);
    const day = h.guest();
    expect(h.sys.canUse(b.id, day)).toBe(false);
    expect(h.arrive(day, h.buildings[0]!)).toBe('handled');
    expect(h.store.state[day]).not.toBe(GState.Using);
    // next evening the same guest pays again
    h.state.date.day++;
    h.run(1);
    expect(h.sys.get(b.id)!.stats.nights).toBe(1);
    h.state.date.day++;
    h.run(1);
    expect(h.sys.get(b.id)!.stats.nights).toBe(2);
  });

  it('base lodge doubles as dining and 20 rooms', () => {
    const h = harness();
    const b = h.add('baseLodge');
    h.state.date.minute = 18 * 60;
    h.guest({ overnight: true });
    h.run(1);
    expect(h.sys.get(b.id)!.spec.rooms).toBe(20);
    expect(h.sys.rooms.occupied(b.id)).toBe(1);
  });

  it('room book purges departed guests', () => {
    const rb = new RoomBook();
    rb.assign(1, 7); rb.assign(2, 7);
    rb.purge((g) => g === 1, () => true);
    expect(rb.occupied(7)).toBe(1);
    rb.purge(() => true, () => false);
    expect(rb.total()).toBe(0);
  });
});

describe('lodging v2 (tiers, seasonal opening, pool)', () => {
  const ids = ['testBudget', 'testLux'] as const;
  const dayOf = (season: string): number => { for (let d = 0; d < 180; d++) if (seasonOf({ day: d }) === season) return d; throw new Error('no day'); };
  function register(): void {
    for (const id of ids) {
      BUILDINGS[id] = { ...BUILDINGS.chalet!, id, name: id } as never;
      NIGHTLY_RATE[id] = tieredNightly(NIGHTLY_RATE.chalet!, id === 'testBudget' ? 'budget' : 'luxury');
    }
    ATTRACTION_SPECS.testBudget = { ...ATTRACTION_SPECS.chalet!, tier: 'budget', seasonOpen: ['summer'] };
    ATTRACTION_SPECS.testLux = { ...ATTRACTION_SPECS.chalet!, tier: 'luxury', amenity: 'pool', poolSlots: 6, appeal: tierAppeal(ATTRACTION_SPECS.chalet!.appeal, 'luxury') };
  }
  afterEach(() => { for (const id of ids) { delete BUILDINGS[id]; delete NIGHTLY_RATE[id]; delete ATTRACTION_SPECS[id]; } });

  it('tier multipliers: budget x0.6, standard x1, luxury x2.5 on rate and cap', () => {
    expect(LODGING_TIER_MULT).toEqual({ budget: 0.6, standard: 1, luxury: 2.5 });
    expect(tieredNightly({ price: 40, max: 150 }, 'budget')).toEqual({ price: 24, max: 90 });
    expect(tieredNightly({ price: 40, max: 150 }, 'standard')).toEqual({ price: 40, max: 150 });
    expect(tieredNightly({ price: 40, max: 150 }, 'luxury')).toEqual({ price: 100, max: 375 });
  });

  it('tier shifts the appeal: luxury draws VIPs, budget draws budget guests; chalet/apartment keep their vector', () => {
    const base = ATTRACTION_SPECS.chalet!.appeal;
    expect(tierAppeal(base, 'standard')).toEqual(base);
    expect(tierAppeal(base, 'luxury')[3]).toBeGreaterThan(base[3]);
    expect(tierAppeal(base, 'budget')[4]).toBeGreaterThan(base[4]);
    expect(ATTRACTION_SPECS.chalet!.tier).toBeUndefined();
    expect(ATTRACTION_SPECS.chalet!.seasonOpen).toBeUndefined();
  });

  it('nightly revenue follows the tier price', () => {
    register();
    const h = harness();
    h.state.date.day = dayOf('summer');
    const b = h.add('testLux');
    h.run(1);
    h.state.date.minute = 18 * 60 + 30;
    h.guest({ overnight: true, budget: 1000 });
    h.run(1);
    expect(h.econ.ledger.lodging).toBe(NIGHTLY_RATE.chalet!.price * 2.5);
    expect(h.sys.get(b.id)!.stats.nights).toBe(1);
  });

  it('a closed season blocks check-ins and reports "Closed for the season"; it reopens in season', () => {
    register();
    const h = harness();
    h.state.date.day = dayOf('winter');
    const b = h.add('testBudget');
    h.run(1);
    h.state.date.minute = 18 * 60 + 30;
    h.guest({ overnight: true });
    h.run(1);
    expect(h.sys.get(b.id)!.open).toBe(false);
    expect(h.sys.get(b.id)!.reason).toBe('Closed for the season');
    expect(h.econ.ledger.lodging).toBe(0);
    expect(h.sys.lodgingCapacity()).toBe(0);
    h.state.date.day = dayOf('summer'); h.state.date.minute = 18 * 60 + 30;
    h.run(1);
    expect(h.sys.get(b.id)!.open).toBe(true);
    expect(h.econ.ledger.lodging).toBe(Math.round(NIGHTLY_RATE.chalet!.price * 0.6));
  });

  it('pool amenity adds Using places for overnight guests and a happiness bonus', () => {
    register();
    const h = harness();
    h.state.date.day = dayOf('summer');
    const b = h.add('testLux');
    h.run(1);
    expect(h.sys.get(b.id)!.capacity()).toBe((ATTRACTION_SPECS.chalet!.slots ?? 4) + 6);
    const day = h.guest();
    expect(h.sys.canUse(b.id, day)).toBe(false);
    const g = h.guest({ overnight: true });
    h.store.happiness[g] = 0.5;
    expect(h.arrive(g, b)).toBe('using');
    h.run(20);
    expect(h.store.happiness[g]).toBeGreaterThan(0.5 + 0.05 + 0.05 - 1e-9);
  });
});
