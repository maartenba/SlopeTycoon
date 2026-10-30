import type { Grid } from '../world/Grid';
import type { GameBus } from '../core/events';
import { BUILDINGS, type NeedCondition } from '../config/buildings';
import { COLD_NEED_MAX_TEMP, PISTE_MIN_OPEN_TILES, TILE_METRES, WARM_NEED_MIN_TEMP } from '../config/balance';
import { Layer, type PisteComponent } from '../world/Networks';
import type { LiftData } from './Lift';
import { altitudeMetres } from './Season';
import type { TileConditions } from './TileConditions';
import type { Weather } from './Weather';

/** The part of Networks this module needs (Networks satisfies it). */
export interface PisteSource {
  readonly size: number;
  readonly layers: Uint8Array;
  pisteComponents(): PisteComponent[];
}

/** A piste for status purposes: a run (preferred) or a legacy component. */
export interface PisteUnitLike { tiles: readonly number[]; count: number; disconnected: boolean }

export interface OpenBuilding { id: number; type: string; x: number; y: number; w: number; h: number }

export interface EntityStatus { open: boolean; reason?: string }
export interface PisteStatus {
  /** Lowest tile index of the component (stable while the piste is unchanged). */
  key: number;
  open: boolean;
  totalTiles: number;
  openTiles: number;
  totalLengthM: number;
  /** Length of the connected skiable part, shown in the inspector. */
  openLengthM: number;
  reason?: string;
}

export interface OpenStatusDeps {
  grid: Grid;
  cond: TileConditions;
  weather: Weather;
  networks: () => PisteSource | null;
  /** Runs (docs/runs.md): when given, pistes are evaluated per run instead of per 8-connected component. `id` = persistent run id (default: lowest tile). */
  runs?: () => ReadonlyArray<PisteUnitLike>;
  runId?: (run: PisteUnitLike) => number;
  /** Player closed this run by hand. */
  runClosed?: (id: number) => boolean;
  /** Junction / station nodes: skeleton tiles + the run indices (into `runs()`) meeting there. A node tile answers with an open run when one exists. */
  runNodes?: () => ReadonlyArray<{ tiles: readonly number[]; runs: readonly number[] }>;
  lifts: () => Iterable<LiftData>;
  buildings: () => Iterable<OpenBuilding>;
  bus?: Pick<GameBus, 'emit'>;
}

const fmtM = (n: number): string => n.toLocaleString('en-US');
/** Lift kinds that can carry foot/bike passengers (T-bars drag skis only). */
const isFootKind = (k: string): boolean => k !== 'tbar';
const ROUTE_RADIUS = 2;
const OFFPISTE_MIN_TILES = 6;

/**
 * Per-entity open/close evaluation, run once per in-game day (hooked from the weather system). Availability comes from the
 * snow/temperature of each entity's OWN tiles via TileConditions (which carries the open/close hysteresis), never the global season.
 */
export class OpenStatus {
  private pistes = new Map<number, PisteStatus>();
  private pisteOfTile = new Map<number, number>();
  private buildingState = new Map<number, EntityStatus>();
  private liftOpen = new Map<number, boolean>();
  private trails = { mtb: 0, hike: 0 };
  /** Temporary closures (Task 26: avalanche / avalanche control): any piste component touching `tiles` is closed until `until` (sim tick). */
  private closures: Array<{ tiles: Set<number>; reason: string; until: number }> = [];
  /**
   * Navigation mask (Task 27): 1 = the tile belongs to a temporarily closed area (closure tiles + every tile of a piste closed by one).
   * Stable array identity (hand it to NavWorld.closed); `takeClosureFlips` journals the tiles whose bit changed so the graph re-validates.
   */
  readonly closedMask: Uint8Array;
  private closedSet = new Set<number>();
  /** Tiles of closed backcountry routes (Phase 6 Task 32): part of the navigation mask, never saved here (the Backcountry module owns them). */
  private extraClosed: ReadonlySet<number> = new Set<number>();
  private closureFlips: number[] = [];

  constructor(private d: OpenStatusDeps) { this.closedMask = new Uint8Array(d.grid.size * d.grid.size); }

  /** Save/load (Task 33): only the temporary closures are state; everything else is re-derived by `evaluate()` (silently). */
  serialize(): unknown { return { closures: this.closures.map((c) => ({ tiles: [...c.tiles], reason: c.reason, until: c.until })) }; }
  load(data: unknown): void {
    const s = data as { closures: Array<{ tiles: number[]; reason: string; until: number }> } | undefined;
    this.closures = (s?.closures ?? []).map((c) => ({ tiles: new Set(c.tiles), reason: c.reason, until: c.until }));
    this.closedMask.fill(0); this.closedSet = new Set(); this.closureFlips = []; this.pistes = new Map(); this.liftOpen = new Map();
    // Lift verdict hysteresis lives on the lifts (condOpen); seed it so re-evaluation does not re-emit / flip anything.
    for (const l of this.d.lifts()) if (l.condOpen !== undefined) this.liftOpen.set(l.id, l.condOpen);
    const bus = this.d.bus; this.d.bus = undefined;
    try { this.evaluate(); } finally { this.d.bus = bus; }
    this.closureFlips = [];
  }

  /** Tiles whose closed bit flipped since the last call (null = none). Consumed. */
  takeClosureFlips(): number[] | null {
    if (!this.closureFlips.length) return null;
    const f = this.closureFlips; this.closureFlips = [];
    return f;
  }
  /** Closed backcountry route tiles (not shared with a piste); re-derives the navigation mask. */
  setExtraClosed(tiles: ReadonlySet<number>): void { this.extraClosed = tiles; this.evalPistes(); }
  isTileClosed(i: number): boolean { return this.closedMask[i] === 1; }
  /** Active temporary closures (UI / news): reason + remaining sim ticks. */
  activeClosures(nowTick: number): Array<{ reason: string; tiles: number; remaining: number }> {
    return this.closures.map((c) => ({ reason: c.reason, tiles: c.tiles.size, remaining: Math.max(0, c.until - nowTick) }));
  }
  private syncMask(add: Set<number>): void {
    for (const t of this.closedSet) if (!add.has(t)) { this.closedMask[t] = 0; this.closureFlips.push(t); }
    for (const t of add) if (!this.closedSet.has(t)) { this.closedMask[t] = 1; this.closureFlips.push(t); }
    this.closedSet = add;
  }
  private skiableOpen(x: number, y: number): boolean {
    return this.d.cond.isSkiable(x, y) && this.closedMask[y * this.d.grid.size + x] !== 1;
  }

  pisteStatuses(): PisteStatus[] { return [...this.pistes.values()]; }
  pisteAt(x: number, y: number): PisteStatus | undefined {
    const k = this.pisteOfTile.get(y * this.d.grid.size + x);
    return k === undefined ? undefined : this.pistes.get(k);
  }
  buildingStatus(id: number): EntityStatus | undefined { return this.buildingState.get(id); }
  /** Fraction (0..1) of painted MTB / hike trail tiles currently bikeable / hikeable. */
  trailOpenFraction(): { mtb: number; hike: number } { return { ...this.trails }; }

  /** Close every piste touching `tiles` for `ticks` sim ticks (applied immediately). */
  closeTiles(tiles: number[], reason: string, nowTick: number, ticks: number): void {
    this.closures.push({ tiles: new Set(tiles), reason, until: nowTick + ticks });
    this.evalPistes();
    this.evalLifts();
  }
  /** Drop expired closures; re-evaluates pistes when any ended. */
  tickClosures(nowTick: number): void {
    if (!this.closures.length || !this.closures.some((c) => c.until <= nowTick)) return;
    this.closures = this.closures.filter((c) => c.until > nowTick);
    this.evalPistes();
    this.evalLifts();
  }
  closureCount(): number { return this.closures.length; }
  private closureReason(tiles: readonly number[]): string | undefined {
    for (const c of this.closures) for (const t of tiles) if (c.tiles.has(t)) return c.reason;
    return undefined;
  }

  evaluate(): void {
    this.evalPistes();
    this.evalLifts();
    this.evalBuildings();
    this.evalTrails();
  }

  // ---------- pistes ----------

  private evalPistes(): void {
    const net = this.d.networks();
    const next = new Map<number, PisteStatus>();
    this.pisteOfTile.clear();
    const mask = new Set<number>();
    let unitKeysRef: number[] = [];
    for (const c of this.closures) for (const t of c.tiles) mask.add(t);
    for (const t of this.extraClosed) mask.add(t);
    if (net) {
      const N = net.size, c = this.d.cond;
      const mark = new Int32Array(N * N).fill(-1);
      let stamp = 0;
      const units: ReadonlyArray<PisteUnitLike> = this.d.runs ? this.d.runs() : net.pisteComponents();
      const unitKeys: number[] = [];
      for (const comp of units) {
        const lowest = comp.tiles.reduce((m, t) => (t < m ? t : m), Infinity);
        const key = this.d.runId ? this.d.runId(comp) : lowest;
        const inComp = new Set<number>(comp.tiles);
        let best = 0;
        for (const s of comp.tiles) {
          if (mark[s]! >= 0 || !c.isSkiable(s % N, (s / N) | 0)) continue;
          let size = 0;
          const q = [s]; mark[s] = stamp;
          for (let h = 0; h < q.length; h++) {
            const i = q[h]!, x = i % N, y = (i / N) | 0;
            size++;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx, ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
              const ni = ny * N + nx;
              if (mark[ni]! >= 0 || !inComp.has(ni) || !c.isSkiable(nx, ny)) continue;
              mark[ni] = stamp; q.push(ni);
            }
          }
          stamp++;
          if (size > best) best = size;
        }
        const closure = this.closures.length ? this.closureReason(comp.tiles) : undefined;
        if (closure) for (const t of comp.tiles) mask.add(t);
        const manual = !closure && !!this.d.runClosed?.(key);
        if (manual) for (const t of comp.tiles) mask.add(t);
        const open = !closure && !manual && !comp.disconnected && best >= Math.min(PISTE_MIN_OPEN_TILES, comp.count);
        const st: PisteStatus = {
          key, open, totalTiles: comp.count, openTiles: open ? best : 0,
          totalLengthM: comp.count * TILE_METRES, openLengthM: open ? best * TILE_METRES : 0,
          reason: open ? undefined : closure ? `Closed: ${closure}` : manual ? 'Closed by you' : comp.disconnected ? 'Not connected to a lift' : 'Closed: not enough snow',
        };
        next.set(key, st); unitKeys.push(key); unitKeysRef = unitKeys;
        for (const t of comp.tiles) this.pisteOfTile.set(t, key);
        const was = this.pistes.get(key);
        if (!was || was.open !== open) this.d.bus?.emit('piste:opened', { id: key, open });
      }
    }
    if (net && this.d.runs && this.d.runNodes) {
      for (const nd of this.d.runNodes()) {
        let pick: number | undefined;
        for (const r of nd.runs) { const k = unitKeysRef[r]; if (k === undefined) continue; if (pick === undefined) pick = k; if (next.get(k)?.open) { pick = k; break; } }
        if (pick !== undefined) for (const t of nd.tiles) this.pisteOfTile.set(t, pick);
      }
    }
    for (const [k, was] of this.pistes) if (!next.has(k) && was.open) this.d.bus?.emit('piste:opened', { id: k, open: false });
    this.pistes = next;
    this.syncMask(mask);
  }

  // ---------- lifts ----------

  private stationTiles(p: { x: number; y: number }): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) out.push([p.x + dx, p.y + dy]);
    return out;
  }

  /** A skiable descent exists from the top station: connected skiable ski-layer tiles, or off-piste skiable ground. */
  hasSkiRoute(top: { x: number; y: number }): boolean {
    const g = this.d.grid, c = this.d.cond, N = g.size, net = this.d.networks();
    const topTiles = this.stationTiles(top);
    if (!topTiles.some(([x, y]) => this.skiableOpen(x, y))) return false;
    const seen = new Set<number>();
    const q: number[] = [];
    const usePiste = (i: number): boolean => !!net && (net.layers[i]! & Layer.Ski) !== 0;
    for (let y = top.y - ROUTE_RADIUS; y < top.y + 2 + ROUTE_RADIUS; y++) for (let x = top.x - ROUTE_RADIUS; x < top.x + 2 + ROUTE_RADIUS; x++) {
      if (!g.inBounds(x, y) || !this.skiableOpen(x, y)) continue;
      const i = y * N + x;
      if (usePiste(i)) { seen.add(i); q.push(i); }
    }
    for (let h = 0; h < q.length; h++) {
      if (q.length >= PISTE_MIN_OPEN_TILES) return true;
      const i = q[h]!, x = i % N, y = (i / N) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, ni = ny * N + nx;
        if (!g.inBounds(nx, ny) || seen.has(ni) || !usePiste(ni) || !this.skiableOpen(nx, ny)) continue;
        seen.add(ni); q.push(ni);
      }
    }
    if (q.length >= PISTE_MIN_OPEN_TILES) return true;
    // off-piste: skiable ground flowing downhill from the station
    const alt = (x: number, y: number): number => c.altitude(x, y);
    const start = topTiles.filter(([x, y]) => this.skiableOpen(x, y));
    const seen2 = new Set<number>(start.map(([x, y]) => y * N + x));
    const q2 = start.map(([x, y]) => y * N + x);
    for (let h = 0; h < q2.length && q2.length < 200; h++) {
      const i = q2[h]!, x = i % N, y = (i / N) | 0, a = alt(x, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, ni = ny * N + nx;
        if (!g.inBounds(nx, ny) || seen2.has(ni) || !this.skiableOpen(nx, ny) || alt(nx, ny) > a + 1e-6) continue;
        seen2.add(ni); q2.push(ni);
      }
    }
    return q2.length >= OFFPISTE_MIN_TILES;
  }

  private evalLifts(): void {
    const c = this.d.cond;
    const seen = new Set<number>();
    for (const l of this.d.lifts()) {
      seen.add(l.id);
      const mode = l.mode ?? 'auto';
      const canFoot = isFootKind(l.kind);
      const topSki = this.hasSkiRoute(l.top);
      const bt = this.stationTiles(l.bottom);
      const bottomFree = bt.filter(([x, y]) => c.isHikeable(x, y)).length >= 3;
      const footOk = canFoot && bottomFree;
      let active: 'ski' | 'foot' | 'mixed' | null = null;
      let reason = '';
      const topAlt = altitudeMetres(l.top.ground);
      if (mode === 'ski') { if (topSki) active = 'ski'; else reason = `Closed: no snow at the top station (${fmtM(topAlt)} m)`; }
      else if (mode === 'foot') {
        if (footOk) active = 'foot';
        else reason = !canFoot ? 'Closed: this lift does not carry hikers' : `Closed: snow at the bottom station (${fmtM(altitudeMetres(l.bottom.ground))} m)`;
      } else if (topSki && footOk) active = 'mixed';
      else if (topSki) active = 'ski';
      else if (footOk) active = 'foot';
      else reason = canFoot && !bottomFree
        ? `Closed: no snow at the top (${fmtM(topAlt)} m), snow at the bottom`
        : `Closed: no snow at the top station (${fmtM(topAlt)} m)`;
      const open = active !== null;
      l.activeMode = active;
      l.closedReason = open ? undefined : reason;
      l.condOpen = open;
      const was = this.liftOpen.get(l.id);
      // Only act when the CONDITION verdict changes (or first sight), so a manual player close/open sticks until conditions flip.
      // Operations (schedule / manual / fault holds, sim/ops/LiftOps) keep a lift closed even when conditions allow it.
      const target = open && !l.opsClosed;
      if ((was === undefined || was !== open) && (l.open !== open || l.opsClosed)) {
        l.open = target;
        this.d.bus?.emit('lift:opened', { id: l.id, open });
        if (!open) this.d.bus?.emit('lift:closed', { id: l.id, reason });
      } else if (was === undefined && !open) this.d.bus?.emit('lift:closed', { id: l.id, reason });
      this.liftOpen.set(l.id, open);
    }
    for (const id of [...this.liftOpen.keys()]) if (!seen.has(id)) this.liftOpen.delete(id);
  }

  // ---------- buildings / attractions ----------

  /** Evaluate catalog `needs` at the centre tile of a building. */
  evaluateNeeds(needs: readonly NeedCondition[], tx: number, ty: number): EntityStatus {
    const c = this.d.cond, w = this.d.weather;
    const alt = c.altitude(tx, ty), m = fmtM(altitudeMetres(alt)), T = w.temperatureAt(alt);
    for (const n of needs) {
      if (n === 'snow' && !c.isSkiable(tx, ty)) return { open: false, reason: `Closed: no snow at ${m} m` };
      if (n === 'snowFree' && !c.isHikeable(tx, ty)) return { open: false, reason: `Closed: snow cover at ${m} m` };
      if (n === 'cold' && T > COLD_NEED_MAX_TEMP) return { open: false, reason: `Closed: too warm at ${m} m (${T.toFixed(0)}°C)` };
      if (n === 'warm' && T < WARM_NEED_MIN_TEMP) return { open: false, reason: `Closed: too cold at ${m} m (${T.toFixed(0)}°C)` };
    }
    return { open: true };
  }

  private evalBuildings(): void {
    const next = new Map<number, EntityStatus>();
    for (const b of this.d.buildings()) {
      const needs = BUILDINGS[b.type]?.needs;
      if (!needs || needs.length === 0) { next.set(b.id, { open: true }); continue; }
      next.set(b.id, this.evaluateNeeds(needs, b.x + (b.w >> 1), b.y + (b.h >> 1)));
    }
    this.buildingState = next;
  }

  private evalTrails(): void {
    const net = this.d.networks();
    if (!net) { this.trails = { mtb: 0, hike: 0 }; return; }
    const N = net.size, c = this.d.cond;
    let mt = 0, mo = 0, ht = 0, ho = 0;
    for (let i = 0; i < N * N; i++) {
      const l = net.layers[i]!;
      if (!(l & (Layer.Mtb | Layer.Hike))) continue;
      const x = i % N, y = (i / N) | 0;
      if (l & Layer.Mtb) { mt++; if (c.isBikeable(x, y)) mo++; }
      if (l & Layer.Hike) { ht++; if (c.isHikeable(x, y)) ho++; }
    }
    this.trails = { mtb: mt ? mo / mt : 0, hike: ht ? ho / ht : 0 };
  }
}
