import { describe, expect, it } from 'vitest';
import { RailCrossingsView } from '../../src/render/RailCrossings';
import { crossingWorld, CROSS_TILE, ROAD_TILE } from '../sim/crossingsHelper';
import { buildChunkData } from '../../src/render/meshes/Paths';
import { CHUNK_SIZE } from '../../src/world/Grid';
import { createSim } from '../../src/game/createSim';

describe('RailCrossingsView', () => {
  it('draws two posts per level crossing, lowers the booms in ~1 s when closed, raises them when open, rings the bell', () => {
    const sim = crossingWorld({ road: true });
    const view = new RailCrossingsView(sim.grid, sim.crossings);
    let bells = 0; view.onBell = (): void => { bells++; };
    view.update(0.016);
    expect(view.count).toBe(2);
    expect(view.group.children.length).toBe(2);
    expect(view.boomAngle(CROSS_TILE(sim))).toBeGreaterThan(1.2); // raised while open
    const tile = CROSS_TILE(sim);
    (sim.crossings.closedTiles() as Set<number>).add(tile); // a closed crossing (the set is the sim's own)
    view.update(0.5);
    const mid = view.boomAngle(tile)!;
    expect(mid).toBeGreaterThan(0.3); expect(mid).toBeLessThan(1.2);
    for (let i = 0; i < 40; i++) view.update(0.05);
    expect(view.boomAngle(tile)).toBe(0);
    expect(bells).toBeGreaterThanOrEqual(1);
    expect(bells).toBeLessThanOrEqual(4); // ~every 0.9 s over ~2.5 s
    expect(view.boomAngle(ROAD_TILE(sim))).toBeGreaterThan(1.2); // the other crossing stays open
    (sim.crossings.closedTiles() as Set<number>).delete(tile);
    for (let i = 0; i < 30; i++) view.update(0.05);
    expect(view.boomAngle(tile)).toBeGreaterThan(1.2);
  });
  it('removes the barriers of a bulldozed crossing', () => {
    const sim = crossingWorld();
    const view = new RailCrossingsView(sim.grid, sim.crossings);
    view.update(0.016);
    expect(view.count).toBe(1);
    sim.networks.unbuild(38, 57);
    view.update(0.016);
    expect(view.count).toBe(0);
  });
  it('the chunk mesh builds a deck for a level crossing (finite vertices) and none for a plain rail', () => {
    const sim = crossingWorld();
    const cpr = sim.grid.chunksPerRow, chunk = Math.floor(57 / CHUNK_SIZE) * cpr + Math.floor(38 / CHUNK_SIZE);
    const withDeck = buildChunkData(sim.grid, sim.networks, chunk).net;
    expect(withDeck.positions.every((v) => Number.isFinite(v))).toBe(true);
    const plain = createSim({ size: 64, seed: 61, now: () => 0 });
    expect(withDeck.indices.length).toBeGreaterThan(buildChunkData(plain.grid, plain.networks, chunk).net.indices.length);
  });
});
