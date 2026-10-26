import type { Loan, Offer } from '@/sim/Loans';
import { formatMoney } from '../format';
import { StElement } from './StElement';

export interface LoansApi {
  offers(): Offer[];
  active(): readonly Loan[];
  take(id: Offer['id']): string | null;
  repay(id: number): boolean;
  creditLabel(): string;
  maxDebt(): number;
  debt(): number;
}

const css = `
:host{display:block;flex:1;min-width:0}
.wrap{display:flex;flex-direction:column;gap:6px;max-height:min(34vh,340px);overflow:auto}
.row{display:flex;gap:8px;align-items:center;font-size:11px}.row span{flex:1}
h4{margin:2px 0;font-size:12px;color:#ffd070}
.msg{color:#ff9a8a;font-size:11px}
`;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/** Loans panel: bank offers, active loans, repay buttons. */
export class StLoans extends StElement {
  private api: LoansApi | null = null;
  private wrap = el('div', 'wrap');
  private msg = '';
  private pending = false;

  protected css(): string { return css; }
  constructor() { super(); this.root.appendChild(this.wrap); }

  bind(api: LoansApi): void { this.api = api; this.refresh(); }
  requestRefresh(): void {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => { this.pending = false; this.refresh(); });
  }

  refresh(): void {
    const a = this.api;
    if (!a) return;
    const out: HTMLElement[] = [el('div', 'small', `Credit rating ${a.creditLabel()} · Debt ${formatMoney(a.debt())} / ${formatMoney(a.maxDebt())}`)];
    out.push(el('h4', '', 'Bank offers'));
    for (const o of a.offers()) {
      const r = el('div', 'row'), b = el('button', '', 'Take');
      b.disabled = !o.available;
      b.title = o.reason ?? '';
      b.addEventListener('click', () => { this.msg = a.take(o.id) ?? ''; this.refresh(); });
      r.append(el('span', '', `${o.name}: ${formatMoney(o.amount)} · ${o.ratePct}% · ${o.termMonths} mo · ${formatMoney(o.monthlyPayment)}/mo${o.reason ? ` (${o.reason})` : ''}`), b);
      out.push(r);
    }
    out.push(el('h4', '', 'Active loans'));
    const act = a.active();
    if (act.length === 0) out.push(el('div', 'small', 'None'));
    for (const l of act) {
      const r = el('div', 'row'), b = el('button', '', 'Repay');
      b.addEventListener('click', () => { this.msg = a.repay(l.id) ? '' : 'Not enough cash to repay'; this.refresh(); });
      r.append(el('span', '', `#${l.id}: ${formatMoney(l.balance / 100)} left · ${l.rateBp / 100}% · ${l.remainingMonths} mo · ${formatMoney(l.instalment / 100)}/mo`), b);
      out.push(r);
    }
    if (this.msg) out.push(el('div', 'msg', this.msg));
    this.wrap.replaceChildren(...out);
  }
}
