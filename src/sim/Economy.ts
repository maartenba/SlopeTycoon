import { EXPENSE_CATEGORIES, LEDGER_CATEGORIES, type ExpenseCategory, type LedgerCategory } from '../config/prices';

/** Economy: all cash movement goes through here. Amounts are dollars rounded to whole cents; the ledger stores integer cents (no float drift). */
export interface MoneyHolder { money: number }

export type MoneyReason = 'charge' | 'refund' | 'earn' | 'spend' | 'deposit' | 'withdraw';
export interface MoneyInfo { reason: MoneyReason; category?: string }
export type MoneyListener = (money: number, delta: number, info: MoneyInfo) => void;

export type IncomeBuckets = Record<LedgerCategory, number>;
export type ExpenseBuckets = Record<ExpenseCategory, number>;
export interface Buckets { income: IncomeBuckets; expense: ExpenseBuckets }

/** One closed month, dollars. */
export interface MonthReport {
  year: number; month: number;
  income: IncomeBuckets; expense: ExpenseBuckets;
  incomeTotal: number; expenseTotal: number; net: number;
  cashEnd: number; guests: number; happiness: number; debt: number;
}
export interface MonthExtras { guests?: number; happiness?: number; debt?: number }

export const HISTORY_MONTHS = 24;

export const toCents = (d: number): number => Math.round(d * 100);
export const fromCents = (c: number): number => c / 100;

const zero = <K extends string>(keys: readonly K[]): Record<K, number> => Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
export const emptyBuckets = (): Buckets => ({ income: zero(LEDGER_CATEGORIES), expense: zero(EXPENSE_CATEGORIES) });
const sumOf = (r: Record<string, number>): number => { let t = 0; for (const k of Object.keys(r)) t += r[k]!; return t; };
const toDollars = <K extends string>(r: Record<K, number>): Record<K, number> => Object.fromEntries(Object.keys(r).map((k) => [k, fromCents(r[k as K])])) as Record<K, number>;

export class Economy {
  private total = emptyBuckets();
  private day = emptyBuckets();
  private month = emptyBuckets();
  private year = emptyBuckets();
  private history: MonthReport[] = [];
  private seasonHook: () => number = () => 1.0;
  private listeners: MoneyListener[] = [];
  private dayClosers: Array<() => void> = [];

  constructor(private state: MoneyHolder, onMoneyChanged?: MoneyListener) {
    if (onMoneyChanged) this.listeners.push(onMoneyChanged);
  }

  /** Lifetime revenue per income category (dollars). */
  get ledger(): IncomeBuckets { return toDollars(this.total.income); }
  /** Lifetime expenses per category (dollars). */
  get expenses(): ExpenseBuckets { return toDollars(this.total.expense); }

  onChange(fn: MoneyListener): void { this.listeners.push(fn); }

  /** Season hook (summer = 0.5 later). */
  setSeasonHook(fn: () => number): void { this.seasonHook = fn; }
  /** Construction cost multiplier; winter = 1.0 for now. */
  constructionMultiplier(): number { return this.seasonHook(); }

  /** Game over (bankrupt): the books are frozen; nothing can be bought or earned (read-only look at the resort). */
  locked = false;
  get money(): number { return this.state.money; }
  canAfford(cost: number): boolean { return !this.locked && toCents(cost) <= toCents(this.state.money); }

  private apply(cents: number, info: MoneyInfo): void {
    if (cents === 0 || this.locked) return;
    this.state.money = fromCents(toCents(this.state.money) + cents);
    for (const l of this.listeners) l(this.state.money, fromCents(cents), info);
  }
  private book(kind: 'income' | 'expense', cat: string, cents: number): void {
    if (this.locked) return;
    for (const b of [this.total, this.day, this.month, this.year]) (b[kind] as Record<string, number>)[cat]! += cents;
  }

  /** Deduct `cost` (construction by default); returns false (no change) if funds are insufficient. */
  charge(cost: number, category: ExpenseCategory = 'construction'): boolean {
    const c = toCents(cost);
    if (this.locked || c > toCents(this.state.money)) return false;
    if (c !== 0) { this.book('expense', category, c); this.apply(-c, { reason: 'charge', category }); }
    return true;
  }

  /** Forced expense (upkeep, wages, energy, interest): money may go negative. Returns the cents-rounded amount spent. */
  spend(category: ExpenseCategory, amount: number): number {
    const c = toCents(amount);
    if (c <= 0) return 0;
    this.book('expense', category, c);
    this.apply(-c, { reason: 'spend', category });
    return fromCents(c);
  }

  /** Give money back (e.g. demolition refund): offsets the expense `category` in the ledger. */
  refund(amount: number, category: ExpenseCategory = 'construction'): void {
    const c = toCents(amount);
    if (c === 0) return;
    this.book('expense', category, -c);
    this.apply(c, { reason: 'refund', category });
  }

  /** Record revenue in a ledger category and add it to cash. */
  earn(category: LedgerCategory, amount: number): void {
    const c = toCents(amount);
    if (c <= 0) return;
    this.book('income', category, c);
    this.apply(c, { reason: 'earn', category });
  }

  /** Non-ledger cash in (loan principal received). */
  deposit(amount: number, label = 'deposit'): void { const c = toCents(amount); if (c > 0) this.apply(c, { reason: 'deposit', category: label }); }
  /** Non-ledger cash out (loan principal repaid); may overdraw. */
  withdraw(amount: number, label = 'withdraw'): void { const c = toCents(amount); if (c > 0) this.apply(-c, { reason: 'withdraw', category: label }); }

  // ---- buckets ----
  dayBuckets(): { income: IncomeBuckets; expense: ExpenseBuckets } { return { income: toDollars(this.day.income), expense: toDollars(this.day.expense) }; }
  monthBuckets(): { income: IncomeBuckets; expense: ExpenseBuckets } { return { income: toDollars(this.month.income), expense: toDollars(this.month.expense) }; }
  yearBuckets(): { income: IncomeBuckets; expense: ExpenseBuckets } { return { income: toDollars(this.year.income), expense: toDollars(this.year.expense) }; }
  /** Net (income - expense) of the running month, dollars. */
  monthNet(): number { return fromCents(sumOf(this.month.income) - sumOf(this.month.expense)); }
  dayNet(): number { return fromCents(sumOf(this.day.income) - sumOf(this.day.expense)); }
  lifetimeIncome(): number { return fromCents(sumOf(this.total.income)); }
  lifetimeExpense(): number { return fromCents(sumOf(this.total.expense)); }

  /** Forget all books (new-game set-up: a pre-built sandbox resort is a gift and must not show as spending). */
  resetBooks(): void { this.total = emptyBuckets(); this.day = emptyBuckets(); this.month = emptyBuckets(); this.year = emptyBuckets(); this.history = []; }
  /** Reset the per-day bucket (call at day end). */
  closeDay(): void { for (const f of this.dayClosers) f(); this.day = emptyBuckets(); }
  /** Read-only observers called at day end BEFORE the day bucket is reset (the stats history). */
  onDayClosed(fn: () => void): void { this.dayClosers.push(fn); }
  /** Reset the per-year (YTD) bucket. */
  closeYear(): void { this.year = emptyBuckets(); }

  /** Close the running month into a report (ring of the last 24) and reset the month bucket. */
  closeMonth(year: number, month: number, extras: MonthExtras = {}): MonthReport {
    const inc = sumOf(this.month.income), exp = sumOf(this.month.expense);
    const r: MonthReport = {
      year, month, income: toDollars(this.month.income), expense: toDollars(this.month.expense),
      incomeTotal: fromCents(inc), expenseTotal: fromCents(exp), net: fromCents(inc - exp),
      cashEnd: this.state.money, guests: extras.guests ?? 0, happiness: extras.happiness ?? 0, debt: extras.debt ?? 0,
    };
    this.history.push(r);
    while (this.history.length > HISTORY_MONTHS) this.history.shift();
    this.month = emptyBuckets();
    return r;
  }

  reports(): readonly MonthReport[] { return this.history; }
  lastReport(): MonthReport | undefined { return this.history[this.history.length - 1]; }

  serialize(): unknown {
    return { total: this.total, day: this.day, month: this.month, year: this.year, history: this.history };
  }
  load(d: unknown): void {
    const o = d as { total: Buckets; day: Buckets; month: Buckets; year: Buckets; history: MonthReport[] };
    // Ledger categories added after a save was written (e.g. 'grant') are missing there: fill them with zero (no NaN bookkeeping).
    const fix = (b: Buckets): Buckets => ({ income: { ...zero(LEDGER_CATEGORIES), ...b.income }, expense: { ...zero(EXPENSE_CATEGORIES), ...b.expense } });
    this.total = fix(o.total); this.day = fix(o.day); this.month = fix(o.month); this.year = fix(o.year);
    this.history = o.history.map((r) => ({ ...r, income: { ...zero(LEDGER_CATEGORIES), ...r.income }, expense: { ...zero(EXPENSE_CATEGORIES), ...r.expense } }));
  }
}
