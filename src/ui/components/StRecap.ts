import { starRow } from '../icons';
import { TOP_CARD_Y } from '../layout';
import type { MonthCardModel, RecapModel, Tone } from '../recap';
import type { UnlockKind } from '../../config/unlocks';
import { ToastLimiter } from '../toastLimiter';
import { StElement } from './StElement';

export interface RecapApi {
  /** 'Details' on the month card: open the Finance drawer. */
  openFinance(): void;
  /** 'Show me' on a level-up card: open the drawer on the newly unlocked item. */
  showItem?(kind: UnlockKind, id: string): void;
}

/** Level-up card (M5.3): 'Level 4 · Alpine destination' + what is new. Fixed size, one at a time, the same zone as the recap / month card. */
export interface UnlockCardModel { level: number; name: string; items: Array<{ kind: UnlockKind; id: string; name: string; icon: string }> }

export const RECAP_AUTO_MS = 20000;
export const MONTH_CARD_MS = 8000;
/** Fixed footprint of the card (src/ui/layout.ts zone `top-card`). */
export const RECAP_W = 320, RECAP_H = 280, MONTH_H = 150, COLLAPSED_H = 30, UNLOCK_H = 190;
export const UNLOCK_CARD_MS = 14000;
/** Rows listed on the level-up card (the rest is summed up as '+N more'). */
export const UNLOCK_ROWS = 5; // level 4 now unlocks five items (Phase 6 Task 27 added the Luxury Hotel): the card grew by one row

/**
 * Transient info card (M5.1), one element with two modes: the "Welcome back" recap after loading a save (~20 s) and the month-end summary
 * (~8 s, collapsible, goes through a ToastLimiter so only one shows at a time). NOT a dialog: the host never takes pointer events, only the
 * card does, it has a fixed size, and once dismissed it is `hidden` (display none) so nothing can block the game. One click dismisses it.
 */
export class StRecap extends StElement {
  private card = document.createElement('div');
  private api: RecapApi | null = null;
  private timer = 0;
  private collapsed = false;
  private mode: 'recap' | 'month' | 'unlock' | null = null;
  private suppressed = false;
  private monthModel: MonthCardModel | null = null;
  readonly limiter = new ToastLimiter({ maxVisible: 1, ttlMs: MONTH_CARD_MS, coalesceMs: 60_000 });
  readonly unlockLimiter = new ToastLimiter({ maxVisible: 1, ttlMs: UNLOCK_CARD_MS, coalesceMs: 60_000 });

  protected css(): string {
    return `:host{position:absolute;top:${TOP_CARD_Y}px;left:50%;margin-left:${-RECAP_W / 2}px;width:${RECAP_W}px;pointer-events:none}
:host([hidden]){display:none!important}
.card{pointer-events:auto;box-sizing:border-box;width:${RECAP_W}px;display:flex;flex-direction:column;gap:4px;padding:8px 10px 9px;overflow:hidden;font-size:calc(12px * var(--ui-scale, 1));background:var(--c-panel);border:1px solid rgba(90,112,144,.5);border-radius:var(--r-md);box-shadow:0 4px 16px rgba(0,0,0,.4)}
.card.recap{height:${RECAP_H}px}.card.month{height:${MONTH_H}px}.card.unlock{height:${UNLOCK_H}px;border-color:#d9a441}
.it{display:flex;align-items:center;gap:6px;min-width:0}.it .ic{flex:0 0 18px;text-align:center}.it .nm{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}.it button{flex:0 0 auto;padding:0 7px;font-size:11px;line-height:18px}.card.collapsed{height:${COLLAPSED_H}px;padding-top:4px;padding-bottom:4px}
.head{display:flex;align-items:center;gap:6px;min-width:0}
.head h3{margin:0;flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--font-display);font-weight:400;font-size:calc(15px * var(--ui-scale, 1));color:var(--c-accent-text)}
.head button{padding:0 7px;line-height:18px;font-size:12px}
.sub{color:#9fb4cc;font-size:calc(11px * var(--ui-scale, 1));margin-top:-3px}
.row{display:flex;align-items:center;gap:6px;min-width:0}.row>.k{flex:0 0 auto;color:#9fb4cc}.row>.v{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;font-weight:700}
.good{color:#7fd68a}.bad{color:#ff9a8a}.neutral{color:#e6edf6}
.sec{margin:2px 0 0;font-size:calc(10.5px * var(--ui-scale, 1));letter-spacing:.5px;text-transform:uppercase;color:#7f93ad}
.li{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.li.pct{display:flex;gap:6px}.li.pct>span:first-child{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}.li.pct>span:last-child{color:#9fb4cc}
.warn{color:#f0c060}
.actions{display:flex;align-items:center;gap:8px;margin-top:auto}.actions .hl{flex:1 1 auto;min-width:0;color:#b9c6d8}.actions button{flex:0 0 auto}`;
  }

  constructor() {
    super();
    this.card.className = 'card';
    this.card.setAttribute('role', 'status');
    this.root.appendChild(this.card);
    this.card.hidden = true;
  }

  bind(api: RecapApi): void { this.api = api; }

  /** True while any card is on screen. */
  get showing(): boolean { return this.mode !== null && !this.card.hidden; }
  get currentMode(): 'recap' | 'month' | 'unlock' | null { return this.mode; }
  /** Tutorial running: never show (and drop anything visible). */
  suppress(on: boolean): void { this.suppressed = on; if (on) this.dismiss(); }

  showRecap(m: RecapModel): boolean {
    if (this.suppressed) return false;
    this.mode = 'recap'; this.collapsed = false; this.card.hidden = false;
    this.renderRecap(m);
    this.arm(RECAP_AUTO_MS);
    return true;
  }

  /** Month-end card. Obeys the toast limiter (one at a time; the same month never repeats). Returns whether it was shown. */
  showMonth(m: MonthCardModel, key: string, now = performance.now()): boolean {
    if (this.suppressed) return false;
    if ((this.mode === 'recap' || this.mode === 'unlock') && !this.card.hidden) return false; // the recap / a level-up card has priority; the month is in Finance anyway
    if (this.limiter.push({ key, text: m.title, severity: 'info' }, now) !== 'shown') return false;
    this.mode = 'month'; this.collapsed = false; this.card.hidden = false; this.monthModel = m;
    this.renderMonth();
    this.arm(MONTH_CARD_MS);
    return true;
  }

  /** Level-up card ('New: Gondola, 6-seat chair'). Replaces the month card (never the welcome-back recap); one at a time through its own limiter. */
  showUnlock(m: UnlockCardModel, now = performance.now()): boolean {
    if (this.suppressed || (this.mode === 'recap' && !this.card.hidden)) return false;
    if (this.unlockLimiter.push({ key: `level:${m.level}`, text: m.name, severity: 'good' }, now) !== 'shown') return false;
    window.clearTimeout(this.timer);
    this.mode = 'unlock'; this.collapsed = false; this.card.hidden = false;
    this.renderUnlock(m);
    this.arm(UNLOCK_CARD_MS);
    return true;
  }

  dismiss(): void {
    window.clearTimeout(this.timer);
    this.mode = null; this.monthModel = null; this.card.hidden = true;
    this.card.replaceChildren();
  }

  private arm(ms: number): void { window.clearTimeout(this.timer); this.timer = window.setTimeout(() => this.dismiss(), ms); }

  disconnectedCallback(): void { window.clearTimeout(this.timer); super.disconnectedCallback(); }

  private txt(tag: string, cls: string, text: string): HTMLElement { const e = document.createElement(tag); e.className = cls; e.textContent = text; return e; }
  private kv(k: string, v: string, tone: Tone = 'neutral'): HTMLElement {
    const r = document.createElement('div'); r.className = 'row';
    r.append(this.txt('span', 'k', k), this.txt('span', `v ${tone}`, v));
    return r;
  }
  private header(title: string, withCollapse: boolean): HTMLElement {
    const h = document.createElement('div'); h.className = 'head';
    h.append(this.txt('h3', '', title));
    if (withCollapse) {
      const c = document.createElement('button'); c.className = 'ghost collapse'; c.textContent = this.collapsed ? '\u25B8' : '\u25BE'; c.title = this.collapsed ? 'Expand' : 'Collapse';
      c.setAttribute('aria-expanded', String(!this.collapsed));
      c.addEventListener('click', () => { this.collapsed = !this.collapsed; this.renderMonth(); });
      h.append(c);
    }
    const x = document.createElement('button'); x.className = 'ghost close'; x.textContent = '\u2715'; x.title = 'Dismiss'; x.setAttribute('aria-label', 'Dismiss');
    x.addEventListener('click', () => this.dismiss());
    h.append(x);
    return h;
  }

  private renderUnlock(m: UnlockCardModel): void {
    this.card.className = 'card unlock'; this.card.dataset.level = String(m.level);
    const kids: HTMLElement[] = [this.header(`Level ${m.level} \u00B7 ${m.name}`, false)];
    kids.push(this.txt('div', 'sub', m.items.length ? 'Newly unlocked for you' : 'Your resort is growing. Nothing new to unlock this time.'));
    for (const it of m.items.slice(0, UNLOCK_ROWS)) {
      const r = document.createElement('div'); r.className = 'it'; r.dataset.unlock = `${it.kind}:${it.id}`;
      const b = document.createElement('button'); b.textContent = 'Show me'; b.title = `Open ${it.name} in the build menu`;
      b.addEventListener('click', () => { this.api?.showItem?.(it.kind, it.id); this.dismiss(); });
      r.append(this.txt('span', 'ic', it.icon), this.txt('span', 'nm', it.name), b); kids.push(r);
    }
    if (m.items.length > UNLOCK_ROWS) kids.push(this.txt('span', 'li', `+${m.items.length - UNLOCK_ROWS} more`));
    this.card.replaceChildren(...kids);
    this.card.onclick = null;
  }

  private renderRecap(m: RecapModel): void {
    this.card.className = 'card recap';
    const kids: HTMLElement[] = [this.header(m.title, false), this.txt('div', 'sub', m.subtitle)];
    const rate = document.createElement('div'); rate.className = 'row';
    const sv = document.createElement('span'); sv.className = 'v'; sv.append(starRow(m.stars, 12));
    if (m.trend) { const t = this.txt('span', `${m.trend.tone}`, ` ${m.trend.text}`); t.style.marginLeft = '6px'; sv.append(t); }
    rate.append(this.txt('span', 'k', 'Rating'), sv);
    kids.push(this.kv('Cash', m.cash), rate);
    if (m.change) kids.push(this.kv('Since month start', m.change.text, m.change.tone));
    if (m.lastMonth) kids.push(this.kv('Last month', m.lastMonth.text, m.lastMonth.tone));
    for (const i of m.issues.slice(0, 2)) kids.push(this.txt('span', 'li warn', `\u26A0 ${i}`));
    if (m.goals.length) { kids.push(this.txt('div', 'sec', 'Goals')); for (const g of m.goals) { const l = document.createElement('div'); l.className = 'li pct'; l.append(this.txt('span', '', g.text), this.txt('span', '', `${g.pct}%`)); kids.push(l); } }
    if (m.advice.length) { kids.push(this.txt('div', 'sec', 'Ranger Rudi says')); for (const a of m.advice) kids.push(this.txt('span', 'li', a)); }
    this.card.replaceChildren(...kids);
    this.card.onclick = null;
  }

  private renderMonth(): void {
    const m = this.monthModel;
    if (!m) return;
    this.card.className = `card month${this.collapsed ? ' collapsed' : ''}`;
    const kids: HTMLElement[] = [this.header(m.title, true)];
    if (!this.collapsed) {
      kids.push(this.kv(m.income.label, m.income.text, 'neutral'), this.kv(m.expense.label, m.expense.text, 'neutral'), this.kv(m.net.label, m.net.text, m.net.tone));
      const g = document.createElement('div'); g.className = 'li'; g.append(this.txt('span', '', m.guests));
      if (m.rating) { g.append(this.txt('span', '', ' \u00B7 Rating ')); g.append(this.txt('span', m.rating.tone, m.rating.text.toLowerCase())); }
      kids.push(g);
      const a = document.createElement('div'); a.className = 'actions';
      if (m.highlight) a.append(this.txt('span', 'li hl', m.highlight));
      const d = document.createElement('button'); d.className = 'details'; d.textContent = 'Details';
      d.addEventListener('click', () => { this.api?.openFinance(); this.dismiss(); });
      a.append(d); kids.push(a);
    }
    this.card.replaceChildren(...kids);
  }
}
