import { createSim, type Sim } from '../../src/game/createSim';
import { buildStarterResort, type StarterReport, type StarterOptions } from '../../src/game/starterResort';
import { stateHash } from '../../src/sim/Systems';
import { GState } from '../../src/sim/guests/Guest';
import type { GameEvents } from '../../src/core/events';

export const TICKS_PER_DAY = 240;

export interface Resort { sim: Sim; report: StarterReport }

export function makeResort(size: 64 | 128 | 256, seed: number, o: { startDay?: number; starter?: StarterOptions; defaultHours?: boolean } = {}): Resort {
  const sim = createSim({ size, seed, startDay: o.startDay, now: () => 0 });
  const report = buildStarterResort(sim, o.starter);
  // Big maps have multi-hour walks from the entry to the lifts: smoke runs use long opening hours so rides happen within a few days
  // (schedule behaviour itself is covered by tests/sim/LiftOps.test.ts).
  if (!o.defaultHours) for (const l of sim.lifts.all()) sim.liftOps.setHours(l.id, 6, 22);
  return { sim, report };
}

/** Counts every event kind of interest + lift rides. */
export function attachCounters(sim: Sim): { events: Record<string, number>; rides: number } {
  const c = { events: {} as Record<string, number>, rides: 0 };
  const kinds: Array<keyof GameEvents> = [
    'guest:arrived', 'guest:left', 'lift:built', 'lift:opened', 'lift:closed', 'money:changed', 'season:changed', 'day:changed', 'month:changed', 'year:changed',
    'ops:grooming', 'weather:changed', 'attraction:opened', 'attraction:closed', 'incident:injury', 'incident:created', 'incident:resolved', 'rating:changed', 'finance:monthClosed',
  ];
  for (const k of kinds) (sim.bus.on as (k: string, h: () => void) => void)(k, () => { c.events[k] = (c.events[k] ?? 0) + 1; });
  const prev = sim.guestWorld.onLiftRide;
  sim.guestWorld.onLiftRide = (l, id) => { c.rides++; prev?.(l, id); };
  return c;
}

/** Every NaN / non-finite value in the sim's typed arrays + money. Empty = clean. */
export function scanProblems(sim: Sim): string[] {
  const out: string[] = [];
  const st = sim.guestSim.store;
  const size = sim.size;
  const f32: Array<[string, Float32Array]> = [
    ['x', st.x], ['y', st.y], ['z', st.z], ['px', st.px], ['py', st.py], ['pz', st.pz], ['hunger', st.hunger], ['fatigue', st.fatigue],
    ['happiness', st.happiness], ['budget', st.budget], ['goalX', st.goalX], ['goalY', st.goalY], ['skillXp', st.skillXp],
  ];
  for (let i = 0; i < st.limit; i++) {
    if (!st.alive[i]) continue;
    for (const [n, a] of f32) if (!Number.isFinite(a[i]!)) { out.push(`guest ${i} ${n}=${a[i]}`); break; }
    if (st.x[i]! < -1 || st.y[i]! < -1 || st.x[i]! > size + 1 || st.y[i]! > size + 1) out.push(`guest ${i} out of map (${st.x[i]}, ${st.y[i]})`);
    for (const [n, a] of [['hunger', st.hunger], ['fatigue', st.fatigue], ['happiness', st.happiness]] as const) if (a[i]! < -0.001 || a[i]! > 1.001) out.push(`guest ${i} ${n} out of [0,1]: ${a[i]}`);
  }
  const g = sim.grid.snowDepth;
  for (let i = 0; i < g.length; i++) if (!Number.isFinite(g[i]!) || g[i]! < 0) { out.push(`snowDepth[${i}]=${g[i]}`); break; }
  const q = sim.ops.quality.state;
  for (let i = 0; i < q.length; i++) if (!Number.isFinite(q[i]!)) { out.push(`quality[${i}]=${q[i]}`); break; }
  if (!Number.isFinite(sim.game.money)) out.push(`money=${sim.game.money}`);
  for (const [k, v] of Object.entries(sim.economy.ledger)) if (!Number.isFinite(v)) out.push(`ledger ${k}=${v}`);
  for (const [k, v] of Object.entries(sim.economy.expenses)) if (!Number.isFinite(v)) out.push(`expense ${k}=${v}`);
  return out;
}

/** Tracks per-guest runs of identical (state, activity, position): the longest run per state = softlock detector. */
export class StallTracker {
  readonly maxRun: Record<number, number> = {};
  readonly worst: Record<number, string> = {};
  private runs = new Map<number, { key: string; n: number }>();
  constructor(private sim: Sim) {}
  step(): void {
    const st = this.sim.guestSim.store;
    for (let i = 0; i < st.limit; i++) {
      if (!st.alive[i]) continue;
      const id = st.id[i]!;
      const s = st.state[i]!;
      const key = `${s}/${st.act[i]}/${Math.round(st.x[i]! * 2)},${Math.round(st.y[i]! * 2)}/${st.target[i]}/${st.liftId[i]}`;
      const r = this.runs.get(id);
      if (r && r.key === key) {
        r.n++;
        if (r.n > (this.maxRun[s] ?? 0)) { this.maxRun[s] = r.n; this.worst[s] = `guest ${id} state ${s} act ${st.act[i]} at ${st.x[i]!.toFixed(1)},${st.y[i]!.toFixed(1)} target ${st.target[i]} lift ${st.liftId[i]}`; }
      } else this.runs.set(id, { key, n: 0 });
    }
    if (this.runs.size > 6000) { const alive = new Set<number>(); for (let i = 0; i < st.limit; i++) if (st.alive[i]) alive.add(st.id[i]!); for (const id of this.runs.keys()) if (!alive.has(id)) this.runs.delete(id); }
  }
}

export interface RunOpts { days: number; scanEvery?: number; stall?: StallTracker }

export function run(sim: Sim, o: RunOpts): string[] {
  const problems: string[] = [];
  const total = Math.round(o.days * TICKS_PER_DAY), every = o.scanEvery ?? 40;
  for (let t = 1; t <= total; t++) {
    sim.tick(1);
    o.stall?.step();
    if (t % every === 0) for (const p of scanProblems(sim)) problems.push(`tick ${t}: ${p}`);
  }
  for (const p of scanProblems(sim)) problems.push(`end: ${p}`);
  return problems.slice(0, 20);
}

export const fullHash = (sim: Sim): string => `${stateHash(sim.game, sim.registry)}-${sim.guestSim.store.hash()}`;
export { GState };
