import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Grid } from '../../src/world/Grid';
import { Buildings } from '../../src/sim/Buildings';
import { Networks, NetKind, Conn, lineTiles } from '../../src/world/Networks';
import { tileNetwork, networkRects, surfaceHeightAt, type GeoData } from '../../src/render/meshes/Paths';
import { safely } from '../../src/core/safe';
import { formatInputLine } from '../../src/ui/inputDebug';

const mk = () => {
  const grid = new Grid(64);
  const net = new Networks(grid, new Buildings(grid.occupancy));
  return { grid, net };
};
const geo = (): GeoData => ({ positions: [], uvs: [], colors: [], indices: [] });
const bounds = (d: GeoData) => {
  const b = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
  for (let i = 0; i < d.positions.length; i += 3) {
    b.x0 = Math.min(b.x0, d.positions[i]!); b.x1 = Math.max(b.x1, d.positions[i]!);
    b.z0 = Math.min(b.z0, d.positions[i + 2]!); b.z1 = Math.max(b.z1, d.positions[i + 2]!);
  }
  return b;
};

describe('L-shaped road', () => {
  it('elbow tile has both bits and neighbours have reciprocal bits', () => {
    const { net, grid } = mk();
    net.buildSegment(NetKind.Path, lineTiles({ x: 10, y: 10 }, { x: 13, y: 13 }));
    const c = (x: number, y: number) => net.conn[grid.tileIndex(x, y)]!;
    expect(c(13, 10)).toBe(Conn.W | Conn.S);
    expect(c(12, 10) & Conn.E).toBe(Conn.E);
    expect(c(13, 11) & Conn.N).toBe(Conn.N);
    expect(c(12, 10) & Conn.W).toBe(Conn.W);
  });
  it('corner mesh reaches both connected tile edges and fills the centre, no gap', () => {
    const { net } = mk();
    // an isolated W|S corner (neighbours are dead ends, so every edge tangent stays axis-aligned)
    net.buildSegment(NetKind.Path, lineTiles({ x: 12, y: 10 }, { x: 13, y: 10 }));
    net.buildSegment(NetKind.Path, lineTiles({ x: 13, y: 10 }, { x: 13, y: 11 }));
    const d = geo();
    tileNetwork(d, (net as unknown as { grid: Grid }).grid, net, 13, 10); // W|S corner
    const b = bounds(d);
    expect(b.x0).toBeCloseTo(13); // reaches west edge
    expect(b.z1).toBeCloseTo(11); // reaches south edge
    expect(b.x1).toBeLessThan(13.9); // no arm to the east
    expect(b.z0).toBeGreaterThan(10.1); // no arm to the north
    // rects tile the L exactly: centre + W + S arms share edges
    const r = networkRects(13, 10, 0.2, Conn.W | Conn.S);
    expect(r).toHaveLength(3);
    const [c, s, w] = r as [number, number, number, number][];
    expect(w![2]).toBeCloseTo(c![0]); expect(s![1]).toBeCloseTo(c![3]);
    expect([w![1], w![3]]).toEqual([c![1], c![3]]);
    expect([s![0], s![2]]).toEqual([c![0], c![2]]);
  });
  it('surface height matches terrain triangles on a sloped, non-planar tile', () => {
    const grid = new Grid(64);
    grid.setCorner(20, 20, 0); grid.setCorner(21, 20, 1); grid.setCorner(21, 21, 0); grid.setCorner(20, 21, 1);
    const [n, e, s, w] = grid.getCorners(20, 20);
    expect(surfaceHeightAt(grid, 20, 20)).toBeCloseTo(n * 0.5);
    expect(surfaceHeightAt(grid, 21, 20)).toBeCloseTo(e * 0.5);
    expect(surfaceHeightAt(grid, 21, 21)).toBeCloseTo(s * 0.5);
    expect(surfaceHeightAt(grid, 20, 21)).toBeCloseTo(w * 0.5);
  });
});

describe('robustness helpers', () => {
  it('safely returns fallback and reports instead of throwing', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const rep = vi.fn();
    expect(safely('x', () => { throw new Error('boom'); }, rep)).toBeNull();
    expect(rep).toHaveBeenCalledWith('x failed to start: boom');
    expect(safely('y', () => 5)).toBe(5);
    err.mockRestore();
  });
  it('input line names target, tool and tile', () => {
    const l = formatInputLine({ target: { tagName: 'ST-HELP', id: '', className: '' }, onCanvas: false, tool: 'terraform', tile: null, button: 0 });
    expect(l).toContain('st-help'); expect(l).toContain('NOT canvas');
  });
  it('help overlay host must not cover the screen (regression: blocked all clicks)', () => {
    const src = readFileSync('src/ui/components/StHelp.ts', 'utf8');
    const host = /:host\{([^}]*)\}/.exec(src)![1]!;
    expect(host).not.toMatch(/inset/);
    expect(host).not.toMatch(/pointer-events:\s*none/);
  });
});

import { tileLines, sleepers, lineLength, SLEEPER_SPACING, RAIL_GAUGE_HALF } from '../../src/render/meshes/Paths';

describe('rail geometry', () => {
  const verts = (d: GeoData) => { const o: Array<[number, number, number]> = []; for (let i = 0; i < d.positions.length; i += 3) o.push([d.positions[i]!, d.positions[i + 1]!, d.positions[i + 2]!]); return o; };
  it('centre-lines of adjacent tiles meet exactly at the shared edge midpoint', () => {
    const a = tileLines(10, 10, Conn.W | Conn.E, 64, 0.12)[0]!, b = tileLines(11, 10, Conn.W | Conn.E, 64, 0.12)[0]!;
    expect(a.pts[a.pts.length - 1]).toEqual(b.pts[0]);
    // corner tile (W|S) edge points equal its neighbours' (E arm of the west tile / N arm of the south tile)
    const c = tileLines(13, 10, Conn.W | Conn.S, 64, 0.12)[0]!;
    const ends = [c.pts[0], c.pts[c.pts.length - 1]];
    expect(ends).toContainEqual([13, 10.5]);
    expect(ends).toContainEqual([13.5, 11]);
    const west = tileLines(12, 10, Conn.W | Conn.E, 64, 0.12)[0]!;
    expect(west.pts[west.pts.length - 1]).toEqual([13, 10.5]);
    const south = tileLines(13, 11, Conn.N | Conn.S, 64, 0.12)[0]!;
    expect(south.pts[0]).toEqual([13.5, 11]);
  });
  it('rail mesh vertices on the shared tile edge coincide (continuous rails, no gap)', () => {
    const { net, grid } = mk();
    net.roadEntry = null; net.railEntry = { x: 10, y: 10 };
    net.buildSegment(NetKind.Rail, [{ x: 10, y: 10 }, { x: 11, y: 10 }, { x: 12, y: 10 }]);
    const A = geo(), B = geo();
    tileNetwork(A, grid, net, 10, 10); tileNetwork(B, grid, net, 11, 10);
    const edgeZ = (d: GeoData) => verts(d).filter((v) => Math.abs(v[0] - 11) < 1e-9).map((v) => v[2].toFixed(4)).sort();
    const az = new Set(edgeZ(A)), bz = new Set(edgeZ(B));
    for (const o of [-RAIL_GAUGE_HALF - 0.022, -RAIL_GAUGE_HALF + 0.022, RAIL_GAUGE_HALF - 0.022, RAIL_GAUGE_HALF + 0.022]) {
      const z = (10.5 + o).toFixed(4);
      expect(az.has(z)).toBe(true); expect(bz.has(z)).toBe(true);
    }
  });
  it('sleepers: 4 per straight tile, even spacing, aligned in world space across tiles', () => {
    const xs: number[] = [];
    for (let x = 10; x < 13; x++) for (const s of sleepers(tileLines(x, 5, Conn.W | Conn.E, 64, 0.12)[0]!.pts)) xs.push(s.p[0]);
    expect(xs).toHaveLength(12);
    xs.forEach((v, i) => expect(v).toBeCloseTo(10 + 0.125 + i * SLEEPER_SPACING, 9));
    const corner = tileLines(5, 5, Conn.N | Conn.E, 64, 0.12)[0]!;
    const s = sleepers(corner.pts);
    expect(s.length).toBe(Math.round(lineLength(corner.pts) / SLEEPER_SPACING));
  });
  it('dead end at an interior tile has a bumper; at the map edge it runs to the edge', () => {
    expect(tileLines(10, 10, Conn.W, 64, 0.12)[0]!.bumper).toBe(true);
    const e = tileLines(10, 63, Conn.N, 64, 0.12)[0]!;
    expect(e.bumper).toBeFalsy();
    expect(e.pts[1]).toEqual([10.5, 64]);
  });
  it('T junction = through line + branch to centre; cross = two through lines', () => {
    const t = tileLines(10, 10, Conn.W | Conn.E | Conn.S, 64, 0.12);
    expect(t.map((l) => l.role).sort()).toEqual(['branch', 'through']);
    expect(tileLines(10, 10, 15, 64, 0.12)).toHaveLength(2);
  });
  it('rail tile mesh has non-empty draped geometry with up-facing triangles', () => {
    const { net, grid } = mk();
    net.railEntry = { x: 10, y: 10 };
    net.buildSegment(NetKind.Rail, [{ x: 10, y: 10 }, { x: 11, y: 10 }]);
    const d = geo(); tileNetwork(d, grid, net, 10, 10);
    expect(d.indices.length).toBeGreaterThan(100);
    const v = verts(d);
    let up = 0, down = 0;
    for (let i = 0; i < d.indices.length; i += 3) {
      const [a, b, c] = [v[d.indices[i]!]!, v[d.indices[i + 1]!]!, v[d.indices[i + 2]!]!];
      const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      if (ny > 1e-12) up++; else if (ny < -1e-12) down++;
    }
    expect(up).toBeGreaterThan(down);
  });
  it('road centre line reaches every connected edge (continuous lane marks)', () => {
    const { net, grid } = mk();
    net.roadEntry = { x: 20, y: 20 };
    net.buildSegment(NetKind.Road, [{ x: 20, y: 20 }, { x: 21, y: 20 }, { x: 22, y: 20 }]);
    const d = geo(); tileNetwork(d, grid, net, 21, 20);
    const b = bounds(d);
    expect(b.x0).toBeCloseTo(21); expect(b.x1).toBeCloseTo(22);
  });
});
