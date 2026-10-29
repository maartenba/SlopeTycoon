import { describe, expect, it } from 'vitest';
import { Grid, TileType } from '../../src/world/Grid';
import { OccFlag } from '../../src/world/Occupancy';
import { generateTerrain } from '../../src/world/TerrainGen';
import { deriveSpringSites, higherNeighbours, springGroundOk, type SpringContext } from '../../src/world/SpringSites';
import { applyRemoveSpring, applySpring, planRemoveSpring, planSpring, Rivers } from '../../src/world/Rivers';
import { applyRiver, planRiver } from '../../src/world/RiverPlanner';
import { SPRING } from '../../src/config/rivers';
import { createSim } from '../../src/game/createSim';
import { stateHash } from '../../src/game/saveState';

const ctxOf = (r: ReturnType<typeof generateTerrain>): SpringContext => ({ lakes: r.lakes, streams: r.streams, villageAnchor: r.villageAnchor });
const snap = (g: Grid): string => `${[...g.heights].join(',')}|${[...g.tileType].join('')}|${[...g.occupancy.flags].join('')}`;

describe('natural spring sites (derived overlay)', () => {
  it('are deterministic: same seed => same sites, different seeds differ somewhere', () => {
    const run = (seed: number) => { const g = new Grid(128), r = generateTerrain(g, seed); return deriveSpringSites(g, ctxOf(r), seed); };
    expect(run(61)).toEqual(run(61));
    const all = [1, 2, 3, 4, 5, 6].map((s) => JSON.stringify(run(s)));
    expect(new Set(all).size).toBeGreaterThan(1);
  });

  it('never write the map: heights, tile types, occupancy and streams are untouched', () => {
    for (const seed of [1, 7, 61]) {
      const g = new Grid(128), r = generateTerrain(g, seed), before = snap(g), streams = JSON.stringify(r.streams);
      deriveSpringSites(g, ctxOf(r), seed);
      expect(snap(g)).toBe(before);
      expect(JSON.stringify(r.streams)).toBe(streams);
    }
  });

  it('follow the rule: 1-3 sites, dry, free, >= 2 higher neighbours, 2-6 tiles from a lake tile or stream head, spaced apart', () => {
    for (const n of [64, 128] as const) for (let seed = 1; seed <= 10; seed++) {
      const g = new Grid(n), r = generateTerrain(g, seed), sites = deriveSpringSites(g, ctxOf(r), seed);
      expect(sites.length).toBeLessThanOrEqual(SPRING.naturalMax);
      for (const s of sites) {
        expect(springGroundOk(g, s.x, s.y)).toBe(true);
        expect(higherNeighbours(g, s.x, s.y)).toBeGreaterThanOrEqual(2);
        const N = g.size;
        const near = [...r.lakes.flatMap((l) => l.tileIdx.map((t) => ({ x: t % N, y: (t / N) | 0 }))), ...r.streams.map((st) => st.path[0]!)].some((a) => { const d = Math.hypot(a.x - s.x, a.y - s.y); return d >= SPRING.nearMin && d <= SPRING.nearMax; });
        expect(near).toBe(true);
      }
      for (let i = 0; i < sites.length; i++) for (let j = i + 1; j < sites.length; j++) expect(Math.hypot(sites[i]!.x - sites[j]!.x, sites[i]!.y - sites[j]!.y)).toBeGreaterThanOrEqual(SPRING.spacing);
    }
  });

  it('exist on >= 90% of the seeds that have any lake or stream', () => {
    let withWater = 0, withSite = 0;
    for (const n of [64, 128] as const) for (let seed = 1; seed <= 30; seed++) {
      const g = new Grid(n), r = generateTerrain(g, seed);
      if (r.lakes.length + r.streams.length === 0) continue;
      withWater++;
      if (deriveSpringSites(g, ctxOf(r), seed).length >= 1) withSite++;
    }
    console.log(`spring sites: ${withSite}/${withWater} maps`);
    expect(withSite / withWater).toBeGreaterThanOrEqual(0.9);
  });

  it('give no water by themselves, are not part of the save / stateHash, and are valid river sources for free', () => {
    const sim = createSim({ size: 64, seed: 61, now: () => 0 });
    expect(sim.rivers.natural.length).toBeGreaterThan(0);
    expect(sim.rivers.serialize()).toBeNull();
    expect(stateHash(sim).parts.rivers).toBeUndefined();
    const s = sim.rivers.natural[0]!;
    expect(sim.rivers.isSource(s.x, s.y)).toBe(true);
    expect(sim.grid.tileType[s.y * sim.size + s.x]).not.toBe(TileType.Stream);
    // a site that gets built on is no longer a source
    sim.grid.occupancy.flags[s.y * sim.size + s.x] = OccFlag.Building;
    expect(sim.rivers.isSource(s.x, s.y)).toBe(false);
  });
});

describe('player springs ($250)', () => {
  /** A slope falling towards the south-east: tile (10,10) has higher neighbours to the north and west. */
  function spot(): { g: Grid; x: number; y: number } {
    const g = new Grid(64);
    for (let vy = 0; vy < g.vsize; vy++) for (let vx = 0; vx < g.vsize; vx++) g.heights[vy * g.vsize + vx] = 20 - Math.min(vx, vy); 
    return { g, x: 10, y: 10 };
  }

  it('rules: dry, unoccupied, >= 2 higher neighbours; fee from config; refunds nothing', () => {
    const { g, x, y } = spot(), rivers = new Rivers(g);
    const ok = planSpring({ grid: g }, rivers, x, y);
    expect(ok.ok).toBe(true);
    expect(ok.cost).toBe(SPRING.cost);
    expect(planSpring({ grid: g, multiplier: () => 0.5 }, rivers, x, y).cost).toBe(Math.round(SPRING.cost * 0.5));
    // a flat tile has no higher neighbour
    const flat = new Grid(64); flat.heights.fill(30);
    expect(planSpring({ grid: flat }, new Rivers(flat), 10, 10).ok).toBe(false);
    // occupied / water
    g.occupancy.flags[y * 64 + x] = OccFlag.Building;
    expect(planSpring({ grid: g }, rivers, x, y).reason).toMatch(/occupied/);
    g.occupancy.flags[y * 64 + x] = 0; g.tileType[y * 64 + x] = TileType.Water;
    expect(planSpring({ grid: g }, rivers, x, y).reason).toMatch(/dry/);
    g.tileType[y * 64 + x] = TileType.Grass;
    expect(applySpring({ grid: g }, rivers, ok)).toBe(true);
    expect(planSpring({ grid: g }, rivers, x, y).ok).toBe(false); // already one
    expect(g.occupancy.flags[y * 64 + x]! & OccFlag.Decor).toBeTruthy(); // nothing can be built there
    expect(planRemoveSpring(rivers, x, y)).toMatchObject({ ok: true, refund: 0 });
    expect(applyRemoveSpring({ grid: g }, rivers, x, y)).toBe(true);
    expect(g.occupancy.flags[y * 64 + x]).toBe(0);
    expect(rivers.springs.length).toBe(0);
  });

  it('a placed spring gives no water until a river is dug; the river starts on the spring tile and the spring cannot be removed while used', () => {
    const sim = createSim({ size: 64, seed: 61, now: () => 0 });
    const g = sim.grid, N = sim.size, env = sim.riverEnv();
    const streamsBefore = g.tileType.reduce((n, t) => n + (t === TileType.Stream ? 1 : 0), 0);
    let spot: { x: number; y: number } | null = null;
    for (let y = 4; y < 60 && !spot; y++) for (let x = 4; x < 60 && !spot; x++) {
      if (!planSpring(env, sim.rivers, x, y).ok) continue;
      const rp = planRiver({ ...env, isSpring: (px, py) => px === x && py === y }, { x, y });
      if (rp.ok) spot = { x, y };
    }
    expect(spot).not.toBeNull();
    const plan = planSpring(env, sim.rivers, spot!.x, spot!.y);
    expect(applySpring(env, sim.rivers, plan)).toBe(true);
    expect(g.tileType.reduce((n, t) => n + (t === TileType.Stream ? 1 : 0), 0)).toBe(streamsBefore); // no water yet
    expect(stateHash(sim).parts.rivers).toBeDefined(); // placed springs are real state
    const rp = planRiver(env, spot!);
    expect(rp.ok).toBe(true);
    expect(rp.source?.kind).toBe('spring');
    expect(applyRiver(env, sim.rivers, rp).ok).toBe(true);
    expect(g.tileType[spot!.y * N + spot!.x]).toBe(TileType.Stream);
    expect(planRemoveSpring(sim.rivers, spot!.x, spot!.y).ok).toBe(false);
  });
});
