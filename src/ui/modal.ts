/**
 * One dialog system for the whole UI (docs/ui-kit.md).
 *
 * `Modal` builds the shared frame inside any shadow root: a fixed `.layer` (centred, no transforms so fixed popups inside keep working)
 * with a dimmed backdrop, a `.dlg` card (header: icon + title + ✕, scrolling body, footer actions) in one of 3 widths.
 * `modalStack` is the single global stack: z-order (each opened modal gets a higher z-index than the one below), Esc closes ONLY the top
 * entry (dropdown popups are entries too), focus is trapped in the top dialog and restored to the opener when it closes.
 * The main menu is a *screen*, not a dialog: it keeps z-index 30; every dialog starts at {@link MODAL_Z0} so it always opens above it.
 */
import type { ModalSize } from './tokens';
import { modalPause } from './modalPauseGate';
export type { ModalSize };

export const MODAL_Z0 = 100;

export interface ModalTrap { containsFocus(): boolean; cycle(back: boolean): void }
export interface StackEntry { close(): void; /** Escape closes it (default true). */ escapable?: boolean; /** focus-trap (dialogs only) */ trap?: ModalTrap }

class ModalStack {
  private entries: StackEntry[] = [];
  get size(): number { return this.entries.length; }
  get top(): StackEntry | undefined { return this.entries[this.entries.length - 1]; }
  /** Number of real dialogs (popups excluded). */
  get dialogs(): number { return this.entries.filter((e) => e.trap).length; }
  push(e: StackEntry): number { this.remove(e); this.entries.push(e); return MODAL_Z0 + this.entries.length * 2; }
  remove(e: StackEntry): void { const i = this.entries.indexOf(e); if (i >= 0) this.entries.splice(i, 1); }
  has(e: StackEntry): boolean { return this.entries.includes(e); }
  /** Esc: close the top entry only. Returns whether something was closed. */
  closeTop(): boolean { const t = this.top; if (!t || t.escapable === false) return false; t.close(); return true; }
  clear(): void { for (const e of [...this.entries].reverse()) e.close(); this.entries = []; }
}
export const modalStack = new ModalStack();

let installed = false;
function installKeys(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  // CAPTURE on window, registered when this module is first imported (before main.ts adds its own Esc handlers): Esc closes the top layer only.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalStack.size) {
      if (modalStack.closeTop()) { e.preventDefault(); e.stopImmediatePropagation(); }
      return;
    }
    if (e.key === 'Tab' && modalStack.top?.trap) {
      const t = modalStack.top.trap;
      e.preventDefault();
      t.cycle(t.containsFocus() ? e.shiftKey : false);
    }
  }, true);
}
installKeys();

export interface ModalOpts {
  title: string;
  icon?: string;
  size?: ModalSize;
  label?: string;
  /** Click on the dimmed backdrop closes it (default true; false for destructive / busy dialogs). */
  backdropClose?: boolean;
  /** Show the ✕ (default true). */
  closable?: boolean;
  /** Return false to veto closing (e.g. while a new game is generating). */
  beforeClose?(): boolean | void;
  /** While open, the running game is paused (see ModalPauseGate): the previous speed returns when the last such dialog closes. */
  pausesGame?: boolean;
  onOpen?(): void;
  onClose?(): void;
}

const FOCUSABLE = 'button:not([disabled]),input:not([disabled]):not([type=hidden]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"]),st-select:not([disabled]),summary,a[href]';

/** Deepest focused element across shadow roots. */
export function deepActive(): HTMLElement | null {
  let a: Element | null = typeof document !== 'undefined' ? document.activeElement : null;
  while (a && (a as HTMLElement).shadowRoot?.activeElement) a = (a as HTMLElement).shadowRoot!.activeElement;
  return a as HTMLElement | null;
}

export class Modal implements StackEntry {
  readonly layer = document.createElement('div');
  readonly frame = document.createElement('div');
  readonly header = document.createElement('header');
  readonly body = document.createElement('div');
  readonly footer = document.createElement('footer');
  readonly titleEl = document.createElement('h2');
  readonly iconEl = document.createElement('span');
  readonly closeBtn = document.createElement('button');
  readonly trap: ModalTrap;
  private opener: HTMLElement | null = null;
  private opened = false;
  private holding = false;
  constructor(private readonly root: ShadowRoot, readonly opts: ModalOpts) {
    this.layer.className = 'layer';
    const bd = document.createElement('div'); bd.className = 'bd'; bd.setAttribute('aria-hidden', 'true');
    bd.addEventListener('mousedown', () => { if (opts.backdropClose !== false) this.close(); });
    this.frame.className = `dlg ${opts.size ?? 'md'}`;
    this.frame.setAttribute('role', 'dialog'); this.frame.setAttribute('aria-modal', 'true'); this.frame.setAttribute('aria-label', opts.label ?? opts.title);
    this.iconEl.className = 'ic'; this.iconEl.setAttribute('aria-hidden', 'true'); this.iconEl.textContent = opts.icon ?? '';
    this.titleEl.textContent = opts.title;
    this.closeBtn.className = 'x ghost icon'; this.closeBtn.textContent = '✕'; this.closeBtn.title = 'Close (Esc)'; this.closeBtn.setAttribute('aria-label', 'Close'); this.closeBtn.dataset.action = 'close';
    this.closeBtn.addEventListener('click', () => this.close());
    this.header.append(this.iconEl, this.titleEl);
    if (opts.closable !== false) this.header.append(this.closeBtn);
    if (!opts.icon) this.iconEl.hidden = true;
    this.body.className = 'body';
    this.frame.append(this.header, this.body, this.footer);
    this.layer.append(bd, this.frame);
    this.trap = {
      containsFocus: () => { const a = this.root.activeElement; return !!a && this.frame.contains(a); },
      cycle: (back) => this.cycleFocus(back),
    };
    this.root.append(this.layer);
  }
  get isOpen(): boolean { return this.opened; }
  setTitle(t: string, icon?: string): void { this.titleEl.textContent = t; this.frame.setAttribute('aria-label', t); if (icon !== undefined) { this.iconEl.textContent = icon; this.iconEl.hidden = !icon; } }
  open(): void {
    if (this.opened) { this.layer.style.zIndex = String(modalStack.push(this)); return; }
    this.opened = true;
    this.opener = deepActive();
    this.layer.style.zIndex = String(modalStack.push(this));
    this.layer.classList.add('open');
    if (this.opts.pausesGame && !this.holding) { this.holding = true; modalPause.enter(); }
    this.opts.onOpen?.();
    const list = this.focusables();
    const target = list.find((e) => e.hasAttribute('data-autofocus')) ?? list.find((e) => e !== this.closeBtn) ?? this.closeBtn;
    try { target.focus(); } catch { /* not focusable */ }
  }
  close(): void {
    if (!this.opened) return;
    if (this.opts.beforeClose?.() === false) return;
    this.opened = false;
    modalStack.remove(this);
    this.layer.classList.remove('open'); this.layer.style.zIndex = '';
    this.opts.onClose?.();
    if (this.holding) { this.holding = false; modalPause.leave(); }
    const o = this.opener; this.opener = null;
    if (o && o.isConnected) { try { o.focus(); } catch { /* gone */ } }
  }
  toggle(force?: boolean): void { const want = force ?? !this.opened; if (want) this.open(); else this.close(); }
  focusables(): HTMLElement[] {
    return [...this.frame.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => !e.hidden && !e.closest('[hidden]') && (e as HTMLButtonElement).disabled !== true);
  }
  private cycleFocus(back: boolean): void {
    const list = this.focusables();
    if (!list.length) return;
    const a = this.root.activeElement as HTMLElement | null;
    const i = a ? list.findIndex((e) => e === a || e.contains(a)) : -1;
    const next = i < 0 ? (back ? list.length - 1 : 0) : (i + (back ? -1 : 1) + list.length) % list.length;
    list[next]!.focus();
  }
}
