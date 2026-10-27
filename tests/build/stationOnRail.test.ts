import { describe, expect, it } from 'vitest';
import { createSim, type Sim } from '../../src/game/createSim';
import { Undo } from '../../src/build/UndoActions';
import { stateHash } from '../../src/game/saveState';
import { validatePlacement } from '../../src/sim/PlaceBuilding';
import { NetKind } from '../../src/world/Networks';
import { OccFlag } from '../../src/world/Occupancy';
import { encodeSave, decodeSave, makeMeta } from '../../src/persist/Serializer';

const fresh = (): Sim => createSim({ size: 64, seed: 61, now: () => 0 });
/** A 2x4 station (rot 1) whose footprint covers the last rail tiles of the starter stub (x 38, y 58..63). */
const spot = (sim: Sim): { x: number; y: number } => {
  const re = sim.networks.railEntry!;
  return { x: re.x - 1, y: re.y - 7 };
};

describe('Train Station on the rail', () => {
  it('placement over rail tiles is valid (no road/path/rail refusal) and keeps the rail', () => {
    const sim = fresh();
    const { x, y } = spot(sim);
    const chk = validatePlacement(sim.env, 'trainStation', x, y, 1, true);
    expect(chk.reasons).not.toContain('Cannot build on a road, path or rail');
    sim.networks.build(NetKind.Path, x - 1, y); // unrelated tile: a path INSIDE the footprint is still refused
    expect(sim.networks.kindAt(x + 1, y + 2)).toBe(NetKind.Rail);
  });
  it('place -> undo restores the exact state; rail untouched; redo works', () => {
    const sim = fresh(); sim.tick(3);
    const undo = new Undo(sim);
    const { x, y } = spot(sim);
    const before = stateHash(sim);
    const railBefore = Array.from(sim.networks.kind);
    const out = undo.placeBuilding('trainStation', x, y, 1, true);
    expect(out.ok).toBe(true);
    expect(sim.networks.isRailServed(out.building!.id)).toBe(true);
    expect(sim.grid.occupancy.has(x + 1, y + 2, OccFlag.Building | OccFlag.Road)).toBe(true);
    expect(undo.undo().ok).toBe(true);
    expect(stateHash(sim)).toEqual(before);
    expect(Array.from(sim.networks.kind)).toEqual(railBefore);
    expect(undo.redo().ok).toBe(true);
    expect(sim.buildings.all().some((b) => b.type === 'trainStation')).toBe(true);
  });
  it('save / load keeps the station and the rail under it', async () => {
    const sim = fresh();
    const { x, y } = spot(sim);
    expect(new Undo(sim).placeBuilding('trainStation', x, y, 1, true).ok).toBe(true);
    const { bytes } = await encodeSave(sim, makeMeta(sim, 'stn'), { compress: true, yieldBetween: false });
    const env = (await decodeSave(bytes, { yieldBetween: false })).envelope;
    const b = createSim({ size: env.mapSize, seed: env.seed, now: () => 0, fromSave: structuredClone(env.modules) });
    const st = b.buildings.all().find((q) => q.type === 'trainStation')!;
    expect(st).toBeTruthy();
    expect(b.networks.kindAt(x + 1, y + 2)).toBe(NetKind.Rail);
    expect(b.networks.isRailServed(st.id)).toBe(true);
  });
});
