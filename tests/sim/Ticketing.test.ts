import { PASS_PRICES } from '@/config/prices';
import { describe, expect, it } from 'vitest';
import { Economy } from '@/sim/Economy';
import { Pricing } from '@/sim/Pricing';
import { Ticketing } from '@/sim/Ticketing';

function fixture(office = false, demand = 50) {
  const state = { money: 0 };
  const economy = new Economy(state);
  const date = { year: 1, day: 300 };
  const budgets = new Map<number, number>();
  const pricing = new Pricing();
  const t = new Ticketing({
    economy, pricing, hasTicketOffice: () => office, date: () => date,
    budgetOf: (id) => budgets.get(id) ?? 0,
    adjustBudget: (id, d) => budgets.set(id, (budgets.get(id) ?? 0) + d),
    seasonDemand: () => demand,
  });
  return { state, economy, date, budgets, pricing, t };
}

describe('Ticketing', () => {
  it('without a ticket office the day pass is sold at first boarding, once per day', () => {
    const f = fixture(false);
    expect(f.t.ticketAtEntrance()).toBe(false);
    f.budgets.set(1, 200);
    f.t.onArrival(1, 0);
    expect(f.state.money).toBe(0);
    expect(f.t.canRide(1)).toBe(true);
    f.t.onBoard(1);
    f.t.onBoard(1);
    expect(f.state.money).toBe(45);
    expect(f.budgets.get(1)).toBe(155);
    expect(f.economy.dayBuckets().income.lifts).toBe(45);
    f.date.day++; f.t.newDay();
    f.t.onBoard(1);
    expect(f.state.money).toBe(90);
  });
  it('with a ticket office the pass is booked on arrival and boarding is free', () => {
    const f = fixture(true);
    expect(f.t.ticketAtEntrance()).toBe(true);
    f.budgets.set(2, 155);
    f.t.onArrival(2, 45);
    expect(f.state.money).toBe(45);
    f.t.onBoard(2);
    expect(f.state.money).toBe(45);
    expect(f.t.hasDayPass(2)).toBe(true);
  });
  it('guests who cannot afford the price are refused', () => {
    const f = fixture(false);
    f.budgets.set(3, 20);
    expect(f.t.canRide(3)).toBe(false);
    f.pricing.set('dayPass', 10);
    expect(f.t.canRide(3)).toBe(true);
  });
  it('prices read through Pricing (override + clamp)', () => {
    const f = fixture();
    f.pricing.set('dayPass', 9999);
    expect(f.t.dayPrice()).toBe(120);
    f.pricing.reset('dayPass');
    expect(f.t.dayPrice()).toBe(45);
  });
  it('season pass: upfront revenue under passes; holders ride free, spend less, return more', () => {
    const f = fixture(true);
    expect(f.t.holderSharePct()).toBe(0);
    f.t.onMonth(8);
    expect(f.t.sold).toBe(50);
    expect(f.economy.monthBuckets().income.passes).toBe(50 * PASS_PRICES.seasonPass.price);
    expect(f.t.holderSharePct()).toBe(Math.round((100 * 50) / 250));
    expect(f.t.returningHolders()).toBeGreaterThan(0);
    let holder = -1;
    for (let id = 1; id < 200 && holder < 0; id++) { f.budgets.set(id, 100); f.t.onArrival(id, 45); if (f.t.isHolder(id)) holder = id; }
    expect(holder).toBeGreaterThan(0);
    expect(f.budgets.get(holder)).toBeCloseTo(145 * 0.7, 6);
    const before = f.state.money;
    f.t.onBoard(holder);
    expect(f.state.money).toBe(before);
    expect(f.t.canRide(holder)).toBe(true);
  });
  it('serialise round trip is deterministic', () => {
    const f = fixture(true); f.t.onMonth(8); f.budgets.set(1, 100); f.t.onArrival(1, 45);
    const g = fixture(true); g.t.load(JSON.parse(JSON.stringify(f.t.serialize())));
    expect(JSON.stringify(g.t.serialize())).toBe(JSON.stringify(f.t.serialize()));
  });
});
