import { RESERVOIR_CAPACITY, SNOWMAKING_MAX_TEMP } from '../../config/balance';
import { BUILDINGS } from '../../config/buildings';
import type { SeasonId } from '../../core/events';
import type { Coverage } from '../Coverage';
import type { WaterSupply } from '../Weather';
import type { HourCtx } from './PisteQuality';

export const SNOWMAKING = {
  /** Cannons run at full output at or below this °C (same as the daily model). */
  maxTemp: SNOWMAKING_MAX_TEMP,
  /** Marginal (wet-bulb) snowmaking: between maxTemp and this °C the cannons still run at `marginalRate` of full output. */
  wetBulbTemp: 0,
  marginalRate: 0.5,
  /** Target base depth on pistes (m). */
  targetDepth: 0.6,
  /** Off-piste ground close to a cannon (within `offPisteRadius` tiles) gets a thinner base up to this depth (m). */
  offPisteDepth: 0.3,
  offPisteRadius: 5,
  /** Off-piste output relative to the piste output. */
  offPisteRate: 0.6,
  /** Depth added per hour per tile at full output next to the cannon (m); a cold night builds a 0.5 m base. */
  perHour: 0.08,
  /** Output at the edge of the cannon's throw is 1 - edgeFalloff of the output at the nozzle (smooth fan, not a hard disc). */
  edgeFalloff: 0.45,
  /** Water units per tile·cm of snow (a 20 000 reservoir carries ~10 cannons through a winter). */
  waterPerTileCm: 0.25,
  energyPerCannonHour: 1.5,
  energyPerWaterUnit: 0.002,
  /** Initial fill fraction of a new reservoir. */
  startFill: 0.5,
  /** Refill per reservoir per day: streams, rain, snowmelt, summer. */
  streamPerDay: 300,
  rainPerDay: 1500,
  meltPerDegPerDay: 150,
  meltMaxPerDay: 900,
  summerPerDay: 3000,
  /** Auto mode: cannons pause when the mean daily high (15:00) at the highest covered piste tile is above this °C, or the snowline is above every covered piste tile. */
  autoMaxHigh: 4,
  /** Share of upkeep a mothballed (switched-off) cannon pays (same idea as the off-season relief, docs/ops.md). */
  mothballUpkeepShare: 0.15,
} as const;

/** Global snowmaking mode: 'on' = run whenever the temperature allows (the classic behaviour, default), 'off' = all mothballed, 'auto' = also pause when it is pointless. */
export type SnowmakingMode = 'on' | 'off' | 'auto';
export const SNOWMAKING_MODES: readonly SnowmakingMode[] = ['on', 'off', 'auto'];

/** What a cannon did in its last hourly run (inspector). */
export type CannonState = 'running' | 'warm' | 'noWater' | 'noPiste' | 'full' | 'idle' | 'off' | 'paused';
export interface CannonStats {
  state: CannonState;
  /** Tiles in reach (piste within the throw radius + off-piste ground within the small radius, water excluded). */
  tiles: number;
  /** Of those, piste tiles. */
  pisteTiles: number;
  /** Tiles still below their target depth. */
  needy: number;
  /** Today's (this night's so far) and yesterday's totals: summed depth gain over the tiles (m·tile) and water used. */
  gainToday: number; waterToday: number; gainLast: number; waterLast: number;
  /** Why an Auto-paused cannon is paused. */
  pause?: 'snowline' | 'warm';
}

export interface ReservoirBuilding { id: number; type: string; active: boolean }
interface Res { level: number; capacity: number }

/** Real reservoir model: per-reservoir level and capacity; implements WaterSupply for Weather's snowmaking hook. */
export class Reservoirs implements WaterSupply {
  private res = new Map<number, Res>();
  constructor(private capacityEach = RESERVOIR_CAPACITY, private startFill: number = SNOWMAKING.startFill) {}

  /** Match the store to the active reservoir buildings (new ones start part-filled). */
  sync(buildings: Iterable<ReservoirBuilding>): void {
    const seen = new Set<number>();
    for (const b of buildings) {
      if (b.type !== 'reservoir' || !b.active) continue;
      seen.add(b.id);
      if (!this.res.has(b.id)) this.res.set(b.id, { level: this.capacityEach * this.startFill, capacity: this.capacityEach });
    }
    for (const id of [...this.res.keys()]) if (!seen.has(id)) this.res.delete(id);
  }

  get count(): number { return this.res.size; }
  level(): number { let s = 0; for (const r of this.res.values()) s += r.level; return s; }
  capacity(): number { let s = 0; for (const r of this.res.values()) s += r.capacity; return s; }
  levelOf(id: number): { level: number; capacity: number } | undefined { const r = this.res.get(id); return r && { ...r }; }
  has(): boolean { return this.level() > 0; }

  /** Draw up to `amount` (fullest reservoir first, deterministic by id); returns granted. */
  consume(amount: number): number {
    let need = Math.max(0, amount);
    const ids = [...this.res.keys()].sort((a, b) => a - b);
    for (const id of ids) {
      if (need <= 0) break;
      const r = this.res.get(id)!, g = Math.min(r.level, need);
      r.level -= g; need -= g;
    }
    return amount - need;
  }

  /** Add water, spread over reservoirs in id order; returns what fit. */
  fill(amount: number): number {
    let left = Math.max(0, amount);
    for (const id of [...this.res.keys()].sort((a, b) => a - b)) {
      const r = this.res.get(id)!, g = Math.min(r.capacity - r.level, left);
      r.level += g; left -= g;
    }
    return amount - left;
  }

  /** Daily inflow per reservoir: streams + rain + snowmelt, much more in summer. */
  refillDay(season: SeasonId, wx: { kind: string; intensity: number; valleyT: number }): void {
    const S = SNOWMAKING;
    let per = S.streamPerDay;
    if (wx.kind === 'rain' || wx.kind === 'storm') per += S.rainPerDay * wx.intensity;
    if (wx.valleyT > 2) per += Math.min(S.meltMaxPerDay, S.meltPerDegPerDay * wx.valleyT);
    if (season === 'summer') per += S.summerPerDay;
    this.fill(per * this.res.size);
  }

  serialize(): Array<[number, number, number]> { return [...this.res.entries()].map(([id, r]) => [id, r.level, r.capacity]); }
  load(d: Array<[number, number, number]>): void { this.res = new Map(d.map(([id, level, capacity]) => [id, { level, capacity }])); }
}

export type OpsCostCategory = 'energy' | 'fuel' | 'wages';

export interface SnowmakingEnv {
  size: number;
  coverage: Coverage;
  reservoirs: Reservoirs;
  isPiste(i: number): boolean;
  /** Tiles that can never carry snow (lakes, streams). */
  skip?(i: number): boolean;
  snowDepth: Float32Array;
  altOf(x: number, y: number): number;
  /** SnowCover.addSnow. */
  addSnow(i: number, depth: number): void;
  onCost?: (category: OpsCostCategory, amount: number) => void;
  /** Auto mode inputs: today's effective snowline (world altitude) and the temperature at an altitude at the daily peak (15:00). Absent = Auto never pauses. */
  snowline?: () => number;
  dailyHigh?: (alt: number) => number;
}

/** Hourly cannon logic. Cannons come from Coverage 'snowmaking' sources (active + linked to an active reservoir). */
export class Snowmaking {
  /** Energy not yet billed (flushed once per day). */
  pendingEnergy = 0;
  addedLastHour = 0;
  activeLastHour = 0;
  waterUsedTotal = 0;
  /** Per-tile depth gained since the last daily roll / during the previous day (m): the snowmaking overlay + inspector read these. */
  readonly gainToday: Float32Array;
  readonly gainLast: Float32Array;
  /** Bumped whenever the gain maps change (renderers repaint). */
  version = 0;
  private stats = new Map<number, CannonStats>();
  /** Global mode and the cannons switched off one by one (saved only when non-default). */
  mode: SnowmakingMode = 'on';
  private off = new Set<number>();
  private scratchIdx = new Int32Array(21 * 21);
  private scratchAdd = new Float32Array(21 * 21);

  constructor(private env: SnowmakingEnv) {
    this.gainToday = new Float32Array(env.size * env.size);
    this.gainLast = new Float32Array(env.size * env.size);
  }

  /** The last run's stats for a cannon (undefined until it has run once / when it is not connected). */
  statsOf(id: number): CannonStats | undefined { return this.stats.get(id); }
  isRunning(id: number): boolean { return this.stats.get(id)?.state === 'running'; }
  runningIds(): number[] { const o: number[] = []; for (const [id, s] of this.stats) if (s.state === 'running') o.push(id); return o; }

  /** Is this cannon switched off by the player (itself or via the global Off mode)? Mothballed cannons pay reduced upkeep and use no energy or water. */
  isMothballed(id: number): boolean { return this.mode === 'off' || this.off.has(id); }
  isSwitchedOff(id: number): boolean { return this.off.has(id); }
  setCannon(id: number, on: boolean): void { if (on) this.off.delete(id); else this.off.add(id); this.version++; }
  /** Bulk: switch every given cannon on or off (the global mode is untouched; turning on also lifts a global Off). */
  setAll(ids: Iterable<number>, on: boolean): void {
    if (on && this.mode === 'off') this.mode = 'on';
    for (const id of ids) { if (on) this.off.delete(id); else this.off.add(id); }
    this.version++;
  }
  setMode(m: SnowmakingMode): void { this.mode = m; this.version++; }
  offCount(): number { return this.off.size; }
  /** Save data (undefined = defaults, so old and untouched saves stay byte-identical). */
  serializeState(): { mode: SnowmakingMode; off: number[] } | undefined {
    return this.mode === 'on' && this.off.size === 0 ? undefined : { mode: this.mode, off: [...this.off].sort((a, b) => a - b) };
  }
  loadState(d: { mode?: SnowmakingMode; off?: number[] } | undefined): void {
    this.mode = d?.mode && SNOWMAKING_MODES.includes(d.mode) ? d.mode : 'on';
    this.off = new Set(d?.off ?? []);
  }

  /** Output factor (0..1) at temperature `t` °C. */
  static tempFactor(t: number): number { return t <= SNOWMAKING.maxTemp ? 1 : t <= SNOWMAKING.wetBulbTemp ? SNOWMAKING.marginalRate : 0; }

  /** Run the cannons whose `id % phases === phase` for this hour (spreads work across the hour's ticks). */
  runPhase(ctx: HourCtx, phase: number, phases: number): void {
    if (phase === 0) { this.addedLastHour = 0; this.activeLastHour = 0; }
    const e = this.env, N = e.size, S = SNOWMAKING;
    const live = new Set<number>();
    for (const src of e.coverage.sources('snowmaking')) {
      live.add(src.id);
      if (src.id % phases !== phase) continue;
      let st = this.stats.get(src.id);
      if (!st) { st = { state: 'idle', tiles: 0, pisteTiles: 0, needy: 0, gainToday: 0, waterToday: 0, gainLast: 0, waterLast: 0 }; this.stats.set(src.id, st); }
      const auto = this.mode === 'auto';
      let n = 0, need = 0, tiles = 0, pisteTiles = 0, needy = 0, usable = 0, maxPisteAlt = -Infinity;
      const x0 = Math.max(0, Math.floor(src.cx - src.r)), x1 = Math.min(N - 1, Math.ceil(src.cx + src.r));
      const y0 = Math.max(0, Math.floor(src.cy - src.r)), y1 = Math.min(N - 1, Math.ceil(src.cy + src.r));
      const r2 = src.r * src.r, offR2 = S.offPisteRadius * S.offPisteRadius;
      const cap = (x1 - x0 + 1) * (y1 - y0 + 1);
      if (this.scratchIdx.length < cap) { this.scratchIdx = new Int32Array(cap); this.scratchAdd = new Float32Array(cap); }
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - src.cx, dy = y + 0.5 - src.cy, d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const i = y * N + x;
        if (e.skip?.(i)) continue;
        const piste = e.isPiste(i);
        if (!piste && d2 > offR2) continue;
        tiles++; if (piste) { pisteTiles++; if (auto) maxPisteAlt = Math.max(maxPisteAlt, e.altOf(x, y)); }
        const target = piste ? S.targetDepth : S.offPisteDepth;
        const d = e.snowDepth[i]!;
        if (d >= target) continue;
        needy++;
        const tf = Snowmaking.tempFactor(ctx.temp(e.altOf(x, y)));
        if (tf <= 0) continue;
        usable++;
        const fan = 1 - S.edgeFalloff * Math.sqrt(d2) / src.r;
        const add = Math.min(S.perHour * tf * fan * (piste ? 1 : S.offPisteRate), target - d);
        this.scratchIdx[n] = i; this.scratchAdd[n] = add; n++;
        need += add * 100 * S.waterPerTileCm;
      }
      st.tiles = tiles; st.pisteTiles = pisteTiles; st.needy = needy;
      if (this.mode === 'off' || this.off.has(src.id)) { st.state = 'off'; st.pause = undefined; continue; }
      if (tiles === 0) { st.state = 'noPiste'; continue; }
      if (needy === 0) { st.state = 'full'; st.pause = undefined; continue; }
      if (auto && e.snowline && e.dailyHigh) {
        const top = pisteTiles > 0 ? maxPisteAlt : e.altOf(Math.floor(src.cx), Math.floor(src.cy));
        const pause = pisteTiles > 0 && e.snowline() > top ? 'snowline' : e.dailyHigh(top) > S.autoMaxHigh ? 'warm' : undefined;
        if (pause) { st.state = 'paused'; st.pause = pause; continue; }
      }
      st.pause = undefined;
      if (usable === 0 || n === 0 || need <= 0) { st.state = 'warm'; continue; }
      const granted = e.reservoirs.consume(need);
      if (granted <= 0) { st.state = 'noWater'; continue; }
      const k = granted / need;
      let gain = 0;
      for (let j = 0; j < n; j++) {
        const a = this.scratchAdd[j]! * k, i = this.scratchIdx[j]!;
        e.addSnow(i, a); gain += a; this.gainToday[i]! += a;
      }
      this.addedLastHour += gain; this.version++;
      st.gainToday += gain; st.waterToday += granted; st.state = 'running';
      this.waterUsedTotal += granted;
      this.activeLastHour++;
      this.pendingEnergy += S.energyPerCannonHour + S.energyPerWaterUnit * granted;
    }
    for (const id of [...this.stats.keys()]) if (!live.has(id)) this.stats.delete(id);
  }

  /** Bill accumulated energy (daily). */
  flushCosts(): void {
    if (this.pendingEnergy > 0) { this.env.onCost?.('energy', Math.round(this.pendingEnergy)); this.pendingEnergy = 0; }
  }

  /** Midday roll (cannons are idle): what was made since the last roll becomes "last night". */
  rollNight(): void {
    this.gainLast.set(this.gainToday); this.gainToday.fill(0); this.version++;
    for (const st of this.stats.values()) { st.gainLast = st.gainToday; st.waterLast = st.waterToday; st.gainToday = 0; st.waterToday = 0; }
  }
}

export type CannonStatus = CannonState | 'noReservoir' | 'outOfPipe' | 'inactive';
export interface CannonInfo {
  status: CannonStatus;
  /** One-line headline for the inspector. */
  headline: string;
  tiles: number; pisteTiles: number;
  /** Average depth gained last night over the covered tiles (cm) and the water used (units). */
  gainCm: number; waterLast: number;
  reservoirs: number; level: number; capacity: number;
  /** Switched off by the player (this cannon) and the global mode, for the toggle. */
  switchedOff: boolean; mode: SnowmakingMode;
  /** Throw radius (piste) and off-piste radius, tiles. */
  radius: number; offPisteRadius: number;
}
export interface CannonInfoDeps {
  sm: Snowmaking;
  reservoirs: Reservoirs;
  /** Active reservoir buildings' centres (for the pipe-range check). */
  reservoirCentres: Array<{ x: number; y: number }>;
  pipeRange: number;
  /** Altitude of the cannon in metres and the temperature there now (°C). */
  altM: number;
  tempNow: number;
  /** Auto-pause messages: today's snowline in metres and the daily high at the cannon (°C). */
  snowlineM?: number;
  highNow?: number;
}
const fmtAlt = (m: number): string => Math.round(m).toLocaleString('en-US');

/** Plain-language state of one cannon building for the inspector (pure). `b` = footprint (tiles). */
export function cannonInfo(b: { id: number; x: number; y: number; w: number; h: number; active: boolean }, d: CannonInfoDeps): CannonInfo {
  const r = BUILDINGS.snowCannon?.serviceRadius ?? 10;
  const st = d.sm.statsOf(b.id);
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const base = { tiles: st?.tiles ?? 0, pisteTiles: st?.pisteTiles ?? 0, gainCm: st && st.tiles > 0 ? (100 * st.gainLast) / st.tiles : 0, waterLast: Math.round(st?.waterLast ?? 0), reservoirs: d.reservoirs.count, level: d.reservoirs.level(), capacity: d.reservoirs.capacity(), radius: r, offPisteRadius: SNOWMAKING.offPisteRadius };
  const mk = (status: CannonStatus, headline: string): CannonInfo => ({ status, headline, switchedOff: d.sm.isSwitchedOff(b.id), mode: d.sm.mode, ...base });
  if (!b.active) return mk('inactive', 'Inactive');
  if (d.reservoirCentres.length === 0) return mk('noReservoir', 'Not connected to a reservoir: build one within ' + d.pipeRange + ' tiles');
  if (!d.reservoirCentres.some((q) => Math.hypot(q.x - cx, q.y - cy) <= d.pipeRange)) return mk('outOfPipe', `Not connected to a reservoir: none within ${d.pipeRange} tiles`);
  if (d.sm.mode === 'off') return mk('off', 'Off: snowmaking is switched off (Operations)');
  if (d.sm.isSwitchedOff(b.id)) return mk('off', 'Off by you: mothballed, no energy or water, 15% upkeep');
  if (!st) return mk('idle', 'Idle: waiting for the next hourly check');
  switch (st.state) {
    case 'running': return mk('running', 'Running');
    case 'warm': if (d.sm.mode === 'auto') return mk('warm', `Auto: waiting for cold (needs ≤ ${SNOWMAKING.maxTemp} °C at ${fmtAlt(d.altM)} m; now ${d.tempNow.toFixed(1)} °C)`);
      return mk('warm', `Idle: too warm (needs ≤ ${SNOWMAKING.maxTemp} °C at ${fmtAlt(d.altM)} m; ${SNOWMAKING.wetBulbTemp} °C at half rate; now ${d.tempNow.toFixed(1)} °C)`);
    case 'paused': return st.pause === 'snowline'
      ? mk('paused', `Paused: snowline above this piste (${fmtAlt(d.snowlineM ?? 0)} m)`)
      : mk('paused', `Paused: too warm for snowmaking (daily high ${(d.highNow ?? d.tempNow).toFixed(1)} °C, Auto pauses above ${SNOWMAKING.autoMaxHigh} °C)`);
    case 'noWater': return mk('noWater', 'Idle: no water in the reservoir');
    case 'noPiste': return mk('noPiste', 'Out of range of piste: no piste or ground within reach');
    case 'full': return mk('full', 'Idle: snow base complete');
    default: return mk('idle', 'Idle');
  }
}
