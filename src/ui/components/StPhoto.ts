import { icon } from '../icons';
import { ASPECT_IDS, ASPECT_LABELS, FILTER_IDS, FILTER_LABELS, FRAME_IDS, FRAME_LABELS, aspectRect, filterCss, vignetteCss, type AspectId, type FilterId, type FrameId } from '@/render/view/postfx';
import { PHOTO_FOV_MAX, PHOTO_FOV_MIN, type PhotoSettings } from '@/render/view/PhotoMode';
import type { PhotoMeta } from '@/persist/PhotoStore';
import { StElement } from './StElement';

export interface PhotoGalleryApi {
  /** False when IndexedDB is unavailable (the tab then explains it). */
  available: boolean;
  list(): Promise<PhotoMeta[]>;
  /** Downloads the stored PNG again (local download only). */
  saveAgain(id: number): Promise<void>;
  /** Object URL of the full PNG for the larger view (caller revokes through `revoke`). */
  full(id: number): Promise<string | null>;
  remove(id: number): Promise<void>;
  clear(): Promise<void>;
}
export interface PhotoPanelApi {
  settings(): PhotoSettings;
  set(patch: Partial<PhotoSettings>): void;
  /** The in-game hour currently shown (used by the time slider while following the game clock). */
  hourNow(): number;
  hero(): void;
  canFollow(): boolean;
  following(): boolean;
  follow(on: boolean): void;
  save(): Promise<void>;
  exit(): void;
  gallery: PhotoGalleryApi;
  /** Cosmetic frames: null = usable, else the reason it is locked ('Unlock: <achievement>'). Missing = nothing locked. */
  frameLock?(id: FrameId): string | null;
}

const fmtHour = (h: number): string => { const m = Math.round(h * 60) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

/**
 * Photo-mode panel (M5.2): a compact, collapsible card on the left (bottom sheet under 700 px) with the shoot controls and the local gallery.
 * While it is open main.ts puts `view-photo` on the body, which hides every other #ui child. The host is a 0x0 box; the live-preview layer
 * (aspect mask, vignette, frame) is `pointer-events:none`, so the canvas stays the drag surface. Local only: nothing here uploads or shares.
 */
export class StPhoto extends StElement {
  private api: PhotoPanelApi | null = null;
  private shown = false;
  private collapsed = false;
  private tab: 'shoot' | 'gallery' = 'shoot';
  private readonly stage = document.createElement('div');
  private readonly rectEl = document.createElement('div');
  private readonly vigEl = document.createElement('div');
  private readonly frameEl = document.createElement('div');
  private readonly card = document.createElement('div');
  private readonly body = document.createElement('div');
  private readonly collapseBtn = document.createElement('button');
  private readonly status = document.createElement('div');
  private readonly shootPane = document.createElement('div');
  private readonly galPane = document.createElement('div');
  private readonly tabBtns = new Map<string, HTMLButtonElement>();
  private readonly viewer = document.createElement('div');
  private readonly viewerImg = document.createElement('img');
  private viewerId = 0;
  private viewerUrl = '';
  private thumbUrls: string[] = [];
  private delAllArmed = 0;
  private syncers: Array<() => void> = [];
  private resizeFn = (): void => this.layoutStage();
  private fovInput!: HTMLInputElement; private fovOut!: HTMLElement;
  private timeInput!: HTMLInputElement; private timeOut!: HTMLElement;
  private followBtn!: HTMLButtonElement;
  private saveBtn!: HTMLButtonElement;
  private saving = false;

  protected css(): string {
    return `:host{position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:40}
.stage{position:fixed;inset:0;pointer-events:none}
.rect{position:absolute;box-sizing:border-box;pointer-events:none;overflow:hidden}
.rect.crop{box-shadow:0 0 0 100vmax rgba(8,12,18,.62);outline:1px solid rgba(255,255,255,.55)}
.rect .vig,.rect .fr{position:absolute;inset:0;pointer-events:none}
.fr.thin{border:calc(var(--m) * .012) solid rgba(250,250,248,.95);inset:calc(var(--m) * .03)}
.fr.polaroid{border:solid #f6f2e8;border-width:calc(var(--m) * .05) calc(var(--m) * .05) calc(var(--m) * .17) calc(var(--m) * .05)}
.fr.alpine{border:solid #1f3a5c;border-width:calc(var(--m) * .028);box-shadow:inset 0 0 0 calc(var(--m) * .004) #f4f0e4}
.fr.alpine::after{content:'';position:absolute;left:calc(var(--m) * .05);bottom:0;width:calc(var(--m) * .2);height:calc(var(--m) * .075);background:#1f3a5c;border:calc(var(--m) * .004) solid #f4f0e4;box-sizing:border-box}
.fr.noir{border:solid #0c0c0e;border-width:calc(var(--m) * .05);box-shadow:inset 0 0 0 calc(var(--m) * .004) #d8d8d4}
.fr.gold{border:solid #d9a521;border-width:calc(var(--m) * .024);box-shadow:inset 0 0 0 calc(var(--m) * .004) #fff1b8}
button.locked{opacity:.45;cursor:not-allowed}
.fr.film{background:linear-gradient(#101012,#101012) top/100% 10% no-repeat,linear-gradient(#101012,#101012) bottom/100% 10% no-repeat}
.card{position:fixed;left:12px;top:12px;width:286px;max-height:calc(100vh - 24px);box-sizing:border-box;display:flex;flex-direction:column;align-items:stretch;gap:6px;pointer-events:auto;padding:8px 10px;overflow:hidden}
.hd{display:flex;align-items:center;gap:8px}.hd .t{flex:1;font-family:var(--font-display);color:var(--c-accent-text);letter-spacing:.3px;font-size:var(--fs-lg)}
.body{display:flex;flex-direction:column;gap:6px;overflow:auto;min-height:0}
.row{display:flex;flex-direction:column;gap:3px}.row>label,.row>.lbl{display:flex;justify-content:space-between;gap:6px;font-weight:700;color:#cfe0f5;font-size:var(--fs-sm)}
.row output{color:#fff;font-variant-numeric:tabular-nums}
.seg{display:flex;flex-wrap:wrap;gap:3px}.seg button{padding:2px 7px;font-size:var(--fs-sm)}
.chk{display:flex;align-items:center;gap:7px;font-size:var(--fs-sm);font-weight:600}
input[type=range]{width:100%;box-sizing:border-box}
.acts{display:flex;gap:6px;flex-wrap:wrap}.acts button{flex:1 1 auto}
.status{min-height:16px;color:#9fb4cc;font-size:var(--fs-sm)}
.sec{display:flex;flex-direction:column;gap:5px;padding:6px 8px;border:1px solid #2f4057;border-radius:var(--r-md);background:rgba(255,255,255,.03)}.sec>h3{margin:0;font:400 var(--fs-md)/1.2 var(--font-display);color:var(--c-accent-text)}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}.grid button.thumb{padding:0;border:1px solid #4f6684;border-radius:4px;overflow:hidden;background:#0f1722;aspect-ratio:4/3;display:flex}
.grid img{width:100%;height:100%;object-fit:cover;display:block}
.keys{color:#9fb4cc;font-size:11px;line-height:1.35}
.layer .dlg{--w:min(900px,92vw)}.layer .dlg .body{align-items:center}.layer img.big{max-width:100%;max-height:68vh;border-radius:4px;display:block}
@media (max-width:700px){.card{left:6px;right:6px;top:auto;bottom:6px;width:auto;max-height:46vh}}`;
  }

  constructor() {
    super();
    this.stage.className = 'stage'; this.stage.setAttribute('aria-hidden', 'true');
    this.rectEl.className = 'rect'; this.vigEl.className = 'vig'; this.frameEl.className = 'fr';
    this.rectEl.append(this.vigEl, this.frameEl); this.stage.append(this.rectEl);
    this.card.className = 'panel card'; this.card.setAttribute('role', 'group'); this.card.setAttribute('aria-label', 'Photo mode');
    this.body.className = 'body';
    this.status.className = 'status'; this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
    this.viewer.className = 'layer'; this.viewer.setAttribute('role', 'dialog'); this.viewer.setAttribute('aria-label', 'Photo');
    this.root.append(this.stage, this.card, this.viewer);
    this.card.hidden = true; this.stage.hidden = true;
  }

  /** Host attributes may not be set in the constructor. */
  connectedCallback(): void { this.hidden = !this.shown; window.addEventListener('resize', this.resizeFn); }
  disconnectedCallback(): void { window.removeEventListener('resize', this.resizeFn); }

  bind(api: PhotoPanelApi): void {
    this.api = api;
    this.build();
  }

  get visible(): boolean { return this.shown; }

  open(): void {
    if (!this.api) return;
    this.shown = true; this.hidden = false; this.card.hidden = false; this.stage.hidden = false;
    this.tab = 'shoot'; this.collapsed = false; this.applyTab(); this.applyCollapsed();
    this.sync(); this.layoutStage();
    this.say('');
    (this.saveBtn ?? this.card).focus?.();
  }
  close(): void {
    this.shown = false; this.hidden = true; this.card.hidden = true; this.stage.hidden = true;
    this.closeViewer(); this.revokeThumbs();
  }

  /** Esc: closes the large viewer first. Returns true when it consumed the key. */
  escape(): boolean { if (this.viewer.classList.contains('open')) { this.closeViewer(); return true; } return false; }
  /** Collapse / expand the panel (keyboard: the header button). */
  setCollapsed(c: boolean): void { this.collapsed = c; this.applyCollapsed(); }
  get isCollapsed(): boolean { return this.collapsed; }
  say(msg: string): void { this.status.textContent = msg; }
  /** The follow-guest button only exists while a ride-along target does. */
  refreshFollow(): void { if (this.followBtn && this.api) { this.followBtn.hidden = !this.api.canFollow(); this.followBtn.classList.toggle('active', this.api.following()); this.followBtn.setAttribute('aria-pressed', String(this.api.following())); } }
  /** Updates the live clock text while the time follows the game. */
  tickClock(): void { if (this.api && this.api.settings().hour === null) { this.timeInput.value = String(this.api.hourNow()); this.timeOut.textContent = `${fmtHour(this.api.hourNow())} (live)`; } }

  // ---------------------------------------------------------------- build
  private el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }

  private seg<T extends string>(label: string, ids: readonly T[], labels: Record<T, string>, get: () => T, set: (v: T) => void, lock?: (id: T) => string | null): HTMLElement {
    const row = this.el('div', 'row'); const lb = this.el('div', 'lbl', label); lb.id = `l-${label.replace(/\W/g, '')}`;
    const g = this.el('div', 'seg'); g.setAttribute('role', 'group'); g.setAttribute('aria-labelledby', lb.id);
    const btns = new Map<T, HTMLButtonElement>();
    for (const id of ids) {
      const b = this.el('button', '', labels[id]); b.type = 'button'; b.addEventListener('click', () => { if (lock?.(id)) return; set(id); this.sync(); });
      btns.set(id, b); g.append(b);
    }
    this.syncers.push(() => { const cur = get(); for (const [id, b] of btns) { b.classList.toggle('active', id === cur); b.setAttribute('aria-pressed', String(id === cur)); const why = lock?.(id) ?? null; b.disabled = !!why; b.classList.toggle('locked', !!why); b.title = why ?? ''; } });
    row.append(lb, g);
    return row;
  }
  private slider(label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt: (v: number) => string): { row: HTMLElement; input: HTMLInputElement; out: HTMLElement } {
    const row = this.el('div', 'row'); const lb = this.el('label'); const t = this.el('span', '', label); const out = this.el('output'); lb.append(t, out);
    const input = this.el('input'); input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step); input.setAttribute('aria-label', label);
    input.addEventListener('input', () => { set(Number(input.value)); out.textContent = fmt(Number(input.value)); this.preview(); });
    this.syncers.push(() => { const v = get(); if (document.activeElement !== input && this.root.activeElement !== input) input.value = String(v); out.textContent = fmt(v); });
    row.append(lb, input);
    return { row, input, out };
  }
  private check(label: string, get: () => boolean, set: (v: boolean) => void): HTMLElement {
    const l = this.el('label', 'chk'); const c = this.el('input'); c.type = 'checkbox';
    c.addEventListener('change', () => { set(c.checked); this.sync(); });
    this.syncers.push(() => { c.checked = get(); });
    l.append(c, document.createTextNode(label));
    return l;
  }

  private build(): void {
    const api = this.api!;
    const s = (): PhotoSettings => api.settings();
    this.syncers = [];
    // header
    const hd = this.el('div', 'hd');
    this.collapseBtn.type = 'button'; this.collapseBtn.className = 'icon'; this.collapseBtn.addEventListener('click', () => this.setCollapsed(!this.collapsed));
    const exit = this.el('button', 'primary'); exit.type = 'button'; exit.title = 'Exit photo mode (Esc)'; exit.append(icon('exit', 11), document.createTextNode(' Exit')); exit.addEventListener('click', () => api.exit());
    hd.append(icon('camera', 16), this.el('span', 't', 'Photo mode'), this.collapseBtn, exit);
    // tabs
    const tabs = this.el('div', 'tabs'); tabs.setAttribute('role', 'tablist');
    for (const [id, label] of [['shoot', 'Shoot'], ['gallery', 'Gallery']] as const) {
      const b = this.el('button', 'tab', label); b.type = 'button'; b.setAttribute('role', 'tab');
      b.addEventListener('click', () => { this.tab = id; this.applyTab(); if (id === 'gallery') void this.refreshGallery(); });
      this.tabBtns.set(id, b); tabs.append(b);
    }
    // --- shoot pane
    const sp = this.shootPane; sp.className = 'body'; sp.replaceChildren();
    const camSec = this.el('div', 'sec'); camSec.append(this.el('h3', '', 'Camera'));
    const presets = this.el('div', 'acts');
    const hero = this.el('button', '', 'Hero shot'); hero.type = 'button'; hero.title = 'Frame the village from a pleasing angle'; hero.addEventListener('click', () => { api.hero(); this.refreshFollow(); });
    this.followBtn = this.el('button', '', 'Follow guest'); this.followBtn.type = 'button'; this.followBtn.title = 'Keep the ride-along guest in the frame'; this.followBtn.addEventListener('click', () => { api.follow(!api.following()); this.refreshFollow(); });
    presets.append(hero, this.followBtn);
    const fov = this.slider('Field of view', PHOTO_FOV_MIN, PHOTO_FOV_MAX, 1, () => s().fov, (v) => api.set({ fov: v }), (v) => `${Math.round(v)}°`);
    this.fovInput = fov.input; this.fovOut = fov.out;
    const keys = this.el('div', 'keys', 'Drag: orbit · right/middle drag or WASD: move · wheel: zoom · Q/E: height · Esc: exit');
    camSec.append(presets, fov.row, keys);
    const lookSec = this.el('div', 'sec'); lookSec.append(this.el('h3', '', 'Scene'));
    const time = this.slider('Time of day', 0, 24, 0.25, () => s().hour ?? api.hourNow(), (v) => api.set({ hour: v >= 24 ? 0 : v }), (v) => `${fmtHour(v)}${s().hour === null ? ' (live)' : ''}`);
    this.timeInput = time.input; this.timeOut = time.out;
    const live = this.el('button', '', 'Follow game clock'); live.type = 'button'; live.addEventListener('click', () => { api.set({ hour: null }); this.sync(); });
    lookSec.append(time.row, live,
      this.check('Show snow / rain', () => s().precip, (v) => api.set({ precip: v })),
      this.check('Pause game while composing', () => s().pauseGame, (v) => api.set({ pauseGame: v })));
    const styleSec = this.el('div', 'sec'); styleSec.append(this.el('h3', '', 'Look'));
    const vig = this.slider('Vignette', 0, 100, 5, () => Math.round(s().vignette * 100), (v) => api.set({ vignette: v / 100 }), (v) => `${Math.round(v)}%`);
    styleSec.append(
      this.seg<FilterId>('Filter', FILTER_IDS, FILTER_LABELS, () => s().filter, (v) => api.set({ filter: v })), vig.row,
      this.seg<FrameId>('Frame', FRAME_IDS, FRAME_LABELS, () => s().frame, (v) => api.set({ frame: v }), (id) => api.frameLock?.(id) ?? null),
      this.seg<AspectId>('Aspect', ASPECT_IDS, ASPECT_LABELS, () => s().aspect, (v) => api.set({ aspect: v })),
      this.seg<'1' | '2'>('Resolution', ['1', '2'], { '1': '1×', '2': '2×' }, () => String(s().scale) as '1' | '2', (v) => api.set({ scale: v === '2' ? 2 : 1 })));
    const acts = this.el('div', 'acts');
    this.saveBtn = this.el('button', 'primary'); this.saveBtn.type = 'button'; this.saveBtn.title = 'Save a PNG to your device (Enter)';
    this.saveBtn.append(icon('camera', 13), document.createTextNode(' Save photo'));
    this.saveBtn.addEventListener('click', () => { void this.doSave(); });
    acts.append(this.saveBtn);
    sp.append(camSec, lookSec, styleSec, acts);
    this.galPane.className = 'body';
    this.body.replaceChildren(tabs, sp, this.galPane);
    this.card.replaceChildren(hd, this.body, this.status);
    // viewer
    this.viewer.replaceChildren();
    const bd = this.el('div', 'bd'); bd.addEventListener('click', () => this.closeViewer());
    const dlg = this.el('div', 'dlg lg');
    const vh = this.el('header'); vh.append(this.el('h2', '', 'Photo'));
    const x = this.el('button', 'x', '✕'); x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.addEventListener('click', () => this.closeViewer()); vh.append(x);
    this.viewerImg.className = 'big'; this.viewerImg.alt = 'Saved photo';
    const vb = this.el('div', 'body'); vb.append(this.viewerImg);
    const vf = this.el('footer');
    const again = this.el('button', 'primary', 'Save again'); again.type = 'button'; again.addEventListener('click', () => { void api.gallery.saveAgain(this.viewerId).then(() => this.say('Photo saved')); });
    const del = this.el('button', 'danger', 'Delete'); del.type = 'button'; del.addEventListener('click', () => { const id = this.viewerId; this.closeViewer(); void api.gallery.remove(id).then(() => this.refreshGallery()); });
    vf.append(again, del);
    dlg.append(vh, vb, vf); this.viewer.append(bd, dlg);
    this.applyCollapsed(); this.applyTab();
  }

  private applyTab(): void {
    this.shootPane.hidden = this.tab !== 'shoot'; this.galPane.hidden = this.tab !== 'gallery';
    for (const [id, b] of this.tabBtns) { b.classList.toggle('active', id === this.tab); b.setAttribute('aria-selected', String(id === this.tab)); }
  }
  private applyCollapsed(): void {
    this.body.hidden = this.collapsed;
    this.collapseBtn.textContent = this.collapsed ? 'Show' : 'Hide';
    this.collapseBtn.title = this.collapsed ? 'Show the photo controls' : 'Hide the controls to see the whole frame';
    this.collapseBtn.setAttribute('aria-expanded', String(!this.collapsed));
  }

  /** Pull every control from the API (after any change). */
  sync(): void { for (const f of this.syncers) f(); this.refreshFollow(); this.preview(); }

  /** Live preview: filter on the canvas is applied by main.ts; the mask / vignette / frame are drawn here. */
  private preview(): void {
    if (!this.api) return;
    const s = this.api.settings();
    this.layoutStage();
    this.vigEl.style.background = vignetteCss(s.vignette);
    this.frameEl.className = `fr ${s.frame === 'none' ? '' : s.frame}`;
  }
  private layoutStage(): void {
    if (!this.api) return;
    const s = this.api.settings(), w = window.innerWidth, h = window.innerHeight, r = aspectRect(w, h, s.aspect);
    const st = this.rectEl.style;
    st.left = `${r.x}px`; st.top = `${r.y}px`; st.width = `${r.w}px`; st.height = `${r.h}px`;
    st.setProperty('--m', `${Math.min(r.w, r.h)}px`);
    this.rectEl.classList.toggle('crop', s.aspect !== 'window');
  }

  private async doSave(): Promise<void> {
    if (this.saving || !this.api) return;
    this.saving = true; this.saveBtn.disabled = true; this.say('Saving…');
    try { await this.api.save(); } catch (e) { this.say(`Could not save the photo: ${(e as Error).message}`); } finally { this.saving = false; this.saveBtn.disabled = false; }
  }
  /** Enter key (host): same as the Save button. */
  saveNow(): void { void this.doSave(); }

  // ---------------------------------------------------------------- gallery
  private revokeThumbs(): void { for (const u of this.thumbUrls) { try { URL.revokeObjectURL(u); } catch { /* ignore */ } } this.thumbUrls = []; }
  async refreshGallery(): Promise<void> {
    const api = this.api; if (!api) return;
    this.galPane.replaceChildren();
    if (!api.gallery.available) { this.galPane.append(this.el('div', 'hint muted', 'The gallery needs IndexedDB, which this browser does not provide. Photos are still downloaded.')); return; }
    let items: PhotoMeta[] = [];
    try { items = await api.gallery.list(); } catch (e) { this.galPane.append(this.el('div', 'hint muted', `Gallery unavailable: ${(e as Error).message}`)); return; }
    this.revokeThumbs();
    const head = this.el('div', 'keys', items.length ? `${items.length} photo${items.length === 1 ? '' : 's'} stored on this device (the newest 30 are kept).` : 'No photos yet. Saved photos also appear here, on this device only.');
    this.galPane.append(head);
    const grid = this.el('div', 'grid');
    for (const m of items) {
      const b = this.el('button', 'thumb'); b.type = 'button'; b.title = `${new Date(m.createdAt).toLocaleString()} · ${m.w}×${m.h}`; b.setAttribute('aria-label', `Photo ${new Date(m.createdAt).toLocaleString()}`);
      const img = this.el('img'); img.alt = '';
      try { const u = URL.createObjectURL(new Blob([m.thumb as BlobPart], { type: m.thumbType })); this.thumbUrls.push(u); img.src = u; } catch { /* no blob URLs (tests) */ }
      b.append(img); b.addEventListener('click', () => { void this.openViewer(m.id); });
      grid.append(b);
    }
    this.galPane.append(grid);
    if (items.length) {
      const all = this.el('button', 'danger', 'Delete all'); all.type = 'button';
      all.addEventListener('click', () => {
        if (!this.delAllArmed || Date.now() - this.delAllArmed > 4000) { this.delAllArmed = Date.now(); all.textContent = 'Really delete all?'; return; }
        this.delAllArmed = 0; void api.gallery.clear().then(() => this.refreshGallery());
      });
      this.galPane.append(all);
    }
  }
  private async openViewer(id: number): Promise<void> {
    const u = await this.api?.gallery.full(id);
    if (!u) { this.say('That photo is gone.'); void this.refreshGallery(); return; }
    if (this.viewerUrl) { try { URL.revokeObjectURL(this.viewerUrl); } catch { /* ignore */ } }
    this.viewerUrl = u; this.viewerId = id; this.viewerImg.src = u; this.viewer.classList.add('open');
  }
  private closeViewer(): void {
    this.viewer.classList.remove('open');
    if (this.viewerUrl) { try { URL.revokeObjectURL(this.viewerUrl); } catch { /* ignore */ } this.viewerUrl = ''; }
    this.viewerImg.removeAttribute('src');
  }

  /** CSS filter string for the live canvas preview (applied by the host to the canvas container). */
  static liveFilter(id: FilterId): string { return filterCss(id); }
}
