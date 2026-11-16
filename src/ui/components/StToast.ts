import { ToastLimiter, loadMuted, saveMuted } from '../toastLimiter';
import type { Severity, Tier } from '../newsFormat';
import { sentence } from '../text';
import { icon, type IconName } from '../icons';
import { StElement } from './StElement';
import { PHONE_MEDIA, ToastHold } from '../phoneCards';

export type ToastKind = 'info' | 'error' | 'warn';
const SEV: Record<ToastKind, Severity> = { info: 'info', warn: 'warn', error: 'bad' };

/** Toasts go through ToastLimiter: duplicates coalesce into a ×N badge, max 4 visible, severity priority, muted categories. */
export class StToast extends StElement {
  private box = document.createElement('div');
  private muted = loadMuted();
  readonly limiter = new ToastLimiter({ muted: () => this.muted, maxVisible: 4, cooldownMs: 15000 });
  private timer = 0;
  /** Phones: toasts that arrive while a map tool is active are held and shown one at a time after it ends (docs/mobile-ui-v2.md). */
  private readonly hold = new ToastHold<Parameters<StToast['show']>>();
  private drain = 0;
  private obs: MutationObserver | null = null;

  protected css(): string {
    return ':host{position:absolute;top:56px;left:50%;transform:translateX(-50%);pointer-events:none}.box{display:flex;flex-direction:column;gap:4px;align-items:center}.t{padding:5px 10px;border-radius:4px;background:rgba(20,28,40,0.9);border:1px solid #5a7090}.t.error{border-color:#ff5555;background:rgba(80,20,20,0.9)}.t.warn{border-color:#e0a030}.t.ach{display:flex;align-items:center;gap:7px;font-size:calc(12.5px * var(--ui-scale, 1));padding:4px 10px;background:rgba(20,28,40,0.82);border-color:#a88a3c;color:#e8dcc0}.t.ach .ic{color:#e0b84a;flex:none}.t.good{border-color:#4caf50}button{pointer-events:auto;margin-left:8px;cursor:pointer}b.n{margin-left:6px;background:#5a7090;border-radius:8px;padding:0 6px;font-size:calc(11px * var(--ui-scale, 1))}@media (max-width:520px),(max-height:520px){:host{top:calc(112px + env(safe-area-inset-top,0px));bottom:auto;max-width:calc(100vw - 24px)}.t{font-size:calc(12px * var(--ui-scale, 1));padding:4px 8px}.t:not(:last-child){display:none}}';
  }

  constructor() {
    super();
    this.box.className = 'box';
    this.box.setAttribute('role', 'status');
    this.root.appendChild(this.box);
  }

  mutedCategories(): ReadonlySet<string> { return this.muted; }
  setMuted(cat: string, on: boolean): void { if (on) this.muted.add(cat); else this.muted.delete(cat); saveMuted(this.muted); }

  show(text: string, kind: ToastKind = 'info', ms = 3500, opts: { key?: string; category?: string; severity?: Severity; tier?: Tier; action?: { label: string; run: () => void }; ttlMs?: number; icon?: IconName } = {}): void {
    const now = performance.now();
    text = sentence(text); // sink: user-facing text always starts uppercase
    if (this.phoneTool()) {
      // critical alerts and tool errors take the tool bar's message row (a single line, 6 s); everything else waits until the tool ends
      if (opts.tier === 'critical' || kind === 'error') window.dispatchEvent(new CustomEvent('st-tool-alert', { detail: { text, kind } }));
      else { this.hold.held = true; this.hold.offer([text, kind, ms, opts]); }
      return;
    }
    this.limiter.push({ key: opts.key ?? `${kind}:${text}`, text, severity: opts.severity ?? SEV[kind], category: opts.category, tier: opts.tier, action: opts.action, ttlMs: opts.ttlMs, icon: opts.icon }, now);
    this.render();
    void ms;
  }

  private phoneTool(): boolean { return typeof matchMedia === 'function' && matchMedia(PHONE_MEDIA).matches && document.documentElement.hasAttribute('data-toolfirst'); }
  /** The tool ended (data-toolfirst removed): show the held toasts, one at a time. */
  private release(): void {
    if (this.phoneTool() || this.drain) return;
    this.hold.held = false;
    const step = (): void => {
      if (this.phoneTool()) { this.hold.held = true; this.drain = 0; return; }
      const n = this.hold.next();
      if (!n) { this.drain = 0; return; }
      this.show(n[0], n[1], n[2], n[3]);
      this.drain = window.setTimeout(step, 3800);
    };
    step();
  }
  connectedCallback(): void {
    if (typeof MutationObserver === 'undefined') return;
    this.obs = new MutationObserver(() => { if (this.hold.size) this.release(); });
    this.obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-toolfirst'] });
  }
  disconnectedCallback(): void { this.obs?.disconnect(); this.obs = null; window.clearTimeout(this.drain); super.disconnectedCallback?.(); }

  private render(): void {
    const now = performance.now(), list = this.limiter.visible(now);
    this.box.replaceChildren(...list.map((t) => {
      const el = document.createElement('div');
      el.className = `t ${t.severity === 'bad' ? 'error' : t.severity}`;
      if (t.icon) { el.classList.add('ach'); const ic = icon(t.icon as IconName, 14); ic.classList.add('ic'); el.append(ic, document.createTextNode(t.text)); } else el.textContent = t.text;
      if (t.count > 1) { const b = document.createElement('b'); b.className = 'n'; b.textContent = `×${t.count}`; el.append(b); }
      if (t.action) { const a = t.action, btn = document.createElement('button'); btn.textContent = a.label; btn.addEventListener('click', () => a.run()); el.append(btn); }
      return el;
    }));
    window.clearTimeout(this.timer);
    if (list.length) this.timer = window.setTimeout(() => this.render(), Math.max(200, Math.min(...list.map((t) => t.expires)) - now + 20));
  }
}
