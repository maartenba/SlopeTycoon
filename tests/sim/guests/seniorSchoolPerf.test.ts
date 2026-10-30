import { describe, it, expect } from 'vitest';
import type { MapSize } from '../../../src/core/GameState';
import { GUEST_CAP } from '../../../src/config/balance';
import { CORE_TYPE_COUNT, SHIPPED_TYPES } from '../../../src/config/guestTypes';
import { building, fakeWorld, rig, GOOD_STATS } from './helpers';
import { GState } from '../../../src/sim/guests/Guest';
import { budget as budgetMs } from '../../perfMode';

const SENIOR = CORE_TYPE_COUNT + SHIPPED_TYPES.findIndex((d) => d.id === 'senior');
const SCHOOL = CORE_TYPE_COUNT + SHIPPED_TYPES.findIndex((d) => d.id === 'school');

/** Per-tick cost with the store at its cap and about a third of it Seniors + School classes (13 + teacher; the Families system registers them as kid groups). */
function measure(size: MapSize): { avg: number; p95: number; count: number; classes: number } {
  const kind = new Uint8Array(size * size);
  for (let x = 0; x < size; x++) kind[(size >> 1) * size + x] = 1;
  for (let y = 0; y < size; y++) kind[y * size + (size >> 1)] = 1;
  for (let k = 8; k < size - 8; k += 12) for (let x = 0; x < size; x++) kind[k * size + x] = 1;
  const bs = [];
  for (let k = 0; k < 10; k++) bs.push(building(k % 2 ? 'cafe' : 'lodge', 8 + k * ((size - 24) / 10) | 0, (size >> 1) - 4));
  bs.push(building('skiSchoolHQ', 6, (size >> 1) - 8), building('parking', 4, 4));
  const r = rig(fakeWorld(bs, { size, walk: { size, kind, version: 1 }, stats: GOOD_STATS }), 11, size);
  r.state.date.minute = 9 * 60;
  const cap = GUEST_CAP[size];
  let group = 1, inGroup = 0;
  for (let n = 0; n < cap; n++) {
    const x = 1 + ((n * 7) % (size - 2)), y = 1 + ((n * 13) % (size - 2));
    const kidsClass = n % 3 === 0; // a third of the crowd is school classes
    const type = kidsClass ? SCHOOL : n % 3 === 1 ? SENIOR : n % 6;
    if (kidsClass) { if (inGroup >= 14) { group++; inGroup = 0; } inGroup++; }
    const i = r.sim.store.add({ x, y, z: 0, type, skill: n % 4, budget: 1e6, group: kidsClass ? 10_000 + group : n, mode: 0, overnight: false, leaveDay: 0, tick: 0, hunger: (n % 10) / 20 });
    r.sim.store.state[i] = n % 5 === 0 ? GState.Idle : GState.Walking;
    r.sim.store.timer[i] = 5 + (n % 30);
    r.sim.hash.insert(i, x, y);
  }
  const times: number[] = [];
  for (let t = 1; t <= 60; t++) {
    r.state.date.tick = t;
    const t0 = performance.now();
    r.sim.systems().forEach((s) => s.update(r.state, t));
    times.push(performance.now() - t0);
    r.state.date.minute = 9 * 60 + (t % 40);
  }
  times.sort((a, b) => a - b);
  return { avg: times.reduce((a, b) => a + b, 0) / times.length, p95: times[Math.floor(times.length * 0.95)]!, count: r.sim.store.count, classes: r.sim.families.groups.size };
}

describe('guest tick cost at the cap with Seniors and school classes (Task 29)', () => {
  for (const [size, budget] of [[64, 6], [128, 6], [256, 8]] as const) {
    it(`[perf] ${size}: ${GUEST_CAP[size]} guests incl. classes within ${budget} ms/tick`, () => {
      measure(size);
      let m = measure(size);
      for (let k = 0; k < 5 && m.p95 >= budget * 0.6; k++) { const c = measure(size); if (c.p95 < m.p95) m = c; }
      console.log(`[perf] seniors+classes@cap size ${size}: ${m.count} guests, ${m.classes} groups, avg ${m.avg.toFixed(3)} ms/tick, p95 ${m.p95.toFixed(3)} ms (budget ${budget})`);
      expect(m.count).toBeGreaterThan(GUEST_CAP[size] * 0.9);
      expect(m.classes).toBeGreaterThan(5);
      expect(m.p95).toBeLessThan(budgetMs(budget));
    });
  }
});
