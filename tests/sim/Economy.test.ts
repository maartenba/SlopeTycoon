import { describe, expect, it } from 'vitest';
import { Economy } from '@/sim/Economy';
import { buildFinanceTable, formatSigned, monthSummary, sparklinePoints } from '@/ui/financeFormat';
import { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';

const make = (money = 1000) => {
  const state = { money };
  const bus = new EventBus<GameEvents>();
  const seen: GameEvents['money:changed'][] = [];
  bus.on('money:changed', (e) => seen.push(e));
  const e = new Economy(state, (m, d, info) => bus.emit('money:changed', { money: m, delta: d, reason: info.reason, category: info.category }));
  return { state, e, seen };
};

describe('Economy', () => {
  it('charge/refund/earn/spend emit money:changed with reason and category', () => {
    const { e, seen } = make();
    expect(e.charge(100)).toBe(true);
    e.refund(40);
    e.earn('lifts', 25);
    e.spend('energy', 10);
    expect(seen.map((s) => [s.reason, s.category, s.delta, s.money])).toEqual([
      ['charge', 'construction', -100, 900], ['refund', 'construction', 40, 940], ['earn', 'lifts', 25, 965], ['spend', 'energy', -10, 955],
    ]);
  });
  it('charge fails without funds; spend may overdraw', () => {
    const { e, state, seen } = make(50);
    expect(e.charge(60)).toBe(false);
    expect(state.money).toBe(50);
    expect(seen).toHaveLength(0);
    e.spend('upkeep', 80);
    expect(state.money).toBe(-30);
  });
  it('no float drift over 1,000 transactions', () => {
    const { e, state } = make(0);
    let cents = 0;
    for (let i = 0; i < 1000; i++) {
      const amt = 0.1 + (i % 7) * 0.01;
      if (i % 3 === 0) { e.spend('upkeep', amt); cents -= Math.round(amt * 100); } else { e.earn('shops', amt); cents += Math.round(amt * 100); }
    }
    expect(Math.round(state.money * 100)).toBe(cents);
    const b = e.monthBuckets();
    expect(Math.round((b.income.shops - b.expense.upkeep) * 100)).toBe(cents);
  });
  it('snowmaking category and energy spend are booked', () => {
    const { e } = make();
    e.spend('energy', 12); e.spend('snowmaking', 5);
    expect(e.dayBuckets().expense.energy).toBe(12);
    expect(e.dayBuckets().expense.snowmaking).toBe(5);
  });
  it('deposit/withdraw are not ledger entries', () => {
    const { e } = make();
    e.deposit(500, 'loan'); e.withdraw(200, 'loan');
    expect(e.monthNet()).toBe(0);
    expect(e.money).toBe(1300);
  });
  it('month close builds a report, ring keeps 24 months, buckets reset', () => {
    const { e } = make();
    for (let m = 0; m < 30; m++) { e.earn('lifts', 100 + m); e.spend('upkeep', 40); e.closeMonth(1 + Math.floor(m / 12), m % 12); }
    expect(e.reports()).toHaveLength(24);
    expect(e.reports()[23]!.net).toBe(129 - 40);
    expect(e.monthNet()).toBe(0);
  });
  it('serialises and restores the ledger', () => {
    const { e } = make();
    e.earn('rental', 33.5); e.closeMonth(1, 0); e.spend('staff', 7);
    const { e: f } = make();
    f.load(JSON.parse(JSON.stringify(e.serialize())));
    expect(f.reports()).toEqual(e.reports());
    expect(f.monthBuckets()).toEqual(e.monthBuckets());
  });
});

describe('finance table helpers match the ledger', () => {
  it('totals = sum of rows; ytd covers closed months + current', () => {
    const { e } = make();
    e.earn('lifts', 100); e.earn('passes', 50); e.spend('upkeep', 30); e.closeMonth(1, 0);
    e.earn('lifts', 10); e.spend('interest', 4);
    const t = buildFinanceTable(e);
    expect(t.incomeTotal.thisMonth).toBe(10);
    expect(t.incomeTotal.lastMonth).toBe(150);
    expect(t.incomeTotal.ytd).toBe(160);
    expect(t.expenseTotal.ytd).toBe(34);
    expect(t.net.ytd).toBe(126);
    expect(t.income.find((r) => r.key === 'lifts')).toMatchObject({ thisMonth: 10, lastMonth: 100, ytd: 110 });
    expect(t.net.ytd).toBeCloseTo(e.lifetimeIncome() - e.lifetimeExpense(), 9);
  });
  it('formatting', () => {
    expect(formatSigned(12340)).toBe('+$12,340');
    expect(formatSigned(-5)).toBe('-$5');
    expect(monthSummary({ month: 2, net: 12340 })).toBe('June: +$12,340');
    expect(sparklinePoints([1, 3], 10, 10)).toBe('0.0,10.0 10.0,0.0');
    expect(sparklinePoints([], 10, 10)).toBe('');
  });
});
