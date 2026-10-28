import { describe, expect, it } from 'vitest';
import { bridgeWorld } from './bridgeHelper';
import { addCrossingLayout, crossingWorld } from './crossingsHelper';
import { Cross, Layer, NetKind, lineTiles } from '../../src/world/Networks';
import { TileType } from '../../src/world/Grid';
import { OccFlag } from '../../src/world/Occupancy';
import { buildStroke, buildTrailStroke, planStroke, planTrailStroke } from '../../src/world/StrokePlan';
import { NavMode } from '../../src/sim/guests/NavGraph';
import { Undo } from '../../src/build/UndoActions';
import { encodeSave, decodeSave, makeMeta } from '../../src/persist/Serializer';
import { createSim } from '../../src/game/createSim';
import { CROSSING } from '../../src/config/crossings';

const nav = (sim: ReturnType<typeof bridgeWorld>) => { const g = sim.guestSim.graph()!; g.update(0); g.pf.maxBuildsPerTick = Infinity; return g; };
const tile = (x: number, y: number): number => y * 64 + x;

describe('drag-to-bridge strokes in a real sim', () => {
  it('a footpath over a pond: built as one undo step, guests walk across, undo / redo bring it back exactly', () => {
    const sim = bridgeWorld(); const n = sim.networks, g = sim.grid;
    for (let y = 38; y <= 52; y++) for (const x of [40, 41]) { g.tileType[g.tileIndex(x, y)] = TileType.Water; g.occupancy.set(x, y, OccFlag.Water); }
    n.buildSegment(NetKind.Path, lineTiles({ x: 43, y: 47 }, { x: 45, y: 47 }));
    expect(nav(sim).pf.find(NavMode.Walk, tile(36, 47), tile(44, 47)) ?? null).toBeNull();
    const undo = new Undo(sim);
    const plan = planStroke(n, g, 'path', lineTiles({ x: 38, y: 47 }, { x: 43, y: 47 }), 1, 'level');
    expect(plan.ok, plan.reason).toBe(true);
    expect(plan.bridges).toHaveLength(1);
    n.beginJournal();
    expect(sim.economy.charge(plan.cost)).toBe(true);
    buildStroke(n, 'path', plan);
    undo.recordNetwork('Footpath', 'painted', n.endJournal(), plan.cost);
    expect(n.bridgeTiles).toBe(2);
    expect(nav(sim).pf.find(NavMode.Walk, tile(36, 47), tile(44, 47))).toBeTruthy();
    const built = JSON.stringify([Array.from(n.kind), Array.from(n.bid)]);
    expect(undo.undo().ok).toBe(true);
    expect(n.bridgeTiles).toBe(0);
    expect(nav(sim).pf.find(NavMode.Walk, tile(36, 47), tile(44, 47)) ?? null).toBeNull();
    expect(undo.redo().ok).toBe(true);
    expect(JSON.stringify([Array.from(n.kind), Array.from(n.bid)])).toBe(built);
  });
  it('an MTB / hiking trail over a rail: ramp / stairs, bikers and hikers get across, undo / redo and save / load keep the crossing', async () => {
    for (const [layer, kind, mode, cross] of [[Layer.Mtb, 'mtb', NavMode.Bike, Cross.MtbBridge], [Layer.Hike, 'hike', NavMode.Hike, Cross.Footbridge]] as const) {
      const sim = createSim({ size: 64, seed: 61, now: () => 0, money: 900000, startSeason: 'summer' }); addCrossingLayout(sim); const n = sim.networks;
      const line = lineTiles({ x: 36, y: 54 }, { x: 40, y: 54 });
      const plan = planTrailStroke(n, sim.grid, kind, line, 1, 'bridge');
      expect(plan.ok, plan.reason).toBe(true);
      expect(plan.crossings).toEqual([{ x: 38, y: 54, cross }]);
      const undo = new Undo(sim);
      n.beginJournal();
      buildTrailStroke(n, kind, plan);
      undo.recordNetwork('Piste', 'painted', n.endJournal(), plan.cost);
      expect(n.crossAt(38, 54)).toBe(cross);
      expect(n.rampDir(37, 54)).toBe(1);
      sim.tick(5);
      const g = nav(sim);
      expect(g.pf.find(mode, tile(36, 54), tile(40, 54)) ?? g.pf.find(mode, tile(40, 54), tile(36, 54))).toBeTruthy(); // bikes only roll downhill: either direction
      expect(g.crossingClosed(tile(38, 54))).toBe(false); // a bridge never closes
      expect(undo.undo().ok).toBe(true);
      expect(n.crossAt(38, 54)).toBe(0); expect(n.layers[tile(37, 54)]! & layer).toBe(0);
      expect(undo.redo().ok).toBe(true);
      expect(n.crossAt(38, 54)).toBe(cross);
      const { bytes } = await encodeSave(sim, makeMeta(sim, 'x'), { compress: true, yieldBetween: false });
      const env = (await decodeSave(bytes, { yieldBetween: false })).envelope;
      const b = createSim({ size: env.mapSize, seed: env.seed, now: () => 0, fromSave: structuredClone(env.modules) });
      expect(b.networks.crossAt(38, 54)).toBe(cross);
      expect(b.networks.footLift(38.5, 54.5)).toBe(1);
    }
  });
  it('the level crossing default: trail crossings wait like footpaths, a bridge costs more, the MTB ramp the most', () => {
    const sim = crossingWorld(); const n = sim.networks;
    const line = lineTiles({ x: 36, y: 54 }, { x: 40, y: 54 });
    const lvl = planTrailStroke(n, sim.grid, 'hike', line, 1, 'level'), br = planTrailStroke(n, sim.grid, 'hike', line, 1, 'bridge'), mtb = planTrailStroke(n, sim.grid, 'mtb', line, 1, 'bridge');
    expect(lvl.crossings[0]!.cross).toBe(Cross.Path);
    expect(lvl.cost).toBeLessThan(br.cost);
    expect(br.cost).toBeLessThan(mtb.cost);
    expect(mtb.cost - lvl.cost).toBe(CROSSING.mtbBridge.cost - CROSSING.cost.path);
  });
});
