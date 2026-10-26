import { EXPENSE_CATEGORIES, LEDGER_CATEGORIES } from '../config/prices';
import type { Economy, MonthReport } from '../sim/Economy';
import { formatMoney } from './format';

export interface FinanceRow { key: string; label: string; thisMonth: number; lastMonth: number; ytd: number }
export interface FinanceTable { income: FinanceRow[]; expense: FinanceRow[]; incomeTotal: FinanceRow; expenseTotal: FinanceRow; net: FinanceRow }

const label = (k: string): string => k.charAt(0).toUpperCase() + k.slice(1);
const sum = (r: Record<string, number>): number => Object.values(r).reduce((a, b) => a + b, 0);
const rnd = (n: number): number => Math.round(n * 100) / 100;

/** Per-category table (this month / last closed month / year to date). Totals are sums of the rows, so they always match the ledger. */
export function buildFinanceTable(econ: Economy): FinanceTable {
  const m = econ.monthBuckets(), y = econ.yearBuckets(), last = econ.lastReport();
  const rows = <K extends string>(keys: readonly K[], cur: Record<K, number>, ytd: Record<K, number>, prev: Record<K, number> | undefined): FinanceRow[] =>
    keys.map((k) => ({ key: k, label: label(k), thisMonth: cur[k], lastMonth: prev?.[k] ?? 0, ytd: ytd[k] }));
  const income = rows(LEDGER_CATEGORIES, m.income, y.income, last?.income);
  const expense = rows(EXPENSE_CATEGORIES, m.expense, y.expense, last?.expense);
  const tot = (key: string, lab: string, rs: FinanceRow[]): FinanceRow => ({
    key, label: lab, thisMonth: rnd(rs.reduce((a, r) => a + r.thisMonth, 0)), lastMonth: rnd(rs.reduce((a, r) => a + r.lastMonth, 0)), ytd: rnd(rs.reduce((a, r) => a + r.ytd, 0)),
  });
  const incomeTotal = tot('income', 'Total income', income), expenseTotal = tot('expense', 'Total expenses', expense);
  const net: FinanceRow = { key: 'net', label: 'Net', thisMonth: rnd(incomeTotal.thisMonth - expenseTotal.thisMonth), lastMonth: rnd(incomeTotal.lastMonth - expenseTotal.lastMonth), ytd: rnd(incomeTotal.ytd - expenseTotal.ytd) };
  return { income, expense, incomeTotal, expenseTotal, net };
}

export const formatSigned = (n: number): string => (Math.round(n) >= 0 ? '+' : '-') + formatMoney(Math.abs(n));
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
export const monthSummary = (r: Pick<MonthReport, 'month' | 'net'>): string => `${MONTH_NAMES[r.month]}: ${formatSigned(r.net)}`;

/** SVG polyline points string for a sparkline (values scaled into w×h, min..max). */
export function sparklinePoints(values: readonly number[], w: number, h: number): string {
  if (values.length === 0) return '';
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  return values.map((v, i) => `${values.length === 1 ? 0 : ((i / (values.length - 1)) * w).toFixed(1)},${(h - ((v - min) / span) * h).toFixed(1)}`).join(' ');
}

export { sum as sumValues };
