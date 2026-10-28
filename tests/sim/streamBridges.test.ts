import { describe, expect, it } from 'vitest';
import { bridgeWorld } from './bridgeHelper';
import { Layer, NetKind, lineTiles, interpolateStroke } from '../../src/world/Networks';
import { buildStroke, buildTrailStroke, describeExtras, planStroke, planTrailStroke } from '../../src/world/StrokePlan';
import { buildChunkData } from '../../src/render/meshes/Paths';
import { CHUNK_SIZE, TileType } from '../../src/world/Grid';
import { OccFlag } from '../../src/world/Occupancy';
import { BRIDGES } from '../../src/config/bridges';
import { NavMode } from '../../src/sim/guests/NavGraph';
import { Undo } from '../../src/build/UndoActions';
import { encodeSave, decodeSave, makeMeta } from '../../src/persist/Serializer';
import { createSim } from '../../src/game/createSim';

/**
 * Streams are bridged like ponds (owner report "Tried bridge here, alas": the old per-tile stream crossing was a faint decal with no deck, free and
 * invisible). bridgeWorld: a 1-tile stream down x = 40 (y 38..52), banks level at 8, road on y 46, footpaths on y 47 / 49.
 */
const row = (a: number, b: number, y: number) => lineTiles({ x: a, y }, { x: b, y });
const CASES = [
  ['path', 'footbridge', 47, 39, 42], ['road', 'roadBridge', 46, 39, 42], ['hike', 'hikeBridge', 48, 36, 44], ['mtb', 'mtbBridge', 50, 36, 44],
] as const;

describe('a one-tile stream is a real bridge for every kind', () => {
  for (const [kind, bridge, y, x0, x1] of CASES) {
    it(`${kind}: planned as a ${bridge} (span 1, bridge price), tooltip says over stream, built with a record and a deck mesh, walkable`, () => {
      const sim = bridgeWorld({ summer: true }); const n = sim.networks, g = sim.grid;
      for (let vy = 38; vy <= 53; vy++) for (let vx = 42; vx <= 54; vx++) g.setCornerUnchecked(vx, vy, 7); // a gentle fall to the east (bikes roll downhill)
      const chunk = Math.floor(y / CHUNK_SIZE) * g.chunksPerRow + Math.floor(40 / CHUNK_SIZE);
      const before = buildChunkData(g, n, chunk);
      const stroke = kind === 'path' || kind === 'road' ? row(x0, x1, y) : interpolateStroke(row(x0, x1, y));
      const plan = kind === 'path' || kind === 'road' ? planStroke(n, g, kind, stroke) : planTrailStroke(n, g, kind, stroke);
      expect(plan.ok, plan.reason).toBe(true);
      expect(plan.bridges).toHaveLength(1);
      const b = plan.bridges[0]!;
      expect(b.kind).toBe(bridge); expect(b.span).toEqual([{ x: 40, y }]); expect(b.overStream).toBe(true);
      expect(b.spanCost).toBe(BRIDGES[bridge].costPerTile);
      expect(describeExtras(plan)).toContain(`${BRIDGES[bridge].label} over stream: span 1 tile, $${BRIDGES[bridge].costPerTile}`);
      if (kind === 'path' || kind === 'road') buildStroke(n, kind, plan); else buildTrailStroke(n, kind, plan);
      const rec = n.liveBridges();
      expect(rec).toHaveLength(1); expect(rec[0]!.cost).toBe(b.cost);
      expect(n.bid[n.idxOf(40, y)]).toBe(rec[0]!.id);
      expect(n.legacyBridges()).toHaveLength(0); // a record, not the old per-tile flag
      // render data: the deck + rails are appended to the chunk's network mesh, and the faint translucent decal is gone
      const after = buildChunkData(g, n, chunk);
      expect(after.net.positions.length).toBeGreaterThan(before.net.positions.length + 3 * 60);
      expect(after.decal.positions.length).toBe(before.decal.positions.length);
      // pathing
      sim.tick(5);
      const gr = sim.guestSim.graph()!; gr.update(0); gr.pf.maxBuildsPerTick = Infinity;
      const idx = (px: number, py: number): number => py * 64 + px;
      const mode = kind === 'hike' ? NavMode.Hike : kind === 'mtb' ? NavMode.Bike : NavMode.Walk;
      if (kind !== 'road') {
        const w = gr.pf.find(mode, idx(x0 + 1, y), idx(x1, y)) ?? gr.pf.find(mode, idx(x1, y), idx(x0 + 1, y));
        expect(w, `${kind} can cross`).toBeTruthy();
      }
      // bulldoze: the whole bridge goes, the banks stay
      n.removeBridge(n.bridgeAt(40, y)!.id);
      expect(n.bridgeTiles).toBe(0);
    });
  }

  it('a zig-zag stream (the jog makes the crossing two tiles wide) is one span-2 bridge, priced per tile', () => {
    const sim = bridgeWorld(); const n = sim.networks, g = sim.grid;
    g.tileType[g.tileIndex(41, 48)] = TileType.Stream; g.occupancy.set(41, 48, OccFlag.Water); // jog: a second stream tile next to (40, 48)
    const plan = planTrailStroke(n, g, 'hike', interpolateStroke([{ x: 38, y: 48 }, { x: 39, y: 48 }, { x: 40, y: 48 }, { x: 40, y: 49 }, { x: 41, y: 49 }, { x: 42, y: 49 }, { x: 43, y: 48 }]));
    expect(plan.ok, plan.reason).toBe(true);
    expect(plan.bridges.length).toBeGreaterThanOrEqual(1);
    expect(plan.bridges.every((b) => b.overStream && b.span.length <= 4)).toBe(true);
    expect(plan.bridges.reduce((a, b) => a + b.spanCost, 0)).toBe(plan.bridges.reduce((a, b) => a + b.span.length, 0) * 120);
  });
  it('undo / redo is one step and save / load keeps the bridge (hiking trail)', async () => {
    const sim = bridgeWorld({ summer: true }); const n = sim.networks, g = sim.grid;
    const plan = planTrailStroke(n, g, 'hike', interpolateStroke(row(36, 44, 48)));
    expect(plan.ok, plan.reason).toBe(true);
    const undo = new Undo(sim);
    n.beginJournal(); expect(sim.economy.charge(plan.cost)).toBe(true);
    buildTrailStroke(n, 'hike', plan);
    undo.recordNetwork('Piste', 'painted', n.endJournal(), plan.cost);
    expect(n.bridgeTiles).toBe(1);
    expect(undo.undo().ok).toBe(true); expect(n.bridgeTiles).toBe(0); expect(n.layers[n.idxOf(40, 48)]! & Layer.Hike).toBe(0);
    expect(undo.redo().ok).toBe(true); expect(n.bridgeTiles).toBe(1);
    const { bytes } = await encodeSave(sim, makeMeta(sim, 'x'), { compress: true, yieldBetween: false });
    const env = (await decodeSave(bytes, { yieldBetween: false })).envelope;
    const b = createSim({ size: env.mapSize, seed: env.seed, now: () => 0, fromSave: structuredClone(env.modules) });
    expect(b.networks.bridgeTiles).toBe(1); expect(b.networks.liveBridges()[0]!.kind).toBe('hikeBridge');
  });

  it('old saves: a per-tile stream crossing (flag only) loads as a zero-cost bridge record that renders and walks', async () => {
    const sim = bridgeWorld({ summer: true }); const n = sim.networks;
    n.build(NetKind.Path, 40, 47); n.build(NetKind.Path, 41, 47); // the old automatic crossing: the tile carries only the `bridge` flag
    n.paint(Layer.Hike, [{ x: 40, y: 50 }, { x: 39, y: 50 }, { x: 41, y: 50 }], 0);
    expect(n.bridgeTiles).toBe(0); expect(n.bridge[n.idxOf(40, 47)]).toBe(1);
    expect(n.legacyBridges().length).toBeGreaterThanOrEqual(2);
    const { bytes } = await encodeSave(sim, makeMeta(sim, 'x'), { compress: true, yieldBetween: false });
    const env = (await decodeSave(bytes, { yieldBetween: false })).envelope;
    const b = createSim({ size: env.mapSize, seed: env.seed, now: () => 0, fromSave: structuredClone(env.modules) });
    const bn = b.networks;
    expect(bn.legacyBridges()).toHaveLength(0);
    const live = bn.liveBridges();
    expect(live.map((r) => r.kind).sort()).toEqual(['footbridge', 'hikeBridge']);
    expect(live.every((r) => r.cost === 0 && r.span.length === 1)).toBe(true);
    expect(bn.bridgeAt(40, 47)).toBeTruthy();
    expect(bn.deckY(40.5, 47.5)).not.toBeNull();
    const chunk = Math.floor(47 / CHUNK_SIZE) * b.grid.chunksPerRow + Math.floor(40 / CHUNK_SIZE);
    expect(buildChunkData(b.grid, bn, chunk).net.positions.length).toBeGreaterThan(3 * 60);
    b.tick(5);
    const gr = b.guestSim.graph()!; gr.update(0); gr.pf.maxBuildsPerTick = Infinity;
    expect(gr.pf.find(NavMode.Walk, 47 * 64 + 39, 47 * 64 + 41) ?? gr.pf.find(NavMode.Walk, 47 * 64 + 41, 47 * 64 + 39)).toBeTruthy();
  });
});
