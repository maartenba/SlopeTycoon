import { describe, expect, it } from 'vitest';
import { IDBFactory, IDBObjectStore as FDBObjectStore } from 'fake-indexeddb';
import { PHOTO_CAP, PhotoStore, type NewPhoto } from '../../src/persist/PhotoStore';
import { IdbStore, StorageError } from '../../src/persist/IdbStore';

const meta = (i = 0): NewPhoto => ({ resort: 'R', w: 640, h: 480, filter: 'none', frame: 'none', thumb: Uint8Array.from([1, 2, 3, i & 255]), thumbType: 'image/jpeg', createdAt: 1000 + i });
const png = (n: number, fill = 7): Uint8Array => new Uint8Array(n).fill(fill);

describe('PhotoStore', () => {
  it('add / list (newest first) / getPng / delete / clear round-trip; stores PNG bytes separately from the listing', async () => {
    const s = new PhotoStore(new IDBFactory());
    expect(await s.list()).toEqual([]);
    const a = await s.add(meta(1), png(5000, 1)), b = await s.add(meta(2), png(10, 2));
    expect(a.bytes).toBe(5000);
    const l = await s.list(); expect(l.map((x) => x.id)).toEqual([b.id, a.id]);
    expect([...l[0]!.thumb]).toEqual([1, 2, 3, 2]);
    expect(l[0]).not.toHaveProperty('png');
    expect((await s.getPng(a.id))!.length).toBe(5000); expect((await s.getPng(a.id))![0]).toBe(1);
    expect(await s.getPng(9999)).toBeNull();
    await s.delete(a.id); expect((await s.list()).length).toBe(1); expect(await s.getPng(a.id)).toBeNull();
    await s.clear(); expect(await s.list()).toEqual([]); expect(await s.count()).toBe(0);
  });
  it(`cap ${PHOTO_CAP}: the oldest photo (meta AND png) is evicted when a new one is added`, async () => {
    const s = new PhotoStore(new IDBFactory());
    const ids: number[] = [];
    for (let i = 0; i < PHOTO_CAP + 3; i++) ids.push((await s.add(meta(i), png(20, i))).id);
    const l = await s.list();
    expect(l.length).toBe(PHOTO_CAP);
    expect(l[0]!.id).toBe(ids[ids.length - 1]); expect(l[l.length - 1]!.id).toBe(ids[3]);
    for (const old of ids.slice(0, 3)) expect(await s.getPng(old)).toBeNull();
    expect(await s.getPng(ids[3]!)).not.toBeNull();
  });
  it('custom cap', async () => {
    const s = new PhotoStore(new IDBFactory(), 'x', 2);
    for (let i = 0; i < 5; i++) await s.add(meta(i), png(4));
    expect((await s.list()).map((x) => x.createdAt)).toEqual([1004, 1003]);
  });
  it('quota error: evicts the oldest photo and retries; gives up with StorageError quota when nothing helps', async () => {
    const s = new PhotoStore(new IDBFactory());
    for (let i = 0; i < 3; i++) await s.add(meta(i), png(10));
    const proto = FDBObjectStore.prototype as unknown as { put: (...a: unknown[]) => unknown; add: (...a: unknown[]) => unknown };
    const origAdd = proto.add; let fails = 1;
    proto.add = function (this: unknown, ...a: unknown[]): unknown { if (fails-- > 0) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; } return origAdd.apply(this, a); };
    try {
      const m = await s.add(meta(10), png(10));
      const l = await s.list(); expect(l.length).toBe(3); expect(l[0]!.id).toBe(m.id); expect(l.map((x) => x.createdAt)).not.toContain(1000); // the oldest made room
      fails = 100;
      await expect(s.add(meta(11), png(10))).rejects.toMatchObject({ code: 'quota' });
      await expect(s.add(meta(11), png(10))).rejects.toBeInstanceOf(StorageError);
      expect((await s.list()).length).toBeGreaterThanOrEqual(0); // never throws from list
    } finally { proto.add = origAdd; }
  });
  it('is a separate database from the saves: opening it does not create or touch the save DB', async () => {
    const f = new IDBFactory();
    const s = new PhotoStore(f); await s.add(meta(), png(3));
    const dbs = await f.databases(); expect(dbs.map((d) => d.name)).toEqual(['slope-photos']);
    const saves = new IdbStore(f); await saves.put('a', new Uint8Array([1]), { meta: { name: 'x', date: { year: 1, day: 1, minute: 0 }, money: 1, rating: 1, guests: 1, mapSize: 64, savedAt: 1 }, auto: false, seed: 1 });
    expect((await f.databases()).map((d) => d.name).sort()).toEqual(['slope-photos', 'slopetycoon']);
    expect((await s.list()).length).toBe(1); expect((await saves.list()).length).toBe(1);
  });
  it('unavailable IndexedDB is a StorageError, not a crash', async () => {
    expect(PhotoStore.available(undefined)).toBe(false);
    await expect(new PhotoStore(undefined).list()).rejects.toMatchObject({ code: 'unavailable' });
  });
});
