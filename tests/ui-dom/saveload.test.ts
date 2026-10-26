// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { el, registerComponents } from '../../src/ui';
import type { SaveLoadApi, SlotRow } from '../../src/ui/components/StSaveLoad';
import { ago } from '../../src/ui/components/StSaveLoad';

registerComponents();
const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

const row = (id: string, name: string, extra: Partial<SlotRow> = {}): SlotRow => ({
  id, bytes: 300_000, auto: false, updatedAt: 1_000_000,
  meta: { name, date: { year: 2, day: 14, minute: 0 }, money: 123456, rating: 4, guests: 321, mapSize: 128 }, ...extra,
});

function api(rows: SlotRow[], over: Partial<SaveLoadApi> = {}): { api: SaveLoadApi; calls: string[]; rows: SlotRow[]; autosave: { on: boolean } } {
  const calls: string[] = [], autosave = { on: true };
  const a: SaveLoadApi = {
    list: async () => rows, save: async (id, name) => { calls.push(`save:${id}:${name ?? ''}`); },
    load: async (id) => { calls.push(`load:${id}`); }, remove: async (id) => { calls.push(`remove:${id}`); rows.splice(rows.findIndex((r) => r.id === id), 1); },
    rename: async (id, n) => { calls.push(`rename:${id}:${n}`); }, exportSlot: async (id) => { calls.push(`export:${id}`); }, importFile: async (f) => { calls.push(`import:${f.name}`); },
    autosave: { get: () => autosave.on, set: (on) => { autosave.on = on; calls.push(`autosave:${on}`); } }, backendKind: 'idb',
    confirm: () => true, now: () => 1_000_000 + 3 * 3600 * 1000, ...over,
  };
  return { api: a, calls, rows, autosave };
}

describe('st-save-load', () => {
  it('constructs without attributes or children (custom element rule)', () => {
    const e = document.createElement('st-save-load');
    expect(e.attributes.length).toBe(0);
    expect(e.childNodes.length).toBe(0);
    document.body.append(e); e.remove();
  });

  it('is display:none when closed and only shows (host [open]) while open — never a permanent full-screen overlay', () => {
    const e = el('st-save-load'); document.body.append(e);
    const layer = (e as unknown as { root: ShadowRoot }).root.querySelector('.layer')!;
    expect(layer.classList.contains('open')).toBe(false); // the full-screen layer is display:none (kit .layer rule) until opened
    const h = api([row('a', 'A')]); e.bind(h.api);
    expect(e.hasAttribute('open')).toBe(false); expect(e.isOpen).toBe(false);
    e.open(); expect(e.hasAttribute('open')).toBe(true);
    e.close(); expect(e.hasAttribute('open')).toBe(false);
    e.toggle(); expect(e.isOpen).toBe(true); e.toggle(); expect(e.isOpen).toBe(false);
    e.remove();
  });

  it('lists slots with name, in-game date, money, rating, guests, map size, size and last-saved; tags auto/quick', async () => {
    const e = el('st-save-load'); document.body.append(e);
    const h = api([row('auto-1', 'Autosave 1', { auto: true }), row('quick', 'Quicksave'), row('s1', 'My Resort', { bytes: 2_500_000, meta: { ...row('x', 'x').meta, name: 'My Resort', screenshot: 'data:image/jpeg;base64,AAAA' } })]);
    e.bind(h.api); e.open(); await flush();
    expect(e.currentTab).toBe('save'); // Save tab first
    expect(e.rowIds()).toEqual(['auto-1', 'quick', 's1']);
    const t = e.rowText('s1');
    for (const part of ['My Resort', 'Year 2, Day 15', '$123,456', '4★', '321 guests', '128×128', '2.4 MB', '3 h ago']) expect(t, part).toContain(part);
    expect(e.rowText('auto-1')).toContain('auto'); expect(e.rowText('quick')).toContain('quick');
    expect(e.rowText('auto-1')).toContain('293 KB');
    expect((e as unknown as { root: ShadowRoot }).root.querySelector('.slot[data-id="s1"] img')!.getAttribute('src')).toContain('data:image/jpeg');
    expect(e.clickRow('auto-1', 'overwrite')).toBe(false); // autosave slots are not manually overwritable
    e.remove();
  });

  it('Save-as-new, Overwrite, Load, Rename, Export, Delete, Import and the autosave toggle call the API; confirms can veto', async () => {
    const e = el('st-save-load'); document.body.append(e);
    const h = api([row('s1', 'One'), row('s2', 'Two')]);
    e.bind(h.api); e.open(); await flush();
    e.setName('Brand new'); e.clickAction('save-new'); await flush();
    e.clickRow('s1', 'overwrite'); await flush();
    e.clickRow('s1', 'load'); await flush();
    e.clickRow('s2', 'export'); await flush();
    e.clickAction('export-current'); await flush();
    (window as unknown as { prompt: (m: string, d?: string) => string | null }).prompt = () => 'Newer name';
    e.clickRow('s2', 'rename'); await flush();
    e.clickRow('s2', 'delete'); await flush();
    expect(h.calls).toEqual(['save:null:Brand new', 'save:s1:', 'load:s1', 'export:s2', 'export:null', 'rename:s2:Newer name', 'remove:s2']);
    expect(e.rowIds()).toEqual(['s1']); // list refreshed after delete
    expect(e.isOpen).toBe(false); // loading closes the dialog (page reloads)
    e.open(); await flush();
    e.autosaveBox.checked = false; e.autosaveBox.dispatchEvent(new Event('change'));
    expect(h.autosave.on).toBe(false);
    // import via the file input
    const file = new File([new Uint8Array([1, 2, 3])], 'friend.slope');
    Object.defineProperty(e.fileInputEl, 'files', { value: [file], configurable: true });
    e.fileInputEl.dispatchEvent(new Event('change')); await flush();
    expect(h.calls.at(-1)).toBe('import:friend.slope');
    // declined confirms do nothing
    const veto = api([row('v', 'Veto')], { confirm: () => false }); h.calls.length = 0;
    const e2 = el('st-save-load'); document.body.append(e2); e2.bind(veto.api); e2.open(); await flush();
    for (const a of ['load', 'overwrite', 'delete']) e2.clickRow('v', a);
    await flush();
    expect(veto.calls).toEqual([]);
    e.remove(); e2.remove();
  });

  it('shows errors from the API in the status line instead of throwing; empty list message; local-fallback warning', async () => {
    const e = el('st-save-load'); document.body.append(e);
    const h = api([], { backendKind: 'local', save: async () => { throw new Error('Browser storage is full.'); } });
    e.bind(h.api); e.open(); await flush();
    expect(e.warningText).toMatch(/IndexedDB is unavailable/);
    expect((e as unknown as { root: ShadowRoot }).root.textContent).toContain('No saves yet.');
    e.clickAction('save-new'); await flush();
    expect(e.statusText).toContain('Browser storage is full.');
    e.remove();
  });

  it('Escape and backdrop click close it; refreshes when the store changes while open', async () => {
    const e = el('st-save-load'); document.body.append(e);
    let fire = (): void => {};
    const h = api([row('a', 'A')], { onChange: (fn) => { fire = fn; return () => {}; } });
    e.bind(h.api); e.open(); await flush();
    h.rows.push(row('b', 'B')); fire(); await flush();
    expect(e.rowIds()).toEqual(['a', 'b']);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); expect(e.isOpen).toBe(false);
    e.open(); (e as unknown as { root: ShadowRoot }).root.querySelector<HTMLElement>('.bd')!.dispatchEvent(new MouseEvent('mousedown')); expect(e.isOpen).toBe(false);
    e.remove();
  });

  it('Save / Load tabs: Save first (new name + overwrite), Load has load/rename/export/delete; title screen has no Save tab; last-saved line', async () => {
    const e = el('st-save-load'); document.body.append(e);
    const h = api([row('s1', 'One')], { lastSaved: () => 1_000_000 });
    e.bind(h.api); e.open(); await flush();
    const r = (e as unknown as { root: ShadowRoot }).root;
    expect(r.querySelector('footer')).not.toBeNull();
    expect(r.textContent).toContain('Last saved 3 h ago');
    expect(r.querySelector('.slot button[data-action="overwrite"]')).not.toBeNull(); expect(r.querySelector('.slot button[data-action="load"]')).toBeNull();
    e.setTab('load');
    expect(r.querySelector('.slot button[data-action="load"]')).not.toBeNull(); expect(r.querySelector('.slot button[data-action="overwrite"]')).toBeNull();
    e.close();
    const t = el('st-save-load'); document.body.append(t);
    t.bind(api([row('s1', 'One')], { canSave: false }).api); t.open(); await flush();
    expect(t.currentTab).toBe('load'); expect((t as unknown as { root: ShadowRoot }).root.querySelector<HTMLElement>('button[data-tab="save"]')!.hidden).toBe(true);
    t.close(); e.remove(); t.remove();
  });

  it('relative time labels', () => {
    expect(ago(0, 10_000)).toBe('just now'); expect(ago(0, 5 * 60_000)).toBe('5 min ago'); expect(ago(0, 86_400_000 * 3)).toBe('3 d ago');
  });

  it('top bar exposes the Save button and the Continue button (hidden until an autosave exists)', () => {
    const t = el('st-topbar'); document.body.append(t);
    let saved = 0, cont = 0;
    t.bind({ rotate: () => {}, help: () => {}, newMap: () => {}, initial: { size: 64, seed: 1 }, saveLoad: () => { saved++; }, continueLast: () => { cont++; } });
    const btns = [...(t as unknown as { root: ShadowRoot }).root.querySelectorAll('button')];
    const save = btns.find((b) => b.textContent === '💾 Save')!, c = btns.find((b) => b.textContent!.includes('Continue'))!;
    expect(c.hidden).toBe(true);
    t.showContinue(true); expect(c.hidden).toBe(false);
    save.click(); c.click();
    expect(saved).toBe(1); expect(cont).toBe(1);
    t.remove();
  });
});
