import { describe, expect, it } from 'vitest';
import { ATTRACTION_SPECS } from '../../../src/sim/attractions';
import { BUILDINGS } from '../../../src/config/buildings';
import { PRICE_TABLE } from '../../../src/config/prices';
import { GState } from '../../../src/sim/guests/Guest';
import { seasonOf } from '../../../src/sim/Clock';
import { harness } from './harness';

const SERVED = Object.keys(ATTRACTION_SPECS).filter((t) => !ATTRACTION_SPECS[t]!.overnightOnly && t !== 'toilets' && t !== 'tackleHut' && !ATTRACTION_SPECS[t]!.tour); // toilets are free (own tests in tests/sim/comfort.test.ts); tour bases board in scheduled departures (tests/sim/attractions/tour.test.ts, quadTour.test.ts)

describe('registry covers the catalog', () => {
  it('every restaurant/shop/rental/lodging/recreation/kids/water item has a spec and a price entry', () => {
    for (const t of ['baseLodge', 'lodge', 'cafe', 'mountainHut', 'heatedTerrace', 'shop', 'rental', 'chalet', 'apartment', 'iceRink', 'stuntPark', 'adventurePark', 'playground', 'beach', 'boatRental', 'magicCarpet', 'kidsGround']) {
      expect(ATTRACTION_SPECS[t], t).toBeDefined();
      expect(BUILDINGS[t], t).toBeDefined();
      expect(PRICE_TABLE[t], t).toBeDefined();
    }
  });
});

describe.each(SERVED)('%s serves guests and earns revenue', (type) => {
  it('guest arrives, is served after the service time, pays in the right ledger category', () => {
    const h = harness();
    const so = ATTRACTION_SPECS[type]!.seasonOpen;
    if (so) for (let d = 0; d < 180; d++) if (so.includes(seasonOf({ day: d }))) { h.state.date.day = d + 2; break; } // seasonal attractions (petting zoo) are tested inside their season
    const b = h.add(type);
    h.run(1);
    const a = h.sys.get(b.id)!;
    expect(a.open).toBe(true);
    const g = h.guest();
    const budget0 = h.store.budget[g]!;
    expect(h.arrive(g, b)).toBe('using');
    expect(h.store.state[g]).toBe(GState.Using);
    expect(a.usersNow).toBe(1);
    const price = a.unitPrice();
    expect(price).toBeGreaterThan(0);
    h.run(a.serviceTime() + 2);
    expect(a.stats.served).toBe(1);
    expect(a.stats.revenue).toBeCloseTo(price);
    expect(h.econ.ledger[a.category]).toBeCloseTo(price);
    expect(h.store.budget[g]!).toBeCloseTo(budget0 - price);
    expect(h.store.state[g]).toBe(GState.Idle);
    expect(h.store.target[g]).toBe(0);
    if (a.spec.effects.hungerTo !== undefined) expect(h.store.hunger[g]!).toBeLessThanOrEqual(a.spec.effects.hungerTo + 0.0001);
    if (a.spec.effects.happiness) expect(h.store.happiness[g]!).toBeGreaterThan(0.8 - 1e-6);
  });
});

describe('billing', () => {
  it('ice rink and boats bill per hour of service, others per use', () => {
    const h = harness();
    const rink = h.sys.get(h.add('iceRink').id) ?? (h.run(1), h.sys.get(h.buildings[0]!.id)!);
    const boat = (h.add('boatRental', 20, 10), h.run(1), h.sys.get(h.buildings[1]!.id)!);
    expect(rink.billing).toBe('perHour');
    expect(rink.unitPrice()).toBe(PRICE_TABLE.iceRink!.price * 1);
    expect(boat.unitPrice()).toBeCloseTo(PRICE_TABLE.boatRental!.price * 1.5);
    rink.setPrice(1000);
    expect(rink.price).toBe(PRICE_TABLE.iceRink!.max);
  });
});

describe('rental gear', () => {
  it('a guest without gear gets it after a rental visit', () => {
    const h = harness();
    const b = h.add('rental');
    h.run(1);
    let g = -1, id = 0;
    for (let i = 0; i < 40 && g < 0; i++) { const s = h.guest(); if (h.sys.needsGear(h.store.id[s]!, 'ski')) { g = s; id = h.store.id[s]!; } }
    expect(g).toBeGreaterThanOrEqual(0);
    h.arrive(g, b);
    h.run(10);
    expect(h.sys.needsGear(id, 'ski')).toBe(false);
    expect(h.sys.needsGear(id, 'bike')).toBe(false);
    expect(h.econ.ledger.rental).toBeGreaterThan(0);
  });
});

describe('trail usage counters', () => {
  it('hiking and MTB uses are counted, MTB pays a pass', () => {
    const h = harness();
    const g = h.guest();
    h.sys.trail(g, 'hike', 5);
    h.sys.trail(g, 'bike', 5);
    h.sys.trail(g, 'bike', 5);
    expect(h.sys.trails.hiking.uses).toBe(1);
    expect(h.sys.trails.mtb.uses).toBe(2);
    expect(h.sys.trails.mtb.revenue).toBe(2 * PRICE_TABLE.mtbTrail!.price);
    expect(h.econ.ledger.recreation).toBe(2 * PRICE_TABLE.mtbTrail!.price);
  });
});

describe('staffing', () => {
  it('understaffed attractions have less capacity, extra staff serve faster, no staff = closed', () => {
    const h = harness();
    const b = h.add('rental'); // 2 staff, 8 slots
    h.run(1);
    const a = h.sys.get(b.id)!;
    expect(a.capacity()).toBe(8);
    a.setStaff(1);
    expect(a.capacity()).toBe(4);
    a.setStaff(4);
    expect(a.serviceTime()).toBeLessThan(a.spec.serviceTicks);
    expect(a.upkeepPerDay()).toBeGreaterThan(a.def.upkeep);
    a.setStaff(0);
    h.run(1);
    expect(a.open).toBe(false);
    expect(a.reason).toBe('Closed: no staff');
  });
  it('attractions without staff requirement ignore staff changes', () => {
    const h = harness();
    const b = h.add('beach'); h.run(1);
    const a = h.sys.get(b.id)!;
    a.setStaff(3);
    expect(a.staff).toBe(0);
    expect(a.capacity()).toBe(40);
  });
});

describe('persistence', () => {
  it('price, staff and stats round-trip', () => {
    const h = harness();
    const b = h.add('rental'); h.run(1);
    const a = h.sys.get(b.id)!;
    a.setPrice(33); a.setStaff(3); a.stats.served = 7;
    const data = JSON.parse(JSON.stringify(h.sys.asSystem().serialize!()));
    a.setPrice(1); a.stats.served = 0;
    h.sys.asSystem().load!(data);
    expect(h.sys.get(b.id)!.price).toBe(33);
    expect(h.sys.get(b.id)!.staff).toBe(3);
    expect(h.sys.get(b.id)!.stats.served).toBe(7);
  });
});
