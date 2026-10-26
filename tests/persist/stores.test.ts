import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { IdbStore, StorageError, type SaveBackend } from '../../src/persist/IdbStore';
import { LocalFallback, LOCAL_MAX_BYTES } from '../../src/persist/LocalFallback';
import type { SaveMeta } from '../../src/persist/migrations';
import { openBackend } from '../../src/game/restore';

const meta = (name: string): SaveMeta => ({ name, date: { year: 1, day: 3, minute: 0 }, money: 100, rating: 3, guests: 5, mapSize: 64, savedAt: 1 });
const rec = (name: string) => ({ meta: meta(name), auto: false, seed: 7 });

class MemLS {
  m = new Map<string, string>(); quota = Infinity;
  getItem(k: string): string | null { return this.m.get(k) ?? null; }
  setItem(k: string, v: string): void {
    const used = [...this.m.values()].reduce((a, s) => a + s.length, 0);
    if (used + v.length > this.quota) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; }
    this.m.set(k, v);
  }
  removeItem(k: string): void { this.m.delete(k); }
}

/** The same contract for both backends. */
function contract(name: string, make: () => SaveBackend): void {
  describe(name, () => {
    it('put / get / list (newest first, strictly ordered) / rename / delete / settings', async () => {
      const b = make();
      expect(await b.list()).toEqual([]);
      const bytes = Uint8Array.from({ length: 5000 }, (_, i) => i & 255);
      const m1 = await b.put('a', bytes, rec('A'));
      const m2 = await b.put('b', new Uint8Array([1, 2, 3]), rec('B'));
      expect(m2.updatedAt).toBeGreaterThan(m1.updatedAt);
      expect(await b.get('a')).toEqual(bytes);
      expect(await b.get('nope')).toBeNull();
      expect((await b.list()).map((m) => m.id)).toEqual(['b', 'a']);
      expect((await b.list())[1]!.bytes).toBe(5000);
      await b.rename('a', 'Renamed');
      expect((await b.list()).find((m) => m.id === 'a')!.meta.name).toBe('Renamed');
      await b.put('a', new Uint8Array([9]), rec('A2')); // overwrite keeps one row
      expect((await b.list()).length).toBe(2);
      expect(await b.get('a')).toEqual(new Uint8Array([9]));
      await b.delete('a');
      expect((await b.list()).map((m) => m.id)).toEqual(['b']);
      expect(await b.get('a')).toBeNull();
      await b.putSetting!('autosave', false);
      expect(await b.getSetting!('autosave')).toBe(false);
    });
  });
}

contract('IdbStore (fake-indexeddb)', () => new IdbStore(new IDBFactory(), 'test-' + Math.random()));
contract('LocalFallback (in-memory localStorage)', () => new LocalFallback(new MemLS()));

describe('persistence across "page reloads"', () => {
  it('data written by one IdbStore instance is visible to a fresh instance on the same factory', async () => {
    const f = new IDBFactory();
    const a = new IdbStore(f, 'slope');
    await a.put('auto-1', new Uint8Array([1, 2, 3]), rec('Auto'));
    a.close();
    const b = new IdbStore(f, 'slope');
    expect((await b.list()).map((m) => m.id)).toEqual(['auto-1']);
    expect(await b.get('auto-1')).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe('fallbacks and errors', () => {
  it('IdbStore without an IndexedDB reports "unavailable"', async () => {
    const s = new IdbStore(undefined);
    await expect(s.list()).rejects.toMatchObject({ code: 'unavailable' });
    expect(IdbStore.available(undefined)).toBe(false);
  });
  it('openBackend picks IndexedDB, else LocalStorage, else null', () => {
    expect(openBackend({ indexedDB: new IDBFactory() })!.kind).toBe('idb');
    expect(openBackend({ localStorage: new MemLS() as unknown as Storage })!.kind).toBe('local');
    expect(openBackend({})).toBeNull();
    const broken = { setItem: () => { throw new Error('denied'); }, removeItem: () => {}, getItem: () => null } as unknown as Storage;
    expect(openBackend({ localStorage: broken })).toBeNull();
  });
  it('LocalFallback refuses big saves and reports quota errors with a helpful message', async () => {
    const ls = new MemLS(), b = new LocalFallback(ls);
    await expect(b.put('x', new Uint8Array(LOCAL_MAX_BYTES + 1), rec('big'))).rejects.toMatchObject({ code: 'quota' });
    ls.quota = 100;
    const e = await b.put('y', new Uint8Array(500), rec('q')).catch((x) => x as StorageError);
    expect(e).toBeInstanceOf(StorageError);
    expect((e as StorageError).code).toBe('quota');
    expect((e as StorageError).message).toMatch(/full|export/i);
  });
  it('LocalFallback tolerates a corrupt meta index', async () => {
    const ls = new MemLS(); ls.m.set('slope.meta', '{not json');
    expect(await new LocalFallback(ls).list()).toEqual([]);
  });
});
