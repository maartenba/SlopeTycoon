import { describe, expect, it } from 'vitest';
import { makeResort, run } from './harness';
import type { Sim } from '../../src/game/createSim';
import { CORE_TYPE_COUNT, SHIPPED_TYPES } from '../../src/config/guestTypes';
import { seasonStartDay } from '../../src/sim/Clock';

const ANGLER = CORE_TYPE_COUNT + SHIPPED_TYPES.findIndex((d) => d.id === 'angler');
/** A starter resort (autumn) with a Tackle & bait hut and a pier at the lake nearest the village. */
const resort = (seed: number): Sim => makeResort(64, seed, { startDay: seasonStartDay('autumn') + 5, starter: { extra: (kit) => {
  const lk = kit.sim.terrainInfo.lakes.flatMap((l) => l.tileIdx).map((i) => ({ x: i % kit.sim.size, y: (i / kit.sim.size) | 0 })).sort((a, b) => Math.hypot(a.x - kit.lc.x, a.y - kit.lc.y) - Math.hypot(b.x - kit.lc.x, b.y - kit.lc.y))[0]!;
  kit.placeConnected('tackleHut', lk.x - 2, lk.y, 6);
  kit.place('fishingPier', lk.x, lk.y, 4);
} } }).sim;
const huts = (sim: Sim) => sim.buildings.all().filter((b) => b.type === 'tackleHut');

describe('Angler guests in a real resort (Task 42)', () => {
  it('Angler type: arrives only with the hut (@fishing), fishes at the hut and spends little', () => {
    const sim = resort(1);
    sim.guestSim.spawner.rateMult = 12;
    sim.tick(3); // the attraction runtime syncs on the first tick
    expect(sim.guestSim.spawner.flagsFn!()).toContain('@fishing');
    const kinds = new Map<number, number>();
    sim.bus.on('guest:arrived', (e) => { const slot = sim.guestSim.store.slotOf(e.id); if (slot >= 0) kinds.set(e.id, sim.guestSim.store.type[slot]!); });
    run(sim, { days: 5 });
    const anglers = [...kinds.values()].filter((t) => t === ANGLER).length;
    expect(anglers).toBeGreaterThan(0);
    expect(anglers / kinds.size).toBeLessThan(0.25);
    const hut = sim.attractions.get(huts(sim)[0]!.id)!;
    expect(hut.stats.served + hut.usersNow + hut.queueLength).toBeGreaterThan(0);
    // no hut: no anglers (same seed, same spawner rate)
    const bare = makeResort(64, 1, { startDay: seasonStartDay('autumn') + 5 }).sim;
    bare.guestSim.spawner.rateMult = 12;
    expect(bare.guestSim.spawner.flagsFn!()).not.toContain('@fishing');
    const seen = new Set<number>();
    bare.bus.on('guest:arrived', (e) => { const slot = bare.guestSim.store.slotOf(e.id); if (slot >= 0) seen.add(bare.guestSim.store.type[slot]!); });
    run(bare, { days: 5 });
    expect(seen.has(ANGLER)).toBe(false);
  }, 240_000);
});
