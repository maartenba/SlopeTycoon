import { DEBT, INSURANCE_PER_DAY_PER_1000_VALUE, LOAN_RULES, SUPPORT_LOAN } from '../config/prices';
import { CAL, DAYS_PER_MONTH, DAYS_PER_YEAR } from '../config/balance';
import type { GameState } from '../core/GameState';
import type { GameBus } from '../core/events';
import { monthIndex, seasonOf } from './Clock';
import type { Economy, MonthReport } from './Economy';
import type { CreditContext, Loans } from './Loans';
import type { SimSystem } from './Systems';
import type { Ticketing } from './Ticketing';

export interface DailyCosts { buildings: number; lifts: number; staff: number; /** Lift running energy (settled daily). */ energy?: number; /** Lift maintenance / repair / inspection work booked today. */ maintenance?: number }
export interface FinanceDeps {
  economy: Economy;
  loans: Loans;
  ticketing?: Ticketing;
  bus?: Pick<GameBus, 'emit'>;
  /** Daily upkeep/wage totals (dollars), supplied by the game from buildings/lifts/attractions. */
  costs(): DailyCosts;
  guests?(): { count: number; happiness: number };
  credit?(): CreditContext;
  /** Optional insurance premium (resort value based). */
  insurance?: boolean;
  /** No debt counting / overdraft interest during the first N days of a game (the player is still building). Default 0. */
  startupGraceDays?: number;
  /** Continuous days below -autoBankruptcyFloor before automatic bankruptcy; 0 = never. Default DEBT.autoBankruptcyDays. */
  autoBankruptcyDays?: number;
  autoBankruptcyFloor?: number;
}

/** ok: solvent; debt: cash < 0 (the player may keep playing); bankrupt: ended (declared or the automatic limit). */
export type FinanceStatus = 'ok' | 'debt' | 'bankrupt';

/** Day/month close + debt state machine. Registered as the 'economy' system. Negative cash is allowed; only declaring (or the very long auto limit) ends the game. */
export class Finance implements SimSystem {
  readonly id = 'economy';
  status: FinanceStatus = 'ok';
  /** Continuous days with negative cash. */
  negDays = 0;
  /** Continuous days below the auto-bankruptcy floor. */
  deepDays = 0;
  bankruptcies = 0;
  /** Why it ended ('declared' | 'auto'), once bankrupt. */
  endedBy: 'declared' | 'auto' | null = null;
  /** Total overdraft interest paid (dollars). */
  overdraftInterest = 0;
  private lastLevel = 0;
  private season: string = 'winter';
  private lastDay: number | null = null;
  private firstDay: number | null = null;
  private lastMonth = 0;
  private lastYear = 0;
  /** Kept for API compatibility. */
  readonly graceDays: number = LOAN_RULES.bankruptcyGraceDays;

  constructor(private d: FinanceDeps) {}

  /** True when the game is over (bankrupt). Sim systems may use it to freeze. */
  get ended(): boolean { return this.status === 'bankrupt'; }
  get inDebt(): boolean { return this.status === 'debt'; }
  private get autoDays(): number { return this.d.autoBankruptcyDays ?? DEBT.autoBankruptcyDays; }
  private get autoFloor(): number { return this.d.autoBankruptcyFloor ?? DEBT.autoBankruptcyFloor; }
  /** 0..1 how deep in debt (rating penalty input): ramps over DEBT.ratingPenaltyDays. */
  debtSeverity(): number { return this.status === 'debt' ? Math.min(1, 0.25 + this.negDays / DEBT.ratingPenaltyDays) : 0; }
  /** Construction is blocked while in debt (Economy.charge refuses anything above cash). */
  canBuild(): boolean { return this.d.economy.money >= 0 && this.status !== 'bankrupt'; }

  update(state: GameState): void {
    if (this.status === 'bankrupt') return;
    const abs = state.date.year * DAYS_PER_YEAR + state.date.day;
    const month = monthIndex(state.date);
    this.season = seasonOf(state.date);
    if (this.season === 'winter') this.d.loans.expireSupport();
    if (this.lastDay === null) { this.lastDay = abs; this.firstDay = abs; this.lastMonth = month; this.lastYear = state.date.year; return; }
    while (this.lastDay < abs) {
      this.lastDay++;
      this.endDay();
      const dayOfYear = this.lastDay % DAYS_PER_YEAR, yr = Math.floor(this.lastDay / DAYS_PER_YEAR);
      const m = Math.floor(dayOfYear / DAYS_PER_MONTH);
      if (dayOfYear % DAYS_PER_MONTH === 0) this.endMonth(this.lastYear, this.lastMonth, m, yr);
      if (this.ended) return;
    }
  }

  /** Day end: charge upkeep, wages, energy, maintenance, optional insurance; update the debt counters. */
  endDay(): void {
    const e = this.d.economy, c = this.d.costs();
    e.spend('upkeep', c.buildings + c.lifts);
    e.spend('staff', c.staff);
    if (c.energy) e.spend('energy', c.energy);
    if (c.maintenance) e.spend('maintenance', c.maintenance);
    if (this.d.insurance && this.d.credit) e.spend('insurance', (this.d.credit().resortValue / 1000) * INSURANCE_PER_DAY_PER_1000_VALUE);
    e.closeDay();
    this.d.ticketing?.newDay();
    this.checkDebt();
  }

  private inGrace(): boolean { return this.firstDay !== null && (this.lastDay ?? 0) - this.firstDay < (this.d.startupGraceDays ?? 0); }

  private checkDebt(): void {
    if (this.status === 'bankrupt') return;
    const money = this.d.economy.money;
    if (this.inGrace()) return;
    if (money >= 0) { this.negDays = 0; this.deepDays = 0; this.lastLevel = 0; this.status = 'ok'; return; }
    this.status = 'debt';
    this.negDays++;
    // Tourism Board support: the first negative-cash moment in summer/autumn opens a one-time interest-free offer (Loans panel)
    if (SUPPORT_LOAN.seasons.includes(this.season)) this.d.loans.offerSupport();
    this.deepDays = money < -this.autoFloor ? this.deepDays + 1 : 0;
    const level: 1 | 2 | 3 = this.negDays >= Math.round(30 * CAL) ? 3 : this.negDays >= 7 ? 2 : 1;
    if (level !== this.lastLevel || this.negDays % DEBT.warnEveryDays === 0) this.d.bus?.emit('finance:debtWarning', { money, negDays: this.negDays, level });
    this.lastLevel = level;
    if (this.autoDays > 0) {
      const left = Math.max(0, this.autoDays - this.deepDays);
      if (this.deepDays > 0 && left <= Math.round(30 * CAL) && left % 5 === 0 && left > 0) this.d.bus?.emit('finance:bankruptcyWarning', { money, daysLeft: left });
      if (this.deepDays >= this.autoDays) this.bankrupt('auto');
    }
  }

  private bankrupt(reason: 'declared' | 'auto'): void {
    if (this.status === 'bankrupt') return;
    this.status = 'bankrupt'; this.endedBy = reason; this.bankruptcies++;
    const money = this.d.economy.money, day = this.lastDay ?? 0;
    this.d.bus?.emit('finance:declaredBankrupt', { money, day, reason });
    this.d.bus?.emit('finance:bankrupt', { money, day });
  }

  /** The player gives up: the game ends (UI shows the end screen). */
  declareBankruptcy(): boolean {
    if (this.status === 'bankrupt') return false;
    this.bankrupt('declared');
    return true;
  }

  /** Month end: instalments, report, YTD rollover, season-pass sale in the new month. */
  endMonth(prevYear: number, prevMonth: number, newMonth: number, newYear: number): MonthReport {
    const e = this.d.economy;
    this.d.loans.monthly();
    if (e.money < 0 && !this.inGrace()) { // overdraft interest on the negative balance
      const interest = e.spend('interest', -e.money * DEBT.overdraftRateMonthly);
      this.overdraftInterest += interest;
    }
    const g = this.d.guests?.() ?? { count: 0, happiness: 0 };
    const r = e.closeMonth(prevYear, prevMonth, { guests: g.count, happiness: g.happiness, debt: this.d.loans.totalDebt() });
    this.d.bus?.emit('finance:monthClosed', { year: prevYear, month: prevMonth, net: r.net, income: r.incomeTotal, expense: r.expenseTotal });
    if (newYear !== prevYear) e.closeYear();
    this.lastMonth = newMonth; this.lastYear = newYear;
    this.d.ticketing?.onMonth(newMonth);
    return r;
  }

  /** Sandbox: keep looking at a bankrupt resort. Status stays 'bankrupt' (read-only); this only clears the dialog state. */
  continueAfterBankruptcy(): void { /* intentionally keeps status = bankrupt */ }

  serialize(): unknown {
    return {
      status: this.status, negDays: this.negDays, deepDays: this.deepDays, endedBy: this.endedBy, overdraftInterest: this.overdraftInterest, bankruptcies: this.bankruptcies, lastDay: this.lastDay, firstDay: this.firstDay, lastMonth: this.lastMonth, lastYear: this.lastYear,
      economy: this.d.economy.serialize(), loans: this.d.loans.serialize(), ticketing: this.d.ticketing?.serialize(),
    };
  }
  load(data: unknown): void {
    const o = data as { status: FinanceStatus | 'warning'; deepDays?: number; endedBy?: 'declared' | 'auto' | null; overdraftInterest?: number; negDays: number; bankruptcies: number; lastDay: number | null; firstDay?: number | null; lastMonth: number; lastYear: number; economy: unknown; loans: unknown; ticketing?: unknown };
    this.status = o.status === 'warning' ? 'debt' : o.status; this.negDays = o.negDays; this.deepDays = o.deepDays ?? 0; this.endedBy = o.endedBy ?? null; this.overdraftInterest = o.overdraftInterest ?? 0; this.bankruptcies = o.bankruptcies; this.lastDay = o.lastDay; this.firstDay = o.firstDay ?? o.lastDay; this.lastMonth = o.lastMonth; this.lastYear = o.lastYear;
    this.d.economy.load(o.economy); this.d.loans.load(o.loans);
    if (o.ticketing) this.d.ticketing?.load(o.ticketing);
  }
}
