/**
 * IndexedDB save storage (Task 33). Object stores: 'saves' (slot id -> payload bytes), 'meta' (slot id -> listing record, so the slot list
 * never has to load payloads) and 'settings' (key -> value). One transaction per write keeps payload + listing consistent.
 */
import type { SaveMeta } from './migrations';

export interface SlotMeta { id: string; meta: SaveMeta; bytes: number; auto: boolean; seed: number; updatedAt: number }

export type StorageErrorCode = 'quota' | 'unavailable' | 'io';
export class StorageError extends Error {
  constructor(readonly code: StorageErrorCode, message: string) { super(message); this.name = 'StorageError'; }
}

/** What SaveManager needs from a backend (IndexedDB or the LocalStorage fallback). */
export interface SaveBackend {
  readonly kind: 'idb' | 'local';
  list(): Promise<SlotMeta[]>;
  get(id: string): Promise<Uint8Array | null>;
  put(id: string, bytes: Uint8Array, rec: Omit<SlotMeta, 'id' | 'bytes' | 'updatedAt'>): Promise<SlotMeta>;
  delete(id: string): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  getSetting?(key: string): Promise<unknown>;
  putSetting?(key: string, value: unknown): Promise<void>;
}

const wrapErr = (e: unknown): StorageError => {
  const err = e as { name?: string; message?: string } | null;
  if (err && (err.name === 'QuotaExceededError' || /quota/i.test(err.message ?? ''))) return new StorageError('quota', 'Not enough storage space to save. Delete old saves or export them, then try again.');
  return new StorageError('io', `Storage error: ${err?.message ?? String(e)}`);
};

const req = <T>(r: IDBRequest<T>): Promise<T> => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const txDone = (t: IDBTransaction): Promise<void> => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error ?? new Error('transaction aborted')); });

export class IdbStore implements SaveBackend {
  readonly kind = 'idb' as const;
  private db: IDBDatabase | null = null;
  private opening: Promise<IDBDatabase> | null = null;
  private stamp = 0;

  constructor(private factory: IDBFactory | undefined = (globalThis as { indexedDB?: IDBFactory }).indexedDB, readonly dbName = 'slopetycoon') {}

  static available(factory: IDBFactory | undefined = (globalThis as { indexedDB?: IDBFactory }).indexedDB): boolean { return !!factory; }

  private open(): Promise<IDBDatabase> {
    if (this.db) return Promise.resolve(this.db);
    if (!this.factory) return Promise.reject(new StorageError('unavailable', 'IndexedDB is not available in this browser.'));
    this.opening ??= new Promise<IDBDatabase>((res, rej) => {
      const r = this.factory!.open(this.dbName, 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        for (const s of ['saves', 'meta', 'settings']) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      };
      r.onsuccess = () => { this.db = r.result; this.db.onversionchange = () => { this.db?.close(); this.db = null; this.opening = null; }; res(r.result); };
      r.onerror = () => { this.opening = null; rej(new StorageError('unavailable', `Could not open the save database: ${r.error?.message ?? 'unknown error'}`)); };
      r.onblocked = () => { this.opening = null; rej(new StorageError('unavailable', 'The save database is blocked by another tab.')); };
    });
    return this.opening;
  }

  async list(): Promise<SlotMeta[]> {
    const db = await this.open();
    try {
      const all = await req(db.transaction('meta').objectStore('meta').getAll() as IDBRequest<SlotMeta[]>);
      return all.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch (e) { throw wrapErr(e); }
  }

  async get(id: string): Promise<Uint8Array | null> {
    const db = await this.open();
    try {
      const v = await req(db.transaction('saves').objectStore('saves').get(id) as IDBRequest<Uint8Array | ArrayBuffer | undefined>);
      if (v === undefined) return null;
      return v instanceof Uint8Array ? v : new Uint8Array(v);
    } catch (e) { throw wrapErr(e); }
  }

  async put(id: string, bytes: Uint8Array, rec: Omit<SlotMeta, 'id' | 'bytes' | 'updatedAt'>): Promise<SlotMeta> {
    const db = await this.open();
    this.stamp = Math.max(Date.now(), this.stamp + 1); // strictly increasing: 'newest' / rolling autosaves never tie
    const meta: SlotMeta = { ...rec, id, bytes: bytes.length, updatedAt: this.stamp };
    try {
      const tx = db.transaction(['saves', 'meta'], 'readwrite');
      tx.objectStore('saves').put(bytes, id);
      tx.objectStore('meta').put(meta, id);
      await txDone(tx);
      return meta;
    } catch (e) { throw wrapErr(e); }
  }

  async delete(id: string): Promise<void> {
    const db = await this.open();
    try {
      const tx = db.transaction(['saves', 'meta'], 'readwrite');
      tx.objectStore('saves').delete(id); tx.objectStore('meta').delete(id);
      await txDone(tx);
    } catch (e) { throw wrapErr(e); }
  }

  async rename(id: string, name: string): Promise<void> {
    const db = await this.open();
    try {
      const tx = db.transaction('meta', 'readwrite');
      const st = tx.objectStore('meta');
      const cur = await req(st.get(id) as IDBRequest<SlotMeta | undefined>);
      if (cur) st.put({ ...cur, meta: { ...cur.meta, name } }, id);
      await txDone(tx);
    } catch (e) { throw wrapErr(e); }
  }

  async getSetting(key: string): Promise<unknown> {
    const db = await this.open();
    try { return await req(db.transaction('settings').objectStore('settings').get(key)); } catch (e) { throw wrapErr(e); }
  }
  async putSetting(key: string, value: unknown): Promise<void> {
    const db = await this.open();
    try { const tx = db.transaction('settings', 'readwrite'); tx.objectStore('settings').put(value, key); await txDone(tx); } catch (e) { throw wrapErr(e); }
  }

  close(): void { this.db?.close(); this.db = null; this.opening = null; }
}
