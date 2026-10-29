import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createSim } from '../../src/game/createSim';
import { applyRiver, planRiver, riverEdges } from '../../src/world/RiverPlanner';
import { MAX_TILE_DELTA } from '../../src/world/Grid';
import { HEIGHT_UNIT } from '../../src/config/balance';
import { buildWaterData, wayFlowDir } from '../../src/render/Water';

vi.mock('../../src/render/textures', () => ({ createWaterNormalTexture: () => new THREE.DataTexture(new Uint8Array(4), 1, 1) }));

/** Rivers dug on real maps (natural springs + hillside sites forced as springs): the bed descends continuously and the water follows it. */
function dig(seed: number): Array<{ sim: ReturnType<typeof createSim>; path: Array<{ x: number; y: number }> }> {
  const sim = createSim({ size: 128, seed, now: () => 0 });
  const out: Array<{ sim: typeof sim; path: Array<{ x: number; y: number }> }> = [];
  const sites = [...(sim.rivers.natural as Array<{ x: number; y: number }>)];
  // hillside sites (>= 2 half-steps across the tile, like the owner's report) as extra "springs"
  for (let y = 6; y < 122 && sites.length < 8; y += 7) for (let x = 6; x < 122 && sites.length < 8; x += 7) {
    const c = sim.grid.getCorners(x, y);
    if (Math.max(...c) - Math.min(...c) >= 2 && sim.grid.tileType[y * 128 + x] !== 2) sites.push({ x, y });
  }
  for (const s of sites) {
    const env = { ...sim.riverEnv(), isSpring: (a: number, b: number) => (a === s.x && b === s.y) || sim.rivers.isSource(a, b) };
    const plan = planRiver(env, s, null);
    if (!plan.ok || plan.path.length < 4) continue;
    expect(applyRiver(env, sim.rivers, plan).ok).toBe(true);
    out.push({ sim, path: plan.path });
  }
  return out;
}

describe('dug river bed (steep slopes)', () => {
  const rivers = [61, 7, 5, 11, 23].flatMap(dig);
  it('found rivers to check', () => { expect(rivers.length).toBeGreaterThanOrEqual(5); });

  it('after the carve every tile level is <= the previous one and every edge ramps down the flow', () => {
    for (const { sim, path } of rivers) {
      const g = sim.grid, V = g.vsize, edges = riverEdges(path, V);
      let prevTile = Infinity;
      for (const p of path) { const lv = Math.min(...g.getCorners(p.x, p.y)); expect(lv).toBeLessThanOrEqual(prevTile); prevTile = lv; }
      let prev = Infinity;
      for (let j = 1; j < edges.length - 1; j++) { // interior edges: flat across, never above the edge upstream
        const [a, b] = [g.heights[edges[j]![0]]!, g.heights[edges[j]![1]]!];
        const lv = Math.min(a, b);
        expect(lv).toBeLessThanOrEqual(prev); prev = lv;
        expect(Math.abs(a - b)).toBeLessThanOrEqual(MAX_TILE_DELTA);
      }
    }
  });

  it('flow vector of every tile points downstream (toward the next tile, never against the height drop)', () => {
    for (const { sim, path } of rivers) {
      const g = sim.grid;
      for (let i = 0; i < path.length - 1; i++) {
        const [fx, fz] = wayFlowDir(path, i);
        const dx = path[i + 1]!.x - path[i]!.x, dz = path[i + 1]!.y - path[i]!.y;
        expect(fx * dx + fz * dz).toBeGreaterThan(0.99);
        const a = Math.min(...g.getCorners(path[i]!.x, path[i]!.y)), b = Math.min(...g.getCorners(path[i + 1]!.x, path[i + 1]!.y));
        expect(b).toBeLessThanOrEqual(a);
      }
    }
  });

  it('water surface stays inside its tile and its height span is bounded (no sheets)', () => {
    for (const { sim, path } of rivers) {
      const d = buildWaterData(sim.grid, [], [], [{ id: 'r1', path }]);
      for (let t = 0; t < path.length; t++) {
        const p = path[t]!;
        let lo = Infinity, hi = -Infinity;
        for (let k = 0; k < 6; k++) {
          const o = (t * 6 + k) * 3, x = d.positions[o]!, y = d.positions[o + 1]!, z = d.positions[o + 2]!;
          expect(x).toBeGreaterThanOrEqual(p.x); expect(x).toBeLessThanOrEqual(p.x + 1);
          expect(z).toBeGreaterThanOrEqual(p.y); expect(z).toBeLessThanOrEqual(p.y + 1);
          lo = Math.min(lo, y); hi = Math.max(hi, y);
        }
        expect(hi - lo).toBeLessThanOrEqual(MAX_TILE_DELTA * HEIGHT_UNIT + 1e-6);
      }
    }
  });
});

describe('wayFlowDir', () => {
  const ways = {
    east: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }], west: [{ x: 3, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 1 }],
    south: [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }], north: [{ x: 1, y: 3 }, { x: 1, y: 2 }, { x: 1, y: 1 }],
  };
  it('points from the source toward the sink for every orientation (also the last tile)', () => {
    const want = { east: [1, 0], west: [-1, 0], south: [0, 1], north: [0, -1] } as const;
    for (const [k, path] of Object.entries(ways)) for (let i = 0; i < path.length; i++) expect(wayFlowDir(path, i)).toEqual(want[k as keyof typeof want]);
  });
});
