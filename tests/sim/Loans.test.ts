import { CAL } from '@/config/balance';
import { describe, expect, it } from 'vitest';
import { Economy } from '@/sim/Economy';
import { Loans, amortisationSchedule, annuityPayment, creditLetter, creditScore, debtCap, type CreditContext } from '@/sim/Loans';
import { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';

const ctx: CreditContext = { resortValue: 600000, rating: 3, annualRevenue: 0, monthlyNet: 100 };
const setup = (money = 10000) => {
  const state = { money };
  const bus = new EventBus<GameEvents>();
  const taken: GameEvents['loan:taken'][] = [];
  bus.on('loan:taken', (e) => taken.push(e));
  const economy = new Economy(state);
  return { state, economy, loans: new Loans(economy, bus), taken };
};

describe('amortisation', () => {
  it('schedule clears the balance exactly and interest matches the rate', () => {
    const rows = amortisationSchedule(10_000_00, 1200, 12); // $10,000 @ 12%
    expect(rows).toHaveLength(12);
    expect(rows[0]!.interest).toBe(Math.round(10000 * CAL)); // $100.00 per old 30-day month, halved in the 15-day month
    expect(rows[11]!.balance).toBe(0);
    expect(rows.reduce((a, r) => a + r.principal, 0)).toBe(10_000_00);
    expect(rows.reduce((a, r) => a + r.payment, 0)).toBeGreaterThan(10_000_00);
    expect(annuityPayment(10_000_00, 1200, 12)).toBe(86067); // annuity $860.67 (standard $888.49 at 1 %/month; the monthly rate is halved by the 15-day month)
  });
  it('zero-rate loans split evenly', () => {
    const rows = amortisationSchedule(1200_00, 0, 12);
    expect(rows.every((r) => r.interest === 0)).toBe(true);
    expect(rows[11]!.balance).toBe(0);
  });
});

describe('Loans', () => {
  it('take emits loan:taken with amount/rate/term and deposits cash', () => {
    const { loans, taken, state } = setup(0);
    const r = loans.take('small', ctx, { year: 1, month: 0 });
    expect(r.ok).toBe(true);
    expect(taken).toHaveLength(1);
    expect(taken[0]!.amount).toBe(state.money);
    expect(taken[0]!.termMonths).toBe(12);
    expect(taken[0]!.rate).toBeGreaterThanOrEqual(5);
    expect(taken[0]!.rate).toBeLessThanOrEqual(12);
    expect(taken[0]!.total).toBe(loans.totalDebt());
  });
  it('monthly payments follow the schedule; interest is an expense, principal is not; loan ends after term', () => {
    const { loans, economy, state } = setup(0);
    const r = loans.take('small', ctx, { year: 1, month: 0 });
    if (!r.ok) throw new Error('x');
    const sched = amortisationSchedule(r.loan.principal, r.loan.rateBp, 12);
    economy.deposit(100000);
    const start = state.money;
    let interestSum = 0;
    for (let i = 0; i < 12; i++) {
      const [p] = loans.monthly();
      expect(p!.paid).toBe(true);
      expect(Math.round(p!.interest * 100)).toBe(sched[i]!.interest);
      expect(Math.round(p!.principal * 100)).toBe(sched[i]!.principal);
      interestSum += p!.interest;
    }
    expect(loans.active()).toHaveLength(0);
    expect(economy.monthBuckets().expense.interest).toBeCloseTo(interestSum, 6);
    expect(start - state.money).toBeCloseTo(r.loan.principal / 100 + interestSum, 6);
  });
  it('early repay clears the balance and stops interest', () => {
    const { loans, economy, state } = setup(0);
    expect(loans.take('medium', { ...ctx, annualRevenue: 500000 }, { year: 1, month: 0 }).ok).toBe(true);
    economy.deposit(500000);
    loans.monthly();
    const bal = loans.totalDebt();
    const before = state.money;
    expect(loans.repay(1)).toBe(true);
    expect(before - state.money).toBeCloseTo(bal, 6);
    expect(loans.totalDebt()).toBe(0);
  });
  it('early repay fails without cash', () => {
    const { loans, state } = setup(0);
    loans.take('small', ctx, { year: 1, month: 0 });
    state.money = 5;
    expect(loans.repay(1)).toBe(false);
  });
  it('missed instalment is skipped and counted', () => {
    const { loans, state } = setup(0);
    loans.take('small', ctx, { year: 1, month: 0 });
    state.money = 1;
    const [p] = loans.monthly();
    expect(p!.paid).toBe(false);
    expect(loans.missed).toBe(1);
    expect(loans.active()[0]!.remainingMonths).toBe(12);
  });
  it('starter loan only once; debt cap and max-loan rules', () => {
    const { loans } = setup(0);
    expect(loans.take('starter', ctx, { year: 1, month: 0 }).ok).toBe(true);
    expect(loans.take('starter', ctx, { year: 1, month: 0 }).ok).toBe(false);
    const poor: CreditContext = { resortValue: 600000, rating: 3, annualRevenue: 0, monthlyNet: 0 };
    expect(debtCap(poor)).toBe(150000);
    expect(debtCap({ ...poor, annualRevenue: 1_000_000 })).toBe(2_000_000); // hard cap
    expect(debtCap({ ...poor, annualRevenue: 100_000 })).toBe(300_000);
    const l = setup(0).loans;
    l.take('large', poor, { year: 1, month: 0 });
    const big = l.offers(poor).find((o) => o.id === 'large')!;
    expect(big.available).toBe(false);
    expect(big.reason).toMatch(/cap/i);
  });
  it('credit rating moves the rate within 5..12%', () => {
    const { loans } = setup();
    const good = loans.offers({ ...ctx, rating: 5, monthlyNet: 10 }).find((o) => o.id === 'medium')!;
    const bad = loans.offers({ ...ctx, rating: 0, monthlyNet: -10 }).find((o) => o.id === 'medium')!;
    expect(good.ratePct).toBeLessThan(bad.ratePct);
    for (const o of [good, bad]) { expect(o.ratePct).toBeGreaterThanOrEqual(5); expect(o.ratePct).toBeLessThanOrEqual(12); }
    expect(creditLetter(creditScore({ ...ctx, rating: 5, monthlyNet: 10 }, 0))).toBe('A');
  });
  it('serialises', () => {
    const a = setup(0); a.loans.take('small', ctx, { year: 1, month: 0 });
    const b = setup(0); b.loans.load(JSON.parse(JSON.stringify(a.loans.serialize())));
    expect(b.loans.totalDebt()).toBe(a.loans.totalDebt());
  });
});
