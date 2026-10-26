import { Rng } from '../../core/Rng';
import type { Animal, Wildlife } from './Wildlife';

/** Debug helpers for the F3 panel (`Find bear` / `Spawn bear`). Pure over a Wildlife instance; no DOM / renderer. */
export interface BearFocus {
  /** 'bear' = a live bear, 'den' = hibernation den tile. */
  kind: 'bear' | 'den';
  x: number; y: number;
  id: number;
  /** User-facing line. */
  message: string;
}

/** Wildlife is first computed at the first day change: make sure a fresh game has its territories / bears before debug actions. */
const ensureReady = (w: Wildlife): void => { if (w.remoteCount === 0 && w.animals.length === 0) w.refresh(); };

/** Bears in a stable order (by id) so repeated clicks cycle deterministically. */
export const bearsInOrder = (w: Wildlife): Animal[] => w.animals.filter((a) => a.kind === 'bear').sort((p, q) => p.id - q.id);

/**
 * 'Find bear': cycles through every bear (cursor = last shown index, -1 to start). In hibernation (winter) shows the dens instead (same
 * order). Returns null when the map has no bears at all.
 */
export function findBear(w: Wildlife, cursor: number): { focus: BearFocus; cursor: number } | null {
  ensureReady(w);
  const bears = bearsInOrder(w);
  if (!bears.length) return null;
  const idx = (cursor + 1) % bears.length;
  const b = bears[idx]!;
  if (w.hibernating || b.asleep) {
    return { cursor: idx, focus: { kind: 'den', id: b.id, x: b.denX, y: b.denY, message: `Bears are hibernating (in dens): showing den ${idx + 1}/${bears.length}` } };
  }
  return { cursor: idx, focus: { kind: 'bear', id: b.id, x: b.x, y: b.y, message: `Bear ${idx + 1}/${bears.length} (${b.mode})` } };
}

export type SpawnResult =
  | { ok: true; bear: Animal; message: string }
  | { ok: false; reason: 'hibernating' | 'exists' | 'noTerritory'; message: string };

/**
 * 'Spawn bear'. Rules: never during hibernation; without `near` only when no awake bear exists (otherwise use Find to cycle);
 * needs remote forest ('no valid territory' otherwise). Uses its own RNG stream (seed + counter) so the sim's RNG is untouched.
 */
export function spawnBear(w: Wildlife, seed: number, counter: number, near?: { x: number; y: number }): SpawnResult {
  ensureReady(w);
  if (w.hibernating) return { ok: false, reason: 'hibernating', message: 'Bears are hibernating: not spawning (only dens are available)' };
  const awake = bearsInOrder(w).filter((b) => !b.asleep);
  if (!near && awake.length) return { ok: false, reason: 'exists', message: `${awake.length} bear(s) already roaming: use Find bear to cycle` };
  const rng = new Rng(((seed ^ 0x9e3779b9) + Math.imul(counter + 1, 0x85ebca6b)) >>> 0);
  const bear = w.debugSpawn('bear', rng, near);
  if (!bear) return { ok: false, reason: 'noTerritory', message: 'No valid remote forest territory on this map: cannot spawn a bear' };
  return { ok: true, bear, message: near ? 'Bear spawned in the forest nearest to the camera' : 'Bear spawned in remote forest' };
}
