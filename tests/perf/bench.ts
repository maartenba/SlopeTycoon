import { createSim } from '../../src/game/createSim';
import { buildStarterResort } from '../../src/game/starterResort';
import { GUEST_CAP } from '../../src/config/balance';

export interface SysStat { avg: number; p95: number; max: number }
export interface BenchResult {
  size: 64 | 128 | 256; seed: number;
  genMs: number; starterMs: number;
  guestsPeak: number; guestCap: number; ticksAtCap: number; ticksMeasured: number;
  /** All measured ticks. */
  tick: SysStat;
  /** Only ticks with >= 90 % of the cap alive (the acceptance condition). */
  tickAtCap: SysStat;
  systems: Record<string, SysStat>;
  heapMB: number; rssMB: number;
  saveKB: number;
}

const stat = (a: number[]): SysStat => {
  if (!a.length) return { avg: 0, p95: 0, max: 0 };
  const s = [...a].sort((x, y) => x - y);
  return { avg: a.reduce((x, y) => x + y, 0) / a.length, p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]!, max: s[s.length - 1]! };
};


export interface BenchOpts { size: 64 | 128 | 256; seed?: number; days?: number; warmupTicks?: number; startDay?: number }

/** Runs the sim headless with registry systems timed individually (same order as the registry). */
export function runBench(o: BenchOpts): BenchResult {
  const seed = o.seed ?? 1337, size = o.size, days = o.days ?? 2;
  const t0 = performance.now();
  const sim = createSim({ size, seed, startDay: o.startDay ?? 335 });
  const genMs = performance.now() - t0;
  const t1 = performance.now();
  buildStarterResort(sim);
  const starterMs = performance.now() - t1;
  const cap = GUEST_CAP[size];
  const st = sim.guestSim.store;
  const ids = sim.registry.ids();
  const systems = ids.map((id) => sim.registry.get(id)!);
  const per: Record<string, number[]> = Object.fromEntries(ids.map((id) => [id, []]));
  const totals: number[] = [], totalsCap: number[] = [];
  let tick = 0, peak = 0;
  const step = (record: boolean): void => {
    tick++;
    const hr = sim.game.date.minute / 60;
    if (hr >= 7.5 && hr <= 16.5) sim.guestSim.spawner.benchFill(sim.game, cap, 300);
    const ts = performance.now();
    for (let i = 0; i < systems.length; i++) {
      const a = performance.now();
      systems[i]!.update(sim.game, tick);
      if (record) per[ids[i]!]!.push(performance.now() - a);
    }
    if (record) {
      const d = performance.now() - ts;
      totals.push(d);
      if (st.count >= cap * 0.9) totalsCap.push(d);
    }
    if (st.count > peak) peak = st.count;
  };
  // warm-up: run a few ticks so the first wave is spread out (not recorded). The clock is a tick counter, advance the date with it.
  for (let i = 0; i < (o.warmupTicks ?? 60); i++) step(false);
  const n = Math.round(days * 240);
  for (let i = 0; i < n; i++) step(true);
  const mem = process.memoryUsage();
  const save = JSON.stringify(sim.registry.serialize()).length + JSON.stringify(sim.buildings.serialize()).length + JSON.stringify(sim.lifts.serialize()).length;
  return {
    size, seed, genMs, starterMs, guestsPeak: peak, guestCap: cap, ticksAtCap: totalsCap.length, ticksMeasured: totals.length,
    tick: stat(totals), tickAtCap: stat(totalsCap),
    systems: Object.fromEntries(ids.map((id) => [id, stat(per[id]!)])),
    heapMB: mem.heapUsed / 1048576, rssMB: mem.rss / 1048576, saveKB: save / 1024,
  };
}

export const fmt = (r: BenchResult): string => {
  const f = (x: number): string => x.toFixed(2);
  const sys = Object.entries(r.systems).sort((a, b) => b[1].avg - a[1].avg).map(([k, v]) => `${k} ${f(v.avg)}/${f(v.p95)}/${f(v.max)}`).join('  ');
  return `size ${r.size}: gen ${r.genMs.toFixed(0)} ms (+starter ${r.starterMs.toFixed(0)}) | guests peak ${r.guestsPeak}/${r.guestCap} (${r.ticksAtCap}/${r.ticksMeasured} ticks at cap) | tick all avg ${f(r.tick.avg)} p95 ${f(r.tick.p95)} max ${f(r.tick.max)} | at-cap avg ${f(r.tickAtCap.avg)} p95 ${f(r.tickAtCap.p95)} max ${f(r.tickAtCap.max)} | heap ${r.heapMB.toFixed(0)} MB rss ${r.rssMB.toFixed(0)} | save ${r.saveKB.toFixed(0)} KB\n   systems avg/p95/max ms: ${sys}`;
};
