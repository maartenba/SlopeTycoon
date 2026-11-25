import { PARK, type FeatureKind, type ParkReason } from '../../config/park';
import type { Run } from '../../world/Runs';
import type { RunSettings } from '../RunSettings';
import type { HutRect } from '../race/RaceCourse';

/**
 * Snow parks (0.9.0, docs/snow-park.md). A park is a property of a RUN (`RunSettings.isPark`, saved in the `runs` module): no tile layer, no migration. This system derives the rest:
 * validity (blue or harder, long enough, not a loop, a Groomer Garage somewhere), the features (a pure function of the run), the SHAPE 0..1 (a groomer pass on the park's tiles
 * restores it, every Freestyler lap and every day wear it), the demand of the Freestyler type and the lap bookkeeping (saved in the `snowPark` module, null while nothing happened).
 * The sim never reads a render value; the airs are drawn by `ParkView` from the features.
 */
export interface ParkDeps {
  size: number;
  runs(): readonly Run[];
  runId(r: Run): number;
  settings: RunSettings;
  /** Is at least one active Groomer Garage standing? */
  hasGarage(): boolean;
  /** Active, connected Halfpipes (tile footprints). */
  halfpipes(): readonly HutRect[];
  /** Is the run open to skiers right now? */
  runOpen(r: Run): boolean;
  /** Absolute day number. */
  day(): number;
  /** Pay a fee (dollars). */
  earn(amount: number): void;
}
export interface Feature { x: number; y: number; kind: FeatureKind; /** unit heading along the run (tile space) */ dx: number; dy: number }
export interface ParkInfo {
  id: number; run: Run; valid: boolean; reason: ParkReason | null; open: boolean;
  /** 0..1 */
  shape: number; worn: boolean;
  /** Arrival quality 0..~1.3: 0 when not valid / open. */
  quality: number;
  pipe: HutRect | null;
  features: number;
}
export interface ParkSaved { shape: Array<[number, number]>; stamp: Array<[number, number]>; laps: Array<[number, number, number]>; total: number; tricks: number; day: number; today: number }

/** Gap in tiles between a footprint and a tile (0 = touching or inside). */
const gap = (h: HutRect, tx: number, ty: number): number => Math.max(h.x - tx - 1, tx - (h.x + h.w - 1) - 1, h.y - ty - 1, ty - (h.y + h.h - 1) - 1, 0);
const mix = (a: number, b: number): number => { let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b)) >>> 0; h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0; h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
/** Laps a Freestyler rides before leaving (a stable function of the guest id). */
export const parkQuota = (guestId: number): number => PARK.laps[0] + Math.floor(mix(guestId, 23) * (PARK.laps[1] - PARK.laps[0] + 1));

/** The features of a run (pure): every N centre-line tiles from `clearStart` to `clearEnd` before the foot, a repeating cycle of kinds by difficulty, heading along the run. */
export function parkFeatures(run: Run, size: number): Feature[] {
  const poly = run.poly, step = PARK.spacing[run.difficulty] ?? 3, cyc = PARK.cycle[run.difficulty] ?? PARK.cycle[3]!, out: Feature[] = [];
  if (poly.length < 6) return out;
  for (let k = PARK.clearStart; k < poly.length - PARK.clearEnd; k += step) {
    const a = poly[Math.max(0, k - 1)]!, b = poly[Math.min(poly.length - 1, k + 1)]!, c = poly[k]!;
    let dx = (b % size) - (a % size), dy = ((b / size) | 0) - ((a / size) | 0);
    const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
    out.push({ x: (c % size) + 0.5, y: ((c / size) | 0) + 0.5, kind: cyc[out.length % cyc.length]!, dx, dy });
  }
  return out;
}

export class SnowPark {
  private shape = new Map<number, number>();
  private stamp = new Map<number, number>();
  private laps = new Map<number, [number, number]>(); // guest id -> [laps done, last fee day + 1]
  total = 0; tricks = 0;
  private dayStamp = -1; private today = 0;
  /** Bumps whenever a lap lands or the shape moves (UI caches). */
  version = 0;
  private cache: { key: string; runs: readonly Run[]; st: Array<{ id: number; run: Run; reason: ParkReason | null; pipe: HutRect | null }> } | null = null;
  constructor(private d: ParkDeps) {}

  private key(): string { return `${this.d.settings.version}:${this.d.hasGarage() ? 1 : 0}:${this.d.halfpipes().map((h) => `${h.x},${h.y}`).join(';')}`; }

  /** Why a run cannot be a park right now (null = it can). Ignores the park count. */
  reasonFor(r: Run): ParkReason | null {
    if (r.loop || r.synthetic || r.poly.length < 6) return 'shape';
    if (r.difficulty < PARK.minDifficulty) return 'difficulty';
    if (r.lengthM < PARK.minLengthM) return 'length';
    if (PARK.needsGarage && !this.d.hasGarage()) return 'noGroomer';
    return null;
  }
  /** The run that just misses the length for a park (blue or harder, 60-100 m, not marked): Rudi's `park.short`. A pure read. */
  nearMiss(): Run | null {
    let best: Run | null = null;
    for (const r of this.d.runs()) {
      if (r.loop || r.synthetic || r.poly.length < 6 || r.difficulty < PARK.minDifficulty || r.lengthM >= PARK.minLengthM || r.lengthM < PARK.minLengthM - 40) continue;
      if (this.d.settings.isPark(this.d.runId(r))) continue;
      if (!best || r.lengthM > best.lengthM) best = r;
    }
    return best;
  }

  /** Mark / unmark a run. Switching on is refused with the reason; switching off always works. */
  setPark(id: number, on: boolean): { ok: boolean; reason?: ParkReason } {
    const r = this.d.runs().find((x) => this.d.runId(x) === id);
    if (!r) return on ? { ok: false, reason: 'gone' } : { ok: this.d.settings.setPark(id, false) };
    if (!on) { this.d.settings.setPark(id, false); this.shape.delete(id); this.stamp.delete(id); this.version++; return { ok: true }; }
    if (this.d.settings.isPark(id)) return { ok: true };
    const why = this.reasonFor(r);
    if (why) return { ok: false, reason: why };
    if (this.d.settings.parkIds().length >= PARK.maxParks) return { ok: false, reason: 'tooMany' };
    this.d.settings.setPark(id, true);
    if (!this.shape.has(id)) { this.shape.set(id, PARK.shape.start); this.stamp.set(id, this.d.day()); }
    this.version++;
    return { ok: true };
  }

  private structure(): Array<{ id: number; run: Run; reason: ParkReason | null; pipe: HutRect | null }> {
    const key = this.key(), runs = this.d.runs();
    if (this.cache && this.cache.key === key && this.cache.runs === runs) return this.cache.st;
    const st: Array<{ id: number; run: Run; reason: ParkReason | null; pipe: HutRect | null }> = [];
    const pipes = this.d.halfpipes();
    for (const r of runs) {
      const id = this.d.runId(r);
      if (!this.d.settings.isPark(id)) continue;
      const reason = this.reasonFor(r);
      let pipe: HutRect | null = null;
      if (reason === null && pipes.length) { let bg = Infinity; for (const h of pipes) for (const t of r.tiles) { const g = gap(h, t % this.d.size, (t / this.d.size) | 0); if (g <= PARK.pipeReach && g < bg) { bg = g; pipe = h; } } }
      st.push({ id, run: r, reason, pipe });
    }
    this.cache = { key, runs, st };
    this.tileCache = null;
    return st;
  }
  /** Lazy daily decay: applied before any read / write, so it equals an eager decay at every midnight. */
  private touch(id: number): number {
    const day = this.d.day();
    let s = this.shape.get(id);
    if (s === undefined) { s = PARK.shape.start; this.stamp.set(id, day); }
    const last = this.stamp.get(id) ?? day;
    if (day > last) { s = Math.max(0, s - PARK.shape.daily * (day - last)); this.stamp.set(id, day); }
    this.shape.set(id, s);
    return s;
  }
  shapeOf(id: number): number { return this.touch(id); }

  /** Every marked park with its status (live: shape, openness, quality). */
  parks(): readonly ParkInfo[] {
    const list: ParkInfo[] = [];
    for (const c of this.structure()) {
      const valid = c.reason === null, open = valid && this.d.runOpen(c.run), shape = this.touch(c.id), worn = shape < PARK.shape.worn;
      const q = open ? (PARK.qualityFloor + (1 - PARK.qualityFloor) * shape) * (worn ? PARK.wornDemand : 1) * (c.pipe ? 1 + PARK.pipeDemand : 1) : 0;
      list.push({ id: c.id, run: c.run, valid, reason: c.reason, open, shape, worn, quality: q, pipe: c.pipe, features: valid ? parkFeatures(c.run, this.d.size).length : 0 });
    }
    return list;
  }
  /** Active (valid + open) parks. */
  active(): ParkInfo[] { return this.parks().filter((p) => p.open); }
  private tileCache: { sig: string; tiles: Set<number>; owner: Map<number, number> } | null = null;
  private tiles(): { tiles: Set<number>; owner: Map<number, number> } {
    const list = this.parks().filter((p) => p.valid), sig = list.map((p) => `${p.id}${p.open ? 'o' : 'c'}:${p.run.tiles.length}`).join(',') + '|' + (this.cache?.key ?? '');
    if (!this.tileCache || this.tileCache.sig !== sig) {
      const tiles = new Set<number>(), owner = new Map<number, number>();
      for (const p of list) for (const t of p.run.tiles) { owner.set(t, p.id); if (p.open) tiles.add(t); }
      this.tileCache = { sig, tiles, owner };
    }
    return this.tileCache;
  }
  /** Tiles of the open parks (Freestylers aim at them; Snowboarders lean towards them). */
  parkTiles(): ReadonlySet<number> { return this.tiles().tiles; }
  parkAt(tile: number): ParkInfo | undefined { const id = this.tiles().owner.get(tile); return id === undefined ? undefined : this.parks().find((p) => p.id === id); }

  /** A groomer pass on a tile: a park tile restores its park's shape (60 % of the tiles groomed = fully shaped). */
  onGroom(tile: number): void {
    const id = this.tiles().owner.get(tile);
    if (id === undefined) return;
    const p = this.structure().find((c) => c.id === id);
    if (!p) return;
    const s = this.touch(id), gain = 1 / (PARK.shape.shapeShare * Math.max(1, p.run.tiles.length));
    const n = Math.min(1, s + gain);
    if (n !== s) { this.shape.set(id, n); this.version++; }
  }

  /** Arrival multiplier for the Freestyler type: the summed quality of up to `maxParks` open parks; 0 without one or once the parks are full. */
  demand(alive: number): number {
    const a = this.active().slice(0, PARK.maxParks);
    if (!a.length || alive >= a.length * PARK.maxPerPark) return 0;
    let q = 0; for (const p of a) q += p.quality;
    return q;
  }
  /** Injury roll multiplier for a Freestyler finishing a run on `tile` (1 + base, rougher while the park is worn). */
  injuryScale(tile: number): number {
    const p = this.parkAt(tile) ?? this.active()[0]; // a run ends below the park: the rider's park is the one it lapped
    return p ? PARK.injury.base + PARK.injury.worn * (1 - p.shape) : PARK.injury.base;
  }

  /** A Freestyler reached the via tile in a park: count the lap, wear the park, charge the fee on the first lap of the day. Returns true when the rider has trained enough. */
  onLap(guestId: number, tile: number): boolean {
    const p = this.parkAt(tile);
    if (!p || !p.open) return false;
    const day = this.d.day();
    this.rollDay(day);
    const rec = this.laps.get(guestId) ?? [0, 0];
    rec[0]++; this.total++; this.version++;
    this.tricks += Math.min(PARK.maxTricksPerLap, p.features) + (p.pipe ? PARK.pipeTricks : 0);
    if (rec[1] !== day + 1) { rec[1] = day + 1; this.today++; this.d.earn(PARK.fee); }
    if (p.pipe) this.d.earn(PARK.pipeFee);
    this.laps.set(guestId, rec);
    this.shape.set(p.id, Math.max(0, this.touch(p.id) - PARK.shape.lap));
    return rec[0] >= parkQuota(guestId);
  }
  private rollDay(day: number): void { if (day !== this.dayStamp) { this.dayStamp = day; this.today = 0; } }
  ridersToday(): number { return this.dayStamp === this.d.day() ? this.today : 0; }
  lapsOf(guestId: number): number { return this.laps.get(guestId)?.[0] ?? 0; }
  /** Forget the lap records of guests that are gone (call on the day boundary). */
  prune(alive: (id: number) => boolean): void { for (const id of [...this.laps.keys()]) if (!alive(id)) this.laps.delete(id); }

  serialize(): ParkSaved | null {
    if (!this.laps.size && !this.total && !this.shape.size) return null;
    return {
      shape: [...this.shape].sort((a, b) => a[0] - b[0]), stamp: [...this.stamp].sort((a, b) => a[0] - b[0]),
      laps: [...this.laps].sort((a, b) => a[0] - b[0]).map(([id, v]) => [id, v[0], v[1]]), total: this.total, tricks: this.tricks, day: this.dayStamp, today: this.today,
    };
  }
  load(d: Partial<ParkSaved> | null | undefined): void {
    this.shape = new Map(d?.shape ?? []); this.stamp = new Map(d?.stamp ?? []);
    this.laps = new Map((d?.laps ?? []).map(([id, n, f]) => [id, [n, f] as [number, number]]));
    this.total = d?.total ?? 0; this.tricks = d?.tricks ?? 0; this.dayStamp = d?.day ?? -1; this.today = d?.today ?? 0;
    this.cache = null; this.tileCache = null; this.version++;
  }
  reset(): void { this.load(null); }
}
