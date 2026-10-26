import type { EngineView } from '../../tutorial/TutorialEngine';
import { parseRich, t } from '../../tutorial/strings';
import { ADVISOR_UI, RANGER_NAME } from '../../sim/advisor/strings';
import { icon } from '../icons';
import { rudiElement, type RudiExpression } from './rudiAvatar';
import { getReducedMotion, onReducedMotion } from '../accessibility';
import { StElement } from './StElement';

/**
 * Tutorial assistant (bottom-left): a procedurally drawn ranger avatar (inline SVG, 4 expressions), a speech bubble with the current
 * lesson, progress dots, the goals mini-panel and the action buttons. Layout reasoning (UNVERIFIED in a browser): `st-topbar` is top-left,
 * the HUD / inspectors / news are in the right column, the dock + drawer are bottom-centre (drawer ≥ 420 px wide) and the debug panel /
 * settings hint sit at the very bottom-left, so the assistant lives at left:8px; bottom:84px (above the 77 px dock row; src/ui/layout.ts) and the
 * drawer is right-aligned to the dock and ≤ vw-632 wide so it never reaches the assistant column (x ≤ 348). Below 1100 px wide the bubble
 * starts minimised (avatar badge only; click it to read the lesson).
 *
 * INPUT SAFETY: host, wrapper and the goals panel are `pointer-events:none`; only the bubble, avatar badge and hint bubble (small
 * boxes) accept clicks. There is no full-screen element at all.
 */
export const ASSISTANT_CSS =
  ':host{position:absolute;left:8px;bottom:84px;display:block;pointer-events:none;font-size:12px;line-height:1.35;color:#fff;z-index:15}' +
  '.wrap{display:flex;flex-direction:column;align-items:flex-start;gap:6px;pointer-events:none;width:340px;max-width:calc(100vw - 16px)}' +
  '.bubble,.hintb{pointer-events:auto;background:rgba(20,28,40,.92);border:1px solid #5a7090;border-radius:10px;padding:8px 10px;display:flex;flex-direction:column;gap:5px;box-shadow:0 2px 10px rgba(0,0,0,.4);width:100%;box-sizing:border-box}' +
  '.bubble{height:214px}.body{flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:5px;scrollbar-width:thin}.title{flex:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dots,.btns,.foot,.confirm{flex:none}.btns{min-height:26px}.foot{min-height:20px}' +
  '.title{font-weight:700;color:#ffd070;font-size:13px}.text{white-space:normal}.text b{color:#fff}.text em{color:#cfe3f1}' +
  'kbd{font:11px monospace;background:#34465e;border:1px solid #5a7090;border-bottom-width:2px;border-radius:3px;padding:0 4px}' +
  '.note{color:#9fe0a0}.msg{color:#ffd070}.dots{display:flex;gap:3px;align-items:center;flex-wrap:wrap;font-size:11px;color:#9bb0c9}' +
  '.dot{width:6px;height:6px;border-radius:50%;background:#46607f}.dot.on{background:#ffd070}.dot.done{background:#7fe07f}' +
  '.btns,.foot{display:flex;gap:5px;flex-wrap:wrap}.btns button.primary{background:#2f8f4a;border-color:#6fd08a}.btns button.go{background:#e0a030;color:#111;border-color:#ffd070}' +
  '.foot button{font-size:11px;padding:1px 6px;background:transparent;color:#cfe3f1}.confirm{display:flex;gap:5px;align-items:center;flex-wrap:wrap}' +
  '.goals{pointer-events:none;background:rgba(20,28,40,.8);border-radius:8px;padding:5px 8px;font-size:11px;display:flex;flex-direction:column;gap:2px;width:100%;box-sizing:border-box}' +
  '.goals h4{margin:0;font-size:11px;color:#ffd070}.goals .g.done{color:#7fe07f;text-decoration:line-through}' +
  '.avatar{pointer-events:auto;width:56px;height:56px;padding:0;border-radius:50%;border:2px solid #ffd070;background:#2a3a52;cursor:pointer;overflow:hidden;flex:none}' +
  '.avatar svg{width:100%;height:100%;display:block}.avatar.bob{animation:bob 2.4s ease-in-out infinite}.avatar.bob .eyes{transform-box:fill-box;transform-origin:center;animation:blink 4s infinite}' +
  '@keyframes blink{0%,93%,100%{transform:scaleY(1)}96%{transform:scaleY(.1)}}.avatar svg{overflow:hidden}' +
  '@keyframes bob{50%{transform:translateY(-3px)}}@media (prefers-reduced-motion: reduce){.avatar.bob,.avatar.bob .eyes{animation:none}}' +
  '@media (max-width:1099px){.wrap.min{width:auto}.wrap.min .goals{display:none}}' +
  '.arow{display:flex;align-items:center;gap:8px;pointer-events:none}' +
  '.advbadge{pointer-events:auto;display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 9px;border-radius:13px;background:rgba(20,28,40,.92);border:1px solid #5a7090;color:#ffd070;font-size:12px;font-weight:700;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.4)}' +
  '.advbadge:hover{border-color:#ffd070}.advbadge.open{background:#2f4666}' +
  '@media (max-width:1099px){.arow{position:relative}.advbadge{position:absolute;left:34px;top:-10px;height:22px;padding:0 6px;gap:3px}.advbadge .lbl{display:none}}' +
  '.advice{pointer-events:auto;background:rgba(20,28,40,.92);border:1px solid #5a7090;border-radius:10px;padding:8px 10px;display:flex;flex-direction:column;gap:5px;box-shadow:0 2px 10px rgba(0,0,0,.4);width:100%;height:214px;box-sizing:border-box}' +
  '.advice .ah{flex:none;display:flex;align-items:baseline;gap:6px;white-space:nowrap}.advice .ah b{color:#ffd070;font-size:13px}.advice .ah span{color:#9bb0c9;font-size:11px;flex:1;overflow:hidden;text-overflow:ellipsis}' +
  '.advice .al{flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:5px;scrollbar-width:thin}' +
  '.advice .it{flex:none;display:flex;flex-direction:column;gap:2px;border-top:1px solid #34465e;padding-top:4px}.advice .it:first-child{border-top:0;padding-top:0}' +
  '.advice .tr{display:flex;align-items:center;gap:6px;min-width:0}.advice .tt{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-weight:700;color:#fff}' +
  '.advice .sev{flex:none;width:8px;height:8px;border-radius:50%;background:#7fb0e0}.advice .sev.warn{background:#ffd070}.advice .sev.urgent{background:#ff6a5a}' +
  '.advice .tr button{flex:none;font-size:11px;padding:0 6px;line-height:18px}.advice .tr button.primary{background:#2f8f4a;border-color:#6fd08a}' +
  '.advice .why{margin:0;color:#cfe3f1;font-size:11px;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.advice .fr{color:#9fe0a0}' +
  '.advice .empty{color:#cfe3f1}.advice .foot2{flex:none;color:#7f93ad;font-size:10px}' +
  '.hintb{border-color:#ffd070}.hintb .row{display:flex;gap:6px;align-items:flex-start}.hintb .grow{flex:1}';

export type Expression = RudiExpression;

/** One piece of Ranger Rudi's advice as the card shows it (plain data: no sim types). */
export interface AdviceItem { id: string; severity: 'info' | 'warn' | 'urgent'; title: string; why: string; friendly?: string }
export interface AdviceView { items: AdviceItem[]; count: number }
export interface AdviceApi { show(id: string): void; dismiss(id: string): void }

export interface AssistantApi {
  show(): void;
  doIt(): void;
  skip(): void;
  next(): void;
  prev?(): void;
  /** Minimise / restore the bubble. */
  minimise(min: boolean): void;
  exit(): void;
}

/** Ranger Rudi (see rudiAvatar.ts): flat-vector park ranger bust, one SVG per expression. */
export function avatarSvg(expr: Expression, mini = false): SVGElement { return rudiElement(expr, mini); }

const btn = (cls: string, text: string, fn: () => void): HTMLButtonElement => {
  const b = document.createElement('button');
  if (cls) b.className = cls;
  b.textContent = text;
  b.addEventListener('click', fn);
  return b;
};

export class StAssistant extends StElement {
  private readonly wrap = document.createElement('div');
  private readonly bubble = document.createElement('div');
  private readonly heading = document.createElement('div');
  private readonly text = document.createElement('div');
  private readonly note = document.createElement('div');
  private readonly msg = document.createElement('div');
  private readonly dots = document.createElement('div');
  private readonly goals = document.createElement('div');
  private readonly hintBox = document.createElement('div');
  private readonly hintText = document.createElement('div');
  private readonly avatar = document.createElement('button');
  private readonly arow = document.createElement('div');
  private readonly advBadge = document.createElement('button');
  private readonly advCard = document.createElement('div');
  private readonly advList = document.createElement('div');
  private advApi: AdviceApi | null = null;
  private advView: AdviceView = { items: [], count: 0 };
  private advOpen = false;
  private tutorialOn = false;
  private tutHidden = true;
  private readonly confirm = document.createElement('div');
  private foot: HTMLElement | null = null;
  private readonly btnShow: HTMLButtonElement;
  private readonly btnDo: HTMLButtonElement;
  private readonly btnNext: HTMLButtonElement;
  private readonly btnSkip: HTMLButtonElement;
  private readonly btnPrev: HTMLButtonElement;
  private readonly btnHide: HTMLButtonElement;
  private readonly btnExit: HTMLButtonElement;
  private api: AssistantApi | null = null;
  private sig = '';
  private expr: Expression = 'idle';
  private hintTimer: ReturnType<typeof setTimeout> | null = null;
  private narrowDone = false;
  private offMotion: (() => void) | null = null;

  protected css(): string { return ASSISTANT_CSS; }

  constructor() {
    super();
    this.wrap.className = 'wrap';
    this.wrap.style.pointerEvents = 'none';
    this.bubble.className = 'bubble';
    this.bubble.setAttribute('role', 'dialog');
    this.bubble.setAttribute('aria-live', 'polite');
    this.heading.className = 'title'; this.text.className = 'text'; this.note.className = 'note'; this.msg.className = 'msg'; this.dots.className = 'dots';
    this.goals.className = 'goals'; this.goals.style.pointerEvents = 'none';
    this.hintBox.className = 'hintb'; this.hintBox.hidden = true;
    this.hintText.className = 'grow';
    const hintClose = btn('', '✕', () => this.dismissHint());
    hintClose.title = t('ui.hintClose'); hintClose.setAttribute('aria-label', t('ui.hintClose'));
    const hintRow = document.createElement('div'); hintRow.className = 'row'; hintRow.append(this.hintText, hintClose);
    this.hintBox.append(hintRow);
    this.btnShow = btn('primary', t('ui.show'), () => this.api?.show());
    this.btnDo = btn('go', t('ui.do'), () => this.api?.doIt());
    this.btnNext = btn('primary', t('ui.next'), () => this.api?.next());
    this.btnSkip = btn('', t('ui.skip'), () => this.api?.skip());
    this.btnPrev = btn('', t('ui.prev'), () => this.api?.prev?.());
    this.btnHide = btn('', t('ui.hide'), () => this.api?.minimise(true));
    this.btnExit = btn('', t('ui.exit'), () => { this.setConfirm(true); });
    const btns = document.createElement('div'); btns.className = 'btns'; btns.append(this.btnShow, this.btnDo, this.btnNext);
    const foot = document.createElement('div'); foot.className = 'foot'; foot.append(this.btnPrev, this.btnSkip, this.btnHide, this.btnExit);
    this.confirm.className = 'confirm'; this.confirm.hidden = true;
    const q = document.createElement('span'); q.textContent = t('ui.exitConfirm');
    this.confirm.append(q, btn('', t('ui.exitYes'), () => { this.setConfirm(false); this.api?.exit(); }), btn('primary', t('ui.exitNo'), () => { this.setConfirm(false); }));
    const body = document.createElement('div'); body.className = 'body'; body.append(this.text, this.note, this.msg);
    this.foot = foot;
    this.bubble.append(this.heading, body, this.dots, btns, foot, this.confirm);
    this.avatar.className = getReducedMotion() ? 'avatar' : 'avatar bob';
    this.offMotion = onReducedMotion((on) => this.avatar.classList.toggle('bob', !on));
    this.avatar.title = t('ui.name'); this.avatar.setAttribute('aria-label', t('ui.unhide'));
    this.avatar.addEventListener('click', () => { if (this.tutorialOn) this.api?.minimise(!this.bubble.hidden); else this.toggleAdvice(); });
    this.avatar.append(avatarSvg('idle'));
    // Advice mode (M5.1): a fixed 340x214 card (same box as the lesson bubble) opened by a small badge beside the avatar.
    this.advCard.className = 'advice'; this.advCard.hidden = true; this.advCard.setAttribute('role', 'region'); this.advCard.setAttribute('aria-label', `${RANGER_NAME}: ${ADVISOR_UI.title}`);
    const ah = document.createElement('div'); ah.className = 'ah';
    const an = document.createElement('b'); an.textContent = RANGER_NAME;
    const aq = document.createElement('span'); aq.textContent = ADVISOR_UI.title;
    ah.append(an, aq, btn('', ADVISOR_UI.close, () => this.toggleAdvice(false)));
    (ah.lastElementChild as HTMLElement).style.cssText = 'font-size:11px;padding:0 6px';
    this.advList.className = 'al';
    const af = document.createElement('div'); af.className = 'foot2'; af.textContent = ADVISOR_UI.snoozeNote;
    this.advCard.append(ah, this.advList, af);
    this.advBadge.className = 'advbadge'; this.advBadge.hidden = true;
    this.advBadge.addEventListener('click', () => this.toggleAdvice());
    this.arow.className = 'arow'; this.arow.append(this.avatar, this.advBadge);
    this.wrap.append(this.hintBox, this.bubble, this.advCard, this.goals, this.arow);
    this.root.append(this.wrap);
    // Nothing rendered yet: no lesson => the bubble (and its buttons) stay hidden. A hint() before the first render() used to unhide the wrap and show
    // the empty bubble (no title / text / dots, every button) - the 'blank dialog' bug.
    this.bubble.hidden = true; this.goals.hidden = true;
    for (const b of [this.btnShow, this.btnDo, this.btnNext, this.btnSkip, this.btnPrev]) b.hidden = true;
    this.wrap.hidden = true;
  }

  connectedCallback(): void { this.style.pointerEvents = 'none'; }
  disconnectedCallback(): void { super.disconnectedCallback(); this.offMotion?.(); this.offMotion = null; if (this.hintTimer) { clearTimeout(this.hintTimer); this.hintTimer = null; } }

  bind(api: AssistantApi): void { this.api = api; }

  /** The exit confirmation replaces the footer in place so the dialog never changes size. */
  private setConfirm(on: boolean): void { this.confirm.hidden = !on; if (this.foot) this.foot.hidden = on; }

  private setExpression(e: Expression): void {
    if (e === this.expr && this.avatar.firstElementChild) return;
    this.expr = e;
    this.avatar.replaceChildren(avatarSvg(e));
  }

  get minimised(): boolean { return this.bubble.hidden; }
  get visible(): boolean { return !this.wrap.hidden; }

  private setRich(el: HTMLElement, src: string): void {
    el.replaceChildren(...parseRich(src).map((sp) => {
      if (sp.kind === 'text') return document.createTextNode(sp.text);
      const n = document.createElement(sp.kind === 'bold' ? 'b' : sp.kind === 'key' ? 'kbd' : 'em');
      n.textContent = sp.text;
      return n;
    }));
  }

  /** Render the engine view (cheap when nothing changed). */
  render(v: EngineView): void {
    const sig = JSON.stringify(v);
    if (sig === this.sig) return;
    this.sig = sig;
    const st = v.step;
    const on = v.status !== 'off' && (st !== null || v.status === 'complete' || v.status === 'blocked');
    this.tutorialOn = v.status === 'active' || v.status === 'blocked';
    this.tutHidden = !on && !v.goals;
    this.wrap.hidden = this.tutHidden && !this.advVisible;
    this.bubble.hidden = v.minimised || !(on && st);
    this.goals.hidden = !v.goals;
    if (!st) {
      // finished / blocked: a short closing bubble
      if (v.status === 'complete' && v.message) { this.bubble.hidden = v.minimised; this.heading.textContent = t('ui.done'); this.setRich(this.text, v.message); }
      this.note.textContent = ''; this.msg.textContent = ''; this.dots.replaceChildren();
      for (const b of [this.btnShow, this.btnDo, this.btnNext, this.btnSkip, this.btnPrev]) b.hidden = true;
      this.setExpression(v.status === 'blocked' ? 'worried' : 'cheer');
    } else {
      this.heading.textContent = st.title;
      this.setRich(this.text, st.text);
      this.note.textContent = v.note ?? ''; this.note.hidden = !v.note;
      this.msg.textContent = v.message ?? ''; this.msg.hidden = !v.message;
      const dots: HTMLElement[] = [];
      for (let i = 1; i <= st.total; i++) { const d = document.createElement('span'); d.className = `dot${i < st.index ? ' done' : i === st.index ? ' on' : ''}`; dots.push(d); }
      const lbl = document.createElement('span'); lbl.textContent = ' ' + t('ui.progress', { n: st.index, total: st.total });
      this.dots.replaceChildren(...dots, lbl);
      this.btnShow.hidden = false;
      this.btnDo.disabled = !st.canDo;
      this.btnDo.textContent = st.doLabel === 'jump' ? '☀️ ' + (st.price ? t('ui.doPrice', { price: `$${st.price.toLocaleString('en-US')}` }) : t('ui.do')) : st.price ? t('ui.doPrice', { price: `$${st.price.toLocaleString('en-US')}` }) : t('ui.do');
      this.btnDo.hidden = st.ack;
      this.btnNext.hidden = !st.canNext;
      this.btnSkip.hidden = st.ack; this.btnPrev.hidden = !this.api?.prev;
      this.setExpression(st.expr);
    }
    if (v.goals) {
      const g = v.goals;
      const row = (done: boolean, text: string): HTMLElement => { const r = document.createElement('div'); r.className = `g${done ? ' done' : ''}`; r.textContent = `${done ? '✔' : '○'} ${text}`; return r; };
      const h = document.createElement('h4'); h.textContent = t('ui.goals');
      this.goals.replaceChildren(h,
        row(g.guests.done, `${t('ui.goal.guests', { n: g.guests.need })} (${g.guests.have})`),
        row(g.stars.done, `${t('ui.goal.rating', { n: g.stars.need })} (${g.stars.have}★)`),
        row(g.profit.done, t('ui.goal.profit')));
    }
    // Narrow windows (< 1100 px): the bubble would cover the dock, so it starts minimised as a badge (once; the player can reopen it).
    if (!this.narrowDone && st && !v.minimised && typeof window !== 'undefined' && window.innerWidth < 1100) { this.narrowDone = true; this.api?.minimise(true); }
    this.wrap.classList.toggle('min', this.bubble.hidden);
    this.avatar.setAttribute('aria-label', v.minimised ? t('ui.unhide') : t('ui.avatarLabel'));
    this.avatar.title = v.minimised ? t('ui.unhide') : `${t('ui.name')} · ${t('ui.avatarLabel')}`;
    this.syncAdvice();
  }

  // ---- Advice mode (M5.1 Task 4): Ranger Rudi's 'What should I do next?'. The tutorial has priority: while it runs the badge and card are hidden. ----
  bindAdvice(api: AdviceApi): void { this.advApi = api; }
  get adviceOpen(): boolean { return !this.advCard.hidden; }
  get adviceBadgeVisible(): boolean { return !this.advBadge.hidden; }
  /** Badge or card is on screen. */
  private get advVisible(): boolean { return !this.tutorialOn && (this.advView.count > 0 || this.advOpen); }

  toggleAdvice(open = !this.advOpen): void { this.advOpen = open; this.syncAdvice(); }

  renderAdvice(v: AdviceView): void {
    this.advView = v;
    this.syncAdvice();
  }

  private syncAdvice(): void {
    const v = this.advView, on = !this.tutorialOn;
    if (!on) this.advOpen = false;
    this.advBadge.hidden = !on || (v.count === 0 && !this.advOpen);
    this.advCard.hidden = !on || !this.advOpen;
    this.advBadge.classList.toggle('open', this.advOpen);
    const lbl = document.createElement('span'); lbl.className = 'lbl'; lbl.textContent = `${ADVISOR_UI.badge} `;
    this.advBadge.replaceChildren(icon('bulb', 14), lbl, document.createTextNode(`(${v.count})`));
    this.advBadge.setAttribute('aria-expanded', String(this.advOpen));
    this.advBadge.title = `${RANGER_NAME}: ${ADVISOR_UI.title}`;
    if (!this.advCard.hidden) {
      const rows: HTMLElement[] = v.items.map((a) => {
        const it = document.createElement('div'); it.className = 'it'; it.dataset.id = a.id;
        const tr = document.createElement('div'); tr.className = 'tr';
        const sev = document.createElement('span'); sev.className = `sev ${a.severity}`;
        const tt = document.createElement('span'); tt.className = 'tt'; tt.textContent = a.title; tt.title = a.title;
        tr.append(sev, tt, btn('primary', ADVISOR_UI.show, () => { this.advApi?.show(a.id); if (typeof window !== 'undefined' && window.innerWidth < 1100) this.toggleAdvice(false); }), btn('', ADVISOR_UI.dismiss, () => this.advApi?.dismiss(a.id)));
        const why = document.createElement('p'); why.className = 'why'; why.textContent = a.why; why.title = a.why;
        it.append(tr, why);
        if (a.friendly) { const f = document.createElement('div'); f.className = 'fr why'; f.textContent = `${RANGER_NAME}: ${a.friendly}`; it.append(f); }
        return it;
      });
      if (!rows.length) {
        const e = document.createElement('div'); e.className = 'empty'; e.textContent = ADVISOR_UI.empty;
        const f = document.createElement('div'); f.className = 'empty fr'; f.textContent = `${RANGER_NAME}: ${ADVISOR_UI.emptyFriendly}`;
        rows.push(e, f);
      }
      this.advList.replaceChildren(...rows);
    }
    // advice-only mode owns the avatar face (the tutorial sets its own while it runs)
    if (on) this.setExpression(v.items.some((a) => a.severity === 'urgent') ? 'worried' : v.count === 0 ? 'cheer' : 'idle');
    this.wrap.hidden = this.tutHidden && !this.advVisible && !this.hintVisible;
    this.wrap.classList.toggle('min', this.bubble.hidden && !this.advOpen);
  }

  /** A gentle one-shot hint bubble above the avatar (auto-hides; Dismiss closes it). Works with or without a tutorial. */
  hint(text: string, ms = 14000): void {
    this.wrap.hidden = false;
    this.setRich(this.hintText, `**${t('ui.hintTitle')}:** ${text}`);
    this.hintBox.hidden = false;
    if (this.hintTimer) clearTimeout(this.hintTimer);
    this.hintTimer = ms > 0 ? setTimeout(() => this.dismissHint(), ms) : null;
  }
  dismissHint(): void {
    this.hintBox.hidden = true;
    if (this.hintTimer) { clearTimeout(this.hintTimer); this.hintTimer = null; }
    if (this.bubble.hidden && this.goals.hidden && this.sig === '' && !this.advVisible) this.wrap.hidden = true;
  }
  get hintVisible(): boolean { return !this.hintBox.hidden; }
  get exitConfirmVisible(): boolean { return !this.confirm.hidden; }
}

