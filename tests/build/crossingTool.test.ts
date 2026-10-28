import { afterEach, describe, expect, it, vi } from 'vitest';
import { Grid } from '../../src/world/Grid';
import { Buildings } from '../../src/sim/Buildings';
import { Networks, NetKind, CROSS_MSG, Cross, lineTiles } from '../../src/world/Networks';
import { StrokeHistory } from '../../src/build/StrokeHistory';
import { SegmentTool } from '../../src/build/PathTool';

type Hack = { evaluate(t: unknown): { ok: boolean; text: string; cost: number }; commit(t: unknown): void; overRail: boolean };
const setup = () => {
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
  const grid = new Grid(64);
  const net = new Networks(grid, new Buildings(grid.occupancy));
  net.placeInitialStubs({ x: 5, y: 63 }, { x: 30, y: 63 }, { x: 30, y: 30 }); // a rail line north from (30,63) and a road
  const o = {
    grid, networks: net, camera: {} as never, dom: { addEventListener() {}, removeEventListener() {} } as never, scene: { add() {}, remove() {} } as never,
    charge: () => true, multiplier: () => 1, onChanged: () => {}, onError: vi.fn(), history: new StrokeHistory(), refund: vi.fn(), onInfo: vi.fn(),
  };
  return { grid, net, o };
};
afterEach(() => vi.unstubAllGlobals());

describe('path / road tool over a rail line', () => {
  it('previews the level crossing and its cost, then builds it', () => {
    const { net, o } = setup();
    const rail = [...Array(40).keys()].filter((i) => net.kind[(63 - i) * 64 + 30] === NetKind.Rail);
    expect(rail.length).toBeGreaterThan(10);
    net.buildSegment(NetKind.Path, [{ x: 29, y: 50 }]); // anchor: footpaths must attach to something
    const tool = new SegmentTool(o, NetKind.Path), h = tool as unknown as Hack;
    const stroke = lineTiles({ x: 29, y: 50 }, { x: 31, y: 50 });
    const ev = h.evaluate(stroke);
    expect(ev.ok).toBe(true);
    expect(ev.text).toContain('level crossing');
    expect(ev.cost).toBe(20 + 150); // one new path tile + the crossing
    h.commit(stroke);
    expect(net.crossAt(30, 50)).toBe(Cross.Path);
    tool.dispose();
  });
  it('with the Bridge over rail toggle the same stroke becomes a footbridge (own text and price, no waiting)', () => {
    const { net, o } = setup();
    net.buildSegment(NetKind.Path, [{ x: 29, y: 50 }]);
    const tool = new SegmentTool(o, NetKind.Path), h = tool as unknown as Hack;
    const stroke = lineTiles({ x: 29, y: 50 }, { x: 31, y: 50 });
    h.overRail = true;
    const ev = h.evaluate(stroke);
    expect(ev.ok).toBe(true);
    expect(ev.text).toContain('footbridge over the rail');
    expect(ev.cost).toBe(20 + 900);
    h.commit(stroke);
    expect(net.crossAt(30, 50)).toBe(Cross.Footbridge);
    tool.dispose();
  });
  it('shows the exact reason for an angled / dead-end stroke', () => {
    const { net, o } = setup();
    net.buildSegment(NetKind.Path, [{ x: 29, y: 50 }]);
    const tool = new SegmentTool(o, NetKind.Path), h = tool as unknown as Hack;
    expect(h.evaluate(lineTiles({ x: 30, y: 52 }, { x: 30, y: 49 }))).toMatchObject({ ok: false, text: `Blocked: ${CROSS_MSG.angle}` });
    expect(h.evaluate(lineTiles({ x: 29, y: 50 }, { x: 30, y: 50 }))).toMatchObject({ ok: false, text: `Blocked: ${CROSS_MSG.ends}` });
    tool.dispose();
  });
  it('a road tool over rail needs a straight perpendicular stroke and costs the road crossing', () => {
    const { net, o } = setup();
    const tool = new SegmentTool(o, NetKind.Road), h = tool as unknown as Hack;
    net.roadEntry = { x: 29, y: 45 };
    net.build(NetKind.Road, 29, 45);
    const ev = h.evaluate(lineTiles({ x: 29, y: 45 }, { x: 31, y: 45 }));
    expect(ev.ok).toBe(true);
    expect(ev.cost).toBe(60 + 400); // one new road tile + the road crossing
    tool.dispose();
  });
});
