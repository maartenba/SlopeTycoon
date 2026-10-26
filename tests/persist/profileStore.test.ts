import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { PROFILE_DB, PROFILE_LS_KEY, ProfileStore, emptyProfile, sanitizeProfile } from '../../src/persist/ProfileStore';
import { IdbStore } from '../../src/persist/IdbStore';

const mem = (): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: (k) => { data.delete(k); } };
};

describe('ProfileStore', () => {
  it('starts empty; records attempts, results and keeps the BEST medal / score / time', async () => {
    const s = new ProfileStore(new IDBFactory(), mem());
    await s.ready;
    expect(s.getProfile()).toEqual(emptyProfile());
    await s.recordStart('first-tracks'); await s.recordStart('first-tracks');
    await s.recordResult('first-tracks', { result: 'won', medal: 'silver', score: 130, days: 100 });
    await s.recordResult('first-tracks', { result: 'won', medal: 'bronze', score: 90, days: 60 });
    await s.recordResult('first-tracks', { result: 'lost', medal: 'none', score: 5, days: 180 });
    expect(s.record('first-tracks')).toEqual({ bestMedal: 'silver', bestScore: 130, bestDays: 60, attempts: 2, wins: 2, lastResult: 'lost' });
    expect(s.record('unknown-one')).toMatchObject({ bestMedal: 'none', attempts: 0 });
  });

  it('persists across instances (own IndexedDB database `slope-profile`)', async () => {
    const f = new IDBFactory();
    const a = new ProfileStore(f, mem());
    await a.recordResult('family-valley', { result: 'won', medal: 'gold', score: 200, days: 120 });
    const b = new ProfileStore(f, mem()); await b.ready;
    expect(b.record('family-valley').bestMedal).toBe('gold');
    expect((await f.databases()).map((d) => d.name)).toEqual([PROFILE_DB]);
  });

  it('is separate from the save database: deleting every save slot keeps the medals, and saves never see the profile', async () => {
    const f = new IDBFactory();
    const p = new ProfileStore(f, mem());
    await p.recordResult('first-tracks', { result: 'won', medal: 'bronze', score: 100, days: 90 });
    const saves = new IdbStore(f);
    await saves.putSetting('x', 1);
    expect((await f.databases()).map((d) => d.name).sort()).toEqual(['slope-profile', 'slopetycoon']);
    await new Promise<void>((res, rej) => { const r = f.deleteDatabase('slopetycoon'); r.onsuccess = () => res(); r.onerror = () => rej(r.error); }); // "clear all saves"
    const again = new ProfileStore(f, mem()); await again.ready;
    expect(again.record('first-tracks').bestMedal).toBe('bronze');
    expect(await new IdbStore(f).list()).toEqual([]);
  });

  it('corruption falls back to an empty profile without throwing, and the next update repairs it', async () => {
    const ls = mem(); ls.setItem(PROFILE_LS_KEY, '{not json');
    const s = new ProfileStore(undefined, ls); await s.ready;
    expect(s.recovered).toBe(true); expect(s.getProfile()).toEqual(emptyProfile());
    await s.recordStart('first-tracks');
    expect(JSON.parse(ls.data.get(PROFILE_LS_KEY)!).scenarios['first-tracks'].attempts).toBe(1);
  });

  it('sanitises hostile / partial documents: bad ids, negative numbers, unknown medals, wrong shapes', () => {
    const p = sanitizeProfile({ v: 7, scenarios: { 'ok-one': { bestMedal: 'platinum', bestScore: -5, bestDays: 'x', attempts: 3.7, wins: 'many', lastResult: 'draw' }, 'BAD ID': {}, 'arr': [] }, achievements: { unlocked: { 'a-one': { at: 5 }, 'BAD': { at: 1 }, 'no-at': {} }, counters: { guests: 12.4, neg: -1 } }, extra: 1 });
    expect(Object.keys(p.scenarios)).toEqual(['ok-one']);
    expect(p.scenarios['ok-one']).toEqual({ bestMedal: 'none', bestScore: 0, bestDays: 0, attempts: 4, wins: 0, lastResult: null });
    expect(p.achievements.unlocked).toEqual({ 'a-one': { at: 5 } }); expect(p.achievements.counters).toEqual({ guests: 12 });
    for (const x of [null, 5, 'x', [], { scenarios: 5, achievements: [] }]) expect(sanitizeProfile(x)).toEqual(emptyProfile());
  });

  it('subscribe notifies on every update; unsubscribe stops it; a throwing listener does not break saving', async () => {
    const s = new ProfileStore(new IDBFactory(), mem());
    const seen: number[] = [];
    const off = s.subscribe((p) => seen.push(Object.keys(p.scenarios).length));
    s.subscribe(() => { throw new Error('bad listener'); });
    await s.recordStart('first-tracks'); await s.recordStart('family-valley');
    off(); await s.recordStart('powder-dreams');
    expect(seen).toEqual([1, 2]);
    expect(Object.keys(s.getProfile().scenarios).length).toBe(3);
  });

  it('extendable: the achievements namespace is preserved, update drafts cannot corrupt the live profile, a throwing update is ignored', async () => {
    const f = new IDBFactory();
    const s = new ProfileStore(f, mem());
    await s.update((p) => { p.achievements.unlocked['first-lift'] = { at: 123 }; });
    await s.update(() => { throw new Error('boom'); });
    expect(s.lastError).toMatch(/update failed/);
    const live = s.getProfile();
    await s.update((p) => { p.scenarios['bad id'] = {} as never; });
    expect(s.getProfile().scenarios).toEqual({}); expect(live.achievements.unlocked).toEqual({ 'first-lift': { at: 123 } });
    const t = new ProfileStore(f, mem()); await t.ready;
    expect(t.getProfile().achievements.unlocked).toEqual({ 'first-lift': { at: 123 } });
  });

  it('IndexedDB unavailable: LocalStorage holds the profile; quota errors are swallowed (memory still correct)', async () => {
    const ls = mem();
    const a = new ProfileStore(undefined, ls);
    await a.recordResult('first-tracks', { result: 'won', medal: 'silver', score: 140, days: 80 });
    const b = new ProfileStore(undefined, ls); await b.ready;
    expect(b.record('first-tracks').bestMedal).toBe('silver');
    const full: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = { getItem: () => null, removeItem: () => {}, setItem: () => { throw new DOMException('full', 'QuotaExceededError'); } };
    const c = new ProfileStore(undefined, full);
    await expect(c.recordStart('first-tracks')).resolves.toBeUndefined();
    expect(c.record('first-tracks').attempts).toBe(1); expect(c.lastError).toMatch(/LocalStorage/);
    const none = new ProfileStore(undefined, undefined);
    await expect(none.recordStart('first-tracks')).resolves.toBeUndefined();
  });

  it('there is no export / import / share API on the store', () => {
    const s = new ProfileStore(new IDBFactory(), mem());
    for (const k of Object.getOwnPropertyNames(Object.getPrototypeOf(s))) expect(/export|import|share|download|upload/i.test(k), k).toBe(false);
  });
});
