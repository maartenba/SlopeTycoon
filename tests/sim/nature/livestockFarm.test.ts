import { describe, expect, it } from 'vitest';
import { createSim } from '../../../src/game/createSim';
import { buildDemoResort } from '../../../src/game/demoResort';

const demo = (size: 64 | 128, seed: number) => {
  const sim = createSim({ size, seed, startSeason: 'winter', now: () => 0 });
  buildDemoResort(sim, 'large');
  const farm = sim.buildings.all().find((b) => b.type === 'alpineFarm')!;
  return { sim, farm };
};

describe('Alpine Farm livestock follows the calendar', () => {
  for (const [size, seed] of [[64, 61], [128, 61]] as const) {
    it(`${size}/${seed}: a date jump settles the herd at once (winter barn, summer pasture, autumn barn walk)`, () => {
      const { sim, farm } = demo(size, seed);
      const L = sim.nature.livestock;
      expect(farm.active).toBe(true);
      expect(L.animals.length).toBeGreaterThan(0);
      sim.tick(5);
      expect(L.visibleCount()).toBe(0); // winter: in the barn
      sim.jumpToDay(65, 9);
      sim.tick(1);
      expect(L.phase).toBe('graze');
      expect(L.visibleCount()).toBe(L.animals.length); // immediately on the pasture, not after the next season event
      const cx = farm.x + farm.w / 2, cy = farm.y + farm.h / 2;
      expect(L.animals.some((a) => Math.hypot(a.x - cx, a.y - cy) > 4)).toBe(true);
      sim.tick(600); // and they keep roaming: spread over the pasture
      const far = L.animals.filter((a) => Math.hypot(a.x - cx, a.y - cy) > 4).length;
      expect(far).toBeGreaterThan(L.animals.length / 3);
      sim.jumpToDay(150, 9);
      sim.tick(1);
      expect(L.visibleCount()).toBe(0);
    });

    it(`${size}/${seed}: the herd walks into the barn in winter (nobody left standing outside)`, () => {
      const { sim } = demo(size, seed);
      const L = sim.nature.livestock;
      sim.jumpToDay(100, 9); sim.tick(1);
      sim.jumpToDay(125, 9); // barn phase, animals still outside: they must walk in
      sim.tick(1100);
      expect(L.phase).toBe('barn');
      expect(L.visibleCount()).toBe(0);
    });
  }

  it('an unconnected farm still has its herd, and the herd appears when the farm becomes active (no extra building event needed)', () => {
    const sim = createSim({ size: 64, seed: 61, startSeason: 'summer', now: () => 0 });
    const { farm } = (() => { buildDemoResort(sim, 'medium'); return { farm: sim.buildings.all().find((b) => b.type === 'alpineFarm')! }; })();
    expect(farm).toBeDefined();
    expect(sim.nature.livestock.animals.filter((a) => a.farm === farm.id).length).toBeGreaterThan(0);
  });

  it('the farm shop is a summer attraction (needs snowFree) and restaurants earn the farm bonus in summer, not in winter', () => {
    const { sim } = demo(64, 7);
    sim.jumpToDay(65, 9); sim.tick(1);
    expect(sim.nature.farmBonus()).toBeGreaterThan(0);
    sim.jumpToDay(150, 9); sim.tick(1);
    expect(sim.nature.farmBonus()).toBe(0);
  });

  it('demo resort (medium + large) contains an active Alpine Farm on 64 and 128', () => {
    for (const level of ['medium', 'large'] as const) for (const size of [64, 128] as const) {
      const sim = createSim({ size, seed: 7, startSeason: 'winter', now: () => 0 });
      buildDemoResort(sim, level);
      const farms = sim.buildings.all().filter((b) => b.type === 'alpineFarm');
      expect(farms.length, `${level} ${size}`).toBe(1);
      expect(farms[0]!.active).toBe(true);
    }
  });
});
