import type { Economy } from '@/sim/Economy';
import { buildFinanceTable, formatSigned, MONTH_NAMES, sparklinePoints, type FinanceRow } from '../financeFormat';
import { formatMoney } from '../format';
import { StElement } from './StElement';

export interface FinanceApi {
  economy: Economy; debt(): number; guests?(): number;
  /** Debt model: 'debt' = cash below zero (play on), 'bankrupt' = ended. */
  status?(): { status: 'ok' | 'debt' | 'bankrupt'; negDays: number };
  /** Declare bankruptcy (the UI asks for confirmation first). */
  declare?(): void;
  /** Resort of the Year reports (M5.3): past reports with their covers; `open` shows the report dialog. */
  reports?: { list(): YearReportRow[]; open(year: number): void };
}
export interface YearReportRow { year: number; headline: string; profit: number; guests: number; rating: number; cover?: string; isNew: boolean }
type Tab = 'overview' | 'table' | 'history' | 'reports';
const TABS: ReadonlyArray<[Tab, string]> = [['overview', 'Overview'], ['table', 'Income / Expenses'], ['history', 'History'], ['reports', 'Reports']];

const css = `
:host{display:block;flex:1;min-width:0}
.wrap{display:flex;flex-direction:column;gap:6px;max-height:min(34vh,340px);overflow:auto}
.tabs{display:flex;gap:3px;flex-wrap:wrap}
.tabs button{padding:2px 6px;font-size:12px;white-space:nowrap}
table{border-collapse:collapse;width:100%;font-size:11px}
th,td{padding:2px 6px;text-align:right;border-bottom:1px solid #3a4a60}
th:first-child,td:first-child{text-align:left}
tr.tot td{font-weight:700;border-top:1px solid #8aa}
.pos{color:#8fe08f}.neg{color:#ff9a8a}
.banner{background:#4a1c1c;border:1px solid #ff6a5a;border-radius:4px;padding:4px 8px;font-size:11px}
button.danger{background:#7a2a2a;border-color:#ff6a5a}
.cards{display:flex;gap:12px;flex-wrap:wrap}
.card{display:flex;flex-direction:column;gap:2px}.card b{font-size:15px}
svg{background:rgba(255,255,255,.05);border-radius:4px}
.reports{display:flex;flex-direction:column;gap:4px}
button.rep{display:flex;gap:8px;align-items:center;text-align:left;padding:3px 6px;font-weight:400}
button.rep .th{flex:0 0 64px;height:36px;border-radius:4px;background:linear-gradient(#2c5c94,#9cc4e6) center/cover no-repeat}
button.rep .tx{display:flex;flex-direction:column;min-width:0}
`;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const signCls = (n: number): string => (Math.round(n) < 0 ? 'neg' : 'pos');

/** Finance panel: Overview (cash, month net, sparkline, debt), per-category table, history chart. */
export class StFinance extends StElement {
  private api: FinanceApi | null = null;
  private tab: Tab = 'overview';
  private wrap = el('div', 'wrap');
  private pending = false;

  protected css(): string { return css; }
  constructor() { super(); this.root.appendChild(this.wrap); }

  bind(api: FinanceApi): void { this.api = api; this.refresh(); }

  /** Coalesced (once per animation frame) re-render. */
  requestRefresh(): void {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => { this.pending = false; this.refresh(); });
  }

  refresh(): void {
    const a = this.api;
    if (!a) return;
    const tabs = el('div', 'tabs');
    for (const [id, name] of TABS) {
      if (id === 'reports' && !a.reports) continue;
      const fresh = id === 'reports' && a.reports!.list().some((r) => r.isNew);
      const b = el('button', id === this.tab ? 'active' : '', fresh ? `${name} \u2022` : name);
      b.dataset.tab = id;
      b.addEventListener('click', () => { this.tab = id; this.refresh(); });
      tabs.appendChild(b);
    }
    const body = this.tab === 'overview' ? this.overview(a) : this.tab === 'table' ? this.table(a) : this.tab === 'reports' ? this.reports(a) : this.history(a);
    this.wrap.replaceChildren(tabs, body);
  }

  private overview(a: FinanceApi): HTMLElement {
    const e = a.economy, box = el('div');
    const cards = el('div', 'cards');
    const card = (t: string, v: string, cls = ''): HTMLElement => { const c = el('div', 'card'); c.append(el('span', 'small', t), el('b', cls, v)); return c; };
    cards.append(card('Cash', formatMoney(e.money), signCls(e.money)), card('This month', formatSigned(e.monthNet()), signCls(e.monthNet())), card('Today', formatSigned(e.dayNet()), signCls(e.dayNet())), card('Debt', formatMoney(a.debt())));
    const nets = e.reports().map((r) => r.net);
    nets.push(e.monthNet());
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '280'); svg.setAttribute('height', '56');
    const pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    pl.setAttribute('points', sparklinePoints(nets, 280, 56)); pl.setAttribute('fill', 'none'); pl.setAttribute('stroke', '#ffd070'); pl.setAttribute('stroke-width', '2');
    svg.appendChild(pl);
    const st = a.status?.();
    if (st && st.status === 'debt') {
      box.append(el('div', 'banner', `In debt for ${st.negDays} day${st.negDays === 1 ? '' : 's'}: you cannot build, overdraft interest is 1.5%/month, and the resort rating suffers. Earn money, take a "Restructure debt" loan, or give up.`));
    }
    box.append(cards, el('div', 'small', 'Monthly net trend'), svg);
    if (a.declare && st && st.status !== 'bankrupt') {
      const b = el('button', 'danger', 'Declare bankruptcy');
      b.addEventListener('click', () => { if (window.confirm('Declare bankruptcy? The game ends: the resort is closed and you can only look at it afterwards.')) a.declare?.(); });
      box.append(b);
    }
    return box;
  }

  private table(a: FinanceApi): HTMLElement {
    const t = buildFinanceTable(a.economy), tbl = el('table');
    const head = el('tr');
    for (const h of ['', 'This month', 'Last month', 'Year to date']) head.appendChild(el('th', '', h));
    tbl.appendChild(head);
    const row = (r: FinanceRow, cls = ''): void => {
      const tr = el('tr', cls);
      tr.append(el('td', '', r.label), el('td', '', formatMoney(r.thisMonth)), el('td', '', formatMoney(r.lastMonth)), el('td', '', formatMoney(r.ytd)));
      tbl.appendChild(tr);
    };
    for (const r of t.income) row(r);
    row(t.incomeTotal, 'tot');
    for (const r of t.expense) row(r);
    row(t.expenseTotal, 'tot');
    row(t.net, 'tot');
    return tbl;
  }

  private reports(a: FinanceApi): HTMLElement {
    const box = el('div', 'reports'), rows = a.reports?.list() ?? [];
    if (rows.length === 0) { box.appendChild(el('div', 'small', 'No year reports yet. The first one arrives when an in-game year ends.')); return box; }
    for (const r of [...rows].reverse()) {
      const b = el('button', 'rep');
      b.dataset.year = String(r.year);
      const th = el('span', 'th');
      if (r.cover && r.cover.startsWith('data:image/')) th.style.backgroundImage = `url("${r.cover}")`;
      const txt = el('span', 'tx');
      txt.append(el('b', '', `Year ${r.year}${r.isNew ? ' \u2022 new' : ''}`), el('span', 'small', r.headline), el('span', 'small', `${r.guests.toLocaleString('en-US')} guests \u00B7 ${formatSigned(r.profit)} profit \u00B7 ${r.rating.toFixed(1)}\u2605`));
      b.append(th, txt);
      b.addEventListener('click', () => a.reports?.open(r.year));
      box.appendChild(b);
    }
    return box;
  }

  private history(a: FinanceApi): HTMLElement {
    const rs = a.economy.reports(), box = el('div');
    if (rs.length === 0) { box.appendChild(el('div', 'small', 'No closed months yet.')); return box; }
    const W = 360, H = 90, max = Math.max(1, ...rs.map((r) => Math.max(r.incomeTotal, r.expenseTotal)));
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(W)); svg.setAttribute('height', String(H));
    const bw = W / Math.max(rs.length, 1);
    rs.forEach((r, i) => {
      for (const [v, col, off] of [[r.incomeTotal, '#7fe07f', 0], [r.expenseTotal, '#ff8a7a', 0.5]] as const) {
        const h = (v / max) * (H - 4), rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', String(i * bw + off * bw * 0.9)); rect.setAttribute('y', String(H - h)); rect.setAttribute('width', String(bw * 0.45)); rect.setAttribute('height', String(h)); rect.setAttribute('fill', col);
        svg.appendChild(rect);
      }
    });
    const list = el('div', 'small', rs.slice(-6).map((r) => `${MONTH_NAMES[r.month]!.slice(0, 3)} Y${r.year}: ${formatSigned(r.net)}`).join('  ·  '));
    box.append(el('div', 'small', 'Income (green) vs expenses (red), last 24 months'), svg, list);
    return box;
  }
}
