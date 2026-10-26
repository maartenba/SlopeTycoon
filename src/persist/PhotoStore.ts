/**
 * Local photo gallery (M5.2, Task 10): IndexedDB, device-only. A SEPARATE small database (`slope-photos`) so the save database and its schema are
 * never touched. Two object stores: 'meta' (listing record + a small JPEG thumbnail; cheap to list) and 'full' (the PNG bytes). Cap
 * `PHOTO_CAP` photos: adding one over the cap evicts the oldest. A quota error evicts the oldest photo and retries, then gives up with a
 * StorageError('quota') (the download itself has already happened, so the caller only has to say the gallery is full).
 * Bytes are stored as Uint8Array (not Blob) so the store behaves the same in every browser and in tests.
 */
import { StorageError } from './IdbStore';

export const PHOTO_CAP = 30;

export interface PhotoMeta {
  id: number;
  createdAt: number;
  resort: string;
  w: number;
  h: number;
  /** PNG size in bytes. */
  bytes: number;
  filter: string;
  frame: string;
  thumb: Uint8Array;
  thumbType: string;
}
export type NewPhoto = Omit<PhotoMeta, 'id' | 'createdAt' | 'bytes'> & { createdAt?: number };

const wrapErr = (e: unknown): StorageError => {
  const err = e as { name?: string; message?: string } | null;
  if (err && (err.name === 'QuotaExceededError' || /quota/i.test(err.message ?? ''))) return new StorageError('quota', 'Not enough storage space for the photo gallery.');
  return new StorageError('io', `Photo storage error: ${err?.message ?? String(e)}`);
};
const req = <T>(r: IDBRequest<T>): Promise<T> => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const txDone = (t: IDBTransaction): Promise<void> => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error ?? new Error('transaction aborted')); });

export class PhotoStore {
  private db: IDBDatabase | null = null;
  private opening: Promise<IDBDatabase> | null = null;

  constructor(private factory: IDBFactory | undefined = (globalThis as { indexedDB?: IDBFactory }).indexedDB, readonly dbName = 'slope-photos', readonly cap = PHOTO_CAP) {}

  static available(factory: IDBFactory | undefined = (globalThis as { indexedDB?: IDBFactory }).indexedDB): boolean { return !!factory; }

  private open(): Promise<IDBDatabase> {
    if (this.db) return Promise.resolve(this.db);
    if (!this.factory) return Promise.reject(new StorageError('unavailable', 'IndexedDB is not available in this browser.'));
    this.opening ??= new Promise<IDBDatabase>((res, rej) => {
      const r = this.factory!.open(this.dbName, 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id', autoIncrement: true });
        if (!db.objectStoreNames.contains('full')) db.createObjectStore('full');
      };
      r.onsuccess = () => { this.db = r.result; this.db.onversionchange = () => { this.db?.close(); this.db = null; this.opening = null; }; res(r.result); };
      r.onerror = () => { this.opening = null; rej(new StorageError('unavailable', `Could not open the photo database: ${r.error?.message ?? 'unknown error'}`)); };
      r.onblocked = () => { this.opening = null; rej(new StorageError('unavailable', 'The photo database is blocked by another tab.')); };
    });
    return this.opening;
  }

  /** Newest first. */
  async list(): Promise<PhotoMeta[]> {
    const db = await this.open();
    try {
      const all = await req(db.transaction('meta').objectStore('meta').getAll() as IDBRequest<PhotoMeta[]>);
      return all.sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);
    } catch (e) { throw wrapErr(e); }
  }

  async count(): Promise<number> { return (await this.list()).length; }

  async getPng(id: number): Promise<Uint8Array | null> {
    const db = await this.open();
    try {
      const v = await req(db.transaction('full').objectStore('full').get(id) as IDBRequest<Uint8Array | ArrayBuffer | undefined>);
      if (v === undefined) return null;
      return v instanceof Uint8Array ? v : new Uint8Array(v);
    } catch (e) { throw wrapErr(e); }
  }

  /** Adds a photo (evicting the oldest ones beyond the cap). On a quota error evicts the oldest and retries up to 3 times, then throws StorageError('quota'). */
  async add(p: NewPhoto, png: Uint8Array): Promise<PhotoMeta> {
    let lastErr: StorageError | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try { return await this.tryAdd(p, png); } catch (e) {
        lastErr = e instanceof StorageError ? e : wrapErr(e);
        if (lastErr.code !== 'quota') throw lastErr;
        const all = await this.list();
        if (all.length === 0) break;
        await this.delete(all[all.length - 1]!.id); // make room: drop the oldest
      }
    }
    throw lastErr ?? new StorageError('quota', 'Not enough storage space for the photo gallery.');
  }

  private async tryAdd(p: NewPhoto, png: Uint8Array): Promise<PhotoMeta> {
    const db = await this.open();
    const tx = db.transaction(['meta', 'full'], 'readwrite');
    try {
      const rec: Omit<PhotoMeta, 'id'> = { ...p, createdAt: p.createdAt ?? Date.now(), bytes: png.length };
      const id = await req(tx.objectStore('meta').add(rec) as IDBRequest<IDBValidKey>) as number;
      tx.objectStore('full').put(png, id);
      // evict beyond the cap (oldest first) inside the same transaction
      const all = await req(tx.objectStore('meta').getAll() as IDBRequest<PhotoMeta[]>);
      all.sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);
      for (const old of all.slice(this.cap)) { tx.objectStore('meta').delete(old.id); tx.objectStore('full').delete(old.id); }
      await txDone(tx);
      return { ...rec, id };
    } catch (e) {
      try { tx.abort(); } catch { /* already finished */ }
      throw wrapErr(e);
    }
  }

  async delete(id: number): Promise<void> {
    const db = await this.open();
    try { const tx = db.transaction(['meta', 'full'], 'readwrite'); tx.objectStore('meta').delete(id); tx.objectStore('full').delete(id); await txDone(tx); } catch (e) { throw wrapErr(e); }
  }

  async clear(): Promise<void> {
    const db = await this.open();
    try { const tx = db.transaction(['meta', 'full'], 'readwrite'); tx.objectStore('meta').clear(); tx.objectStore('full').clear(); await txDone(tx); } catch (e) { throw wrapErr(e); }
  }

  close(): void { this.db?.close(); this.db = null; this.opening = null; }
}
