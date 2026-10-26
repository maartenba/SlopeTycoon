import { describe, expect, it } from 'vitest';
import { isGated } from '../../src/config/unlocks';
import { STEPS } from '../../src/tutorial/steps';
import { makeEngine, runDoItBot, tutorialSim } from './helpers';

/** M5.3: the tutorial runs in Career (the default) with `unlockAll` for its whole duration, and never needs a gated item anyway. */
describe('tutorial in Career mode', () => {
  it('the scenario sim is Career at level 1: gated items are locked until the tutorial starts', () => {
    const sim = tutorialSim();
    expect(sim.progression.mode).toBe('career');
    expect(sim.progression.level).toBe(1);
    expect(sim.progression.locked('lift', 'cablecar')).not.toBeNull();
  });

  it('starting the tutorial sets unlockAll; finishing (all steps) or exiting restores the gate', () => {
    const sim = tutorialSim();
    const eng = makeEngine(sim, { funding: false });
    eng.start({ fresh: true });
    expect(sim.progression.unlockAll).toBe(true);
    expect(sim.progression.locked('building', 'helipad')).toBeNull();
    expect(sim.progression.level).toBe(1); // unlockAll never touches the level
    eng.exit();
    expect(sim.progression.unlockAll).toBe(false);
    expect(sim.progression.locked('building', 'helipad')).not.toBeNull();
    eng.start({ fresh: true });
    expect(sim.progression.unlockAll).toBe(true);
    eng.dispose();
    expect(sim.progression.unlockAll).toBe(false);
  });

  it("'Do it for me' completes EVERY step in Career, with the gate off while it runs and on again after; nothing it built is a gated item", () => {
    const sim = tutorialSim();
    const eng = makeEngine(sim, { funding: false });
    eng.start({ fresh: true });
    const rep = runDoItBot(sim, eng, { ticksPerStep: 0 });
    expect(rep.failed).toEqual([]);
    expect(eng.status).toBe('complete');
    expect(eng.state.completed.length).toBe(STEPS.length);
    expect(sim.progression.unlockAll).toBe(false); // lessons over
    for (const b of sim.buildings.all()) expect(isGated('building', b.type), b.type).toBe(false);
    for (const l of sim.lifts.all()) expect(isGated('lift', l.kind), l.kind).toBe(false);
    expect(sim.progression.locked('lift', 'cablecar')).not.toBeNull();
  }, 60000);
});
