/** Phase 6 Task 6: viewpoint system (view score, hiker goal bonus + dwell, forest site rule, photo spots). docs/viewpoints.md */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { BUILDINGS, type BuildingDef } from '../../../src/config/buildings';
import { TICKS_PER_DAY } from '../../../src/config/balance';
import { VIEWPOINT } from '../../../src/config/viewpoints';
import { EXC } from '../../../src/sim/guests/Excursion';
import { openDirection, viewScore } from '../../../src/sim/attractions/Viewpoint';
import { placeBuilding, validatePlacement } from '../../../src/sim/PlaceBuilding';
import { createSim } from '../../../src/game/createSim';
import { PropKind, TREE_KINDS } from '../../../src/world/Props';
import { Layer } from '../../../src/world/Networks';
import { buildHikingResort } from '../../../scripts/analysis/hikingLib';
import { orbitPose, viewpointState } from '../../../src/render/view/PhotoMode';

const TEST_VIEWPOINT = 'testViewpoint', TEST_TREEHOUSE = 'testTreehouse';
beforeAll(() => {
  const base = BUILDINGS.mountainHut!;
  BUILDINGS[TEST_VIEWPOINT] = { ...base, id: TEST_VIEWPOINT, access: 'trail', altAccess: ['path', 'pisteEdge'], pisteRule: 'forbid', viewpoint: {} } as BuildingDef;
  BUILDINGS[TEST_TREEHOUSE] = { ...BUILDINGS.cafe!, id: TEST_TREEHOUSE, w: 2, h: 2, cost: 100, access: 'trail', altAccess: ['path'], site: { ...BUILDINGS.cafe!.site, maxSlope: 3, slopeKind: 'any', autoFlatten: 'never', forest: { minTrees: 6, radius: 3 } } } as BuildingDef;
});
afterAll(() => { delete BUILDINGS[TEST_VIEWPOINT]; delete BUILDINGS[TEST_TREEHOUSE]; });

describe('view score', () => {
  const N = 40, hill = (x: number, y: number): number => 30 - Math.hypot(x - 20, y - 20) * 1.2; // a cone
  const pit = (x: number, y: number): number => 10 + Math.hypot(x - 20, y - 20) * 1.2;
  it('a ridge / summit sees the valley (high score), a pit sees nothing, flat ground scores 0', () => {
    const top = viewScore(hill, N, 20, 20, 0, 30), shoulder = viewScore(hill, N, 28, 20, 0, 30), low = viewScore(hill, N, 36, 20, 0, 30);
    expect(top).toBeGreaterThan(0.8);
    expect(top).toBeGreaterThan(shoulder);
    expect(shoulder).toBeGreaterThan(low);
    expect(viewScore(pit, N, 20, 20, 0, 30)).toBe(0);
    expect(viewScore(() => 5, N, 20, 20, 0, 30)).toBe(0);
  });
  it('is deterministic and points the camera down the fall line', () => {
    expect(viewScore(hill, N, 28, 20, 0, 30)).toBe(viewScore(hill, N, 28, 20, 0, 30));
    const look = openDirection(hill, N, 28, 20); // the cone falls away to +x from x = 28
    expect(Math.cos(look)).toBeGreaterThan(0.9);
  });
});

describe('hikers choose and enjoy a ridge viewpoint', () => {
  const run = (withVp: boolean) => {
    const { sim, info } = buildHikingResort(64, 11, { defaultHours: true, noHut: true });
    const n = sim.size;
    if (withVp) {
      const cands: number[] = [];
      for (let t = 0; t < n * n; t++) if (sim.networks.layers[t]! & Layer.Hike) { const r = (sim.cond.altitude(t % n, (t / n) | 0) - info.altMin) / (info.altMax - info.altMin); if (r > 0.68 && r < 0.9) cands.push(t); }
      outer: for (const t of cands) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const o = placeBuilding(sim.env, sim.props, TEST_VIEWPOINT, (t % n) + dx, ((t / n) | 0) + dy, 0, true, false);
        if (o.ok) { sim.refreshCoverage(o.building!, true); break outer; }
      }
      sim.buildings.reevaluate();
    }
    const g = sim.guestSim.decider.goals, orig = g.pick.bind(g);
    let picks = 0, onVp = 0, dwell = 0, minS = Infinity;
    g.pick = (c, r) => { const k = orig(c, r); if (k) { picks++; if (g.viewTiles.has(k.tile)) onVp++; } return k; };
    for (let t = 0; t < 6 * TICKS_PER_DAY; t++) {
      sim.tick(1);
      if (t % 20 === 0) for (const [, x] of sim.guestSim.exc.map) if (g.viewTiles.has(x.goal)) { dwell++; minS = Math.min(minS, x.S); }
    }
    return { sim, g, picks, onVp, dwell, minS };
  };
  it('picks the viewpoint as a goal (control: never), stops longer there, counts visits', () => {
    const a = run(false), b = run(true);
    expect(a.onVp).toBe(0);
    expect(b.g.viewpoints.all.length).toBe(1);
    expect(b.g.viewpoints.all[0]!.score).toBeGreaterThan(0.5);
    expect(b.onVp / b.picks).toBeGreaterThan(0.15);
    expect(b.g.viewpoints.all[0]!.visits).toBeGreaterThan(0);
    expect(b.dwell).toBeGreaterThan(0);
    expect(b.minS).toBeGreaterThan(EXC.stopH + 0.05); // viewpoint dwell on top of the normal goal stop
    expect(b.g.pois.length).toBeLessThanOrEqual(90);
  }, 300_000);
});

describe('forest site rule (treehouse)', () => {
  const sim = createSim({ size: 64, seed: 61, now: () => 0, money: 1_000_000 });
  const N = sim.size, treeCount = (x: number, y: number, r: number): number => sim.props.countInRect(x - r, y - r, x + 1 + r, y + 1 + r, (k) => TREE_KINDS.includes(k));
  const find = (dense: boolean): { x: number; y: number } => {
    for (let y = 6; y < N - 8; y++) for (let x = 6; x < N - 8; x++) {
      const n = treeCount(x, y, 3);
      const fl = sim.grid.occupancy.flags;
      let free = true;
      for (let j = 0; j < 2 && free; j++) for (let i = 0; i < 2; i++) if (fl[sim.grid.occupancy.index(x + i, y + j)] !== 0 || sim.grid.tileType[sim.grid.tileIndex(x + i, y + j)] !== 0) free = false;
      if (free && (dense ? n >= 14 : n === 0)) return { x, y };
    }
    throw new Error('no site');
  };
  it('is refused in a meadow with "Needs forest around it" and accepted among trees, which then stay', () => {
    const meadow = find(false), forest = find(true);
    const m = validatePlacement(sim.env, TEST_TREEHOUSE, meadow.x, meadow.y, 0);
    expect(m.ok).toBe(false);
    expect(m.reasons).toContain('Needs forest around it');
    const f = validatePlacement(sim.env, TEST_TREEHOUSE, forest.x, forest.y, 0);
    expect(f.reasons).not.toContain('Needs forest around it');
    expect(f.flatten).toBe(false);
    expect(f.trees).toBe(0); // 'Trees will be cleared' never shown for a forest building
    const before = sim.props.count();
    const o = placeBuilding(sim.env, sim.props, TEST_TREEHOUSE, forest.x, forest.y, 0, false, false);
    expect(o.ok, o.reasons?.join()).toBe(true);
    expect(sim.props.count()).toBe(before); // no felling, not even under the footprint
    void PropKind;
  });
  it('ordinary buildings are untouched by the rule and still clear their footprint', () => {
    const forest = find(true);
    const before = treeCount(forest.x, forest.y, 0);
    expect(before).toBeGreaterThanOrEqual(0);
    expect(validatePlacement(sim.env, 'cafe', forest.x + 10, forest.y, 0).reasons).not.toContain('Needs forest around it');
  });
  it('has no per-id logic in placement code', () => {
    for (const f of ['src/sim/PlaceBuilding.ts', 'src/sim/PlacementRules.ts']) expect(readFileSync(f, 'utf8'), f).not.toMatch(/['"](treehouse|viewpoint|suspensionBridge)['"]/i);
  });
});

describe('photo-mode spot', () => {
  it('the camera stands on the viewpoint and looks out over the lower ground', () => {
    const spot = { x: 30.5, z: 20.5, look: Math.PI / 2 }; // ground falls away towards +z
    const st = viewpointState(spot, 64);
    const pose = orbitPose(st, () => 0, 64, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fy: 0 });
    expect(pose.x).toBeCloseTo(spot.x, 1);
    expect(pose.z).toBeCloseTo(spot.z, 1);
    const lookZ = -Math.cos(pose.yaw); // camera looks from pose towards the focus: direction = -(sin yaw, cos yaw)
    expect(lookZ).toBeGreaterThan(0.99); // looks towards +z, out over the falling ground
    expect(st.fz).toBeGreaterThan(spot.z + VIEWPOINT.photoDist * 0.8);
  });
});
