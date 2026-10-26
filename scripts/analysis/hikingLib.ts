/**
 * Hiking analysis library (docs/hiking-analysis.md). Sim-only, no gameplay changes: builds a summer starter resort + a hiking trail network
 * (village -> summit, lift top -> summit, a bike trail down) through the REAL placement / network / lift APIs, runs N in-game days at the real
 * tick/clock and records per-guest stats. What-if scenarios only mutate runtime values (NAV_SPEED, GUEST_DUSK_HOUR via the test's module mock,
 * lift hours, decider wrappers); nothing is committed to src/.
 */
import { createSim, type Sim } from '../../src/game/createSim';
import { buildStarterResort } from '../../src/game/starterResort';
import { BUILDINGS } from '../../src/config/buildings';
import { Layer } from '../../src/world/Networks';
import { TileType } from '../../src/world/Grid';
import { OccFlag } from '../../src/world/Occupancy';
import { placeBuilding } from '../../src/sim/PlaceBuilding';
import { GState, GuestType, Leave } from '../../src/sim/guests/Guest';
import { Act, Pref, prefFor, FOOD } from '../../src/sim/guests/Decision';
import { NavMode } from '../../src/sim/guests/NavGraph';
import type { NavMovement } from '../../src/sim/guests/Movement';
import { NAV_SPEED, TICKS_PER_DAY, TILE_METRES } from '../../src/config/balance';
import { hourOfDay } from '../../src/sim/Clock';

export type Size = 64 | 128 | 256;
type Pt = { x: number; y: number };

export interface TrailInfo {
  size: Size; seed: number;
  lodge: Pt; liftBottom: Pt; liftTop: Pt; summit: Pt;
  altMin: number; altMax: number;
  /** Relative altitude (0..1 of the map's relief) of lodge / lift top / summit. */
  relLodge: number; relLiftTop: number; relSummit: number;
  trailTiles: number; hikeTilesOk: number; mtbTiles: number; hutPlaced: boolean;
  liftKind: string; liftActiveMode: string | null | undefined; liftLengthTiles: number;
  /** Walk distance (tiles) lodge -> summit along the painted trail. */
  trailLenLodgeSummit: number; trailLenLiftTopSummit: number;
  warnings: string[];
}

const ringTiles = (x: number, y: number, w: number, h: number): Pt[] => {
  const out: Pt[] = [];
  for (let i = x - 1; i <= x + w; i++) { out.push({ x: i, y: y - 1 }, { x: i, y: y + h }); }
  for (let j = y; j < y + h; j++) { out.push({ x: x - 1, y: j }, { x: x + w, y: j }); }
  return out;
};

/** Build the summer resort with a trail network. `lift` = starter chairlift (carries hikers/bikers in summer). */
export function buildHikingResort(size: Size, seed: number, o: { defaultHours?: boolean } = {}): { sim: Sim; info: TrailInfo } {
  const sim = createSim({ size, seed, startSeason: 'summer', now: () => 0 });
  const rep = buildStarterResort(sim, { lifts: 1, liftKind: 'chair4' });
  const warnings = [...rep.failures];
  const { grid, networks, cond } = sim;
  const lodge = sim.buildings.all().find((b) => b.type === 'baseLodge')!;
  const lc = { x: Math.round(lodge.x + lodge.w / 2), y: Math.round(lodge.y + lodge.h / 2) };
  const lift = rep.lifts[0]!;
  const n = size;

  const blocked = (x: number, y: number): boolean => {
    if (x < 1 || y < 1 || x >= n - 1 || y >= n - 1) return true;
    const t = grid.tileType[grid.tileIndex(x, y)];
    if (t === TileType.Water || t === TileType.Stream) return true;
    return (grid.occupancy.flags[grid.occupancy.index(x, y)]! & (OccFlag.Water | OccFlag.Building | OccFlag.Lift)) !== 0;
  };
  // Dijkstra over tiles, cost = 1 + 6 |d altitude| (hikers avoid cliffs but the trail is always built, no slope veto).
  const dijkstra = (from: Pt[], maxCost = Infinity): { dist: Float64Array; prev: Int32Array } => {
    const dist = new Float64Array(n * n).fill(Infinity), prev = new Int32Array(n * n).fill(-1);
    const heap: Array<[number, number]> = [];
    const push = (d: number, i: number): void => { heap.push([d, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p]![0] <= heap[k]![0]) break; [heap[p], heap[k]] = [heap[k]!, heap[p]!]; k = p; } };
    const pop = (): [number, number] => { const top = heap[0]!; const last = heap.pop()!; if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l; if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k]!, heap[m]!]; k = m; } } return top; };
    for (const f of from) if (!blocked(f.x, f.y)) { const i = f.y * n + f.x; dist[i] = 0; push(0, i); }
    while (heap.length) {
      const [d, i] = pop();
      if (d > dist[i]! || d > maxCost) continue;
      const x = i % n, y = (i / n) | 0, a = cond.altitude(x, y);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx, ny = y + dy;
        if (blocked(nx, ny)) continue;
        const ni = ny * n + nx, nd = d + 1 + 6 * Math.abs(cond.altitude(nx, ny) - a);
        if (nd < dist[ni]!) { dist[ni] = nd; prev[ni] = i; push(nd, ni); }
      }
    }
    return { dist, prev };
  };
  const trace = (prev: Int32Array, to: number): Pt[] => { const out: Pt[] = []; for (let i = to; i >= 0; i = prev[i]!) out.push({ x: i % n, y: (i / n) | 0 }); return out.reverse(); };

  let altMin = Infinity, altMax = -Infinity;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const a = cond.altitude(x, y); if (a < altMin) altMin = a; if (a > altMax) altMax = a; }
  const rel = (x: number, y: number): number => (cond.altitude(Math.floor(x), Math.floor(y)) - altMin) / (altMax - altMin);

  // summit = highest tile reachable from the village within a walkable cost budget
  const lodgeRing = ringTiles(lodge.x, lodge.y, lodge.w, lodge.h).filter((p) => !blocked(p.x, p.y));
  const A = dijkstra(lodgeRing, size * 2.2);
  let summitI = -1, best = -Infinity;
  for (let i = 0; i < n * n; i++) { if (A.dist[i]! === Infinity) continue; const a = cond.altitude(i % n, (i / n) | 0); if (a > best) { best = a; summitI = i; } }
  const summit = { x: summitI % n, y: (summitI / n) | 0 };

  const paint = (layer: number, route: Pt[]): number => networks.paint(layer as 1 | 2 | 4, route).painted;
  const routeA = trace(A.prev, summitI);
  let painted = paint(Layer.Hike, routeA);
  // lift top -> summit
  const topRing = ringTiles(lift.top.x, lift.top.y, 2, 2).filter((p) => !blocked(p.x, p.y));
  const B = dijkstra(topRing, size * 2.2);
  const routeB = B.dist[summitI]! < Infinity ? trace(B.prev, summitI) : [];
  painted += paint(Layer.Hike, routeB);
  // bike trail lift top -> village
  const lodgeI = lodgeRing.length ? lodgeRing[0]!.y * n + lodgeRing[0]!.x : -1;
  const botRing = ringTiles(lodge.x, lodge.y, lodge.w, lodge.h).filter((p) => !blocked(p.x, p.y));
  const C = dijkstra(topRing, size * 1.5);
  let mtb = 0;
  for (const r of botRing) { const i = r.y * n + r.x; if (C.dist[i]! < Infinity) { mtb = paint(Layer.Mtb, trace(C.prev, i)); break; } }
  void lodgeI;

  // mountain hut on the summit trail near the top (food / rest / the 'high hut')
  let hut = false;
  const hutAt = routeA[Math.max(0, routeA.length - 4)] ?? summit;
  const def = BUILDINGS['mountainHut']!;
  search: for (let r = 0; r <= 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const out = placeBuilding(sim.env, sim.props, 'mountainHut', hutAt.x - (def.w >> 1) + dx, hutAt.y - (def.h >> 1) + dy, 0, true, false);
    if (out.ok && out.building) { sim.refreshCoverage(out.building, out.changed.length > 0); hut = true; break search; }
  }
  if (!hut) warnings.push('summit hut not placed');
  sim.buildings.reevaluate(); sim.refreshCoverage(undefined, true); sim.openStatus.evaluate();
  if (!o.defaultHours) for (const l of sim.lifts.all()) sim.liftOps.setHours(l.id, 6, 22);

  let hikeTilesOk = 0, trailTiles = 0;
  for (let t = 0; t < n * n; t++) if (networks.layers[t]! & Layer.Hike) { trailTiles++; if (cond.hikeOk[t] === 1) hikeTilesOk++; }
  if (painted < routeA.length * 0.8) warnings.push(`only ${painted}/${routeA.length + routeB.length} trail tiles painted`);
  const l0 = sim.lifts.all()[0]!;
  const info: TrailInfo = {
    size, seed, lodge: lc, liftBottom: { x: lift.bottom.x, y: lift.bottom.y }, liftTop: { x: lift.top.x, y: lift.top.y }, summit,
    altMin, altMax, relLodge: rel(lc.x, lc.y), relLiftTop: rel(lift.top.x, lift.top.y), relSummit: 1,
    trailTiles, hikeTilesOk, mtbTiles: mtb, hutPlaced: hut, liftKind: lift.kind, liftActiveMode: l0.activeMode,
    liftLengthTiles: Math.hypot(lift.top.x - lift.bottom.x, lift.top.y - lift.bottom.y),
    trailLenLodgeSummit: routeA.length, trailLenLiftTopSummit: routeB.length, warnings,
  };
  info.relSummit = rel(summit.x, summit.y);
  return { sim, info };
}

// ------------------------------------------------------------------------------------------------------------------------------------------

export interface Scenario {
  id: string; label: string;
  /** Multiplier on NAV_SPEED.hike (trail tiles); 1 = baseline. */
  hikeSpeed?: number;
  /** GUEST_DUSK_HOUR override (needs the vitest module mock; see tests/analysis). */
  dusk?: number;
  /** Lift opening hours (default 8.5-17 baseline, true schedule). */
  liftHours?: [number, number];
  /** Hike goals are sampled from the top third of the trail network. */
  summitGoals?: boolean;
  /** Hikers are flagged overnight (stay 2 days, sleep where they stand, resume 06:30). */
  overnightHikers?: boolean;
  /** Excursion abstraction: hikers cover their path in ~ETA ticks regardless of map scale (teleport-steps along the path). */
  excursionEtaTicks?: number;
  /** Pre-excursion behaviour (uniform random trail goal, NavMovement only): the 'before' numbers. */
  legacy?: boolean;
}

export const HIST_ALT_BANDS = 5;
type Cat = 'trail' | 'toBuilding' | 'toLift' | 'queue' | 'ride' | 'using' | 'idle' | 'leaving' | 'sleeping' | 'ski' | 'other';
const outcomeOf = (reason: number): Attempt['outcome'] =>
  reason === Leave.Closing ? 'aborted-dusk' : reason === Leave.Tired || reason === Leave.Broke || reason === Leave.Bored || reason === Leave.Injured ? 'aborted-needs' : reason === Leave.Satisfied ? 'aborted-satisfied' : 'aborted-nopath';
const CATS: Cat[] = ['trail', 'toBuilding', 'toLift', 'queue', 'ride', 'using', 'idle', 'leaving', 'sleeping', 'ski', 'other'];

interface GuestRec {
  id: number; pref: number; type: number; arriveTick: number; arriveHour: number;
  firstTrailTick: number; maxRel: number; ticksAbove50: number; ticksAbove67: number; ticks: number;
  cat: Record<Cat, number>; foodTicks: number; rodeLift: boolean; overnight: boolean; leaveStart: number; leaveStartRel: number; liftRides: number; leaveReason: number; leftTick: number; nearSummit: boolean;
  attempts: number; completed: number; aborted: number;
}
interface Attempt {
  gid: number; startTick: number; startRel: number; goalRel: number; straight: number; pathLen: number; pathLift: boolean; pathGainRel: number; maxRel: number;
  mode: number; outcome: 'done' | 'aborted-dusk' | 'aborted-needs' | 'aborted-satisfied' | 'aborted-nopath' | 'open'; startHour: number; reqHours: number;
  endHour: number; durTicks: number;
}

export interface RunResult {
  scenario: string; size: Size; seed: number; days: number;
  guests: number; hikers: number; bikers: number;
  recs: GuestRec[]; attempts: Attempt[];
  heat: number[][]; // [hour][band] hiker-ticks (pref=Hike, alive)
  heatAll: number[][];
  arrivalHist: number[];
  liftRidesByMode: Record<string, number>;
  income: number; msPerTick: number; ticks: number;
  queueTicks: number; queueGuests: number;
  info: TrailInfo;
  abortReasons: Record<string, number>; okTop3Start: number; okTop3End: number; okMidStart: number;
  exc: { started: number; finished: number; aborted: number; turnedBack: number; liftFirst: number; picks: number; topPicks: number; trekStarted: number; trekNights: number; trekDone: number; bedRevenue: number };
  hourPositions: Array<{ hour: number; rel: number }>; // sampled hiker positions (for debugging)
}

export function runScenario(sim: Sim, info: TrailInfo, sc: Scenario, days: number, setDusk?: (h: number) => void): RunResult {
  const store = sim.guestSim.store, nm = (sim.guestSim as unknown as { nm: NavMovement }).nm;
  const { cond, networks } = sim;
  const n = sim.size;
  const orig = { hike: NAV_SPEED.hike };
  (NAV_SPEED as { hike: number }).hike = orig.hike * (sc.hikeSpeed ?? 1);
  setDusk?.(sc.dusk ?? 17);
  if (sc.liftHours) for (const l of sim.lifts.all()) sim.liftOps.setHours(l.id, sc.liftHours[0], sc.liftHours[1]);
  const rel = (x: number, y: number): number => Math.max(0, Math.min(1, (cond.altitude(Math.floor(x), Math.floor(y)) - info.altMin) / (info.altMax - info.altMin)));
  const topTiles: number[] = [];
  const allTiles: number[] = [];
  for (let t = 0; t < n * n; t++) if (networks.layers[t]! & Layer.Hike) { allTiles.push(t); if (rel(t % n, (t / n) | 0) >= 0.67) topTiles.push(t); }
  if (topTiles.length < 3) { const s = [...allTiles].sort((a, b) => cond.altitude(b % n, (b / n) | 0) - cond.altitude(a % n, (a / n) | 0)); topTiles.push(...s.slice(0, 12)); }
  const okShare = (min: number): number => { let a = 0, b = 0; for (const t of allTiles) if (rel(t % n, (t / n) | 0) >= min) { a++; if (cond.hikeOk[t] === 1) b++; } return a ? b / a : NaN; };
  const okTop3Start = okShare(0.67), okMidStart = okShare(0.5);
  const gsim = sim.guestSim;
  if (sc.legacy) { gsim.decider.useGoals = false; gsim.exc.enabled = false; }
  const exc0 = { started: gsim.exc.started, fin: gsim.exc.finishedCount, ab: gsim.exc.aborted, tb: gsim.exc.turnedBack, lf: gsim.exc.liftFirst, picks: gsim.decider.goals.picks, top: gsim.decider.goals.top };
  const origChoose = sim.guestSim.decider.choose.bind(sim.guestSim.decider);
  if (sc.summitGoals) {
    sim.guestSim.decider.choose = (s, i, rng, hour) => {
      const it = origChoose(s, i, rng, hour);
      if (it.kind === 'hike' && topTiles.length) {
        const ok = topTiles.filter((t) => cond.hikeOk[t] === 1); // only snow-free tiles (the real decider samples only those)
        if (ok.length) it.tile = ok[Math.floor(rng.next() * ok.length)]!;
      }
      return it;
    };
  }
  const buildingType = new Map<number, string>();
  for (const b of sim.buildings.all()) buildingType.set(b.id, b.type);

  const recs = new Map<number, GuestRec>(); const done: GuestRec[] = [];
  const slotId = new Int32Array(store.capacity).fill(0);
  const att = new Map<number, Attempt>(); const attempts: Attempt[] = [];
  const heat = Array.from({ length: 24 }, () => new Array<number>(HIST_ALT_BANDS).fill(0)), heatAll = Array.from({ length: 24 }, () => new Array<number>(HIST_ALT_BANDS).fill(0));
  const arrivalHist = new Array<number>(24).fill(0);
  const liftRidesByMode: Record<string, number> = { hike: 0, bike: 0, ski: 0, walk: 0 };
  const prevRide = sim.guestWorld.onLiftRide;
  sim.guestWorld.onLiftRide = (l, id) => {
    const s = store.slotOf(id);
    if (s >= 0) {
      const m = store.moveMode[s]!;
      const k = m === NavMode.Hike ? 'hike' : m === NavMode.Bike ? 'bike' : m === NavMode.Walk ? 'walk' : 'ski';
      liftRidesByMode[k]!++;
      const r = recs.get(id); if (r) { r.rodeLift = true; r.liftRides++; }
    }
    prevRide?.(l, id);
  };
  const abortReasons: Record<string, number> = {};
  const gs = sim.guestSim as unknown as { abort: (i: number, wait?: number) => void };
  const origAbort = gs.abort;
  gs.abort = function (this: unknown, i: number, wait = 15) {
    if (store.act[i] === Act.ToTrail) {
      const key = wait === 5 ? 'timeout700' : wait === 20 ? 'unreachable' : wait === 30 ? 'noPass' : wait === 10 ? 'liftBalk/closed' : `wait${wait}`;
      abortReasons[key] = (abortReasons[key] ?? 0) + 1;
    }
    origAbort.call(this, i, wait);
  };
  const hourNow = (): number => hourOfDay(sim.game.date);
  const flaggedOvernight = new Set<number>();
  const sumLedger = (): number => Object.values(sim.economy.ledger).reduce((a, b) => a + (b as number), 0);
  const ledger0 = sumLedger();
  const excursionState = new Map<number, number>(); // slot -> extra nodes per tick
  let queueTicks = 0; const queueGuests = new Set<number>();
  const hourPositions: Array<{ hour: number; rel: number }> = [];

  const finalise = (slot: number, reason: number): void => {
    const id = slotId[slot]!;
    const r = recs.get(id);
    if (r) { if (reason) r.leaveReason = reason; r.leftTick = sim.game.date.tick; done.push(r); recs.delete(id); }
    const a = att.get(id);
    if (a) {
      a.outcome = outcomeOf(r?.leaveReason ?? 0);
      a.endHour = hourNow(); a.durTicks = tickNo - a.startTick; attempts.push(a); att.delete(id);
      if (r) r.aborted++;
    }
    slotId[slot] = 0;
  };

  let tickNo = 0;
  const total = days * TICKS_PER_DAY;
  const t0 = performance.now();
  for (let t = 1; t <= total; t++) {
    sim.tick(1); tickNo = t;
    const hour = hourNow(), hh = Math.floor(hour) % 24;
    const absDay = sim.game.date.year * 365 + sim.game.date.day;
    for (let i = 0; i < store.limit; i++) {
      if (!store.alive[i]) { if (slotId[i]) finalise(i, 0); continue; }
      const id = store.id[i]!;
      if (slotId[i] !== id) {
        if (slotId[i]) finalise(i, 0);
        slotId[i] = id;
        const cat = {} as Record<Cat, number>; for (const c of CATS) cat[c] = 0;
        const pref = prefFor(id, store.type[i]!);
        recs.set(id, { id, pref, type: store.type[i]!, arriveTick: t, arriveHour: hour, firstTrailTick: -1, maxRel: 0, ticksAbove50: 0, ticksAbove67: 0, ticks: 0, cat, foodTicks: 0, rodeLift: false, overnight: store.overnight[i] === 1, leaveStart: -1, leaveStartRel: 0, liftRides: 0, leaveReason: 0, leftTick: -1, nearSummit: false, attempts: 0, completed: 0, aborted: 0 });
        arrivalHist[hh]!++;
      }
      const r = recs.get(id)!;
      if (sc.overnightHikers && r.pref === Pref.Hike && !flaggedOvernight.has(id) && !store.overnight[i]) {
        flaggedOvernight.add(id); store.overnight[i] = 1; store.leaveDay[i] = absDay + 2; store.overnightCount++;
      }
      const x = store.x[i]!, y = store.y[i]!, rr = rel(x, y), st = store.state[i]!, act = store.act[i]!;
      r.ticks++;
      if (rr > r.maxRel) r.maxRel = rr;
      if (rr >= 0.5) r.ticksAbove50++;
      if (rr >= 0.67) r.ticksAbove67++;
      if (Math.hypot(x - info.summit.x, y - info.summit.y) <= 4) r.nearSummit = true;
      const band = Math.min(HIST_ALT_BANDS - 1, Math.floor(rr * HIST_ALT_BANDS));
      heatAll[hh]![band]!++;
      if (r.pref === Pref.Hike) heat[hh]![band]!++;
      if (st === GState.Leaving) { if (store.leaveReason[i] !== 0) r.leaveReason = store.leaveReason[i]!; if (r.leaveStart < 0) { r.leaveStart = t; r.leaveStartRel = rr; } }
      // category
      let c: Cat = 'other';
      if (st === GState.Sleeping) c = 'sleeping'; else if (st === GState.Leaving) c = 'leaving'; else if (st === GState.Queueing) { c = 'queue'; queueTicks++; queueGuests.add(id); }
      else if (st === GState.Riding) c = 'ride'; else if (st === GState.Using) c = 'using'; else if (st === GState.Idle) c = 'idle';
      else if (act === Act.ToTrail || act === Act.Excursion) c = 'trail'; else if (act === Act.ToLift) c = 'toLift'; else if (act === Act.SkiDown) c = 'ski';
      else if (act === Act.ToBuilding) { c = 'toBuilding'; if (FOOD.has(buildingType.get(store.target[i]!) ?? '')) r.foodTicks++; }
      r.cat[c]++;
      // first tile of a trail layer
      const tile = Math.floor(y) * n + Math.floor(x);
      if (r.firstTrailTick < 0 && (networks.layers[tile]! & (Layer.Hike | Layer.Mtb)) !== 0) r.firstTrailTick = t;
      // attempts
      const a = att.get(id);
      if ((act === Act.ToTrail || act === Act.Excursion) && st === GState.Walking && !a) {
        const mode = store.moveMode[i]!;
        const gx = store.goalX[i]!, gy = store.goalY[i]!;
        att.set(id, { gid: id, startTick: t, startRel: rr, goalRel: rel(gx, gy), straight: Math.hypot(gx - x, gy - y), pathLen: -1, pathLift: false, pathGainRel: 0, maxRel: rr, mode, outcome: 'open', startHour: hour, reqHours: 0, endHour: hour, durTicks: 0 });
        r.attempts++;
      } else if (a) {
        if (rr > a.maxRel) a.maxRel = rr;
        if (a.pathLen < 0) {
          const p = nm.pathOf(i);
          if (p) {
            let len = 0, lift = false;
            for (let k = 0; k + 1 < p.nodes.length; k++) { const A = p.nodes[k]!, B = p.nodes[k + 1]!; const d = Math.hypot((A % n) - (B % n), ((A / n) | 0) - ((B / n) | 0)); if (d > 1.5) lift = true; else len += d; }
            const last = p.nodes[p.nodes.length - 1]!;
            a.pathLen = len; a.reqHours = len / NAV_SPEED.hike / (TICKS_PER_DAY / 24); a.pathLift = lift; a.pathGainRel = rel(last % n, (last / n) | 0) - a.startRel;
          }
        }
        if (act === Act.Excursion && gsim.exc.progress(i)?.phase === 1) (a as { reached?: boolean }).reached = true;
        if ((act !== Act.ToTrail && act !== Act.Excursion) || st === GState.Idle) {
          const reached = !!(a as { reached?: boolean }).reached || Math.hypot(x - store.goalX[i]!, y - store.goalY[i]!) <= 4.5;
          a.outcome = reached ? 'done' : (st === GState.Leaving ? outcomeOf(store.leaveReason[i]!) : 'aborted-nopath');
          a.endHour = hour; a.durTicks = t - a.startTick; attempts.push(a); att.delete(id);
          if (reached) r.completed++; else r.aborted++;
        }
      }
      // excursion abstraction: extra path progress while on a hike
      if (sc.excursionEtaTicks && act === Act.ToTrail && st === GState.Walking && store.moveMode[i] === NavMode.Hike) {
        const p = nm.pathOf(i);
        if (p) {
          let extra = excursionState.get(id);
          if (extra === undefined) { extra = Math.max(0, Math.min(7, Math.ceil((p.nodes.length - p.index) / sc.excursionEtaTicks) - 1)); excursionState.set(id, extra); }
          let j = p.index;
          for (let e = 0; e < extra && j + 1 < p.nodes.length; e++) {
            const A = p.nodes[j]!, B = p.nodes[j + 1]!;
            if (Math.abs((A % n) - (B % n)) > 1 || Math.abs(((A / n) | 0) - ((B / n) | 0)) > 1) break; // lift link: normal queue logic
            j++;
          }
          if (j !== p.index) {
            const nd = p.nodes[j]!; const nx = (nd % n) + 0.5, ny = ((nd / n) | 0) + 0.5;
            store.x[i] = nx; store.y[i] = ny; store.z[i] = sim.guestWorld.groundAt(nx, ny); sim.guestSim.hash.move(i, nx, ny);
          }
        }
      } else if (act !== Act.ToTrail) excursionState.delete(id);
      if (r.pref === Pref.Hike && t % 12 === 0 && hourPositions.length < 4000) hourPositions.push({ hour, rel: rr });
    }
  }
  const msPerTick = (performance.now() - t0) / total;
  for (let i = 0; i < store.limit; i++) if (slotId[i]) { const r = recs.get(slotId[i]!); if (r) done.push(r); const a = att.get(slotId[i]!); if (a) { a.durTicks = total - a.startTick; attempts.push(a); } }
  (NAV_SPEED as { hike: number }).hike = orig.hike;
  const excMetrics = { started: gsim.exc.started - exc0.started, finished: gsim.exc.finishedCount - exc0.fin, aborted: gsim.exc.aborted - exc0.ab, turnedBack: gsim.exc.turnedBack - exc0.tb, liftFirst: gsim.exc.liftFirst - exc0.lf, picks: gsim.decider.goals.picks - exc0.picks, topPicks: gsim.decider.goals.top - exc0.top, ...Object.fromEntries(Object.entries(gsim.exc.why).map(([k, v]) => [`why_${k}`, v])), trekStarted: gsim.trekStats.started, trekNights: gsim.trekStats.nights, trekDone: gsim.trekStats.completed, bedRevenue: Math.round(sim.attractions.all().filter((a) => a.spec.beds).reduce((x, a) => x + a.stats.revenue, 0)) };
  gsim.decider.useGoals = true; gsim.exc.enabled = true;
  sim.guestSim.decider.choose = origChoose; gs.abort = origAbort;
  sim.guestWorld.onLiftRide = prevRide;
  const guestsAll = done;
  return {
    scenario: sc.id, size: info.size, seed: info.seed, days, guests: guestsAll.length, hikers: guestsAll.filter((g) => g.pref === Pref.Hike).length, bikers: guestsAll.filter((g) => g.pref === Pref.Bike).length,
    recs: guestsAll, attempts, heat, heatAll, arrivalHist, liftRidesByMode, income: sumLedger() - ledger0, msPerTick, ticks: total, queueTicks, queueGuests: queueGuests.size, info, exc: excMetrics, hourPositions, abortReasons, okTop3Start, okMidStart, okTop3End: okShare(0.67),
  };
}

// ---------- aggregation ----------
const mean = (a: number[]): number => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const median = (a: number[]): number => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]!; };
export const pct = (v: number): string => (Number.isFinite(v) ? `${(v * 100).toFixed(0)}%` : 'n/a');
const hoursOf = (ticks: number): number => (ticks * 24) / TICKS_PER_DAY;

export interface Summary {
  scenario: string; size: Size; runs: number; guests: number; hikers: number;
  hikersWithAttempt: number; attempts: number; completed: number; abortedDusk: number; abortedNeeds: number; abortedSatisfied: number; abortedNoPath: number; open: number; infeasibleShare: number; startHourMean: number;
  top3: number; mid: number; summit: number; meanMaxRel: number; medMaxRel: number; meanHoursAbove50: number; meanHoursAbove67: number;
  arrivalToTrailH: number; stayH: number; stayHikerH: number; arrivalHourMean: number;
  catShare: Record<Cat, number>; catShareAll: Record<Cat, number>; foodShare: number;
  liftRideShareHikers: number; hikerRidesPerHiker: number; liftRidesByMode: Record<string, number>;
  meanPathLen: number; meanPathGain: number; meanGoalRel: number; meanStraight: number; pathWithLift: number;
  meanAttemptHours: number; meanAttemptsPerHiker: number;
  income: number; msPerTick: number; queueShare: number; meanQueueMinPerGuest: number;
  leaveClosingShare: number; leaveHikerClosingShare: number;
  /** Hours spent in the Leaving state (walking out) for hikers who started leaving above 30 % altitude: mean / p90 / n; and the same for everyone else. */
  leaveDurHigh: number[]; leaveDurLow: number[];
  stayPct: number[]; leaveReasons: Record<string, number>; arrivalHist: number[];
  exc: Record<string, number>; liftFirstShare: number;
  heat: number[][]; abortReasons: Record<string, number>; okTop3Start: number; okTop3End: number; okMidStart: number;
}

const leaveDur = (rs: GuestRec[]): number[] => {
  const a = rs.filter((r) => r.leaveStart >= 0 && r.leftTick >= 0 && r.leftTick >= r.leaveStart).map((r) => hoursOf(Math.max(0, (r.arriveTick + r.ticks) - r.leaveStart))).sort((x, y) => x - y);
  return [mean(a), a.length ? a[Math.min(a.length - 1, Math.floor(a.length * 0.9))]! : NaN, a.length];
};
export function summarise(runs: RunResult[]): Summary {
  const recs = runs.flatMap((r) => r.recs), hik = recs.filter((r) => r.pref === Pref.Hike);
  const at = runs.flatMap((r) => r.attempts).filter((a) => a.mode === NavMode.Hike);
  const sumCat = (rs: GuestRec[]): Record<Cat, number> => {
    const o = {} as Record<Cat, number>; let tot = 0; for (const c of CATS) { o[c] = rs.reduce((a, r) => a + r.cat[c], 0); tot += o[c]; }
    for (const c of CATS) o[c] = tot ? o[c] / tot : 0; return o;
  };
  const closed = recs.filter((r) => r.leaveReason === Leave.Closing).length;
  const hClosed = hik.filter((r) => r.leaveReason === Leave.Closing).length;
  const stay = (rs: GuestRec[]): number => mean(rs.filter((r) => r.leftTick >= 0).map((r) => hoursOf(r.ticks)));
  const trailLat = hik.filter((r) => r.firstTrailTick >= 0).map((r) => hoursOf(r.firstTrailTick - r.arriveTick));
  const heat = Array.from({ length: 24 }, (_, h) => Array.from({ length: HIST_ALT_BANDS }, (_, b) => runs.reduce((a, r) => a + r.heat[h]![b]!, 0)));
  const rides = { hike: 0, bike: 0, ski: 0, walk: 0 } as Record<string, number>;
  for (const r of runs) for (const k of Object.keys(rides)) rides[k]! += r.liftRidesByMode[k] ?? 0;
  const guestTicks = recs.reduce((a, r) => a + r.ticks, 0);
  const qTicks = runs.reduce((a, r) => a + r.queueTicks, 0);
  return {
    scenario: runs[0]!.scenario, size: runs[0]!.size, runs: runs.length, guests: recs.length, hikers: hik.length,
    hikersWithAttempt: hik.filter((r) => r.attempts > 0).length, attempts: at.length,
    completed: at.filter((a) => a.outcome === 'done').length, abortedDusk: at.filter((a) => a.outcome === 'aborted-dusk').length,
    abortedNeeds: at.filter((a) => a.outcome === 'aborted-needs').length, abortedSatisfied: at.filter((a) => a.outcome === 'aborted-satisfied').length, abortedNoPath: at.filter((a) => a.outcome === 'aborted-nopath').length,
    infeasibleShare: at.filter((a) => a.pathLen >= 0).length ? at.filter((a) => a.pathLen >= 0 && a.startHour + a.reqHours > 17).length / at.filter((a) => a.pathLen >= 0).length : NaN, startHourMean: mean(at.map((a) => a.startHour)), open: at.filter((a) => a.outcome === 'open').length,
    top3: hik.length ? hik.filter((r) => r.maxRel >= 0.67).length / hik.length : NaN,
    mid: hik.length ? hik.filter((r) => r.maxRel >= 0.5).length / hik.length : NaN,
    summit: hik.length ? hik.filter((r) => r.nearSummit).length / hik.length : NaN,
    meanMaxRel: mean(hik.map((r) => r.maxRel)), medMaxRel: median(hik.map((r) => r.maxRel)),
    meanHoursAbove50: mean(hik.map((r) => hoursOf(r.ticksAbove50))), meanHoursAbove67: mean(hik.map((r) => hoursOf(r.ticksAbove67))),
    arrivalToTrailH: mean(trailLat), stayH: stay(recs.filter((r) => !r.overnight)), stayHikerH: stay(hik.filter((r) => !r.overnight)), arrivalHourMean: mean(recs.map((r) => r.arriveHour)),
    catShare: sumCat(hik), catShareAll: sumCat(recs), foodShare: hik.reduce((a, r) => a + r.foodTicks, 0) / Math.max(1, hik.reduce((a, r) => a + r.ticks, 0)),
    liftRideShareHikers: hik.length ? hik.filter((r) => r.rodeLift).length / hik.length : NaN, hikerRidesPerHiker: mean(hik.map((r) => r.liftRides)), liftRidesByMode: rides,
    meanPathLen: mean(at.filter((a) => a.pathLen >= 0).map((a) => a.pathLen)), meanPathGain: mean(at.filter((a) => a.pathLen >= 0).map((a) => a.pathGainRel)),
    meanGoalRel: mean(at.map((a) => a.goalRel)), meanStraight: mean(at.map((a) => a.straight)),
    pathWithLift: at.filter((a) => a.pathLen >= 0).length ? at.filter((a) => a.pathLift).length / at.filter((a) => a.pathLen >= 0).length : NaN,
    meanAttemptHours: mean(at.filter((a) => a.outcome === 'done').map((a) => hoursOf(a.durTicks))), meanAttemptsPerHiker: hik.length ? at.length / hik.length : NaN,
    income: mean(runs.map((r) => r.income)), msPerTick: mean(runs.map((r) => r.msPerTick)),
    queueShare: guestTicks ? qTicks / guestTicks : NaN, meanQueueMinPerGuest: recs.length ? (qTicks * 6) / recs.length : NaN,
    leaveClosingShare: recs.length ? closed / recs.length : NaN, leaveHikerClosingShare: hik.length ? hClosed / hik.length : NaN,
    leaveDurHigh: leaveDur(hik.filter((r) => r.leaveStartRel >= 0.3)), leaveDurLow: leaveDur(recs.filter((r) => r.leaveStartRel < 0.3)),
    stayPct: [0.1, 0.5, 0.9].map((q) => { const a = recs.filter((r) => !r.overnight && r.leftTick >= 0).map((r) => hoursOf(r.ticks)).sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * q))]! : NaN; }),
    leaveReasons: recs.reduce((o, r) => { const k = ['none', 'satisfied', 'bored', 'broke', 'tired', 'closing', 'injured'][r.leaveReason] ?? '?'; o[k] = (o[k] ?? 0) + 1; return o; }, {} as Record<string, number>),
    arrivalHist: Array.from({ length: 24 }, (_, h) => runs.reduce((a, r) => a + r.arrivalHist[h]!, 0)),
    okTop3Start: mean(runs.map((r) => r.okTop3Start)), okTop3End: mean(runs.map((r) => r.okTop3End)), okMidStart: mean(runs.map((r) => r.okMidStart)),
    exc: runs.reduce((o, r) => { for (const [k, v] of Object.entries(r.exc)) o[k] = (o[k] ?? 0) + v; return o; }, {} as Record<string, number>),
    liftFirstShare: runs.reduce((a, r) => a + r.exc.liftFirst, 0) / Math.max(1, runs.reduce((a, r) => a + r.exc.started, 0)),
    heat, abortReasons: runs.reduce((o, r) => { for (const [k, v] of Object.entries(r.abortReasons)) o[k] = (o[k] ?? 0) + v; return o; }, {} as Record<string, number>),
  };
}

/** Real-world unit conversions for the speed table. */
export function speedTable(): Array<{ what: string; tilesPerTick: number; tilesPerHour: number; kmh: number }> {
  const mk = (what: string, tpt: number) => ({ what, tilesPerTick: tpt, tilesPerHour: tpt * (TICKS_PER_DAY / 24), kmh: (tpt * (TICKS_PER_DAY / 24) * TILE_METRES) / 1000 });
  return [mk('walk on path', NAV_SPEED.walk), mk('hike on trail (off-path)', NAV_SPEED.hike), mk('bike off-path downhill', NAV_SPEED.bike), mk('bike on path', NAV_SPEED.bike * 0.6), mk('ski base', NAV_SPEED.skiBase)];
}
export { GuestType };
