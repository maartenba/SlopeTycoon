import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { makeResort, run } from '../game/harness';
import { createSim, type Sim } from '../../src/game/createSim';
import { stateHash } from '../../src/game/saveState';
import { IdbStore, StorageError, type SaveBackend } from '../../src/persist/IdbStore';
import { AUTOSAVE_IDS, SaveManager } from '../../src/persist/SaveManager';
import { LocalFallback } from '../../src/persist/LocalFallback';
import { resolveBootSave, stripBootParams, loadQuery } from '../../src/game/restore';
import type { RawEnvelope } from '../../src/persist/migrations';

interface Harness { sim: Sim; mgr: SaveManager; toasts: Array<[string, string | undefined]>; restored: Array<[RawEnvelope, string]>; downloads: Array<[string, Uint8Array]> }
function harness(backend: SaveBackend, sim: Sim): Harness {
  const h: Harness = { sim, toasts: [], restored: [], downloads: [], mgr: null as never };
  h.mgr = new SaveManager({
    backend, getSim: () => sim, restore: async (e, id) => { h.restored.push([e, id]); },
    toast: (t, k) => h.toasts.push([t, k]), download: (n, b) => h.downloads.push([n, b]), defaultName: () => 'My Resort',
  });
  return h;
}
const fresh = (): { sim: Sim; f: IDBFactory } => ({ sim: makeResort(64, 11, { startDay: 335 }).sim, f: new IDBFactory() });

describe('SaveManager', () => {
  it('save → list → load hands a decodable envelope to the host (and the slot keeps its data)', async () => {
    const { sim, f } = fresh(); run(sim, { days: 0.6 });
    const h = harness(new IdbStore(f), sim);
    const rec = await h.mgr.save(undefined, 'First');
    expect(rec.meta.name).toBe('First'); expect(rec.meta.mapSize).toBe(64); expect(rec.meta.guests).toBe(sim.guestSim.store.count); expect(rec.bytes).toBeGreaterThan(1000);
    expect((await h.mgr.list()).map((m) => m.id)).toEqual([rec.id]);
    expect(await h.mgr.load(rec.id)).toBe(true);
    const [env, id] = h.restored[0]!;
    expect(id).toBe(rec.id); expect(env.seed).toBe(11);
    const copy = createSim({ size: 64, seed: 11, now: () => 0, fromSave: env.modules });
    expect(copy.game.money).toBe(sim.game.money);
    expect(copy.buildings.all().length).toBe(sim.buildings.all().length);
    await h.mgr.rename(rec.id, 'Renamed'); expect((await h.mgr.list())[0]!.meta.name).toBe('Renamed');
    await h.mgr.delete(rec.id); expect(await h.mgr.list()).toEqual([]);
  }, 60_000);

  it('autosave on month change rolls through Autosave 1..3 and overwrites the oldest; quiet toast', async () => {
    const { sim, f } = fresh();
    const h = harness(new IdbStore(f), sim);
    const detach = h.mgr.attach(sim.bus as never, undefined);
    for (let i = 0; i < 4; i++) { sim.bus.emit('month:changed', { year: 1, month: i }); await new Promise((r) => setTimeout(r, 30)); sim.tick(5); }
    await h.mgr.autosave('manual'); // serialised after the queued ones
    const list = await h.mgr.list();
    expect(list.map((m) => m.id).sort()).toEqual([...AUTOSAVE_IDS].sort());
    expect(list.every((m) => m.auto)).toBe(true);
    expect(h.toasts.filter(([t]) => t === 'Autosaved').length).toBe(4);
    expect(h.toasts.every(([, k]) => k === undefined || k === 'info')).toBe(true);
    // newest = the last write (rolling): saving 5 times cycles 1,2,3,1,2 -> auto-2 is newest
    expect(list[0]!.id).toBe('auto-2');
    detach();
    await h.mgr.setAutosave(false);
    const before = (await h.mgr.list())[0]!.updatedAt;
    expect(await h.mgr.autosave('month')).toBeNull();
    expect((await h.mgr.list())[0]!.updatedAt).toBe(before);
  }, 60_000);

  it('autosave when the tab is hidden', async () => {
    const { sim, f } = fresh();
    const h = harness(new IdbStore(f), sim);
    const listeners = new Map<string, () => void>();
    const doc = { visibilityState: 'visible' as DocumentVisibilityState, addEventListener: (t: string, fn: () => void) => { listeners.set(t, fn); }, removeEventListener: () => {} };
    h.mgr.attach(sim.bus as never, doc as never);
    listeners.get('visibilitychange')!();
    expect(await h.mgr.list()).toEqual([]); // visible: nothing
    doc.visibilityState = 'hidden'; listeners.get('visibilitychange')!();
    await h.mgr.autosave('manual').catch(() => {});
    expect((await h.mgr.list()).length).toBeGreaterThanOrEqual(1);
    expect(h.toasts.some(([t]) => t === 'Autosaved')).toBe(false); // hidden / manual autosaves are silent (only the monthly one toasts)
  }, 60_000);

  it('"reload page restores autosave": a fresh manager + backend on the same IndexedDB boots from ?continue=1 with identical state', async () => {
    const { sim, f } = fresh(); run(sim, { days: 0.7 });
    const h = harness(new IdbStore(f), sim);
    await h.mgr.autosave('manual');
    const expected = stateHash(sim);
    // --- "page reload": new IdbStore instance, no shared JS state with the first one ---
    const after = new IdbStore(f);
    const boot = await resolveBootSave(after, new URLSearchParams('continue=1'));
    expect(boot.warnings).toEqual([]);
    expect(boot.save!.id).toBe('auto-1');
    const loaded = createSim({ size: boot.save!.env.mapSize, seed: boot.save!.env.seed, now: () => 0, fromSave: boot.save!.env.modules });
    const got = stateHash(loaded);
    // identical except the documented demotions (guests in transit/using → attractions/guests modules) and the networks cache counter
    const diff = Object.keys(expected.parts).filter((k) => expected.parts[k] !== got.parts[k] && !['sys.guests', 'sys.attractions', 'networks'].includes(k));
    expect(diff).toEqual([]);
    expect(loaded.game.date).toEqual(sim.game.date);
    expect((await resolveBootSave(after, new URLSearchParams('load=auto-1'))).save!.env.meta.name).toBe('Autosave 1');
    expect((await resolveBootSave(after, new URLSearchParams(''))).save).toBeNull();
    expect((await resolveBootSave(null, new URLSearchParams('continue=1'))).save).toBeNull();
    expect(await new SaveManager({ backend: after, getSim: () => null, restore: async () => {} }).hasContinue()).toBe(true);
  }, 60_000);

  it('corrupt newest save: Continue falls back to the older one, warns, and keeps the corrupt slot', async () => {
    const { sim, f } = fresh();
    const backend = new IdbStore(f), h = harness(backend, sim);
    await h.mgr.save('old', 'Old good');
    const good = (await backend.get('old'))!;
    const bad = good.slice(); bad[Math.floor(bad.length / 2)]! ^= 0xff; bad[bad.length - 20]! ^= 0x55;
    await backend.put('new-corrupt', bad, { meta: { ...(await backend.list())[0]!.meta, name: 'Broken' }, auto: false, seed: 11 });
    expect((await backend.list())[0]!.id).toBe('new-corrupt');
    // direct load: refused with an error toast, nothing restored
    expect(await h.mgr.load('new-corrupt')).toBe(false);
    expect(h.restored).toEqual([]);
    expect(h.toasts.some(([t, k]) => k === 'error' && /could not load/i.test(t))).toBe(true);
    // boot with ?continue=1: warning + falls back
    const boot = await resolveBootSave(backend, new URLSearchParams('continue=1'));
    expect(boot.save!.id).toBe('old');
    expect(boot.warnings.length).toBe(1);
    expect(boot.warnings[0]).toMatch(/Broken/);
    expect(await h.mgr.continueLast()).toBe(true);
    expect(h.restored.at(-1)![1]).toBe('old');
    expect((await backend.list()).map((m) => m.id).sort()).toEqual(['new-corrupt', 'old']); // slot kept
    // explicit ?load of the corrupt one: warning, fresh game
    const b2 = await resolveBootSave(backend, new URLSearchParams('load=new-corrupt'));
    expect(b2.save).toBeNull(); expect(b2.warnings.length).toBe(1);
  }, 60_000);

  it('a save from a newer game version is refused with a message, slot untouched', async () => {
    const { sim, f } = fresh();
    const backend = new IdbStore(f), h = harness(backend, sim);
    const { encodeBytes } = await import('../../src/persist/codec');
    const { SAVE_MAGIC } = await import('../../src/persist/Serializer');
    const bytes = await encodeBytes(JSON.stringify({ magic: SAVE_MAGIC, version: 99, createdAt: 1, seed: 1, mapSize: 64, meta: { name: 'Future', date: { year: 1, day: 1, minute: 1 }, money: 1, rating: 1, guests: 1, mapSize: 64, savedAt: 1 }, modules: {} }));
    await backend.put('future', bytes, { meta: { name: 'Future', date: { year: 1, day: 1, minute: 1 }, money: 1, rating: 1, guests: 1, mapSize: 64, savedAt: 1 }, auto: false, seed: 1 });
    expect(await h.mgr.load('future')).toBe(false);
    expect(h.toasts.some(([t]) => /newer version/i.test(t))).toBe(true);
    expect(await backend.get('future')).toEqual(bytes);
  }, 60_000);

  it('export → import round trip through the .slope file format (gzip) creates a new slot; invalid files are rejected', async () => {
    const { sim, f } = fresh(); run(sim, { days: 0.5 });
    const h = harness(new IdbStore(f), sim);
    const file = await h.mgr.exportSlot(null);
    expect(file).toBe('My-Resort.slope');
    const [, bytes] = h.downloads[0]!;
    expect(bytes[0]).toBe(0x1f); // gzip
    const other = harness(new IdbStore(new IDBFactory()), sim);
    const rec = await other.mgr.importFile(Object.assign(new Blob([bytes as unknown as BlobPart]), { name: file }));
    expect(rec.id.startsWith('import-')).toBe(true);
    const env = await other.mgr.read(rec.id);
    expect(env.seed).toBe(11);
    expect(createSim({ size: 64, seed: 11, now: () => 0, fromSave: env.modules }).game.money).toBe(sim.game.money);
    // exporting a stored slot too
    const saved = await other.mgr.save(undefined, 'Stored');
    await other.mgr.exportSlot(saved.id);
    expect(other.downloads[0]![0]).toBe('Stored.slope');
    // garbage / truncated / oversized
    await expect(other.mgr.importBytes(new TextEncoder().encode('hello'))).rejects.toMatchObject({ code: 'corrupt' });
    await expect(other.mgr.importBytes(bytes.slice(0, 200))).rejects.toThrow();
    await expect(other.mgr.importBytes(new Uint8Array(65 * 1024 * 1024))).rejects.toMatchObject({ code: 'tooLarge' });
    expect((await other.mgr.list()).length).toBe(2); // only the two good ones
  }, 60_000);

  it('storage failures: quota exceeded toasts a clear error and rethrows; LocalFallback works for small saves', async () => {
    const { sim } = fresh();
    const quota: SaveBackend = { kind: 'idb', list: async () => [], get: async () => null, put: async () => { throw new StorageError('quota', 'Not enough storage space to save. Delete old saves or export them, then try again.'); }, delete: async () => {}, rename: async () => {} };
    const h = harness(quota, sim);
    await expect(h.mgr.save()).rejects.toBeInstanceOf(StorageError);
    expect(h.toasts.at(-1)![1]).toBe('error'); expect(h.toasts.at(-1)![0]).toMatch(/storage space/);
    expect(await h.mgr.autosave('month')).toBeNull(); // autosave never throws
    expect(h.toasts.at(-1)![1]).toBe('warn');

    const store = new Map<string, string>();
    const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };
    const hl = harness(new LocalFallback(ls), sim);
    expect(hl.mgr.backendKind).toBe('local');
    const r = await hl.mgr.quickSave();
    expect(r.bytes).toBeLessThan(1_500_000);
    expect(await hl.mgr.quickLoad()).toBe(true);
    expect(hl.toasts.some(([t]) => /fallback/.test(t))).toBe(true); // warns that this is the small fallback storage
  }, 60_000);

  it('URL helpers', () => {
    expect(loadQuery('auto-1')).toBe('load=auto-1');
    const calls: string[] = [];
    stripBootParams({ search: '?size=64&load=auto-1&continue=1', pathname: '/' }, { replaceState: (_d, _t, u) => { calls.push(u); } });
    expect(calls).toEqual(['/?size=64']);
    stripBootParams({ search: '?size=64', pathname: '/' }, { replaceState: () => { throw new Error('no'); } });
  });
});
