import type { Grid } from '../world/Grid';
import { isWaterType } from '../world/Grid';
import type { GameState, GameDate } from '../core/GameState';
import type { GameBus, SeasonId, WeatherKind } from '../core/events';
import { Rng } from '../core/Rng';
import {
  CAL, DAYS_PER_YEAR, GAME_MINUTES_PER_TICK, HEIGHT_UNIT, MELT_M_PER_DEG_DAY, MINUTES_PER_DAY, PRECIP_COOLING, RAIN_MELT_M, RESERVOIR_CAPACITY,
  RESERVOIR_REFILL_PER_DAY, SNOWFALL_M, SNOWFALL_MAX_TEMP, SNOWMAKING_M_PER_DAY, SNOWMAKING_MAX_DEPTH, SNOWMAKING_MAX_TEMP,
  SNOWMAKING_WATER_PER_M, SNOW_MAX_DEPTH, TEMP_ANOMALY_DECAY, TEMP_ANOMALY_SD, TEMP_DAILY_SWING, TEMP_PER_RELIEF,
} from '../config/balance';
import type { SimSystem } from './Systems';
import { seasonOf } from './Clock';
import { seasonalValleyTemp, snowlineHeight, temperatureAtAltitude, type WorldScale } from './Season';
import type { TileConditions } from './TileConditions';

export type { WeatherKind };
export type Precip = 'none' | 'snow' | 'rain';

/** Weather of one in-game day (constant over the day; hourly temperature adds a swing on top). */
export interface DayWeather {
  kind: WeatherKind;
  /** 0 = dry, 0.5 light, 1 heavy, 1.2 storm. */
  intensity: number;
  /** Daily-mean valley-floor temperature, °C (includes spells and precipitation cooling). */
  valleyT: number;
  /** Effective snowline in world units (seasonal curve + warm/cold spell + precipitation cooling). */
  snowline: number;
  wind: number;
  fog: number;
}

const SEASON_WET: Record<SeasonId, number> = { winter: 0.36, spring: 0.36, summer: 0.24, autumn: 0.36 };

/** Gaussian-ish noise from three uniforms (deterministic, rng-only). */
const noise = (r: Rng): number => (r.next() + r.next() + r.next() - 1.5) * 2;

/** Daily weather state machine. Seeded own RNG (never Math.random); serialisable. */
export class Weather {
  current: DayWeather;
  private anomaly = 0;
  /** Scenario modifier (>= 0): 0 = normal; > 0 makes wet days more likely and heavy ones more common (RNG draws are unchanged, only thresholds move). */
  harsh = 0;
  private rng: Rng;
  private lastDay = -1;

  constructor(readonly seed: number, readonly scale: WorldScale, date?: GameDate) {
    this.rng = new Rng((this.seed ^ 0x57ea7e3) >>> 0);
    this.current = { kind: 'clear', intensity: 0, valleyT: 0, snowline: scale.baseWorld, wind: 0, fog: 0 };
    if (date) this.rollDay(date);
  }

  /** Roll a new day. Returns the previous kind. */
  rollDay(date: GameDate): WeatherKind {
    const prev = this.current.kind;
    const r = this.rng;
    this.lastDay = date.year * 1000 + date.day;
    this.anomaly = this.anomaly * TEMP_ANOMALY_DECAY + noise(r) * TEMP_ANOMALY_SD * Math.sqrt(1 - TEMP_ANOMALY_DECAY * TEMP_ANOMALY_DECAY);
    const base = seasonalValleyTemp({ day: date.day, minute: 0 }) + this.anomaly;
    const wasWet = this.current.intensity > 0;
    const pWet = Math.min(0.85, SEASON_WET[seasonOf(date)] * (wasWet ? 1.7 : 1) * (1 + 0.5 * this.harsh));
    const u = r.next();
    let kind: WeatherKind, intensity = 0;
    if (u < pWet) {
      const heavy = r.chance(Math.min(0.9, 0.3 * (1 + this.harsh)));
      const cold = base < 1;
      if (cold) { kind = heavy ? 'heavySnow' : 'snow'; intensity = heavy ? 1 : 0.5; }
      else if (heavy && base > 10 && r.chance(0.45)) { kind = 'storm'; intensity = 1.2; }
      else { kind = 'rain'; intensity = heavy ? 1 : 0.5; }
    } else if (u < pWet + 0.3) { kind = 'cloudy'; } else { kind = 'clear'; }
    const cooling = intensity > 0 ? PRECIP_COOLING : kind === 'cloudy' ? 0.5 : 0;
    const valleyT = base - cooling;
    const fog = intensity === 0 && base < 4 && r.chance(0.12) ? 0.6 : kind === 'cloudy' ? 0.15 : 0;
    this.current = {
      kind, intensity, valleyT,
      snowline: snowlineHeight({ day: date.day, minute: 0 }, this.scale, this.anomaly - cooling),
      wind: kind === 'storm' ? 1 : r.next() * 0.35, fog,
    };
    return prev;
  }

  get dayKey(): number { return this.lastDay; }

  /** Valley temperature at an hour of day (daily swing peaks around 15:00). */
  valleyTempAt(hour: number): number { return this.current.valleyT + TEMP_DAILY_SWING * Math.sin(((hour - 9) / 24) * Math.PI * 2); }
  /** Temperature at altitude (world y), daily mean unless `hour` given. */
  temperatureAt(worldY: number, hour?: number): number {
    return temperatureAtAltitude(hour === undefined ? this.current.valleyT : this.valleyTempAt(hour), worldY, this.scale);
  }
  /** What falls at the valley floor today. */
  precipAtValley(): Precip {
    const c = this.current;
    if (c.intensity === 0) return 'none';
    return c.kind === 'snow' || c.kind === 'heavySnow' ? 'snow' : 'rain';
  }
  /** Is it snowing at altitude (world y) today? */
  snowingAt(worldY: number): boolean { return this.current.intensity > 0 && this.temperatureAt(worldY) <= SNOWFALL_MAX_TEMP; }

  serialize(): { rng: number; anomaly: number; current: DayWeather; lastDay: number } {
    return { rng: this.rng.getState(), anomaly: this.anomaly, current: { ...this.current }, lastDay: this.lastDay };
  }
  load(d: { rng: number; anomaly: number; current: DayWeather; lastDay: number }): void {
    this.rng.setState(d.rng); this.anomaly = d.anomaly; this.current = { ...d.current }; this.lastDay = d.lastDay;
  }
}

/** Water supply used by the daily snowmaking hook. Implemented by the simple `WaterStock` and by `sim/ops/Snowmaking` `Reservoirs`. */
export interface WaterSupply {
  has(): boolean;
  /** Draw up to `amount`; returns what was actually granted. */
  consume(amount: number): number;
  /** Optional daily refill (real reservoirs are refilled by the ops system instead). */
  refill?(): void;
}

/** Simple shared water counter that refills daily (legacy / tests; the game uses ops `Reservoirs`). */
export class WaterStock implements WaterSupply {
  level = RESERVOIR_CAPACITY;
  constructor(public capacity = RESERVOIR_CAPACITY, public refillPerDay = RESERVOIR_REFILL_PER_DAY) {}
  refill(): void { this.level = Math.min(this.capacity, this.level + this.refillPerDay); }
  has(): boolean { return this.level > 0; }
  consume(amount: number): number { const g = Math.min(this.level, Math.max(0, amount)); this.level -= g; return g; }
}

/** Stateless per-(tile, day) hash in [0,1) (keeps the snow model deterministic without consuming the RNG). */
export function hash01(i: number, d: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(d + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/**
 * Per-tile melt multiplier: north-facing (downhill toward -y) tiles melt slower, south-facing faster, and high tiles are colder
 * (slower). 0.5..1.4.
 */
export function meltFactor(grid: Grid, x: number, y: number, altFrac: number): number {
  const [n, e, s, w] = grid.getCorners(x, y);
  const gy = (w + s - n - e) / 2; // height rises toward +y => downhill faces -y (north)
  const shade = Math.max(-1, Math.min(1, gy / 1.5));
  return Math.max(0.5, Math.min(1.4, (1 - 0.3 * shade) * (1 - 0.25 * Math.max(0, Math.min(1, altFrac)))));
}

/** Days of weather the instant settle simulates before the target date. */
export const SETTLE_LEAD_DAYS = Math.round(24 * CAL);

export interface SnowOptions {
  /** Snowmaking coverage map (Coverage.map('snowmaking')); null = none. */
  snowmaking?: () => Uint8Array | null;
  water?: WaterSupply;
}

/** Daily per-tile snow model, time-sliced by rows. */
export class SnowCover {
  readonly water: WaterSupply;
  /** Count of tiles whose depth changed in the last row update (perf/debug). */
  changedLast = 0;
  /** Scenario modifier: multiplier on daily snowfall depth (1 = normal). */
  snowfallMult = 1;

  constructor(readonly grid: Grid, readonly cond: TileConditions, readonly weather: Weather, private opts: SnowOptions = {}) {
    this.water = opts.water ?? new WaterStock();
  }

  /** Set depths from the seasonal snowline (new game): snow above the line, none below. */
  seed(date: GameDate): void {
    const sc = this.weather.scale, line = snowlineHeight(date, sc);
    const N = this.grid.size, g = this.grid;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x;
      if (isWaterType(g.tileType[i]!)) { g.snowDepth[i] = 0; continue; }
      const alt = this.cond.altitude(x, y);
      g.snowDepth[i] = alt >= line ? Math.min(SNOW_MAX_DEPTH, 0.5 + (1.5 * (alt - line)) / sc.reliefWorld) : 0;
    }
    this.cond.syncAll();
    for (let cy = 0; cy < N; cy += 32) for (let cx = 0; cx < N; cx += 32) g.markSnowDirty(cx, cy);
  }

  /**
   * Instantly settle every tile's snow depth to what the model gives for `date`: seed from the seasonal snowline `lead` days earlier and
   * run the daily model forward on a scratch Weather (own RNG stream, so the result depends only on seed + date, never on history).
   * Snowmaking is not applied (it resumes with the live sim). Marks every chunk snow-dirty and re-syncs tile conditions.
   */
  settle(date: Pick<GameDate, 'year' | 'day' | 'minute'>, lead = SETTLE_LEAD_DAYS): void {
    const sc = this.weather.scale;
    const startDay = (((date.day - lead) % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR;
    const d0: GameDate = { year: date.year, day: startDay, minute: 0, tick: 0 };
    const scratch = new Weather((this.weather.seed ^ 0x5e771e) >>> 0, sc, d0);
    const tmp = new SnowCover(this.grid, this.cond, scratch, {});
    tmp.seed(d0);
    for (let i = 0; i < lead; i++) {
      tmp.stepDay(d0.year * 1000 + d0.day);
      d0.day = (d0.day + 1) % DAYS_PER_YEAR;
      scratch.rollDay(d0);
    }
    this.cond.syncAll();
    this.grid.markAllSnowDirty();
  }

  /** Add (or remove, negative) snow on tile `i` (ops snowmaking); keeps conditions + terrain dirty tracking in sync. */
  addSnow(i: number, depth: number): void {
    const g = this.grid, old = g.snowDepth[i]!;
    const d = Math.min(SNOW_MAX_DEPTH, Math.max(0, old + depth));
    if (d === old) return;
    g.snowDepth[i] = d;
    if (Math.abs(d - old) > 0.004) g.markSnowDirty(i % g.size, (i / g.size) | 0);
    this.cond.refreshTile(i);
  }

  /** Apply today's snowfall / melt / snowmaking to rows [y0, y1). */
  updateRows(y0: number, y1: number, dayIndex: number): void {
    const g = this.grid, N = g.size, sc = this.weather.scale, wc = this.weather.current;
    const lapse = TEMP_PER_RELIEF / sc.reliefWorld;
    const snowmaking = this.opts.snowmaking?.() ?? null;
    let changed = 0;
    for (let y = Math.max(0, y0); y < Math.min(N, y1); y++) {
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        if (isWaterType(g.tileType[i]!)) continue;
        const [n, e, s, w] = g.getCorners(x, y);
        const alt = ((n + e + s + w) / 4) * HEIGHT_UNIT;
        const rel = (alt - sc.baseWorld) / sc.reliefWorld;
        const T = wc.valleyT - lapse * (alt - sc.baseWorld);
        const old = g.snowDepth[i]!;
        let d = old;
        if (wc.intensity > 0) {
          if (T <= SNOWFALL_MAX_TEMP) d += SNOWFALL_M * this.snowfallMult * wc.intensity * (1 + 0.5 * Math.max(0, rel));
          else if (d > 0 && (wc.kind === 'rain' || wc.kind === 'storm')) d -= RAIN_MELT_M * wc.intensity;
        }
        if (T > 0 && d > 0) d -= MELT_M_PER_DEG_DAY * T * meltFactor(g, x, y, rel) * (0.9 + 0.2 * hash01(i, dayIndex));
        if (snowmaking && snowmaking[i]! > 0 && T < SNOWMAKING_MAX_TEMP && d < SNOWMAKING_MAX_DEPTH && this.water.has()) {
          const add = Math.min(SNOWMAKING_M_PER_DAY, SNOWMAKING_MAX_DEPTH - d);
          d += add;
          this.water.consume(add * SNOWMAKING_WATER_PER_M);
        }
        d = Math.min(SNOW_MAX_DEPTH, Math.max(0, d));
        if (d !== old) {
          g.snowDepth[i] = d;
          changed++;
          if (Math.abs(d - old) > 0.004) g.markSnowDirty(x, y);
        }
        this.cond.refreshTile(i);
      }
    }
    this.changedLast = changed;
  }

  /** Whole-map update for one day (tests / catch-up). Equivalent to the union of all row slices. */
  stepDay(dayIndex: number): void { this.updateRows(0, this.grid.size, dayIndex); this.water.refill?.(); }

  /** FNV-1a over the snow depth array bits (determinism tests / stateHash). */
  hash(): string {
    const a = new Uint32Array(this.grid.snowDepth.buffer, this.grid.snowDepth.byteOffset, this.grid.snowDepth.length);
    let h = 0x811c9dc5;
    for (let i = 0; i < a.length; i++) { h ^= a[i]!; h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
  }
}

export interface WeatherSystemOptions {
  bus?: GameBus;
  /** Called once at the start of each in-game day, after the day's weather rolled (OpenStatus evaluation hooks here). */
  onDay?: (date: GameDate) => void;
}

const TICKS_PER_DAY = MINUTES_PER_DAY / GAME_MINUTES_PER_TICK;

/**
 * 'weather' system: rolls the day's weather at each new day (emits weather:changed on change), then spreads the snow update
 * over the day's ticks (rows proportional to the tick of day) so large maps stay within the per-tick budget.
 */
export function createWeatherSystem(weather: Weather, snow: SnowCover, opts: WeatherSystemOptions = {}): SimSystem & { resync(): void } {
  let lastDay = -1;
  let lastRow = 0;
  return {
    id: 'weather',
    update: (state: GameState) => {
      const date = state.date;
      const key = date.year * 1000 + date.day;
      const N = snow.grid.size;
      const tickOfDay = Math.floor(date.minute / GAME_MINUTES_PER_TICK);
      if (key !== lastDay) {
        // finish any rows left from the previous day so the model never skips tiles
        if (lastDay >= 0 && lastRow < N) snow.updateRows(lastRow, N, lastDay);
        const alreadyRolled = lastDay === -1 && weather.dayKey === key; // constructed with this date
        const prev = alreadyRolled ? weather.current.kind : weather.rollDay(date);
        lastDay = key;
        lastRow = 0;
        snow.water.refill?.();
        const c = weather.current;
        if (c.kind !== prev) {
          opts.bus?.emit('weather:changed', {
            kind: c.kind, previous: prev, temperature: c.valleyT, snowline: c.snowline,
            precipitation: weather.precipAtValley(),
          });
        }
        opts.onDay?.(date);
      }
      const target = Math.min(N, Math.floor(((tickOfDay + 1) * N) / TICKS_PER_DAY));
      if (target > lastRow) { snow.updateRows(lastRow, target, key); lastRow = target; }
    },
    /** After a date jump + `weather.rollDay(newDate)`: continue the day-slice from the top without re-rolling. */
    resync: () => { lastDay = -1; lastRow = 0; },
    serialize: () => ({ weather: weather.serialize(), lastDay, lastRow }),
    load: (d) => {
      const s = d as { weather: ReturnType<Weather['serialize']>; lastDay: number; lastRow: number };
      weather.load(s.weather); lastDay = s.lastDay; lastRow = s.lastRow;
    },
  };
}

