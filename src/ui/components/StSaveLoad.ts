import { formatDate, formatMoney } from '../format';
import { Modal } from '../modal';
import { StElement } from './StElement';
import { confirmDialog } from './StModal';

/** One listed save slot (mirrors persist/IdbStore SlotMeta; duplicated structurally so ui/ never imports persist/). */
export interface SlotRow {
  id: string;
  bytes: number;
  auto: boolean;
  updatedAt: number;
  meta: { name: string; date: { year: number; day: number; minute: number }; money: number; rating: number; guests: number; mapSize: number; screenshot?: string };
}

export interface SaveLoadApi {
  list(): Promise<SlotRow[]>;
  /** `id` null = a new slot named `name`. */
  save(id: string | null, name?: string): Promise<void>;
  load(id: string): void | Promise<void>;
  remove(id: string): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  /** `id` null = export the running game. */
  exportSlot(id: string | null): Promise<void>;
  importFile(file: File): Promise<void>;
  autosave: { get(): boolean; set(on: boolean): void };
  backendKind: 'idb' | 'local';
  /** Subscribe to slot-list changes (returns unsubscribe). */
  onChange?(fn: () => void): () => void;
  /** Confirmation prompt (defaults to the shared confirm dialog). */
  confirm?(message: string): boolean | Promise<boolean>;
  /** False on the title screen: there is no running game to save (the Save tab is hidden). */
  canSave?: boolean;
  /** Epoch ms of the last successful save of the running game (shown in the Save tab). */
  lastSaved?(): number | null;
  now?(): number;
}

const kb = (n: number): string => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
export function ago(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export type SaveTab = 'save' | 'load';

/**
 * Save / Load dialog (shared dialog frame, lg) with two tabs: **Save** (name for a new save + overwrite an existing slot, export current) and
 * **Load** (load / rename / export / delete, import a .slope file). Opened by: top-bar 💾 Save (Ctrl+S), pause menu, main menu, F5 quicksaves directly.
 * Closed = nothing rendered (the full-screen layer only exists while open).
 */
export class StSaveLoad extends StElement {
  private api: SaveLoadApi | null = null;
  private readonly dlg: Modal;
  private list = document.createElement('div');
  private nameInput = document.createElement('input');
  private fileInput = document.createElement('input');
  private autoBox = document.createElement('input');
  private warn = document.createElement('div');
  private status = document.createElement('div');
  private saveBar = document.createElement('div');
  private loadBar = document.createElement('div');
  private lastEl = document.createElement('span');
  private tabs = document.createElement('div');
  private tabBtns = new Map<SaveTab, HTMLButtonElement>();
  private tab: SaveTab = 'save';
  private rows: SlotRow[] = [];
  private token = 0;

  protected css(): string {
    return ':host{display:block;width:0;height:0}' +
      '.bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.bar input[type=text]{flex:1;min-width:160px}.list{display:flex;flex-direction:column;gap:6px}' +
      '.slot{display:flex;gap:10px;align-items:center;padding:6px 8px;border:1px solid #3d5068;border-radius:var(--r-md);background:rgba(255,255,255,.04)}.slot:hover{border-color:#5f7798;background:rgba(255,255,255,.07)}' +
      '.slot img{width:72px;height:48px;object-fit:cover;border-radius:3px;background:#0b1118}.thumb{width:72px;height:48px;border-radius:3px;background:#0b1118;display:flex;align-items:center;justify-content:center;font-size:20px}' +
      '.info{flex:1;min-width:0}.info b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sub{opacity:.78;font-size:var(--fs-sm)}.btns{display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end}' +
      '.warn{color:#ffd070;font-size:var(--fs-sm)}.status{min-height:14px;font-size:var(--fs-sm);color:#9fd3ff}.empty{opacity:.7;padding:14px;text-align:center}.tag{background:#46607f;border-radius:3px;padding:0 4px;font-size:10px;margin-left:4px}' +
      '.keys{margin-left:auto}label.chk{display:flex;gap:8px;align-items:center;cursor:pointer}';
  }

  constructor() {
    super();
    this.dlg = new Modal(this.root, { title: 'Save & load', icon: '💾', size: 'lg', pausesGame: true, onOpen: () => this.setAttribute('open', ''), onClose: () => this.removeAttribute('open') });
    this.tabs.className = 'tabs'; this.tabs.setAttribute('role', 'tablist');
    for (const [t, label] of [['save', '💾 Save'], ['load', '📂 Load']] as const) {
      const b = document.createElement('button'); b.className = 'tab'; b.textContent = label; b.dataset.tab = t; b.setAttribute('role', 'tab');
      b.addEventListener('click', () => this.setTab(t)); this.tabs.append(b); this.tabBtns.set(t, b);
    }
    this.nameInput.type = 'text'; this.nameInput.dataset.autofocus = ''; this.nameInput.placeholder = 'Name for a new save'; this.nameInput.maxLength = 60; this.nameInput.setAttribute('aria-label', 'Save name');
    this.nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.clickAction('save-new'); });
    const btn = (text: string, action: string, title: string, fn: () => void, cls = ''): HTMLButtonElement => {
      const b = document.createElement('button'); b.textContent = text; b.dataset.action = action; b.title = title; if (cls) b.className = cls; b.addEventListener('click', fn); return b;
    };
    const saveNew = btn('Save as new', 'save-new', 'Create a new save slot from the running game', () => { void this.run(() => this.api!.save(null, this.nameInput.value.trim() || undefined), 'Game saved'); this.nameInput.value = ''; }, 'primary');
    const expCur = btn('Export current', 'export-current', 'Download the running game as a .slope file', () => void this.run(() => this.api!.exportSlot(null), 'Exported'));
    this.fileInput.type = 'file'; this.fileInput.accept = '.slope,application/octet-stream'; this.fileInput.hidden = true; this.fileInput.dataset.action = 'import-input';
    this.fileInput.addEventListener('change', () => { const f = this.fileInput.files?.[0]; if (f) void this.run(() => this.api!.importFile(f), 'Imported').then(() => { this.fileInput.value = ''; }); });
    const imp = btn('Import…', 'import', 'Load a .slope file into a new slot', () => this.fileInput.click());
    this.lastEl.className = 'hint';
    this.saveBar.className = 'bar'; this.saveBar.append(this.nameInput, saveNew, expCur);
    this.loadBar.className = 'bar'; this.loadBar.append(imp, this.fileInput);
    const autoLabel = document.createElement('label'); autoLabel.className = 'chk'; autoLabel.title = 'Save automatically every in-game month (3 rolling slots) and when the tab is hidden';
    this.autoBox.type = 'checkbox'; this.autoBox.className = 'toggle'; this.autoBox.dataset.action = 'autosave';
    this.autoBox.addEventListener('change', () => this.api?.autosave.set(this.autoBox.checked));
    const keys = document.createElement('span'); keys.className = 'sub keys'; keys.innerHTML = '<kbd>Ctrl</kbd>+<kbd>S</kbd> save · <kbd>F5</kbd> quicksave · <kbd>F9</kbd> quickload';
    autoLabel.append(this.autoBox, document.createTextNode('Autosave every month'));
    this.warn.className = 'warn'; this.warn.hidden = true;
    this.status.className = 'status'; this.status.setAttribute('role', 'status');
    this.list.className = 'list';
    this.dlg.body.append(this.tabs, this.saveBar, this.loadBar, this.lastEl, this.warn, this.status, this.list);
    this.dlg.footer.append(autoLabel, keys);
    this.dlg.footer.style.justifyContent = 'flex-start';
  }

  get isOpen(): boolean { return this.dlg.isOpen; }
  get currentTab(): SaveTab { return this.tab; }

  bind(api: SaveLoadApi): void {
    this.api = api;
    this.warn.hidden = api.backendKind !== 'local';
    this.warn.textContent = api.backendKind === 'local' ? '⚠ IndexedDB is unavailable: saves use the small browser fallback storage (64 maps only). Export important saves as .slope files.' : '';
    if (api.onChange) this.track(api.onChange(() => { if (this.isOpen) void this.refresh(); }));
  }

  /** Open on a tab (default: Save when a game is running, else Load). */
  open(tab?: SaveTab): void {
    if (!this.api) return;
    this.autoBox.checked = this.api.autosave.get();
    this.status.textContent = '';
    this.setTab(tab ?? (this.canSave ? 'save' : 'load'));
    this.dlg.open();
    void this.refresh();
  }
  close(): void { this.dlg.close(); }
  toggle(): void { if (this.isOpen) this.close(); else this.open(); }
  private get canSave(): boolean { return this.api?.canSave !== false; }

  setTab(t: SaveTab): void {
    this.tab = t === 'save' && !this.canSave ? 'load' : t;
    const save = this.tab === 'save';
    this.tabBtns.get('save')!.hidden = !this.canSave;
    this.tabs.hidden = !this.canSave; this.dlg.footer.hidden = !this.canSave; // title screen: only Load exists, no autosave toggle
    for (const [k, b] of this.tabBtns) { b.classList.toggle('active', k === this.tab); b.setAttribute('aria-selected', String(k === this.tab)); }
    this.saveBar.hidden = !save; this.loadBar.hidden = save;
    const last = this.api?.lastSaved?.() ?? null;
    this.lastEl.hidden = !save;
    this.lastEl.textContent = save ? (last ? `Last saved ${ago(last, this.api?.now?.() ?? Date.now())}. Pick a slot to overwrite, or save as a new one.` : 'Not saved yet in this session. Pick a slot to overwrite, or save as a new one.') : '';
    this.dlg.setTitle(save ? 'Save game' : 'Load game', save ? '💾' : '📂');
    this.renderRows();
  }

  private async ask(msg: string): Promise<boolean> {
    if (this.api?.confirm) return await this.api.confirm(msg);
    return confirmDialog((this.parentElement as HTMLElement | null) ?? document.body, { title: 'Please confirm', message: msg, danger: /delete|overwrite|lost/i.test(msg) });
  }

  private async run(fn: () => Promise<void>, ok: string): Promise<void> {
    this.status.textContent = 'Working…';
    try { await fn(); this.status.textContent = ok; } catch (e) { this.status.textContent = `⚠ ${(e as Error)?.message ?? String(e)}`; }
    await this.refresh();
  }

  /** Re-read the slot list and rebuild the rows. */
  async refresh(): Promise<void> {
    if (!this.api) return;
    const my = ++this.token;
    let rows: SlotRow[];
    try { rows = await this.api.list(); } catch (e) { this.status.textContent = `⚠ ${(e as Error)?.message ?? String(e)}`; return; }
    if (my !== this.token) return;
    this.rows = rows;
    this.renderRows();
  }

  private renderRows(): void {
    const now = this.api?.now?.() ?? Date.now();
    this.list.replaceChildren();
    if (!this.rows.length) { const d = document.createElement('div'); d.className = 'empty'; d.textContent = 'No saves yet.'; this.list.appendChild(d); return; }
    for (const r of this.rows) this.list.appendChild(this.row(r, now));
  }

  private row(r: SlotRow, now: number): HTMLElement {
    const m = r.meta, d = document.createElement('div');
    d.className = 'slot'; d.dataset.id = r.id;
    let thumb: HTMLElement;
    if (m.screenshot) { const i = document.createElement('img'); i.src = m.screenshot; i.alt = ''; thumb = i; } else { thumb = document.createElement('div'); thumb.className = 'thumb'; thumb.textContent = '⛷'; }
    const info = document.createElement('div'); info.className = 'info';
    const name = document.createElement('b'); name.className = 'name'; name.textContent = m.name;
    if (r.auto) { const t = document.createElement('span'); t.className = 'tag'; t.textContent = 'auto'; name.appendChild(t); }
    if (r.id === 'quick') { const t = document.createElement('span'); t.className = 'tag'; t.textContent = 'quick'; name.appendChild(t); }
    const l1 = document.createElement('div'); l1.className = 'sub l1';
    l1.textContent = `${formatDate({ ...m.date, tick: 0 })} · ${formatMoney(m.money)} · ${m.rating}★ · ${m.guests} guests · ${m.mapSize}×${m.mapSize}`;
    const l2 = document.createElement('div'); l2.className = 'sub l2';
    l2.textContent = `${kb(r.bytes)} · saved ${ago(r.updatedAt, now)}`;
    info.append(name, l1, l2);
    const btns = document.createElement('div'); btns.className = 'btns';
    const b = (label: string, action: string, title: string, fn: () => void, cls = ''): void => {
      const x = document.createElement('button'); x.textContent = label; x.title = title; x.dataset.action = action; if (cls) x.className = cls; x.addEventListener('click', fn); btns.appendChild(x);
    };
    if (this.tab === 'load') {
      b('Load', 'load', 'Load this save (reloads the game)', () => { void this.ask(`Load “${m.name}”? Unsaved progress in the current game will be lost.`).then((ok) => { if (ok) void this.run(async () => { await this.api!.load(r.id); this.close(); }, 'Loading…'); }); }, 'primary');
      b('Rename', 'rename', 'Rename this save', () => {
        const n = typeof window !== 'undefined' && typeof window.prompt === 'function' ? window.prompt('New name', m.name) : null;
        if (n && n.trim()) void this.run(() => this.api!.rename(r.id, n.trim()), 'Renamed');
      }, 'ghost');
      b('Export', 'export', 'Download as a .slope file', () => void this.run(() => this.api!.exportSlot(r.id), 'Exported'), 'ghost');
      b('Delete', 'delete', 'Delete this save', () => { void this.ask(`Delete “${m.name}”? This cannot be undone.`).then((ok) => { if (ok) void this.run(() => this.api!.remove(r.id), 'Deleted'); }); }, 'danger');
    } else if (!r.auto) {
      b('Overwrite', 'overwrite', 'Save the running game into this slot', () => { void this.ask(`Overwrite “${m.name}” with the current game?`).then((ok) => { if (ok) void this.run(() => this.api!.save(r.id), 'Game saved'); }); }, 'primary');
    }
    d.append(thumb, info, btns);
    return d;
  }

  // ---- test / host helpers ----
  rowIds(): string[] { return [...this.root.querySelectorAll<HTMLElement>('.slot')].map((e) => e.dataset.id!); }
  /** Click a slot's action button (`load`, `overwrite`, `rename`, `export`, `delete`); switches to the tab that owns the action. */
  clickRow(id: string, action: string): boolean {
    if (action === 'overwrite' && this.tab !== 'save') this.setTab('save');
    else if (action !== 'overwrite' && this.tab !== 'load') this.setTab('load');
    const b = this.root.querySelector<HTMLButtonElement>(`.slot[data-id="${id}"] button[data-action="${action}"]`);
    b?.click();
    return !!b;
  }
  clickAction(action: string): void {
    if (action === 'save-new' || action === 'export-current') this.setTab('save'); else if (action === 'import') this.setTab('load');
    this.root.querySelector<HTMLButtonElement>(`button[data-action="${action}"]`)?.click();
  }
  setName(v: string): void { this.nameInput.value = v; }
  get fileInputEl(): HTMLInputElement { return this.fileInput; }
  get autosaveBox(): HTMLInputElement { return this.autoBox; }
  get statusText(): string { return this.status.textContent ?? ''; }
  get warningText(): string { return this.warn.hidden ? '' : this.warn.textContent ?? ''; }
  rowText(id: string): string { return this.root.querySelector<HTMLElement>(`.slot[data-id="${id}"]`)?.textContent ?? ''; }
}
