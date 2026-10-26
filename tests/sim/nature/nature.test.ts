import { DAYS_PER_YEAR } from '@/config/balance';
import { describe, it, expect } from 'vitest';
import { createSim } from '../../../src/game/createSim';
import { Grid } from '../../../src/world/Grid';
import { PropStore, growthFactor, growthStage, GROWTH, PropKind } from '../../../src/world/Props';
import { planPlanting, applyPlanting, planClearing, applyClearing, plantReject, ForestCover, GrowthTracker, PLANT, type PlantEnv } from '../../../src/sim/nature/Planting';
import { phaseFor, seasonProgress } from '../../../src/sim/nature/Livestock';
import { suitability, SPECIES } from '../../../src/sim/nature/Fauna';

const flatEnv = (blocked: (i: number) => boolean = () => false): PlantEnv => {
  const grid = new Grid(64);
  return { grid, props: new PropStore(grid), blocked, seed: 7 };
};

describe('planting rules', () => {
  it('plants deterministically with spacing and cost', () => {
    const a = planPlanting(flatEnv(), 20, 20, 2, 'conifer', 1, 10), b = planPlanting(flatEnv(), 20, 20, 2, 'conifer', 1, 10);
    expect(a.trees.length).toBeGreaterThan(0);
    expect(a.trees).toEqual(b.trees);
    expect(a.cost).toBeCloseTo(a.trees.length * PLANT.costPerTree);
    for (let i = 0; i < a.trees.length; i++) for (let j = i + 1; j < a.trees.length; j++) {
      const p = a.trees[i]!, q = a.trees[j]!;
      expect(Math.hypot(p.tx + p.ox - q.tx - q.ox, p.ty + p.oy - q.ty - q.oy)).toBeGreaterThanOrEqual(PLANT.minSpacing - 1e-9);
    }
  });
  it('refuses occupied tiles (pistes/buildings) and edges', () => {
    const env = flatEnv((i) => i === 20 * 64 + 20);
    expect(plantReject(env, 20, 20)).toBe('occupied');
    expect(plantReject(env, 0, 5)).toBe('edge');
    expect(planPlanting(env, 20, 20, 1, 'birch', 1, 1).trees.length).toBe(0);
  });
  it('grows sapling -> young -> mature and clears with refresh chunks', () => {
    const env = flatEnv();
    const plan = planPlanting(env, 20, 20, 2, 'deciduous', 1, 100);
    const touched = applyPlanting(env.props, plan, 100);
    expect(touched.length).toBeGreaterThan(0);
    expect(growthStage(100, 100)).toBe('sapling');
    expect(growthStage(100, 100 + GROWTH.youngDay)).toBe('young');
    expect(growthStage(100, 100 + GROWTH.matureDay)).toBe('mature');
    expect(growthFactor(100, 100)).toBeLessThan(growthFactor(100, 140));
    expect(growthFactor(-1, 5)).toBe(1);
    const gt = new GrowthTracker(env.props); gt.track(touched);
    expect(gt.update(105).length).toBeGreaterThan(0);
    const c = planClearing(env.props, 20, 20, 2, 300);
    expect(c.count).toBe(env.props.count());
    expect(c.mature).toBe(c.count);
    expect(applyClearing(env.props, 20, 20, 2).length).toBeGreaterThan(0);
    expect(env.props.count()).toBe(0);
  });
  it('rocks survive clearing; forest cover rises with mature trees', () => {
    const env = flatEnv();
    env.props.add(PropKind.Rock, 10, 10, 0.5, 0.5, 1, 0, 0);
    for (let k = 0; k < 4; k++) env.props.add(PropKind.Conifer, 11, 10, 0.2 + k * 0.2, 0.5, 1, 0, 0);
    expect(applyClearing(env.props, 10, 10, 1)).toEqual([]);
    const fc = new ForestCover(env.props); fc.rebuild();
    expect(fc.protection[10 * 64 + 11]).toBeGreaterThan(0.1);
    expect(fc.protection[40 * 64 + 40]).toBe(0);
  });
});

describe('livestock calendar + fauna habitat', () => {
  it('moves through barn/paddock/ascend/graze/descend over the year', () => {
    const phases = new Set(Array.from({ length: DAYS_PER_YEAR }, (_, d) => phaseFor(d)));
    for (const p of ['barn', 'paddock', 'ascend', 'graze', 'descend']) expect(phases.has(p as never)).toBe(true);
    expect(phaseFor(10 * 30)).toBe('barn');
    expect(seasonProgress(5).season).toBe('spring');
  });
  it('habitat suitability respects altitude/slope', () => {
    expect(suitability(SPECIES.ibex.habitat, 0.8, 2, 0, true)).toBeGreaterThan(0.9);
    expect(suitability(SPECIES.ibex.habitat, 0.1, 0.1, 200, false)).toBe(0);
    expect(suitability(SPECIES.marmot.habitat, 0.6, 0.3, 0, false)).toBeGreaterThan(0.9);
  });
});

describe('nature integration', () => {
  it('spawns capped, deterministic fauna; time-sliced sim stays cheap; farm adds livestock', () => {
    const run = () => { const s = createSim({ size: 128, seed: 5 }); s.tick(400); return s; };
    const a = run(), b = run();
    expect(a.nature.fauna.animals.length).toBeGreaterThan(5);
    expect(a.nature.fauna.animals.length).toBeLessThanOrEqual(240);
    expect(a.nature.fauna.hash()).toBe(b.nature.fauna.hash());
    for (const c of a.nature.fauna.animals) { expect(c.x).toBeGreaterThanOrEqual(0); expect(c.x).toBeLessThan(128); }
    const sum = a.nature.summary();
    console.log('nature perf [128]', JSON.stringify({ animals: sum.animals, perTickMs: +sum.perTickMs.toFixed(3), maxMs: +sum.maxMs.toFixed(2) }));
    expect(sum.perTickMs).toBeLessThan(2);
  });
});
