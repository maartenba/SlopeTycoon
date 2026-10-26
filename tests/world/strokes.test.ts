import { describe, it, expect, vi } from 'vitest';
import { Grid } from '../../src/world/Grid';
import { Buildings } from '../../src/sim/Buildings';
import { Networks, NetKind, Layer, interpolateStroke, sweepBrush, lineTiles, PISTE_MIN_FRAGMENT, PISTE_WATER_MSG } from '../../src/world/Networks';
import { StrokeHistory } from '../../src/build/StrokeHistory';
import { PisteTool, TRAIL_ORPHAN_MSG } from '../../src/build/PisteTool';
import { SegmentTool } from '../../src/build/PathTool';

const mk = () => {
  const grid = new Grid(64);
  const net = new Networks(grid, new Buildings(grid.occupancy));
  return { grid, net };
};
const key = (p: { x: number; y: number }) => `${p.x},${p.y}`;
const connected4 = (s: Array<{ x: number; y: number }>) => s.every((p, i) => i === 0 || Math.abs(p.x - s[i - 1]!.x) + Math.abs(p.y - s[i - 1]!.y) === 1);
const block = (x: number, y: number, w: number, h: number) => { const o = []; for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) o.push({ x: x + i, y: y + j }); return o; };

describe('stroke interpolation', () => {
  it('a long fast jump covers every tile, 4-connected, from start to end', () => {
    const s = interpolateStroke([{ x: 3, y: 4 }, { x: 40, y: 17 }]);
    expect(s[0]).toEqual({ x: 3, y: 4 });
    expect(s[s.length - 1]).toEqual({ x: 40, y: 17 });
    expect(connected4(s)).toBe(true);
    expect(new Set(s.map(key)).size).toBe(s.length);
    expect(s.length).toBe(37 + 13 + 1);
  });
  it('is gap-free in all directions (corner tile filled)', () => {
    for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1], [7, 2], [-2, 9], [0, 5], [5, 0]] as const) {
      const s = interpolateStroke([{ x: 20, y: 20 }, { x: 20 + dx, y: 20 + dy }]);
      expect(connected4(s)).toBe(true);
      expect(s[s.length - 1]).toEqual({ x: 20 + dx, y: 20 + dy });
    }
  });
  it('chains multiple samples and drops duplicates', () => {
    const s = interpolateStroke([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 5 }, { x: 5, y: 5 }, { x: 1, y: 9 }]);
    expect(connected4(s)).toBe(true);
    expect(s.some((p) => p.x === 5 && p.y === 5)).toBe(true);
  });
  it('brush sweep covers the footprint along the whole segment and clips to the map', () => {
    const t = sweepBrush(interpolateStroke([{ x: 1, y: 1 }, { x: 30, y: 1 }]), 2, 64);
    expect(t.length).toBe(32 * 3); // x 0..31, y 0..2
    expect(sweepBrush([{ x: 0, y: 0 }], 3, 64).length).toBe(9);
  });
  it('lineTiles (footpath/road/rail drag) is 4-connected', () => {
    expect(connected4(lineTiles({ x: 0, y: 0 }, { x: 25, y: 14 }))).toBe(true);
  });
});

describe('orphan rules', () => {
  it('trail strokes need an anchor (network tile, building, or same-layer trail)', () => {
    const { net } = mk();
    const stroke = interpolateStroke([{ x: 10, y: 10 }, { x: 14, y: 10 }]);
    expect(net.strokeAnchored(stroke, Layer.Mtb)).toBe(false);
    net.buildSegment(NetKind.Path, [{ x: 9, y: 10 }]);
    expect(net.strokeAnchored(stroke, Layer.Mtb)).toBe(true);
    net.paint(Layer.Hike, [{ x: 30, y: 30 }]);
    expect(net.strokeAnchored([{ x: 31, y: 30 }], Layer.Hike)).toBe(true);
    expect(net.strokeAnchored([{ x: 31, y: 30 }], Layer.Mtb)).toBe(false);
  });
  it('pruneOrphans removes unattached trail components but keeps attached ones', () => {
    const { net } = mk();
    net.buildSegment(NetKind.Path, [{ x: 5, y: 5 }]);
    net.paint(Layer.Mtb, [{ x: 6, y: 5 }, { x: 7, y: 5 }]);
    net.paint(Layer.Mtb, [{ x: 40, y: 40 }, { x: 41, y: 40 }]);
    expect(net.pruneOrphans(Layer.Mtb)).toBe(2);
    expect(net.pisteAt(6, 5)).toBe(true);
    expect(net.pisteAt(40, 40)).toBe(false);
  });
});

describe('piste components and cleanup', () => {
  it('components use 8-connectivity and report stats; largest is main', () => {
    const { net } = mk();
    net.paint(Layer.Ski, [...block(10, 10, 5, 5), { x: 15, y: 15 }]);
    net.paint(Layer.Ski, block(40, 40, 2, 2));
    const c = net.pisteComponents();
    expect(c).toHaveLength(2);
    const main = c.find((k) => k.main)!;
    expect(main.count).toBe(26);
    expect(c.find((k) => !k.main)!.disconnected).toBe(true);
    expect(main.disconnected).toBe(false);
    expect(main.topAlt).toBeGreaterThanOrEqual(main.bottomAlt);
    expect(main.touchesLift).toBe(false);
  });
  it('cleanup removes tiny stray fragments, keeps big ones and fragments touching a path', () => {
    const { net } = mk();
    net.paint(Layer.Ski, block(10, 10, 6, 6));
    net.paint(Layer.Ski, [{ x: 40, y: 40 }, { x: 41, y: 40 }]);
    net.paint(Layer.Ski, block(50, 10, 2, 2));
    net.buildSegment(NetKind.Path, [{ x: 49, y: 10 }]);
    net.paint(Layer.Ski, block(30, 30, PISTE_MIN_FRAGMENT, 1));
    expect(net.cleanupPiste()).toBe(2);
    expect(net.pisteAt(40, 40)).toBe(false);
    expect(net.pisteAt(50, 10)).toBe(true);
    expect(net.pisteAt(30, 30)).toBe(true);
    expect(net.pisteComponents().filter((c) => c.disconnected)).toHaveLength(2);
  });
  it('disconnected status updates as pieces are joined', () => {
    const { net } = mk();
    net.paint(Layer.Ski, block(10, 10, 5, 1));
    net.paint(Layer.Ski, block(17, 10, 3, 1));
    expect(net.disconnectedMask()[net.idxOf(18, 10)]).toBe(1);
    net.paint(Layer.Ski, [{ x: 15, y: 10 }, { x: 16, y: 10 }]);
    expect(net.pisteComponents()).toHaveLength(1);
    expect(net.disconnectedMask()[net.idxOf(18, 10)]).toBe(0);
  });
});

describe('difficulty smoothing', () => {
  it('noisy uniform slope gives (almost) one difficulty along the stroke', () => {
    const { net, grid } = mk();
    for (let y = 0; y <= 64; y++) for (let x = 0; x <= 64; x++) grid.setCorner(x, y, Math.min(40, Math.floor(y * 1.05 + ((x * 7 + y * 3) % 5 === 0 ? 1 : 0))));
    const line = interpolateStroke([{ x: 20, y: 10 }, { x: 20, y: 40 }]);
    const d = net.autoDifficulty(line);
    const v = (p: { x: number; y: number }) => d.get(p.y * 64 + p.x);
    const flips = line.reduce((n, p, i) => n + (i && v(p) !== v(line[i - 1]!) ? 1 : 0), 0);
    expect(flips).toBeLessThanOrEqual(1);
  });
});

describe('journal undo + history', () => {
  it('restores tiles, occupancy and conn after a stroke; history pops by group', () => {
    const { net, grid } = mk();
    net.roadEntry = { x: 5, y: 5 };
    const before = [...net.kind];
    net.beginJournal();
    net.buildSegment(NetKind.Road, lineTiles({ x: 5, y: 5 }, { x: 9, y: 5 }));
    net.paint(Layer.Ski, [{ x: 20, y: 20 }, { x: 21, y: 20 }]);
    const diff = net.endJournal();
    expect(diff.length).toBe(7);
    const h = new StrokeHistory();
    h.push({ group: 'road', diff, cost: 300 });
    h.push({ group: 'path', diff: [], cost: 20 });
    expect(h.pop('road')!.cost).toBe(300);
    net.restore(diff);
    expect([...net.kind]).toEqual(before);
    expect(net.pisteAt(20, 20)).toBe(false);
    expect(net.conn.every((c) => c === 0)).toBe(true);
    expect(grid.occupancy.flags.every((f) => f === 0)).toBe(true);
    expect(h.pop('road')).toBeUndefined();
    expect(h.size).toBe(1);
  });
  it('erase (unpaint) is journaled and undoable', () => {
    const { net } = mk();
    net.paint(Layer.Ski, [{ x: 3, y: 3 }, { x: 4, y: 3 }], 2);
    net.beginJournal();
    net.unpaint(Layer.Ski, 3, 3);
    const diff = net.endJournal();
    expect(net.pisteAt(3, 3)).toBe(false);
    net.restore(diff);
    expect(net.pisteAt(3, 3)).toBe(true);
    expect(net.difficulty[net.idxOf(3, 3)]).toBe(2);
  });
});

describe('tool stroke flow (fake DOM)', () => {
  const setup = () => {
    vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
    const { grid, net } = mk();
    const o = {
      grid, networks: net, camera: {} as never, dom: { addEventListener() {}, removeEventListener() {} } as never, scene: { add() {}, remove() {} } as never,
      charge: () => true, multiplier: () => 1, onChanged: () => {}, onError: vi.fn(), history: new StrokeHistory(), refund: vi.fn(), onInfo: vi.fn(),
    };
    return { grid, net, o };
  };
  type Hack = { begin(p: unknown): void; sample(p: unknown): void; tiles(): Array<{ x: number; y: number }>; evaluate(t: unknown): { ok: boolean; text: string; cost: number }; erasing: boolean; commit(t: unknown): void };
  it('fast-move trail stroke is complete; orphan rejected with message; anchored accepted', () => {
    const { net, o } = setup();
    const tool = new PisteTool(o);
    tool.startTool(Layer.Mtb);
    const h = tool as unknown as Hack;
    h.begin({ x: 10, y: 10 }); h.sample({ x: 30, y: 25 });
    const t = h.tiles();
    expect(t.length).toBe(20 + 15 + 1);
    expect(h.evaluate(t)).toMatchObject({ ok: false, text: TRAIL_ORPHAN_MSG });
    net.buildSegment(NetKind.Path, [{ x: 9, y: 10 }]);
    expect(h.evaluate(t).ok).toBe(true);
    tool.dispose();
  });
  it('ski brush sweeps along the stroke; erase removes only painted tiles', () => {
    const { net, o } = setup();
    const tool = new PisteTool(o);
    tool.brush = 2; tool.startTool(Layer.Ski);
    const h = tool as unknown as Hack;
    h.begin({ x: 10, y: 10 }); h.sample({ x: 30, y: 10 });
    const t = h.tiles();
    expect(t.length).toBe(23 * 3);
    h.commit(t);
    expect(net.pisteAt(20, 11)).toBe(true);
    tool.cancelStroke();
    h.erasing = true;
    h.begin({ x: 10, y: 10 }); h.sample({ x: 12, y: 10 });
    const e = h.tiles();
    expect(e.length).toBeGreaterThan(0);
    expect(e.every((p) => net.pisteAt(p.x, p.y))).toBe(true);
    h.commit(e);
    expect(net.pisteAt(10, 10)).toBe(false);
    expect(net.pisteAt(25, 10)).toBe(true);
    tool.dispose();
  });
  it('stray ski fragment is removed after the stroke with a toast', () => {
    const { net, o } = setup();
    net.paint(Layer.Ski, block(10, 10, 5, 5));
    const tool = new PisteTool(o);
    tool.startTool(Layer.Ski);
    const h = tool as unknown as Hack;
    h.begin({ x: 40, y: 40 }); h.sample({ x: 41, y: 40 });
    h.commit(h.tiles());
    expect(net.pisteAt(40, 40)).toBe(false);
    expect(o.onInfo).toHaveBeenCalledWith('Removed 2 stray tiles');
    tool.dispose();
  });
  it('ski stroke truncates at a stream bank with a toast; trails bridge streams', () => {
    const { grid, net, o } = setup();
    grid.tileType[grid.tileIndex(20, 10)] = 6;
    expect(net.canPaint(20, 10)).toEqual({ ok: false, reason: PISTE_WATER_MSG });
    expect(net.paint(Layer.Ski, [{ x: 20, y: 10 }]).painted).toBe(0);
    const tool = new PisteTool(o);
    tool.startTool(Layer.Ski);
    const h = tool as unknown as Hack;
    h.begin({ x: 15, y: 10 }); h.sample({ x: 30, y: 10 });
    const t = h.tiles();
    expect(t.length).toBe(5);
    expect(t.some((p) => p.x >= 20)).toBe(false);
    h.commit(t);
    expect(o.onInfo).toHaveBeenCalledWith(PISTE_WATER_MSG);
    expect(net.pisteAt(25, 10)).toBe(false);
    tool.dispose();
    // lake tiles block every layer; streams bridge for trails
    grid.tileType[grid.tileIndex(5, 5)] = 2;
    expect(net.canPaint(5, 5, Layer.Hike).ok).toBe(false);
    expect(net.canPaint(20, 10, Layer.Mtb).ok).toBe(true);
    net.paint(Layer.Hike, [{ x: 19, y: 10 }, { x: 20, y: 10 }, { x: 21, y: 10 }]);
    expect(net.bridge[grid.tileIndex(20, 10)]).toBe(1);
    net.unpaint(Layer.Hike, 20, 10);
    expect(net.bridge[grid.tileIndex(20, 10)]).toBe(0);
  });
  it('footpath without an anchor is rejected', () => {
    const { net, o } = setup();
    const tool = new SegmentTool(o, NetKind.Path);
    const h = tool as unknown as Hack;
    expect(h.evaluate([{ x: 30, y: 30 }, { x: 31, y: 30 }]).ok).toBe(false);
    net.buildSegment(NetKind.Path, [{ x: 29, y: 30 }]);
    expect(h.evaluate([{ x: 30, y: 30 }, { x: 31, y: 30 }]).ok).toBe(true);
    tool.dispose();
  });
});
