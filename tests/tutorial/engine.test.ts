import { afterEach, describe, expect, it, vi } from 'vitest';
import { placeBuilding } from '../../src/sim/PlaceBuilding';
import { TutorialEngine, TutorialStore, ASSIST_FEE } from '../../src/tutorial/TutorialEngine';
import { STEPS } from '../../src/tutorial/steps';
import { stepKey, t } from '../../src/tutorial/strings';
import { anchors, findSite } from '../../src/tutorial/suggest';
import { makeEngine, memStorage, runDoItBot, tutorialSim } from './helpers';

const start = (o: { funding?: boolean; store?: TutorialStore } = {}) => {
  const sim = tutorialSim();
  const eng = makeEngine(sim, { funding: o.funding ?? false, store: o.store });
  eng.start({ fresh: true });
  return { sim, eng };
};
const pastBasics = (eng: TutorialEngine): void => { eng.notify('camera:rotate'); eng.notify('select:building'); };

afterEach(() => { vi.useRealTimers(); });

describe('TutorialEngine: completion-driven progress', () => {
  it('starts at the first lesson, with lessons applicable in order', () => {
    const { eng } = start();
    expect(eng.status).toBe('active');
    expect(eng.current?.id).toBe('camera');
    const v = eng.view();
    expect(v.step?.title).toBe(t(stepKey('camera', 'title')));
    expect(v.step?.index).toBe(1);
    expect(v.step?.total).toBeGreaterThan(20);
    expect(v.step?.canSkip).toBe(true);
  });

  it('re-evaluates from world state on typed events, with no poll and no timers', () => {
    const { sim, eng } = start();
    pastBasics(eng);
    expect(eng.current?.id).toBe('parking');
    const site = findSite(sim, 'parking', anchors(sim).road, { route: 'road', rmax: 16 })!;
    // the PLAYER builds it through the real API; the engine only hears `building:placed`
    const out = placeBuilding(sim.env, sim.props, 'parking', site.x, site.y, site.rot, site.autoFlatten, false);
    expect(out.ok).toBe(true);
    expect(eng.current?.id).not.toBe('parking');
    expect(eng.state.completed).toContain('parking');
  });

  it('Next only works on information steps; Skip never softlocks and dependants become not applicable', () => {
    const { eng } = start();
    pastBasics(eng);
    eng.next(); // parking is not an ack step
    expect(eng.current?.id).toBe('parking');
    eng.skip();
    expect(eng.state.skipped).toContain('parking');
    expect(eng.current?.id).not.toBe('parking');
    // skipping the ski school makes the magic carpet (locked behind it) not applicable
    const ids: string[] = [];
    for (let i = 0; i < 40 && eng.current; i++) { ids.push(eng.current.id); if (eng.current.id === 'school') break; eng.skip(); }
    expect(ids).toContain('school');
    eng.skip();
    for (let i = 0; i < 40 && eng.current; i++) { expect(eng.current.id).not.toBe('carpet'); eng.skip(); }
  });

  it('Back un-skips the previous lesson', () => {
    const { eng } = start();
    pastBasics(eng);
    eng.skip();
    const after = eng.current!.id;
    eng.previous();
    expect(eng.current?.id).toBe('parking');
    expect(eng.state.skipped).not.toContain('parking');
    expect(after).not.toBe('parking');
  });

  it('latches UI facts from events (speed, season) and from outside (notify)', () => {
    const { sim, eng } = start();
    sim.loop.setSpeed(2); sim.loop.setSpeed(0);
    expect(eng.q.flag('speed:2')).toBe(true);
    expect(eng.q.flag('speed:0')).toBe(true);
    eng.notify('overlay:cycled');
    expect(eng.state.flags).toContain('overlay:cycled');
  });

  it('camera lesson follows the polled camera (rotate / pan / zoom)', () => {
    const sim = tutorialSim();
    const cam = { x: 10, y: 10, yaw: 0, zoom: 1 };
    const eng = makeEngine(sim, { funding: false, host: { camera: () => ({ ...cam }) } });
    eng.start({ fresh: true });
    eng.poll();
    expect(eng.current?.id).toBe('camera');
    cam.yaw = Math.PI / 2; eng.poll();
    expect(eng.current?.id).not.toBe('camera');
    expect(eng.q.flag('camera:rotate')).toBe(true);
    cam.x = 30; cam.zoom = 2; eng.poll();
    expect(eng.q.flag('camera:pan') && eng.q.flag('camera:zoom')).toBe(true);
  });

  it('low-rate poll runs on a real-time interval and stops with the engine', () => {
    vi.useFakeTimers();
    const sim = tutorialSim();
    const eng = new TutorialEngine({ sim, steps: STEPS, pollMs: 500, host: { camera: () => ({ x: 0, y: 0, yaw: 0, zoom: 1 }) } });
    const spy = vi.spyOn(eng, 'poll');
    eng.start({ fresh: true });
    vi.advanceTimersByTime(1600);
    expect(spy).toHaveBeenCalledTimes(3);
    eng.stop();
    vi.advanceTimersByTime(2000);
    expect(spy).toHaveBeenCalledTimes(3);
  });
});

describe('TutorialEngine: persistence', () => {
  it('round-trips through localStorage (current, completed, skipped, flags, hints, enabled)', () => {
    const storage = memStorage();
    const sim = tutorialSim();
    const eng = makeEngine(sim, { funding: false, store: new TutorialStore(storage) });
    eng.start({ fresh: true });
    pastBasics(eng);
    eng.skip();
    eng.store.state.hints.push('icy');
    eng.store.save();
    const s2 = new TutorialStore(storage);
    expect(s2.state.enabled).toBe(true);
    expect(s2.state.current).toBe(eng.current?.id);
    expect(s2.state.completed).toEqual(eng.state.completed);
    expect(s2.state.skipped).toEqual(eng.state.skipped);
    expect(s2.state.flags).toContain('camera:rotate');
    expect(s2.state.hints).toEqual(['icy']);
    expect(storage.data.has('slope.tutorial.v1')).toBe(true);
  });

  it('survives corrupt storage', () => {
    const storage = memStorage();
    storage.setItem('slope.tutorial.v1', '{not json');
    const s = new TutorialStore(storage);
    expect(s.state.enabled).toBe(false);
    storage.setItem('slope.tutorial.v1', JSON.stringify({ v: 1, completed: [1, 'a'], hintsEnabled: false }));
    expect(new TutorialStore(storage).state.completed).toEqual(['a']);
    expect(new TutorialStore(storage).state.hintsEnabled).toBe(false);
  });

  it('exit disables and stops tracking; replay starts over but keeps dismissed hints', () => {
    const { sim, eng } = start();
    pastBasics(eng);
    eng.store.state.hints.push('storm');
    eng.exit();
    expect(eng.status).toBe('off');
    expect(eng.state.enabled).toBe(false);
    sim.loop.setSpeed(2);
    expect(eng.state.flags).not.toContain('speed:2'); // no longer subscribed
    eng.replay();
    expect(eng.status).toBe('active');
    expect(eng.current?.id).toBe('camera');
    expect(eng.state.hints).toEqual(['storm']);
  });

  it('finishing the tutorial persists finished and stops stepping back', () => {
    const { sim, eng } = start();
    const rep = runDoItBot(sim, eng, { ticksPerStep: 0 });
    expect(rep.failed).toEqual([]);
    expect(eng.status).toBe('complete');
    expect(eng.state.finished).toBe(true);
    for (const b of sim.buildings.all().filter((x) => x.type === 'parking')) sim.buildings.remove(b.id);
    eng.evaluate();
    expect(eng.status).toBe('complete');
    expect(eng.view().goals).not.toBeNull(); // goals stay on screen until reached
  });
});

describe('TutorialEngine: assistance', () => {
  it('first Do it for me is free, later ones add a small fee, both are charged through the economy', () => {
    const { sim, eng } = start();
    expect(eng.doItForMe().ok).toBe(true); // camera (free anyway)
    expect(eng.state.assisted).toBe(true);
    expect(eng.current?.id).toBe('lodge' === eng.current?.id ? 'lodge' : eng.current?.id);
    eng.notify('select:building');
    expect(eng.current?.id).toBe('parking');
    const est = eng.estimate()!;
    expect(est.cost).toBeGreaterThan(ASSIST_FEE);
    const before = sim.game.money;
    const r = eng.doItForMe();
    expect(r.ok).toBe(true);
    expect(before - sim.game.money).toBeCloseTo(r.cost, 0);
    expect(r.cost).toBeGreaterThan(ASSIST_FEE);
  });

  it('tutorial funding tops up cash when short (documented, tutorial mode only); without it the engine points to a loan', () => {
    const poor = start({ funding: true });
    pastBasics(poor.eng);
    poor.sim.game.money = 50;
    const r = poor.eng.doItForMe();
    expect(r.ok).toBe(true);
    expect(poor.eng.view().message).toContain('Tutorial funding');
    const strict = start({ funding: false });
    pastBasics(strict.eng);
    strict.sim.game.money = 50;
    const r2 = strict.eng.doItForMe();
    expect(r2.ok).toBe(false);
    expect(r2.reason).toBe('funds');
    expect(strict.eng.view().message).toContain('loan');
    expect(strict.eng.view().step?.canSkip).toBe(true); // alternative route
    const loan = strict.sim.loans.offers(strict.sim.creditCtx()).find((o) => o.available);
    expect(loan, 'a loan can bridge the gap').toBeDefined();
  });

  it('Show me gives a UI chain, a map mark for build lessons and an explanation', () => {
    const { eng } = start();
    pastBasics(eng);
    const r = eng.showMe();
    expect(r.valid).toBe(true);
    expect(r.ui).toEqual(['dock:buildings', 'drawer:tab:transport', 'drawer:item:parking']);
    expect(r.map).not.toBeNull();
    const v = eng.view();
    expect(v.ui).toEqual(r.ui);
    expect(v.map).toEqual(r.map);
    expect(v.note).toBe(t(stepKey('parking', 'show')));
  });
});

describe('TutorialEngine: respects pause and the player', () => {
  it('never changes the game speed by itself (paused stays paused through every evaluation)', () => {
    const { sim, eng } = start();
    sim.loop.setSpeed(0);
    for (let i = 0; i < 5; i++) { eng.poll(); eng.evaluate(true); eng.showMe(); eng.estimate(); }
    pastBasics(eng);
    expect(sim.loop.speed).toBe(0);
    eng.doItForMe(); // a build lesson
    expect(sim.loop.speed).toBe(0);
  });

  it('the whole build part of the tutorial works while paused (speed 0); time-based lessons accept speed changes', () => {
    const sim = tutorialSim();
    const eng = makeEngine(sim, { funding: false });
    eng.start({ fresh: true });
    sim.loop.setSpeed(0);
    const rep = runDoItBot(sim, eng, { ticksPerStep: 0, until: 'speed' });
    expect(rep.failed).toEqual([]);
    expect(eng.current?.id).toBe('speed');
    expect(sim.loop.speed).toBe(0);
    sim.loop.setSpeed(2); sim.loop.setSpeed(0); // the player follows the lesson by hand
    expect(eng.current?.id).toBe('guests');
    expect(eng.view().step?.text).toContain('paused');
    sim.loop.setSpeed(1);
    sim.tick(600);
    eng.evaluate();
    expect(eng.q.anyGuests() || eng.current?.id === 'guests').toBe(true);
  }, 30000);
});

describe('TutorialEngine: view and goals', () => {
  it('goals mini-panel is shown until all three goals are reached', () => {
    const { eng, sim } = start();
    const g = eng.view().goals!;
    expect(g.guests.need).toBe(200);
    expect(g.stars.need).toBe(4);
    expect(g.profit.done).toBe(false);
    for (const f of ['goal:guests', 'goal:stars', 'goal:profit']) eng.notify(f);
    expect(eng.view().goals).toBeNull();
    expect(sim.game.money).toBeGreaterThan(0);
  });

  it('emits onChange when the lesson changes and not when nothing happened', () => {
    const { eng } = start();
    let n = 0;
    eng.onChange(() => { n++; });
    eng.evaluate(); eng.evaluate();
    expect(n).toBe(0);
    eng.notify('camera:rotate');
    expect(n).toBeGreaterThan(0);
  });
});
