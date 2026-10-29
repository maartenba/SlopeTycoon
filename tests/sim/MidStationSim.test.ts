import { describe, expect, it } from 'vitest';
import { createSim, type Sim } from '../../src/game/createSim';
import { buildStarterResort } from '../../src/game/starterResort';
import { applySave, stateHash } from '../../src/game/saveState';
import { decodeSave, encodeSave, makeMeta } from '../../src/persist/Serializer';
import { demolishLift, placeLift, stationAnchor, type LiftData, type StationSite } from '../../src/sim/Lift';
import { TICKS_PER_DAY } from '../../src/config/balance';

/** A real 64 map with a gondola whose line carries a mid-station (the starter gondola is rebuilt with one). Null when no valid mid-station site exists on that seed. */
function midResort(seed: number): { sim: Sim; lift: LiftData } | null {
  const sim = createSim({ size: 64, seed, startSeason: 'winter', now: () => 0 });
  const rep = buildStarterResort(sim, { lifts: 1, liftKind: 'gondola6', funds: 5_000_000 });
  const l0 = rep.lifts[0];
  if (!l0) return null;
  const b: StationSite = { x: l0.bottom.x, y: l0.bottom.y }, t: StationSite = { x: l0.top.x, y: l0.top.y };
  const env = { grid: sim.grid, lifts: sim.lifts, economy: sim.economy, props: sim.props, buildings: sim.buildings };
  demolishLift(sim.lifts, sim.economy, l0.id);
  for (const u of [0.5, 0.45, 0.55, 0.4, 0.6, 0.35, 0.65]) {
    const m = stationAnchor(sim.grid, b.x + 1 + (t.x - b.x) * u, b.y + 1 + (t.y - b.y) * u);
    const out = placeLift(env, sim.props, 'gondola6', b, t, true, true, [m]);
    if (out.ok && out.lift) { sim.nature.cover.rebuild(); return { sim, lift: out.lift }; }
  }
  return null;
}

describe('N-station lift in a real sim (Tasks 36-38)', () => {
  it('runs a day with guests, never overloads a carrier, and survives a save / load round trip with the same hash', async () => {
    let tested = 0;
    for (const seed of [11, 23, 5, 61, 9, 37]) {
      const r = midResort(seed);
      if (!r) continue;
      const { sim, lift } = r;
      expect(lift.stations).toHaveLength(3);
      for (let t = 0; t < 5 * TICKS_PER_DAY; t++) sim.tick(1); // 5 days: the carrier-capacity invariant holds throughout
      expect(sim.lifts.get(lift.id)!.riders?.total ?? 0, 'guests rode the lift').toBeGreaterThan(0);
      expect(sim.guestSim.queues.maxCarrierLoad).toBeLessThanOrEqual(6);
      const { bytes } = await encodeSave(sim, makeMeta(sim, 'mid'), { compress: true, yieldBetween: false });
      const { envelope } = await decodeSave(bytes, { yieldBetween: false });
      const restored = createSim({ size: envelope.mapSize, seed: envelope.seed, now: () => 0, fromSave: structuredClone(envelope.modules) });
      applySave(sim, structuredClone(envelope.modules));
      expect(restored.lifts.get(lift.id)!.stations).toHaveLength(3);
      expect(stateHash(restored).parts.lifts).toBe(stateHash(sim).parts.lifts);
      expect(stateHash(restored).parts.guests).toBe(stateHash(sim).parts.guests);
      for (let k = 0; k < 2 * 40; k += 40) {
        sim.ops.quality.attachTraffic(); sim.tick(40); restored.ops.quality.attachTraffic(); restored.tick(40);
        expect(stateHash(restored).parts.guests, `tick ${k}`).toBe(stateHash(sim).parts.guests);
      }
      tested++;
      if (tested >= 2) break;
    }
    expect(tested, 'at least one seed has a valid mid-station site').toBeGreaterThan(0);
  }, 240_000);
});
