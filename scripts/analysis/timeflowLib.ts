/**
 * Time-flow analysis library (docs/time-flow.md). Sim-only, no gameplay change.
 *
 * KEY EQUIVALENCE used by the prototypes: the sim only sees ticks, and every per-tick constant is expressed in game time
 * (1 tick = 6 game minutes at 240 ticks/day). A model "day = D real seconds at 1x" with the SAME 240 ticks/day therefore differs from the
 * current game only in (a) real seconds per tick (= D/240: pure pacing, sim untouched) and (b) agent speeds in tiles/tick. A model that uses
 * more ticks per day (TICKS_PER_DAY x10) is, at the level of game time, the same as the 240-tick sim with speeds scaled in tiles/tick.
 * So a model is {D, speed multipliers on NAV_SPEED, vehicle trip cap, lift seconds per tick}; on-screen tiles/s = tiles/tick x 240 / D.
 */
import { NAV_SPEED, WALK_SPEED_BY_SIZE, TICKS_PER_DAY, TILE_METRES, GAME_MINUTES_PER_TICK, LIFT_SECONDS_PER_TICK, SPEED_MULTIPLIERS, REAL_SECONDS_PER_DAY_1X, DAYS_PER_YEAR, DAYS_PER_MONTH } from '../../src/config/balance';
import { LIFTS } from '../../src/config/lifts';
import { VEHICLE_SPEED, VEHICLE_MAX_TRIP_TICKS, VEHICLE_MAX_ROUTE_TILES } from '../../src/sim/guests/Arrivals';
import { PATROL } from '../../src/sim/ops/Patrol';
import { HELI } from '../../src/sim/ops/Heli';
import { GROOM } from '../../src/sim/ops/Grooming';
import { FAUNA } from '../../src/sim/nature/Fauna';
import { GState } from '../../src/sim/guests/Guest';
import { NavMode } from '../../src/sim/guests/NavGraph';
import type { Sim } from '../../src/game/createSim';
import { buildSkiResort } from './skiLib';

export type Size = 64 | 128 | 256;

/** Real-second length of a game day at 1x for the current game (150 s since the time-flow change; the analysed M0 model is the old 24 s game). */
export const CURRENT_DAY_S = REAL_SECONDS_PER_DAY_1X;
/** The pre-change (24 s day) NAV_SPEED in tiles/tick: model multipliers are relative to this baseline. */
export const M0_NAV = { walk: 9, hike: 0.4, bike: 1.4, skiBase: 13.2, skiFlat: 3 } as const;
export const CURRENT_TICKS_PER_S = TICKS_PER_DAY / CURRENT_DAY_S;

/** Comfortable on-screen speeds in tiles/s at 1x (at 40-60 px/tile: 2 t/s = ~100 px/s = a brisk but readable walk; >6-8 t/s reads as teleporting). */
export const COMFORT = {
  walk: 2, hike: 1.5, bike: 4, ski: { green: 4, blue: 6, red: 8, black: 10 }, car: 8, bus: 6, train: 12, plane: 20,
  patrolSled: 8, patrolWalker: 2, heli: 15, snowcat: 3, animal: 1.5, lift: { tbar: 2, chair: 3, gondola: 4, cable: 6, funi: 4 },
} as const;
export const REALISTIC_MPS = { walk: 1.4, hike: 1.1, bike: 5, ski: [5, 15], chairlift: [1.2, 2.5], gondola: 6, cablecar: 10, car: [10, 20], bus: 12, train: [20, 30], plane: 70, heli: 60, snowcat: 4, sled: 12, animal: [0.5, 5] } as const;

export interface SpeedRow { what: string; tilesPerTick: number | null; tilesPerS1x: number; mps1x: number; real: string; comfort: string; ratio: number }

/** Static catalogue: speeds as they are encoded in src/ today, expressed on screen at 1x (10 ticks/s) and 3x (the 4x rate). */
export function speedCatalog(ticksPerS = CURRENT_TICKS_PER_S): SpeedRow[] {
  const row = (what: string, tpt: number | null, tps: number, real: string, comfort: number | string, ratio?: number): SpeedRow => ({
    what, tilesPerTick: tpt, tilesPerS1x: tps, mps1x: tps * TILE_METRES, real, comfort: String(comfort), ratio: ratio ?? (typeof comfort === 'number' ? tps / comfort : NaN),
  });
  const t = (tpt: number, c: number | string, what: string, real: string): SpeedRow => row(what, tpt, tpt * ticksPerS, real, c);
  const out: SpeedRow[] = [];
  out.push(t(NAV_SPEED.walk, COMFORT.walk, 'Guest walking (paths)', '1.4 m/s'));
  out.push(t(NAV_SPEED.walk * 0.8, COMFORT.walk, 'Guest on piste, no slope (walk 0.8x)', '1.4 m/s'));
  out.push(t(NAV_SPEED.hike, COMFORT.hike, 'Hiker off path (trail)', '1.1 m/s'));
  out.push(t(NAV_SPEED.bike, COMFORT.bike, 'Biker downhill (off path)', '5 m/s'));
  out.push(t(NAV_SPEED.bike * 0.6, COMFORT.bike, 'Biker on path', '5 m/s'));
  out.push(t(NAV_SPEED.skiFlat, COMFORT.ski.green, 'Skier on flat', '1-3 m/s'));
  // skier speed = skiBase x (0.8 + 0.07 skill) x (0.6 + min(1, drop*4) x 0.6) x quality: slow / typical / max
  const skiAt = (skill: number, drop: number): number => NAV_SPEED.skiBase * (0.8 + 0.07 * skill) * (0.6 + Math.min(1, drop * 4) * 0.6);
  out.push(t(skiAt(0, 0.05), COMFORT.ski.green, 'Skier beginner, gentle slope (green)', '5-15 m/s'));
  out.push(t(skiAt(1, 0.12), COMFORT.ski.blue, 'Skier intermediate, medium slope (blue)', '5-15 m/s'));
  out.push(t(skiAt(2, 0.2), COMFORT.ski.red, 'Skier advanced, steep (red)', '5-15 m/s'));
  out.push(t(skiAt(3, 0.3), COMFORT.ski.black, 'Skier expert, very steep (black)', '5-15 m/s'));
  // vehicles: v.speed (tiles/tick) = max(base, remaining/6) with remaining <= 30 tiles
  const names = ['Car', 'Bus', 'Train', 'Plane'] as const, comf = [COMFORT.car, COMFORT.bus, COMFORT.train, COMFORT.plane];
  const real = ['10-20 m/s', '12 m/s', '20-30 m/s', '70 m/s'];
  VEHICLE_SPEED.forEach((b, k) => {
    out.push(t(b, comf[k]!, `${names[k]} base speed (never used on long routes)`, real[k]!));
    out.push(t(VEHICLE_MAX_ROUTE_TILES / VEHICLE_MAX_TRIP_TICKS, comf[k]!, `${names[k]} actual, 30-tile approach in 6 ticks`, real[k]!));
  });
  out.push(t(PATROL.sledSpeed, COMFORT.patrolSled, 'Patrol sled (piste)', '12 m/s'));
  out.push(t(PATROL.walkerSpeed, COMFORT.patrolWalker, 'Patrol walker', '1.4 m/s'));
  out.push(t(HELI.speed, COMFORT.heli, 'Rescue helicopter', '60 m/s'));
  out.push(t(GROOM.groomSpeed, COMFORT.snowcat, 'Snowcat grooming', '4 m/s'));
  out.push(t(GROOM.driveSpeed, COMFORT.snowcat * 2, 'Snowcat driving', '8 m/s'));
  out.push(t(0.11, COMFORT.animal, 'Deer walking (fauna)', '1.5 m/s'));
  out.push(t(0.11 * 2.2, COMFORT.animal * 3, 'Deer fleeing', '10 m/s'));
  void FAUNA;
  // lift carriers: animated in REAL time by the renderer (phase += dt * LIFTS[kind].speed): independent of game speed
  const liftComfort = (k: string): number => (k === 'tbar' ? COMFORT.lift.tbar : k === 'chair' ? COMFORT.lift.chair : k === 'gondola' ? COMFORT.lift.gondola : k === 'funicular' ? COMFORT.lift.funi : COMFORT.lift.cable);
  const realL = (k: string): string => (k === 'tbar' ? '2-3 m/s' : k === 'chair' ? '1.2-2.5 m/s' : k === 'gondola' ? '6 m/s' : k === 'funicular' ? '10 m/s' : '10 m/s');
  for (const [id, d] of Object.entries(LIFTS)) out.push(row(`Lift carrier ${id} (render, real time)`, null, d.speed, realL(d.family), liftComfort(d.family)));
  return out;
}

/** Game-time budget of the clock: how much game time one real second shows. */
export function clockMaths(daySeconds: number): { gameHoursPerRealS: number; gameMinPerRealS: number; walkTilesPerS: number; skiTilesPerS: number; chairTilesPerS: number } {
  const gameSecPerRealS = 86400 / daySeconds;
  // realistic speeds expressed in tiles per REAL second if the clock were honest
  return { gameHoursPerRealS: gameSecPerRealS / 3600, gameMinPerRealS: gameSecPerRealS / 60, walkTilesPerS: (1.4 * gameSecPerRealS) / TILE_METRES, skiTilesPerS: (10 * gameSecPerRealS) / TILE_METRES, chairTilesPerS: (2 * gameSecPerRealS) / TILE_METRES };
}

// ------------------------------------------------------------------------------------------------------------------------------------------
// Models

export interface Model {
  id: string; label: string;
  /** Real seconds per game day at 1x. */
  daySeconds: number;
  /** Multipliers on today's NAV_SPEED (tiles/tick in a 240-tick day). */
  walk: number; hike: number; bike: number; ski: number;
  /** True = the game as implemented now (NAV_SPEED / per-size walk untouched; multipliers ignored). */
  native?: boolean;
  /** Seconds of lift time per tick (queue throughput + ride duration). Today 6. */
  liftSecPerTick: number;
  /** Vehicle approach cap (ticks) for the last 30 tiles. Today 6. */
  vehicleTripTicks: number;
}
const CUR = { walk: 1, hike: 1, bike: 1, ski: 1, liftSecPerTick: LIFT_SECONDS_PER_TICK, vehicleTripTicks: VEHICLE_MAX_TRIP_TICKS };
/** Targets in tiles/s at 1x -> multiplier on today's tiles/tick = target * D / 240 / today's tiles/tick. */
export const toMult = (tilesPerS: number, daySeconds: number, curTpt: number): number => (tilesPerS * daySeconds) / TICKS_PER_DAY / curTpt;
export function modelFor(id: string, label: string, daySeconds: number, t: { walk: number; hike: number; bike: number; ski: number }, liftSecPerTick: number, vehicleTripTicks: number): Model {
  return { id, label, daySeconds, walk: toMult(t.walk, daySeconds, 9), hike: toMult(t.hike, daySeconds, 0.4), bike: toMult(t.bike, daySeconds, 1.4), ski: toMult(t.ski, daySeconds, 13.2), liftSecPerTick, vehicleTripTicks };
}
export const MODELS: Model[] = [
  { id: 'I', label: 'Implemented: day 150 s, walk 2.5 / 3.4 / 5.0 tiles/tick by map size, hike 1.9, bike 3.1, ski 6.25 (current src/)', daySeconds: 150, ...CUR, native: true },
  { id: 'M0', label: 'Current: day 24 s, walk 9 / ski 13 tiles/tick', daySeconds: 24, ...CUR },
  // A: slow day. Same ticks but D=300 s (5 min); speeds at comfortable targets; lift time honest to real seconds per tick (D/240 = 1.25 s)
  modelFor('A', 'A slow day: day 300 s, comfortable speeds, honest lifts', 300, { walk: 2, hike: 1.5, bike: 4, ski: 6 }, 300 / 240, 6),
  modelFor('A2', 'A slow day with arcade lifts (6 s/tick kept)', 300, { walk: 2, hike: 1.5, bike: 4, ski: 6 }, 6, 6),
  modelFor('A3', 'A-lite: day 120 s, comfortable speeds, lifts 6 s/tick', 120, { walk: 2, hike: 1.5, bike: 4, ski: 6 }, 6, 6),
  // B/C: sim unchanged (M0), visual decoupling only: lag statistics come from the same traces (no sim effect)
  // E: recommended hybrid: day 150 s at 1x, walk 4 / hike 2 / bike 5 / ski 10 t/s (acceptable tier), arcade lifts (6 s/tick), vehicle approach cap 6 ticks (= 8 t/s)
  modelFor('E', 'E hybrid: day 150 s, walk 4 / hike 2 / bike 5 / ski 10 t/s, lifts 6 s/tick, trips <= 6 ticks', 150, { walk: 4, hike: 2, bike: 5, ski: 10 }, 6, 6),
  modelFor('Eh', 'E + faster hikers (4 t/s)', 150, { walk: 4, hike: 4, bike: 5, ski: 10 }, 6, 6),
  modelFor('Es', 'Es: E with walk speed scaled by map size (4 / 5.5 / 8 t/s: constant on-screen px/s at the zoom each map needs), hike 3', 150, { walk: 4, hike: 3, bike: 5, ski: 10 }, 6, 6),
  // E-short: same speeds on a 96 s day: shows the lower bound of the day length (guests cannot get to the lifts on 256)
  modelFor('E96', 'E at a 96 s day (too short: 256 maps break)', 96, { walk: 4, hike: 2, bike: 5, ski: 10 }, 6, 6),
];

export interface Hooks { setLiftSecPerTick(v: number): void; setVehicleTripTicks(v: number): void }

/** Apply a model's sim-affecting parts at runtime; returns a restore function. */
export function applyModel(m: Model, hooks: Hooks): () => void {
  const o = { ...NAV_SPEED }, w = { ...WALK_SPEED_BY_SIZE };
  const N = NAV_SPEED as { walk: number; hike: number; bike: number; skiBase: number; skiFlat: number };
  if (!m.native) {
    // model multipliers are relative to the pre-change speeds; the per-size walk scale is neutralised (the model carries its own walk speed)
    N.walk = M0_NAV.walk * m.walk; N.hike = M0_NAV.hike * m.hike; N.bike = M0_NAV.bike * m.bike; N.skiBase = M0_NAV.skiBase * m.ski; N.skiFlat = M0_NAV.skiFlat * m.ski;
    const WS = WALK_SPEED_BY_SIZE as Record<number, number>; for (const k of Object.keys(WS)) WS[Number(k)] = N.walk;
  }
  hooks.setLiftSecPerTick(m.liftSecPerTick); hooks.setVehicleTripTicks(m.vehicleTripTicks);
  return () => { Object.assign(N, o); Object.assign(WALK_SPEED_BY_SIZE as Record<number, number>, w); hooks.setLiftSecPerTick(LIFT_SECONDS_PER_TICK); hooks.setVehicleTripTicks(VEHICLE_MAX_TRIP_TICKS); };
}

// ------------------------------------------------------------------------------------------------------------------------------------------
// Trace

type Cat = 'walk' | 'hike' | 'bike' | 'ski-green' | 'ski-blue' | 'ski-red' | 'ski-black' | 'ski-off';
const CATS: Cat[] = ['walk', 'hike', 'bike', 'ski-green', 'ski-blue', 'ski-red', 'ski-black', 'ski-off'];
const catOf = (mode: number): Cat => (mode === NavMode.Walk ? 'walk' : mode === NavMode.Hike ? 'hike' : mode === NavMode.Bike ? 'bike' : mode === NavMode.Ski0 ? 'ski-green' : mode === NavMode.Ski1 ? 'ski-blue' : mode === NavMode.Ski2 ? 'ski-red' : mode === NavMode.Ski3 ? 'ski-black' : 'ski-off');
const chaseTarget = (c: Cat): number => (c === 'walk' ? COMFORT.walk : c === 'hike' ? COMFORT.hike : c === 'bike' ? COMFORT.bike : c === 'ski-green' ? COMFORT.ski.green : c === 'ski-blue' ? COMFORT.ski.blue : c === 'ski-red' ? COMFORT.ski.red : COMFORT.ski.black);

export interface Dist { n: number; mean: number; p50: number; p95: number; max: number }
const dist = (a: number[]): Dist => {
  if (!a.length) return { n: 0, mean: NaN, p50: NaN, p95: NaN, max: NaN };
  const s = [...a].sort((x, y) => x - y);
  return { n: s.length, mean: s.reduce((p, c) => p + c, 0) / s.length, p50: s[Math.floor(s.length * 0.5)]!, p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]!, max: s[s.length - 1]! };
};

export interface TraceResult {
  model: string; size: number; seed: number; days: number; season: string;
  /** Moving-tick displacement (tiles/tick) by mode. */
  speeds: Record<string, Dist>;
  vehicles: Record<string, { n: number; tilesPerTick: Dist; tripTicks: Dist }>;
  guests: number; guestsPerDay: number;
  /** Completed guests (left during the run). */
  completed: number; presenceTicks: number; presenceH: number;
  tilesByCat: Record<string, number>; ticksByCat: Record<string, number>; walkShare: number;
  runsPerGuest: number; ridesPerGuest: number; skiers: number; runsPerSkier: number;
  incomePerDay: number; stars: number; queueMinPerGuest: number; msPerTick: number; liftRidesPerDay: number;
  /** Visual chaser (comfortable speeds): lag in real seconds at 1x of the model's day. */
  chase: { meanLagS: number; p95LagS: number; shareLagOver3s: number; shareHidden: number };
  /** Walk-time budget: ticks a completed guest would spend on its walked tiles at today's speed / at comfortable speed (model day). */
  walkTicksNow: number; walkTicksComfort: number; tilesWalkedPerGuest: number;
}

export interface TraceOpts { size: Size; seed: number; days: number; model: Model; lifts?: number; hooks: Hooks; build?: () => Sim; season?: string }

/** Run `days` game days on a winter starter resort (or a custom sim) under a model and measure on-screen speeds + time budget. */
export function trace(o: TraceOpts): TraceResult {
  const restore = applyModel(o.model, o.hooks);
  try {
    const sim = o.build ? o.build() : buildSkiResort(o.size, o.seed, o.lifts ?? 2).sim;
    const st = sim.guestSim.store, spawner = sim.guestSim.spawner;
    const ticksPerS = TICKS_PER_DAY / o.model.daySeconds;
    const samples: Record<string, number[]> = {}; for (const c of CATS) samples[c] = [];
    const CAP = 60000;
    const sumLedger = (): number => Object.values(sim.economy.ledger).reduce((a, b) => a + (b as number), 0);
    const ledger0 = sumLedger();
    type Rec = { first: number; last: number; tiles: Record<string, number>; ticks: Record<string, number>; runs: number; rides: number; left: boolean; queue: number };
    const recs = new Map<number, Rec>();
    const liftRides = { n: 0 }; const prevRide = sim.guestWorld.onLiftRide;
    sim.guestWorld.onLiftRide = (l, id) => { liftRides.n++; const r = recs.get(id); if (r) r.rides++; prevRide?.(l, id); };
    const prevState = new Int8Array(st.capacity).fill(-1), sVis = new Float64Array(st.capacity), sSim = new Float64Array(st.capacity), slotId = new Int32Array(st.capacity);
    const lags: number[] = []; let lagOver3 = 0, lagN = 0, hidden = 0;
    const vTrack = new Map<number, { kind: number; speed: number; t0: number; t1: number }>();
    const total = o.days * TICKS_PER_DAY, t0 = sim.game.date.tick;
    const wall0 = performance.now();
    let queueTicks = 0;
    for (let t = 1; t <= total; t++) {
      sim.tick(1);
      const now = sim.game.date.tick - t0;
      for (const v of spawner.vehicles) { const e = vTrack.get(v.id); if (e) e.t1 = now; else vTrack.set(v.id, { kind: v.kind, speed: v.speed, t0: now, t1: now }); }
      for (let i = 0; i < st.limit; i++) {
        if (!st.alive[i]) continue;
        const id = st.id[i]!;
        let r = recs.get(id);
        if (!r) { r = { first: now, last: now, tiles: {}, ticks: {}, runs: 0, rides: 0, left: false, queue: 0 }; recs.set(id, r); }
        r.last = now; r.runs = st.runs[i]!;
        if (slotId[i] !== id) { slotId[i] = id; sVis[i] = 0; sSim[i] = 0; }
        const s = st.state[i]!;
        if (s === GState.Queueing) { r.queue++; queueTicks++; }
        let d = 0;
        if (s === GState.Walking || s === GState.Leaving) {
          d = Math.hypot(st.x[i]! - st.px[i]!, st.y[i]! - st.py[i]!);
          if (d > 1e-4 && d < 60 && prevState[i] !== GState.Riding && prevState[i] !== GState.Queueing) {
            const c = catOf(st.moveMode[i]!);
            r.tiles[c] = (r.tiles[c] ?? 0) + d; r.ticks[c] = (r.ticks[c] ?? 0) + 1;
            const a = samples[c]!; if (a.length < CAP) a.push(d);
          } else d = 0;
        }
        prevState[i] = s;
        // visual chaser: follows the sim path length at the comfortable speed of the guest's mode
        const c = catOf(st.moveMode[i]!), vmax = chaseTarget(c) / ticksPerS; // tiles per tick the visual may cover
        sSim[i]! += d; sVis[i] = Math.min(sSim[i]!, sVis[i]! + vmax);
        const lag = sSim[i]! - sVis[i]!;
        if (d > 0 || lag > 0) { const lagS = lag / chaseTarget(c) / 1; lagN++; lags.push(lagS); if (lagS > 3) lagOver3++; if (lag > 10) hidden++; }
      }
    }
    sim.guestWorld.onLiftRide = prevRide;
    const wallMs = performance.now() - wall0;
    for (const r of recs.values()) r.left = r.last < total - 1; // guests still present at the end are partial days: excluded
    const done = [...recs.values()].filter((r) => r.left);
    const tilesByCat: Record<string, number> = {}, ticksByCat: Record<string, number> = {};
    let presence = 0, walkTicks = 0, runs = 0, rides = 0, skiers = 0, skierRuns = 0;
    for (const r of done) {
      presence += r.last - r.first + 1; runs += r.runs; rides += r.rides; if (r.runs > 0) { skiers++; skierRuns += r.runs; }
      for (const c of CATS) { tilesByCat[c] = (tilesByCat[c] ?? 0) + (r.tiles[c] ?? 0); ticksByCat[c] = (ticksByCat[c] ?? 0) + (r.ticks[c] ?? 0); walkTicks += r.ticks[c] ?? 0; }
    }
    // tiles that today need ticks (today's speeds) vs comfortable (tiles / (target / ticksPerS)). Walking only (walk+hike+bike modes).
    let walkNow = 0, walkComf = 0, walkTiles = 0;
    for (const c of ['walk', 'hike', 'bike'] as Cat[]) {
      const tl = tilesByCat[c] ?? 0; walkTiles += tl;
      const cur = c === 'walk' ? NAV_SPEED.walk / o.model.walk : c === 'hike' ? NAV_SPEED.hike / o.model.hike : NAV_SPEED.bike / o.model.bike;
      walkNow += tl / cur; walkComf += tl / (chaseTarget(c) / ticksPerS);
    }
    const nDone = Math.max(1, done.length);
    const vehicles: TraceResult['vehicles'] = {};
    const kn = ['car', 'bus', 'train', 'plane'];
    for (let k = 0; k < 4; k++) {
      const vs = [...vTrack.values()].filter((v) => v.kind === k);
      vehicles[kn[k]!] = { n: vs.length, tilesPerTick: dist(vs.map((v) => v.speed)), tripTicks: dist(vs.map((v) => v.t1 - v.t0 + 1)) };
    }
    const speeds: Record<string, Dist> = {}; for (const c of CATS) speeds[c] = dist(samples[c]!);
    const sortedLag = [...lags].sort((a, b) => a - b);
    return {
      model: o.model.id, size: o.size, seed: o.seed, days: o.days, season: o.season ?? 'winter', speeds, vehicles,
      guests: recs.size, guestsPerDay: recs.size / o.days, completed: done.length, presenceTicks: presence / nDone, presenceH: ((presence / nDone) * GAME_MINUTES_PER_TICK) / 60,
      tilesByCat: Object.fromEntries(Object.entries(tilesByCat).map(([k, v]) => [k, v / nDone])), ticksByCat: Object.fromEntries(Object.entries(ticksByCat).map(([k, v]) => [k, v / nDone])),
      walkShare: presence ? walkTicks / presence : NaN,
      runsPerGuest: runs / nDone, ridesPerGuest: rides / nDone, skiers, runsPerSkier: skiers ? skierRuns / skiers : 0,
      incomePerDay: (sumLedger() - ledger0) / o.days, stars: sim.rating.stars, queueMinPerGuest: (queueTicks * GAME_MINUTES_PER_TICK) / Math.max(1, recs.size),
      msPerTick: wallMs / total, liftRidesPerDay: liftRides.n / o.days,
      chase: { meanLagS: lagN ? lags.reduce((a, b) => a + b, 0) / lagN : 0, p95LagS: sortedLag.length ? sortedLag[Math.floor(sortedLag.length * 0.95)]! : 0, shareLagOver3s: lagN ? lagOver3 / lagN : 0, shareHidden: lagN ? hidden / lagN : 0 },
      walkTicksNow: walkNow / nDone, walkTicksComfort: walkComf / nDone, tilesWalkedPerGuest: walkTiles / nDone,
    };
  } finally { restore(); }
}

/** Real seconds per tick / per game hour etc. for a model and a speed button. */
export function pacingTable(daySeconds: number, ticksPerDay = TICKS_PER_DAY): Array<{ speed: string; daySeconds: number; ticksPerS: number; yearMinutes: number; winterMinutes: number }> {
  return SPEED_MULTIPLIERS.slice(1).map((m) => {
    const d = daySeconds / m;
    return { speed: `${m}x`, daySeconds: d, ticksPerS: ticksPerDay / d, yearMinutes: (d * DAYS_PER_YEAR) / 60, winterMinutes: (d * 4 * DAYS_PER_MONTH) / 60 };
  });
}

/** Per-map-size variant of a model (only `Es`: walking speed follows the zoom each map size is played at). */
export function modelAtSize(m: Model, size: number): Model {
  if (m.id !== 'Es') return m;
  return modelFor(m.id, m.label, m.daySeconds, { walk: size >= 256 ? 8 : size >= 128 ? 5.5 : 4, hike: 3, bike: 5, ski: 10 }, m.liftSecPerTick, m.vehicleTripTicks);
}
