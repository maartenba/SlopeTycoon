import { Modal, type ModalOpts, type ModalSize } from '../modal';
import { StElement } from './StElement';

export interface ModalAction { label: string; kind?: 'primary' | 'danger' | 'ghost' | ''; /** Return false to keep the dialog open. */ run?(): boolean | void; /** data-action for tests */ id?: string }
export interface ShowOpts { title: string; icon?: string; size?: ModalSize; body: string | Node; actions?: ModalAction[]; backdropClose?: boolean; closable?: boolean; /** Pause the running game while open (default true). */ pausesGame?: boolean; onClose?(): void }

/** Generic dialog element (About, confirm, bankrupt …): same frame as every other dialog. Use `showModal` / `confirmDialog` to mount one. */
export class StModal extends StElement {
  private readonly modal: Modal;
  private closedCb: (() => void) | null = null;
  constructor() {
    super();
    const o: ModalOpts = { title: '', pausesGame: true, onClose: () => { this.removeAttribute('open'); const c = this.closedCb; this.closedCb = null; c?.(); } };
    this.modal = new Modal(this.root, o);
  }
  get isOpen(): boolean { return this.modal.isOpen; }
  get dialog(): Modal { return this.modal; }
  show(o: ShowOpts): void {
    const m = this.modal;
    m.setTitle(o.title, o.icon ?? '');
    m.frame.className = `dlg ${o.size ?? 'sm'}`;
    Object.assign(m.opts, { backdropClose: o.backdropClose ?? true, closable: o.closable ?? true, pausesGame: o.pausesGame ?? true });
    m.closeBtn.hidden = o.closable === false;
    if (typeof o.body === 'string') { const p = document.createElement('div'); p.style.cssText = 'white-space:pre-line;line-height:1.45'; p.textContent = o.body; m.body.replaceChildren(p); } else m.body.replaceChildren(o.body);
    m.footer.replaceChildren(...(o.actions ?? []).map((a) => {
      const b = document.createElement('button'); b.textContent = a.label; if (a.kind) b.classList.add(a.kind); if (a.id) b.dataset.action = a.id;
      if (a.kind === 'primary' || a.kind === 'danger') b.dataset.autofocus = '';
      b.addEventListener('click', () => { if (a.run?.() !== false) m.close(); });
      return b;
    }));
    this.closedCb = o.onClose ?? null;
    this.setAttribute('open', '');
    m.open();
  }
  close(): void { this.modal.close(); }
  /** Click a footer action by data-action / label (tests). */
  clickAction(idOrLabel: string): boolean {
    const b = [...this.root.querySelectorAll<HTMLButtonElement>('footer button')].find((x) => x.dataset.action === idOrLabel || x.textContent === idOrLabel);
    b?.click(); return !!b;
  }
}

/** Mount a modal into `parent` (usually #ui); it removes itself when closed. */
export function showModal(parent: HTMLElement, o: ShowOpts): StModal {
  const m = document.createElement('st-modal') as StModal;
  parent.append(m);
  const user = o.onClose;
  m.show({ ...o, onClose: () => { user?.(); m.remove(); } });
  return m;
}

/** Yes/No confirm in the shared dialog frame. Resolves true on the confirm action, false on cancel / Esc / ✕ / backdrop. */
export function confirmDialog(parent: HTMLElement, o: { title: string; message: string; confirm?: string; cancel?: string; danger?: boolean; icon?: string }): Promise<boolean> {
  return new Promise((res) => {
    let ok = false;
    showModal(parent, {
      title: o.title, icon: o.icon ?? (o.danger ? '⚠' : '❔'), size: 'sm', body: o.message,
      actions: [{ label: o.cancel ?? 'Cancel', kind: 'ghost', id: 'cancel' }, { label: o.confirm ?? 'OK', kind: o.danger ? 'danger' : 'primary', id: 'confirm', run: () => { ok = true; } }],
      onClose: () => res(ok),
    });
  });
}
