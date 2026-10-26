import { describe, expect, it } from 'vitest';
import { createGameState } from '@/core/GameState';
import { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { Economy } from '@/sim/Economy';
import { Finance } from '@/sim/Finance';
import { Loans } from '@/sim/Loans';
import { advanceDate, stateHashLike } from './financeHelpers';
import { createDefaultRegistry, stateHash } from '@/sim/Systems';
import { DAYS_PER_MONTH, DAYS_PER_YEAR } from '@/config/balance';

function setup(money = 100000, costs = { buildings: 100, lifts: 50, staff: 30 }) {
  const state = createGameState(1, 64, money);
  const bus = new EventBus<GameEvents>();
  const ev = { warn: [] as GameEvents['finance:bankruptcyWarning'][], debt: [] as GameEvents['finance:debtWarning'][], bankrupt: [] as GameEvents['finance:bankrupt'][], month: [] as GameEvents['finance:monthClosed'][] };
  bus.on('finance:bankruptcyWarning', (e) => ev.warn.push(e));
  bus.on('finance:bankrupt', (e) => ev.bankrupt.push(e));
  bus.on('finance:debtWarning', (e) => ev.debt.push(e));
  bus.on('finance:monthClosed', (e) => ev.month.push(e));
  const economy = new Economy(state);
  const loans = new Loans(economy, bus);
  const finance = new Finance({ economy, loans, bus, costs: () => costs, guests: () => ({ count: 10, happiness: 0.8 }) });
  return { state, economy, loans, finance, ev, bus };
}
const days = (s: ReturnType<typeof setup>, n: number, income = 0): void => {
  for (let i = 0; i < n; i++) { s.state.date.day += 1; if (s.state.date.day >= DAYS_PER_YEAR) { s.state.date.day = 0; s.state.date.year++; } if (income) s.economy.earn('shops', income); s.finance.update(s.state); }
};

describe('Finance', () => {
  it('charges upkeep/lift/staff daily and closes months correctly over a simulated year', () => {
    const s = setup(1_000_000);
    s.state.date.day = 0; s.finance.update(s.state);
    for (let d = 0; d < DAYS_PER_YEAR; d++) { s.economy.earn('lifts', 400); days(s, 1); }
    const rs = s.economy.reports();
    expect(rs.length).toBeGreaterThanOrEqual(11);
    for (const r of rs) {
      expect(r.net).toBeCloseTo(r.incomeTotal - r.expenseTotal, 6);
      expect(r.expense.upkeep).toBe(DAYS_PER_MONTH * 150);
      expect(r.expense.staff).toBe(DAYS_PER_MONTH * 30);
    }
    const sum = rs.reduce((a, r) => a + r.net, 0);
    expect(s.state.money - 1_000_000).toBeCloseTo(sum + s.economy.monthNet(), 4);
    expect(s.ev.month.length).toBe(rs.length);
    expect(rs[0]!.guests).toBe(10);
    // YTD resets at the year boundary
    expect(s.economy.yearBuckets().expense.upkeep).toBeLessThan(DAYS_PER_MONTH * 150 * 2);
  });
  it('month report includes loan interest and shows debt', () => {
    const s = setup(0, { buildings: 0, lifts: 0, staff: 0 });
    s.state.date.day = 0; s.finance.update(s.state);
    s.loans.take('small', { resortValue: 600000, rating: 3, annualRevenue: 0, monthlyNet: 1 }, { year: 1, month: 0 });
    s.economy.earn('lifts', 10000);
    days(s, DAYS_PER_MONTH);
    const r = s.economy.lastReport()!;
    expect(r.expense.interest).toBeGreaterThan(0);
    expect(r.debt).toBeGreaterThan(0);
    expect(r.debt).toBeLessThan(s.state.money + 1e9);
  });
  it('debt: negative cash does NOT end the game; warnings escalate; no bankrupt event for 90 days', () => {
    const s = setup(10, { buildings: 100, lifts: 0, staff: 0 });
    s.state.date.day = 0; s.finance.update(s.state);
    days(s, 1);
    expect(s.state.money).toBeLessThan(0);
    expect(s.finance.status).toBe('debt');
    expect(s.ev.debt[0]).toEqual({ money: s.state.money, negDays: 1, level: 1 });
    days(s, 89);
    expect(s.finance.status).toBe('debt');
    expect(s.finance.ended).toBe(false);
    expect(s.ev.bankrupt).toHaveLength(0);
    expect(s.ev.debt.map((e) => e.level)).toEqual(expect.arrayContaining([1, 2, 3]));
    expect(s.ev.debt.length).toBeLessThan(12); // low volume (warning every 15 days in the 180-day year)
  });
  it('overdraft interest is booked monthly on the negative balance', () => {
    const s = setup(0, { buildings: 100, lifts: 0, staff: 0 });
    s.state.date.day = 0; s.finance.update(s.state);
    days(s, 61);
    expect(s.economy.expenses.interest).toBeGreaterThan(0);
    expect(s.finance.overdraftInterest).toBeGreaterThan(0);
    // ~1.5 % of the (then) negative balance
    const first = s.economy.reports()[0]!;
    expect(first.expense.interest).toBeGreaterThan(0);
    expect(first.expense.interest).toBeLessThan(Math.abs(first.cashEnd) * 0.05);
  });
  it('no overdraft interest while solvent', () => {
    const s = setup(1_000_000, { buildings: 10, lifts: 0, staff: 0 });
    s.state.date.day = 0; s.finance.update(s.state);
    days(s, 65);
    expect(s.economy.expenses.interest).toBe(0);
  });
  it('declaring bankruptcy ends the game once, emits both events and freezes finance', () => {
    const s = setup(10, { buildings: 100, lifts: 0, staff: 0 });
    s.state.date.day = 0; s.finance.update(s.state);
    days(s, 5);
    const declared: GameEvents['finance:declaredBankrupt'][] = [];
    s.bus.on('finance:declaredBankrupt', (e) => declared.push(e));
    expect(s.finance.declareBankruptcy()).toBe(true);
    expect(s.finance.status).toBe('bankrupt');
    expect(s.finance.ended).toBe(true);
    expect(declared).toEqual([{ money: s.state.money, day: expect.any(Number), reason: 'declared' }]);
    expect(s.ev.bankrupt).toHaveLength(1);
    expect(s.finance.declareBankruptcy()).toBe(false);
    const m = s.state.money;
    days(s, 10);
    expect(s.state.money).toBe(m); // frozen
  });
  it('auto limit: deeply negative cash for AUTO days forecloses (off when 0)', () => {
    const mk = (autoDays: number) => {
      const state = createGameState(1, 64, -100000);
      const bus = new EventBus<GameEvents>();
      const economy = new Economy(state);
      const finance = new Finance({ economy, loans: new Loans(economy, bus), bus, costs: () => ({ buildings: 0, lifts: 0, staff: 0 }), autoBankruptcyDays: autoDays, autoBankruptcyFloor: 50000 });
      let reason = '';
      bus.on('finance:declaredBankrupt', (e) => { reason = e.reason; });
      return { state, finance, economy, reason: () => reason, bus, ev: null as never, loans: null as never };
    };
    const a = mk(20);
    a.state.date.day = 0; a.finance.update(a.state);
    for (let i = 0; i < 25; i++) { a.state.date.day++; a.finance.update(a.state); }
    expect(a.finance.status).toBe('bankrupt'); expect(a.reason()).toBe('auto');
    const off = mk(0);
    off.state.date.day = 0; off.finance.update(off.state);
    for (let i = 0; i < 150; i++) { off.state.date.day++; off.finance.update(off.state); }
    expect(off.finance.status).toBe('debt');
  });
  it('startup grace: no debt counting or interest in the first N days', () => {
    const state = createGameState(1, 64, -100);
    const economy = new Economy(state);
    const finance = new Finance({ economy, loans: new Loans(economy), costs: () => ({ buildings: 10, lifts: 0, staff: 0 }), startupGraceDays: 40 });
    state.date.day = 0; finance.update(state);
    for (let i = 0; i < 35; i++) { state.date.day++; finance.update(state); }
    expect(finance.negDays).toBe(0); expect(finance.status).toBe('ok');
    expect(economy.expenses.interest).toBe(0);
  });
  it('restructure offer only exists while cash is negative and bypasses the debt cap', () => {
    const s = setup(5000, { buildings: 0, lifts: 0, staff: 0 });
    const ctx = { resortValue: 100000, rating: 3, annualRevenue: 0, monthlyNet: 0 };
    expect(s.loans.offers(ctx).some((o) => o.id === 'restructure')).toBe(false);
    s.state.money = -30000;
    const off = s.loans.offers(ctx).find((o) => o.id === 'restructure')!;
    expect(off.available).toBe(true);
    expect(off.amount).toBeGreaterThanOrEqual(50000);
    const r = s.loans.take('restructure', ctx, { year: 1, month: 0 });
    expect(r.ok).toBe(true);
    expect(s.state.money).toBeGreaterThan(0);
  });
  it('recovering cash resets the counter', () => {
    const s = setup(10, { buildings: 100, lifts: 0, staff: 0 });
    s.state.date.day = 0; s.finance.update(s.state);
    days(s, 10);
    expect(s.finance.negDays).toBe(10);
    s.economy.earn('shops', 5000);
    days(s, 1);
    expect(s.finance.negDays).toBe(0);
    expect(s.finance.status).toBe('ok');
  });
  it('unpayable instalment is missed and the player stays in debt (no instant loss)', () => {
    const s = setup(0, { buildings: 0, lifts: 0, staff: 0 });
    s.state.date.day = 0; s.finance.update(s.state);
    s.loans.take('small', { resortValue: 600000, rating: 3, annualRevenue: 0, monthlyNet: 1 }, { year: 1, month: 0 });
    s.state.money = 1;
    days(s, DAYS_PER_MONTH);
    expect(s.loans.missed).toBe(1);
    expect(s.finance.status).not.toBe('bankrupt');
  });
  it('identical runs give identical serialised state', () => {
    const run = (): string => { const s = setup(5000); s.state.date.day = 0; s.finance.update(s.state); days(s, 100, 120); return JSON.stringify(s.finance.serialize()) + stateHashLike(s.state.money); };
    expect(run()).toBe(run());
  });
});
describe('Finance as the economy system', () => {
  it('registry hash is identical across identical runs and reflects the ledger', () => {
    const run = (earn: number): string => {
      const s = setup(5000);
      const reg = createDefaultRegistry(); reg.replace(s.finance);
      for (let i = 0; i < 4000; i++) { if (i % 50 === 0) s.economy.earn('shops', earn); reg.update(s.state, i); }
      return stateHash(s.state, reg);
    };
    expect(run(10)).toBe(run(10));
    expect(run(10)).not.toBe(run(11));
  });
});
void advanceDate;
