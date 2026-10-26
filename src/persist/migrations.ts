/**
 * Save-format migration ladder (Task 33). `MIGRATIONS[n]` upgrades an envelope from format version n to n + 1 (pure; may rename /
 * reshape module data, add defaults). `migrate` runs the ladder from the save's version up to the target.
 *
 * Adding a format change: bump SAVE_FORMAT_VERSION, add `MIGRATIONS[oldVersion] = (env) => {...; return env}` and a test in
 * tests/persist/migrations.test.ts. Per-module versions (SaveModule.version) cover module-local changes; a module the save lacks is
 * reset to defaults by `applySave` (with a warning).
 */
import type { SaveModules } from '../game/saveState';

/** Current save-format version. */
export const SAVE_FORMAT_VERSION = 2;

export interface RawEnvelope {
  magic: string;
  version: number;
  createdAt: number;
  seed: number;
  mapSize: 64 | 128 | 256;
  meta: SaveMeta;
  modules: SaveModules;
}

export interface SaveMeta {
  name: string;
  /** In-game date. */
  date: { year: number; day: number; minute: number };
  money: number;
  rating: number;
  guests: number;
  mapSize: 64 | 128 | 256;
  /** Wall-clock ms since epoch. */
  savedAt: number;
  /** Optional small JPEG/PNG data URL. */
  screenshot?: string;
  /** Camera for restore (x, y, yaw, zoom) — set by the UI layer, opaque to the sim. */
  camera?: { x: number; y: number; yaw: number; zoom: number };
  /** New-game options (size, seed, preset, difficulty ...) for the Load dialog; the authoritative copy is the 'config' module. */
  config?: { size: number; seed: number; preset: string; difficulty: string; startSeason: string };
}

export type Migration = (env: RawEnvelope) => RawEnvelope;

// ---------------------------------------------------------------- v1 -> v2: 15-day months (180-day year), docs/time-flow.md
/** Old (30-day months, 360-day year) day of year 0..359 -> new 0..179: month index kept, day within the month halved. */
export const mapDayOfYear = (d: number): number => (d < 0 ? d : Math.floor(d / 30) * 15 + Math.floor((d % 30) / 2));
/** Old absolute day (year * 360 + day) -> new absolute day (year * 180 + day). Negative sentinels (-1, -1e9) are kept. */
export const mapAbsDay = (a: number): number => (a < 0 || !Number.isFinite(a) ? a : Math.floor(a / 360) * 180 + mapDayOfYear(a % 360));
/** Old key year * 1000 + day (Weather / snow day keys). */
export const mapDayKey = (k: number): number => (k < 0 ? k : Math.floor(k / 1000) * 1000 + mapDayOfYear(k % 1000));
/** Old tick-per-month based month index -> new (the same real month now ends after 15 days: index doubles, sentinel-safe). */
const mapAbsStamp = (st: number): number => (st < 0 ? st : mapAbsDay(Math.floor(st / 24)) * 24 + (st % 24));

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const mapArr = <T extends ArrayLike<number>>(a: T | undefined, f: (n: number) => number): T | undefined => {
  if (!a) return a;
  if (ArrayBuffer.isView(a)) { const c = (a as unknown as { slice(): T }).slice(); for (let i = 0; i < a.length; i++) (c as unknown as number[])[i] = f(a[i]!); return c; }
  return Array.from(a, f) as unknown as T;
};
const setIf = (o: Obj | undefined | null, k: string, f: (n: number) => number): void => { if (o && typeof o[k] === 'number') o[k] = f(o[k]); };
const mapPairs = (a: unknown, f: (n: number) => number): unknown => (Array.isArray(a) ? a.map((e) => (Array.isArray(e) && typeof e[1] === 'number' ? [e[0], f(e[1]), ...e.slice(2)] : e)) : a);

/**
 * Calendar compression 30 -> 15 days per month. Remaps the date and every stored ABSOLUTE day stamp (guests' leave day, pass days, finance
 * day counters, marketing log, weather keys, ops stamps, prop growth `born`, lift inspections, advisor snoozes, ...). Month-indexed data
 * (ledger history by month, loan month counters, season) is unchanged; per-day COUNTERS (debt days, lift age) are durations and stay.
 * Weather / snow / season state is recomputed from the date on the next tick (the snow depth itself is kept as saved).
 */
function v1to2(env: RawEnvelope): RawEnvelope {
  const M = env.modules as Record<string, { v: number; data: unknown } | undefined>;
  const d = (k: string): Obj | undefined => (M[k]?.data ?? undefined) as Obj | undefined;
  const core = d('core');
  if (core?.date) { core.date.day = mapDayOfYear(core.date.day); }
  if (env.meta?.date) env.meta.date.day = mapDayOfYear(env.meta.date.day);
  const guests = d('sys.guests');
  if (guests?.cols) { guests.cols.leaveDay = mapArr(guests.cols.leaveDay, mapAbsDay); }
  if (guests && Array.isArray(guests.trek)) guests.trek = guests.trek.map((r: unknown[]) => (typeof r[3] === 'number' ? [r[0], r[1], r[2], mapAbsDay(r[3] as number), r[4]] : r));
  const fin = d('sys.economy');
  const mk = fin?.marketing as Obj | undefined;
  if (mk) {
    for (const a of mk.active ?? []) { setIf(a, 'start', mapAbsDay); setIf(a, 'end', mapAbsDay); }
    for (const t of mk.tails ?? []) { setIf(t, 'start', mapAbsDay); setIf(t, 'end', mapAbsDay); }
    for (const h of mk.history ?? []) setIf(h, 'start', mapAbsDay);
    for (const l of mk.log ?? []) setIf(l, 'day', mapAbsDay);
    mk.cooldown = mapPairs(mk.cooldown, mapAbsDay);
    setIf(mk, 'cur', mapAbsDay);
  }
  if (fin) {
    setIf(fin.liftOps, 'absDay', mapAbsDay);
    setIf(fin, 'lastDay', mapAbsDay); setIf(fin, 'firstDay', mapAbsDay);
    const t = fin.ticketing as Obj | undefined;
    if (t) { t.passDay = mapPairs(t.passDay, mapAbsDay); t.hikerDay = mapPairs(t.hikerDay, mapAbsDay); }
  }
  const rating = d('sys.rating');
  if (rating) { setIf(rating, 'lastDay', mapAbsDay); if (rating.r) setIf(rating.r, 'e', mapAbsDay); }
  const att = d('sys.attractions');
  if (att) setIf(att, 'last', mapAbsDay);
  const fam = d('families');
  for (const e of fam?.schools ?? []) { if (Array.isArray(e) && e[1]) setIf(e[1], 'day', mapAbsDay); }
  const ops = d('sys.ops');
  if (ops) {
    setIf(ops, 'lastDay', mapAbsDay); setIf(ops, 'lastStamp', mapAbsStamp);
    setIf(ops.groom, 'nightKey', mapAbsDay);
    const ava = ops.safety?.ava as Obj | undefined;
    if (ava) {
      for (const k of ['lastBlastDay', 'lastReleaseDay', 'lastNewsDay', 'curDay', 'countDay']) setIf(ava, k, (n) => (n <= -1e8 ? n : mapAbsDay(n)));
      if (Array.isArray(ava.cool)) ava.cool = ava.cool.map((v: number, i: number) => (i % 2 === 1 ? mapAbsDay(v) : v)); // flat [tile, untilDay, ...]
    }
    const wild = ops.safety?.wild as Obj | undefined;
    if (wild) { setIf(wild, 'lastDay', mapAbsDay); for (const st of wild.stations ?? []) if (Array.isArray(st) && st[1]) setIf(st[1], 'month', (m) => m * 2); }
  }
  const lifts = d('lifts');
  for (const l of lifts?.items ?? []) { if (l?.ops && typeof l.ops.lastInspection === 'number' && l.ops.lastInspection >= 0) l.ops.lastInspection = mapAbsDay(l.ops.lastInspection); }
  const weather = d('sys.weather');
  if (weather) { setIf(weather, 'lastDay', mapDayKey); if (weather.weather) setIf(weather.weather, 'lastDay', mapDayKey); }
  const nature = d('nature');
  if (nature) {
    setIf(nature, 'now', mapAbsDay);
    const g = nature.growth as Obj | undefined; if (g) setIf(g, 'last', mapAbsDay);
  }
  const props = d('props');
  if (props) { setIf(props, 'now', mapAbsDay); for (const c of props.chunks ?? []) if (c?.born) c.born = mapArr(c.born, (b) => (b >= 0 ? mapAbsDay(b) : b)); }
  const adv = d('advisor');
  if (adv) adv.snooze = mapPairs(adv.snooze, mapAbsDay);
  return env;
}
export const MIGRATIONS: Record<number, Migration> = { 1: v1to2 };

export class MigrationError extends Error {}

export function migrate(env: RawEnvelope, target = SAVE_FORMAT_VERSION, ladder: Record<number, Migration> = MIGRATIONS): { env: RawEnvelope; applied: number[] } {
  const applied: number[] = [];
  let cur = env;
  while (cur.version < target) {
    const step = ladder[cur.version];
    if (!step) throw new MigrationError(`No migration from save version ${cur.version} to ${cur.version + 1}.`);
    const from = cur.version;
    cur = step(cur);
    cur.version = from + 1;
    applied.push(from);
  }
  return { env: cur, applied };
}
