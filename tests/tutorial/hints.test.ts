import { DAYS_PER_YEAR } from '@/config/balance';
import { describe, expect, it } from 'vitest';
import { HINTS, HintEngine, type HintDelivery } from '../../src/tutorial/hints';
import { TutorialStore } from '../../src/tutorial/TutorialEngine';
import { hintKey, t } from '../../src/tutorial/strings';
import { placeBuilding } from '../../src/sim/PlaceBuilding';
import { anchors, findSite } from '../../src/tutorial/suggest';
import { memStorage, tutorialSim } from './helpers';

const setup = (storage = memStorage(), gap?: number) => {
  const sim = tutorialSim();
  const store = new TutorialStore(storage);
  const got: HintDelivery[] = [];
  const hints = new HintEngine({ sim, store, deliver: (h) => got.push(h), minGapDays: gap });
  hints.start();
  return { sim, store, got, hints, storage };
};
const nextDay = (sim: ReturnType<typeof tutorialSim>, n = 1): void => { for (let i = 0; i < n; i++) { sim.game.date.day = (sim.game.date.day + 1) % DAYS_PER_YEAR; sim.bus.emit('day:changed', { year: sim.game.date.year, day: sim.game.date.day }); } };

describe('contextual one-shot hints', () => {
  it('every hint has a string and an event; ids are unique', () => {
    expect(new Set(HINTS.map((h) => h.id)).size).toBe(HINTS.length);
    expect(HINTS.length).toBeGreaterThanOrEqual(12);
    for (const h of HINTS) expect(t(hintKey(h.id)), h.id).not.toBe(hintKey(h.id));
  });

  it('delivers each hint once on its first occurrence, through the typed events', () => {
    const { sim, got } = setup();
    sim.bus.emit('incident:avalanche', { x: 3, y: 3, severity: 1 });
    expect(got.map((g) => g.id)).toEqual(['avalanche']);
    expect(got[0]!.tier).toBe('important');
    nextDay(sim, 3);
    sim.bus.emit('incident:avalanche', { x: 4, y: 3, severity: 1 });
    expect(got.length).toBe(1); // one-shot
  });

  it('at most one hint per ~2 in-game days; waiting hints are queued, important first', () => {
    const { sim, got } = setup();
    sim.bus.emit('incident:wildlife', { x: 1, y: 1, kind: 'x' }); // info, delivered
    sim.bus.emit('lift:broken', { id: 1, kind: 'chair4', stranded: 0 }); // important but too soon
    sim.bus.emit('finance:debtWarning', { money: -5, negDays: 1, level: 1 });
    expect(got.map((g) => g.id)).toEqual(['wildlife']);
    nextDay(sim, 1);
    expect(got.length).toBe(1);
    nextDay(sim, 1);
    expect(got.map((g) => g.id)).toEqual(['wildlife', 'debt']); // debt precedes liftBreakdown in priority order
    nextDay(sim, 2);
    expect(got.map((g) => g.id)).toEqual(['wildlife', 'debt', 'liftBreakdown']);
  });

  it('can be disabled (setting) and re-enabled; disabled hints are not queued', () => {
    const { sim, got, hints } = setup();
    hints.setEnabled(false);
    sim.bus.emit('incident:avalanche', { x: 3, y: 3, severity: 1 });
    nextDay(sim, 5);
    expect(got.length).toBe(0);
    hints.setEnabled(true);
    sim.bus.emit('weather:changed', { kind: 'storm', previous: 'clear', temperature: 0, snowline: 5, precipitation: 'snow' });
    expect(got.map((g) => g.id)).toEqual(['storm']);
  });

  it('persists the dismissed set and the enabled flag', () => {
    const a = setup();
    a.sim.bus.emit('incident:wildlife', { x: 1, y: 1, kind: 'x' });
    a.hints.setEnabled(false);
    const b = setup(a.storage);
    expect(b.store.state.hints).toEqual(['wildlife']);
    expect(b.hints.enabled).toBe(false);
    b.hints.setEnabled(true);
    b.sim.bus.emit('incident:wildlife', { x: 1, y: 1, kind: 'x' });
    expect(b.got.length).toBe(0); // already seen in an earlier session
  });

  it('season hints: winter is coming (autumn), winter, spring, summer', () => {
    const { sim, got } = setup(memStorage(), 0);
    for (const s of ['autumn', 'winter', 'spring', 'summer'] as const) sim.bus.emit('season:changed', { season: s, previous: 'winter' });
    nextDay(sim); // the farm hint waits for the next day (one hint per flush)
    expect(got.map((g) => g.id)).toEqual(['season.autumn', 'season.winter', 'season.spring', 'season.summer', 'summer.farm']);
    expect(got[0]!.text).toContain('Winter is coming');
    expect(got[4]!.text).toContain('Alpine Farm');
  });

  it('summer farm hint: once in summer without a farm, never with one', () => {
    const a = setup(memStorage(), 0);
    a.sim.bus.emit('season:changed', { season: 'spring', previous: 'winter' });
    expect(a.got.map((g) => g.id)).toEqual(['season.spring']); // not before summer
    a.sim.bus.emit('season:changed', { season: 'summer', previous: 'spring' });
    nextDay(a.sim);
    expect(a.got.map((g) => g.id)).toEqual(['season.spring', 'season.summer', 'summer.farm']);
    a.sim.bus.emit('season:changed', { season: 'summer', previous: 'spring' });
    expect(a.got.length).toBe(3); // one-shot
    const b = setup(memStorage(), 0);
    const site = findSite(b.sim, 'alpineFarm', anchors(b.sim).road, { route: 'road', rmax: 22 })!;
    expect(placeBuilding(b.sim.env, b.sim.props, 'alpineFarm', site.x, site.y, site.rot, site.autoFlatten, false).ok).toBe(true);
    b.sim.bus.emit('season:changed', { season: 'summer', previous: 'spring' });
    nextDay(b.sim, 3);
    expect(b.got.map((g) => g.id)).toEqual(['season.summer']);
    const c = setup(memStorage(), 0);
    c.hints.setEnabled(false);
    c.sim.bus.emit('season:changed', { season: 'summer', previous: 'spring' });
    expect(c.got.length).toBe(0); // respects the Hints setting
  });

  it('first guest with no rental / family without ski school / injury without patrol / low rating / queue / icy piste', () => {
    const { sim, got } = setup(memStorage(), 0);
    sim.bus.emit('guest:arrived', { id: 99 }); // not alive: noSchool stays quiet, noRental fires (there is no rental shop)
    expect(got.map((g) => g.id)).toEqual(['noRental']);
    sim.bus.emit('incident:injury', { guestId: 1, x: 1, y: 1 });
    sim.bus.emit('rating:changed', { stars: 1.5, previous: 3, reason: 'x' });
    expect(got.map((g) => g.id)).toEqual(['noRental', 'injury', 'lowRating']);
    // rental exists => the rental hint is not repeated in a fresh engine; a patrol hub silences the injury hint
    const s2 = setup(memStorage(), 0);
    const site = findSite(s2.sim, 'rental', anchors(s2.sim).road, { route: 'road', rmax: 18 })!;
    expect(placeBuilding(s2.sim.env, s2.sim.props, 'rental', site.x, site.y, site.rot, site.autoFlatten, false).ok).toBe(true);
    s2.sim.bus.emit('guest:arrived', { id: 99 });
    expect(s2.got.length).toBe(0);
    // queue: a lift with a long queue
    const s3 = setup(memStorage(), 0);
    s3.sim.bus.emit('time:hour', { hour: 10 });
    expect(s3.got.length).toBe(0);
  });

  it('works for players who never started the tutorial (no engine needed)', () => {
    const { sim, got } = setup();
    sim.bus.emit('lift:broken', { id: 1, kind: 'chair4', stranded: 2 });
    expect(got[0]!.text).toContain('broke down');
  });
});
