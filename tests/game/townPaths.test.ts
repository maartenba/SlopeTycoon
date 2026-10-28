import { describe, expect, it } from 'vitest';
import { createSim } from '../../src/game/createSim';
import { TOWNS, buildTown, townSimOptions, type TownId } from '../../src/game/demoTowns';
import { pathQuality, tidyPaths } from '../../src/game/townPaths';
import { NetKind } from '../../src/world/Networks';

const make = (id: TownId, seed: number) => {
  const sim = createSim({ ...townSimOptions(id, 128), seed, now: () => 0 });
  const report = buildTown(sim, id, seed);
  return { sim, report };
};

describe('town footpath network (docs/demo-towns.md "Path network")', () => {
  it('every archetype x 2 seeds: no double-width bands, no ladder lattice, few pinholes, short dead ends', () => {
    for (const t of TOWNS) for (const seed of [1, 2]) {
      const { sim, report } = make(t.id, seed);
      const q = report.paths!;
      const tag = `${t.id} seed ${seed} ${JSON.stringify(q)}`;
      expect(q, tag).toEqual(pathQuality(sim));
      expect(q.blocks, tag).toBeLessThanOrEqual(3); // 2x2 blocks of footpath
      expect(q.adjacency, tag).toBeLessThanOrEqual(1.08); // a clean street network is ~1 adjacency per tile, a lattice >= 1.2
      expect(q.holes, tag).toBeLessThanOrEqual(12);
      expect(q.maxSpur, tag).toBeLessThanOrEqual(120);
      expect(q.score, tag).toBeGreaterThanOrEqual(0.4);
    }
  });

  it('tidyPaths removes a ladder / blob of leftover footpaths and keeps every service', () => {
    const { sim } = make('alpine', 1);
    const n = sim.networks, size = sim.size;
    const served = () => sim.buildings.all().map((b) => n.isConnected(b.id));
    const before = served();
    // paint a solid 5x5 blob of footpath beside the existing network (what rejected candidate sites used to leave behind)
    const free = (x: number, y: number): boolean => n.inBounds(x, y) && n.kind[y * size + x] === NetKind.None && !(sim.grid.occupancy.flags[sim.grid.occupancy.index(x, y)]! & 0xff);
    let painted = 0;
    outer: for (let y = 6; y < size - 12; y++) for (let x = 6; x < size - 12; x++) {
      let all = true, touch = false;
      for (let j = -1; j <= 5 && all; j++) for (let i = -1; i <= 5; i++) {
        const inside = i >= 0 && j >= 0 && i < 5 && j < 5;
        if (inside && !free(x + i, y + j)) { all = false; break; }
        if (!inside && n.inBounds(x + i, y + j) && (i === -1 || j === -1) && i >= 0 !== j >= 0 && n.kind[(y + j) * size + x + i] === NetKind.Path) touch = true;
      }
      if (!all || !touch) continue;
      for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) if (n.build(NetKind.Path, x + i, y + j)) painted++;
      break outer;
    }
    expect(painted).toBeGreaterThan(15);
    const messy = pathQuality(sim);
    expect(messy.blocks).toBeGreaterThan(10);
    const removed = tidyPaths(sim);
    expect(removed).toBeGreaterThanOrEqual(painted - 5);
    const clean = pathQuality(sim);
    expect(clean.blocks).toBeLessThanOrEqual(3);
    expect(served().every((s, i) => !before[i] || s)).toBe(true);
    expect(clean.score).toBeGreaterThan(messy.score);
    expect(tidyPaths(sim)).toBe(0); // idempotent
  });

  it('is deterministic: same (archetype, seed) gives the same footpath tiles', () => {
    const a = make('festival', 3).sim.networks.kind, b = make('festival', 3).sim.networks.kind;
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});
