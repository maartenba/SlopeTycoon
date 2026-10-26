import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '@/config/buildings';
import { makeResort, run } from '../game/harness';

const withWideParking = <T>(f: () => T): T => {
  const parking = BUILDINGS.parking!, cap0 = parking.capacity;
  (parking as { capacity: number }).capacity = cap0 * 12;
  try { return f(); } finally { (parking as { capacity: number }).capacity = cap0; }
};
const liftsIncome = (seed: number, set: (s: ReturnType<typeof makeResort>['sim']) => void, days = 12): { lifts: number; arrivals: number; sim: ReturnType<typeof makeResort>['sim'] } =>
  withWideParking(() => {
    const { sim } = makeResort(64, seed);
    set(sim);
    let arrivals = 0;
    sim.bus.on('guest:arrived', () => { arrivals++; });
    run(sim, { days, scanEvery: 4000 });
    return { lifts: sim.economy.ledger.lifts, arrivals, sim };
  });

describe('pricing wired into the sim', () => {
  it('attraction price menu writes the shared key, syncs instances and the inspector uses the same path', () => {
    const { sim } = makeResort(64, 1);
    sim.tick(1);
    const a = sim.attractions.all().find((x) => x.maxPrice > 0 && x.price > 0 && x.billing === 'perUse' && x.category === 'recreation')!;
    expect(a).toBeDefined();
    const type = a.b.type;
    sim.priceApi.set(type, 9);
    expect(sim.pricing.get(type)).toBe(9);
    expect(a.price).toBe(9);
    sim.priceApi.setForBuilding(a.id, 5);
    expect(sim.pricing.get(type)).toBe(5);
    sim.pricing.setSchedule('winter', 'off', 2); sim.pricing.setSchedule('winter', 'regular', 2); sim.pricing.setSchedule('winter', 'peak', 2);
    expect(a.unitPrice()).toBeCloseTo(10, 1);
  });
  it('arrival volume falls with price and is capped when giving passes away', () => {
    const { sim } = makeResort(64, 1);
    const d = sim.guestSim.spawner.pricingDemand!, mix = [1, 1, 1, 1, 1, 1];
    const base = d.volume(mix);
    sim.priceApi.set('dayPass', 9999);
    expect(d.volume(mix)).toBeLessThan(base * 0.5);
    sim.priceApi.setFree('dayPass', true);
    expect(d.volume(mix)).toBeLessThanOrEqual(1.6 * 1.15 + 1e-9);
  });
  it('profit: free passes earn nothing, cap-priced passes earn less than balanced', () => {
    const balanced = liftsIncome(1, () => {});
    const free = liftsIncome(1, (s) => s.priceApi.setFree('dayPass', true));
    const cap = liftsIncome(1, (s) => s.priceApi.set('dayPass', 9999));
    expect(free.lifts).toBe(0);
    expect(cap.lifts).toBeLessThan(balanced.lifts);
    expect(free.arrivals).toBeGreaterThan(balanced.arrivals * 0.9); // crowd, no revenue
  }, 120000);
  it('cheaper day pass draws more guests than an expensive one', () => {
    const cheap = liftsIncome(2, (s) => s.priceApi.set('dayPass', 25), 8);
    const dear = liftsIncome(2, (s) => s.priceApi.set('dayPass', 110), 8);
    expect(cheap.arrivals).toBeGreaterThan(dear.arrivals);
  }, 120000);
});
