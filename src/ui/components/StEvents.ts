import { formatMoney } from '../format';
import type { EventsView } from '../eventsFormat';
import { StElement } from './StElement';
import { makeSelect } from './StSelect';

export interface EventsApi {
  view(): EventsView;
  /** Book a festival starting on an absolute day; returns an error text or null. */
  book(id: string, start: number): string | null;
  cancel(id: string, start: number): string | null;
}

const css = `
:host{display:block;flex:1;min-width:0}
.wrap{display:flex;flex-direction:column;gap:6px;max-height:min(34vh,340px);overflow:auto}
.cards{display:flex;flex-wrap:wrap;gap:6px}
.card{background:rgba(255,255,255,0.07);border-radius:6px;padding:6px 8px;width:210px;display:flex;flex-direction:column;gap:3px;font-size:11px}
.card.locked{opacity:.65;outline:1px dashed rgba(255,208,112,.45)}
.card h5{margin:0;font-size:12px;color:#ffd070}
.row{display:flex;gap:6px;align-items:center;font-size:11px}
.row .grow{flex:1}
.strip{display:grid;grid-template-columns:repeat(12,1fr);gap:2px;margin:2px 0 4px}
.m{min-width:0;border-radius:4px;padding:2px 0 1px;text-align:center;font-size:10px;line-height:1.25;background:rgba(255,255,255,.06);border:1px solid transparent}
.m.winter{background:rgba(120,170,230,.22)}.m.spring{background:rgba(140,210,140,.2)}.m.summer{background:rgba(240,200,90,.2)}.m.autumn{background:rgba(230,140,70,.22)}
.m.today{border-color:#ffd070;font-weight:800;color:#ffd070}
.m .ev{display:block;height:14px;font-size:11px;white-space:nowrap;overflow:hidden}
.warn{color:#ffb070}.ok{color:#8fd88f}.bad{color:#ff9a8a}.muted{color:#aab}
h4{margin:2px 0;font-size:12px;color:#ffd070}
st-select{min-width:120px}
`;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/** Events calendar: running and upcoming events (booked + automatic), bookable festivals with a start-date picker, prerequisites and payoff. */
export class StEvents extends StElement {
  private api: EventsApi | null = null;
  private wrap = el('div', 'wrap');
  private msg = '';
  private pending = false;
  /** Chosen start day per festival id (survives refreshes). */
  private pick = new Map<string, number>();

  protected css(): string { return css; }
  constructor() { super(); this.root.appendChild(this.wrap); }

  bind(api: EventsApi): void { this.api = api; this.refresh(); }
  requestRefresh(): void {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => { this.pending = false; this.refresh(); });
  }

  refresh(): void {
    const a = this.api;
    if (!a) return;
    const v = a.view();
    const out: HTMLElement[] = [];
    out.push(el('h4', '', `Today · ${v.todayLabel}`));
    const strip = el('div', 'strip');
    strip.setAttribute('aria-label', 'Calendar year, January to December');
    for (const c of v.strip) {
      const cell = el('div', `m ${c.season}${c.today ? ' today' : ''}`);
      cell.title = `${c.month} (${c.season})${c.events.length ? `: ${c.events.map((e) => e.name).join(', ')}` : ''}`;
      cell.append(el('span', '', c.month), el('span', 'ev', c.events.map((e) => e.icon).join('')));
      strip.append(cell);
    }
    out.push(strip);
    if (!v.running.length) out.push(el('div', 'muted', 'No festival this week.'));
    for (const r of v.running) out.push(el('div', 'row', `${r.icon} ${r.name} · ${r.note} (${r.when})`));
    if (v.review) out.push(el('div', 'muted', `Last critic review: ${v.review.score} / 5 (${v.review.when})`));
    out.push(el('h4', '', 'Coming up'));
    if (!v.upcoming.length) out.push(el('div', 'muted', 'Nothing booked.'));
    for (const u of v.upcoming) {
      const row = el('div', 'row');
      row.append(el('span', 'grow', `${u.icon} ${u.name} · ${u.when} · ${u.note}`));
      if (u.cancellable) {
        const b = el('button', '', 'Cancel');
        b.addEventListener('click', () => { this.msg = a.cancel(u.id, u.start) ?? ''; this.refresh(); });
        row.append(b);
      }
      out.push(row);
    }
    out.push(el('h4', '', 'Book a festival'));
    const cards = el('div', 'cards');
    for (const c of v.cards) {
      const card = el('div', c.general ? 'card locked' : 'card');
      card.append(
        el('h5', '', `${c.general ? '🔒 ' : ''}${c.def.icon} ${c.def.name}`),
        el('div', 'muted', c.def.blurb),
        el('div', '', `${formatMoney(c.def.cost)} · ${c.def.days} days · +${Math.round((c.def.arrivalMult - 1) * 100)}% arrivals`),
      );
      const reqs = [c.def.minStars > 0 ? `${c.def.minStars}★` : '', `level ${c.def.minLevel}`, ...c.def.needs.map((n) => (n === 'lodge' ? 'Base Lodge' : 'black piste'))].filter(Boolean).join(', ');
      card.append(el('div', 'muted', `Needs: ${reqs}`));
      if (c.window) card.append(el('div', 'muted', `Starts ${c.window}`));
      if (c.general) card.append(el('div', 'warn', c.general));
      const good = c.options.filter((o) => !o.blocker);
      const chosen = this.pick.get(c.def.id);
      const initial = c.options.some((o) => o.start === chosen) ? chosen! : good[0]?.start ?? c.options[0]?.start;
      const sel = makeSelect(c.options.map((o) => ({ value: String(o.start), label: o.blocker ? `${o.label} (${o.blocker})` : o.label, disabled: !!o.blocker })), initial === undefined ? '' : String(initial), `${c.def.name} start date`, (v) => { this.pick.set(c.def.id, Number(v)); });
      const btn = el('button', '', good.length ? 'Book' : 'Unavailable');
      btn.disabled = !good.length;
      btn.addEventListener('click', () => { const s = Number(sel.value); this.pick.set(c.def.id, s); this.msg = a.book(c.def.id, s) ?? ''; this.refresh(); });
      const row = el('div', 'row'); row.append(sel, btn);
      card.append(row);
      cards.append(card);
    }
    out.push(cards);
    if (this.msg) out.push(el('div', 'bad', this.msg));
    this.wrap.replaceChildren(...out);
  }
}
