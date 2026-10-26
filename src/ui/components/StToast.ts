import { ToastLimiter, loadMuted, saveMuted } from '../toastLimiter';
import type { Severity, Tier } from '../newsFormat';
import { sentence } from '../text';
import { icon, type IconName } from '../icons';
import { StElement } from './StElement';

export type ToastKind = 'info' | 'error' | 'warn';
const SEV: Record<ToastKind, Severity> = { info: 'info', warn: 'warn', error: 'bad' };

/** Toasts go through ToastLimiter: duplicates coalesce into a ×N badge, max 4 visible, severity priority, muted categories. */
export class StToast extends StElement {
  private box = document.createElement('div');
  private muted = loadMuted();
  readonly limiter = new ToastLimiter({ muted: () => this.muted, maxVisible: 4, cooldownMs: 15000 });
  private timer = 0;

  protected css(): string {
    return ':host{position:absolute;top:56px;left:50%;transform:translateX(-50%);pointer-events:none}.box{display:flex;flex-direction:column;gap:4px;align-items:center}.t{padding:5px 10px;border-radius:4px;background:rgba(20,28,40,0.9);border:1px solid #5a7090}.t.error{border-color:#ff5555;background:rgba(80,20,20,0.9)}.t.warn{border-color:#e0a030}.t.ach{display:flex;align-items:center;gap:7px;font-size:calc(12.5px * var(--ui-scale, 1));padding:4px 10px;background:rgba(20,28,40,0.82);border-color:#a88a3c;color:#e8dcc0}.t.ach .ic{color:#e0b84a;flex:none}.t.good{border-color:#4caf50}button{pointer-events:auto;margin-left:8px;cursor:pointer}b.n{margin-left:6px;background:#5a7090;border-radius:8px;padding:0 6px;font-size:calc(11px * var(--ui-scale, 1))}';
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
    this.limiter.push({ key: opts.key ?? `${kind}:${text}`, text, severity: opts.severity ?? SEV[kind], category: opts.category, tier: opts.tier, action: opts.action, ttlMs: opts.ttlMs, icon: opts.icon }, now);
    this.render();
    void ms;
  }

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
