import { CAL } from '../config/balance';
import { DEBT, LOAN_OFFERS, LOAN_RULES, SUPPORT_LOAN, type LoanOfferDef } from '../config/prices';
import type { GameBus } from '../core/events';
import type { Economy } from './Economy';

/** Everything the bank looks at (supplied by the game; pure numbers so sim stays testable). */
export interface CreditContext {
  /** Replacement value of buildings + lifts. */
  resortValue: number;
  /** Resort rating 0..5. */
  rating: number;
  /** Trailing 12-month revenue. */
  annualRevenue: number;
  /** Trailing month net (profit > 0 helps). */
  monthlyNet: number;
}

export interface Loan {
  id: number;
  /** Cents. */
  principal: number; balance: number; instalment: number;
  /** Annual rate, basis points (e.g. 800 = 8%). */
  rateBp: number;
  termMonths: number; remainingMonths: number;
  takenYear: number; takenMonth: number;
}
export interface Offer { id: LoanOfferDef['id']; name: string; amount: number; ratePct: number; termMonths: number; monthlyPayment: number; available: boolean; reason?: string }
export interface ScheduleRow { n: number; payment: number; interest: number; principal: number; balance: number }

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

/** Annuity instalment in cents (rounded up to a cent so the last payment is never larger than the rest). */
export function annuityPayment(principalCents: number, rateBp: number, months: number): number {
  const r = (rateBp / 10000 / 12) * CAL;
  if (months <= 0) return principalCents;
  if (r === 0) return Math.ceil(principalCents / months);
  return Math.ceil((principalCents * r) / (1 - Math.pow(1 + r, -months)));
}

/** Full amortisation schedule in cents (final row clears the balance exactly). */
export function amortisationSchedule(principalCents: number, rateBp: number, months: number): ScheduleRow[] {
  const pmt = annuityPayment(principalCents, rateBp, months);
  const rows: ScheduleRow[] = [];
  let bal = principalCents;
  for (let n = 1; n <= months && bal > 0; n++) {
    const interest = Math.round((bal * rateBp * CAL) / 120000);
    let principal = pmt - interest;
    if (n === months || principal > bal) principal = bal;
    bal -= principal;
    rows.push({ n, payment: principal + interest, interest, principal, balance: bal });
  }
  return rows;
}

/** 0..1 credit score. */
export function creditScore(c: CreditContext, debt: number): number {
  const cap = debtCap(c);
  return clamp(0.3 + 0.1 * c.rating + (c.monthlyNet > 0 ? 0.2 : 0) - 0.2 * Math.min(1, debt / Math.max(1, cap)), 0, 1);
}
export const creditLetter = (s: number): string => (s >= 0.8 ? 'A' : s >= 0.6 ? 'B' : s >= 0.4 ? 'C' : 'D');
/** Maximum total outstanding principal (dollars): ≥ fixed cap, 3× annual revenue otherwise, hard-capped. */
export function debtCap(c: CreditContext): number {
  return Math.min(LOAN_RULES.hardCap, Math.max(LOAN_RULES.fixedDebtCap, LOAN_RULES.revenueMultiple * c.annualRevenue));
}

export interface PaymentResult { loanId: number; paid: boolean; interest: number; principal: number }

/** Bank loans. Cash movement goes through Economy (interest = expense; principal = non-ledger withdraw). */
export class Loans {
  private loans: Loan[] = [];
  private nextId = 1;
  private everTaken = false;
  /** Instalments missed this/last close (cleared when all paid). */
  missed = 0;
  /** Difficulty: multiplier on the offered interest rate (clamped to the loan rules). */
  rateMult = 1;
  /** Scenario modifier: the bank refuses every new loan. */
  disabled = false;
  /** Tourism Board support loan: 'none' (never offered), 'open' (on offer), 'taken', 'expired' (winter came first). Once per game. */
  supportState: 'none' | 'open' | 'taken' | 'expired' = 'none';

  constructor(private economy: Economy, private bus?: Pick<GameBus, 'emit'>) {}

  active(): readonly Loan[] { return this.loans; }
  /** Outstanding principal, dollars. */
  totalDebt(): number { return this.loans.reduce((a, l) => a + l.balance, 0) / 100; }
  monthlyObligation(): number { return this.loans.reduce((a, l) => a + Math.min(l.instalment, l.balance + Math.round((l.balance * l.rateBp * CAL) / 120000)), 0) / 100; }

  offers(c: CreditContext): Offer[] {
    const debt = this.totalDebt();
    const score = creditScore(c, debt);
    const scale = clamp(0.5 + c.resortValue / 600000 + c.rating * 0.1, 0.5, 4);
    const cap = debtCap(c);
    const list: Offer[] = LOAN_OFFERS.map((o) => {
      const starter = o.id === 'starter';
      const amount = starter ? o.baseAmount : Math.round((o.baseAmount * scale) / 1000) * 1000;
      const ratePct = clamp(Math.round((o.baseRatePct + (0.5 - score) * 4) * this.rateMult * 100) / 100, LOAN_RULES.minRatePct * Math.min(1, this.rateMult), LOAN_RULES.maxRatePct * Math.max(1, this.rateMult));
      const pay = annuityPayment(amount * 100, Math.round(ratePct * 100), o.termMonths) / 100;
      let reason: string | undefined;
      if (this.disabled) reason = 'No loans in this scenario';
      else if (starter && this.everTaken) reason = 'Starter loan already used';
      else if (this.loans.length >= LOAN_RULES.maxLoans) reason = `Max ${LOAN_RULES.maxLoans} loans`;
      else if (debt + amount > cap) reason = `Debt cap $${cap.toLocaleString('en-US')} exceeded`;
      return { id: o.id, name: o.name, amount, ratePct, termMonths: o.termMonths, monthlyPayment: pay, available: reason === undefined, reason };
    });
    // Off-season support loan: only while the offer is open (see offerSupport); free, 12 months, ignores the debt cap.
    if (this.supportState === 'open' && !this.disabled) {
      const amount = this.supportAmount();
      const reason = this.loans.length >= LOAN_RULES.maxLoans ? `Max ${LOAN_RULES.maxLoans} loans` : undefined;
      list.push({ id: 'support', name: SUPPORT_LOAN.name, amount, ratePct: SUPPORT_LOAN.ratePct, termMonths: SUPPORT_LOAN.termMonths, monthlyPayment: annuityPayment(amount * 100, 0, SUPPORT_LOAN.termMonths) / 100, available: reason === undefined, reason });
    }
    // Debt restructuring: only offered while cash is negative; covers the hole + a buffer; ignores the debt cap (but not the loan count).
    if (this.economy.money < 0) {
      const amount = Math.ceil((-this.economy.money + 20000) / 1000) * 1000;
      const pay = annuityPayment(amount * 100, DEBT.restructureRatePct * 100, DEBT.restructureTermMonths) / 100;
      const reason = this.loans.length >= LOAN_RULES.maxLoans ? `Max ${LOAN_RULES.maxLoans} loans` : undefined;
      list.push({ id: 'restructure', name: 'Restructure debt', amount, ratePct: DEBT.restructureRatePct, termMonths: DEBT.restructureTermMonths, monthlyPayment: pay, available: reason === undefined, reason });
    }
    return list;
  }

  /** Size of the support loan: the hole plus a buffer, between its min and max. */
  supportAmount(): number {
    const need = Math.ceil((Math.max(0, -this.economy.money) + SUPPORT_LOAN.buffer) / 5000) * 5000;
    return Math.min(SUPPORT_LOAN.maxAmount, Math.max(SUPPORT_LOAN.minAmount, need));
  }
  /** Open the one-time support offer (first negative-cash moment in a qualifying season). Returns true when it newly opened. */
  offerSupport(): boolean { if (this.supportState !== 'none' || this.disabled) return false; this.supportState = 'open'; return true; }
  /** The qualifying season is over: an unused offer lapses. */
  expireSupport(): void { if (this.supportState === 'open') this.supportState = 'expired'; }
  get supportOpen(): boolean { return this.supportState === 'open'; }

  take(id: Offer['id'], c: CreditContext, date: { year: number; month: number }): { ok: true; loan: Loan } | { ok: false; reason: string } {
    if (this.disabled) return { ok: false, reason: 'No loans in this scenario' };
    const o = this.offers(c).find((x) => x.id === id);
    if (!o) return { ok: false, reason: 'Unknown offer' };
    if (!o.available) return { ok: false, reason: o.reason ?? 'Unavailable' };
    const rateBp = Math.round(o.ratePct * 100);
    const principal = o.amount * 100;
    const loan: Loan = {
      id: this.nextId++, principal, balance: principal, instalment: annuityPayment(principal, rateBp, o.termMonths), rateBp,
      termMonths: o.termMonths, remainingMonths: o.termMonths, takenYear: date.year, takenMonth: date.month,
    };
    this.loans.push(loan);
    if (id === 'support') this.supportState = 'taken'; else this.everTaken = true;
    this.economy.deposit(o.amount, 'loan');
    this.bus?.emit('loan:taken', { amount: o.amount, total: this.totalDebt(), rate: o.ratePct, termMonths: o.termMonths });
    return { ok: true, loan };
  }

  /** Scenario start: a pre-existing loan (not offered by the bank, no credit check). `amount` in dollars. */
  grantStartingDebt(amount: number, ratePct: number, termMonths: number, date: { year: number; month: number }): Loan {
    const rateBp = Math.round(ratePct * 100), principal = Math.round(amount * 100);
    const loan: Loan = { id: this.nextId++, principal, balance: principal, instalment: annuityPayment(principal, rateBp, termMonths), rateBp, termMonths, remainingMonths: termMonths, takenYear: date.year, takenMonth: date.month };
    this.loans.push(loan); this.everTaken = true;
    return loan;
  }

  /** Monthly instalment for every loan; unaffordable instalments are skipped (missed). */
  monthly(): PaymentResult[] {
    const out: PaymentResult[] = [];
    let anyMissed = false;
    for (const l of [...this.loans]) {
      const interest = Math.round((l.balance * l.rateBp * CAL) / 120000);
      let principal = l.instalment - interest;
      if (l.remainingMonths <= 1 || principal > l.balance) principal = l.balance;
      const pay = principal + interest;
      if (!this.economy.canAfford(pay / 100)) { anyMissed = true; out.push({ loanId: l.id, paid: false, interest: 0, principal: 0 }); continue; }
      this.economy.spend('interest', interest / 100);
      this.economy.withdraw(principal / 100, 'loan');
      l.balance -= principal; l.remainingMonths--;
      out.push({ loanId: l.id, paid: true, interest: interest / 100, principal: principal / 100 });
      if (l.balance <= 0) this.loans = this.loans.filter((x) => x !== l);
    }
    this.missed = anyMissed ? this.missed + 1 : 0;
    return out;
  }

  /** Repay the full outstanding balance now (no penalty). */
  repay(loanId: number): boolean {
    const l = this.loans.find((x) => x.id === loanId);
    if (!l || !this.economy.canAfford(l.balance / 100)) return false;
    this.economy.withdraw(l.balance / 100, 'loan');
    this.loans = this.loans.filter((x) => x !== l);
    return true;
  }

  serialize(): unknown { return { loans: this.loans, nextId: this.nextId, everTaken: this.everTaken, missed: this.missed, support: this.supportState }; }
  load(d: unknown): void {
    const o = d as { loans: Loan[]; nextId: number; everTaken: boolean; missed: number; support?: Loans['supportState'] };
    this.loans = o.loans; this.nextId = o.nextId; this.everTaken = o.everTaken; this.missed = o.missed; this.supportState = o.support ?? 'none';
  }
}
