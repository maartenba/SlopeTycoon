import { Modal } from '../modal';
import { StElement } from './StElement';

export interface PauseMenuApi { resume?(): void; save(): void; load(): void; settings(): void; help(): void; mainMenu(): void; trophies?(): void }

/** Esc pause menu (shared dialog frame, sm). Save / Load / Settings / Help open ABOVE it (it stays underneath); Esc closes the top dialog only. */
export class StPauseMenu extends StElement {
  private api: PauseMenuApi | null = null;
  private readonly dlg: Modal;
  protected css(): string {
    return ':host{display:block;width:0;height:0}.menu{display:flex;flex-direction:column;gap:8px;align-items:stretch}.menu button{display:flex;align-items:center;gap:10px;padding:8px 14px;font-size:var(--fs-lg);text-align:left}.menu button .i{width:22px;text-align:center}.menu hr{width:100%;border:0;border-top:1px solid #34465e;margin:2px 0}';
  }
  constructor() {
    super();
    this.dlg = new Modal(this.root, { title: 'Paused', icon: '⏸', size: 'sm', onOpen: () => this.setAttribute('open', ''), onClose: () => this.removeAttribute('open') });
  }
  get isOpen(): boolean { return this.dlg.isOpen; }
  open(): void { this.dlg.open(); }
  close(): void { this.dlg.close(); }
  toggle(): void { if (this.isOpen) this.close(); else this.open(); }
  bind(api: PauseMenuApi): void {
    this.api = api;
    const mk = (icon: string, t: string, fn: () => void, closeFirst: boolean, cls = ''): HTMLButtonElement => {
      const b = document.createElement('button'); if (cls) b.className = cls;
      const i = document.createElement('span'); i.className = 'i'; i.textContent = icon; b.append(i, document.createTextNode(t)); b.dataset.action = t.toLowerCase().replace(/\W+/g, '-');
      b.addEventListener('click', () => { if (closeFirst) this.close(); fn(); }); return b;
    };
    const menu = document.createElement('div'); menu.className = 'menu';
    menu.append(
      mk('▶', 'Resume', () => api.resume?.(), true, 'primary'), document.createElement('hr'),
      mk('💾', 'Save game', () => api.save(), false), mk('📂', 'Load game', () => api.load(), false),
      ...(api.trophies ? [mk('🏆', 'Trophies', () => api.trophies!(), false)] : []), mk('⚙', 'Settings', () => api.settings(), false), mk('❓', 'Help & keys', () => api.help(), false), document.createElement('hr'),
      mk('⌂', 'Main menu', () => api.mainMenu(), true),
    );
    this.dlg.body.replaceChildren(menu);
  }
}
