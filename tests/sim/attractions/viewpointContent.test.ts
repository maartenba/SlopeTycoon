/** Phase 6 Task 21: the Viewpoint and Treehouse catalog buildings (content for the viewpoint system, docs/viewpoints.md). */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BUILDINGS } from '../../../src/config/buildings';
import { BONUS_GOALS, GOALS, VIEWPOINT_GOAL_ALT } from '../../../src/config/goals';
import { FOREST_SITE } from '../../../src/config/viewpoints';
import { isGated, unlockLevel } from '../../../src/config/unlocks';
import { BUILDING_HEIGHT, BUILDING_OVERFLY_MAX } from '../../../src/config/buildingHeights';
import { createSim, type Sim } from '../../../src/game/createSim';
import { collectSave, stateHash } from '../../../src/game/saveState';
import { placeBuilding, validatePlacement } from '../../../src/sim/PlaceBuilding';
import { accessReason } from '../../../src/sim/PlacementRules';
import { Goals } from '../../../src/sim/goals/Goals';
import { EventBus } from '../../../src/core/EventBus';
import type { GameEvents } from '../../../src/core/events';
import { TREE_KINDS } from '../../../src/world/Props';
import { Layer } from '../../../src/world/Networks';
import { TICKS_PER_DAY } from '../../../src/config/balance';
import { buildHikingResort } from '../../../scripts/analysis/hikingLib';
import { buildParts } from '../../../src/render/meshes';
import { HINTS } from '../../../src/tutorial/hints';
import { t as tutorialText, hintKey } from '../../../src/tutorial/strings';

describe('viewpoint and treehouse catalog rows', () => {
  it('viewpoint: 2x2, trail / footpath / piste-edge access, viewpoint spec, no staff, never gated, a spot in photo mode', () => {
    const d = BUILDINGS.viewpoint!;
    expect([d.w, d.h, d.staff, d.capacity, d.category]).toEqual([2, 2, 0, 0, 'recreation']);
    expect([d.access, ...(d.altAccess ?? [])]).toEqual(['trail', 'path', 'pisteEdge']);
    expect(d.viewpoint).toBeDefined();
    expect(d.viewpoint!.photo).not.toBe(false);
    expect(d.pisteRule).toBe('edge');
    expect(isGated('building', 'viewpoint')).toBe(false);
    expect(unlockLevel('building', 'viewpoint')).toBe(1);
    expect(accessReason(d)).toMatch(/hiking trail/);
  });
  it('treehouse: 2x2, trail or footpath, forest rule 6 trees within 3 tiles that keeps the trees, never flattens, view weight 0.8, level 2', () => {
    const d = BUILDINGS.treehouse!;
    expect([d.w, d.h, d.staff, d.category]).toEqual([2, 2, 0, 'recreation']);
    expect([d.access, ...(d.altAccess ?? [])]).toEqual(['trail', 'path']);
    expect(d.site.forest).toEqual({ minTrees: 6, radius: 3, keepTrees: true });
    expect(d.site.forest).toMatchObject({ minTrees: FOREST_SITE.minTrees, radius: FOREST_SITE.radius });
    expect(d.site.autoFlatten).toBe('never');
    expect(d.viewpoint!.weight).toBe(0.8);
    expect(unlockLevel('building', 'treehouse')).toBe(2);
    expect(BUILDINGS.treehouse!.cost).toBeGreaterThan(BUILDINGS.viewpoint!.cost);
  });
  it('catalog rows hold no sustainability, rating or price hooks (neutral by construction): no staff, no ticket, no attraction spec', async () => {
    const { ATTRACTION_SPECS } = await import('../../../src/sim/attractions/registry');
    const { PRICE_TABLE } = await import('../../../src/config/prices');
    for (const id of ['viewpoint', 'treehouse']) { expect(ATTRACTION_SPECS[id], id).toBeUndefined(); expect(PRICE_TABLE[id], id).toBeUndefined(); }
  });
  it('meshes: viewpoint has a sign, both stay inside the building triangle budget and the cable overfly limit, height table matches', () => {
    for (const id of ['viewpoint', 'treehouse'] as const) {
      const d = BUILDINGS[id]!, p = buildParts(d.meshBuilder, d.w, d.h), box = new THREE.Box3();
      let tris = 0;
      for (const g of [p.wood, p.stone, p.roof, p.sign?.geometry]) if (g) { g.computeBoundingBox(); box.union(g.boundingBox!); tris += g.getAttribute('position').count / 3; }
      expect(tris, id).toBeLessThan(3000);
      expect(box.max.y, id).toBeLessThanOrEqual(BUILDING_OVERFLY_MAX);
      expect(BUILDING_HEIGHT[id]!, id).toBeGreaterThanOrEqual(box.max.y - 1e-6);
      expect(box.max.x - box.min.x, id).toBeLessThanOrEqual(d.w + 0.2);
    }
    const v = BUILDINGS.viewpoint!;
    expect(buildParts(v.meshBuilder, v.w, v.h).sign?.text).toBe('VIEW');
  });
  it('a photo-spot hint exists, fires only for viewpoint buildings, and has its text', () => {
    const h = HINTS.find((x) => x.id === 'view.photo')!;
    expect(h.on).toBe('building:placed');
    expect(h.when({} as never, { id: 1, type: 'viewpoint', x: 0, y: 0 } as never)).toBe(true);
    expect(h.when({} as never, { id: 1, type: 'treehouse', x: 0, y: 0 } as never)).toBe(true);
    expect(h.when({} as never, { id: 1, type: 'cafe', x: 0, y: 0 } as never)).toBe(false);
    expect(tutorialText(hintKey('view.photo'))).toMatch(/Photo mode/);
  });
});

describe('treehouse needs a forest', () => {
  const sim = createSim({ size: 64, seed: 61, now: () => 0, money: 1_000_000, mode: 'sandbox' });
  const N = sim.size, treeCount = (x: number, y: number, r: number): number => sim.props.countInRect(x - r, y - r, x + 1 + r, y + 1 + r, (k) => TREE_KINDS.includes(k));
  const find = (dense: boolean): { x: number; y: number } => {
    for (let y = 6; y < N - 8; y++) for (let x = 6; x < N - 8; x++) {
      const fl = sim.grid.occupancy.flags;
      let free = true;
      for (let j = 0; j < 2 && free; j++) for (let i = 0; i < 2; i++) if (fl[sim.grid.occupancy.index(x + i, y + j)] !== 0 || sim.grid.tileType[sim.grid.tileIndex(x + i, y + j)] !== 0) free = false;
      const n = treeCount(x, y, 3);
      if (free && (dense ? n >= 14 : n === 0)) return { x, y };
    }
    throw new Error('no site');
  };
  it('refused in a meadow with "Needs forest around it", accepted in the trees which then all stay', () => {
    const meadow = find(false), forest = find(true);
    const m = validatePlacement(sim.env, 'treehouse', meadow.x, meadow.y, 0);
    expect(m.ok).toBe(false);
    expect(m.reasons).toContain('Needs forest around it');
    const f = validatePlacement(sim.env, 'treehouse', forest.x, forest.y, 0);
    expect(f.reasons).not.toContain('Needs forest around it');
    const before = sim.props.count();
    const o = placeBuilding(sim.env, sim.props, 'treehouse', forest.x, forest.y, 0, false, false);
    expect(o.ok, o.reasons?.join()).toBe(true);
    expect(sim.props.count()).toBe(before);
  });
  it('the viewpoint platform has no forest rule: it can stand in a meadow', () => {
    const meadow = find(false);
    expect(validatePlacement(sim.env, 'viewpoint', meadow.x, meadow.y, 0).reasons).not.toContain('Needs forest around it');
  });
});

describe('a real viewpoint on a ridge', () => {
  const run = (withVp: boolean) => {
    const { sim, info } = buildHikingResort(64, 11, { defaultHours: true, noHut: true });
    const n = sim.size;
    let placed: { x: number; y: number } | null = null;
    if (withVp) {
      const cands: number[] = [];
      for (let t = 0; t < n * n; t++) if (sim.networks.layers[t]! & Layer.Hike) { const r = (sim.cond.altitude(t % n, (t / n) | 0) - info.altMin) / (info.altMax - info.altMin); if (r > 0.68 && r < 0.9) cands.push(t); }
      outer: for (const t of cands) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const o = placeBuilding(sim.env, sim.props, 'viewpoint', (t % n) + dx, ((t / n) | 0) + dy, 0, true, false);
        if (o.ok) { sim.refreshCoverage(o.building!, true); placed = { x: o.building!.x, y: o.building!.y }; break outer; }
      }
      sim.buildings.reevaluate();
    }
    const g = sim.guestSim.decider.goals;
    let picks = 0, onVp = 0;
    const orig = g.pick.bind(g);
    g.pick = (c, r) => { const k = orig(c, r); if (k) { picks++; if (g.viewTiles.has(k.tile)) onVp++; } return k; };
    for (let t = 0; t < 4 * TICKS_PER_DAY; t++) sim.tick(1);
    return { sim, g, picks, onVp, placed };
  };
  it('hikers choose it (control without it: never), it scores well, and the run is deterministic', () => {
    const a = run(false), b = run(true), c = run(true);
    expect(a.onVp).toBe(0);
    expect(b.placed).toBeTruthy();
    expect(b.g.viewpoints.all).toHaveLength(1);
    expect(b.g.viewpoints.all[0]!.score).toBeGreaterThan(0.4);
    expect(b.onVp).toBeGreaterThan(0);
    expect(b.g.pois.length).toBeLessThanOrEqual(90);
    expect(c.onVp).toBe(b.onVp);
    expect(stateHash(c.sim).hash).toBe(stateHash(b.sim).hash);
  }, 300_000);
});

describe('bonus goal: a viewpoint on the heights', () => {
  it('is a bonus goal (not in the 20-goal chain, not a chapter), with a Show-me panel', () => {
    expect(GOALS).toHaveLength(20);
    expect(BONUS_GOALS[0]!.id).toBe('viewpointHigh'); // the Phase 6 goals follow (tests/sim/phase6Polish.test.ts)
    expect(GOALS.some((g) => g.id === 'viewpointHigh')).toBe(false);
    expect(BONUS_GOALS[0]!.panel).toEqual({ drawer: 'buildings', item: 'viewpoint' });
    expect(VIEWPOINT_GOAL_ALT).toBeGreaterThan(0.4);
  });
  it('engine (fixture): nothing without a viewpoint, half with a low one, done with a high one; pays once, a quiet milestone, the chain is untouched; save / load keeps it', () => {
    const bus = new EventBus<GameEvents>(), ev: Array<GameEvents['milestone']> = [];
    bus.on('milestone', (e) => ev.push(e));
    const b: Array<{ type: string; active: boolean; x: number; y: number; w: number; h: number }> = [];
    let paid = 0, alt = 0.2;
    const world = { buildings: () => b, lifts: () => [], pistes: () => [], trailTiles: () => 0, stars: () => 0, money: () => 0, debt: () => 0, grant: (a: number) => { paid += a; }, altFrac: () => alt };
    const g = new Goals(() => world, bus);
    g.evaluate();
    expect(g.isDone('viewpointHigh')).toBe(false);
    b.push({ type: 'viewpoint', active: true, x: 5, y: 5, w: 2, h: 2 });
    g.evaluate();
    expect(g.isDone('viewpointHigh')).toBe(false); // low ground: not yet
    alt = 0.8;
    g.evaluate(); g.evaluate();
    expect(g.isDone('viewpointHigh')).toBe(true);
    expect(paid).toBe(BONUS_GOALS[0]!.reward);
    expect(ev.filter((e) => e.id === 'goal:viewpointHigh')).toHaveLength(1);
    expect(ev.filter((e) => e.id === 'goal:viewpointHigh')[0]!.major).toBe(false);
    expect(g.completedCount).toBe(0); // the chain count and 'finished' ignore bonus goals
    expect(g.finished).toBe(false);
    const saved = g.serialize();
    expect(saved.bonus).toEqual(['viewpointHigh']);
    const h = new Goals(() => world, bus); h.load(saved);
    expect(h.isDone('viewpointHigh')).toBe(true);
    h.evaluate(); expect(paid).toBe(BONUS_GOALS[0]!.reward); // never paid twice
    // a world that never had one serialises exactly as before
    expect(new Goals(() => world, bus).serialize()).not.toHaveProperty('bonus');
  });
  it('real sim: a viewpoint on high ground completes it (grant paid), on the valley floor it does not; determinism', () => {
    const attempt = (high: boolean): { done: boolean; money: number; hash: string; sim: Sim } => {
      const sim = createSim({ size: 64, seed: 61, starterResort: true, mode: 'sandbox', now: () => 0 });
      const n = sim.size;
      const ws = (x: number, y: number): number => (sim.cond.altitude(x, y));
      let best: { x: number; y: number; a: number } | null = null;
      for (let y = 4; y < n - 5; y++) for (let x = 4; x < n - 5; x++) {
        const v = validatePlacement(sim.env, 'viewpoint', x, y, 0);
        if (!v.ok) continue;
        const a = ws(x, y);
        if (!best || (high ? a > best.a : a < best.a)) best = { x, y, a };
      }
      expect(best).toBeTruthy();
      const o = placeBuilding(sim.env, sim.props, 'viewpoint', best!.x, best!.y, 0, true, false);
      expect(o.ok).toBe(true);
      o.building!.active = true;
      sim.tick(TICKS_PER_DAY / 24 * 3);
      return { done: sim.goals.isDone('viewpointHigh'), money: sim.game.money, hash: stateHash(sim).hash, sim };
    };
    const hi = attempt(true), lo = attempt(false), hi2 = attempt(true);
    expect(hi.done).toBe(true);
    expect(lo.done).toBe(false);
    expect(hi2.hash).toBe(hi.hash);
    // save / load keeps the bonus
    const loaded = createSim({ size: 64, seed: 61, now: () => 0, fromSave: structuredClone(collectSave(hi.sim)) });
    expect(loaded.goals.isDone('viewpointHigh')).toBe(true);
  }, 120_000);
});

describe('sustainability neutral', () => {
  it('a treehouse among the trees does not move the sustainability score (4 tiles of thousands of habitat tiles, no felling)', () => {
    const score = (build: boolean): number => {
      const sim = createSim({ size: 64, seed: 61, starterResort: true, mode: 'sandbox', now: () => 0 });
      if (build) {
        const N = sim.size, tc = (x: number, y: number): number => sim.props.countInRect(x - 3, y - 3, x + 4, y + 4, (k) => TREE_KINDS.includes(k));
        let done = false;
        for (let y = 6; y < N - 8 && !done; y++) for (let x = 6; x < N - 8 && !done; x++) if (tc(x, y) >= 14 && validatePlacement(sim.env, 'treehouse', x, y, 0).ok) { done = placeBuilding(sim.env, sim.props, 'treehouse', x, y, 0, false, false).ok; }
        expect(done).toBe(true);
      }
      return sim.sustain.measure().score;
    };
    expect(score(true)).toBeCloseTo(score(false), 1);
  });
});
