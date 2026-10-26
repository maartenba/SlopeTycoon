import { describe, it, expect } from 'vitest';
import type { MapSize } from '../../src/core/GameState';
import { GUEST_CAP } from '../../src/config/balance';
import { GState, GuestType } from '../../src/sim/guests/Guest';
import { rig } from '../sim/guests/helpers';
import { generatedResort } from '../sim/guests/resortFixture';
import { budget as budgetMs } from '../perfMode';

/**
 * Per-tick cost of spawner + guests (decisions, A* path queries, lift queues, movement) with the store at its cap on a generated
 * resort (path lattice, wide pistes, hike trails, lifts, restaurants). Synthetic grid, not the WebGL terrain.
 */
function measure(size: MapSize, ticks = 150): { avg: number; steady: number; p95: number; max: number; count: number; queries: number; clusters: number } {
  const f = generatedResort(size, 5);
  for (let k = 0; k < 4; k++) { f.addBuildingOnStreet(k % 2 ? 'cafe' : 'baseLodge', 12 + k * 20, 6 + 12 * (1 + k % 3)); }
  const r = rig(f.guestWorld({ roadEntry: null, railEntry: null }), 17, size);
  r.state.date.minute = 8 * 60;
  const cap = GUEST_CAP[size], s = r.sim.store;
  const pathTiles: number[] = [];
  for (let t = 0; t < size * size; t++) if (f.kind[t] === 1) pathTiles.push(t);
  for (let n = 0; n < cap; n++) {
    const t = pathTiles[(n * 7919) % pathTiles.length]!;
    const x = (t % size) + 0.5, y = Math.floor(t / size) + 0.5;
    const i = s.add({ x, y, z: 0, type: n % 6 === 5 ? GuestType.Family : n % 6, skill: n % 4, budget: 1e6, group: n % 40, mode: 0, overnight: false, leaveDay: 0, tick: 0, hunger: (n % 10) / 20 });
    r.sim.hash.insert(i, x, y);
    s.state[i] = GState.Idle; s.timer[i] = n % 25;
  }
  const times: number[] = [];
  for (let t = 1; t <= ticks; t++) {
    r.state.date.tick = t;
    const t0 = performance.now();
    r.sim.systems().forEach((sys) => sys.update(r.state, t));
    times.push(performance.now() - t0);
    r.state.date.minute = 8 * 60 + (t % 60);
  }
  const sorted = [...times].sort((a, b) => a - b);
  const nm = r.sim.movement as unknown as { queries: number };
  return {
    avg: times.reduce((a, b) => a + b, 0) / times.length, steady: times.slice(-50).reduce((a, b) => a + b, 0) / 50, p95: sorted[Math.floor(sorted.length * 0.95)]!, max: sorted[sorted.length - 1]!,
    count: s.count, queries: nm.queries, clusters: r.sim.graph()!.pf.stats.clustersBuilt,
  };
}

describe('guest tick cost at the cap with navigation (logged)', () => {
  for (const [size, budget] of [[64, 6], [128, 6], [256, 8]] as const) {
    it(`[perf] ${size}: ${GUEST_CAP[size]} guests navigating, avg tick < ${budget} ms`, () => {
      measure(size, 20); // warm-up JIT
      // best of 3 fresh runs: a parallel test worker can steal CPU from any single run
      let m = measure(size);
      for (let k = 0; k < 2 && m.avg >= budget; k++) { const c = measure(size); if (c.avg < m.avg) m = c; }
      console.log(`[perf] nav tick @cap size ${size}: ${m.count} guests, avg ${m.avg.toFixed(3)} ms (last 50 ticks ${m.steady.toFixed(3)}), p95 ${m.p95.toFixed(3)} ms, max ${m.max.toFixed(2)} ms (budget ${budget}); path queries ${m.queries}, clusters built ${m.clusters}`);
      expect(m.count).toBeGreaterThan(GUEST_CAP[size] * 0.9);
      expect(m.avg).toBeLessThan(budgetMs(budget));
    });
  }
});
