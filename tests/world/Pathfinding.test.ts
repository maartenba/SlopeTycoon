import { describe, it, expect } from 'vitest';
import { generatedResort, starterResort, Fixture } from '../sim/guests/resortFixture';
import { NavGraph, NavMode, type NavWorld } from '../../src/sim/guests/NavGraph';
import { Grid } from '../../src/world/Grid';
import { generateTerrain } from '../../src/world/TerrainGen';
import { HEIGHT_UNIT } from '../../src/config/balance';
import { budget } from '../perfMode';

/** Deterministic pairs of mutually reachable tiles of a mode (via the reference A*). */
function pairs(f: Fixture, mode: number, count: number, seed: number, minDist: number): Array<[number, number]> {
  const g = f.graph();
  g.update(0);
  const tiles: number[] = [];
  for (let t = 0; t < f.size * f.size; t++) if (g.standable(mode, t) && !g.isStation(t)) tiles.push(t);
  let s = seed >>> 0;
  const rnd = (): number => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const out: Array<[number, number]> = [];
  let guard = 0;
  while (out.length < count && guard++ < count * 400) {
    const a = tiles[Math.floor(rnd() * tiles.length)]!, b = tiles[Math.floor(rnd() * tiles.length)]!;
    const d = Math.max(Math.abs((a % f.size) - (b % f.size)), Math.abs(((a / f.size) | 0) - ((b / f.size) | 0)));
    if (d < minDist) continue;
    if (g.pf.findFull(mode, a, b)) out.push([a, b]);
  }
  return out;
}

describe('hierarchical pathfinding vs full A*', () => {
  for (const size of [128, 256] as const) {
    for (const mode of [NavMode.Walk, NavMode.Hike, NavMode.Ski1, NavMode.Ski3] as const) {
      it(`${size} ${['walk', 'hike', 'bike', 'ski0', 'ski1', 'ski2', 'ski3'][mode]}: cost within 10% of full A* (long queries)`, () => {
        const f = generatedResort(size, mode === NavMode.Ski1 ? 19 : 7);
        const g = f.graph(); g.update(0);
        const ps = pairs(f, mode, 40, 99, 40);
        expect(ps.length).toBeGreaterThan(5);
        let worst = 1;
        for (const [a, b] of ps) {
          const full = g.pf.findFull(mode, a, b)!, h = g.pf.find(mode, a, b);
          expect(h, `hier found ${a}->${b}`).not.toBeNull();
          // path is connected, starts/ends right and its recomputed cost matches the reported cost
          expect(h!.nodes[0]).toBe(a); expect(h!.nodes[h!.nodes.length - 1]).toBe(b);
          expect(g.pf.pathCost(mode, h!.nodes)).toBeCloseTo(h!.cost, 3);
          worst = Math.max(worst, h!.cost / full.cost);
          expect(h!.cost).toBeGreaterThanOrEqual(full.cost - 1e-3);
        }
        console.log(`[pathfinding] ${size} mode ${mode}: ${ps.length} queries, worst hier/full cost ratio ${worst.toFixed(4)}`);
        expect(worst).toBeLessThanOrEqual(1.1);
      });
    }
  }

  it('lift links are used and respect the mode', () => {
    const f = starterResort(64);
    const g = f.graph(); g.update(0);
    const n = f.size, base = Math.floor(n * 0.78), mid = n >> 1;
    const street = (mid - 1) * 1 + (base + 2) * n;
    const top = (Math.floor(n * 0.2)) * n + mid; // top station anchor
    const r = g.pf.find(NavMode.Ski1, street, top);
    expect(r).not.toBeNull();
    expect(Array.from(r!.nodes).some((t) => g.isStation(t))).toBe(true);
    expect(g.pf.find(NavMode.Walk, street, top)).toBeNull(); // walkers do not ride lifts
    f.liftList[0]!.open = false;
    g.update(1);
    expect(g.pf.find(NavMode.Ski1, street, top)).toBeNull(); // closed lift = no edge
  });

  it('incremental invalidation: a blocked tile dirties only its clusters and routes change', () => {
    const f = generatedResort(128, 3);
    const g = f.graph(); g.update(0);
    const ps = pairs(f, NavMode.Walk, 12, 5, 60);
    for (const [a, b] of ps) g.pf.find(NavMode.Walk, a, b);
    const built = g.pf.stats.clustersBuilt;
    // remove a path tile that lies on the first path
    const first = g.pf.find(NavMode.Walk, ps[0]![0], ps[0]![1])!;
    const cut = first.nodes[Math.floor(first.nodes.length / 2)]!;
    f.kind[cut] = 0; f.version++;
    g.update(1);
    const again = g.pf.find(NavMode.Walk, ps[0]![0], ps[0]![1]);
    if (again) expect(Array.from(again.nodes)).not.toContain(cut);
    const rebuilt = g.pf.stats.clustersBuilt - built;
    expect(rebuilt).toBeLessThanOrEqual(12); // only dirtied clusters (plus those newly needed by the detour), not all 16
    expect(g.pf.findFull(NavMode.Walk, ps[0]![0], ps[0]![1])?.cost ?? null).toBe(again ? g.pf.findFull(NavMode.Walk, ps[0]![0], ps[0]![1])!.cost : null);
  });

  it('caches paths per (mode, origin, goal)', () => {
    const f = generatedResort(128, 4);
    const g = f.graph(); g.update(0);
    const [a, b] = pairs(f, NavMode.Walk, 1, 1, 50)[0]!;
    const r1 = g.pf.find(NavMode.Walk, a, b);
    const q = g.pf.stats.queries;
    const r2 = g.pf.find(NavMode.Walk, a, b);
    expect(r2).toBe(r1);
    expect(g.pf.stats.queries).toBe(q);
    expect(g.pf.stats.cacheHits).toBeGreaterThan(0);
  });
});

describe('path query performance', () => {
  it('[perf] 256 map: average hierarchical query < 2 ms (logged)', () => {
    const f = generatedResort(256, 11);
    const g = f.graph(); g.update(0);
    const ps = pairs(f, NavMode.Walk, 300, 21, 20);
    const ph = pairs(f, NavMode.Hike, 100, 22, 20);
    const run = (mode: number, list: Array<[number, number]>): number => {
      const t0 = performance.now();
      for (const [a, b] of list) g.pf.find(mode, a, b);
      return (performance.now() - t0) / list.length;
    };
    const cold = run(NavMode.Walk, ps); // includes lazy cluster builds
    const g2 = f.graph(); g2.update(0);
    for (const [a, b] of ps.slice(0, 60)) g2.pf.find(NavMode.Walk, a, b); // warm clusters only
    const t0 = performance.now();
    let n = 0;
    for (const [a, b] of ps.slice(60)) { g2.pf.find(NavMode.Walk, b, a); n++; } // reversed pairs: new cache keys, warm hierarchy
    const warm = (performance.now() - t0) / n;
    const hike = run(NavMode.Hike, ph);
    const psk = pairs(f, NavMode.Ski3, 100, 23, 20);
    const ski = run(NavMode.Ski3, psk);
    console.log(`[perf] path query 256: walk cold-incl-cluster-builds ${cold.toFixed(3)} ms, warm ${warm.toFixed(3)} ms, hike ${hike.toFixed(3)} ms, ski ${ski.toFixed(3)} ms (n=${ps.length}); stats ${JSON.stringify(g.pf.stats)}`);
    expect(warm).toBeLessThan(budget(2));
    expect(cold).toBeLessThan(budget(2));
    expect(hike).toBeLessThan(budget(4)); // logged for reference; dense-portal modes carry more build cost
    expect(ski).toBeLessThan(budget(5));
  });
});

describe('real generated terrain (off-piste, expert)', () => {
  it('128 map: downhill-only off-piste routes over real heights stay within 10% of full A*', () => {
    const grid = new Grid(128);
    generateTerrain(grid, 4242);
    const n = grid.size, n2 = n * n;
    const z = new Uint8Array(n2);
    const open = new Uint8Array(n2).fill(1);
    const world: NavWorld = {
      size: n, kind: z, layers: z, difficulty: z, occ: z, tileType: grid.tileType, skiOpen: open, hikeOk: z, snow: new Float32Array(n2),
      networkVersion: () => 1, isBikeable: () => false, lifts: () => [], consumeFlips: () => null,
      tileAlt: (x, y) => { const [a, b, c, d] = grid.getCorners(x, y); return ((a + b + c + d) / 4) * HEIGHT_UNIT; },
    };
    const g = new NavGraph(world); g.pf.maxBuildsPerTick = Infinity; g.update(0);
    let s = 12345;
    const rnd = (): number => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    let tested = 0, worst = 1;
    for (let k = 0; k < 6000 && tested < 30; k++) {
      const a = Math.floor(rnd() * n2), b = Math.floor(rnd() * n2);
      if (!g.standable(NavMode.SkiOff, a) || !g.standable(NavMode.SkiOff, b)) continue;
      const d = Math.max(Math.abs((a % n) - (b % n)), Math.abs(((a / n) | 0) - ((b / n) | 0)));
      if (d < 40) continue;
      const full = g.pf.findFull(NavMode.SkiOff, a, b);
      if (!full) continue;
      const h = g.pf.find(NavMode.SkiOff, a, b);
      expect(h).not.toBeNull();
      // strictly downhill/flat along the whole route (no links on this map)
      for (let i = 1; i < h!.nodes.length; i++) expect(g.tileAltitude(h!.nodes[i]!)).toBeLessThanOrEqual(g.tileAltitude(h!.nodes[i - 1]!) + 1e-6);
      worst = Math.max(worst, h!.cost / full.cost); tested++;
    }
    console.log(`[pathfinding] real terrain 128 off-piste: ${tested} downhill queries, worst ratio ${worst.toFixed(4)}`);
    expect(tested).toBeGreaterThan(5);
    expect(worst).toBeLessThanOrEqual(1.1);
  });
});
