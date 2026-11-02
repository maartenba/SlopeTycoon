import { describe, expect, it, vi } from 'vitest';
import { Grid } from '../../src/world/Grid';
import { Buildings } from '../../src/sim/Buildings';
import { Networks, Layer } from '../../src/world/Networks';
import { PisteTool } from '../../src/build/PisteTool';
import { SLED, SLED_MSG } from '../../src/config/sled';

type Hack = { begin(p: unknown): void; sample(p: unknown): void; start: unknown; tiles(): Array<{ x: number; y: number }>; evaluate(t: unknown): { ok: boolean; cost: number; text: string }; commit(t: unknown): void };

function make(fall = 1) {
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
  const grid = new Grid(64);
  for (let vy = 0; vy < grid.vsize; vy++) for (let vx = 0; vx < grid.vsize; vx++) grid.setCornerUnchecked(vx, vy, Math.max(0, 200 - vy * fall));
  const net = new Networks(grid, new Buildings(grid.occupancy));
  const tool = new PisteTool({
    grid, networks: net, camera: {} as never, dom: { addEventListener() {}, removeEventListener() {} } as never, scene: { add() {}, remove() {} } as never,
    charge: () => true, multiplier: () => 1, onChanged: () => {}, onError: vi.fn(),
  });
  const h = tool as unknown as Hack;
  const stroke = (a: { x: number; y: number }, b: { x: number; y: number }) => { h.start = a; h.begin(a); h.sample(b); return h.evaluate(h.tiles()); };
  return { grid, net, tool, h, stroke };
}

describe('Sled run / Alpine coaster tool (PisteTool, layers 16 / 32)', () => {
  it('refuses an unattached stroke, accepts one that starts at a path, charges $22 per tile', () => {
    const { net, tool, h, stroke } = make(1);
    tool.startTool(Layer.Sled);
    expect(stroke({ x: 30, y: 20 }, { x: 30, y: 30 })).toMatchObject({ ok: false, text: SLED_MSG.orphan });
    net.build(1, 30, 19);
    const ev = stroke({ x: 30, y: 20 }, { x: 30, y: 30 });
    expect(ev.ok).toBe(true);
    expect(ev.cost).toBe(h.tiles().length * SLED.costPerTile.sled);
    expect(ev.text).toMatch(/^Sled run — \d+ tiles/);
    h.commit(h.tiles());
    expect(net.layers[net.idxOf(30, 25)]! & Layer.Sled).toBe(Layer.Sled);
    expect(net.layers[net.idxOf(30, 25)]! & Layer.Ski).toBe(0);
  });
  it('refuses ground steeper than a red piste ("Too steep for sleds") but the coaster takes it up to its own limit', () => {
    const { net, tool, stroke } = make(3);
    net.paint(Layer.Sled, [{ x: 30, y: 19 }]); net.paint(Layer.Coaster, [{ x: 30, y: 19 }]); // anchors (a path cannot stand on this slope)
    tool.startTool(Layer.Sled);
    expect(stroke({ x: 30, y: 20 }, { x: 30, y: 26 })).toMatchObject({ ok: false, text: SLED_MSG.steep });
    tool.startTool(Layer.Coaster);
    const ev = stroke({ x: 30, y: 20 }, { x: 30, y: 26 });
    expect(ev.ok).toBe(false); // 3 half-steps per tile exceeds the coaster limit as well
    expect(ev.text).toBe(SLED_MSG.steepCoaster);
    const g2 = make(2);
    g2.net.paint(Layer.Coaster, [{ x: 30, y: 19 }]);
    g2.tool.startTool(Layer.Coaster);
    const e2 = g2.stroke({ x: 30, y: 20 }, { x: 30, y: 26 });
    expect(e2.ok).toBe(true);
    expect(e2.cost).toBe(g2.h.tiles().length * SLED.costPerTile.coaster);
  });
});
