import { DAYS_PER_YEAR } from '@/config/balance';
import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../../src/config/buildings';
import { bulldoze } from '../../src/build/Bulldoze';
import { LIFT_KIND_IDS } from '../../src/config/lifts';
import { demolishLift, placeLift } from '../../src/sim/Lift';
import { placeBuilding } from '../../src/sim/PlaceBuilding';
import { Layer, lineTiles, sweepBrush } from '../../src/world/Networks';
import type { Sim } from '../../src/game/createSim';
import type { TutorialEngine } from '../../src/tutorial/TutorialEngine';
import { isKnownTarget } from '../../src/tutorial/ui-targets';
import { makeEngine, runDoItBot, tutorialSim } from './helpers';

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

type Action = (sim: Sim, eng: TutorialEngine, r: () => number) => string;
const pick = <T>(r: () => number, a: readonly T[]): T => a[Math.floor(r() * a.length)]!;
const pt = (sim: Sim, r: () => number): { x: number; y: number } => ({ x: 2 + Math.floor(r() * (sim.size - 4)), y: 2 + Math.floor(r() * (sim.size - 4)) });

const ACTIONS: Action[] = [
  (sim, _e, r) => { const t = pick(r, Object.keys(BUILDINGS)); const p = pt(sim, r); placeBuilding(sim.env, sim.props, t, p.x, p.y, Math.floor(r() * 4), r() < 0.5, false); return `place ${t}`; },
  (sim, _e, r) => { const b = pick(r, sim.buildings.all().length ? sim.buildings.all() : [undefined]); if (b) bulldoze(sim.buildings, sim.economy, b.id); return 'bulldoze'; },
  (sim, _e, r) => { const lodge = sim.buildings.all().find((b) => b.type === 'baseLodge'); if (lodge) bulldoze(sim.buildings, sim.economy, lodge.id); return `bulldoze lodge ${r() < 2}`; },
  (sim, _e, r) => { const a = pt(sim, r), b = pt(sim, r); const k = r() < 0.5 ? 1 : 2; const tiles = sim.networks.buildSegment(k, lineTiles(a, { x: a.x + Math.round((b.x - a.x) / 4), y: a.y + Math.round((b.y - a.y) / 4) })); sim.bus.emit('path:drawn', { kind: k === 1 ? 'path' : 'road', tiles: tiles.length, erase: false }); sim.buildings.reevaluate(); return 'draw'; },
  (sim, _e, r) => { const a = pt(sim, r); for (let i = 0; i < 12; i++) sim.networks.unbuild(a.x + (i % 4), a.y + (i >> 2)); sim.bus.emit('path:drawn', { kind: 'path', tiles: 12, erase: true }); sim.buildings.reevaluate(); return 'erase'; },
  (sim, _e, r) => { const a = pt(sim, r), b = pt(sim, r); const st = sweepBrush(lineTiles(a, { x: a.x + Math.round((b.x - a.x) / 3), y: a.y + Math.round((b.y - a.y) / 3) }), 2, sim.size); const n = sim.networks.paint(Layer.Ski, st); sim.bus.emit('piste:painted', { layer: 'ski', tiles: n.painted, erase: false }); return 'paint'; },
  (sim, _e, r) => { const a = pt(sim, r); for (let i = 0; i < 40; i++) sim.networks.unpaint(Layer.Ski, a.x + (i % 8), a.y + (i >> 3)); return 'unpaint'; },
  (sim, _e, r) => { const a = pt(sim, r), b = { x: a.x + 6 + Math.floor(r() * 8), y: a.y + 6 + Math.floor(r() * 8) }; placeLift({ grid: sim.grid, lifts: sim.lifts, economy: sim.economy, access: sim.networks.access }, sim.props, pick(r, LIFT_KIND_IDS), a, b, true); return 'lift'; },
  (sim, _e, r) => { const l = sim.lifts.all()[0]; if (l) { if (r() < 0.5) demolishLift(sim.lifts, sim.economy, l.id); else sim.liftOps.setMode(l.id, 'closed'); } return 'lift-op'; },
  (sim, _e, r) => { sim.loop.setSpeed(pick(r, [0, 1, 2, 3] as const)); return 'speed'; },
  (sim, _e, r) => { const o = sim.loans.offers(sim.creditCtx()).find((x) => x.available); if (o && r() < 0.7) sim.loans.take(o.id, sim.creditCtx(), { year: 1, month: 0 }); else { const l = sim.loans.active()[0]; if (l) sim.loans.repay(l.id); } return 'loan'; },
  (sim, _e, r) => { sim.game.money = Math.round(-5000 + r() * 6000); return 'broke'; }, // out of money / in debt
  (sim, _e, r) => { sim.jumpToDay(Math.floor(r() * DAYS_PER_YEAR)); sim.tick(60 + Math.floor(r() * 300)); return 'time jump'; },
  (sim, _e, r) => { sim.tick(Math.floor(r() * 400)); return 'wait'; },
  (_s, eng, r) => { eng.doItForMe(); return `doit ${r() < 2}`; },
  (_s, eng) => { eng.skip(); return 'skip'; },
  (_s, eng) => { eng.next(); return 'next'; },
  (_s, eng) => { eng.previous(); return 'previous'; },
  (_s, eng) => { eng.notify('camera:rotate'); eng.notify('select:building'); return 'notify'; },
];

function invariants(sim: Sim, eng: TutorialEngine, trace: string[]): { noPlan: number; checks: number } {
  eng.evaluate();
  const where = `after [${trace.slice(-3).join(' > ')}]`;
  const st = eng.status;
  expect(['active', 'complete', 'blocked'], where).toContain(st);
  if (st === 'blocked') expect(sim.finance.ended, where).toBe(true);
  let noPlan = 0, checks = 0;
  if (st === 'active') {
    const cur = eng.current!;
    expect(cur, where).not.toBeNull();
    // showMe always names a resolvable UI target chain; map marks lie on the map
    const show = eng.showMe();
    expect(show.ui.length, `${where} ${cur.id}`).toBeGreaterThan(0);
    for (const u of show.ui) expect(isKnownTarget(u), `${cur.id}: ${u}`).toBe(true);
    if (show.map) {
      expect(show.map.x, where).toBeGreaterThanOrEqual(-1); expect(show.map.y, where).toBeGreaterThanOrEqual(-1);
      expect(show.map.x + show.map.w, where).toBeLessThanOrEqual(sim.size + 1); expect(show.map.y + show.map.h, where).toBeLessThanOrEqual(sim.size + 1);
    }
    // a way forward always exists: do-it plan, or (when the map offers no valid spot) the skip / loan / next routes
    const view = eng.view();
    expect(view.step?.canSkip, where).toBe(true);
    const est = eng.estimate();
    checks++;
    if (!est && !cur.ack) { noPlan++; if (cur.doItForMe && !show.valid) expect(view.step?.canDo, where).toBe(false); }
    if (est) expect(view.step?.canDo, where).toBe(true);
  }
  return { noPlan, checks };
}

describe('fuzz: random player actions never leave the tutorial without a valid next step', () => {
  for (const seed of [11, 23, 37, 41, 59, 71]) {
    it(`seed ${seed}: invariants hold after every action, and the bot can always finish afterwards`, () => {
      const r = rng(seed);
      const sim = tutorialSim();
      const eng = makeEngine(sim, { funding: true });
      eng.start({ fresh: true });
      const trace: string[] = [];
      let noPlan = 0, checks = 0;
      // build a little first so deletions have something to hit
      runDoItBot(sim, eng, { ticksPerStep: 20, maxIter: 6 + Math.floor(r() * 18) });
      for (let i = 0; i < 70; i++) {
        trace.push(pick(r, ACTIONS)(sim, eng, r));
        if (sim.finance.ended) break;
        const res = invariants(sim, eng, trace);
        noPlan += res.noPlan; checks += res.checks;
      }
      invariants(sim, eng, trace);
      if (process.env.FUZZ_LOG) console.log(`seed ${seed} status=${eng.status} cur=${eng.current?.id} buildings=${sim.buildings.size} lifts=${sim.lifts.size} money=${Math.round(sim.game.money)} ended=${sim.finance.ended} checks=${checks} noPlan=${noPlan}`);
      // most of the time the assistant can do the step itself (the rest has skip / loan / waiting as alternative routes)
      if (checks > 10) expect(noPlan / checks).toBeLessThan(0.5);
      if (sim.finance.ended) return;
      // recovery: from whatever mess the player made, 'Do it for me' / 'Got it' / skip must reach the end
      sim.game.money = Math.max(sim.game.money, 10000);
      for (const k of ['speed:0', 'speed:2']) eng.notify(k);
      runDoItBot(sim, eng, { ticksPerStep: 0, maxIter: 400 });
      expect(eng.status, `stuck at ${eng.current?.id} after ${trace.join(', ')}`).toBe('complete');
    }, 120000);
  }

  it('bankruptcy ends the game: the engine reports blocked but still answers show me / view without throwing', () => {
    const sim = tutorialSim();
    const eng = makeEngine(sim, { funding: true });
    eng.start({ fresh: true });
    sim.game.money = -300000;
    expect(sim.finance.declareBankruptcy()).toBe(true);
    eng.evaluate();
    expect(eng.status).toBe('blocked');
    expect(() => { eng.showMe(); eng.view(); eng.estimate(); }).not.toThrow();
    expect(eng.doItForMe().ok).toBe(false);
  });

  it('running out of money mid-lesson: funding top-up (tutorial mode) keeps the lesson doable; skip / loan exist otherwise', () => {
    const sim = tutorialSim();
    const eng = makeEngine(sim, { funding: true });
    eng.start({ fresh: true });
    runDoItBot(sim, eng, { ticksPerStep: 0, until: 'lift' });
    sim.game.money = -9000;
    expect(eng.estimate()).not.toBeNull();
    const r = eng.doItForMe();
    expect(r.ok, r.reason).toBe(true);
    expect(sim.game.money).toBeGreaterThanOrEqual(0);
  });
});
