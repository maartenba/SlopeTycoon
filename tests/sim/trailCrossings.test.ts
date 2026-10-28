import { afterEach, describe, expect, it, vi } from 'vitest';
import { bridgeWorld } from './bridgeHelper';
import { addCrossingLayout } from './crossingsHelper';
import { Grid, TileType } from '../../src/world/Grid';
import { OccFlag } from '../../src/world/Occupancy';
import { Buildings } from '../../src/sim/Buildings';
import { Cross, Layer, NetKind, Networks, TRAIL_ORPHAN_MSG, lineTiles, interpolateStroke, type LayerBit } from '../../src/world/Networks';
import { BRIDGE_MSG } from '../../src/config/bridges';
import { buildTrailStroke, planTrailStroke, straightenRuns } from '../../src/world/StrokePlan';
import { PisteTool, PISTE_RAIL_MSG } from '../../src/build/PisteTool';
import { StrokeHistory } from '../../src/build/StrokeHistory';
import { Undo } from '../../src/build/UndoActions';
import { NavMode } from '../../src/sim/guests/NavGraph';
import { encodeSave, decodeSave, makeMeta } from '../../src/persist/Serializer';
import { createSim } from '../../src/game/createSim';

/**
 * Hiking and MTB trails over every obstacle (owner report: "trails don't seem to do bridges over water"). Root cause: a trail is a freehand drag and a
 * bridge is a straight line, so any wobble over a pond was refused with 'Bridges must run in a straight line'; the planner now carries the bridge straight on
 * from the bank. Gaps bridge too, winter (frozen-looking water is still water) behaves like summer.
 */
const KINDS = [['hike', Layer.Hike, 'hikeBridge', NavMode.Hike], ['mtb', Layer.Mtb, 'mtbBridge', NavMode.Bike]] as const;
const world = () => { const grid = new Grid(64); return { grid, net: new Networks(grid, new Buildings(grid.occupancy)) }; };
const pond = (grid: Grid, x0: number, w: number, y0 = 10, y1 = 50): void => { for (let y = y0; y < y1; y++) for (let x = x0; x < x0 + w; x++) { grid.tileType[grid.tileIndex(x, y)] = TileType.Water; grid.occupancy.set(x, y, OccFlag.Water); } };
const trench = (grid: Grid): void => { for (let vy = 0; vy <= 64; vy++) for (let vx = 0; vx <= 64; vx++) grid.setCornerUnchecked(vx, vy, 8); for (let vy = 0; vy <= 64; vy++) for (let vx = 21; vx <= 23; vx++) grid.setCornerUnchecked(vx, vy, 2); };
const row = (a: number, b: number, y = 30) => lineTiles({ x: a, y }, { x: b, y });
/** A freehand wobble: the pointer drifts a row up and down on its way across. */
const wobble = [{ x: 17, y: 30 }, { x: 18, y: 30 }, { x: 19, y: 31 }, { x: 20, y: 31 }, { x: 21, y: 30 }, { x: 22, y: 30 }, { x: 23, y: 29 }, { x: 24, y: 29 }, { x: 25, y: 30 }, { x: 26, y: 30 }];

describe('trails bridge ponds, whatever the wobble of the drag', () => {
  for (const [kind, layer, bridge] of KINDS) {
    for (const season of ['summer', 'winter']) {
      it(`${kind}: wobbly drag over a 2-wide pond (${season}) builds a ${bridge}; the far side stays connected`, () => {
        const { grid, net } = world(); pond(grid, 20, 2);
        if (season === 'winter') grid.snowDepth.fill(1); // frozen look: still a Water tile, the bridge is needed all the same
        net.build(NetKind.Path, 16, 30);
        const line = interpolateStroke(wobble);
        const plan = planTrailStroke(net, grid, kind, line, 1, 'level');
        expect(plan.ok, plan.reason).toBe(true);
        expect(plan.bridges).toHaveLength(1);
        expect(plan.bridges[0]!.kind).toBe(bridge);
        buildTrailStroke(net, kind, plan);
        expect(net.liveBridges()[0]!.kind).toBe(bridge);
        expect(plan.line[plan.line.length - 1]).toEqual({ x: 26, y: 30 }); // the drag still ends where the player ended it
        const b = net.liveBridges()[0]!, has = (t: { x: number; y: number }): boolean => !!(net.layers[net.idxOf(t.x, t.y)]! & layer);
        expect(has(b.a) && has(b.b) && has({ x: 26, y: 30 }) && has({ x: 17, y: 30 })).toBe(true); // both banks and both ends of the drag are trail
        expect(b.span.every((t) => has(t) && net.bid[net.idxOf(t.x, t.y)] === b.id)).toBe(true);
      });
    }
    it(`${kind}: a drag that stops in the water is carried on to the far bank; a lake too wide is refused with the exact reason`, () => {
      const { grid, net } = world(); pond(grid, 20, 3); net.build(NetKind.Path, 17, 30);
      const plan = planTrailStroke(net, grid, kind, row(18, 21), 1, 'level');
      expect(plan.ok, plan.reason).toBe(true);
      expect(plan.bridges[0]!.span).toHaveLength(3);
      const w = world(); pond(w.grid, 20, 6); w.net.build(NetKind.Path, 17, 30);
      const wide = planTrailStroke(w.net, w.grid, kind, row(18, 28), 1, 'level');
      expect(wide).toMatchObject({ ok: false, reason: BRIDGE_MSG.tooLong(4) });
      // starting in the water has no near bank
      const s = planTrailStroke(net, grid, kind, row(20, 25), 1, 'level');
      expect(s).toMatchObject({ ok: false });
    });
    it(`${kind}: a lake bank to bank (3 wide, ${kind === 'hike' ? 120 : 140}/tile) costs span + banks, a stream stays an automatic crossing`, () => {
      const { grid, net } = world(); pond(grid, 20, 3); net.build(NetKind.Path, 17, 30);
      const plan = planTrailStroke(net, grid, kind, row(18, 25), 1, 'level');
      expect(plan.ok, plan.reason).toBe(true);
      expect(plan.cost).toBe(3 * (kind === 'hike' ? 120 : 140) + 5 * 10);
      const s = world(); for (let y = 10; y < 50; y++) { s.grid.tileType[s.grid.tileIndex(21, y)] = TileType.Stream; s.grid.occupancy.set(21, y, OccFlag.Water); }
      s.net.build(NetKind.Path, 17, 30);
      const sp = planTrailStroke(s.net, s.grid, kind, row(18, 25), 1, 'level');
      expect(sp.ok, sp.reason).toBe(true);
      expect(sp.bridges).toHaveLength(0);
      buildTrailStroke(s.net, kind, sp);
      expect(s.net.bridge[s.net.idxOf(21, 30)]).toBe(1);
      expect(s.net.layers[s.net.idxOf(21, 30)]! & layer).toBe(layer);
    });
    it(`${kind}: a trench (gap) gets a bridge; a plain slope is not a gap and paints as before`, () => {
      const { grid, net } = world(); trench(grid); net.build(NetKind.Path, 17, 30);
      const plan = planTrailStroke(net, grid, kind, row(18, 27), 1, 'level');
      expect(plan.ok, plan.reason).toBe(true);
      expect(plan.bridges).toHaveLength(1);
      const sl = world(); for (let vy = 0; vy <= 64; vy++) for (let vx = 0; vx <= 64; vx++) sl.grid.setCornerUnchecked(vx, vy, Math.max(0, 40 - vx)); // steady downhill
      sl.net.build(NetKind.Path, 17, 30);
      const p2 = planTrailStroke(sl.net, sl.grid, kind, row(18, 27), 1, 'level');
      expect(p2.ok, p2.reason).toBe(true);
      expect(p2.bridges).toHaveLength(0);
      expect(p2.newTiles).toHaveLength(10);
    });
    it(`${kind}: nothing to start from reads as an actionable sentence`, () => {
      const { grid, net } = world(); pond(grid, 20, 2);
      const plan = planTrailStroke(net, grid, kind, row(18, 24), 1, 'level');
      expect(plan.ok).toBe(false);
      expect(plan.reason).toBe(TRAIL_ORPHAN_MSG);
      expect(TRAIL_ORPHAN_MSG).toBe('Start the trail next to a path, building or another trail');
    });
  }
  it('straightenRuns leaves straight strokes and dry strokes alone', () => {
    const { grid, net } = world(); pond(grid, 20, 2);
    expect(straightenRuns(net, grid, 'hike', row(18, 24))).toEqual(row(18, 24));
    expect(straightenRuns(net, grid, 'hike', row(30, 40))).toEqual(row(30, 40));
  });
});

describe('trails over rail and the ski piste rules', () => {
  for (const [kind, , , ] of KINDS) {
    it(`${kind}: rail = level crossing or bridge by the toggle, in the same drag as a pond`, () => {
      const { grid, net } = world(); pond(grid, 20, 2, 10, 60);
      net.placeInitialStubs({ x: 5, y: 63 }, { x: 30, y: 63 }, { x: 30, y: 30 });
      net.build(NetKind.Path, 17, 55);
      const lvl = planTrailStroke(net, grid, kind, row(18, 33, 55), 1, 'level'), br = planTrailStroke(net, grid, kind, row(18, 33, 55), 1, 'bridge');
      expect(lvl.ok, lvl.reason).toBe(true); expect(br.ok, br.reason).toBe(true);
      expect(lvl.bridges).toHaveLength(1); expect(br.bridges).toHaveLength(1);
      expect(lvl.crossings[0]!.cross).toBe(Cross.Path);
      expect(br.crossings[0]!.cross).toBe(kind === 'mtb' ? Cross.MtbBridge : Cross.Footbridge);
    });
  }
  it('a ski piste cannot cross water or a rail line: it stops there with the reason', () => {
    vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
    const { grid, net } = world(); pond(grid, 10, 2, 10, 60);
    net.placeInitialStubs({ x: 5, y: 63 }, { x: 30, y: 63 }, { x: 30, y: 30 });
    const o = { grid, networks: net, camera: {} as never, dom: { addEventListener() {}, removeEventListener() {} } as never, scene: { add() {}, remove() {} } as never, charge: () => true, multiplier: () => 1, onChanged: () => {}, onError: vi.fn(), history: new StrokeHistory(), refund: vi.fn(), onInfo: vi.fn() };
    const tool = new PisteTool(o);
    type Hack = { start: unknown; cur: unknown; begin(p: unknown): void; sample(p: unknown): void; tiles(): Array<{ x: number }>; evaluate(t: unknown): { ok: boolean; text: string } };
    const h = tool as unknown as Hack;
    tool.startTool(Layer.Ski); h.start = { x: 24, y: 55 }; h.cur = { x: 36, y: 55 }; h.begin({ x: 24, y: 55 }); h.sample({ x: 36, y: 55 });
    const t = h.tiles();
    expect(t.length).toBeGreaterThan(3); expect(t.every((p) => p.x < 30)).toBe(true); // the rail tile and everything beyond is dropped
    expect(h.evaluate(t).ok).toBe(true);
    tool.dispose();
    expect(PISTE_RAIL_MSG).toContain('cannot cross water or rails');
    vi.unstubAllGlobals();
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('in a real sim: hikers and bikers walk across a trail bridge; undo and save / load', () => {
  for (const [kind, layer, bridge, mode] of KINDS) {
    it(`${kind}: pond bridge built from a wobbly drag, walkable, one undo step, survives save / load`, async () => {
      const sim = bridgeWorld({ summer: true }); const n = sim.networks, g = sim.grid;
      // a 2-wide lake instead of the stream (x 40 stream stays: use x 44..45 lake)
      for (let y = 38; y <= 52; y++) for (const x of [44, 45]) { g.tileType[g.tileIndex(x, y)] = TileType.Water; g.occupancy.set(x, y, OccFlag.Water); }
      for (let vy = 38; vy <= 53; vy++) for (let vx = 46; vx <= 54; vx++) g.setCornerUnchecked(vx, vy, 7); // a gentle fall to the east: bikes roll downhill
      n.buildSegment(NetKind.Path, lineTiles({ x: 41, y: 49 }, { x: 42, y: 49 })); // anchor next to the lake on the east bank of the stream... start of the trail
      const drag = interpolateStroke([{ x: 42, y: 49 }, { x: 43, y: 49 }, { x: 43, y: 48 }, { x: 44, y: 48 }, { x: 45, y: 48 }, { x: 46, y: 49 }, { x: 47, y: 49 }, { x: 48, y: 49 }]);
      const plan = planTrailStroke(n, g, kind, drag, 1, 'level');
      expect(plan.ok, plan.reason).toBe(true);
      expect(plan.bridges[0]!.kind).toBe(bridge);
      const undo = new Undo(sim);
      n.beginJournal();
      expect(sim.economy.charge(plan.cost)).toBe(true);
      buildTrailStroke(n, kind, plan);
      undo.recordNetwork('Piste', 'painted', n.endJournal(), plan.cost);
      expect(n.bridgeTiles).toBe(2);
      sim.tick(5);
      const gr = sim.guestSim.graph()!; gr.update(0); gr.pf.maxBuildsPerTick = Infinity;
      const idx = (x: number, y: number): number => y * 64 + x;
      const walk = gr.pf.find(mode, idx(43, 49), idx(48, 49)) ?? gr.pf.find(mode, idx(48, 49), idx(43, 49));
      expect(walk, 'hikers / bikers can get across').toBeTruthy();
      expect(undo.undo().ok).toBe(true);
      expect(n.bridgeTiles).toBe(0); expect(n.layers[idx(46, 49)]! & layer).toBe(0);
      expect(undo.redo().ok).toBe(true);
      expect(n.bridgeTiles).toBe(2);
      const { bytes } = await encodeSave(sim, makeMeta(sim, 'x'), { compress: true, yieldBetween: false });
      const env = (await decodeSave(bytes, { yieldBetween: false })).envelope;
      const b = createSim({ size: env.mapSize, seed: env.seed, now: () => 0, fromSave: structuredClone(env.modules) });
      expect(b.networks.bridgeTiles).toBe(2);
      expect(b.networks.liveBridges()[0]!.kind).toBe(bridge);
    });
  }
});
void addCrossingLayout; void (null as unknown as LayerBit);
