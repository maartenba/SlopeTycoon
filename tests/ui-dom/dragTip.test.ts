// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Grid } from '../../src/world/Grid';
import { Buildings } from '../../src/sim/Buildings';
import { Networks, NetKind, ROAD_START_MSG } from '../../src/world/Networks';
import { SegmentTool } from '../../src/build/PathTool';

/** The tool tooltip stays inside the viewport (owner screenshot: 'Blocked: Roads must start ...' ran off the right edge). */
const make = () => {
  const grid = new Grid(64);
  const net = new Networks(grid, new Buildings(grid.occupancy));
  const o = { grid, networks: net, camera: {} as never, dom: document.createElement('div'), scene: { add() {}, remove() {} } as never, charge: () => true, multiplier: () => 1, onChanged: () => {}, onError: vi.fn() };
  return new SegmentTool(o, NetKind.Road);
};
type Hack = { show(t: unknown[], ev: unknown, x: number, y: number): void; tip: HTMLElement };
afterEach(() => { document.body.replaceChildren(); });

describe('drag tool tooltip', () => {
  it('flips to the left of the pointer / above it near the right and bottom edges, never leaves the viewport, and wraps long text', () => {
    const tool = make(), h = tool as unknown as Hack;
    (window as unknown as { innerWidth: number }).innerWidth = 400; (window as unknown as { innerHeight: number }).innerHeight = 300;
    Object.defineProperty(h.tip, 'offsetWidth', { value: 260, configurable: true }); Object.defineProperty(h.tip, 'offsetHeight', { value: 48, configurable: true });
    h.show([], { ok: false, cost: 0, text: `Blocked: ${ROAD_START_MSG}` }, 390, 290);
    const left = parseFloat(h.tip.style.left), top = parseFloat(h.tip.style.top);
    expect(left + 260).toBeLessThanOrEqual(400 - 8); expect(left).toBeGreaterThanOrEqual(8);
    expect(top + 48).toBeLessThanOrEqual(300 - 8); expect(top).toBeGreaterThanOrEqual(8);
    expect(h.tip.textContent).toContain('Start the road from the road entry (the grey stub at the map edge)');
    expect(h.tip.style.whiteSpace).toBe('normal'); expect(h.tip.style.maxWidth).toContain('100vw');
    h.show([], { ok: true, cost: 1, text: 'ok' }, 20, 20); // plenty of room: the usual offset below-right
    expect(parseFloat(h.tip.style.left)).toBe(34); expect(parseFloat(h.tip.style.top)).toBe(34);
    tool.dispose();
  });
});
