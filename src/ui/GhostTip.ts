import type { TooltipData } from '../render/Overlays';

const COLORS = { error: '#ff8d8d', warn: '#ffc857', info: '#cfd8dc', ok: '#8be28b' } as const;

/**
 * Floating placement/terraform tooltip that follows the pointer: every blocking reason (red) with its hint, warnings (amber, non-blocking),
 * neutral notes. Plain DOM, pointer-events none, never a full-screen element. `Overlays.onTooltip` feeds it.
 */
export class GhostTip {
  readonly el: HTMLDivElement;

  constructor(parent: HTMLElement = document.body) {
    this.el = document.createElement('div');
    this.el.id = 'ghost-tip';
    this.el.setAttribute('role', 'status');
    this.el.style.cssText = 'position:fixed;left:0;top:0;display:none;max-width:340px;padding:6px 9px;border-radius:6px;background:rgba(18,24,32,.92);'
      + 'border:1px solid rgba(255,255,255,.18);font:12px/1.35 var(--font-ui);color:#e8eef2;pointer-events:none;z-index:30;box-shadow:0 2px 8px rgba(0,0,0,.4)';
    parent.appendChild(this.el);
  }

  show(t: TooltipData | null): void {
    if (!t || (!t.text && !t.lines?.length)) { this.el.style.display = 'none'; return; }
    this.el.replaceChildren();
    const lines = t.lines ?? [{ kind: t.blocked ? 'error' : 'info', text: t.text } as const];
    for (const l of lines) {
      const d = document.createElement('div');
      d.textContent = l.kind === 'error' ? `\u2716 ${l.text}` : l.kind === 'warn' ? `\u26a0 ${l.text}` : l.text;
      d.style.color = COLORS[l.kind];
      this.el.appendChild(d);
    }
    this.el.style.display = 'block';
    const pad = 16, w = this.el.offsetWidth, h = this.el.offsetHeight;
    const x = Math.max(4, Math.min(window.innerWidth - w - 4, t.x + pad)), y = Math.max(4, Math.min(window.innerHeight - h - 4, t.y + pad));
    this.el.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
  }
}
