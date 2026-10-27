/** Pure text helpers for planned lift maintenance (Operations > Maintenance, lift inspector). Dates use the real calendar of sim/calendar.ts. */
import { DAYS_PER_YEAR } from '../config/balance';
import { REAL_MONTHS, formatGameDate } from '../sim/calendar';
import { formatMoney } from './format';

export type ServiceStateLabel = 'ok' | 'due' | 'overdue' | 'critical';

/** 'Sat 14 Apr · Y2' for an absolute sim day. */
export const maintDate = (abs: number): string => { const f = formatGameDate({ year: Math.floor(abs / DAYS_PER_YEAR), day: ((abs % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR }); return `${f.short} · Y${f.year}`; };

/** Select options for a service window: Auto plus the twelve real month names. */
export const windowOptions = (autoMonth: number): Array<{ value: string; label: string }> => [{ value: 'auto', label: `Auto (${REAL_MONTHS[autoMonth]})` }, ...REAL_MONTHS.map((m, i) => ({ value: String(i), label: m }))];

export const stateLabel = (s: ServiceStateLabel): string => (s === 'ok' ? 'Service up to date' : s === 'due' ? 'Service due soon' : s === 'overdue' ? 'SERVICE OVERDUE' : 'SERVICE LONG OVERDUE');

/** Cost / benefit line: "Skipping service: breakdown risk x2.1" once it is overdue, otherwise what servicing buys. */
export function benefitText(s: { state: ServiceStateLabel; riskMult: number; skipRiskMult: number; plan: { days: number; cost: number; level: string } }): string {
  const x = (n: number): string => `x${n.toFixed(1)}`;
  if (s.state === 'overdue' || s.state === 'critical') return `Overdue: breakdown risk ${x(s.riskMult)} now and rising. Service: ${s.plan.days} d closed, ${formatMoney(s.plan.cost)}, back to normal.`;
  return `Service (${s.plan.level}): ${s.plan.days} d closed, ${formatMoney(s.plan.cost)}, condition restored, risk down. Skipping service: breakdown risk ${x(s.skipRiskMult)} if 90 days late.`;
}
