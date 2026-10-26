/**
 * Human names for places (M3 playtest: 'Avalanche near (12, 40)' read oddly).
 * Pure (no three/DOM): everything is looked up through injected sources, so it is unit-testable and the UI/sim wire it in createSim.
 *  - pistes: auto-named per difficulty ('Green Run 1', 'Blue Run 3'); the name sticks to the piste when it grows (tile-sample matching)
 *  - lifts / buildings: '<kind name> <n>' ('Chairlift 1', 'Mountain Hut 2'), numbered per kind in order of first mention
 *  - everything can be renamed (inspector text input)
 *  - describeLocation(tile): nearest named piste / lift / building within R tiles, else a compass area + altitude zone.
 */

export interface PisteInfo { tiles: readonly number[]; difficulty: number }
export const MAX_NAME_LENGTH = 24;
export interface LiftInfo { id: number; kindName: string; tiles: readonly number[] }
export interface BuildingInfo { id: number; typeName: string; x: number; y: number; w: number; h: number }

export interface NameSources {
  size: number;
  /** Piste component containing the tile, or null. */
  pisteAt(x: number, y: number): PisteInfo | null;
  /** All piste components (same objects `pisteAt` returns) + a version that changes when they do. Enables merge/split identity handling. */
  pistes?(): readonly PisteInfo[];
  pisteVersion?(): number;
  lifts(): readonly LiftInfo[];
  buildings(): readonly BuildingInfo[];
  /** 0 = valley floor .. 1 = highest summit. */
  altFrac(x: number, y: number): number;
}

export type PlaceKind = 'piste' | 'lift' | 'building' | 'area';
export interface Place {
  kind: PlaceKind;
  /** Bare name: 'Blue Run 3', 'Chairlift 1', 'Mountain Hut 2', 'the northern upper bowl'. */
  name: string;
  /** 'on Blue Run 3' / 'at Chairlift 1' / 'in the northern upper bowl'. */
  on: string;
  /** 'near Blue Run 3' / 'near the northern upper bowl'. */
  near: string;
  id?: number;
}

export const NAME_RADIUS = 4;
const DIFF_NAMES = ['', 'Green', 'Blue', 'Red', 'Black'] as const;
const COMPASS = ['northern', 'north-eastern', 'eastern', 'south-eastern', 'southern', 'south-western', 'western', 'north-western'] as const;

/** Altitude zone phrase for a 0..1 relief fraction. */
export function altitudeZone(frac: number): string {
  if (frac < 0.18) return 'valley floor';
  if (frac < 0.42) return 'lower slopes';
  if (frac < 0.68) return 'mid-mountain';
  if (frac < 0.88) return 'upper bowl';
  return 'summit ridge';
}

/** Compass sector of a tile relative to the map centre ('' when near the centre). North = -y. */
export function compassOf(x: number, y: number, size: number): string {
  const dx = x + 0.5 - size / 2, dy = y + 0.5 - size / 2;
  if (Math.hypot(dx, dy) < size * 0.14) return '';
  const ang = Math.atan2(dx, -dy); // 0 = north, clockwise
  return COMPASS[((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8]!;
}

interface PisteEntry { id: number; name: string; diff: number; size: number; sample: Set<number> }
export interface NamesData {
  custom: Array<[string, string]>; lifts: Array<[number, number]>; buildings: Array<[number, number]>;
  kindCount?: Array<[string, number]>;
  pistes?: Array<{ id: number; name: string; diff: number; size: number; sample: number[] }>;
  pisteNext?: number; pisteCount?: number[];
}

/** Trim + clamp a user-entered name ('' = reset to the automatic name). */
export const cleanName = (n: string): string => n.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);

export class Names {
  private custom = new Map<string, string>();
  private liftNo = new Map<number, number>();
  private buildingNo = new Map<number, number>();
  private kindCount = new Map<string, number>();
  /** Persistent piste identities (id never reused); names stay attached to the id across paint/erase/merge/split. */
  private pistes: PisteEntry[] = [];
  private assigned = new WeakMap<PisteInfo, PisteEntry>();
  private pisteNext = 1;
  private pisteSyncV = -1;
  private pisteCount = [0, 0, 0, 0, 0];

  constructor(private src: NameSources) {}

  // ---------- names ----------

  liftName(id: number): string {
    const c = this.custom.get(`lift:${id}`);
    if (c) return c;
    const l = this.src.lifts().find((x) => x.id === id);
    if (!l) return `Lift ${id}`;
    return `${l.kindName} ${this.ordinal(this.liftNo, id, `lift:${l.kindName}`)}`;
  }

  buildingName(id: number): string {
    const c = this.custom.get(`building:${id}`);
    if (c) return c;
    const b = this.src.buildings().find((x) => x.id === id);
    if (!b) return `Building ${id}`;
    return `${b.typeName} ${this.ordinal(this.buildingNo, id, `building:${b.typeName}`)}`;
  }

  /**
   * Reconcile identities with the current piste components (runs when `src.pisteVersion` changes).
   * Greedy by sample overlap (ties: larger previous piste): merge keeps the identity of the biggest former piste, split keeps it for
   * the largest part (the rest get fresh auto-names), identities nothing overlaps any more are retired.
   */
  private syncPistes(): void {
    const comps = this.src.pistes?.();
    if (!comps) return;
    const v = this.src.pisteVersion?.() ?? -2;
    if (v === this.pisteSyncV && v !== -2) return;
    this.pisteSyncV = v;
    const pairs: Array<{ c: PisteInfo; e: PisteEntry; o: number }> = [];
    for (const c of comps) {
      const set = new Set(c.tiles);
      for (const e of this.pistes) {
        let o = 0;
        for (const t of e.sample) if (set.has(t)) o++;
        if (o > 0) pairs.push({ c, e, o });
      }
    }
    pairs.sort((a, b) => b.o - a.o || b.e.size - a.e.size || b.c.tiles.length - a.c.tiles.length || a.e.id - b.e.id);
    const usedC = new Set<PisteInfo>(), usedE = new Set<PisteEntry>();
    this.assigned = new WeakMap();
    for (const p of pairs) {
      if (usedC.has(p.c) || usedE.has(p.e)) continue;
      usedC.add(p.c); usedE.add(p.e); this.assigned.set(p.c, p.e);
    }
    const kept: PisteEntry[] = [];
    for (const e of this.pistes) if (usedE.has(e)) kept.push(e); else this.custom.delete(`piste:${e.id}`);
    this.pistes = kept;
    for (const c of comps) {
      const e = this.assigned.get(c) ?? this.newEntry(c);
      this.assigned.set(c, e);
      this.touch(e, c);
    }
  }

  private newEntry(p: PisteInfo): PisteEntry {
    const diff = Math.max(1, Math.min(4, p.difficulty || 1));
    const e: PisteEntry = { id: this.pisteNext++, name: `${DIFF_NAMES[diff]} Run ${++this.pisteCount[diff]!}`, diff, size: 0, sample: new Set() };
    this.pistes.push(e);
    return e;
  }

  private touch(e: PisteEntry, p: PisteInfo): void {
    e.size = p.tiles.length;
    e.sample = new Set(p.tiles.filter((_, i) => i % Math.max(1, Math.floor(p.tiles.length / 24)) === 0));
  }

  private entryOf(p: PisteInfo): PisteEntry {
    this.syncPistes();
    const known = this.assigned.get(p);
    if (known) return known;
    let best: PisteEntry | null = null, bo = 0;
    for (const x of this.pistes) {
      let o = 0;
      for (const t of p.tiles) if (x.sample.has(t)) o++;
      if (o > bo) { bo = o; best = x; }
    }
    const e = best ?? this.newEntry(p);
    this.touch(e, p);
    this.assigned.set(p, e);
    return e;
  }

  /** Persistent piste id (stable across painting/erasing; see syncPistes for merge/split rules). */
  pisteId(p: PisteInfo): number { return this.entryOf(p).id; }

  pisteName(p: PisteInfo): string {
    const e = this.entryOf(p);
    return this.custom.get(`piste:${e.id}`) ?? e.name;
  }

  /** Auto name ('Blue Run 3') ignoring any custom name. */
  pisteAutoName(p: PisteInfo): string { return this.entryOf(p).name; }

  renamePiste(p: PisteInfo, name: string): void {
    const k = `piste:${this.entryOf(p).id}`, n = cleanName(name);
    if (n) this.custom.set(k, n); else this.custom.delete(k);
  }

  /** Rename (empty string resets). */
  rename(kind: 'lift' | 'building', id: number, name: string): void {
    const k = `${kind}:${id}`;
    const n = cleanName(name);
    if (n) this.custom.set(k, n); else this.custom.delete(k);
  }

  private ordinal(map: Map<number, number>, id: number, counter: string): number {
    let n = map.get(id);
    if (n === undefined) { n = (this.kindCount.get(counter) ?? 0) + 1; this.kindCount.set(counter, n); map.set(id, n); }
    return n;
  }

  // ---------- locations ----------

  describeLocation(x: number, y: number, radius = NAME_RADIUS): Place {
    x = Math.floor(x); y = Math.floor(y);
    const N = this.src.size;
    let best: { d: number; rank: number; place: () => Place } | null = null;
    const offer = (d: number, rank: number, place: () => Place): void => {
      if (!best || d < best.d || (d === best.d && rank < best.rank)) best = { d, rank, place };
    };
    // pistes: nearest piste tile inside the window
    let pd = Infinity, pp: PisteInfo | null = null;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const tx = x + dx, ty = y + dy;
      if (tx < 0 || ty < 0 || tx >= N || ty >= N) continue;
      const d = Math.hypot(dx, dy);
      if (d >= pd || d > radius) continue;
      const p = this.src.pisteAt(tx, ty);
      if (p) { pd = d; pp = p; }
    }
    if (pp) { const p = pp; offer(pd, 0, () => { const name = this.pisteName(p); return { kind: 'piste', name, on: `on ${name}`, near: `near ${name}` }; }); }
    for (const l of this.src.lifts()) {
      let d = Infinity;
      for (const t of l.tiles) d = Math.min(d, Math.hypot((t % N) - x, ((t / N) | 0) - y));
      if (d <= radius) offer(d, 1, () => { const name = this.liftName(l.id); return { kind: 'lift', name, on: `at ${name}`, near: `near ${name}`, id: l.id }; });
    }
    for (const b of this.src.buildings()) {
      const dx = Math.max(b.x - x, 0, x - (b.x + b.w - 1)), dy = Math.max(b.y - y, 0, y - (b.y + b.h - 1));
      const d = Math.hypot(dx, dy);
      if (d <= radius) offer(d, 2, () => { const name = this.buildingName(b.id); return { kind: 'building', name, on: `at ${name}`, near: `near ${name}`, id: b.id }; });
    }
    if (best) return (best as { place: () => Place }).place();
    const dir = compassOf(x, y, N), zone = altitudeZone(this.src.altFrac(x, y));
    const name = `the ${dir ? `${dir} ` : ''}${zone}`;
    return { kind: 'area', name, on: `in ${name}`, near: `near ${name}` };
  }

  serialize(): NamesData {
    return {
      custom: [...this.custom], lifts: [...this.liftNo], buildings: [...this.buildingNo], kindCount: [...this.kindCount],
      pistes: this.pistes.map((e) => ({ id: e.id, name: e.name, diff: e.diff, size: e.size, sample: [...e.sample] })),
      pisteNext: this.pisteNext, pisteCount: [...this.pisteCount],
    };
  }

  load(d: NamesData): void {
    this.custom = new Map(d.custom); this.liftNo = new Map(d.lifts); this.buildingNo = new Map(d.buildings);
    this.kindCount = new Map(d.kindCount ?? []);
    this.pistes = (d.pistes ?? []).map((e) => ({ id: e.id, name: e.name, diff: e.diff, size: e.size, sample: new Set(e.sample) }));
    this.pisteNext = d.pisteNext ?? Math.max(0, ...this.pistes.map((e) => e.id)) + 1;
    this.pisteCount = d.pisteCount ? [...d.pisteCount] : [0, 0, 0, 0, 0];
    this.assigned = new WeakMap(); this.pisteSyncV = -1;
  }
}

/** Pure helper for call sites without a Names instance (tests / fallbacks). */
export function describeLocation(names: Names, x: number, y: number): Place { return names.describeLocation(x, y); }

// ---------------------------------------------------------------- regions and peaks (Task 27; flavour only)
// Pure functions of the seed: they own a private hash stream and never touch the sim RNG, so names cannot change stateHash.

const REGION_PREFIX = ['Silver', 'Ember', 'Frost', 'Larch', 'Marmot', 'Edelweiss', 'Granite', 'Cedar', 'Raven', 'Hollow', 'Amber', 'Juniper', 'Cloud', 'Wolf', 'Pine', 'Glacier', 'Chamois', 'Misty', 'Golden', 'Quiet'] as const;
const REGION_SUFFIX = ['Valley', 'Basin', 'Hollow', 'Range', 'Highlands', 'Massif', 'Dale', 'Reach', 'Heights', 'Fells', 'Glen', 'Alps'] as const;
const PEAK_FIRST = ['Mount', 'Piz', 'Mont', 'Monte', 'Mount', 'Mount'] as const;
const PEAK_NAME = ['Aldric', 'Bernina', 'Corvo', 'Dornach', 'Eiger-Ost', 'Falkner', 'Gamsberg', 'Hohenwart', 'Ibex', 'Jochberg', 'Kessel', 'Lindor', 'Murmel', 'Nebelhorn', 'Ortler', 'Pilatus-Nord', 'Quarz', 'Rotspitz', 'Sulden', 'Tannenkopf', 'Ulmer', 'Vallon', 'Weissfluh', 'Zinal', 'Brandt', 'Elmar', 'Hirsch', 'Sonnblick', 'Wetter', 'Stillhorn'] as const;
const PEAK_QUIRK = ['the Patient', 'the Grumpy', 'the Reliable'] as const;

/** Mulberry32 over a salted seed: private to names. */
function nameStream(seed: number, salt: number): () => number {
  let a = (Math.imul(seed | 0, 0x9e3779b1) ^ salt) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Region name from the seed ('Silver Basin'). Deterministic; same seed, same name. */
export function regionNameOf(seed: number): string {
  const r = nameStream(seed, 0x52454749);
  const p = REGION_PREFIX[Math.floor(r() * REGION_PREFIX.length)]!;
  const s = REGION_SUFFIX[Math.floor(r() * REGION_SUFFIX.length)]!;
  return `${p} ${s}`;
}

/**
 * Names for the map's peaks, highest first (`peaks` = a count or the peak list; capped at 6). Distinct within a seed;
 * the highest peak occasionally gets a mild epithet (humour sparingly: about 1 in 8 seeds).
 */
export function peakNamesOf(seed: number, peaks: number | readonly unknown[]): string[] {
  const n = Math.max(0, Math.min(6, Math.floor(typeof peaks === 'number' ? peaks : peaks.length)));
  const r = nameStream(seed, 0x5045414b);
  const pool = [...PEAK_NAME];
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const base = pool.splice(Math.floor(r() * pool.length), 1)[0]!;
    const first = PEAK_FIRST[Math.floor(r() * PEAK_FIRST.length)]!;
    out.push(`${first} ${base}`);
  }
  const q = r();
  if (out.length > 0 && q < 0.125) out[0] = `${out[0]} ${PEAK_QUIRK[Math.floor(r() * PEAK_QUIRK.length)]!}`;
  return out;
}
