/**
 * SaveManager (Task 33): slots, rolling autosaves, quick save/load, export/import and error handling on top of a `SaveBackend`.
 * Sim-agnostic apart from `getSim` / `restore` callbacks supplied by the host (main.ts), so it is testable headless with fake-indexeddb.
 */
import type { Sim } from '../game/createSim';
import { decodeSave, encodeSave, makeMeta, SaveError, type EncodeStats } from './Serializer';
import { StorageError, type SaveBackend, type SlotMeta } from './IdbStore';
import type { RawEnvelope, SaveMeta } from './migrations';
import { LOCAL_MAX_BYTES } from './LocalFallback';

export const AUTOSAVE_SLOTS = 3;
export const AUTOSAVE_IDS = Array.from({ length: AUTOSAVE_SLOTS }, (_, i) => `auto-${i + 1}`);
export const QUICK_ID = 'quick';
export const isAutoId = (id: string): boolean => id.startsWith('auto-');
export const FILE_EXTENSION = '.slope';

export type ToastKind = 'info' | 'warn' | 'error';

export interface SaveManagerDeps {
  backend: SaveBackend;
  getSim: () => Sim | null;
  /** Replace the running game with this save (host rebuilds renderer / UI). Throws on failure. */
  restore: (env: RawEnvelope, id: string) => Promise<void>;
  toast?: (text: string, kind?: ToastKind) => void;
  /** Extra meta from the host (camera, thumbnail). */
  extraMeta?: () => Partial<SaveMeta>;
  /** Default new-slot name. */
  defaultName?: (sim: Sim) => string;
  download?: (fileName: string, bytes: Uint8Array) => void;
  compress?: boolean;
}

/** Human message for a failure (toast-ready). */
export function describeError(e: unknown): string {
  if (e instanceof SaveError || e instanceof StorageError) return e.message;
  return `Unexpected error: ${(e as Error)?.message ?? String(e)}`;
}

const sanitizeFile = (n: string): string => n.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 48) || 'slope-tycoon';

export class SaveManager {
  autosaveEnabled = true;
  private listeners = new Set<() => void>();
  private busy: Promise<unknown> = Promise.resolve();
  private autoIdx = 0;
  private dirtySinceSave = false;
  private offs: Array<() => void> = [];
  lastStats: EncodeStats | null = null;
  /** Result of the last background autosave (tests / UI). */
  lastAutosaveAt = 0;
  /** Epoch ms of the last successful save of the running game (manual, quick or auto); null before the first one. Shown as 'Saved 2 min ago' in the top bar. */
  lastSavedAt: number | null = null;

  constructor(private d: SaveManagerDeps) {}

  get backendKind(): 'idb' | 'local' { return this.d.backend.kind; }
  onChange(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private changed(): void { for (const f of this.listeners) f(); }
  private say(t: string, k: ToastKind = 'info'): void { this.d.toast?.(t, k); }

  /** Serialise operations so two saves never interleave (async encode yields to the event loop). */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.busy.then(fn, fn);
    this.busy = run.catch(() => undefined);
    return run;
  }

  async list(): Promise<SlotMeta[]> { return this.d.backend.list(); }

  /** Existing settings (autosave toggle) persisted in the backend. */
  async loadSettings(): Promise<void> {
    try { const v = await this.d.backend.getSetting?.('autosave'); if (typeof v === 'boolean') this.autosaveEnabled = v; } catch { /* default */ }
  }
  async setAutosave(on: boolean): Promise<void> {
    this.autosaveEnabled = on;
    try { await this.d.backend.putSetting?.('autosave', on); } catch { /* not critical */ }
    this.changed();
  }

  // ------------------------------------------------------------------ save

  /** Save the running game into `id` (default: a new numbered slot). Returns the listing record; throws StorageError on failure (also toasted). */
  save(id?: string, name?: string, opt: { quiet?: boolean; auto?: boolean } = {}): Promise<SlotMeta> {
    return this.serial(async () => {
      const sim = this.d.getSim();
      if (!sim) throw new Error('No game is running.');
      const slot = id ?? `slot-${Date.now().toString(36)}`;
      const existing = id ? (await this.d.backend.list()).find((m) => m.id === id) : undefined;
      const title = name ?? existing?.meta.name ?? this.d.defaultName?.(sim) ?? `Resort ${sim.game.date.year}`;
      const meta = makeMeta(sim, title, this.d.extraMeta?.());
      try {
        const { bytes, stats } = await encodeSave(sim, meta, { compress: this.d.compress });
        this.lastStats = stats;
        if (this.d.backend.kind === 'local' && bytes.length > LOCAL_MAX_BYTES) throw new StorageError('quota', `This save (${(bytes.length / 1048576).toFixed(1)} MB) is too big for the fallback storage. Export it as a .slope file instead.`);
        const rec = await this.d.backend.put(slot, bytes, { meta, auto: !!opt.auto || isAutoId(slot), seed: sim.seed });
        this.dirtySinceSave = false; this.lastSavedAt = Date.now();
        if (!opt.quiet) this.say(`Game saved: “${title}”${this.d.backend.kind === 'local' ? ' (browser fallback storage — small saves only)' : ''}`);
        this.changed();
        return rec;
      } catch (e) {
        this.say(`Save failed: ${describeError(e)}`, 'error');
        throw e;
      }
    });
  }

  quickSave(): Promise<SlotMeta> { return this.save(QUICK_ID, 'Quicksave'); }

  private held = false;
  private heldPending = false;
  /** Fast-forward: month autosaves are collapsed into ONE autosave when the hold is released (no IDB spam mid-run). */
  holdAutosave(on: boolean): void {
    if (this.held === on) return;
    this.held = on;
    if (!on && this.heldPending) { this.heldPending = false; void this.autosave('month'); }
  }

  /** Rolling autosave into Autosave 1..3 (oldest slot is overwritten). Quiet info toast. */
  autosave(reason: 'month' | 'hidden' | 'manual' = 'month'): Promise<SlotMeta | null> {
    if (!this.autosaveEnabled || !this.d.getSim()) return Promise.resolve(null);
    if (this.d.getSim()!.finance.ended) return Promise.resolve(null);
    return this.serial(async () => {
      const metas = await this.d.backend.list();
      // pick the empty / oldest autosave slot (backends stamp updatedAt strictly increasing)
      const slot = [...AUTOSAVE_IDS].sort((a, b) => (metas.find((m) => m.id === a)?.updatedAt ?? 0) - (metas.find((m) => m.id === b)?.updatedAt ?? 0))[0]!;
      this.autoIdx = AUTOSAVE_IDS.indexOf(slot);
      const sim = this.d.getSim()!;
      const meta = makeMeta(sim, `Autosave ${this.autoIdx + 1}`, this.d.extraMeta?.());
      try {
        const { bytes, stats } = await encodeSave(sim, meta, { compress: this.d.compress });
        this.lastStats = stats;
        const rec = await this.d.backend.put(slot, bytes, { meta, auto: true, seed: sim.seed });
        this.lastAutosaveAt = Date.now(); this.lastSavedAt = this.lastAutosaveAt; this.dirtySinceSave = false;
        if (reason === 'month') this.say('Autosaved');
        this.changed();
        return rec;
      } catch (e) {
        this.say(`Autosave failed: ${describeError(e)}`, 'warn');
        return null;
      }
    });
  }

  /** Autosave on every in-game month change; best-effort save when the tab is hidden / being closed. Returns a detach function. */
  attach(bus: { on(ev: 'month:changed', fn: () => void): () => void }, doc: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'> | undefined, win?: Pick<Window, 'addEventListener' | 'removeEventListener'>): () => void {
    this.offs.push(bus.on('month:changed', () => { this.dirtySinceSave = true; if (this.held) { this.heldPending = true; return; } void this.autosave('month'); }));
    const hidden = (): void => { if (doc && doc.visibilityState === 'hidden' && this.autosaveEnabled && this.d.getSim()) void this.autosave('hidden'); };
    const unload = (): void => { if (this.autosaveEnabled && this.d.getSim()) void this.autosave('hidden'); };
    doc?.addEventListener('visibilitychange', hidden);
    win?.addEventListener('pagehide', unload);
    win?.addEventListener('beforeunload', unload);
    this.offs.push(() => { doc?.removeEventListener('visibilitychange', hidden); win?.removeEventListener('pagehide', unload); win?.removeEventListener('beforeunload', unload); });
    return () => { for (const o of this.offs.splice(0)) o(); };
  }

  // ------------------------------------------------------------------ load

  /** Read + validate a slot without applying it. */
  async read(id: string): Promise<RawEnvelope> {
    const bytes = await this.d.backend.get(id);
    if (!bytes) throw new SaveError('invalid', 'That save no longer exists.');
    return (await decodeSave(bytes)).envelope;
  }

  /** Load a slot into the running game. Corrupt / newer saves are refused with a message and the slot is kept untouched. */
  load(id: string): Promise<boolean> {
    return this.serial(async () => {
      try {
        const env = await this.read(id);
        await this.d.restore(env, id);
        this.say(`Loaded “${env.meta.name}”`);
        return true;
      } catch (e) {
        this.say(`Could not load: ${describeError(e)}`, 'error');
        return false;
      }
    });
  }

  quickLoad(): Promise<boolean> { return this.load(QUICK_ID); }

  /** Newest loadable save: the most recent autosave / quicksave first; a corrupt newest slot falls back to the next one (recovery). */
  async latest(): Promise<SlotMeta | null> {
    try { return (await this.d.backend.list())[0] ?? null; } catch { return null; }
  }
  async hasContinue(): Promise<boolean> { return (await this.latest()) !== null; }

  async continueLast(): Promise<boolean> {
    let metas: SlotMeta[];
    try { metas = await this.d.backend.list(); } catch (e) { this.say(`Could not read saves: ${describeError(e)}`, 'error'); return false; }
    for (const m of metas) {
      try {
        const env = await this.read(m.id);
        await this.d.restore(env, m.id);
        this.say(`Continued “${env.meta.name}”`);
        return true;
      } catch (e) {
        this.say(`Save “${m.meta.name}” could not be loaded (${describeError(e)}). ${metas.length > 1 ? 'Trying the next newest…' : ''}`, 'warn');
      }
    }
    return false;
  }

  // ------------------------------------------------------------------ manage

  async delete(id: string): Promise<void> { await this.d.backend.delete(id); this.changed(); }
  async rename(id: string, name: string): Promise<void> {
    const n = name.trim().slice(0, 60);
    if (!n) return;
    await this.d.backend.rename(id, n); this.changed();
  }

  // ------------------------------------------------------------------ export / import

  /** Export a stored slot (or the live game when `id` is null) as a `.slope` file download. */
  async exportSlot(id: string | null): Promise<string> {
    let bytes: Uint8Array, name: string;
    if (id === null) {
      const sim = this.d.getSim();
      if (!sim) throw new Error('No game is running.');
      name = this.d.defaultName?.(sim) ?? 'resort';
      bytes = (await encodeSave(sim, makeMeta(sim, name, this.d.extraMeta?.()), { compress: this.d.compress })).bytes;
    } else {
      const b = await this.d.backend.get(id);
      if (!b) throw new SaveError('invalid', 'That save no longer exists.');
      bytes = b; name = (await this.d.backend.list()).find((m) => m.id === id)?.meta.name ?? id;
    }
    const file = sanitizeFile(name) + FILE_EXTENSION;
    this.d.download?.(file, bytes);
    return file;
  }

  /** Validate an imported file and store it in a new slot (never overwrites). Throws SaveError for invalid / corrupt / newer / huge files. */
  async importBytes(bytes: Uint8Array, fileName = 'imported'): Promise<SlotMeta> {
    try {
      const { envelope } = await decodeSave(bytes);
      const name = envelope.meta.name || fileName.replace(/\.slope$/i, '');
      const meta: SaveMeta = { ...envelope.meta, name };
      const rec = await this.serial(() => this.d.backend.put(`import-${Date.now().toString(36)}`, bytes, { meta, auto: false, seed: envelope.seed }));
      this.say(`Imported “${name}”`);
      this.changed();
      return rec;
    } catch (e) {
      this.say(`Import failed: ${describeError(e)}`, 'error');
      throw e;
    }
  }

  async importFile(file: Blob & { name?: string }): Promise<SlotMeta> {
    if (file.size > 64 * 1024 * 1024) { const e = new SaveError('tooLarge', 'That file is too large to be a Slope Tycoon save.'); this.say(`Import failed: ${e.message}`, 'error'); throw e; }
    return this.importBytes(new Uint8Array(await file.arrayBuffer()), file.name);
  }
}

/** Browser download of bytes as a file (used by main.ts as `download` dep). */
export function downloadBytes(fileName: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url; a.download = fileName; a.style.display = 'none';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
