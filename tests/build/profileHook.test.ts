import { describe, expect, it, vi } from 'vitest';
import { Grid } from '../../src/world/Grid';
import { Buildings } from '../../src/sim/Buildings';
import { Networks, Layer } from '../../src/world/Networks';
import { PisteTool } from '../../src/build/PisteTool';
import type { ProfileView } from '../../src/ui/components/StProfile';

describe('PisteTool slope-profile hook', () => {
  it('emits a profile (coloured samples) while dragging and hides it when the stroke ends', () => {
    vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
    const grid = new Grid(64);
    // a slope so the profile has a drop
    for (let vy = 0; vy < grid.vsize; vy++) for (let vx = 0; vx < grid.vsize; vx++) grid.setCornerUnchecked(vx, vy, Math.max(0, 60 - vy));
    const net = new Networks(grid, new Buildings(grid.occupancy));
    const seen: Array<ProfileView | null> = [];
    const tool = new PisteTool({
      grid, networks: net, camera: {} as never, dom: { addEventListener() {}, removeEventListener() {} } as never, scene: { add() {}, remove() {} } as never,
      charge: () => true, multiplier: () => 1, onChanged: () => {}, onError: vi.fn(), onProfile: (v) => seen.push(v),
    });
    tool.snowlineM = () => 1500;
    tool.startTool(Layer.Ski);
    type Hack = { begin(p: unknown): void; sample(p: unknown): void; start: unknown; tiles(): Array<{ x: number; y: number }>; evaluate(t: unknown): unknown; cancelStroke(): void };
    const h = tool as unknown as Hack;
    h.start = { x: 10, y: 10 };
    h.begin({ x: 10, y: 10 }); h.sample({ x: 10, y: 30 });
    h.evaluate(h.tiles());
    const last = seen[seen.length - 1];
    expect(last).not.toBeNull();
    expect(last!.kind).toBe('piste');
    expect(last!.profile.samples.length).toBeGreaterThan(10);
    expect(last!.profile.dropM).toBeGreaterThan(0);
    expect(last!.snowlineM).toBe(1500);
    h.cancelStroke();
    expect(seen[seen.length - 1]).toBeNull();
  });
});
