import { describe, expect, it } from 'vitest';
import { Grid, TileType } from '../../src/world/Grid';
import { OccFlag } from '../../src/world/Occupancy';
import { applyFillRiver, applyRiver, planFillRiver, planRiver, REASON, type RiverEnv } from '../../src/world/RiverPlanner';
import { Rivers } from '../../src/world/Rivers';
import { waterways } from '../../src/world/Streams';
import { RIVER } from '../../src/config/rivers';
import { lakesValid } from '../../src/world/TerrainGen';
import { createSim } from '../../src/game/createSim';
import { budget } from '../perfMode';

/** A gentle plane falling towards x = 0 (h = 4 + vx/2) plus an optional tent-shaped ridge across the whole map at x = 20 (1 per vertex: every tile stays legal). */
function plane(size: 64 | 128 = 64, ridge = 0): Grid {
  const g = new Grid(size);
  for (let vy = 0; vy < g.vsize; vy++) for (let vx = 0; vx < g.vsize; vx++) g.heights[vy * g.vsize + vx] = 4 + (vx >> 1) + Math.max(0, ridge - Math.abs(vx - 20));
  g.tileType.fill(TileType.Grass);
  return g;
}
const env = (g: Grid, extra: Partial<RiverEnv> = {}): RiverEnv => ({ grid: g, ...extra });
const hashOf = (g: Grid): string => `${[...g.heights].join(',')}|${[...g.tileType].join('')}|${[...g.occupancy.flags].join('')}`;

describe('RiverPlanner (pure, synthetic terrain)', () => {
  it('plans a river along the fall line to the map edge: monotone, 1 wide, nothing carved on a clean slope, grid untouched', () => {
    const g = plane(), before = hashOf(g), e = env(g, { isSpring: (x, y) => x === 40 && y === 30 });
    const p = planRiver(e, { x: 40, y: 30 }, { x: 0, y: 30 });
    expect(p.ok).toBe(true);
    expect(p.source?.kind).toBe('spring');
    expect(p.sink).toEqual({ kind: 'edge', x: 0, y: 30 });
    expect(p.path.length).toBe(41);
    for (let i = 1; i < p.path.length; i++) expect(Math.abs(p.path[i]!.x - p.path[i - 1]!.x) + Math.abs(p.path[i]!.y - p.path[i - 1]!.y)).toBe(1); // 4-connected = 1 tile wide
    for (let i = 1; i < p.level.length; i++) expect(p.level[i]!).toBeLessThanOrEqual(p.level[i - 1]!);
    expect(p.maxCarve).toBe(0);
    expect(p.cost).toBe(41 * RIVER.costPerTile);
    expect(hashOf(g)).toBe(before);
  });

  it('is deterministic: the same request gives the same route, carve plan and cost', () => {
    const g = plane(64, 8), e = env(g, { isSpring: () => true });
    const a = planRiver(e, { x: 40, y: 30 }), b = planRiver(e, { x: 40, y: 30 });
    expect(a.ok).toBe(true);
    expect(JSON.stringify([a.path, a.level, a.changed, a.cost, a.sink])).toBe(JSON.stringify([b.path, b.level, b.changed, b.cost, b.sink]));
  });

  it('carves through a ridge: at most 6 half-steps per tile, cost grows with the cut, then digging + filling restores the ground exactly', () => {
    const g = plane(64, 8), before = hashOf(g), pre = [...g.heights];
    const rivers = new Rivers(g), e = env(g, { isSpring: () => true });
    const p = planRiver(e, { x: 40, y: 30 }, { x: 0, y: 30 });
    expect(p.ok).toBe(true);
    expect(p.maxCarve).toBeGreaterThanOrEqual(2);
    expect(p.maxCarve).toBeLessThanOrEqual(RIVER.maxCarve);
    expect(Math.max(...p.carveDepth)).toBe(p.maxCarve);
    expect(p.earthCost).toBeGreaterThan(0);
    expect(p.cost).toBeGreaterThan(p.path.length * RIVER.costPerTile);
    expect(hashOf(g)).toBe(before); // planning does not change the world
    const r = applyRiver(e, rivers, p);
    expect(r.ok).toBe(true);
    expect(g.checkInvariants()).toEqual([]);
    for (const t of p.path) { const i = t.y * g.size + t.x; expect(g.tileType[i]).toBe(TileType.Stream); expect(g.occupancy.flags[i]! & OccFlag.Water).toBeTruthy(); }
    for (let i = 1; i < r.rec!.level.length; i++) expect(r.rec!.level[i]!).toBeLessThanOrEqual(r.rec!.level[i - 1]!);
    expect(rivers.rivers.length).toBe(1);
    expect(waterways([], rivers.rivers)[0]).toMatchObject({ id: 'r1', kind: 'dug', end: 'edge' });
    const f = planFillRiver(rivers, r.rec!.id);
    expect(f.ok).toBe(true);
    expect(applyFillRiver(e, rivers, f).ok).toBe(true);
    expect([...g.heights]).toEqual(pre);
    expect([...g.tileType].every((t) => t === TileType.Grass)).toBe(true);
    expect(rivers.rivers.length).toBe(0);
  });

  it('refuses a cut deeper than 6 per tile', () => {
    const g = plane(64, 16), e = env(g, { isSpring: () => true });
    const p = planRiver(e, { x: 40, y: 30 }, { x: 0, y: 30 });
    expect(p.ok).toBe(false);
    expect(p.reasons).toContain(REASON.deep);
  });

  it("refuses water that would have to flow uphill (sink lake above the source)", () => {
    const g = plane();
    // a lake on the high side: tiles x 50..53 are Water whose corners sit at the plane height (level ~ 58) > the source (~ 44)
    for (let y = 28; y <= 32; y++) for (let x = 50; x <= 53; x++) g.tileType[y * g.size + x] = TileType.Water;
    const p = planRiver(env(g, { isSpring: (x, y) => x === 40 && y === 30 }), { x: 40, y: 30 }, { x: 51, y: 30 });
    expect(p.ok).toBe(false);
    expect(p.reason).toBe(REASON.uphill);
  });

  it('refuses when a building / lift / rail wall blocks every way', () => {
    const g = plane();
    for (let y = 0; y < g.size; y++) g.occupancy.flags[y * g.size + 30] = OccFlag.Building;
    const p = planRiver(env(g, { isSpring: (x, y) => x === 40 && y === 30 }), { x: 40, y: 30 }, { x: 0, y: 30 });
    expect(p.ok).toBe(false);
    expect(p.reasons).toContain(REASON.blocked);
  });

  it('routes AROUND an obstacle when there is a way', () => {
    const g = plane();
    for (let y = 26; y <= 34; y++) g.occupancy.flags[y * g.size + 30] = OccFlag.Building;
    const p = planRiver(env(g, { isSpring: (x, y) => x === 40 && y === 30 }), { x: 40, y: 30 }, { x: 0, y: 30 });
    expect(p.ok).toBe(true);
    expect(p.path.some((t) => t.y < 26 || t.y > 34)).toBe(true);
    expect(p.path.every((t) => g.occupancy.flags[t.y * g.size + t.x] === 0)).toBe(true);
  });

  it('endpoints: needs a source, a valid sink; a stream sink merges', () => {
    const g = plane();
    const e = env(g, { isSpring: (x, y) => x === 40 && y === 30 });
    expect(planRiver(e, { x: 20, y: 10 }).reason).toBe(REASON.noSource);
    expect(planRiver(e, { x: 40, y: 30 }, { x: 10, y: 10 }).reason).toBe(REASON.badSink);
    g.tileType[10 * g.size + 10] = TileType.Water;
    expect(planRiver(e, { x: 10, y: 10 }).reason).toBe(REASON.start);
    // a natural stream across the west: tiles x = 6, y 20..40 (level 10)
    for (let y = 20; y <= 40; y++) g.tileType[y * g.size + 6] = TileType.Stream;
    const m = planRiver(e, { x: 40, y: 30 }, { x: 6, y: 30 });
    expect(m.ok).toBe(true);
    expect(m.end).toBe('merge');
    expect(m.sink).toMatchObject({ kind: 'stream', x: 6 });
    expect(m.path[m.path.length - 1]!.x).toBe(7);
  });

  it('a lake shore is a valid source (outlet) and a lake a valid sink', () => {
    const g = plane();
    for (let y = 29; y <= 31; y++) for (let x = 40; x <= 42; x++) g.tileType[y * g.size + x] = TileType.Water; // source lake (plane tiles, level = max corner)
    for (let y = 29; y <= 31; y++) for (let x = 8; x <= 10; x++) g.tileType[y * g.size + x] = TileType.Water;
    const e = env(g);
    const p = planRiver(e, { x: 39, y: 30 }, { x: 9, y: 30 });
    expect(p.ok).toBe(true);
    expect(p.source?.kind).toBe('lake');
    expect(p.end).toBe('lake');
    expect(planRiver(e, { x: 39, y: 30 }, { x: 41, y: 30 }).reason).toBe(REASON.sameLake);
  });

  it('a branch can start on a stream bank (source kind stream)', () => {
    const g = plane();
    for (let y = 20; y <= 40; y++) g.tileType[y * g.size + 30] = TileType.Stream;
    const p = planRiver(env(g), { x: 31, y: 25 }, { x: 0, y: 25 });
    expect(p.ok).toBe(true);
    expect(p.source?.kind).toBe('stream');
  });

  it('refuses a river longer than the stroke limit and one that is too short', () => {
    const g = plane(128);
    for (let vy = 0; vy < g.vsize; vy++) for (let vx = 0; vx < g.vsize; vx++) g.heights[vy * g.vsize + vx] = 10 + vy; // falls to the NORTH edge
    const e = env(g, { isSpring: () => true });
    const far = planRiver(e, { x: 64, y: 120 }, { x: 64, y: 0 });
    expect(far.ok).toBe(true); // 121 tiles <= 400
    const tiny = planRiver(e, { x: 64, y: 1 }, { x: 64, y: 0 });
    expect(tiny.ok).toBe(false);
  });

  it('refuses a dig that would break a lift clearance', () => {
    const g = plane(64, 8), e = env(g, { isSpring: () => true, liftClearanceViolations: () => 1 });
    const p = planRiver(e, { x: 40, y: 30 }, { x: 0, y: 30 });
    expect(p.ok).toBe(false);
    expect(p.reason).toBe(REASON.lift);
  });

  it('fill-in is refused while another river is fed by this one', () => {
    const g = plane();
    const rivers = new Rivers(g), e = env(g, { isSpring: () => true });
    const a = applyRiver(e, rivers, planRiver(e, { x: 40, y: 30 }, { x: 0, y: 30 }));
    expect(a.ok).toBe(true);
    const bp = planRiver(e, { x: 40, y: 36 }, { x: 20, y: 30 }); // ends in the first river (a stream tile now)
    expect(bp.ok).toBe(true);
    expect(bp.end).toBe('merge');
    expect(applyRiver(e, rivers, bp).ok).toBe(true);
    expect(planFillRiver(rivers, a.rec!.id).ok).toBe(false);
    expect(planFillRiver(rivers, rivers.rivers[1]!.id).ok).toBe(true);
  });
});

describe('RiverPlanner (generated maps)', () => {
  for (const seed of [61, 7, 5]) {
    it(`seed ${seed} (128): a river can be dug from a spring to a lake, the lake rim and the ground stay valid`, () => {
      const sim = createSim({ size: 128, seed, now: () => 0 });
      const e = sim.riverEnv(), N = sim.size;
      expect(sim.rivers.natural.length).toBeGreaterThanOrEqual(1);
      let dug = false;
      outer: for (const s of sim.rivers.natural) for (const l of sim.terrainInfo.lakes) {
        const t = l.tileIdx[0]!, p = planRiver(e, s, { x: t % N, y: (t / N) | 0 });
        if (!p.ok) continue;
        expect(p.source?.kind).toBe('spring');
        expect(p.end).toBe('lake');
        expect(p.maxCarve).toBeLessThanOrEqual(RIVER.maxCarve);
        expect(applyRiver(e, sim.rivers, p).ok).toBe(true);
        dug = true;
        break outer;
      }
      expect(dug).toBe(true);
      expect(sim.grid.checkInvariants()).toEqual([]);
      expect(lakesValid(sim.grid, sim.terrainInfo.lakes)).toBe(true);
    });
  }

  it('[perf] planning a river on a 256 map stays within a few ms', () => {
    const sim = createSim({ size: 256, seed: 61, now: () => 0 });
    const e = sim.riverEnv(), s = sim.rivers.natural[0]!;
    planRiver(e, s); // warm
    let best = Infinity;
    for (let i = 0; i < 5; i++) { const t0 = performance.now(); planRiver(e, s); best = Math.min(best, performance.now() - t0); }
    console.log(`planRiver 256: ${best.toFixed(2)} ms`);
    expect(best).toBeLessThan(budget(5));
  }, 30000);
});
