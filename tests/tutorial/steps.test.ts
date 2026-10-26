import { describe, expect, it } from 'vitest';
import { bulldoze } from '../../src/build/Bulldoze';
import { demolishLift } from '../../src/sim/Lift';
import { Layer } from '../../src/world/Networks';
import { TutorialStore } from '../../src/tutorial/TutorialEngine';
import { STEPS } from '../../src/tutorial/steps';
import { stepKey, t } from '../../src/tutorial/strings';
import { makeEngine, memStorage, runDoItBot, tutorialSim } from './helpers';
import type { Sim } from '../../src/game/createSim';

const ids = STEPS.map((s) => s.id);
const idx = (id: string): number => ids.indexOf(id);
/** Steps whose predicate is a latched UI/event fact: no world state to pre-satisfy. */
const FLAG_STEPS = new Set(['guests', 'camera', 'select', 'overlay', 'speed', 'save', 'daynight', 'seasons', 'goals', 'finish']);

const UI_FLAGS: Record<string, string[]> = { camera: ['camera:rotate'], select: ['select:building'], overlay: ['overlay:cycled'], speed: ['speed:2', 'speed:0'], save: ['game:saved'], guests: ['guests:arrived'], daynight: ['ack:daynight'], seasons: ['ack:seasons'], goals: ['ack:goals'], finish: ['ack:finish'] };

const bot = (until: string, ticksPerStep = 0, store?: TutorialStore) => {
  const sim = tutorialSim();
  const eng = makeEngine(sim, { funding: false, store });
  eng.start({ fresh: true });
  const rep = runDoItBot(sim, eng, { until, ticksPerStep });
  return { sim, eng, rep };
};

describe('every lesson: completion predicate', () => {
  it('has the expected lessons in order', () => {
    expect(ids.slice(0, 8)).toEqual(['camera', 'lodge', 'select', 'parking', 'parkingRoad', 'footpath', 'ticket', 'lift']);
    expect(ids[ids.length - 1]).toBe('finish');
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const s of STEPS) {
    it(`${s.id}: false before, true after the step is done`, () => {
      const { eng } = bot(s.id);
      if (eng.current?.id !== s.id) {
        // already satisfied by the starting world / earlier lessons (auto-advance): the predicate must hold
        expect(s.isComplete(eng.q), `${s.id} should already be satisfied`).toBe(true);
        return;
      }
      expect(s.isComplete(eng.q)).toBe(false);
      if (s.ack) eng.next(); else { const r = eng.doItForMe(); expect(r.ok, r.reason).toBe(true); }
      expect(s.isComplete(eng.q)).toBe(true);
    });
  }
});

describe('every lesson: auto-advance past satisfied steps and persisted resume', () => {
  for (const s of STEPS.filter((x) => !x.ack)) {
    it(`${s.id}: a new engine on a world where it is done starts after it`, () => {
      const { sim, eng } = bot(s.id);
      if (eng.current?.id === s.id) { const r = eng.doItForMe(); expect(r.ok, r.reason).toBe(true); }
      const fresh = makeEngine(sim, { funding: false });
      fresh.start({ fresh: true });
      // the player already did the UI-only lessons that come before (camera, overlay, speed, …): only world facts differ
      for (const before of ids.slice(0, idx(s.id))) for (const f of UI_FLAGS[before] ?? []) fresh.notify(f);
      if (!FLAG_STEPS.has(s.id)) {
        expect(fresh.state.completed, `${s.id} auto-completed`).toContain(s.id);
        expect(fresh.current ? idx(fresh.current.id) : 999).toBeGreaterThan(idx(s.id));
      }
    });
  }

  for (const s of STEPS.slice(0, -1)) {
    it(`${s.id}: progress survives a reload (persisted state round-trip)`, () => {
      const storage = memStorage();
      const { sim, eng } = bot(s.id, 0, new TutorialStore(storage));
      const cur = eng.current?.id;
      const again = makeEngine(sim, { funding: false, store: new TutorialStore(storage) });
      again.start();
      expect(again.current?.id).toBe(cur);
      expect(again.state.completed).toEqual(eng.state.completed);
    });
  }
});

// ---------------------------------------------------------------- step-back

const removeAll = (sim: Sim, type: string): void => { for (const b of sim.buildings.all().filter((x) => x.type === type)) bulldoze(sim.buildings, sim.economy, b.id); };
const unbuildKind = (sim: Sim, kind: number): void => {
  const n = sim.networks;
  for (let y = 0; y < sim.size; y++) for (let x = 0; x < sim.size; x++) if (n.kindAt(x, y) === kind) n.unbuild(x, y);
};
const REMOVERS: Record<string, (sim: Sim) => void> = {
  lodge: (s) => removeAll(s, 'baseLodge'),
  parking: (s) => removeAll(s, 'parking'),
  parkingRoad: (s) => unbuildKind(s, 2),
  footpath: (s) => unbuildKind(s, 1),
  ticket: (s) => removeAll(s, 'ticketOffice'),
  lift: (s) => { for (const l of s.lifts.all()) demolishLift(s.lifts, s.economy, l.id); },
  piste: (s) => { const n = s.networks; for (let i = 0; i < n.layers.length; i++) if (n.layers[i]! & Layer.Ski) n.unpaint(Layer.Ski, i % s.size, (i / s.size) | 0); },
  school: (s) => removeAll(s, 'skiSchoolHQ'),
  carpet: (s) => removeAll(s, 'magicCarpet'),
  patrol: (s) => removeAll(s, 'patrolHub'),
  firstAid: (s) => removeAll(s, 'firstAid'),
  restaurant: (s) => { removeAll(s, 'lodge'); removeAll(s, 'mountainHut'); },
  rental: (s) => removeAll(s, 'rental'),
  groomer: (s) => removeAll(s, 'groomerGarage'),
  snowmaking: (s) => removeAll(s, 'snowCannon'),
};

describe('every structural lesson: stepping back when a prerequisite is deleted', () => {
  for (const [id, remove] of Object.entries(REMOVERS)) {
    it(`${id}: deleting it brings the tutorial back to that lesson with a gentle message`, () => {
      const { sim, eng } = bot('goals');
      expect(eng.current?.id).toBe('goals');
      remove(sim);
      eng.evaluate();
      const back = eng.current;
      expect(back, 'a step to go back to').not.toBeNull();
      expect(idx(back!.id)).toBeLessThanOrEqual(idx(id));
      if (back!.id === id) expect(eng.view().message).toContain(t(stepKey(id, 'title')));
      expect(eng.view().message).toContain(t(stepKey(back!.id, 'title')));
      // and the lesson can be finished again
      const r = eng.doItForMe();
      expect(r.ok, `${id} redo: ${r.reason}`).toBe(true);
    });
  }

  it('non-structural facts stay done (speed / price / loan are latched)', () => {
    const { sim, eng } = bot('goals');
    sim.priceApi.resetAll();
    sim.loop.setSpeed(1);
    eng.evaluate();
    expect(eng.current?.id).toBe('goals');
  });
});
