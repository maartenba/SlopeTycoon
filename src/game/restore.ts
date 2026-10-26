/**
 * Boot-from-save glue (Task 33). DESIGN DECISION: loading a save RELOADS THE PAGE with `?load=<slot>` (or `?continue=1`) and the boot code
 * builds the sim with `createSim({ fromSave })` before any renderer object exists. This is deliberately not an in-place teardown/rebuild of
 * the renderer: main.ts wires hundreds of module-level views/tools/closures to one sim, so in-place re-initialisation would leak GPU
 * resources or leave stale references; a reload guarantees a clean slate (and `?continue=1` is exactly what the Task 35 main menu needs).
 * The saved envelope is validated (CRC, version) BEFORE reloading so a bad slot never costs the player the running game.
 */
import type { RawEnvelope } from '../persist/migrations';
import { IdbStore, type SaveBackend } from '../persist/IdbStore';
import { LocalFallback } from '../persist/LocalFallback';
import { decodeSave } from '../persist/Serializer';
import { describeError } from '../persist/SaveManager';

/** IndexedDB when present, else the LocalStorage fallback, else null (saving disabled). */
export function openBackend(win: { indexedDB?: IDBFactory; localStorage?: Storage } = globalThis as never): SaveBackend | null {
  try { if (IdbStore.available(win.indexedDB)) return new IdbStore(win.indexedDB); } catch { /* fall through */ }
  if (LocalFallback.available(win.localStorage)) return new LocalFallback(win.localStorage);
  return null;
}

export interface BootSave { env: RawEnvelope; id: string }
export interface BootResolution { save: BootSave | null; warnings: string[] }

/**
 * Decide at page start whether to load a save: `?load=<slot id>` loads that slot; `?continue=1` loads the newest loadable save, skipping
 * corrupt ones (recovery) with a warning each. Never throws: problems become warnings and the game starts fresh.
 */
export async function resolveBootSave(backend: SaveBackend | null, params: URLSearchParams): Promise<BootResolution> {
  const warnings: string[] = [];
  const loadId = params.get('load'), cont = params.get('continue');
  if (!backend || (!loadId && !cont)) return { save: null, warnings };
  try {
    const metas = await backend.list();
    const order = loadId ? [loadId] : metas.map((m) => m.id);
    for (const id of order) {
      const name = metas.find((m) => m.id === id)?.meta.name ?? id;
      try {
        const bytes = await backend.get(id);
        if (!bytes) { warnings.push(`Save “${name}” was not found.`); continue; }
        return { save: { env: (await decodeSave(bytes)).envelope, id }, warnings };
      } catch (e) {
        warnings.push(`Save “${name}” could not be loaded: ${describeError(e)}${cont ? ' Trying an older save…' : ''}`);
      }
    }
  } catch (e) { warnings.push(`Could not read saves: ${describeError(e)}`); }
  return { save: null, warnings };
}

/** Query string that makes the next page load boot from slot `id`. */
export const loadQuery = (id: string): string => new URLSearchParams({ load: id }).toString();

/** Drop `load` / `continue` from the address bar so a manual refresh does not silently reload an old save. */
export function stripBootParams(loc: { search: string; pathname: string }, history: { replaceState(d: unknown, t: string, u: string): void } | undefined): void {
  const q = new URLSearchParams(loc.search);
  if (!q.has('load') && !q.has('continue')) return;
  q.delete('load'); q.delete('continue');
  const s = q.toString();
  history?.replaceState(null, '', loc.pathname + (s ? `?${s}` : ''));
}
