import { ENERGY, GENERATORS, type GeneratorKind } from '../config/energy';
import type { SeasonId } from '../core/events';
import { sunrise, sunset, summerness } from './Daylight';

/** What the grid reads from the world (wired by createSim; plain data so tests can feed it directly). */
export interface EnergyEnv {
  /** Every placed building (generators are picked by type; `active` = connected + prerequisites met). */
  buildings(): ReadonlyArray<{ id: number; type: string; x: number; y: number; w: number; h: number; active: boolean }>;
  /** 0 = valley floor .. 1 = highest ground, at the footprint centre. */
  exposure(b: { x: number; y: number; w: number; h: number }): number;
  /** Snow depth (m) on the tile under the footprint centre. */
  snowDepth(x: number, y: number): number;
  weather(): { kind: string; intensity: number; wind: number; fog: number };
  /** Day of the (180-day) year, 0-based: drives the sun. */
  day(): number;
  season(): SeasonId;
  /** Tree counters (sustainability): the nursery credit never exceeds the net deficit. */
  felled(): number;
  planted(): number;
}

/** The grid's last settled day. All values are energy dollars (grid price); kWh = $ / `ENERGY.gridPricePerKwh`. */
export interface GridDay {
  /** Lift energy + snowmaking the resort would buy without any generator. */
  demand: number;
  /** Everything the generators made that day. */
  gross: number;
  /** What actually came off the bill (capped at `maxOffsetShare` x demand and at the lift energy line). */
  applied: number;
  /** gross - applied: not sold, lost. */
  wasted: number;
}

export interface GeneratorInfo {
  id: number; type: string; kind: GeneratorKind; active: boolean;
  /** Output right now, energy dollars per hour (0 when idle, shut or inactive). */
  ratePerHour: number;
  /** 0..1 of rated output right now. */
  fraction: number;
  today: number; yesterday: number;
  /** What this unit took off the bill yesterday (its share of the applied offset) and that as a share of the demand. */
  appliedYesterday: number; shareOfDemand: number;
  /** One short sentence about the state ('Shut down: storm', 'Snow on the panels', ...). */
  note: string;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const smooth = (t: number): number => { const x = clamp01(t); return x * x * (3 - 2 * x); };
const r2 = (n: number): number => Math.round(n * 100) / 100;

/** Is this building type a power generator? */
export const isGenerator = (type: string): boolean => type in GENERATORS;
export const kwh = (dollars: number): number => dollars / ENERGY.gridPricePerKwh;

/**
 * The resort energy grid. Generators (solar, wind, hydro, biomass) add energy dollars hour by hour (`hour`); once a day (`settleDay`, called by the
 * daily cost settlement) the total is capped and taken off the lift energy line. Surplus is wasted. With no generator every method is a cheap no-op
 * and `settleDay` returns 0, so a game without green buildings is bit-identical to one from before this system existed.
 * Also owns the timber stock of the biomass heating, the tree-nursery credit and the recycling bonus.
 */
export class Energy {
  private today = new Map<number, number>();
  private yesterday = new Map<number, number>();
  private appliedBy = new Map<number, number>();
  private rate = new Map<number, number>();
  private frac = new Map<number, number>();
  private notes = new Map<number, string>();
  private lastFelled = -1;
  /** Timber units in the biomass store. */
  stock = 0;
  /** Saplings credited as planted trees by nurseries (counted only against a net deficit). */
  nurseryCredit = 0;
  last: GridDay = { demand: 0, gross: 0, applied: 0, wasted: 0 };
  /** Lifetime energy dollars taken off the bill / wasted (statistics). */
  totalApplied = 0; totalWasted = 0;

  constructor(private readonly env: EnergyEnv) {}

  /** Active generators + the other green buildings, for quick checks. */
  generators(): Array<{ id: number; type: string; active: boolean }> { return this.env.buildings().filter((b) => isGenerator(b.type)).map((b) => ({ id: b.id, type: b.type, active: b.active })); }
  count(type: string, activeOnly = true): number { let n = 0; for (const b of this.env.buildings()) if (b.type === type && (b.active || !activeOnly)) n++; return n; }
  /** A solar / wind / hydro unit is working (the advisor stops suggesting green power). */
  hasRenewable(): boolean { return this.env.buildings().some((b) => b.active && isGenerator(b.type) && GENERATORS[b.type]!.kind !== 'biomass'); }

  /** Output factor 0..1 of a solar panel at `hour` (clock hour, the hour's midpoint is used) under today's sky. */
  solarFraction(hour: number, b: { x: number; y: number; w: number; h: number }): { fraction: number; note: string } {
    const S = ENERGY.solar, day = this.env.day(), t = hour + 0.5, sr = sunrise(day), ss = sunset(day);
    if (t <= sr || t >= ss) return { fraction: 0, note: 'Night' };
    const shape = Math.sin((Math.PI * (t - sr)) / (ss - sr));
    const tilt = S.winterTilt + (1 - S.winterTilt) * summerness(day);
    const alt = 1 + S.altitudeBonus * this.env.exposure(b);
    const w = this.env.weather();
    let sky: number, note = '';
    if (w.kind === 'clear') sky = S.clear;
    else if (w.kind === 'cloudy') { sky = S.cloudy; note = 'Cloudy'; }
    else if (w.kind === 'storm') { sky = S.storm; note = 'Storm'; }
    else { sky = w.intensity >= 1 ? S.heavy : S.precip; note = 'Rain or snow'; }
    if (w.fog >= 0.5) sky *= S.fog;
    const snowingNow = (w.kind === 'snow' || w.kind === 'heavySnow') && w.intensity > 0;
    const cx = b.x + (b.w >> 1), cy = b.y + (b.h >> 1);
    let snow = 1;
    if (snowingNow) { snow = S.snowing; note = 'Snow falling on the panels'; }
    else if (this.env.snowDepth(cx, cy) > S.snowDepthMin) { snow = S.snowCovered; note = 'Panels under snow'; }
    return { fraction: clamp01(shape * tilt * alt * sky * snow), note: note || 'Sunny' };
  }

  /** Output factor 0..1 of a wind turbine at `hour`; 0 above the cut-out (storm) or below the cut-in. */
  windFraction(hour: number, b: { x: number; y: number; w: number; h: number }): { fraction: number; note: string; shut: boolean } {
    const W = ENERGY.wind, w = this.env.weather();
    const gust = 1 + 0.1 * Math.sin(((hour - 14) / 24) * Math.PI * 2);
    const v = (W.base + W.altitude * this.env.exposure(b) + W.gain * w.wind) * gust;
    if (v > W.cutOut) return { fraction: 0, note: 'Shut down: storm winds', shut: true };
    if (v < W.cutIn) return { fraction: 0, note: 'Becalmed', shut: false };
    return { fraction: smooth((v - W.cutIn) / (W.rated - W.cutIn)), note: v >= W.rated ? 'Full output' : 'Turning', shut: false };
  }

  /** Flow factor 0..1+ of a small hydro today (season x a wet-weather bonus). */
  hydroFraction(): { fraction: number; note: string } {
    const H = ENERGY.hydro, w = this.env.weather(), season = this.env.season();
    const f = H.flow[season] * (1 + (w.intensity > 0 ? H.wet * Math.min(1, w.intensity) : 0));
    return { fraction: clamp01(f), note: season === 'winter' ? 'Low winter flow' : season === 'spring' ? 'Snow-melt flow' : 'Steady flow' };
  }

  /** Called every game hour: adds the hour's output of every active solar / wind / hydro unit to today's tally. */
  hour(hour: number): void {
    for (const b of this.env.buildings()) {
      const def = GENERATORS[b.type];
      if (!def) continue;
      if (!b.active) { this.rate.set(b.id, 0); this.frac.set(b.id, 0); this.notes.set(b.id, 'Not connected'); continue; }
      if (def.kind === 'biomass') continue;
      const r = def.kind === 'solar' ? this.solarFraction(hour, b) : def.kind === 'wind' ? this.windFraction(hour, b) : this.hydroFraction();
      const out = def.rated * r.fraction;
      this.today.set(b.id, (this.today.get(b.id) ?? 0) + out);
      this.rate.set(b.id, out); this.frac.set(b.id, r.fraction); this.notes.set(b.id, r.note);
    }
  }

  /** Rotor spin (rad/s) of a wind turbine for the view: 0 when idle or shut, 0.4..3 with the wind. */
  rotorSpeed(id: number): number {
    const f = this.frac.get(id) ?? 0;
    return f <= 0 ? ((this.notes.get(id) ?? '') === 'Becalmed' ? 0.2 : 0) : 0.5 + 2.5 * f;
  }

  /**
   * Day end. `demand` = the day's lift energy + snowmaking dollars, `liftLine` = the lift energy line the offset comes off. Returns the dollars to
   * subtract from the lift energy line (0 without generators). Also runs the daily parts: biomass burn, nursery sapling credit.
   */
  settleDay(demand: number, liftLine: number): number {
    const bs = this.env.buildings();
    const felled = this.env.felled();
    // biomass: timber from trees cleared since the last day + forestry residue, burned at a fixed rate
    const bio = bs.filter((b) => b.type === 'biomassHeating' && b.active);
    const delta = this.lastFelled < 0 ? 0 : Math.max(0, felled - this.lastFelled);
    this.lastFelled = felled;
    if (bio.length) {
      const B = ENERGY.biomass, n = bio.length;
      this.stock = Math.min(B.stockCap * n, this.stock + delta * B.perTree + B.residuePerDay * n);
      const burn = Math.min(this.stock, B.maxBurnPerDay * n);
      this.stock -= burn;
      for (const b of bio) { const out = (burn / n) * B.unitValue; this.today.set(b.id, (this.today.get(b.id) ?? 0) + out); this.rate.set(b.id, out / 24); this.frac.set(b.id, burn / (B.maxBurnPerDay * n)); this.notes.set(b.id, burn > 0 ? 'Burning timber' : 'Out of timber'); }
    } else this.stock = 0;
    // nursery: saplings count as planted trees only against a net deficit
    const nurseries = this.count('treeNursery');
    if (nurseries > 0) {
      const deficit = felled - this.env.planted() - this.nurseryCredit;
      if (deficit > 0) this.nurseryCredit = r2(Math.min(this.nurseryCredit + ENERGY.nursery.saplingsPerDay * nurseries, this.nurseryCredit + deficit));
    }

    let gross = 0;
    for (const v of this.today.values()) gross += v;
    const cap = ENERGY.maxOffsetShare * demand;
    const applied = Math.max(0, Math.min(gross, cap, liftLine));
    const ratio = gross > 0 ? applied / gross : 0;
    this.appliedBy.clear();
    for (const [id, v] of this.today) this.appliedBy.set(id, v * ratio);
    this.yesterday = this.today;
    this.today = new Map();
    this.last = { demand, gross, applied, wasted: gross - applied };
    this.totalApplied += applied; this.totalWasted += gross - applied;
    return applied;
  }

  /** Sustainability: flat bonus points while a recycling centre works. */
  recyclingBonus(): number { return this.count('recyclingCentre') > 0 ? ENERGY.recycling.bonusPoints : 0; }
  /** Scenery score taken off by the turbines on the skyline (0 without any; capped). */
  sceneryPenalty(): number { const n = this.count('windTurbine', false); return n > 0 ? Math.min(ENERGY.wind.sceneryCap, ENERGY.wind.sceneryEach * n) : 0; }
  /** Replanting price multiplier (a nursery makes saplings cheaper). */
  plantCostMult(): number { return this.count('treeNursery') > 0 ? ENERGY.nursery.plantCostShare : 1; }

  /** Inspector model of one generator (null for other buildings). */
  info(id: number): GeneratorInfo | null {
    const b = this.env.buildings().find((x) => x.id === id);
    const def = b && GENERATORS[b.type];
    if (!b || !def) return null;
    const applied = this.appliedBy.get(id) ?? 0;
    return {
      id, type: b.type, kind: def.kind, active: b.active,
      ratePerHour: this.rate.get(id) ?? 0, fraction: this.frac.get(id) ?? 0,
      today: this.today.get(id) ?? 0, yesterday: this.yesterday.get(id) ?? 0,
      appliedYesterday: applied, shareOfDemand: this.last.demand > 0 ? applied / this.last.demand : 0,
      note: b.active ? (this.notes.get(id) ?? 'Starting up') : 'Not connected',
    };
  }

  serialize(): unknown {
    const pairs = (m: Map<number, number>): Array<[number, number]> => [...m.entries()].sort((a, c) => a[0] - c[0]);
    return {
      t: pairs(this.today), y: pairs(this.yesterday), a: pairs(this.appliedBy), s: this.stock, c: this.nurseryCredit, f: this.lastFelled,
      l: { ...this.last }, ta: this.totalApplied, tw: this.totalWasted,
    };
  }
  load(d: unknown): void {
    const o = d as { t?: Array<[number, number]>; y?: Array<[number, number]>; a?: Array<[number, number]>; s?: number; c?: number; f?: number; l?: GridDay; ta?: number; tw?: number } | null;
    this.today = new Map(o?.t ?? []); this.yesterday = new Map(o?.y ?? []); this.appliedBy = new Map(o?.a ?? []);
    this.stock = o?.s ?? 0; this.nurseryCredit = o?.c ?? 0; this.lastFelled = o?.f ?? -1;
    this.last = o?.l ? { ...o.l } : { demand: 0, gross: 0, applied: 0, wasted: 0 };
    this.totalApplied = o?.ta ?? 0; this.totalWasted = o?.tw ?? 0;
    this.rate.clear(); this.frac.clear(); this.notes.clear(); // derived: rebuilt by the next hour
  }
  reset(): void { this.load(null); }
}
