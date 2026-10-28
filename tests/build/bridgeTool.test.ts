import { afterEach, describe, expect, it, vi } from 'vitest';
import { Grid, TileType } from '../../src/world/Grid';
import { OccFlag } from '../../src/world/Occupancy';
import { Buildings } from '../../src/sim/Buildings';
import { Networks, NetKind } from '../../src/world/Networks';
import { StrokeHistory } from '../../src/build/StrokeHistory';
import { BridgeTool } from '../../src/build/BridgeTool';
import { BRIDGE_MSG } from '../../src/config/bridges';

type Hack = { begin(p: unknown): void; sample(p: unknown): void; tiles(): Array<{ x: number; y: number }>; evaluate(t: unknown): { ok: boolean; text: string; cost: number }; commit(t: unknown): void; cur: unknown; start: unknown };
const setup = () => {
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
  const grid = new Grid(64);
  const net = new Networks(grid, new Buildings(grid.occupancy));
  for (let y = 10; y < 50; y++) for (const x of [20, 21]) { grid.tileType[grid.tileIndex(x, y)] = TileType.Stream; grid.occupancy.set(x, y, OccFlag.Water); }
  net.build(NetKind.Path, 18, 30); net.roadEntry = { x: 19, y: 30 };
  const o = {
    grid, networks: net, camera: {} as never, dom: { addEventListener() {}, removeEventListener() {} } as never, scene: { add() {}, remove() {} } as never,
    charge: () => true, multiplier: () => 1, onChanged: () => {}, onError: vi.fn(), history: new StrokeHistory(), refund: vi.fn(), onInfo: vi.fn(),
  };
  return { grid, net, o };
};
afterEach(() => vi.unstubAllGlobals());

describe('bridge tool', () => {
  it('drag bank to bank: the preview shows span, deck rise, supports and cost; commit builds it', () => {
    const { net, o } = setup();
    const tool = new BridgeTool(o), h = tool as unknown as Hack;
    tool.startTool('footbridge');
    h.start = { x: 19, y: 30 }; h.cur = { x: 22, y: 31 }; // pointer drifts off the line: the tool snaps to the dominant axis
    const t = h.tiles();
    expect(t.map((p) => `${p.x},${p.y}`)).toEqual(['19,30', '20,30', '21,30', '22,30']);
    const ev = h.evaluate(t);
    expect(ev.ok).toBe(true);
    expect(ev.text).toMatch(/^Footbridge: span 2, deck \+1 half-steps, 2 supports, \$/);
    expect(ev.cost).toBe(2 * 150 + 2 * 20);
    h.commit(t);
    expect(net.bridgeTiles).toBe(2);
    tool.dispose();
  });
  it('shows the exact red reason: too long, no water, banks in the water, rail', () => {
    const { o } = setup();
    const tool = new BridgeTool(o), h = tool as unknown as Hack;
    tool.startTool('roadBridge');
    expect(h.evaluate([{ x: 19, y: 30 }]).text).toContain('drag from one bank');
    expect(h.evaluate([{ x: 19, y: 30 }, { x: 20, y: 30 }, { x: 21, y: 30 }, { x: 22, y: 30 }, { x: 23, y: 30 }, { x: 24, y: 30 }])).toMatchObject({ ok: false, text: `Blocked: ${BRIDGE_MSG.tooLong(3)}` });
    expect(h.evaluate([{ x: 30, y: 30 }, { x: 31, y: 30 }, { x: 32, y: 30 }])).toMatchObject({ ok: false, text: `Blocked: ${BRIDGE_MSG.nothing}` });
    expect(h.evaluate([{ x: 20, y: 30 }, { x: 21, y: 30 }, { x: 22, y: 30 }])).toMatchObject({ ok: false, text: `Blocked: ${BRIDGE_MSG.ends}` });
    tool.dispose();
  });
  it('the kind can be switched (trail bridge) and the cost follows the multiplier', () => {
    const { o } = setup();
    o.multiplier = () => 0.5;
    const tool = new BridgeTool(o), h = tool as unknown as Hack;
    tool.startTool('hikeBridge');
    const ev = h.evaluate([{ x: 19, y: 30 }, { x: 20, y: 30 }, { x: 21, y: 30 }, { x: 22, y: 30 }]);
    expect(ev.text).toMatch(/^Wooden hiking bridge/);
    expect(ev.cost).toBe(2 * 120 * 0.5 + 2 * 10 * 0.5); // span + two trail bank tiles
    tool.dispose();
  });
});
