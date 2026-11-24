/** Rudi's near-miss tip (0.8.3, `race.course.short`): a red run with huts beside it that is 40-49 m high. A real 45 m run (seed 2), no stubs. */
import { describe, expect, it } from 'vitest';
import { RULES } from '../../../src/sim/advisor/rules';
import { RACE } from '../../../src/config/race';
import { mainRun, mkWinter, prepareCourse } from './helpers';

describe('race.course.short', () => {
  it('seed 2 has a 45 m run; without huts there is no near miss, with huts there is', () => {
    const s = mkWinter(2);
    expect(mainRun(s).dropM).toBeGreaterThanOrEqual(RACE.minDropM - RACE.nearMissM);
    expect(mainRun(s).dropM).toBeLessThan(RACE.minDropM);
    expect(s.race.nearMiss()).toBeNull();
    prepareCourse(s, 2);
    const nm = s.race.nearMiss();
    expect(nm?.mtb).toBe(false);
    expect(nm!.run.dropM).toBeLessThan(RACE.minDropM);
  });
  it('a green run, a marked course and a long run are never near misses; the rule text reads plainly', () => {
    const long = mkWinter(61); prepareCourse(long, 2);
    expect(long.race.nearMiss()).toBeNull(); // 61 m
    const s = mkWinter(2); prepareCourse(s, 1);
    expect(s.race.nearMiss()).toBeNull(); // green
    const r = RULES.find((x) => x.id === 'race.course.short')!;
    const t = mkWinter(2); prepareCourse(t, 2);
    const adv = r.eval({ sim: t, shown: false, site: () => null } as never);
    expect(adv?.title).toMatch(/drops \d\d m: a race course needs 50 m/);
    expect(adv?.why).toContain('Lengthen it a few tiles downhill');
  });
});
