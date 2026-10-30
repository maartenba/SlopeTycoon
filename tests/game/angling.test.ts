import { describe, expect, it } from 'vitest';
import { makeResort, run, TICKS_PER_DAY } from './harness';
import { applySave, collectSave, stateHash } from '../../src/game/saveState';
import { createSim, type Sim } from '../../src/game/createSim';
import { decodeSave, encodeSave, makeMeta } from '../../src/persist/Serializer';
import { seasonStartDay } from '../../src/sim/Clock';
import { FISH } from '../../src/config/balance';

/** Save through the full byte format (as tests/game/saveLoad.test.ts). */
async function snapshot(sim: Sim) {
  const { bytes } = await encodeSave(sim, makeMeta(sim, 'test'), { compress: true, yieldBetween: false });
  return (await decodeSave(bytes, { yieldBetween: false })).envelope;
}
const loadFrom = (env: Awaited<ReturnType<typeof snapshot>>): Sim => createSim({ size: env.mapSize, seed: env.seed, now: () => 0, fromSave: structuredClone(env.modules) });

/** A starter resort (autumn, day 300) with a Tackle & bait hut and a pier at the lake nearest the village. */
const resort = (seed: number, startDay = seasonStartDay('autumn') + 5): Sim => makeResort(64, seed, { startDay, starter: { extra: (kit) => {
  const lk = kit.sim.terrainInfo.lakes.flatMap((l) => l.tileIdx).map((i) => ({ x: i % kit.sim.size, y: (i / kit.sim.size) | 0 })).sort((a, b) => Math.hypot(a.x - kit.lc.x, a.y - kit.lc.y) - Math.hypot(b.x - kit.lc.x, b.y - kit.lc.y))[0]!;
  kit.placeConnected('tackleHut', lk.x - 2, lk.y, 6);
  kit.place('fishingPier', lk.x, lk.y, 4);
} } }).sim;
const huts = (sim: Sim) => sim.buildings.all().filter((b) => b.type === 'tackleHut');

describe('angling in a real resort (Task 49)', () => {
  it('a hut beside the lake is active and open; guests fish; the stock is tracked and saved', () => {
    const sim = resort(1);
    expect(huts(sim).length).toBe(1);
    expect(huts(sim)[0]!.active).toBe(true);
    expect(sim.fishStock.serialize()).toBeNull(); // nobody has fished yet: no state, no module
    expect(collectSave(sim).fishStock!.data).toBeNull();
    run(sim, { days: 4 });
    const info = sim.anglingPlanner.plan(huts(sim)[0]!);
    expect(info.bodies.length).toBeGreaterThan(0);
    expect(info.spots.length).toBeGreaterThanOrEqual(FISH.pierSlots);
    expect(sim.fishStock.tracked).toBeGreaterThan(0);
    expect(sim.fishStock.mean()!).toBeGreaterThan(0.5);
    expect(collectSave(sim).fishStock!.data).not.toBeNull();
    expect(Math.abs(sim.sustain.measure().raw.fish ?? 0)).toBeLessThanOrEqual(FISH.sustainMax);
  }, 120_000);

  it('worlds without a hut hash exactly as before (no fishStock part)', () => {
    const { sim } = makeResort(64, 1, { startDay: seasonStartDay('autumn') + 5 });
    run(sim, { days: 1 });
    expect(Object.keys(stateHash(sim).parts)).not.toContain('fishStock');
    expect(collectSave(sim).fishStock!.data).toBeNull();
  }, 120_000);

  it('same seed, same hash; save -> load keeps the stock and stays in step with the control', async () => {
    const a = resort(7), b = resort(7);
    run(a, { days: 3 }); run(b, { days: 3 });
    const pa = stateHash(a).parts, pb = stateHash(b).parts;
    expect(Object.keys(pa).filter((k) => pa[k] !== pb[k])).toEqual([]);
    const snap = await snapshot(a);
    const restored = loadFrom(snap);
    applySave(a, structuredClone(snap.modules)); // control: the same save applied in place
    expect(restored.fishStock.serialize()).toEqual(a.fishStock.serialize());
    const differing = (): string[] => { const x = stateHash(a).parts, y = stateHash(restored).parts; return Object.keys({ ...x, ...y }).filter((k) => x[k] !== y[k]); };
    expect(differing()).toEqual([]);
    for (let d = 0; d < 2 * TICKS_PER_DAY; d += 40) { a.ops.quality.attachTraffic(); a.tick(40); restored.ops.quality.attachTraffic(); restored.tick(40); expect(differing(), `after ${d + 40} ticks`).toEqual([]); }
    expect(a.fishStock.tracked).toBeGreaterThan(0);
  }, 240_000);

  it('Keep depletes the lake faster than Catch & release (daily regrowth included)', () => {
    const play = (keep: boolean): number => {
      const sim = resort(1);
      sim.attractions.setKeep(huts(sim)[0]!.id, keep);
      run(sim, { days: 6 });
      return sim.fishStock.mean() ?? 1;
    };
    expect(play(true)).toBeLessThanOrEqual(play(false));
  }, 240_000);

  it('ice fishing: in a deep winter the hut stays open for the frozen lake (places on the ice, no piers)', () => {
    const sim = resort(1, seasonStartDay('winter') + 20);
    run(sim, { days: 2 });
    const hut = huts(sim)[0]!, plan = sim.anglingPlanner.plan(hut);
    const a = sim.attractions.get(hut.id)!;
    if (plan.ice) { // cold enough at the lake: frozen water = ice fishing on lakes and ponds only
      expect(plan.bodies.every((b) => b.kind === 'lake' || b.kind === 'pond')).toBe(true);
      expect(plan.spots.every((s) => s.kind === 'ice')).toBe(true);
      expect(a.open).toBe(true);
    }
    expect(plan.ice).toBe(true);
  }, 120_000);
});
