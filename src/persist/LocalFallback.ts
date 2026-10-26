/**
 * LocalStorage save backend (Task 33): used only when IndexedDB is unavailable (some private-browsing modes). LocalStorage holds ~5 MB of
 * UTF-16 strings, so only small saves fit (64 maps, a few slots); anything over `MAX_BYTES` is refused with a clear message.
 */
import { bytesToBase64, base64ToBytes } from './codec';
import { StorageError, type SaveBackend, type SlotMeta } from './IdbStore';

export const LOCAL_MAX_BYTES = 1_500_000;
const META_KEY = 'slope.meta', SAVE_PREFIX = 'slope.save.', SET_PREFIX = 'slope.set.';

export class LocalFallback implements SaveBackend {
  readonly kind = 'local' as const;
  private stamp = 0;
  constructor(private ls: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined = (globalThis as { localStorage?: Storage }).localStorage) {}

  static available(ls: unknown = (globalThis as { localStorage?: Storage }).localStorage): boolean {
    try {
      const s = ls as Storage | undefined;
      if (!s) return false;
      s.setItem('slope.probe', '1'); s.removeItem('slope.probe');
      return true;
    } catch { return false; }
  }

  private store(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
    if (!this.ls) throw new StorageError('unavailable', 'No storage is available in this browser.');
    return this.ls;
  }
  private readMeta(): SlotMeta[] {
    try { return JSON.parse(this.store().getItem(META_KEY) ?? '[]') as SlotMeta[]; } catch { return []; }
  }
  private writeMeta(m: SlotMeta[]): void { this.store().setItem(META_KEY, JSON.stringify(m)); }
  private wrap(e: unknown): StorageError {
    if (e instanceof StorageError) return e;
    const x = e as { name?: string; message?: string };
    if (x?.name === 'QuotaExceededError' || /quota/i.test(x?.message ?? '')) return new StorageError('quota', 'Browser storage is full. Delete old saves or export them as .slope files.');
    return new StorageError('io', `Storage error: ${x?.message ?? String(e)}`);
  }

  async list(): Promise<SlotMeta[]> { return this.readMeta().sort((a, b) => b.updatedAt - a.updatedAt); }

  async get(id: string): Promise<Uint8Array | null> {
    try { const v = this.store().getItem(SAVE_PREFIX + id); return v === null ? null : base64ToBytes(v); } catch (e) { throw this.wrap(e); }
  }

  async put(id: string, bytes: Uint8Array, rec: Omit<SlotMeta, 'id' | 'bytes' | 'updatedAt'>): Promise<SlotMeta> {
    if (bytes.length > LOCAL_MAX_BYTES) throw new StorageError('quota', `This save (${(bytes.length / 1048576).toFixed(1)} MB) is too big for the fallback storage (IndexedDB is unavailable). Export it as a .slope file instead.`);
    this.stamp = Math.max(Date.now(), this.stamp + 1);
    const meta: SlotMeta = { ...rec, id, bytes: bytes.length, updatedAt: this.stamp };
    try {
      this.store().setItem(SAVE_PREFIX + id, bytesToBase64(bytes));
      this.writeMeta([...this.readMeta().filter((m) => m.id !== id), meta]);
      return meta;
    } catch (e) { throw this.wrap(e); }
  }

  async delete(id: string): Promise<void> {
    try { this.store().removeItem(SAVE_PREFIX + id); this.writeMeta(this.readMeta().filter((m) => m.id !== id)); } catch (e) { throw this.wrap(e); }
  }

  async rename(id: string, name: string): Promise<void> {
    try { this.writeMeta(this.readMeta().map((m) => (m.id === id ? { ...m, meta: { ...m.meta, name } } : m))); } catch (e) { throw this.wrap(e); }
  }

  async getSetting(key: string): Promise<unknown> { try { const v = this.store().getItem(SET_PREFIX + key); return v === null ? undefined : JSON.parse(v); } catch { return undefined; } }
  async putSetting(key: string, value: unknown): Promise<void> { try { this.store().setItem(SET_PREFIX + key, JSON.stringify(value)); } catch (e) { throw this.wrap(e); } }
}
