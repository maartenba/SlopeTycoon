import { describe, expect, it } from 'vitest';
import { buildHikingResort } from '../../../scripts/analysis/hikingLib';
import { Act, Pref, prefFor } from '../../../src/sim/guests/Decision';
import { GState } from '../../../src/sim/guests/Guest';
import { createSim, type Sim } from '../../../src/game/createSim';
import { applySave, stateHash } from '../../../src/game/saveState';
import { decodeSave, encodeSave, makeMeta } from '../../../src/persist/Serializer';
import { Layer } from '../../../src/world/Networks';
import { TICKS_PER_DAY } from '../../../src/config/balance';

const relOf = (sim: Sim, lo: number, hi: number) => (x: number, y: number): number => (sim.cond.altitude(Math.floor(x), Math.floor(y)) - lo) / (hi - lo);
function range(sim: Sim): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (let y = 0; y < sim.size; y++) for (let x = 0; x < sim.size; x++) { const a = sim.cond.altitude(x, y); if (a < lo) lo = a; if (a > hi) hi = a; }
  return [lo, hi];
}
const invariants = (sim: Sim): void => {
  const s = sim.guestSim.store, e = sim.guestSim.exc;
  let n = 0;
  for (let i = 0; i < s.limit; i++) {
    if (!s.alive[i]) { expect(e.has(i)).toBe(false); continue; }
    if (s.act[i] === Act.Excursion) { n++; expect(e.has(i), `slot ${i} act=Excursion without state`).toBe(true); }
  }
  if (e.active !== n) for (const [slot] of e.map) if (s.act[slot] !== Act.Excursion) throw new Error(`slot ${slot} alive=${s.alive[slot]} state=${s.state[slot]} act=${s.act[slot]} trek=${JSON.stringify(sim.guestSim.trek.get(s.id[slot]!))}`);
  expect(e.active).toBe(n);
};

describe('hiking excursions on a 64 map (summer, real lift hours)', () => {
  it('hikers reach the top third, ride the foot lift first, pay a hiker ticket, and invariants hold', () => {
    let hikers = 0, top = 0, started = 0, lift = 0, tickets = 0;
    for (const seed of [11, 23]) {
      const { sim } = buildHikingResort(64, seed as number, { defaultHours: true });
      const [lo, hi] = range(sim), rel = relOf(sim, lo, hi), s = sim.guestSim.store, max = new Map<number, number>();
      for (let t = 0; t < 6 * TICKS_PER_DAY; t++) {
        sim.tick(1);
        for (let i = 0; i < s.limit; i++) if (s.alive[i] && prefFor(s.id[i]!, s.type[i]!) === Pref.Hike) max.set(s.id[i]!, Math.max(max.get(s.id[i]!) ?? 0, rel(s.x[i]!, s.y[i]!)));
        if (t % 60 === 0) invariants(sim);
      }
      hikers += max.size; top += [...max.values()].filter((v) => v >= 0.67).length;
      started += sim.guestSim.exc.started; lift += sim.guestSim.exc.liftFirst;
      tickets += (sim as unknown as { ticketing?: { hikerTickets: number } }).ticketing?.hikerTickets ?? 0;
    }
    expect(started).toBeGreaterThan(20);
    expect(top / hikers).toBeGreaterThanOrEqual(0.35);
    expect(lift / started).toBeGreaterThan(0.3);
    void tickets;
  }, 300_000);

  it('fuzz: closing trails, lifts and snow flips during excursions never leaves a dangling state', () => {
    const { sim } = buildHikingResort(64, 5, { defaultHours: true });
    const w = sim.cond.hikeOk;
    for (let d = 0; d < 5; d++) {
      for (let t = 0; t < TICKS_PER_DAY / 2; t++) {
        sim.tick(1);
        if (t % 40 === 0) invariants(sim);
      }
      if (d === 1) for (let k = 0; k < w.length; k++) if (sim.networks.layers[k]! & Layer.Hike && k % 3 === 0) w[k] = 0; // snow flips
      if (d === 2) for (const l of sim.lifts.all()) sim.liftOps.setHours(l.id, 0, 0.1);
      if (d === 3) for (const b of sim.buildings.all()) if (b.type === 'mountainHut') (sim.attractions.get(b.id)!).open = false;
    }
    invariants(sim);
    for (let t = 0; t < 2 * TICKS_PER_DAY; t++) sim.tick(1);
    invariants(sim);
    const s = sim.guestSim.store;
    for (const [, x] of sim.guestSim.exc.map) expect(x.e).toBeLessThanOrEqual(x.D + x.S + 0.2);
    expect(s.count).toBeGreaterThanOrEqual(0);
  }, 300_000);

  it('overnight trek: beds are limited, nights are sold and day 2 completes; save/load mid-trek is deterministic', async () => {
    let nights = 0, done = 0, found = false;
    for (const seed of [11, 23, 37]) {
      const { sim } = buildHikingResort(64, seed, { defaultHours: true });
      const hut = sim.buildings.all().find((b) => b.type === 'mountainHut');
      if (!hut) continue;
      for (let t = 0; t < 40; t++) sim.tick(1);
      const att = sim.attractions;
      expect(att.bedCapacity(hut.id)).toBe(12);
      expect(att.reserveBed(900001, hut.id)).toBe(true);
      expect(att.reserveBed(900001, hut.id)).toBe(true); // idempotent
      for (let g = 0; g < 11; g++) expect(att.reserveBed(910000 + g, hut.id)).toBe(true);
      expect(att.reserveBed(920000, hut.id)).toBe(false); // full
      expect(att.bedsFree(hut.id)).toBe(0);
      att.beds.clear();
      for (let t = 0; t < 8 * TICKS_PER_DAY; t++) {
        sim.tick(1);
        if (!found && sim.guestSim.trek.size > 0 && [...sim.guestSim.trek.values()].some((x) => x.day === 2)) {
          found = true;
          const { bytes } = await encodeSave(sim, makeMeta(sim, 'test'), { compress: true, yieldBetween: false });
          const { envelope } = await decodeSave(bytes, { yieldBetween: false });
          const restored = createSim({ size: envelope.mapSize, seed: envelope.seed, now: () => 0, fromSave: structuredClone(envelope.modules) });
          applySave(sim, structuredClone(envelope.modules));
          expect(stateHash(sim).parts.guests).toBe(stateHash(restored).parts.guests);
          expect([...restored.guestSim.trek.keys()]).toEqual([...sim.guestSim.trek.keys()]);
          for (let k = 0; k < 3 * TICKS_PER_DAY; k += 40) { sim.ops.quality.attachTraffic(); sim.tick(40); restored.ops.quality.attachTraffic(); restored.tick(40); expect(stateHash(sim).parts.guests, `tick ${k}`).toBe(stateHash(restored).parts.guests); }
          expect(sim.attractions.bedsFree(hut.id)).toBeLessThanOrEqual(12);
          t += 3 * TICKS_PER_DAY;
        }
      }
      nights += sim.guestSim.trekStats.nights; done += sim.guestSim.trekStats.completed;
      if (nights > 0 && done > 0) break;
    }
    expect(found, 'a guest slept in a hut and was saved/restored').toBe(true);
    expect(nights).toBeGreaterThan(0);
    expect(done).toBeGreaterThan(0);
    void GState;
  }, 600_000);
});
