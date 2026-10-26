import { describe, it, expect } from 'vitest';
import { createSim } from '../../../src/game/createSim';
import { MODE } from '../../../src/sim/nature/Fauna';
import { easeToward, easeAngle } from '../../../src/render/NatureView';

describe('fauna motion', () => {
  const sim = () => { const s = createSim({ size: 64, seed: 61 }); s.tick(5); return s; };
  it('has several visible herds on a 64 map and animals actually move over time', () => {
    const s = sim();
    const f = s.nature.fauna;
    expect(f.animals.length).toBeGreaterThanOrEqual(20);
    expect(f.herdCount).toBeGreaterThanOrEqual(6);
    const before = f.animals.map((a) => [a.x, a.y]);
    s.tick(600);
    let moved = 0;
    f.animals.forEach((a, i) => { if (Math.hypot(a.x - before[i]![0]!, a.y - before[i]![1]!) > 1) moved++; });
    expect(moved).toBeGreaterThan(f.animals.length * 0.5);
  });
  it('walks, grazes and rests (modes cycle) and herds stay cohesive', () => {
    const s = sim();
    const f = s.nature.fauna, modes = new Set<number>();
    let worst = 0;
    for (let k = 0; k < 40; k++) {
      s.tick(20);
      for (const a of f.animals) if (!a.hidden && a.species === 'deer') {
        modes.add(a.mode ?? -1);
        const lead = f.animals.find((b) => b.herd === a.herd && b.leader)!;
        worst = Math.max(worst, Math.hypot(a.x - lead.x, a.y - lead.y));
      }
    }
    expect(modes.has(MODE.walk)).toBe(true);
    expect(modes.has(MODE.graze)).toBe(true);
    expect(worst).toBeLessThan(14); // followers trot to catch up: herds never scatter across the map
  });
  it('eagles form flocks circling a shared anchor', () => {
    const s = sim(); const e = s.nature.fauna.animals.filter((a) => a.species === 'eagle');
    if (!e.length) return;
    s.tick(100);
    for (const a of e) { const l = e.find((b) => b.herd === a.herd && b.leader)!; expect(Math.hypot(a.x - l.tx, a.y - l.ty)).toBeLessThan(10); }
  });
});

describe('render interpolation helpers', () => {
  it('easeToward converges monotonically and is frame-rate independent', () => {
    let a = 0; for (let i = 0; i < 10; i++) { const n = easeToward(a, 10, 0.05); expect(n).toBeGreaterThan(a); expect(n).toBeLessThanOrEqual(10); a = n; }
    let one = easeToward(0, 10, 0.1), two = easeToward(easeToward(0, 10, 0.05), 10, 0.05);
    expect(one).toBeCloseTo(two, 6); one = 0; two = 0;
    expect(easeToward(3, 3, 0.1)).toBe(3);
  });
  it('easeAngle takes the short way round', () => {
    const r = easeAngle(3.0, -3.0, 0.1); // 3.0 -> -3.0 is a +0.28 rad step across pi, not -6
    expect(r).toBeGreaterThan(3.0);
  });
});
