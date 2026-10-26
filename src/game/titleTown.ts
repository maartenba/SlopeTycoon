import type { MapSize } from '../core/GameState';
import { TOWN_SEEDS } from '../config/townSeeds';
import { TOWNS, townOf, type TownId } from './demoTowns';

/** localStorage key remembering the previous title town (`<id>:<seed>`), so a reload never shows the same one twice in a row. */
export const TITLE_LAST_KEY = 'slope.title.last';

export interface TitleTown { id: TownId; seed: number; size: MapSize; season: 'winter' | 'summer' }

export interface PickOptions {
  /** [0,1) random source. */
  rand: () => number;
  /** `<id>:<seed>` of the previous pick. */
  last?: string | null;
  /** navigator.deviceMemory in GB (undefined when the browser does not tell: treated as NOT capable of 256). */
  deviceMemory?: number;
  /** Forces the 256 map (QA) even without the memory hint. */
  forceBig?: boolean;
}

export const townKey = (t: { id: string; seed: number }): string => `${t.id}:${t.seed}`;

/** The 256 map needs a capable device (>= 8 GB reported) - others fall back to 128. 64-only (<= 2 GB) devices skip archetypes without a 64 variant. */
export function sizeFor(id: TownId, deviceMemory: number | undefined, forceBig: boolean, rand: () => number): MapSize | null {
  const t = townOf(id)!;
  const low = deviceMemory !== undefined && deviceMemory <= 2;
  const big = forceBig || (deviceMemory !== undefined && deviceMemory >= 8);
  const sizes = t.sizes.filter((s) => (s === 256 ? big : low ? s === 64 : true) && (TOWN_SEEDS[id][s]?.length ?? 0) > 0);
  if (!sizes.length) return null;
  if (sizes.includes(t.size) && !low) return t.size === 64 && sizes.includes(128) && rand() < 0.3 ? 128 : t.size;
  return sizes.includes(t.size) ? t.size : sizes[sizes.length - 1]!;
}

/** Weighted random pick of a vetted (archetype, seed, size, season). Never returns `last` when any alternative exists. Pure given `rand`. */
export function pickTitleTown(o: PickOptions): TitleTown {
  const pool: Array<{ t: TitleTown; w: number }> = [];
  for (const a of TOWNS) {
    const size = sizeFor(a.id, o.deviceMemory, !!o.forceBig, o.rand);
    if (!size) continue;
    const seeds = TOWN_SEEDS[a.id][size] ?? [];
    // earlier seeds in the list are the nicest ones: weight them a little higher
    seeds.forEach((seed, i) => {
      const t: TitleTown = { id: a.id, seed, size, season: a.season };
      if (townKey(t) === o.last) return;
      pool.push({ t, w: a.titleWeight / seeds.length * (1.3 - (i / Math.max(1, seeds.length)) * 0.6) });
    });
  }
  if (!pool.length) return { id: 'alpine', seed: 7, size: 128, season: 'winter' };
  let total = 0;
  for (const p of pool) total += p.w;
  let r = o.rand() * total;
  for (const p of pool) { r -= p.w; if (r <= 0) return p.t; }
  return pool[pool.length - 1]!.t;
}

/** `?town=<id>&townseed=<n>[&demosize=]` (QA / deep links). Returns null when `town` is absent or unknown. */
export function parseTownParams(params: URLSearchParams): { id: TownId; seed: number | null; size: MapSize | null } | null {
  const id = params.get('town');
  const t = id ? townOf(id) : undefined;
  if (!t) return null;
  const s = Number(params.get('townseed'));
  const z = Number(params.get('demosize'));
  return { id: t.id, seed: Number.isFinite(s) && s > 0 ? Math.floor(s) : null, size: z === 64 || z === 128 || z === 256 ? z : null };
}

/** Caption text for the title screen. */
export const townCaption = (t: { id: string; seed: number }): string => `${townOf(t.id)?.name ?? t.id} · seed ${t.seed}`;
