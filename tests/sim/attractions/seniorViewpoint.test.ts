/** Phase 6 Task 29: seniors choose a viewpoint as a walking goal more often than other guests (viewBonus). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUILDINGS, type BuildingDef } from '../../../src/config/buildings';
import { CORE_TYPE_COUNT, SHIPPED_TYPES } from '../../../src/config/guestTypes';
import { Rng } from '../../../src/core/Rng';
import { placeBuilding } from '../../../src/sim/PlaceBuilding';
import { Layer } from '../../../src/world/Networks';
import { buildHikingResort } from '../../../scripts/analysis/hikingLib';
import { GuestType } from '../../../src/sim/guests/Guest';

const VP = 'testViewpointSenior';
const SENIOR = CORE_TYPE_COUNT + SHIPPED_TYPES.findIndex((d) => d.id === 'senior');
beforeAll(() => { BUILDINGS[VP] = { ...BUILDINGS.mountainHut!, id: VP, access: 'trail', altAccess: ['path', 'pisteEdge'], pisteRule: 'forbid', viewpoint: {} } as BuildingDef; });
afterAll(() => { delete BUILDINGS[VP]; });

describe('seniors and viewpoints', () => {
  it('a viewpoint is picked as the hiking goal clearly more often by seniors than by couples', () => {
    const { sim, info } = buildHikingResort(64, 11, { defaultHours: true, noHut: true });
    const n = sim.size;
    const cands: number[] = [];
    for (let t = 0; t < n * n; t++) if (sim.networks.layers[t]! & Layer.Hike) { const r = (sim.cond.altitude(t % n, (t / n) | 0) - info.altMin) / (info.altMax - info.altMin); if (r > 0.68 && r < 0.9) cands.push(t); }
    outer: for (const t of cands) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const o = placeBuilding(sim.env, sim.props, VP, (t % n) + dx, ((t / n) | 0) + dy, 0, true, false);
      if (o.ok) { sim.refreshCoverage(o.building!, true); break outer; }
    }
    sim.buildings.reevaluate();
    sim.tick(30);
    const g = sim.guestSim.decider.goals;
    expect(g.viewpoints.all.length).toBe(1);
    const share = (type: number): number => {
      const rng = new Rng(99); let picks = 0, on = 0;
      for (let k = 0; k < 300; k++) {
        g.queryBudget = 50;
        const p = g.pick({ hour: 9, leaveHour: 17, pref: 1, type, skill: 1, fatigue: 0.1, x: sim.guestSim.world.roadEntry()?.x ?? 30, y: sim.guestSim.world.roadEntry()?.y ?? 60, storm: false, mode: 'hike', avoid: () => 0, penalty: () => 0, lifts: [], wait: () => 0 }, rng);
        if (p) { picks++; if (g.viewTiles.has(p.tile)) on++; }
      }
      return picks ? on / picks : 0;
    };
    const couple = share(GuestType.Couple), sen = share(SENIOR);
    expect(sen).toBeGreaterThan(couple + 0.05);
  }, 120_000);
});
