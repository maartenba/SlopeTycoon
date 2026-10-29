import { FLOW, RIVER_ICE } from '../../config/rivers';
import { monthIndex } from '../Clock';
import { waterways, type Waterway } from '../../world/Streams';
import type { Stream } from '../../world/Streams';
import type { RiverRec } from '../../world/Rivers';

/**
 * Flow model of every waterway (natural streams + dug rivers), Phase 6 Task 15, and the ice state of DUG rivers (Task 17). docs/rivers.md "Flow".
 *
 * Pure + lazy: nothing runs per tick. The table is recomputed only when the rivers change (`Rivers.version`) or the SIM MONTH or the ice state changes.
 * Nothing here is saved except the ice of dug rivers (in the `rivers` module, which is absent while no river exists), and nothing reads it back into the
 * simulation of a world without dug rivers, so `stateHash` of those worlds is unchanged. Natural streams keep their look: no ice state of their own.
 */
export type FlowClass = 'calm' | 'brisk' | 'rapids';
export const FLOW_CLASSES: readonly FlowClass[] = ['calm', 'brisk', 'rapids'];

export interface WayFlow {
  id: string;
  kind: 'natural' | 'dug';
  /** Discharge per tile BEFORE the season factor (base + merged tributaries upstream of the tile). */
  q: number[];
  /** Speed per tile (render scroll / foam), already season- and ice-scaled (0 when frozen). */
  speed: number[];
  /** Class index per tile (0 calm, 1 brisk, 2 rapids). */
  cls: number[];
  /** Season-scaled discharge at the mouth; 0 while frozen. */
  mouthQ: number;
  /** Highest class on the way (index). */
  maxClass: number;
  rapidsTiles: number;
  frozen: boolean;
}

export interface FlowInput { natural: ReadonlyArray<Stream>; rivers: ReadonlyArray<RiverRec> }

/** Season factor of a sim day (snowmelt, late-summer low). */
export function seasonFactor(day: number): number { return FLOW.monthFactor[monthIndex({ day }) % FLOW.monthFactor.length] ?? 1; }

const key = (x: number, y: number): number => (y << 16) | x;

/** Pure: the flow table for a set of waterways at a season factor. `frozen(id)` zeroes the flow of that way. */
export function computeFlow(natural: ReadonlyArray<Stream>, rivers: ReadonlyArray<RiverRec>, factor: number, frozen: (id: string) => boolean = () => false): Map<string, WayFlow> {
  const ways = waterways(natural, rivers);
  const byId = new Map<string, Waterway>(ways.map((w) => [w.id, w]));
  const recById = new Map<string, RiverRec>(rivers.map((r) => [`r${r.id}`, r]));
  const tileOf = new Map<number, { id: string; i: number }>();
  for (const w of ways) w.path.forEach((p, i) => tileOf.set(key(p.x, p.y), { id: w.id, i }));

  /** Tributaries: way id -> [{ at: tile index in the parent, child id }]. */
  const tribs = new Map<string, Array<{ at: number; child: string }>>();
  for (const w of ways) {
    if (w.end !== 'merge') continue;
    const last = w.path[w.path.length - 1]!;
    const rec = recById.get(w.id);
    let hit: { id: string; i: number } | undefined;
    if (rec && rec.sink.kind === 'stream') { const t = tileOf.get(key(rec.sink.x, rec.sink.y)); if (t && t.id !== w.id) hit = t; }
    if (!hit) for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) { const t = tileOf.get(key(last.x + dx, last.y + dy)); if (t && t.id !== w.id) { hit = t; break; } }
    if (hit) { let a = tribs.get(hit.id); if (!a) tribs.set(hit.id, a = []); a.push({ at: hit.i, child: w.id }); }
  }

  const memo = new Map<string, number[]>();
  const visiting = new Set<string>();
  const qOf = (id: string): number[] => {
    const have = memo.get(id); if (have) return have;
    const w = byId.get(id)!;
    const n = w.path.length;
    if (visiting.has(id)) return new Array(n).fill(FLOW.base.natural);
    visiting.add(id);
    let base: number = FLOW.base.natural;
    const rec = recById.get(id);
    if (rec) {
      if (rec.source.kind === 'spring') base = FLOW.base.spring;
      else if (rec.source.kind === 'lake') base = FLOW.base.lake;
      else {
        const v = rec.source.via ? tileOf.get(key(rec.source.via.x, rec.source.via.y)) : undefined;
        if (v && v.id !== id) base = FLOW.base.stream * (qOf(v.id)[v.i] ?? FLOW.base.natural);
        else base = FLOW.base.stream * FLOW.base.natural;
      }
    }
    const q = new Array<number>(n).fill(base);
    for (const t of tribs.get(id) ?? []) {
      const cq = qOf(t.child);
      const add = cq[cq.length - 1] ?? 0;
      for (let k = Math.max(0, t.at); k < n; k++) q[k]! += add;
    }
    visiting.delete(id);
    memo.set(id, q);
    return q;
  };

  const out = new Map<string, WayFlow>();
  for (const w of ways) {
    const q = qOf(w.id), n = w.path.length, ice = frozen(w.id) && w.kind === 'dug';
    const speed: number[] = [], cls: number[] = [];
    let maxClass = 0, rapidsTiles = 0;
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - FLOW.window), b = Math.min(n - 1, i + FLOW.window);
      const slope = b > a ? Math.max(0, (w.level[a]! - w.level[b]!) / (b - a)) : 0;
      const qe = Math.min(FLOW.qMax, Math.max(FLOW.qMin, q[i]! * factor));
      const v = Math.min(FLOW.vMax, (FLOW.vBase + FLOW.vSlope * slope) * Math.sqrt(qe));
      const c = v >= FLOW.rapids ? 2 : v >= FLOW.brisk ? 1 : 0;
      speed.push(ice ? 0 : Math.round(v * 1000) / 1000);
      cls.push(c);
      if (c > maxClass) maxClass = c;
      if (c === 2) rapidsTiles++;
    }
    out.set(w.id, { id: w.id, kind: w.kind, q, speed, cls, mouthQ: ice ? 0 : Math.round((q[n - 1] ?? 0) * factor * 1000) / 1000, maxClass: ice ? 0 : maxClass, rapidsTiles: ice ? 0 : rapidsTiles, frozen: ice });
  }
  return out;
}

export interface IceState { frozen: boolean; cold: number; warm: number }

/** Flow table + ice tracker. Constructed by createSim; `update*` are called from the daily weather hook, everything else is a lazy read. */
export class FlowModel {
  private table = new Map<string, WayFlow>();
  private kv = -1; private km = -1; private kf = -1;
  private day = 0;
  /** Bumped when the table was recomputed (renderers refresh their per-tile speed / ice attributes). */
  version = 0;
  private ice: IceState = { frozen: false, cold: 0, warm: 0 };
  constructor(private readonly src: { natural: () => ReadonlyArray<Stream>; rivers: () => { rivers: ReadonlyArray<RiverRec>; version: number } }) {}

  get frozen(): boolean { return this.ice.frozen; }

  /** Daily tick (after the weather rolled): season factor + ice hysteresis from the daily MEAN valley temperature. */
  onDay(day: number, valleyT: number): void {
    this.day = day;
    const s = this.ice;
    if (valleyT < RIVER_ICE.freezeBelow) { s.cold++; s.warm = 0; } else if (valleyT > RIVER_ICE.thawAbove) { s.warm++; s.cold = 0; } else { s.cold = 0; s.warm = 0; }
    if (!s.frozen && s.cold >= RIVER_ICE.freezeDays) s.frozen = true;
    else if (s.frozen && s.warm >= RIVER_ICE.thawDays) s.frozen = false;
  }

  /** Jump (season skip): set day + ice straight from today's mean temperature (deep cold => frozen, mild => thawed, in between keep). */
  settle(day: number, valleyT: number): void {
    this.day = day;
    const s = this.ice;
    if (valleyT < RIVER_ICE.freezeBelow) { s.frozen = true; s.cold = RIVER_ICE.freezeDays; s.warm = 0; }
    else if (valleyT > RIVER_ICE.thawAbove) { s.frozen = false; s.warm = RIVER_ICE.thawDays; s.cold = 0; }
  }

  /** The table, recomputed lazily when the rivers, the sim month or the ice state changed. */
  all(): Map<string, WayFlow> {
    const r = this.src.rivers();
    const m = monthIndex({ day: this.day }), f = this.ice.frozen ? 1 : 0;
    if (r.version !== this.kv || m !== this.km || f !== this.kf) {
      this.kv = r.version; this.km = m; this.kf = f;
      this.table = computeFlow(this.src.natural(), r.rivers, seasonFactor(this.day), () => this.ice.frozen);
      this.version++;
    }
    return this.table;
  }
  get(id: string): WayFlow | undefined { return this.all().get(id); }
  /** Flow of the waterway tile at (x, y) (natural or dug), if any. */
  tileAt(x: number, y: number): { way: WayFlow; i: number } | undefined {
    const ways = waterways(this.src.natural(), this.src.rivers().rivers);
    for (const w of ways) { const i = w.path.findIndex((p) => p.x === x && p.y === y); if (i >= 0) return { way: this.all().get(w.id)!, i }; }
    return undefined;
  }
  /** True when a water tour on / next to a dug river should be closed (any dug river is iced). */
  anyDugFrozen(): boolean { return this.ice.frozen && this.src.rivers().rivers.length > 0; }

  serializeIce(): IceState { return { ...this.ice }; }
  loadIce(d: unknown): void {
    const o = (d ?? {}) as Partial<IceState>;
    this.ice = { frozen: !!o.frozen, cold: o.cold ?? 0, warm: o.warm ?? 0 };
    this.kv = -1;
  }
  resetIce(): void { this.loadIce(null); }
}

/** Sustainability bonus points of the dug rivers (habitat): 0 without any. */
export function riverHabitatPoints(rivers: ReadonlyArray<RiverRec>): number {
  let tiles = 0;
  for (const r of rivers) tiles += r.path.length;
  return Math.min(FLOW.habitat.max, Math.floor((tiles / FLOW.habitat.perTiles) * 10) / 10);
}
