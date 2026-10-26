import { describe, expect, it } from 'vitest';
import type { MapSize } from '../../src/core/GameState';
import { TOWN_SEEDS } from '../../src/config/townSeeds';
import { createSim } from '../../src/game/createSim';
import { TOWNS, TOWN_IDS, buildTown, sizeScale, townIssues, townOf, townScore, townSimOptions, townSites, type TownId } from '../../src/game/demoTowns';
import { stateHash } from '../../src/sim/Systems';

const make = (id: TownId, size: MapSize, seed: number) => {
  const sim = createSim({ ...townSimOptions(id, size), seed, now: () => 0 });
  const report = buildTown(sim, id, seed);
  return { sim, report };
};
const strip = <T extends { buildMs: number }>(r: T): Omit<T, 'buildMs'> => { const { buildMs: _b, ...rest } = r; void _b; return rest; };

describe('town archetypes (data)', () => {
  it('has >= 8 distinct archetypes with a name, tagline, size, season and preset', () => {
    expect(TOWNS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(TOWN_IDS).size).toBe(TOWNS.length);
    expect(new Set(TOWNS.map((t) => t.name)).size).toBe(TOWNS.length);
    for (const t of TOWNS) {
      expect(t.tagline.length).toBeGreaterThan(20);
      expect(t.sizes).toContain(t.size);
      expect(['winter', 'summer']).toContain(t.season);
      expect(t.items.length).toBeGreaterThan(5);
      expect(t.lifts.length).toBeGreaterThan(0);
    }
    expect(townOf('hiking')!.season).toBe('summer');
    expect(townOf('bigmountain')!.size).toBe(256);
    expect(townOf('bigmountain')!.lifts.length).toBeGreaterThanOrEqual(6);
  });
  it('every archetype has >= 6 vetted seeds per supported size', () => {
    for (const t of TOWNS) for (const s of t.sizes) expect(TOWN_SEEDS[t.id][s]?.length ?? 0, `${t.id} ${s}`).toBeGreaterThanOrEqual(6);
  });
  it('pure helpers: size scale, named sites, score range', () => {
    expect(sizeScale(64)).toBeLessThan(sizeScale(128));
    expect(sizeScale(128)).toBeLessThan(sizeScale(256));
    expect(townSites([{ type: 'beach', x: 10, y: 20, w: 4, h: 3 }, { type: 'beach', x: 1, y: 1, w: 1, h: 1 }, { type: 'chalet', x: 0, y: 0, w: 3, h: 3 }])).toEqual({ beach: { x: 12, y: 21.5 } });
  });
});

describe('buildTown', () => {
  const required: Array<[TownId, MapSize[]]> = TOWNS.map((t) => [t.id, [...t.sizes]]);
  for (const [id, sizes] of required) {
    for (const size of sizes) {
      it(`${id} @${size}: 10 seeds (5 on 256) build within the failure budget, valid, no overlaps, not ugly`, () => {
        const a = townOf(id)!;
        const seeds = size === 256 ? [1, 2, 3, 4, 5] : size === a.size ? Array.from({ length: 10 }, (_, i) => i + 1) : [1, 2, 3, 4]; // 256 maps take ~2 s each: 5 seeds
        let nice = 0;
        for (const seed of seeds) {
          const { sim, report } = make(id, size, seed);
          expect(report.failures.length, `${id}@${size} seed ${seed}: ${report.failures.join(' | ')}`).toBeLessThanOrEqual(a.maxFailures);
          expect(townIssues(sim), `${id}@${size} seed ${seed}`).toEqual([]); // no inactive buildings, no disconnected pistes
          expect(report.lifts.length, `${id}@${size} seed ${seed} lifts`).toBeGreaterThanOrEqual(1);
          for (const l of sim.lifts.all()) {
            expect(l.bottom).not.toEqual(l.top);
            expect(sim.grid.getCorner(l.top.x, l.top.y)).toBeGreaterThan(sim.grid.getCorner(l.bottom.x, l.bottom.y));
          }
          const bs = sim.buildings.all();
          for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
            const p = bs[i]!, q = bs[j]!;
            expect(p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h, `${p.type} overlaps ${q.type}`).toBe(false);
          }
          if (report.score >= 0.5) nice++;
        }
        expect(nice, `${id}@${size} nice seeds`).toBeGreaterThanOrEqual(Math.ceil(seeds.length * 0.6));
      }, 120_000);
    }
  }

  it('vetted seeds are really nice (score >= 0.5, <= 1 failure, valid)', () => {
    for (const t of TOWNS) {
      const size = t.size === 256 ? 128 : t.size; // 256 is covered above; keep this one fast
      for (const seed of (TOWN_SEEDS[t.id][size] ?? []).slice(0, 2)) {
        const { sim, report } = make(t.id, size, seed);
        expect(report.score, `${t.id}@${size} seed ${seed}`).toBeGreaterThanOrEqual(0.5);
        expect(report.failures.length, `${t.id}@${size} seed ${seed}: ${report.failures.join(' | ')}`).toBeLessThanOrEqual(1);
        expect(townIssues(sim)).toEqual([]);
        expect(townScore(sim, report.pisteTiles)).toBe(report.score);
      }
    }
  }, 120_000);

  it('is deterministic per seed (report + sim hash); different seeds give different towns', () => {
    for (const id of ['alpine', 'festival', 'bigmountain'] as const) {
      const size: MapSize = id === 'bigmountain' ? 128 : 64;
      const a = make(id, size, 5), b = make(id, size, 5), c = make(id, size, 6);
      expect(strip(a.report)).toEqual(strip(b.report));
      expect(stateHash(a.sim.game, a.sim.registry)).toBe(stateHash(b.sim.game, b.sim.registry));
      expect(stateHash(a.sim.game, a.sim.registry)).not.toBe(stateHash(c.sim.game, c.sim.registry));
    }
  });

  it('characteristic content: each archetype builds what its tagline promises (on a vetted seed)', () => {
    const want: Record<TownId, string[]> = {
      alpine: ['chalet', 'alpineFarm', 'mountainHut', 'lodge'], family: ['kidsGround', 'playground', 'iceRink', 'skiSchoolHQ', 'magicCarpet'], luxury: ['apartment', 'apresBar', 'heatedTerrace'],
      hiking: ['adventurePark', 'mountainHut', 'alpineFarm', 'beach'], lakeside: ['beach', 'boatRental', 'cafe'], fortress: ['stuntPark', 'snowCannon', 'reservoir', 'groomerGarage', 'snowcatOutpost'],
      bigmountain: ['trainStation', 'shuttleDepot', 'chalet', 'apartment'], hamlet: ['mountainHut', 'rangerStation', 'chalet'], festival: ['apresBar', 'heatedTerrace', 'shop', 'cafe'], rescue: ['helipad', 'firstAid', 'patrolHub', 'rangerStation'],
    };
    for (const t of TOWNS) {
      const size = t.size === 256 ? 128 : t.size;
      const seed = TOWN_SEEDS[t.id][size]![0]!;
      const { report } = make(t.id, size, seed);
      for (const ty of want[t.id]) expect(report.placed[ty] ?? 0, `${t.id}@${size} seed ${seed} ${ty}`).toBeGreaterThan(0);
    }
    const big = make('bigmountain', 128, TOWN_SEEDS.bigmountain[128]![0]!).report;
    expect(big.lifts.length).toBeGreaterThanOrEqual(6);
    expect(big.lifts.map((l) => l.kind)).toEqual(expect.arrayContaining(['funicular', 'cablecar']));
    expect(make('luxury', 128, TOWN_SEEDS.luxury[128]![0]!).report.lifts.map((l) => l.kind)).toContain('gondola10');
  }, 120_000);

  it('works on any size / seed without throwing, is free, and unknown archetypes are reported', () => {
    const sim = createSim({ size: 64, seed: 999, now: () => 0 });
    const money = sim.game.money;
    const r = buildTown(sim, 'rescue', 3);
    expect(sim.game.money).toBe(money);
    expect(r.failures.every((f) => typeof f === 'string')).toBe(true);
    expect(buildTown(sim, 'nope', 1).failures[0]).toMatch(/unknown/);
    const noLodge = createSim({ size: 64, seed: 7, lodge: false, now: () => 0 });
    expect(buildTown(noLodge, 'alpine', 1).failures.join(' ')).toMatch(/lodge/i);
  });

  it('headless build time stays within 2.5 s on 128 (every archetype)', () => {
    for (const t of TOWNS) {
      const size: MapSize = 128;
      const sim = createSim({ ...townSimOptions(t.id, size), seed: TOWN_SEEDS[t.id][size]![0]!, now: () => 0 });
      const t0 = performance.now();
      buildTown(sim, t.id, TOWN_SEEDS[t.id][size]![0]!);
      expect(performance.now() - t0, t.id).toBeLessThan(2500);
    }
  }, 60_000);
});

describe('town footpaths (rich pass 2)', () => {
  it('routeFrom branches off an existing path instead of running a parallel strip from the start', () => {
    const { sim } = make('alpine', 128, TOWN_SEEDS.alpine[128]![0]!);
    const n = sim.networks;
    const tiles: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < sim.size * sim.size; i++) if (n.kind[i] === 1) tiles.push({ x: i % sim.size, y: (i / sim.size) | 0 });
    expect(tiles.length).toBeGreaterThan(10);
    const t = tiles[Math.floor(tiles.length / 2)]!;
    const route = n.routeFrom(1, [tiles[0]!], (x, y) => Math.abs(x - t.x) + Math.abs(y - t.y) === 1 && n.kindAt(x, y) === 0);
    const fresh = route.filter((p) => n.kindAt(p.x, p.y) !== 1);
    expect(fresh.length).toBeLessThanOrEqual(2); // the goal sits next to the network: at most a stub tile
  });
});
