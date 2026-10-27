import { describe, it, expect } from 'vitest';
import { buildRuns, type RunNetwork } from '../../src/world/Runs';

/** ASCII map: '#' piste. alt = row index descending (top of map = high) unless altFn. */
function fromAscii(rows: string[], opts: { stations?: Array<{ x: number; y: number }>; diff?: (i: number) => number } = {}): RunNetwork {
  const h = rows.length, w = Math.max(...rows.map((r) => r.length)), size = Math.max(h, w);
  const mask = new Uint8Array(size * size);
  rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] === '#') mask[y * size + x] = 1; });
  const diff = new Uint8Array(size * size);
  if (opts.diff) for (let i = 0; i < diff.length; i++) diff[i] = opts.diff(i);
  return buildRuns({ size, mask, alt: (i) => 100 - Math.floor(i / size) * 0.5, difficulty: diff, stations: opts.stations });
}
const every = (rn: RunNetwork, mask: (i: number) => boolean): void => {
  const n = rn.size * rn.size;
  for (let i = 0; i < n; i++) {
    const inRun = rn.runOf[i]! >= 0, inNode = rn.nodeOf[i]! >= 0;
    expect(inRun !== inNode || !mask(i)).toBe(true); // piste: exactly one
    if (mask(i)) expect(inRun || inNode).toBe(true);
    else expect(inRun || inNode).toBe(false);
  }
};

describe('buildRuns topology', () => {
  it('a single line is one run, downhill', () => {
    const rn = fromAscii(['#', '#', '#', '#', '#', '#']);
    expect(rn.runs).toHaveLength(1);
    expect(rn.runs[0]!.top.y).toBe(0);
    expect(rn.runs[0]!.bottom.y).toBe(5);
    expect(rn.runs[0]!.count).toBe(6);
  });
  it('a Y junction makes three runs and one node', () => {
    const rn = fromAscii([
      '#.........#',
      '.#.......#.',
      '..#.....#..',
      '...#...#...',
      '....#.#....',
      '.....#.....',
      '.....#.....',
      '.....#.....',
      '.....#.....',
      '.....#.....',
      '.....#.....',
    ]);
    expect(rn.nodes.length).toBe(1);
    expect(rn.runs).toHaveLength(3);
    expect(rn.nodes[0]!.runsIn).toHaveLength(2);
    expect(rn.nodes[0]!.runsOut).toHaveLength(1);
  });
  it('a lift station splits a run', () => {
    const rows = Array.from({ length: 12 }, () => '#');
    const rn = fromAscii(rows, { stations: [{ x: 1, y: 6 }] });
    expect(rn.runs).toHaveLength(2);
    expect(rn.nodes).toHaveLength(1);
    expect(rn.nodes[0]!.kind).toBe('station');
  });
  it('a wide slope is one run, not a ladder', () => {
    const rows = Array.from({ length: 24 }, () => '######');
    const rn = fromAscii(rows);
    expect(rn.runs).toHaveLength(1);
    expect(rn.runs[0]!.count).toBe(144);
  });
  it('a blob is one run', () => {
    const rn = fromAscii(['#####', '#####', '#####', '#####', '#####']);
    expect(rn.runs).toHaveLength(1);
    expect(rn.runs[0]!.count).toBe(25);
  });
  it('a 2x2 block (thinning kills it) is one synthetic run', () => {
    const rn = fromAscii(['##', '##']);
    expect(rn.runs).toHaveLength(1);
    expect(rn.runs[0]!.synthetic).toBe(true);
  });
  it('a closed ring is one loop run', () => {
    const rn = fromAscii(['#####', '#...#', '#...#', '#...#', '#####']);
    expect(rn.runs).toHaveLength(1);
    expect(rn.runs[0]!.loop).toBe(true);
    every(rn, (i) => { const x = i % rn.size, y = (i / rn.size) | 0; return x === 0 || y === 0 || x === 4 || y === 4; });
  });
  it('two unconnected pistes are two runs', () => {
    const rn = fromAscii(['#...#', '#...#', '#...#', '#...#', '#...#']);
    expect(rn.runs).toHaveLength(2);
  });
});

const bigMap = (size: number, draw: (set: (x: number, y: number) => void) => void): RunNetwork => {
  const mask = new Uint8Array(size * size);
  draw((x, y) => { if (x >= 0 && y >= 0 && x < size && y < size) mask[y * size + x] = 1; });
  return buildRuns({ size, mask, alt: (i) => 100 - Math.floor(i / size) * 0.5, difficulty: new Uint8Array(size * size) });
};

describe('buildRuns wide pistes', () => {
  it('a wide T: trunk + two wide branches = a handful of runs, no slivers', () => {
    // wide vertical trunk (width 6) that forks into two wide diagonal-ish arms at the bottom
    const rn = bigMap(48, (set) => {
      for (let y = 2; y < 24; y++) for (let x = 20; x < 26; x++) set(x, y);
      for (let y = 24; y < 44; y++) for (let x = 8; x < 14; x++) set(x, y);
      for (let y = 24; y < 44; y++) for (let x = 32; x < 38; x++) set(x, y);
      for (let x = 8; x < 38; x++) for (let y = 24; y < 28; y++) set(x, y);
    });
    expect(rn.runs.length).toBeGreaterThanOrEqual(3);
    expect(rn.runs.length).toBeLessThanOrEqual(6);
    for (const r of rn.runs) expect(r.count).toBeGreaterThan(8);
  });
  it('a thick diagonal band is one run', () => {
    const rn = bigMap(48, (set) => { for (let k = 0; k < 40; k++) for (let w = 0; w < 5; w++) set(k + w, k); });
    expect(rn.runs).toHaveLength(1);
  });
  it('every tile owned exactly once (wide T)', () => {
    const mk = (set: (x: number, y: number) => void): void => {
      for (let y = 2; y < 24; y++) for (let x = 20; x < 26; x++) set(x, y);
      for (let y = 24; y < 44; y++) for (let x = 8; x < 14; x++) set(x, y);
    };
    const rn = bigMap(48, mk);
    const m = new Uint8Array(48 * 48); mk((x, y) => { m[y * 48 + x] = 1; });
    every(rn, (i) => m[i] === 1);
  });
});

describe('buildRuns property tests (random strokes)', () => {
  const rng = (s: number) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  it('50 random stroke sets: ownership, downhill orientation, node wiring, determinism', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const r = rng(seed), size = 40, m = new Uint8Array(size * size);
      const strokes = 2 + Math.floor(r() * 4);
      for (let s = 0; s < strokes; s++) {
        let x = Math.floor(r() * size), y = Math.floor(r() * 8); const brush = r() < 0.4 ? 2 : 1;
        for (let k = 0; k < 20 + Math.floor(r() * 20); k++) {
          for (let dy = 0; dy < brush; dy++) for (let dx = 0; dx < brush; dx++) { const px = x + dx, py = y + dy; if (px < size && py < size) m[py * size + px] = 1; }
          y = Math.min(size - 1, y + (r() < 0.8 ? 1 : 0)); x = Math.max(0, Math.min(size - 1, x + Math.floor(r() * 3) - 1));
        }
      }
      const input = { size, mask: m, alt: (i: number) => 100 - Math.floor(i / size) * 0.5 - (i % size) * 0.01, difficulty: new Uint8Array(size * size) };
      const rn = buildRuns(input);
      every(rn, (i) => m[i] === 1);
      let total = 0;
      for (const run of rn.runs) {
        total += run.count;
        expect(run.topAlt).toBeGreaterThanOrEqual(run.bottomAlt);
        expect(run.count).toBeGreaterThan(0);
        for (const t of run.tiles) expect(rn.runOf[t]).toBe(run.index);
        if (run.from >= 0) expect(rn.nodes[run.from]!.runsOut).toContain(run.index);
        if (run.to >= 0) expect(rn.nodes[run.to]!.runsIn).toContain(run.index);
      }
      let nodeTiles = 0; for (const nd of rn.nodes) nodeTiles += nd.tiles.length;
      expect(total + nodeTiles).toBe(m.reduce((a, b) => a + b, 0));
      expect(JSON.stringify(buildRuns(input).runs.map((q) => q.tiles))).toBe(JSON.stringify(rn.runs.map((q) => q.tiles)));
    }
  });
  it('rebuild on a 256 map with a big network stays fast', () => {
    const size = 256, m = new Uint8Array(size * size);
    for (let s = 0; s < 12; s++) { let x = 20 + s * 18; for (let y = 5; y < 250; y++) { for (let w = 0; w < 4; w++) m[y * size + x + w] = 1; x += (y % 7 === 0 ? 1 : 0) - (y % 11 === 0 ? 1 : 0); } }
    for (let x = 20; x < 230; x++) for (let w = 0; w < 3; w++) m[(120 + w) * size + x] = 1;
    const input = { size, mask: m, alt: (i: number) => 100 - Math.floor(i / size) * 0.5, difficulty: new Uint8Array(size * size) };
    let best = Infinity;
    for (let k = 0; k < 5; k++) { const t = performance.now(); buildRuns(input); best = Math.min(best, performance.now() - t); }
    console.log('buildRuns 256 big network best ms', best.toFixed(2));
    expect(best).toBeLessThan(40);
  });
});
