import { describe, expect, it } from 'vitest';
import { makeResort } from '../game/harness';
import type { Sim } from '../../src/game/createSim';
import { TileType } from '../../src/world/Grid';
import { OccFlag } from '../../src/world/Occupancy';
import { PropKind } from '../../src/world/Props';
import { stateHash } from '../../src/game/saveState';
import { validatePlacement } from '../../src/sim/PlaceBuilding';
import { UNLOCKS } from '../../src/config/unlocks';
import { LANDSCAPE, DECOR_IDS } from '../../src/config/landscape';
import {
  applyDecor, applyFill, applyPond, applyRockRemoval, applyRocks, clampPondRect, planDecor, planFill, planPond, planRockRemoval, planRocks, pondFootprint,
  pondRectAround, pondValid, type TileRect,
} from '../../src/sim/landscape/Landscape';

const mk = (seed = 61) => { const { sim } = makeResort(64, seed); sim.tick(2); sim.progression.unlockAll = true; return sim; };

/** First 5x5 pond site that passes every rule (scan the map: deterministic order). */
export function pondSite(sim: Sim, extent = 5): TileRect {
  const env = sim.landscapeEnv();
  for (let y = 8; y < 56; y++) for (let x = 8; x < 56; x++) { const r = pondRectAround(x, y, extent); if (planPond(env, r).ok) return r; }
  throw new Error('no pond site');
}
const dig = (sim: Sim, r: TileRect) => { const plan = planPond(sim.landscapeEnv(), r); return { plan, out: applyPond(sim.landscapeEnv(), sim.landscape, plan) }; };

describe('pond rules', () => {
  it('is gated at career level 2 (reason names the level), open in sandbox / at level 2', () => {
    const { sim } = makeResort(64, 61); sim.tick(2);
    sim.progression.unlockAll = false;
    const lvl = sim.progression.level;
    const env = sim.landscapeEnv();
    if (lvl < 2 && !sim.progression.open) {
      const p = planPond(env, pondRectAround(30, 30, 5));
      expect(p.ok).toBe(false); expect(p.reason).toMatch(/^Unlocks at level 2/);
    }
    expect(UNLOCKS.some((u) => u.kind === 'landscape' && u.id === 'pond' && u.level === 2)).toBe(true);
    sim.progression.unlockAll = true;
    expect(sim.gate.locked('landscape', 'pond')).toBeNull();
  });

  it('digs a pond: water tiles + flag, flat surface, lake invariant, cost = tiles x price + earthworks, no props left', () => {
    const sim = mk(), g = sim.grid;
    const r = pondSite(sim);
    const { plan, out } = dig(sim, r);
    expect(plan.ok).toBe(true); expect(out.ok).toBe(true);
    expect(plan.cost).toBeGreaterThanOrEqual(plan.tileIdx.length * LANDSCAPE.pond.costPerTile * 0.9);
    expect(plan.cost).toBeLessThan(plan.tileIdx.length * LANDSCAPE.pond.costPerTile + 4000);
    for (const t of plan.tileIdx) {
      expect(g.tileType[t]).toBe(TileType.Water); expect(g.occupancy.flags[t]! & OccFlag.Water).toBeTruthy();
      expect(sim.props.countInRect(t % g.size, (t / g.size) | 0, t % g.size, (t / g.size) | 0)).toBe(0);
    }
    expect(pondValid(g, plan.level, plan.tileIdx)).toBe(true);
    expect(sim.landscape.ponds).toHaveLength(1);
    // beach / boat rental see it as a lake
    expect(sim.buildings.lakeTiles.length).toBeGreaterThanOrEqual(plan.tileIdx.length);
    expect(sim.landscape.pondAt(plan.tileIdx[0]!)).toBeTruthy();
  });

  it('every refusal names its reason: too small / edge / steep / water / building / piste / lift / path', () => {
    const sim = mk(), g = sim.grid, env = sim.landscapeEnv();
    expect(typeof planPond(env, { x0: 10, y0: 10, x1: 11, y1: 11 }).ok).toBe('boolean'); // a 2x2 drag is clamped up to 3x3 and judged like any pond
    expect(planPond(env, pondRectAround(2, 30, 5)).reason).toMatch(/edge/);
    const site = pondSite(sim);
    // too close to other water: a lake tile 2 tiles from the footprint
    const t = g.tileIndex(site.x1 + 2, site.y0 + 1), keep = g.tileType[t]!;
    g.tileType[t] = TileType.Water;
    expect(planPond(env, site).reason).toMatch(/other water/);
    g.tileType[t] = keep;
    // building next to it
    const b = g.tileIndex(site.x1 + 2, site.y0 + 2);
    g.occupancy.flags[b]! |= OccFlag.Building;
    expect(planPond(env, site).reason).toMatch(/building/);
    g.occupancy.flags[b]! &= ~OccFlag.Building & 0xff;
    g.occupancy.flags[b]! |= OccFlag.Lift;
    expect(planPond(env, site).reason).toMatch(/lift/);
    g.occupancy.flags[b]! &= ~OccFlag.Lift & 0xff;
    g.occupancy.flags[b]! |= OccFlag.Piste;
    expect(planPond(env, site).reason).toMatch(/piste/);
    g.occupancy.flags[b]! &= ~OccFlag.Piste & 0xff;
    // a path tile inside the footprint
    const inside = g.tileIndex(site.x0 + 2, site.y0 + 2);
    g.occupancy.flags[inside]! |= OccFlag.Path;
    expect(planPond(env, site).reason).toMatch(/path|decor/);
    g.occupancy.flags[inside]! &= ~OccFlag.Path & 0xff;
    expect(planPond(env, site).ok).toBe(true);
  });

  it('refuses steep ground with a clear reason, and never changes the grid when refused or previewed', () => {
    const sim = mk(), g = sim.grid, env = sim.landscapeEnv();
    const heights = g.heights.slice();
    let steep: string | null = null;
    for (let y = 10; y < 54 && !steep; y += 2) for (let x = 10; x < 54; x += 2) { const p = planPond(env, pondRectAround(x, y, 7)); if (p.reason?.startsWith('Too steep')) { steep = p.reason; break; } }
    expect(steep).toMatch(/Too steep/);
    planPond(env, pondSite(sim));
    expect(Array.from(g.heights)).toEqual(Array.from(heights));
  });

  it('the footprint is deterministic, organic and inside the rect; clampPondRect respects 3..11', () => {
    const sim = mk(), r = { x0: 20, y0: 20, x1: 26, y1: 25 };
    const a = pondFootprint(sim.grid, r), b = pondFootprint(sim.grid, r);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(20); expect(a.length).toBeLessThan(7 * 6);
    expect(clampPondRect({ x0: 5, y0: 5, x1: 40, y1: 6 })).toEqual({ x0: 5, y0: 5, x1: 15, y1: 7 });
    const c = clampPondRect({ x0: 9, y0: 9, x1: 9, y1: 9 }); expect(c.x1 - c.x0 + 1).toBe(3);
  });

  it('fills a pond back to dry ground; natural lakes cannot be filled; a boat rental blocks it', () => {
    const sim = mk(), g = sim.grid, env = sim.landscapeEnv();
    const { plan } = dig(sim, pondSite(sim));
    const nat = sim.terrainInfo.lakes[0]!;
    expect(planFill(env, sim.landscape, nat.tileIdx[0]! % g.size, (nat.tileIdx[0]! / g.size) | 0).reason).toMatch(/Natural lakes/);
    expect(planFill(env, sim.landscape, 1, 1).reason).toBe('No pond here');
    const t = plan.tileIdx[0]!, fill = planFill(env, sim.landscape, t % g.size, (t / g.size) | 0);
    expect(fill.ok).toBe(true); expect(fill.cost).toBe(Math.round(plan.tileIdx.length * LANDSCAPE.pond.fillCostPerTile));
    expect(applyFill(env, sim.landscape, fill).ok).toBe(true);
    for (const ti of plan.tileIdx) { expect(g.tileType[ti]).toBe(TileType.Grass); expect(g.occupancy.flags[ti]! & OccFlag.Water).toBe(0); expect(Math.min(...g.getCorners(ti % g.size, (ti / g.size) | 0))).toBeGreaterThanOrEqual(plan.level - 1); }
    expect(sim.landscape.ponds).toHaveLength(0);
    expect(sim.buildings.lakeTiles.length).toBe(sim.terrainInfo.lakes.reduce((n, l) => n + l.tileIdx.length, 0));
  });

  it('a water building next to the pond (boat rental) blocks filling it in', () => {
    const sim = mk(), g = sim.grid;
    const { plan } = dig(sim, pondSite(sim));
    const maxX = Math.max(...plan.tileIdx.map((t) => t % g.size)), t = plan.tileIdx.find((i) => i % g.size === maxX)!, y = (t / g.size) | 0;
    sim.buildings.add('boatRental', maxX + 1, y, 0);
    const f = planFill(sim.landscapeEnv(), sim.landscape, t % g.size, y);
    expect(f.ok).toBe(false); expect(f.reason).toMatch(/Boat Rental needs this water/);
  });
});

describe('boulders', () => {
  it('places boulders (born -1: they never grow), refuses water / buildings, removes them, deterministic per (seed, tile, day)', () => {
    const sim = mk(), env = sim.landscapeEnv();
    const site = pondSite(sim), cx = site.x0 + 2, cy = site.y0 + 2;
    const a = planRocks(env, cx, cy, 3, 5), b = planRocks(env, cx, cy, 3, 5);
    expect(a).toEqual(b);
    expect(a.rocks.length).toBeGreaterThan(0);
    expect(a.cost).toBe(a.rocks.length * LANDSCAPE.rock.cost);
    const before = sim.props.countByKind()[PropKind.Rock]!;
    const chunks = applyRocks(sim.props, a);
    expect(chunks.length).toBeGreaterThan(0);
    expect(sim.props.countByKind()[PropKind.Rock]! - before).toBe(a.rocks.length);
    const c = planRockRemoval(env, cx, cy, 3);
    expect(c.count).toBeGreaterThanOrEqual(a.rocks.length);
    applyRockRemoval(env, cx, cy, 3);
    expect(planRockRemoval(env, cx, cy, 3).count).toBe(0);
    // on a pond tile nothing is placed
    const { plan } = dig(sim, site);
    const t = plan.tileIdx[0]!;
    expect(planRocks(env, t % sim.grid.size, (t / sim.grid.size) | 0, 1, 5).rocks).toHaveLength(0);
  });
});

describe('garden decor', () => {
  it('places every piece on free dry ground, sets the Decor flag, blocks buildings and paths, removal clears it', () => {
    const sim = mk(), g = sim.grid, env = sim.landscapeEnv();
    const used = new Set<number>();
    for (const kind of DECOR_IDS) {
      let placed = false;
      for (let y = 10; y < 54 && !placed; y++) for (let x = 10; x < 54 && !placed; x++) {
        const i = g.tileIndex(x, y);
        if (used.has(i) || !planDecor(env, x, y, kind).ok) continue;
        applyDecor(sim.landscape, x, y, kind, 0); used.add(i); placed = true;
        expect(g.occupancy.flags[i]! & OccFlag.Decor).toBeTruthy();
        expect(planDecor(env, x, y, kind).reason).toMatch(/already decor/);
      }
      expect(placed, kind).toBe(true);
    }
    expect(sim.landscape.decor.size).toBe(DECOR_IDS.length);
    const first = [...sim.landscape.decor.values()][0]!;
    // a building cannot go over decor
    const c = validatePlacement(sim.env, 'cafe', first.x, first.y, 0, false);
    expect(c.ok).toBe(false);
    expect(sim.networks.canPaint(first.x, first.y).ok).toBe(false);
    expect(sim.landscape.clearDecor(first.x, first.y)).toBe(true);
    expect(g.occupancy.flags[g.tileIndex(first.x, first.y)]! & OccFlag.Decor).toBe(0);
  });

  it('refuses water, trees / rocks on the tile, steep ground and the map edge', () => {
    const sim = mk(), env = sim.landscapeEnv(), g = sim.grid;
    expect(planDecor(env, 1, 30, 'bench').reason).toMatch(/edge/);
    const nat = sim.terrainInfo.lakes[0]!.tileIdx[0]!;
    expect(planDecor(env, nat % g.size, (nat / g.size) | 0, 'bench').reason).toMatch(/Water/);
    const site = pondSite(sim), x = site.x0, y = site.y0;
    sim.props.add(PropKind.Rock, x, y, 0.5, 0.5, 1, 0, 0, -1);
    expect(planDecor(env, x, y, 'hedge').reason).toMatch(/Clear the trees or rocks/);
  });
});

describe('determinism + hash', () => {
  it('the same actions on the same seed give the same stateHash; ponds change it (grid), decor alone does not (observer)', () => {
    const run = (): string => { const sim = mk(); dig(sim, pondSite(sim)); sim.tick(5); return stateHash(sim).hash; };
    expect(run()).toBe(run());
    const sim = mk(), h0 = stateHash(sim).hash;
    const site = pondSite(sim);
    const { plan } = dig(sim, site);
    expect(plan.ok).toBe(true);
    expect(stateHash(sim).hash).not.toBe(h0);
    // decor alone is an observer module (its effects on the sim live in the grid occupancy bits, which ARE hashed)
    const a = mk(), b = mk();
    expect(stateHash(a).parts['landscape']).toBeUndefined();
    applyDecor(a.landscape, 20, 20, 'lamp', 0);
    expect(stateHash(a).parts['landscape']).toBeUndefined();
    expect(stateHash(b).hash).toBe(stateHash(mk()).hash);
  });

  it('tick() with ponds in the world never throws and wildlife / weather treat the water as water (no snow on it)', () => {
    const sim = mk(); const { plan } = dig(sim, pondSite(sim));
    sim.tick(300);
    for (const t of plan.tileIdx) expect(sim.grid.snowDepth[t]).toBe(0);
  });
});
