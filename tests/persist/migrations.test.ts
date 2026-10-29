import { describe, expect, it } from 'vitest';
import { MIGRATIONS, migrate, MigrationError, SAVE_FORMAT_VERSION, type RawEnvelope } from '../../src/persist/migrations';
import { decodeSave, SAVE_MAGIC, SaveError } from '../../src/persist/Serializer';
import { crc32, encodeBytes, pack } from '../../src/persist/codec';

const env = (version: number, modules: RawEnvelope['modules'] = {}): RawEnvelope => ({
  magic: SAVE_MAGIC, version, createdAt: 1, seed: 1, mapSize: 64, modules,
  meta: { name: 'x', date: { year: 1, day: 0, minute: 0 }, money: 0, rating: 0, guests: 0, mapSize: 64, savedAt: 1 },
});

describe('migration ladder', () => {
  it('the shipped ladder reaches the current version (every step from 1..N-1 exists)', () => {
    for (let v = 1; v < SAVE_FORMAT_VERSION; v++) expect(MIGRATIONS[v], `migration ${v}->${v + 1}`).toBeTypeOf('function');
    expect(migrate(env(SAVE_FORMAT_VERSION)).applied).toEqual([]);
  });
  it('runs v1 → v2 → v3 in order with example hooks (rename a module, add a default)', () => {
    const ladder = {
      1: (e: RawEnvelope): RawEnvelope => { e.modules['economy2'] = e.modules['economy']!; delete e.modules['economy']; return e; },
      2: (e: RawEnvelope): RawEnvelope => { e.modules['flags'] = { v: 1, data: { sandbox: false } }; return e; },
    };
    const r = migrate(env(1, { economy: { v: 1, data: { money: 5 } } }), 3, ladder);
    expect(r.applied).toEqual([1, 2]);
    expect(r.env.version).toBe(3);
    expect(Object.keys(r.env.modules).sort()).toEqual(['economy2', 'flags']);
  });
  it('v2 -> v3 (N-station lifts): old lifts stay 2-station lifts untouched (byte-identical), a malformed stations list is dropped, a good one is kept', () => {
    const lift = (id: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ id, kind: 'gondola6', bottom: { x: 1, y: 2, ground: 0 }, top: { x: 9, y: 2, ground: 4 }, nodes: [], tiles: [], ...extra });
    const st = (x: number): Record<string, unknown> => ({ x, y: 2, ground: 0, node: 0 });
    const items = [lift(1), lift(2, { stations: [st(1), st(9)] }), lift(3, { stations: [st(1), st(5), st(9)] }), lift(4, { stations: [st(1), st(5), st(7)] })];
    const before = JSON.stringify(items[0]);
    const r = migrate(env(2, { lifts: { v: 2, data: { items, nextId: 5 } } }));
    expect(r.applied).toEqual([2]);
    expect(r.env.version).toBe(3);
    const out = (r.env.modules as Record<string, { data: { items: Array<Record<string, unknown>> } }>).lifts!.data.items;
    expect(JSON.stringify(out[0])).toBe(before);
    expect('stations' in out[0]!).toBe(false);
    expect('stations' in out[1]!).toBe(false); // an explicit 2-entry list is the canonical absent form
    expect((out[2]!.stations as unknown[]).length).toBe(3);
    expect('stations' in out[3]!).toBe(false); // top does not match the terminal
  });
  it('a missing step is a MigrationError', () => {
    expect(() => migrate(env(1), 3, { 1: (e) => e })).toThrow(MigrationError);
  });
  it('unknown NEWER version is refused with a message; garbage is refused; corrupt chunk fails its checksum', async () => {
    const mk = async (obj: unknown): Promise<Uint8Array> => encodeBytes(JSON.stringify(obj));
    const good = { magic: SAVE_MAGIC, version: SAVE_FORMAT_VERSION, createdAt: 1, seed: 1, mapSize: 64, meta: env(1).meta, modules: {} as Record<string, unknown> };
    const d = JSON.stringify(pack({ a: [1, 2, 3] }));
    await expect(decodeSave(await mk({ ...good, version: SAVE_FORMAT_VERSION + 1 }))).rejects.toMatchObject({ code: 'newer' });
    await expect(decodeSave(await mk({ hello: 1 }))).rejects.toMatchObject({ code: 'invalid' });
    await expect(decodeSave(new TextEncoder().encode('not json at all'))).rejects.toBeInstanceOf(SaveError);
    await expect(decodeSave(await mk({ ...good, modules: { m: { v: 1, crc: crc32(d), d: JSON.parse(d) } } }))).resolves.toBeTruthy();
    await expect(decodeSave(await mk({ ...good, modules: { m: { v: 1, crc: crc32(d) + 1, d: JSON.parse(d) } } }))).rejects.toMatchObject({ code: 'corrupt' });
    await expect(decodeSave(await mk({ ...good, mapSize: 99 }))).rejects.toMatchObject({ code: 'invalid' });
  });
});
