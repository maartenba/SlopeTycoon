import type { GameState } from '../../core/GameState';
import type { GameBus } from '../../core/events';
import { DAYS_PER_YEAR } from '../../config/balance';
import { hourOfDay, seasonOf } from '../Clock';
import { nightWindow } from '../Daylight';
import type { Coverage, CoverageBuilding } from '../Coverage';
import type { SnowCover, Weather } from '../Weather';
import type { SimSystem } from '../Systems';
import type { TileConditions } from '../TileConditions';
import { PisteQuality, PQ, type HourCtx, type PisteNetworkLike } from './PisteQuality';
import { Grooming } from './Grooming';
import { Reservoirs, Snowmaking, type OpsCostCategory } from './Snowmaking';
import { isWaterType, type Grid } from '../../world/Grid';
import type { Safety } from './Safety';

export * from './PisteQuality';
export * from './Grooming';
export * from './Snowmaking';
export * from './Incidents';
export * from './Patrol';
export * from './Heli';
export * from './Avalanche';
export * from './Wildlife';
export * from './Safety';

export interface OpsOptions {
  grid: Grid;
  cond: TileConditions;
  weather: Weather;
  snow: SnowCover;
  coverage: Coverage;
  net: PisteNetworkLike;
  buildings: () => Iterable<CoverageBuilding>;
  bus?: Pick<GameBus, 'emit'>;
  /** Shared reservoir store (so Weather's snowmaking hook and ops use the same water). */
  reservoirs?: Reservoirs;
  /** Running-cost sink (wired to the economy in main.ts): energy (snowmaking), fuel + wages (snowcats). */
  onCost?: (category: OpsCostCategory, amount: number) => void;
}

export interface Ops {
  system: SimSystem;
  quality: PisteQuality;
  grooming: Grooming;
  snowmaking: Snowmaking;
  reservoirs: Reservoirs;
  /** Attach the safety bundle (incidents, patrol, heli, avalanche, wildlife); it then steps after grooming. */
  attachSafety(s: Safety): void;
  safety: Safety | null;
  /** Re-evaluate piste quality for every tile right now (after a date jump + snow settle) and realign the hourly/row cursors. */
  settle(state: GameState): void;
}

const b64 = (a: Uint8Array): string => { let s = ''; for (let i = 0; i < a.length; i += 8192) s += String.fromCharCode(...a.subarray(i, i + 8192)); return btoa(s); };
const unb64 = (s: string, out: Uint8Array): void => { const r = atob(s); for (let i = 0; i < out.length && i < r.length; i++) out[i] = r.charCodeAt(i); };

/** Builds the ops model (piste quality, snowmaking, grooming) and its 'ops' system. */
export function createOps(o: OpsOptions): Ops {
  const N = o.grid.size, weather = o.weather;
  const quality = new PisteQuality(N, o.net, o.grid.snowDepth, (x, y) => o.cond.altitude(x, y));
  quality.attachTraffic();
  const reservoirs = o.reservoirs ?? new Reservoirs();
  const snowmaking = new Snowmaking({
    size: N, coverage: o.coverage, reservoirs, isPiste: (i) => quality.isPiste(i), skip: (i) => isWaterType(o.grid.tileType[i]!), snowDepth: o.grid.snowDepth,
    altOf: (x, y) => o.cond.altitude(x, y), addSnow: (i, d) => o.snow.addSnow(i, d), onCost: o.onCost,
    snowline: () => weather.current.snowline, dailyHigh: (alt) => weather.temperatureAt(alt, 15),
  });
  const grooming = new Grooming({
    size: N, quality, coverage: o.coverage, snowDepth: o.grid.snowDepth, buildings: o.buildings, onCost: o.onCost,
    onNight: (r) => o.bus?.emit('ops:grooming', r),
  });

  let safety: Safety | null = null;
  let ctx: HourCtx | null = null;
  let lastStamp = -1, lastDay = -1, lastRow = 0;
  const makeCtx = (stamp: number, hour: number): HourCtx => ({
    stamp, hour, clear: weather.current.kind === 'clear',
    temp: (alt) => weather.temperatureAt(alt, hour),
    snowing: (alt) => weather.snowingAt(alt),
  });

  const system: SimSystem = {
    id: 'ops',
    update: (state: GameState, tick: number) => {
      const d = state.date;
      const hour = hourOfDay(d), hi = Math.floor(hour);
      const absDay = d.year * DAYS_PER_YEAR + d.day, stamp = absDay * 24 + hi;
      const tickInHour = Math.min(PQ.ticksPerHour - 1, Math.floor((d.minute % 60) / 6));
      if (stamp !== lastStamp) {
        if (ctx && lastRow < N) quality.updateRows(lastRow, N, ctx);
        ctx = makeCtx(stamp, hi + 0.5);
        lastStamp = stamp; lastRow = 0;
        reservoirs.sync(o.buildings());
        if (hi === 12) snowmaking.rollNight();
        if (absDay !== lastDay) {
          if (lastDay >= 0) reservoirs.refillDay(seasonOf(d), weather.current);
          snowmaking.flushCosts();
          quality.trafficDay.fill(0);
          lastDay = absDay;
        }
      }
      const target = Math.min(N, Math.floor(((tickInHour + 1) * N) / PQ.ticksPerHour));
      if (ctx && target > lastRow) { quality.updateRows(lastRow, target, ctx); lastRow = target; }
      if (ctx) snowmaking.runPhase(ctx, tickInHour, PQ.ticksPerHour);
      grooming.update(absDay, hour, nightWindow(d.day));
      safety?.update({ tick, hour, tickInHour, day: absDay });
    },
    serialize: () => ({
      tr: b64(new Uint8Array(quality.traffic.buffer, quality.traffic.byteOffset, quality.traffic.byteLength)), td: b64(new Uint8Array(quality.trafficDay.buffer, quality.trafficDay.byteOffset, quality.trafficDay.byteLength)),
      q: b64(quality.state), w: b64(new Uint8Array(quality.wear.buffer, quality.wear.byteOffset, quality.wear.byteLength)), res: reservoirs.serialize(),
      groom: grooming.serialize(), safety: safety?.serialize(), lastStamp, lastDay, lastRow, pe: snowmaking.pendingEnergy, sm: snowmaking.serializeState(),
    }),
    load: (data) => {
      const s = data as { tr?: string; td?: string; q: string; w: string; res: Array<[number, number, number]>; groom: unknown; safety?: unknown; lastStamp: number; lastDay: number; lastRow: number; pe?: number; sm?: { mode?: 'on' | 'off' | 'auto'; off?: number[] } };
      snowmaking.loadState(s.sm);
      snowmaking.pendingEnergy = s.pe ?? 0; // energy not yet billed (flushed at midnight): was lost on load, which made a mid-day save/load differ from a live game
      unb64(s.q, quality.state); unb64(s.w, new Uint8Array(quality.wear.buffer, quality.wear.byteOffset, quality.wear.byteLength));
      if (s.tr) unb64(s.tr, new Uint8Array(quality.traffic.buffer, quality.traffic.byteOffset, quality.traffic.byteLength));
      if (s.td) unb64(s.td, new Uint8Array(quality.trafficDay.buffer, quality.trafficDay.byteOffset, quality.trafficDay.byteLength));
      reservoirs.load(s.res); grooming.load(s.groom); if (s.safety) safety?.load(s.safety); lastStamp = s.lastStamp; lastDay = s.lastDay; lastRow = s.lastRow;
      ctx = null; quality.version++;
    },
  };
  const ops: Ops = {
    system, quality, grooming, snowmaking, reservoirs, safety: null, attachSafety: (x) => { safety = x; ops.safety = x; },
    settle: (state) => {
      const d = state.date, hour = hourOfDay(d), hi = Math.floor(hour), absDay = d.year * DAYS_PER_YEAR + d.day, stamp = absDay * 24 + hi;
      ctx = makeCtx(stamp, hi + 0.5);
      quality.updateRows(0, N, ctx);
      lastStamp = stamp; lastDay = absDay; lastRow = N;
      quality.version++;
    },
  };
  return ops;
}
