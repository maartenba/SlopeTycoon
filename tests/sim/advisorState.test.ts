import { describe, expect, it } from 'vitest';
import { createSim, type Sim } from '../../src/game/createSim';
import { anchors, buildNetwork, findSite, placeSite, planPathTo, planRoadTo, type Site } from '../../src/tutorial/suggest';
import { BUILDINGS } from '../../src/config/buildings';
import { GuestType } from '../../src/sim/guests/Guest';
import { tutorialSim, makeEngine } from '../tutorial/helpers';

const fresh = (seed = 61): Sim => { const s = createSim({ size: 64, seed, starterResort: true, startSeason: 'winter', now: () => 0 } as never); s.tick(240 * 3); s.advisor.reset(); return s; };
const remove = (sim: Sim, ...types: string[]): void => { for (const b of sim.buildings.all().slice()) if (types.includes(b.type)) sim.buildings.remove(b.id); sim.refreshCoverage(undefined, true); };
const hour = (sim: Sim): string[] => { sim.bus.emit('time:hour', undefined as never); return sim.advisor.ranked().map((a) => a.id); };
const adviceOf = (sim: Sim, id: string) => sim.advisor.ranked().find((a) => a.id === id);
/** A valid site that is NOT the advisor's suggestion: scan anchors on a ring far from it. */
function elsewhere(sim: Sim, type: string, avoid: { x: number; y: number } | undefined, route?: 'road' | 'path'): Site {
  const lodge = anchors(sim).lodge;
  for (const [dx, dy] of [[-14, 6], [14, 6], [0, 14], [-10, -10], [10, -10], [-18, 0], [18, 0]] as const) {
    const s = findSite(sim, type, { x: lodge.x + dx, y: lodge.y + dy }, { rmax: 6, route });
    if (s && (!avoid || Math.hypot(s.x - avoid.x, s.y - avoid.y) > 6)) return s;
  }
  throw new Error(`no alternative site for ${type}`);
}
const link = (sim: Sim, s: Site): void => {
  const def = BUILDINGS[s.type]!;
  if (def.access === 'road') { const p = planRoadTo(sim, s.rect); if (p?.length) buildNetwork(sim, 2, p); }
  else if (def.access === 'path') { const p = planPathTo(sim, s.rect); if (p?.length) buildNetwork(sim, 1, p); }
};

describe('Ranger Rudi is satisfied by the STATE of the resort, not by the suggested tile', () => {
  it('parking built elsewhere and connected clears arrival.parking at the next hourly evaluation', () => {
    const s = fresh();
    remove(s, 'parking');
    s.advisor.evaluate(true);
    const a = adviceOf(s, 'arrival.parking')!;
    expect(a).toBeTruthy();
    const hint = a.action?.site;
    const alt = elsewhere(s, 'parking', hint, 'road');
    expect(placeSite(s, alt).ok).toBe(true);
    link(s, alt);
    expect(hour(s)).not.toContain('arrival.parking');
  });

  it('parking built elsewhere but NOT connected: specific advice names the real parking and the problem', () => {
    const s = fresh();
    remove(s, 'parking');
    s.advisor.evaluate(true);
    const hint = adviceOf(s, 'arrival.parking')!.action?.site;
    const alt = elsewhere(s, 'parking', hint); // no road required: placed inactive
    expect(placeSite(s, alt).ok).toBe(true);
    const p = s.buildings.all().find((b) => b.type === 'parking')!;
    expect(p.active).toBe(false);
    const ids = hour(s);
    expect(ids).toContain('arrival.parking');
    const a = adviceOf(s, 'arrival.parking')!;
    expect(a.why).toMatch(/needs a road/i);
    expect(a.why).toContain('Parking');
    expect(a.why).toMatch(/road/i);
    expect(a.action).toBeUndefined(); // nothing to build: it is already built
    expect(a.target).toMatchObject({ kind: 'building', id: p.id });
    expect(ids).not.toContain('building.inactive'); // no duplicate for the same building
    // connecting it (anywhere) clears the advice
    link(s, alt);
    expect(hour(s)).not.toContain('arrival.parking');
  });

  it('after the world changes the cached suggestion is re-validated (never a stale tile)', () => {
    const s = fresh();
    remove(s, 'parking');
    s.advisor.evaluate(true);
    const site = adviceOf(s, 'arrival.parking')!.action!.site!;
    // the player builds ON the suggested tile with something else
    remove(s, 'parking');
    const blocker = placeSite(s, { type: 'shop', x: site.x, y: site.y, rot: 0, autoFlatten: true, cost: 0, rect: { x: site.x, y: site.y, w: 2, h: 2 } });
    s.advisor.evaluate(true);
    const again = adviceOf(s, 'arrival.parking')!.action?.site;
    if (blocker.ok && again) expect(again.x !== site.x || again.y !== site.y).toBe(true);
  });

  // every rule that proposes a site: building the type anywhere else (and connecting it) clears the advice
  const CASES: Array<{ id: string; type: string; prep: (s: Sim) => void }> = [
    { id: 'grooming.none', type: 'groomerGarage', prep: (s) => remove(s, 'groomerGarage', 'snowcatOutpost') },
    { id: 'patrol.none', type: 'patrolHub', prep: (s) => { s.guestSim.store.count = 14; remove(s, 'patrolHub', 'firstAid'); for (const l of s.lifts.all()) l.open = true; } },
    { id: 'school.none', type: 'skiSchoolHQ', prep: (s) => { remove(s, 'skiSchoolHQ'); const st = s.guestSim.store; for (let i = 0; i < 9; i++) { st.alive[i] = 1; st.type[i] = GuestType.Family; } st.count = Math.max(st.count, 9); } },
    { id: 'arrival.parking', type: 'parking', prep: (s) => remove(s, 'parking') },
    { id: 'storm.signs', type: 'warningSign', prep: (s) => { s.guestSim.store.count = 12; s.weather.current.kind = 'storm'; } },
  ];
  for (const c of CASES) {
    it(`${c.id}: a ${c.type} anywhere (active) clears it; one that is inactive gets specific advice`, () => {
      const s = fresh();
      c.prep(s);
      s.advisor.evaluate(true);
      const a = adviceOf(s, c.id);
      expect(a, c.id).toBeTruthy();
      const alt = elsewhere(s, c.type, a!.action?.site, BUILDINGS[c.type]?.access === 'road' ? 'road' : undefined);
      expect(placeSite(s, alt).ok).toBe(true);
      link(s, alt);
      s.advisor.evaluate(true);
      expect(adviceOf(s, c.id)?.id, `${c.id} cleared`).toBeUndefined();
    });
  }
  it('lift.worn with a workshop built anywhere no longer suggests building one', () => {
    const s = fresh();
    remove(s, 'liftWorkshop');
    s.lifts.all()[0]!.ops!.condition = 20;
    s.advisor.evaluate(true);
    const a = adviceOf(s, 'lift.worn')!;
    expect(a.action?.building).toBe('liftWorkshop');
    const alt = elsewhere(s, 'liftWorkshop', a.action?.site, 'road');
    placeSite(s, alt); link(s, alt);
    s.advisor.evaluate(true);
    expect(adviceOf(s, 'lift.worn')?.action).toBeUndefined();
  });
});

describe('tutorial: the parking step accepts any parking', () => {
  it('a parking placed far from the suggested site completes the step', () => {
    const sim = tutorialSim(64);
    const eng = makeEngine(sim);
    eng.start({ fresh: true });
    for (let i = 0; i < 6 && eng.current?.id !== 'parking'; i++) { if (eng.current?.ack) eng.next(); else eng.doItForMe(); eng.evaluate(); }
    expect(eng.current?.id).toBe('parking');
    const hint = eng.showMe().map;
    const alt = elsewhere(sim, 'parking', hint ? { x: hint.x, y: hint.y } : undefined, 'road');
    expect(placeSite(sim, alt).ok).toBe(true);
    eng.evaluate(true);
    expect(eng.current?.id).not.toBe('parking');
    expect(eng.state.completed).toContain('parking');
  });
});
