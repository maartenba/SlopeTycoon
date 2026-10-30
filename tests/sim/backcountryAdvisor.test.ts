import { describe, expect, it } from 'vitest';
import { createSim, type Sim } from '../../src/game/createSim';
import { RULES } from '../../src/sim/advisor/rules';
import { paintBackcountryRoute } from './backcountryHelpers';

const fresh = (): Sim => { const s = createSim({ size: 64, seed: 61, starterResort: true, startSeason: 'winter', now: () => 0 } as never); s.tick(240 * 3 + 20); s.advisor.reset(); return s; };
const fire = (s: Sim, id: string): boolean => RULES.find((r) => r.id === id)!.eval({ sim: s, shown: false, season: 'winter', pistes: () => ({ tiles: 0, icy: 0, noGroom: [], noAid: [] }), site: () => null }) != null;

describe('advisor: backcountry warnings', () => {
  it('warns about an open route outside patrol cover, and about a route open at danger >= 4 (override); nothing without routes', () => {
    const s = fresh();
    expect(fire(s, 'backcountry.patrol')).toBe(false);
    expect(fire(s, 'backcountry.risky')).toBe(false);
    const tiles = paintBackcountryRoute(s);
    s.cond.skiOpen.fill(1);
    s.backcountry.refresh();
    const r = s.backcountry.routes()[0]!;
    expect(r.open).toBe(true);
    // the starter resort has a patrol hub: take the cover away to see the warning
    s.coverage.map('patrol').fill(0);
    s.backcountry.refresh();
    expect(s.backcountry.routes()[0]!.covered).toBe(0);
    expect(fire(s, 'backcountry.patrol')).toBe(true);
    expect(fire(s, 'backcountry.risky')).toBe(false);
    for (const t of tiles) s.safety.avalanche.inst[t] = 2.5;
    s.backcountry.refresh();
    expect(s.backcountry.routes()[0]!.open).toBe(false);
    expect(fire(s, 'backcountry.risky')).toBe(false); // closed: nothing risky is open
    s.backcountry.setOverride(r.id, true);
    expect(fire(s, 'backcountry.risky')).toBe(true);
  });
});
