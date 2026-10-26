import { describe, expect, it } from 'vitest';
import { Grid } from '../../src/world/Grid';
import { generateTerrain } from '../../src/world/TerrainGen';
import { LIFTS } from '../../src/config/lifts';
import { validKinds } from '../../src/sim/LiftAssist';
import { TUTORIAL_QUERY, TUTORIAL_SCENARIO, isTutorialRequest, scoreTerrain, tutorialSimOptions } from '../../src/tutorial/scenario';
import { anchors, findAlongPiste, findSite, planLift, planPiste, planRoadTo } from '../../src/tutorial/suggest';
import { seasonOf } from '../../src/sim/Clock';
import { makeEngine, runDoItBot, tutorialSim } from './helpers';

describe('tutorial scenario', () => {
  it('is a fixed 64 map in winter with generous money', () => {
    const o = tutorialSimOptions();
    expect(o.size).toBe(64);
    expect(o.startSeason).toBe('winter');
    expect(o.money).toBeGreaterThanOrEqual(300_000);
    const sim = tutorialSim();
    expect(sim.size).toBe(64);
    expect(seasonOf(sim.game.date)).toBe('winter');
    expect(sim.game.money).toBe(TUTORIAL_SCENARIO.money);
    expect(sim.buildings.has('baseLodge')).toBe(true);
    expect(sim.terrainInfo.lakes.length).toBeGreaterThanOrEqual(1);
  });

  it('the chosen seed is among the best valleys of the scanned range (flat village + skiable flank + lakes)', () => {
    const scores: Array<[number, number]> = [];
    for (let seed = 1; seed <= 120; seed++) {
      const g = new Grid(64);
      const t = generateTerrain(g, seed);
      scores.push([seed, scoreTerrain(g, t.lakes.length)]);
    }
    scores.sort((a, b) => b[1] - a[1]);
    const rank = scores.findIndex(([s]) => s === TUTORIAL_SCENARIO.seed);
    expect(rank).toBeGreaterThanOrEqual(0);
    expect(rank).toBeLessThan(12);
  });

  it('the starter chain is buildable on the seed: parking, ticket office, restaurant, lift, piste, school, patrol, first aid', () => {
    const sim = tutorialSim();
    const a = anchors(sim);
    const parking = findSite(sim, 'parking', a.road, { route: 'road', rmax: 16 });
    expect(parking, 'parking near the village road').not.toBeNull();
    expect(planRoadTo(sim, parking!.rect)).not.toBeNull();
    expect(findSite(sim, 'ticketOffice', a.lodge, { route: 'path', rmax: 12 }), 'ticket office').not.toBeNull();
    expect(findSite(sim, 'lodge', { x: a.lodge.x - 6, y: a.lodge.y + 6 }, { route: 'road', rmax: 16 }), 'restaurant').not.toBeNull();
    expect(findSite(sim, 'skiSchoolHQ', { x: a.lodge.x + 6, y: a.lodge.y }, { route: 'path', rmax: 14 }), 'ski school').not.toBeNull();
    expect(findSite(sim, 'patrolHub', a.road, { route: 'road', rmax: 18 }), 'patrol hub').not.toBeNull();
    const plan = planLift(sim);
    expect(plan, 'lift line').not.toBeNull();
    expect(['chair4', 'tbar', 'chair2']).toContain(plan!.kind);
    expect(validKinds({ grid: sim.grid, lifts: sim.lifts, economy: sim.economy, access: sim.networks.access }, plan!.bottom, plan!.top, { autoFlatten: true })).toContain(plan!.kind);
    expect(plan!.top.y).toBeLessThan(plan!.bottom.y + 40);
    expect(LIFTS[plan!.kind].name.length).toBeGreaterThan(0);
  });

  it('the whole lesson chain (incl. piste, carpet, first-aid, snowmaking, trails) succeeds with zero failures on the seed', () => {
    const sim = tutorialSim();
    const eng = makeEngine(sim, { funding: false });
    eng.start({ fresh: true });
    const rep = runDoItBot(sim, eng, { ticksPerStep: 0 });
    expect(rep.failed).toEqual([]);
    const piste = planPiste(sim, sim.lifts.all()[0]!);
    expect(piste).not.toBeNull();
    expect(findAlongPiste(sim, 'firstAid', 7)).toBeDefined();
    expect(sim.buildings.has('magicCarpet') && sim.buildings.has('firstAid') && sim.buildings.has('snowCannon')).toBe(true);
  }, 60000);

  it('?tutorial=1 is recognised', () => {
    expect(isTutorialRequest(new URLSearchParams('tutorial=1'))).toBe(true);
    expect(isTutorialRequest(new URLSearchParams('tutorial=true'))).toBe(true);
    expect(isTutorialRequest(new URLSearchParams('size=64'))).toBe(false);
    expect(TUTORIAL_QUERY).toBe('?tutorial=1');
  });
});
