import { describe, expect, it } from 'vitest';
import { createSim, type Sim } from '../../src/game/createSim';
import { validateLift } from '../../src/sim/Lift';
import { OccFlag } from '../../src/world/Occupancy';
import { anchors, buildLift, liftPlanValid, planLift, stationSiteFree, LODGE_ZONE, LODGE_ZONE_EAST } from '../../src/tutorial/suggest';
import { makeEngine, tutorialSim } from './helpers';

const env = (s: Sim) => ({ grid: s.grid, lifts: s.lifts, economy: s.economy, access: s.networks.access });
const lodgeOf = (s: Sim) => s.buildings.all().find((b) => b.type === 'baseLodge');

/** Everything a proposed lift line must satisfy (real validators + never on the base). */
function checkPlan(s: Sim, label: string): boolean {
  const p = planLift(s);
  if (!p) return false;
  const c = validateLift(env(s), p.kind, p.bottom, p.top, { autoFlatten: true, skipFunds: true });
  expect(c.ok, `${label}: ${c.reasons.join('|')}`).toBe(true);
  const occ = s.grid.occupancy;
  for (const st of [p.bottom, p.top]) for (let j = st.y; j < st.y + 2; j++) for (let i = st.x; i < st.x + 2; i++) {
    expect(occ.flags[occ.index(i, j)], `${label}: station tile ${i},${j} occupied`).toBe(0);
    expect(s.networks.kindAt(i, j), `${label}: station on road/path`).toBe(0);
    expect(s.grid.occupancy.has(i, j, OccFlag.Building)).toBe(false);
  }
  expect(stationSiteFree(s, p.bottom.x, p.bottom.y), label).toBe(true);
  const l = lodgeOf(s);
  if (l) {
    const dx = Math.max(l.x - (p.bottom.x + 2) - (LODGE_ZONE - 4), p.bottom.x - (l.x + l.w) - (LODGE_ZONE_EAST - 4), 0), dy = Math.max(l.y - (p.bottom.y + 2), p.bottom.y - (l.y + l.h), 0);
    expect(Math.max(dx, dy), `${label}: bottom station within the lodge's village zone`).toBeGreaterThanOrEqual(LODGE_ZONE);
    const d = Math.hypot(p.bottom.x - anchors(s).lodge.x, p.bottom.y - anchors(s).lodge.y);
    expect(d, `${label}: distance to the core`).toBeLessThanOrEqual(s.size * 0.45 + 8);
  }
  expect(liftPlanValid(s, p.kind, p.bottom, p.top)).toBe(true);
  return true;
}

describe('suggested lift line is real and never on the base', () => {
  for (const size of [64, 128, 256] as const) {
    it(`seeds 1-20 at ${size} (lodge via the tutorial scenario)`, () => {
      let ok = 0;
      for (let seed = 1; seed <= 20; seed++) {
        const s = createSim({ size, seed, startSeason: 'winter', money: 1e6 } as never);
        const v = s.terrainInfo.villageAnchor;
        // place a lodge at the village anchor like the tutorial does
        const eng = makeEngine(s); eng.start({ fresh: true });
        for (let i = 0; i < 8 && !lodgeOf(s); i++) eng.doItForMe();
        void v; if (!lodgeOf(s)) throw new Error("no lodge");
        if (checkPlan(s, `${size}/${seed}`)) ok++;
      }
      expect(ok).toBeGreaterThan(14); // a few maps may offer no valid line (then the tutorial says so instead of proposing one)
    }, 240000);
  }
  it('tutorial seed 61: the lift step marker is valid and doItForMe builds a valid lift', () => {
    for (const size of [64, 128, 256] as const) {
      const sim = tutorialSim(size, 61);
      const eng = makeEngine(sim, { funding: true }); eng.start({ fresh: true });
      for (let i = 0; i < 40 && eng.current?.id !== 'lift'; i++) { if (eng.current?.ack) eng.next(); else eng.doItForMe(); sim.tick(60); eng.evaluate(); }
      expect(eng.current?.id).toBe('lift');
      const sm = eng.showMe();
      expect(sm.valid).toBe(true);
      expect(sm.map).toBeTruthy();
      expect(checkPlan(sim, `tutorial ${size}`)).toBe(true);
      const r = eng.doItForMe();
      expect(r.ok, r.reason).toBe(true);
      expect(sim.lifts.all().length).toBe(1);
    }
  }, 120000);
  it('no valid line: the step says so instead of proposing an invalid one', () => {
    const sim = tutorialSim(64, 61);
    const eng = makeEngine(sim); eng.start({ fresh: true });
    for (let i = 0; i < 40 && eng.current?.id !== 'lift'; i++) { if (eng.current?.ack) eng.next(); else eng.doItForMe(); sim.tick(60); eng.evaluate(); }
    // wall off every candidate: mark the whole map occupied
    const occ = sim.grid.occupancy;
    for (let j = 0; j < sim.size; j++) for (let i = 0; i < sim.size; i++) occ.flags[occ.index(i, j)]! |= OccFlag.Building;
    expect(planLift(sim)).toBeNull();
    const sm = eng.showMe();
    expect(sm.valid).toBe(false);
    expect(eng.view().note).toMatch(/No valid lift line found near the base/);
    expect(buildLift).toBeTypeOf('function');
  });
});
