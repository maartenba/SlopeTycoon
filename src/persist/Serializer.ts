/**
 * Versioned save envelope (Task 33):
 *   { magic, version, createdAt, seed, mapSize, meta, modules: { key: { v, crc, d } } }
 * `d` is the module's packed JSON (typed arrays as base64 blocks, see codec.ts); `crc` is CRC32 of that JSON text. The whole text is
 * gzip-compressed when the platform can (`.slope` files and IndexedDB blobs are identical bytes).
 */
import { collectModule, SAVE_MODULES, type SaveModules } from '../game/saveState';
import type { Sim } from '../game/createSim';
import { crc32, decodeBytes, encodeBytes, pack, unpack, yieldNow } from './codec';
import { migrate, MigrationError, SAVE_FORMAT_VERSION, type RawEnvelope, type SaveMeta } from './migrations';

export const SAVE_MAGIC = 'SLOPETYCOON-SAVE';
/** Refuse absurd files (import sanity limit). */
export const MAX_SAVE_BYTES = 64 * 1024 * 1024;

export type SaveErrorCode = 'invalid' | 'corrupt' | 'newer' | 'tooLarge' | 'migration';
export class SaveError extends Error {
  constructor(readonly code: SaveErrorCode, message: string) { super(message); this.name = 'SaveError'; }
}

export interface EncodeStats { bytes: number; rawChars: number; ms: number; compressed: boolean; perModuleChars: Record<string, number> }
export interface EncodeOptions { compress?: boolean; yieldBetween?: boolean }

export function makeMeta(sim: Sim, name: string, extra: Partial<SaveMeta> = {}): SaveMeta {
  return {
    name, date: { year: sim.game.date.year, day: sim.game.date.day, minute: sim.game.date.minute }, money: Math.round(sim.game.money),
    rating: sim.rating.stars, guests: sim.guestSim.store.count, mapSize: sim.size, savedAt: Date.now(),
    config: { size: sim.config.size, seed: sim.config.seed, preset: sim.config.preset, difficulty: sim.config.difficulty, startSeason: sim.config.startSeason }, ...extra,
  };
}

/** Serialise the whole sim. Yields to the event loop between modules so a 256-map save never blocks the UI for long. */
export async function encodeSave(sim: Sim, meta: SaveMeta, opt: EncodeOptions = {}): Promise<{ bytes: Uint8Array; stats: EncodeStats }> {
  const t0 = performance.now();
  const per: Record<string, number> = {};
  const parts: string[] = [];
  for (const m of SAVE_MODULES) {
    const d = JSON.stringify(pack(collectModule(sim, m).data));
    per[m.key] = d.length;
    parts.push(`${JSON.stringify(m.key)}:{"v":${m.version},"crc":${crc32(d)},"d":${d}}`);
    if (opt.yieldBetween !== false) await yieldNow();
  }
  const head = JSON.stringify({ magic: SAVE_MAGIC, version: SAVE_FORMAT_VERSION, createdAt: Date.now(), seed: sim.seed, mapSize: sim.size, meta });
  const text = `${head.slice(0, -1)},"modules":{${parts.join(',')}}}`;
  const bytes = await encodeBytes(text, opt.compress !== false);
  return { bytes, stats: { bytes: bytes.length, rawChars: text.length, ms: performance.now() - t0, compressed: bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b, perModuleChars: per } };
}

export interface DecodedSave { envelope: RawEnvelope; migrated: number[] }

/** Cheap header-only read for listings / import validation (still decompresses + parses the whole text once). */
export async function decodeSave(bytes: Uint8Array, opt: { yieldBetween?: boolean } = {}): Promise<DecodedSave> {
  if (bytes.length > MAX_SAVE_BYTES) throw new SaveError('tooLarge', `Save file is too large (${(bytes.length / 1048576).toFixed(1)} MB).`);
  let text: string;
  try { text = await decodeBytes(bytes); } catch (e) { throw new SaveError('corrupt', `Could not decompress the save: ${(e as Error).message}`); }
  let raw: { magic?: string; version?: number; createdAt?: number; seed?: number; mapSize?: number; meta?: SaveMeta; modules?: Record<string, { v: number; crc: number; d: unknown }> };
  try { raw = JSON.parse(text); } catch { throw new SaveError('corrupt', 'The save file is damaged (not valid data).'); }
  if (!raw || raw.magic !== SAVE_MAGIC) throw new SaveError('invalid', 'This is not a Slope Tycoon save file.');
  if (typeof raw.version !== 'number') throw new SaveError('invalid', 'Save has no version.');
  if (raw.version > SAVE_FORMAT_VERSION) throw new SaveError('newer', `This save was made by a newer version of the game (format ${raw.version}, this build reads up to ${SAVE_FORMAT_VERSION}). Update the game to open it.`);
  if (![64, 128, 256].includes(raw.mapSize as number) || typeof raw.seed !== 'number' || !raw.modules || !raw.meta) throw new SaveError('invalid', 'Save header is incomplete.');
  const modules: SaveModules = {};
  for (const [key, m] of Object.entries(raw.modules)) {
    if (!m || typeof m.crc !== 'number') throw new SaveError('corrupt', `Save module '${key}' is malformed.`);
    if (crc32(JSON.stringify(m.d)) !== m.crc) throw new SaveError('corrupt', `Save module '${key}' failed its checksum (the file is damaged).`);
    try { modules[key] = { v: m.v, data: unpack(m.d) }; } catch (e) { throw new SaveError('corrupt', `Save module '${key}' could not be decoded: ${(e as Error).message}`); }
    if (opt.yieldBetween !== false) await yieldNow();
  }
  const env: RawEnvelope = { magic: raw.magic, version: raw.version, createdAt: raw.createdAt ?? 0, seed: raw.seed, mapSize: raw.mapSize as 64 | 128 | 256, meta: raw.meta, modules };
  try {
    const r = migrate(env);
    return { envelope: r.env, migrated: r.applied };
  } catch (e) {
    if (e instanceof MigrationError) throw new SaveError('migration', e.message);
    throw e;
  }
}
