import { siteUrl } from '../siteLink';
import { logoSvg } from '../logo';
import { Modal } from '../modal';
import { StElement } from './StElement';

export interface MainMenuApi {
  version: string;
  /** Resolve true when a loadable save exists. */
  hasContinue(): Promise<boolean>;
  continueGame(): void;
  newGame(): void;
  /** Opens the scenario picker. */
  scenarios?(): void;
  /** Opens the trophy shelf. */
  trophies?(): void;
  loadGame?(): void;
  /** Present while a game is running behind the menu (opened via ⌂ Menu): shows Resume + Save game + Quit to title. */
  running?: { resume(): void; save?(): void; quit?(): void };
  tutorial(): void;
  settings?(): void;
  help(): void;
  /** True when WebGL failed: the menu then sits on a plain background. */
  plainBackground?: boolean;
}

/**
 * Title screen / game menu: a *screen*, not a dialog. Full-screen overlay BY DESIGN while shown (z-index 30, over the demo map or the paused game);
 * dialogs opened from it (New game, Load, Settings, Help, About) stack ABOVE it (z ≥ 100) and the menu stays underneath until they close.
 * The host removes it (`remove()`) once a game starts, `hide()` makes it `display:none`. Nothing full-screen ever stays behind (tests/ui-dom/mainmenu.test.ts).
 */
export class StMainMenu extends StElement {
  private api: MainMenuApi | null = null;
  private menu = document.createElement('div');
  private logo = document.createElement('div');
  private contBtn = document.createElement('button');
  private contHint = document.createElement('div');
  private installBtn = document.createElement('button');
  private offline = document.createElement('span');
  private foot = document.createElement('div');
  private readonly aboutDlg: Modal;
  private pendingInstall: (() => void) | null = null;
  private pendingOffline = false;

  protected css(): string {
    return ':host{position:fixed;inset:0;z-index:30;display:flex;flex-direction:column;align-items:center;justify-content:safe center;gap:10px;pointer-events:auto;overflow-y:auto;padding:16px;box-sizing:border-box}.bg{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 45%,rgba(8,14,24,.15),rgba(8,14,24,.62));z-index:-1}' +
      ':host(.plain) .bg{background:linear-gradient(#1b2a3d,#4a6f93)}:host(.ingame) .bg{background:rgba(8,14,24,.7)}' +
      '.logo{display:flex;justify-content:center;filter:drop-shadow(0 6px 18px rgba(0,0,0,.55))}.logo svg{height:clamp(150px,34vh,300px);width:auto}' +
      '.menu{width:min(320px,90vw);display:flex;flex-direction:column;gap:8px;padding:14px;background:rgba(14,22,34,.72);border:1px solid rgba(120,150,190,.3);border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.45);box-sizing:border-box}' +
      '.menu button{display:flex;align-items:center;gap:12px;width:100%;height:40px;padding:0 14px;font-size:15px;text-align:left}.menu button .i{width:22px;text-align:center;font-size:16px}.menu button.primary{height:44px;font-size:16px}' +
      '@media (max-height:860px){.logo svg{height:clamp(110px,24vh,300px)}.menu{gap:5px;padding:10px}.menu button{height:34px}.menu button.primary{height:38px}}' +
      '.hint{color:#9fb4cc;font-size:var(--fs-sm);text-align:center;min-height:0}.hint:empty{display:none}.offline{padding:1px 10px;border-radius:10px;background:#e0a030;color:#222;font-size:12px;font-weight:700;align-self:center}' +
      '.foot{color:#9fb4cc;font-size:var(--fs-sm);text-shadow:0 1px 3px #000;text-align:center}.about p{margin:0 0 8px;line-height:1.5}.about{display:flex;flex-direction:column;align-items:center;text-align:center}.about svg{height:120px;width:auto;margin-bottom:8px}';
  }

  constructor() {
    super();
    this.menu.className = 'menu'; this.menu.setAttribute('role', 'menu');
    this.logo.className = 'logo';
    this.foot.className = 'foot';
    this.offline.className = 'offline'; this.offline.textContent = 'Offline'; this.offline.title = 'No network: the game keeps working from the local cache'; this.offline.hidden = true;
    this.installBtn.hidden = true;
    this.aboutDlg = new Modal(this.root, { title: 'About Slope Tycoon', icon: 'ℹ', size: 'sm', pausesGame: true });
    const close = document.createElement('button'); close.className = 'primary'; close.dataset.autofocus = ''; close.textContent = 'Close'; close.addEventListener('click', () => this.aboutDlg.close());
    this.aboutDlg.footer.append(close);
    const bg = document.createElement('div'); bg.className = 'bg';
    this.root.append(bg, this.logo, this.menu, this.foot);
  }

  /** PWA hooks (safe before bind). */
  setOffline(on: boolean): void { this.pendingOffline = on; this.offline.hidden = !on; }
  setInstall(fn: (() => void) | null): void { this.pendingInstall = fn; this.installBtn.hidden = !fn; }
  /** Called by the host once the continue lookup finished (or directly by tests). */
  setContinue(has: boolean): void { this.contBtn.disabled = !has; this.contHint.textContent = has ? '' : 'No saved game yet'; }
  hide(): void { this.hidden = true; }
  show(): void { this.hidden = false; }
  showAbout(on: boolean): void { this.aboutDlg.toggle(on); }
  get aboutOpen(): boolean { return this.aboutDlg.isOpen; }

  bind(api: MainMenuApi): void {
    this.api = api;
    if (api.plainBackground) this.classList.add('plain');
    this.classList.toggle('ingame', !!api.running);
    const mk = (icon: string, text: string, title: string, fn: () => void, cls = ''): HTMLButtonElement => {
      const b = document.createElement('button'); if (cls) b.className = cls; b.title = title; b.setAttribute('role', 'menuitem'); b.dataset.action = text.toLowerCase().replace(/\W+/g, '-');
      const i = document.createElement('span'); i.className = 'i'; i.textContent = icon; b.append(i, document.createTextNode(text)); b.addEventListener('click', fn); return b;
    };
    this.logo.innerHTML = logoSvg({ variant: 'full', theme: 'dark' });
    this.foot.textContent = `v${api.version} · procedural everything`;
    this.contBtn = mk('▶', 'Continue', 'Load your newest save', () => api.continueGame(), 'primary'); this.setContinue(false);
    this.contHint.className = 'hint';
    this.installBtn = mk('⤓', 'Install app', 'Install Slope Tycoon (works offline)', () => this.pendingInstall?.()); this.installBtn.hidden = !this.pendingInstall;
    const r = api.running;
    this.menu.replaceChildren(
      ...(r ? [mk('▶', 'Resume game', 'Back to your resort', () => r.resume(), 'primary')] : [this.contBtn, this.contHint]),
      mk('✦', 'New game', 'Choose map size, seed, difficulty…', () => api.newGame(), r ? '' : ''),
      ...(api.scenarios ? [mk('🏔', 'Scenarios', 'Hand-made challenges with medals', () => api.scenarios?.())] : []),
      ...(api.trophies ? [mk('🏆', 'Trophies', 'Achievements, medals and cosmetic rewards', () => api.trophies?.())] : []),
      ...(r?.save ? [mk('💾', 'Save game', 'Save the running game (Ctrl+S)', () => r.save?.())] : []),
      ...(api.loadGame ? [mk('📂', 'Load game', 'Pick a save slot', () => api.loadGame?.())] : []),
      mk('🎓', 'Tutorial', 'Guided first-steps game on a small map', () => api.tutorial()),
      ...(api.settings ? [mk('⚙', 'Settings', 'Sound, graphics and gameplay', () => api.settings?.())] : []),
      mk('❓', 'Help & keys', 'Keyboard shortcuts', () => api.help()),
      mk('ℹ', 'About', 'Credits and licences', () => this.showAbout(true)),
      ...(r?.quit ? [mk('⏏', 'Quit to title', 'Autosave and return to the title screen', () => r.quit?.())] : []),
      this.installBtn, this.offline,
    );
    this.offline.hidden = !this.pendingOffline;
    const about = document.createElement('div'); about.className = 'about';
    about.innerHTML = `${logoSvg({ variant: 'mark' })}<p>Version ${api.version}. A cosy browser ski-resort tycoon.</p><p><b>Procedural everything:</b> terrain, models, textures, weather, music and sound are generated in code. The only bundled assets are two fonts: <b>Nunito</b> and <b>Lilita One</b> (SIL Open Font License 1.1, self-hosted).</p><p>The game code is private to this project; it bundles <a href="https://threejs.org" target="_blank" rel="noopener">three.js</a> (MIT).</p>${siteUrl() ? `<p><a data-site-link href="${siteUrl()}">Website &amp; guide</a></p>` : ''}`;
    this.aboutDlg.body.replaceChildren(about);
    void api.hasContinue().then((v) => { if (!api.running) this.setContinue(v); }).catch(() => this.setContinue(false));
  }
}
