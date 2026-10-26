/**
 * 'Choose start' cursor for walk mode: a small Street-View style figure (SVG pegman) that follows the pointer, plus a hint line. Pure DOM, no layout
 * impact (position:fixed, pointer-events:none). The figure is the cursor: the host hides the canvas cursor while the marker is shown.
 */
export const DROP_HINT = 'Click the map to drop in · Enter: nearest path · Esc: cancel';
const FIGURE = '<svg viewBox="0 0 24 32" width="26" height="34" aria-hidden="true"><ellipse cx="12" cy="29.5" rx="6" ry="2" fill="rgba(0,0,0,.35)"/><circle cx="12" cy="6" r="4.6" fill="CLR" stroke="#fff" stroke-width="1.4"/><path d="M12 11.5c-4 0-6.5 2.2-6.5 5.6V22h3v7h7v-7h3v-4.9c0-3.4-2.5-5.6-6.5-5.6z" fill="CLR" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>';

export class WalkDropMarker {
  readonly el = document.createElement('div');
  readonly hint = document.createElement('div');
  private shown = false;
  constructor() {
    const e = this.el; e.className = 'walk-drop-marker'; e.dataset.state = 'ok'; e.hidden = true; e.setAttribute('aria-hidden', 'true');
    e.style.cssText = 'position:fixed;left:0;top:0;z-index:60;pointer-events:none;transform:translate(-50%,-92%);filter:drop-shadow(0 2px 3px rgba(0,0,0,.5))';
    this.hint.className = 'walk-drop-hint'; this.hint.hidden = true; this.hint.setAttribute('role', 'status');
    this.hint.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:60;pointer-events:none;background:rgba(14,22,34,.92);color:#e6eefb;border:1px solid #5f7798;border-radius:8px;padding:6px 14px;font:600 13px system-ui,sans-serif;text-align:center;max-width:calc(100vw - 24px)';
    this.paint(true);
  }
  private paint(ok: boolean): void { this.el.innerHTML = FIGURE.replace(/CLR/g, ok ? '#2fbf71' : '#e5484d'); this.el.dataset.state = ok ? 'ok' : 'blocked'; }
  mount(parent: HTMLElement = document.body): void { parent.append(this.el, this.hint); }
  get visible(): boolean { return this.shown; }
  show(text = DROP_HINT): void { this.shown = true; this.el.hidden = false; this.hint.hidden = false; this.hint.textContent = text; }
  hide(): void { this.shown = false; this.el.hidden = true; this.hint.hidden = true; }
  /** Follow the pointer (client px); `ok` false = blocked tile (red figure, hint says where it will drop instead). */
  move(x: number, y: number, ok = true, text?: string): void {
    this.el.style.left = `${x}px`; this.el.style.top = `${y}px`;
    if ((this.el.dataset.state === 'ok') !== ok) this.paint(ok);
    if (text !== undefined) this.hint.textContent = text;
  }
  dispose(): void { this.el.remove(); this.hint.remove(); }
}
