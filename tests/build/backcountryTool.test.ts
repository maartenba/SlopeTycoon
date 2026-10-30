import { describe, expect, it, vi } from 'vitest';
import { Grid } from '../../src/world/Grid';
import { Buildings } from '../../src/sim/Buildings';
import { Networks, Layer, BACKCOUNTRY_COST_PER_TILE, BACKCOUNTRY_ORPHAN_MSG } from '../../src/world/Networks';
import { PisteTool } from '../../src/build/PisteTool';

type Hack = { begin(p: unknown): void; sample(p: unknown): void; start: unknown; tiles(): Array<{ x: number; y: number }>; evaluate(t: unknown): { ok: boolean; cost: number; text: string }; commit(t: unknown): void };

function make(lock: string | null = null) {
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
  const grid = new Grid(64);
  for (let vy = 0; vy < grid.vsize; vy++) for (let vx = 0; vx < grid.vsize; vx++) grid.setCornerUnchecked(vx, vy, Math.max(0, 60 - vy));
  const net = new Networks(grid, new Buildings(grid.occupancy));
  const tool = new PisteTool({
    grid, networks: net, camera: {} as never, dom: { addEventListener() {}, removeEventListener() {} } as never, scene: { add() {}, remove() {} } as never,
    charge: () => true, multiplier: () => 1, onChanged: () => {}, onError: vi.fn(), backcountryLocked: () => lock,
  });
  const h = tool as unknown as Hack;
  const stroke = (a: { x: number; y: number }, b: { x: number; y: number }) => { h.start = a; h.begin(a); h.sample(b); return h.evaluate(h.tiles()); };
  return { grid, net, tool, h, stroke };
}

describe('Backcountry tool (PisteTool, layer 8)', () => {
  it('refuses a stroke that touches nothing; accepts one that starts at a piste end; charges per tile', () => {
    const { net, tool, h, stroke } = make();
    tool.startTool(Layer.Backcountry);
    expect(stroke({ x: 30, y: 20 }, { x: 30, y: 28 })).toMatchObject({ ok: false, text: BACKCOUNTRY_ORPHAN_MSG });
    net.paint(Layer.Ski, Array.from({ length: 6 }, (_, k) => ({ x: 30, y: 14 + k })));
    const ev = stroke({ x: 30, y: 20 }, { x: 30, y: 28 });
    expect(ev.ok).toBe(true);
    expect(ev.cost).toBe(h.tiles().length * BACKCOUNTRY_COST_PER_TILE);
    expect(ev.text).toMatch(/^Backcountry route — \d+ tiles/);
    h.commit(h.tiles());
    expect(net.backcountryComponents()).toHaveLength(1);
    expect(net.layers[net.idxOf(30, 25)]! & Layer.Backcountry).toBe(8);
  });

  it('is career-locked: the evaluation carries the lock reason', () => {
    const { net, tool, stroke } = make('Unlocks at level 3: Regional name');
    tool.startTool(Layer.Backcountry);
    net.paint(Layer.Ski, Array.from({ length: 6 }, (_, k) => ({ x: 30, y: 14 + k })));
    expect(stroke({ x: 30, y: 20 }, { x: 30, y: 24 })).toMatchObject({ ok: false, text: 'Unlocks at level 3: Regional name' });
  });
});
