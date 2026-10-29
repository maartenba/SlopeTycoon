import { describe, expect, it } from 'vitest';
import { createSim, type Sim } from '../../src/game/createSim';
import { Layer, NetKind, lineTiles, interpolateStroke } from '../../src/world/Networks';
import { applyRiver, planFillRiver, planRiver, UNDER_BRIDGE_MSG } from '../../src/world/RiverPlanner';
import { applySpring, planSpring } from '../../src/world/Rivers';
import { buildStroke, buildTrailStroke, describeExtras, planStroke, planTrailStroke } from '../../src/world/StrokePlan';
import { TileType } from '../../src/world/Grid';
import { BRIDGES } from '../../src/config/bridges';
import { NavMode } from '../../src/sim/guests/NavGraph';
import { Undo } from '../../src/build/UndoActions';
import { encodeSave, decodeSave, makeMeta } from '../../src/persist/Serializer';

/**
 * Task 46 part 1: bridges over DUG rivers. A river tile is `TileType.Stream` + water occupancy like a natural stream, so every path kind bridges it with a
 * real record, the kind's price, undo / bulldoze / save-load. Ground falls south (one half-step every two rows) over x 28..52 / y 28..64 with a rim round the spring; a spring at (40, 31) digs the river down x = 40.
 */
export function riverWorld(opts: { dig?: boolean } = {}): Sim {
  const sim = createSim({ size: 64, seed: 61, now: () => 0, money: 900000, startSeason: 'summer' });
  const g = sim.grid;
  for (let vy = 28; vy <= 64; vy++) for (let vx = 28; vx <= 52; vx++) g.setCornerUnchecked(vx, vy, 24 - Math.max(0, (vy - 28) >> 1) + (vy < 33 && vx !== 40 && vx !== 41 ? 5 : 0));
  if (opts.dig !== false) {
    const env = sim.riverEnv();
    const sp = planSpring(env, sim.rivers, 40, 31);
    if (sp.ok) applySpring(env, sim.rivers, sp);
    const p = planRiver(sim.riverEnv(), { x: 40, y: 31 }, null);
    if (!p.ok) throw new Error(`river fixture: ${p.reason}`);
    applyRiver(sim.riverEnv(), sim.rivers, p);
  }
  const n = sim.networks;
  n.roadEntry = { x: 35, y: 36 };
  n.buildSegment(NetKind.Road, lineTiles({ x: 35, y: 36 }, { x: 39, y: 36 }));
  n.buildSegment(NetKind.Path, lineTiles({ x: 35, y: 37 }, { x: 35, y: 41 }));
  return sim;
}
const row = (a: number, b: number, y: number) => lineTiles({ x: a, y }, { x: b, y });
const CASES = [['path', 'footbridge', 37], ['road', 'roadBridge', 36], ['hike', 'hikeBridge', 38], ['mtb', 'mtbBridge', 39]] as const;

describe('bridges over a dug river', () => {
  it('the fixture digs a real river (Stream + water occupancy)', () => {
    const sim = riverWorld();
    expect(sim.rivers.rivers.length).toBe(1);
    for (let y = 33; y < 60; y++) expect(sim.grid.tileType[sim.grid.tileIndex(40, y)]).toBe(TileType.Stream);
  });
  for (const [kind, bridge, y] of CASES) {
    it(`${kind}: a ${bridge} over the river (record, price, deck, walkable, bulldoze), same price as over a natural stream`, () => {
      const sim = riverWorld(); const n = sim.networks, g = sim.grid;
      const stroke = kind === 'path' || kind === 'road' ? row(36, 44, y) : interpolateStroke(row(36, 44, y));
      const plan = kind === 'path' || kind === 'road' ? planStroke(n, g, kind, stroke) : planTrailStroke(n, g, kind, stroke);
      expect(plan.ok, plan.reason).toBe(true);
      expect(plan.bridges).toHaveLength(1);
      const b = plan.bridges[0]!;
      expect(b.kind).toBe(bridge); expect(b.overStream).toBe(true); expect(b.span).toEqual([{ x: 40, y }]);
      expect(b.spanCost).toBe(BRIDGES[bridge].costPerTile);
      expect(describeExtras(plan)).toContain('over stream');
      if (kind === 'path' || kind === 'road') buildStroke(n, kind, plan); else buildTrailStroke(n, kind, plan);
      const rec = n.liveBridges();
      expect(rec).toHaveLength(1); expect(n.bid[n.idxOf(40, y)]).toBe(rec[0]!.id); expect(n.legacyBridges()).toHaveLength(0);
      expect(n.deckY(40.5, y + 0.5)).not.toBeNull();
      if (kind !== 'road') {
        sim.tick(5);
        const gr = sim.guestSim.graph()!; gr.update(0); gr.pf.maxBuildsPerTick = Infinity;
        const mode = kind === 'hike' ? NavMode.Hike : kind === 'mtb' ? NavMode.Bike : NavMode.Walk;
        const idx = (px: number, py: number): number => py * 64 + px;
        expect(gr.pf.find(mode, idx(37, y), idx(43, y)) ?? gr.pf.find(mode, idx(43, y), idx(37, y)), `${kind} can cross the river`).toBeTruthy();
      }
      n.removeBridge(n.bridgeAt(40, y)!.id);
      expect(n.bridgeTiles).toBe(0);
      expect(g.tileType[g.tileIndex(40, y)]).toBe(TileType.Stream); // the river stays
    });
  }

  it('undo / redo is one step and save / load keeps a bridge over a dug river (rivers module + networks module)', async () => {
    const sim = riverWorld(); const n = sim.networks, g = sim.grid;
    const plan = planStroke(n, g, 'path', row(36, 44, 37));
    expect(plan.ok, plan.reason).toBe(true);
    const undo = new Undo(sim);
    n.beginJournal(); expect(sim.economy.charge(plan.cost)).toBe(true);
    buildStroke(n, 'path', plan);
    undo.recordNetwork('Path', 'placed', n.endJournal(), plan.cost);
    expect(n.bridgeTiles).toBe(1);
    expect(undo.undo().ok).toBe(true); expect(n.bridgeTiles).toBe(0);
    expect(undo.redo().ok).toBe(true); expect(n.bridgeTiles).toBe(1);
    const { bytes } = await encodeSave(sim, makeMeta(sim, 'x'), { compress: true, yieldBetween: false });
    const env = (await decodeSave(bytes, { yieldBetween: false })).envelope;
    const b = createSim({ size: env.mapSize, seed: env.seed, now: () => 0, fromSave: structuredClone(env.modules) });
    expect(b.networks.bridgeTiles).toBe(1); expect(b.networks.liveBridges()[0]!.kind).toBe('footbridge');
    expect(b.rivers.rivers.length).toBe(1);
    expect(b.networks.deckY(40.5, 37.5)).not.toBeNull();
  });

  it('filling the river in is refused while a bridge stands over it (UNDER_BRIDGE_MSG), allowed once the bridge is gone', () => {
    const sim = riverWorld(); const n = sim.networks, g = sim.grid;
    const plan = planStroke(n, g, 'path', row(36, 44, 37));
    buildStroke(n, 'path', plan);
    const id = sim.rivers.rivers[0]!.id;
    const refused = planFillRiver(sim.rivers, id, sim.riverEnv());
    expect(refused.ok).toBe(false); expect(refused.reason).toBe(UNDER_BRIDGE_MSG);
    n.removeBridge(n.bridgeAt(40, 37)!.id);
    expect(planFillRiver(sim.rivers, id, sim.riverEnv()).ok).toBe(true);
  });

  it('frozen rivers are still water tiles: bridges plan and build exactly as in summer', () => {
    const sim = riverWorld(); const n = sim.networks, g = sim.grid;
    sim.flow.settle(0, -8);
    expect(sim.flow.frozen).toBe(true);
    const plan = planStroke(n, g, 'path', row(36, 44, 37));
    expect(plan.ok, plan.reason).toBe(true); expect(plan.bridges[0]!.kind).toBe('footbridge');
    expect(g.tileType[g.tileIndex(40, 37)]).toBe(TileType.Stream);
  });

  it('rapids rivers use the same bridge (one tile, same price): the flow class does not change the plan', () => {
    const sim = riverWorld(); const n = sim.networks, g = sim.grid;
    n.buildSegment(NetKind.Path, lineTiles({ x: 35, y: 42 }, { x: 35, y: 60 }));
    const rec = sim.rivers.rivers[0]!;
    rec.level = rec.level.map((l, i) => (i < 12 ? l : l - (i - 12) * 3)); // a steep lower reach: rapids
    sim.rivers.version++;
    const calm = sim.flow.tileAt(40, 35)!, steep = sim.flow.tileAt(40, 50)!;
    expect(calm.way.cls[calm.i]).toBeLessThan(2); expect(steep.way.cls[steep.i]).toBe(2);
    const a = planStroke(n, g, 'path', row(36, 44, 35)), b = planStroke(n, g, 'path', row(36, 44, 50));
    expect(a.ok, a.reason).toBe(true); expect(b.ok, b.reason).toBe(true);
    expect(a.bridges[0]!.kind).toBe(b.bridges[0]!.kind); expect(a.bridges[0]!.spanCost).toBe(b.bridges[0]!.spanCost);
    void Layer;
  });
});
