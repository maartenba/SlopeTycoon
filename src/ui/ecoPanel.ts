import { ECO } from '@/config/eco';
import type { EcoPolicyId } from '@/config/eco';
import { showModal, type StModal } from './components/StModal';
import { fmtMoney, policyCostLine, type EcoModel } from './ecoFormat';

/** What the Eco programme dialog needs from the game (wired in main.ts). */
export interface EcoBind {
  model(): EcoModel;
  toggle(id: EcoPolicyId): string | null;
  toggleCert(): string | null;
}

const CSS = `
.eco{display:flex;flex-direction:column;gap:10px;min-width:0;font-size:13px}
.eco h3{margin:6px 0 2px;font-size:14px}
.eco .row{display:flex;align-items:center;gap:8px;min-width:0}
.eco .bar{flex:1;height:8px;border-radius:4px;background:rgba(127,127,127,.25);overflow:hidden}
.eco .bar i{display:block;height:100%;background:#4fae6a}
.eco .lbl{width:150px;flex:none}.eco .num{width:70px;text-align:right;flex:none;font-variant-numeric:tabular-nums}
.eco .card{border:1px solid rgba(127,127,127,.35);border-radius:8px;padding:8px 10px;display:flex;gap:10px;align-items:center}
.eco .card.on{border-color:#4fae6a;background:rgba(79,174,106,.12)}
.eco .card .txt{flex:1;min-width:0}.eco .card .nm{font-weight:700}
.eco .card .sub{opacity:.8;line-height:1.3}.eco .card .bad{color:#c0603a}
.eco button{min-height:44px;min-width:92px}
.eco .msg{min-height:1.2em;color:#c0603a}
.eco .note{opacity:.8}
`;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };

/** Build the dialog body from the current model (rebuilt after every click). */
export function buildEcoBody(m: EcoModel, bind: EcoBind, rebuild: () => void): HTMLElement {
  const root = el('div', 'eco'); root.dataset.role = 'eco';
  const style = document.createElement('style'); style.textContent = CSS; root.append(style);
  const msg = el('div', 'msg'); msg.dataset.role = 'eco-msg'; msg.setAttribute('role', 'status');
  const head = el('div', 'note', m.enabled
    ? `Eco programme: +${m.ecoPoints.toFixed(1)} of at most ${m.ecoMax} sustainability points · policies cost ${fmtMoney(m.perDay)}/day (${fmtMoney(m.perDayAll)}/day with everything on, plus the centre's upkeep)`
    : 'The Eco Centre is not working (it needs a road or footpath). The policies pause until it does.');
  head.dataset.role = 'eco-head';
  root.append(head, el('h3', '', `Sustainability${m.score === null ? ' (measured at the end of the first day)' : ` ${Math.round(m.score)} / 100`}`));
  for (const p of m.parts) {
    const row = el('div', 'row'); row.dataset.part = p.id; row.title = p.tip;
    const bar = el('div', 'bar'), fill = document.createElement('i'); fill.style.width = `${Math.min(100, Math.round((100 * p.points) / Math.max(1, p.max)))}%`; bar.append(fill);
    row.append(el('span', 'lbl', p.label), bar, el('span', 'num', m.score === null && p.id !== 'eco' ? '- / ' + p.max : `${p.points.toFixed(1)} / ${p.max}`));
    root.append(row);
  }
  root.append(el('h3', '', 'Policies'));
  for (const { def, view } of m.policies) {
    const on = view.state === 'on';
    const card = el('div', `card${on ? ' on' : ''}`); card.dataset.policy = def.id;
    const txt = el('div', 'txt');
    txt.append(el('div', 'nm', `${def.icon} ${def.name}`), el('div', 'sub', def.effect), el('div', 'sub bad', `Trade-off: ${def.tradeoff}`), el('div', 'sub', policyCostLine(def)));
    const btn = el('button', '', on ? 'Switch off' : 'Start'); btn.dataset.role = 'eco-toggle'; btn.disabled = !on && (view.state === 'locked' || view.state === 'poor');
    btn.title = view.reason ?? (on ? 'The start fee is not refunded' : `Pay ${fmtMoney(def.fee)} now, then ${fmtMoney(def.perDay)} a day`);
    btn.addEventListener('click', () => { const why = bind.toggle(def.id); if (why) msg.textContent = why; else rebuild(); });
    card.append(txt, btn); root.append(card);
  }
  const c = m.cert, C = ECO.cert;
  root.append(el('h3', '', 'Carbon-neutral certification'));
  const card = el('div', `card${c.held ? ' on' : ''}`); card.dataset.policy = 'cert';
  const txt = el('div', 'txt');
  const req = (ok: boolean, t: string): HTMLElement => el('div', `sub${ok ? '' : ' bad'}`, `${ok ? '✔' : '✖'} ${t}`);
  txt.append(
    el('div', 'nm', `🏅 ${c.held ? 'Certified' : c.on ? 'Audit running' : 'Not certified'}`),
    el('div', 'sub', `A lasting +${Math.round((C.arrivals - 1) * 100)}% arrivals from eco-tourists and +${C.points} sustainability points while it holds.`),
    req(c.policies.have >= c.policies.need, `${c.policies.have} of ${c.policies.need} policies running`),
    req(c.share.have >= c.share.need, `Renewables take ${Math.round(c.share.have * 100)}% of the energy bill (need ${Math.round(c.share.need * 100)}%)`),
    req(c.days.have >= c.days.need, `Held ${c.days.have} of ${c.days.need} days in a row`),
    el('div', 'sub', `Start ${fmtMoney(C.fee)} · ${fmtMoney(C.perDay)}/day for the audit`));
  const cb = el('button', '', c.on ? 'Stop audit' : 'Start audit'); cb.dataset.role = 'eco-cert'; cb.disabled = !c.on && !!c.reason; cb.title = c.reason ?? '';
  cb.addEventListener('click', () => { const why = bind.toggleCert(); if (why) msg.textContent = why; else rebuild(); });
  card.append(txt, cb); root.append(card, msg);
  return root;
}

/** Open the Eco programme dialog (does not pause the game: the numbers move while you read). */
export function openEcoProgramme(parent: HTMLElement, bind: EcoBind): StModal {
  const m = showModal(parent, { title: 'Eco programme', icon: '🌿', size: 'md', body: document.createElement('div'), pausesGame: false, actions: [{ label: 'Close', kind: 'primary', id: 'close' }] });
  const rebuild = (): void => { m.dialog.body.replaceChildren(buildEcoBody(bind.model(), bind, rebuild)); };
  rebuild();
  return m;
}
