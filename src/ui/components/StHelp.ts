import { siteUrl } from '../siteLink';
import { SHORTCUTS } from '../shortcuts';
import { t } from '../../tutorial/strings';
import { Modal } from '../modal';
import { StElement } from './StElement';

/** Help & keys dialog (shared dialog frame, lg). Toggle with ? / H (wired in main) or the small "?" button bottom-right; also from the main + pause menus. */
export class StHelp extends StElement {
  private readonly dlg: Modal;
  protected css(): string {
    return ':host{position:absolute;right:8px;bottom:8px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px 28px}' +
      '.grid h3{margin:0 0 4px;font:400 var(--fs-lg)/1.2 var(--font-display);color:#ffd070}.r{display:flex;gap:12px;justify-content:space-between;padding:1px 0}.k{font-weight:800;color:#ffd070;white-space:nowrap}.a{text-align:right;color:#dbe6f6}';
  }
  constructor() {
    super();
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = '?';
    btn.title = 'Keyboard shortcuts (? or H)';
    btn.addEventListener('click', () => this.toggle());
    this.dlg = new Modal(this.root, { title: 'Help & keyboard shortcuts', icon: '❓', size: 'lg', pausesGame: true });
    const grid = document.createElement('div'); grid.className = 'grid';
    for (const g of SHORTCUTS) {
      const box = document.createElement('div');
      const h = document.createElement('h3');
      h.textContent = g.title;
      box.appendChild(h);
      for (const [k, a] of g.items) {
        const r = document.createElement('div');
        r.className = 'r';
        r.append(Object.assign(document.createElement('span'), { className: 'k', textContent: k }), Object.assign(document.createElement('span'), { className: 'a', textContent: a }));
        box.appendChild(r);
      }
      grid.appendChild(box);
    }
    this.dlg.body.append(grid);
    const done = document.createElement('button'); done.className = 'primary'; done.dataset.autofocus = ''; done.textContent = 'Close'; done.addEventListener('click', () => this.dlg.close());
    const guide = siteUrl('guide/');
    if (guide) this.dlg.footer.append(Object.assign(document.createElement('a'), { href: guide, textContent: 'Player guide', className: 'btn', target: '_blank', rel: 'noopener' }));
    this.dlg.footer.append(done);
    this.btn = btn;
    this.root.append(btn);
  }
  private btn: HTMLButtonElement;
  /** The small bottom-right "?" trigger (hidden when another screen, like the main menu, owns the layout). */
  setButtonVisible(on: boolean): void { this.btn.hidden = !on; }
  /** Adds a 'Replay tutorial' button to the footer (Task 34a). */
  bindTutorial(replay: () => void): void {
    if (this.replayBtn) return;
    const b = document.createElement('button');
    b.textContent = t('ui.replay');
    b.dataset.tutorialId = 'help:replay';
    b.addEventListener('click', () => { this.toggle(false); replay(); });
    this.replayBtn = b;
    this.dlg.footer.prepend(b);
  }
  private replayBtn: HTMLButtonElement | null = null;
  get isOpen(): boolean { return this.dlg.isOpen; }
  open(): void { this.dlg.open(); }
  close(): void { this.dlg.close(); }
  toggle(force?: boolean): void { this.dlg.toggle(force); }
}
