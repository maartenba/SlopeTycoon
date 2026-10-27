import type { PrereqCheck } from '../../sim/Marketing';
import { costPerGuestText, effLabel, rangeText, shareText, upliftText, type MarketingView } from '../marketingFormat';
import { formatMoney } from '../format';
import { PREREQ_GRACE_DAYS } from '../../config/marketing';
import { StElement } from './StElement';

export interface MarketingApi {
  view(): MarketingView;
  /** Start a campaign; returns an error text or null. */
  start(id: string): string | null;
  /** 'Show me' on an unmet prerequisite (opens the Buildings drawer on its building, pans to the station, or scrolls to the Events calendar). */
  showMe?(check: PrereqCheck): void;
}

const css = `
:host{display:block;flex:1;min-width:0}
.wrap{display:flex;flex-direction:column;gap:6px;max-height:min(34vh,340px);overflow:auto}
.cards{display:flex;flex-wrap:wrap;gap:6px}
.card{background:rgba(255,255,255,0.07);border-radius:6px;padding:6px 8px;width:210px;display:flex;flex-direction:column;gap:3px;font-size:11px}
.card.hl{outline:2px solid #ffd070;box-shadow:0 0 10px rgba(255,208,112,.7);animation:hlpulse 1.2s ease-in-out 4}
@keyframes hlpulse{50%{box-shadow:0 0 2px rgba(255,208,112,.2)}}
@media (prefers-reduced-motion:reduce){.card.hl{animation:none}}
.card.locked{opacity:.6;outline:1px dashed rgba(255,208,112,.45)}
.card h5{margin:0;font-size:12px;color:#ffd070}
.warn{color:#ffb070}.ok{color:#8fd88f}.dim{opacity:.45}.req{display:flex;flex-direction:column;gap:1px}.bad{color:#ff9a8a}.muted{color:#aab}
.show{font-size:10px;padding:0 5px;margin-left:2px}
.bar{height:6px;background:#2a3648;border-radius:3px;overflow:hidden}.bar>i{display:block;height:100%;background:#6ac46a}
h4{margin:2px 0;font-size:12px;color:#ffd070}
`;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/** Marketing drawer: campaign cards (cost, duration, target, effectiveness, ROI preview), running campaigns, history with measured uplift. */
export class StMarketing extends StElement {
  private api: MarketingApi | null = null;
  private wrap = el('div', 'wrap');
  private msg = '';
  private pending = false;
  private hlId: string | null = null;
  private hlTimer = 0;
  /** Pulse + scroll to a campaign card (advice 'Show me'); fades after ~8 s. */
  highlight(id: string | null): void {
    this.hlId = id;
    window.clearTimeout(this.hlTimer);
    this.refresh();
    if (id) { this.hlTimer = window.setTimeout(() => { this.hlId = null; this.refresh(); }, 8000); this.wrap.querySelector('.card.hl')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }
  }

  protected css(): string { return css; }
  constructor() { super(); this.root.appendChild(this.wrap); }

  bind(api: MarketingApi): void { this.api = api; this.refresh(); }
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
    out.push(el('h4', '', `Running (${v.running.length}/${v.maxConcurrent})`));
    if (!v.running.length) out.push(el('div', 'muted', 'No campaign running.'));
    for (const r of v.running) {
      const row = el('div', 'card');
      row.append(el('h5', '', `${r.def.icon} ${r.def.name}`), el('div', 'muted', `${r.daysLeft} days left · effectiveness ${r.effPct}% · ${r.arrivals} arrivals so far`));
      if (r.extra) row.append(el('div', 'muted', r.extra));
      if (r.live !== 1) row.append(el('div', 'muted', `Today: x${Math.round(r.live * 100) / 100}`));
      if (r.paused.length) row.append(el('div', 'warn', `⚠ Paused: requires ${r.paused.join(', ')}. Cancelled in ${Math.max(0, PREREQ_GRACE_DAYS + 1 - r.pausedDays)} days unless fixed.`));
      const bar = el('div', 'bar'), fill = el('i');
      fill.style.width = `${r.pct}%`; bar.appendChild(fill); row.appendChild(bar);
      out.push(row);
    }
    out.push(el('h4', '', 'Campaigns'));
    const cards = el('div', 'cards');
    for (const c of v.cards) {
      const card = el('div', c.locked ? 'card locked' : 'card');
      const p = c.preview, tgt = c.def.segment;
      const roi = el('div', c.prereqsOk ? '' : 'dim');
      roi.append(
        el('div', '', `Effectiveness ${c.prereqsOk ? effLabel(p.effectiveness.value) : '—'}${c.prereqsOk && p.targetBoostPct > 0 ? ` · +${p.targetBoostPct}% ${tgt} arrivals` : ''}`),
        el('div', 'muted', c.prereqsOk ? `Est. extra guests ${rangeText(p.extraGuests)} · revenue ${rangeText(p.extraRevenue, true)} · ${costPerGuestText(p.costPerGuest)}` : 'Est. extra guests — · revenue — (requirements not met)'),
      );
      card.dataset.id = c.def.id;
      if (c.def.id === this.hlId) card.classList.add('hl');
      card.append(
        el('h5', '', `${c.locked ? '🔒 ' : ''}${c.def.icon} ${c.def.name}`),
        el('div', 'muted', c.def.blurb),
        el('div', '', `${formatMoney(c.def.cost)} · ${c.def.durationDays} days · target: ${tgt}`),
        roi,
      );
      const req = el('div', 'req');
      req.appendChild(el('div', 'muted', 'Requires:'));
      for (const q of c.prereqs) {
        const row = el('div', q.ok ? 'ok' : 'bad', `${q.ok ? '✓' : '✗'} ${q.label}`);
        if (!q.ok && (q.show || q.build) && a.showMe) {
          const b = el('button', 'show', 'Show me');
          b.addEventListener('click', () => a.showMe!(q));
          row.append(' ', b);
        }
        req.appendChild(row);
      }
      card.appendChild(req);
      for (const w of p.effectiveness.warnings) if (c.prereqsOk) card.appendChild(el('div', 'warn', `⚠ ${w}`));
      const btn = el('button', '', c.locked ? c.locked : !c.prereqsOk ? 'Requirements missing' : c.blocker ? c.blocker : 'Start campaign');
      btn.disabled = !!c.locked || !c.prereqsOk || !!c.blocker || !c.affordable;
      if (c.locked) btn.title = c.locked;
      if (c.prereqsOk && !c.blocker && !c.affordable) btn.textContent = 'Not enough cash';
      btn.addEventListener('click', () => { this.msg = a.start(c.def.id) ?? ''; this.refresh(); });
      card.appendChild(btn);
      cards.appendChild(card);
    }
    out.push(cards);
    out.push(el('h4', '', 'History'));
    if (!v.history.length) out.push(el('div', 'muted', 'No finished campaigns yet.'));
    for (const r of v.history) out.push(el('div', '', `${r.name}: ${formatMoney(r.cost)}, ${r.days} d · ${upliftText(r)}${shareText(r)}`));
    if (this.msg) out.push(el('div', 'bad', this.msg));
    this.wrap.replaceChildren(...out);
  }
}
