import { describe, expect, it } from 'vitest';
import { makeResort } from './harness';
import { createSim, type Sim } from '../../src/game/createSim';
import { decodeSave, encodeSave, makeMeta } from '../../src/persist/Serializer';
import { applySave, stateHash } from '../../src/game/saveState';
import { TileType } from '../../src/world/Grid';
import { OccFlag } from '../../src/world/Occupancy';
import { applyDecor, applyPond, applyRocks, planDecor, planPond, planRocks, pondRectAround } from '../../src/sim/landscape/Landscape';

async function snapshot(sim: Sim) {
  const { bytes } = await encodeSave(sim, makeMeta(sim, 'test'), { compress: true, yieldBetween: false });
  return { envelope: (await decodeSave(bytes, { yieldBetween: false })).envelope };
}
const loadFrom = (snap: Awaited<ReturnType<typeof snapshot>>): Sim => createSim({ size: snap.envelope.mapSize, seed: snap.envelope.seed, now: () => 0, fromSave: structuredClone(snap.envelope.modules) });

describe('landscape saves', () => {
  it('ponds, decor and boulders survive save -> load (byte format) and an in-place applySave; old saves load with an empty landscape', async () => {
    const { sim } = makeResort(64, 61);
    sim.tick(2); sim.progression.unlockAll = true;
    const env = sim.landscapeEnv();
    let r = null as ReturnType<typeof pondRectAround> | null;
    for (let y = 8; y < 56 && !r; y++) for (let x = 8; x < 56 && !r; x++) if (planPond(env, pondRectAround(x, y, 5)).ok) r = pondRectAround(x, y, 5);
    const plan = planPond(env, r!);
    expect(applyPond(env, sim.landscape, plan).ok).toBe(true);
    let placed = 0;
    for (let y = 10; y < 54 && placed < 3; y++) for (let x = 10; x < 54 && placed < 3; x++) if (planDecor(env, x, y, placed === 1 ? 'fountain' : 'bench').ok) { applyDecor(sim.landscape, x, y, placed === 1 ? 'fountain' : 'bench', 1); placed++; }
    applyRocks(sim.props, planRocks(env, r!.x0 + 2, r!.y0 + 2, 3, 1));
    expect(sim.landscape.decor.size).toBe(3);

    const snap = await snapshot(sim);
    const loaded = loadFrom(snap);
    expect(JSON.stringify(loaded.landscape.serialize())).toBe(JSON.stringify(sim.landscape.serialize()));
    for (const t of plan.tileIdx) { expect(loaded.grid.tileType[t]).toBe(TileType.Water); expect(loaded.grid.occupancy.flags[t]! & OccFlag.Water).toBeTruthy(); }
    expect(loaded.buildings.lakeTiles.length).toBe(sim.buildings.lakeTiles.length);
    for (const d of loaded.landscape.decor.values()) expect(loaded.grid.occupancy.flags[loaded.grid.tileIndex(d.x, d.y)]! & OccFlag.Decor).toBeTruthy();
    // control = the same save applied in place (documented demotions of guests in transit apply to both)
    applySave(sim, structuredClone(snap.envelope.modules));
    expect(stateHash(loaded).parts).toEqual(stateHash(sim).parts);
    expect(loaded.props.countByKind()).toEqual(sim.props.countByKind());
    // keeps simulating
    loaded.tick(120);

    // an older save without the module: defaults, with a warning, no crash
    const mods = structuredClone(snap.envelope.modules); delete mods['landscape'];
    const old = makeResort(64, 61).sim;
    old.tick(2);
    const rep = applySave(old, mods);
    expect(rep.missing).toContain('landscape');
    expect(old.landscape.ponds).toHaveLength(0);
  });
});
