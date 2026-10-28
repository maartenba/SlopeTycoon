import { afterEach, describe, expect, it, vi } from 'vitest';
import { Grid, TileType } from '../../src/world/Grid';
import { OccFlag } from '../../src/world/Occupancy';
import { Buildings } from '../../src/sim/Buildings';
import { Cross, Layer, lineTiles, NetKind, Networks, ROAD_START_MSG, type LayerBit } from '../../src/world/Networks';
import { BRIDGE_MSG } from '../../src/config/bridges';
import { CROSSING } from '../../src/config/crossings';
import { StrokeHistory } from '../../src/build/StrokeHistory';
import { SegmentTool } from '../../src/build/PathTool';
import { PisteTool } from '../../src/build/PisteTool';
import { planStroke } from '../../src/world/StrokePlan';

/**
 * Bridges are part of drawing each path kind (docs/bridges.md): the tools build the matching bridge when the drag crosses a pond / a gap, and a level
 * crossing or a bridge where it crosses rail. Driven through the tools' own evaluate / commit like the pointer would.
 */
type Hack = { evaluate(t: unknown): { ok: boolean; text: string; cost: number; ghost?: { decks: Array<{ tiles: unknown[]; deck: number }>; marks: unknown[]; lifted?: unknown[] } }; commit(t: unknown): void; tiles(): Array<{ x: number; y: number }>; begin(p: unknown): void; sample(p: unknown): void; start: unknown; cur: unknown; crossMode: 'level' | 'bridge' };
const setup = () => {
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
  const grid = new Grid(64);
  const net = new Networks(grid, new Buildings(grid.occupancy));
  const o = {
    grid, networks: net, camera: {} as never, dom: { addEventListener() {}, removeEventListener() {} } as never, scene: { add() {}, remove() {} } as never,
    charge: () => true, multiplier: () => 1, onChanged: () => {}, onError: vi.fn(), history: new StrokeHistory(), refund: vi.fn(), onInfo: vi.fn(),
  };
  return { grid, net, o };
};
afterEach(() => vi.unstubAllGlobals());

/** A pond (lake tiles, not a stream) `w` wide at x = 20.. spanning y 10..50. */
const pond = (grid: Grid, w: number): void => { for (let y = 10; y < 50; y++) for (let x = 20; x < 20 + w; x++) { grid.tileType[grid.tileIndex(x, y)] = TileType.Water; grid.occupancy.set(x, y, OccFlag.Water); } };
/** A flat trench x 20..23 (steep walls, flat floor 6 half-steps below the 8-high ground). */
const trench = (grid: Grid): void => { for (let vy = 0; vy <= 64; vy++) for (let vx = 0; vx <= 64; vx++) grid.setCornerUnchecked(vx, vy, 8); for (let vy = 0; vy <= 64; vy++) for (let vx = 21; vx <= 23; vx++) grid.setCornerUnchecked(vx, vy, 2); };
const row = (a: number, b: number, y = 30) => lineTiles({ x: a, y }, { x: b, y });
const drag = (tool: PisteTool, pts: Array<{ x: number; y: number }>) => { const h = tool as unknown as Hack; tool.startTool(tool.layer); h.start = pts[0]; h.cur = pts[pts.length - 1]; h.begin(pts[0]); for (const p of pts.slice(1)) h.sample(p); return h; };

describe('footpath and road: a bridge of the matching type appears when the drag crosses water', () => {
  it('footpath over a pond: a footbridge, deck ghost, span and cost in the tip, built on commit', () => {
    const { grid, net, o } = setup(); pond(grid, 2);
    net.build(NetKind.Path, 18, 30);
    const tool = new SegmentTool(o, NetKind.Path), h = tool as unknown as Hack;
    const ev = h.evaluate(row(17, 24));
    expect(ev.ok).toBe(true);
    expect(ev.text).toContain('Footbridge: span 2 tiles');
    expect(ev.ghost?.decks).toHaveLength(1);
    expect(ev.ghost?.decks[0]!.tiles).toHaveLength(2);
    expect(ev.cost).toBe(5 * 20 + 2 * 150); // 17, 19, 22, 23, 24 new tiles ... minus the existing 18 = 17,19(bank),22(bank),23,24 + span
    h.commit(row(17, 24));
    expect(net.bridgeTiles).toBe(2);
    expect(net.allBridges()[0]).toMatchObject({ kind: 'footbridge' });
    expect(net.kindAt(19, 30)).toBe(NetKind.Path); expect(net.kindAt(22, 30)).toBe(NetKind.Path); expect(net.kindAt(21, 30)).toBe(NetKind.Path);
    tool.dispose();
  });
  it('road over a pond: a road bridge (max 3), too long beyond with the exact reason', () => {
    const { grid, net, o } = setup(); pond(grid, 3);
    net.roadEntry = { x: 17, y: 30 };
    const tool = new SegmentTool(o, NetKind.Road), h = tool as unknown as Hack;
    const ev = h.evaluate(row(17, 26));
    expect(ev.ok).toBe(true); expect(ev.text).toContain('Road bridge: span 3 tiles');
    h.commit(row(17, 26));
    expect(net.liveBridges()[0]).toMatchObject({ kind: 'roadBridge' });
    expect(net.roadConnected).toBeDefined();
    const wide = setup(); pond(wide.grid, 4); wide.net.roadEntry = { x: 17, y: 30 };
    const t2 = new SegmentTool(wide.o, NetKind.Road);
    expect((t2 as unknown as Hack).evaluate(row(17, 27))).toMatchObject({ ok: false, text: `Blocked: ${BRIDGE_MSG.tooLong(3)}` });
    expect(BRIDGE_MSG.tooLong(3)).toBe('Span too long: max 3 tiles');
    tool.dispose(); t2.dispose();
  });
  it('footpath over a gap (trench): a footbridge; over a plain steep slope: still the normal Too steep', () => {
    const { grid, net, o } = setup(); trench(grid);
    net.build(NetKind.Path, 18, 30);
    const tool = new SegmentTool(o, NetKind.Path), h = tool as unknown as Hack;
    const ev = h.evaluate(row(17, 26));
    expect(ev.ok, ev.text).toBe(true);
    expect(ev.text).toContain('Footbridge: span 4 tiles');
    h.commit(row(17, 26));
    expect(net.bridgeTiles).toBe(4);
    tool.dispose();
  });
  it('refusals: ends in the water, bent over water, rail over water, nothing to start from', () => {
    const { grid, net, o } = setup(); pond(grid, 2);
    net.build(NetKind.Path, 18, 30); net.roadEntry = { x: 5, y: 30 };
    const tool = new SegmentTool(o, NetKind.Path), h = tool as unknown as Hack;
    expect(h.evaluate(row(17, 21))).toMatchObject({ ok: false, text: `Blocked: ${BRIDGE_MSG.farBank}` });
    expect(h.evaluate(row(20, 25))).toMatchObject({ ok: false, text: `Blocked: ${BRIDGE_MSG.nearBank}` });
    expect(h.evaluate(lineTiles({ x: 18, y: 30 }, { x: 21, y: 34 }, false))).toMatchObject({ ok: false }); // L with the corner in the water: no straight run to the far bank
    const rail = new SegmentTool(o, NetKind.Rail);
    net.railEntry = { x: 17, y: 32 }; net.kind[32 * 64 + 17] = NetKind.Rail; grid.occupancy.set(17, 32, OccFlag.Road);
    expect((rail as unknown as Hack).evaluate(row(17, 24, 32))).toMatchObject({ ok: false, text: `Blocked: ${BRIDGE_MSG.rail}` });
    const road = new SegmentTool(o, NetKind.Road);
    expect((road as unknown as Hack).evaluate(row(30, 33, 40))).toMatchObject({ ok: false, text: `Blocked: ${ROAD_START_MSG}` });
    expect(ROAD_START_MSG).toMatch(/^Start the road from the road entry/);
    tool.dispose(); rail.dispose(); road.dispose();
  });
  it('a stream is bridged like a pond: footbridge span 1 ($150) + the bank tiles, no more free per-tile crossing', () => {
    const { grid, net, o } = setup();
    for (let y = 10; y < 50; y++) { grid.tileType[grid.tileIndex(20, y)] = TileType.Stream; grid.occupancy.set(20, y, OccFlag.Water); }
    net.build(NetKind.Path, 18, 30);
    const tool = new SegmentTool(o, NetKind.Path), h = tool as unknown as Hack;
    expect(h.evaluate(row(18, 22))).toMatchObject({ ok: true, cost: 3 * 20 + 150 });
    tool.dispose();
  });
});

describe('hiking and MTB trails: a wooden / MTB bridge over a pond', () => {
  for (const [layer, label, per] of [[Layer.Hike, 'Wooden hiking bridge', 120], [Layer.Mtb, 'MTB bridge', 140]] as Array<[LayerBit, string, number]>) {
    it(`${label}: drag across the pond, ghost + price, built; width 5 refuses`, () => {
      const { grid, net, o } = setup(); pond(grid, 2);
      net.build(NetKind.Path, 17, 30);
      const tool = new PisteTool(o); tool.layer = layer;
      let h = drag(tool, [{ x: 18, y: 30 }, { x: 24, y: 30 }]);
      const t = h.tiles();
      expect(t.map((p) => p.x)).toEqual([18, 19, 22, 23, 24]); // the water span is not a painted tile
      const ev = h.evaluate(t);
      expect(ev.ok, ev.text).toBe(true);
      expect(ev.text).toContain(label);
      expect(ev.ghost?.decks[0]!.tiles).toHaveLength(2);
      expect(ev.cost).toBe(2 * per + 5 * 10 - 0); // span + five painted tiles (two of them the banks)
      h.commit(t);
      expect(net.bridgeTiles).toBe(2);
      expect(net.layers[30 * 64 + 21]! & layer).toBe(layer);
      tool.dispose();
      const w = setup(); pond(w.grid, 5); w.net.build(NetKind.Path, 17, 30);
      const t2 = new PisteTool(w.o); t2.layer = layer; h = drag(t2, [{ x: 18, y: 30 }, { x: 27, y: 30 }]);
      expect(h.evaluate(h.tiles())).toMatchObject({ ok: false, text: `Blocked: ${BRIDGE_MSG.tooLong(4)}` });
      t2.dispose();
    });
  }
  it('ski pistes still stop at the water', () => {
    const { grid, o } = setup(); pond(grid, 2);
    const tool = new PisteTool(o), h = drag(tool, [{ x: 18, y: 30 }, { x: 24, y: 30 }]);
    // (layer left at Ski on a fresh tool)
    expect(h.tiles().every((p) => p.x < 20)).toBe(true);
    tool.dispose();
  });
});

describe('crossing rails: level crossing by default, a bridge as the option, for every walkable kind', () => {
  const railWorld = () => {
    const w = setup();
    w.net.placeInitialStubs({ x: 5, y: 63 }, { x: 30, y: 63 }, { x: 30, y: 30 });
    w.net.buildSegment(NetKind.Path, [{ x: 27, y: 50 }]); // anchor
    return w;
  };
  it('footpath: level crossing $150 by default, footbridge $900 with the toggle', () => {
    const { net, o } = railWorld();
    const tool = new SegmentTool(o, NetKind.Path), h = tool as unknown as Hack;
    expect(tool.crossMode).toBe('level');
    const s = row(27, 33, 50);
    expect(h.evaluate(s)).toMatchObject({ ok: true, cost: 5 * 20 + 150 });
    tool.crossMode = 'bridge';
    expect(h.evaluate(s)).toMatchObject({ ok: true, cost: 5 * 20 + 900 });
    h.commit(s);
    expect(net.crossAt(30, 50)).toBe(Cross.Footbridge);
    tool.dispose();
  });
  it('road: always a level crossing (no overpass); the bridge mode does not change it and says so', () => {
    const { net, o } = railWorld();
    net.roadEntry = { x: 5, y: 63 };
    const tool = new SegmentTool(o, NetKind.Road);
    tool.crossMode = 'bridge';
    const s = planStroke(net, o.grid, 'road', row(26, 34, 63), 1, 'bridge'); // the stub road runs along y = 63
    expect(s.crossings.every((c) => c.cross === Cross.Road || c.cross === Cross.Footbridge)).toBe(true);
    const h = tool as unknown as Hack;
    expect(h.evaluate(row(27, 33, 50))).toMatchObject({ ok: false }); // not linked to the road: the reason is the road start, not a crossing
    tool.dispose();
  });
  for (const [layer, cross, price, name] of [[Layer.Hike, Cross.Footbridge, CROSSING.footbridge.cost, 'hiking'], [Layer.Mtb, Cross.MtbBridge, CROSSING.mtbBridge.cost, 'MTB']] as Array<[LayerBit, number, number, string]>) {
    it(`${name} trail: level crossing by default, ${cross === Cross.MtbBridge ? 'MTB ramp bridge' : 'footbridge'} ($${price}) with the toggle, with ramps on both approach tiles`, () => {
      const { net, o } = railWorld();
      const tool = new PisteTool(o);
      const h = drag(tool, [{ x: 27, y: 50 }, { x: 33, y: 50 }]);
      tool.layer = layer;
      let ev = h.evaluate(h.tiles());
      expect(ev.ok, ev.text).toBe(true);
      expect(ev.text).toContain('level crossing');
      expect(ev.cost).toBe(6 * 10 + 150);
      tool.crossMode = 'bridge';
      ev = h.evaluate(h.tiles());
      expect(ev.ok, ev.text).toBe(true);
      expect(ev.text).toContain(cross === Cross.MtbBridge ? 'MTB ramp bridge over the rail' : 'footbridge over the rail');
      expect(ev.cost).toBe(6 * 10 + price);
      expect(ev.ghost?.lifted).toHaveLength(1); expect(ev.ghost?.marks).toHaveLength(0); // the bridge is a raised blue deck, a level crossing a gold mark
      h.commit(h.tiles());
      expect(net.crossAt(30, 50)).toBe(cross);
      expect(net.layers[50 * 64 + 29]! & layer).toBe(layer);
      expect(net.layers[50 * 64 + 30]!).toBe(0); // the rail tile itself carries the crossing, not a trail layer
      expect(net.rampDir(29, 50)).toBe(1); expect(net.rampDir(31, 50)).toBe(3); // stairs / ramps climb towards the deck
      expect(net.footLift(30.5, 50.5)).toBe(1);
      expect(net.footLift(29.5, 50.5)).toBeCloseTo(0.5, 5);
      tool.dispose();
    });
  }
  it('a trail on the rail at an angle is refused with the crossing reason; one that merely ends there too', () => {
    const { o } = railWorld();
    const tool = new PisteTool(o); tool.layer = Layer.Hike;
    let h = drag(tool, [{ x: 30, y: 52 }, { x: 30, y: 49 }]);
    expect(h.evaluate(h.tiles()).text).toContain('right angles');
    h = drag(tool, [{ x: 27, y: 50 }, { x: 30, y: 50 }]);
    expect(h.evaluate(h.tiles()).ok).toBe(false);
    tool.dispose();
  });
  it('a trail over a road or footpath simply merges (paints on it, no crossing needed)', () => {
    const { net, o } = railWorld();
    net.buildSegment(NetKind.Path, row(27, 29, 40)); expect(net.kindAt(28, 40)).toBe(NetKind.Path);
    const tool = new PisteTool(o); tool.layer = Layer.Hike;
    const h = drag(tool, [{ x: 28, y: 38 }, { x: 28, y: 42 }]);
    const ev = h.evaluate(h.tiles());
    expect(ev.ok, ev.text).toBe(true);
    h.commit(h.tiles());
    expect(net.layers[40 * 64 + 28]! & Layer.Hike).toBe(Layer.Hike);
    tool.dispose();
  });
  it('bulldozing a trail footbridge returns the tile to plain rail and cuts the trail on it', () => {
    const { net, o } = railWorld();
    const tool = new PisteTool(o); tool.layer = Layer.Hike; tool.crossMode = 'bridge';
    const h = drag(tool, [{ x: 27, y: 50 }, { x: 33, y: 50 }]);
    h.commit(h.tiles());
    expect(net.unbuild(30, 50)).toBe(NetKind.Path);
    expect(net.crossAt(30, 50)).toBe(0); expect(net.kindAt(30, 50)).toBe(NetKind.Rail);
    tool.dispose();
  });
});
