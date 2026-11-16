import { parseSeed } from '../format';
import { icon } from '../icons';
import { ago } from './StSaveLoad';
import { StElement } from './StElement';
import { makeSelect } from './StSelect';

export interface TopBarApi {
  rotate(dir: number): void;
  help(): void;
  /** Opens the sound & settings panel (⚙). */
  settings?(): void;
  /** ⌂ Back to the main menu (the host autosaves first / confirms). Replaces the old debug 'New map' control. */
  menu?(): void;
  /** Camera button: enter / exit photo mode (P). */
  photo?(): void;
  /** Statistics button: opens the charts dialog (I). */
  stats?(): void;
  /** Walk button (click without moving): opens 'Choose start' drop mode (Shift+V). V enters at the default path spot. */
  walk?(): void;
  /** Walk button dragged onto the map (Street-View style): begin (a pointer moved past the threshold), move (client px), end (released at client px: the host drops in when the point is over the map), cancel (Esc / pointer cancelled). */
  walkDrag?: { begin(): void; move(x: number, y: number): void; end(x: number, y: number): void; cancel(): void };
  /** Phones: Ranger Rudi's tips (opens the advice sheet) and the news feed sheet, reachable from the overflow menu. */
  rudi?(): void;
  news?(): void;
  /** Phones: read-only lines at the top of the overflow menu (date, weather, season). */
  info?(): string[];
  /** @deprecated legacy debug control (shown only when `menu` is not provided). */
  newMap?(size: 64 | 128 | 256, seed: number, startSeason?: 'winter' | 'spring' | 'summer' | 'autumn'): void;
  initial?: { size: number; seed: number };
  /** Season the current game started in (default winter). */
  initialSeason?: string;
  /** 💾 Save button (opens the Save dialog; Ctrl+S does the same). */
  saveLoad?(): void;
  /** 'Continue last save' button, shown via `showContinue(true)` once the host knows an autosave exists. */
  continueLast?(): void;
  /** Graphics quality selector (low/med/high). */
  quality?: { get(): string; set(q: string): void; options: readonly string[] };
}

/** Small top-left bar: rotate, new map (seed + size), help. */
export class StTopBar extends StElement {
  private contBtn: HTMLButtonElement | null = null;
  private saveBtn: HTMLButtonElement | null = null;
  private lastSaved: number | null = null;
  private offlinePill: HTMLElement | null = null; private installBtn: HTMLButtonElement | null = null;
  private ovfInfo: HTMLElement | null = null; private infoFn: (() => string[]) | null = null; private ovfInstall: HTMLButtonElement | null = null; private ovfCont: HTMLButtonElement | null = null;
  private pendingOffline = false; private pendingInstall: (() => void) | null = null;
  /** PWA: 'Offline' pill (Task 34). Safe to call before `bind`. */
  setOffline(on: boolean): void { this.pendingOffline = on; if (this.offlinePill) this.offlinePill.hidden = !on; }
  /** PWA: show the 'Install app' button while an install prompt is available (null hides it). */
  setInstall(fn: (() => void) | null): void { this.pendingInstall = fn; if (this.installBtn) this.installBtn.hidden = !fn; if (this.ovfInstall) this.ovfInstall.hidden = !fn; }
  /** Time of the last successful save (ms epoch); shown in the Save button's tooltip as 'Saved 2 min ago'. */
  setLastSaved(ms: number | null): void { this.lastSaved = ms; this.refreshSaveTip(); }
  refreshSaveTip(now = Date.now()): void {
    if (!this.saveBtn) return;
    const tip = `Save game (Ctrl+S)${this.lastSaved ? ` · saved ${ago(this.lastSaved, now)}` : ' · not saved yet'}`;
    this.saveBtn.title = tip; this.saveBtn.setAttribute('aria-label', tip); this.saveBtn.dataset.tip = tip;
  }
  showContinue(on: boolean): void { if (this.contBtn) this.contBtn.hidden = !on; if (this.ovfCont) this.ovfCont.hidden = !on; }
  /** Refresh the read-only date / weather lines of the overflow menu. */
  refreshInfo(): void { if (!this.ovfInfo) return; const lines = this.infoFn?.() ?? []; this.ovfInfo.replaceChildren(...lines.filter(Boolean).map((t) => Object.assign(document.createElement('div'), { textContent: t }))); this.ovfInfo.hidden = lines.length === 0; }

  protected css(): string {
    return ':host{position:absolute;top:8px;left:8px}input[type=text]{width:90px}.offline-pill{margin-left:6px;padding:1px 8px;border-radius:10px;background:#e0a030;color:#222;font-size:calc(12px * var(--ui-scale, 1));font-weight:600}.offline-pill[hidden],button[hidden]{display:none}.more,.ovf{display:none}'
      // Phones (docs/mobile-ui-v2.md): the bar is only Menu (left) and the overflow button (right) of the ONE top row; the HUD and the speed chip sit between them (styles.css). Everything else lives in the overflow menu (.ovf).
      + '@media (max-width:520px),(max-height:520px){.panel{display:contents}.panel>*:not(.keep):not(.more):not(.ovf){display:none!important}.keep,.more{display:inline-flex;align-items:center;justify-content:center;pointer-events:auto;min-width:44px;height:44px;padding:0 10px;font-weight:800;font-size:calc(16px * var(--ui-scale, 1));margin:0}.keep{order:0}.more{order:9}.keep .w{display:none}'
      + '.panel.open .ovf{display:grid;grid-template-columns:1fr 1fr;gap:6px;position:fixed;z-index:40;top:calc(56px + env(safe-area-inset-top,0px));right:calc(8px + env(safe-area-inset-right,0px));width:min(300px,calc(100vw - 16px - env(safe-area-inset-left,0px) - env(safe-area-inset-right,0px)));max-height:calc(100vh - 140px);overflow:auto;box-sizing:border-box;padding:8px;background:var(--c-panel,#141c28);border:1px solid rgba(90,112,144,.6);border-radius:var(--r-lg,12px);box-shadow:0 8px 24px rgba(0,0,0,.55);pointer-events:auto}'
      + '.ovf .info{grid-column:1/3;font-size:calc(12px * var(--ui-scale, 1));color:#cfe0f5;line-height:1.35;padding:0 2px 4px}.ovf .info div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ovf button{min-height:44px;justify-content:flex-start;text-align:left;padding:0 10px;font-size:calc(13px * var(--ui-scale, 1));display:flex;align-items:center;gap:6px}.ovf button[hidden]{display:none}.ovf .gfx{grid-column:1/3}}';
  }

  bind(api: TopBarApi): void {
    const p = document.createElement('div');
    p.className = 'panel';
    const btn = (label: string, title: string, fn: () => void, tutorialId?: string): HTMLButtonElement => {
      const b = document.createElement('button');
      b.textContent = label; b.title = title; b.setAttribute('aria-label', title); b.addEventListener('click', fn);
      if (tutorialId) b.dataset.tutorialId = tutorialId; // spotlight target (src/tutorial/ui-targets.ts)
      return b;
    };
    const sep = (): HTMLElement => Object.assign(document.createElement('span'), { className: 'sep' });
    const seed = document.createElement('input');
    seed.type = 'text'; seed.placeholder = 'seed'; seed.value = String(api.initial?.seed ?? Math.floor(Math.random() * 1e9));
    const size = makeSelect([64, 128, 256].map((n) => ({ value: String(n), label: String(n) })), String(api.initial?.size ?? 128), 'Map size');
    const season = makeSelect(['winter', 'spring', 'summer', 'autumn'].map((q) => ({ value: q, label: `Start: ${q}` })), api.initialSeason ?? 'winter', 'Start season of the new game');
    season.title = 'Start season of the new game';
    const gfx = makeSelect((api.quality?.options ?? []).map((q) => ({ value: q, label: `Graphics: ${q}` })), api.quality?.get() ?? '', 'Graphics quality', (v) => api.quality?.set(v));
    gfx.title = 'Graphics quality (shadows, resolution, tree detail, particles)';
    p.append(
      btn('⟲', 'Rotate left (Q)', () => api.rotate(-1)), btn('⟳', 'Rotate right (E)', () => api.rotate(1), 'topbar:rotate'), sep(),
      ...(api.menu ? [(() => { const b = btn('⌂', 'Back to the main menu (autosaves first)', () => api.menu?.(), 'topbar:menu'); b.classList.add('keep'); b.append(Object.assign(document.createElement('span'), { className: 'w', textContent: ' Menu' })); return b; })(), sep()] : api.newMap ? [seed, size, season, btn('New map', 'Generate a new map (reloads the page)', () => api.newMap?.(Number(size.value) as 64 | 128 | 256, parseSeed(seed.value), season.value as 'winter' | 'spring' | 'summer' | 'autumn')), sep()] : []),
      ...(api.walk ? [(() => {
        let dragged = false;
        const b = btn('', 'Walk mode: click to choose where to start (Shift+V), or drag me onto the map. V = start on the nearest path', () => { if (dragged) { dragged = false; return; } api.walk?.(); }, 'topbar:walk');
        b.append(icon('walk', 15)); b.classList.add('icon'); b.dataset.role = 'walk';
        if (api.walkDrag) {
          const d = api.walkDrag;
          let st: { id: number; x: number; y: number; on: boolean } | null = null;
          b.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; st = { id: e.pointerId, x: e.clientX, y: e.clientY, on: false }; });
          b.addEventListener('pointermove', (e) => {
            if (!st || e.pointerId !== st.id) return;
            if (!st.on && Math.hypot(e.clientX - st.x, e.clientY - st.y) > 8) { st.on = true; try { b.setPointerCapture(e.pointerId); } catch { /* synthetic */ } d.begin(); }
            if (st.on) d.move(e.clientX, e.clientY);
          });
          const up = (e: PointerEvent, cancel: boolean): void => {
            if (!st || e.pointerId !== st.id) return;
            const was = st.on; st = null;
            if (!was) return;
            dragged = true; setTimeout(() => { dragged = false; }, 400); // swallow the click that follows a drag
            if (cancel) d.cancel(); else d.end(e.clientX, e.clientY);
          };
          b.addEventListener('pointerup', (e) => up(e, false)); b.addEventListener('pointercancel', (e) => up(e, true));
        }
        return b;
      })()] : []),
      ...(api.photo ? [(() => { const b = btn('', 'Photo mode (P)', () => api.photo?.(), 'topbar:photo'); b.append(icon('camera', 15)); b.classList.add('icon'); return b; })()] : []),
      ...(api.stats ? [(() => { const b = btn('', 'Statistics (I)', () => api.stats?.(), 'topbar:stats'); b.append(icon('chart', 15)); b.classList.add('icon'); return b; })()] : []),
      ...(api.quality ? [gfx, sep()] : []),
      ...(api.saveLoad ? [(this.saveBtn = btn('💾 Save', 'Save game (Ctrl+S)', () => api.saveLoad?.(), 'topbar:save'))] : []),
      ...(api.continueLast ? [(this.contBtn = Object.assign(btn('▶ Continue', 'Load your most recent save', () => api.continueLast?.()), { hidden: true }))] : []),
      ...(api.settings ? [btn('⚙', 'Sound & settings (M mutes)', () => api.settings?.())] : []),
      btn('?', 'Keyboard shortcuts (? or H)', () => api.help()),
      (this.installBtn = Object.assign(btn('⤓ Install', 'Install Slope Tycoon as an app (works offline)', () => this.pendingInstall?.()), { hidden: !this.pendingInstall })),
      (this.offlinePill = Object.assign(document.createElement('span'), { className: 'offline-pill', textContent: 'Offline', title: 'No network: the game keeps working from the local cache', hidden: !this.pendingOffline })),
    );
    // Phones: the overflow button opens one menu with everything that is not in the top row (nothing is removed; desktop never shows it). Buttons here are separate instances with the same handlers.
    const more = btn('\u22EF', 'More: photo, statistics, save, settings, tips, news', () => { const on = !p.classList.contains('open'); p.classList.toggle('open', on); more.setAttribute('aria-expanded', String(on)); if (on) this.refreshInfo(); });
    more.className = 'more'; more.setAttribute('aria-expanded', 'false'); more.setAttribute('aria-haspopup', 'true'); more.dataset.tutorialId = 'topbar:more';
    const ovf = document.createElement('div'); ovf.className = 'ovf'; ovf.setAttribute('role', 'menu'); ovf.setAttribute('aria-label', 'More');
    this.ovfInfo = Object.assign(document.createElement('div'), { className: 'info' }); this.infoFn = api.info ?? null;
    ovf.append(this.ovfInfo);
    const closeOvf = (): void => { p.classList.remove('open'); more.setAttribute('aria-expanded', 'false'); };
    const item = (label: string, title: string, fn: () => void, tutorialId?: string, role?: string): HTMLButtonElement => {
      const b = btn(label, title, () => { closeOvf(); fn(); }, tutorialId); b.setAttribute('role', 'menuitem'); if (role) b.dataset.role = role; ovf.append(b); return b;
    };
    if (api.rudi) item("\u{1F4A1} Rudi's tips", "Ranger Rudi's tips and advice", () => api.rudi?.(), undefined, 'ovf-rudi');
    if (api.news) item('\u{1F4F0} News', 'News and reviews', () => api.news?.(), undefined, 'ovf-news');
    if (api.photo) item('\u{1F4F7} Photo', 'Photo mode (P)', () => api.photo?.(), undefined, 'ovf-photo');
    if (api.stats) item('\u{1F4CA} Statistics', 'Statistics (I)', () => api.stats?.(), undefined, 'ovf-stats');
    if (api.saveLoad) item('\u{1F4BE} Save', 'Save game (Ctrl+S)', () => api.saveLoad?.(), 'topbar:save', 'ovf-save');
    if (api.settings) item('\u2699 Settings', 'Sound & settings', () => api.settings?.(), undefined, 'ovf-settings');
    item('\u27F2 Rotate left', 'Rotate the view left', () => api.rotate(-1), 'topbar:rotate', 'ovf-rot-left'); item('\u27F3 Rotate right', 'Rotate the view right', () => api.rotate(1), undefined, 'ovf-rot-right');
    if (api.walk) item('\u{1F6B6} Walk', 'Walk mode: choose where to start', () => api.walk?.(), undefined, 'ovf-walk');
    if (api.continueLast) { this.ovfCont = item('\u25B6 Continue', 'Load your most recent save', () => api.continueLast?.()); this.ovfCont.hidden = !this.contBtn || this.contBtn.hidden; }
    this.ovfInstall = item('\u2913 Install', 'Install Slope Tycoon as an app (works offline)', () => this.pendingInstall?.()); this.ovfInstall.hidden = !this.pendingInstall;
    item('? Help', 'Keyboard shortcuts and help', () => api.help(), undefined, 'ovf-help');
    if (api.quality) { const g2 = makeSelect((api.quality.options ?? []).map((q) => ({ value: q, label: `Graphics: ${q}` })), api.quality.get(), 'Graphics quality', (v) => api.quality?.set(v)); g2.classList.add('gfx'); ovf.append(g2); }
    p.append(more, ovf);
    window.addEventListener('pointerdown', (e) => { if (p.classList.contains('open') && !e.composedPath().includes(this)) closeOvf(); }, true);
    this.root.appendChild(p);
    this.refreshSaveTip();
  }
}
