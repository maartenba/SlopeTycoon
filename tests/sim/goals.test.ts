import { DAYS_PER_YEAR } from '@/config/balance';
import { describe, expect, it } from 'vitest';
import { CHAPTERS, GOALS, TOTAL_REWARDS, type GoalDef } from '../../src/config/goals';
import { ACTIVE_GOALS, Goals, emptyFacts, type GoalFacts, type GoalWorld } from '../../src/sim/goals/Goals';
import { EventBus } from '../../src/core/EventBus';
import type { GameEvents } from '../../src/core/events';
import { createSim } from '../../src/game/createSim';
import { Bot, runBot } from '../../src/game/bot';
import { stateHash } from '../../src/game/saveState';

type B = ReturnType<GoalWorld['buildings']>[number];
const bld = (type: string, active = true): B => ({ type, active, x: 10, y: 10, w: 3, h: 3 });

/** Mutable fixture world: tests flip fields to satisfy goals. */
class Fixture implements GoalWorld {
  b: B[] = []; l: Array<{ kind: string; open: boolean; x: number; y: number }> = []; p: Array<{ difficulty: number; tiles: number; x: number; y: number }> = [];
  trails = 0; star = 0; cash = 10_000; debtV = 0; granted = 0;
  buildings() { return this.b; }
  lifts() { return this.l; }
  pistes() { return this.p; }
  trailTiles() { return this.trails; }
  stars() { return this.star; }
  money() { return this.cash; }
  debt() { return this.debtV; }
  grant(a: number) { this.granted += a; this.cash += a; }
}
const piste = (difficulty: number, tiles = 20): { difficulty: number; tiles: number; x: number; y: number } => ({ difficulty, tiles, x: 5, y: 5 });

/** One mutation that satisfies each goal (fixture world + facts). */
const SATISFY: Record<string, (w: Fixture, f: GoalFacts) => void> = {
  firstLift: (w) => { w.l.push({ kind: 'chair2', open: true, x: 1, y: 1 }); },
  greenRun: (w) => { w.p.push(piste(1)); },
  patrol: (w) => { w.b.push(bld('patrolHub')); },
  guests30: (_w, f) => { f.bestDay = 30; },
  stars3: (w) => { w.star = 3; },
  mixedRuns: (w) => { w.p.push(piste(1), piste(2), piste(3)); },
  guests80: (_w, f) => { f.bestDay = 80; },
  profitMonth: (_w, f) => { f.profitMonths = 1; },
  skiSchool: (w) => { w.b.push(bld('skiSchoolHQ')); },
  groomed: (_w, f) => { f.groomedNights = 1; },
  stars4: (w) => { w.star = 4; },
  blackRun: (w) => { w.p.push(piste(4)); },
  rescue: (_w, f) => { f.rescues = 1; },
  debtFree: (w) => { w.debtV = 0; w.cash = 50_000; },
  guests200: (_w, f) => { f.bestDay = 200; },
  stars45: (w) => { w.star = 4.5; },
  summer: (w) => { w.b.push(bld('beach')); },
  liftKinds: (w) => { for (const k of ['tbar', 'chair4', 'gondola6']) w.l.push({ kind: k, open: false, x: 1, y: 1 }); },
  ranger: (w) => { w.b.push(bld('rangerStation')); },
  guests5000: (_w, f) => { f.lifetime = 5000; },
};

const engine = (w: Fixture): { goals: Goals; bus: EventBus<GameEvents>; events: Array<GameEvents['milestone']> } => {
  const bus = new EventBus<GameEvents>();
  const events: Array<GameEvents['milestone']> = [];
  bus.on('milestone', (e) => events.push(e));
  return { goals: new Goals(() => w, bus), bus, events };
};

describe('goal config', () => {
  it('is a chaptered chain of ~20 goals in four chapters with unique ids and career flavour', () => {
    expect(CHAPTERS.map((c) => c.title)).toEqual(['Season 1: Open for business', 'Local favourite', 'Regional name', 'Alpine destination']);
    expect(GOALS.length).toBe(20);
    expect(new Set(GOALS.map((g) => g.id)).size).toBe(GOALS.length);
    for (const c of CHAPTERS) { const n = GOALS.filter((g) => g.chapter === c.id).length; expect(n, c.id).toBeGreaterThanOrEqual(4); expect(n, c.id).toBeLessThanOrEqual(6); expect(c.outro.length).toBeGreaterThan(10); }
    for (const g of GOALS) {
      expect(CHAPTERS.some((c) => c.id === g.chapter), g.id).toBe(true);
      expect(g.title.length, g.id).toBeGreaterThan(3);
      expect(g.flavour.length, `${g.id} flavour is short`).toBeLessThanOrEqual(90);
      expect(g.todo.length, g.id).toBeGreaterThan(10);
      expect(g.reward, g.id).toBeGreaterThan(0);
    }
    // chapters are contiguous in chain order
    const order = GOALS.map((g) => g.chapter).filter((c, i, a) => a.indexOf(c) === i);
    expect(order).toEqual(CHAPTERS.map((c) => c.id));
    expect(TOTAL_REWARDS).toBeLessThan(80_000);
  });
  it('every goal has a satisfying fixture', () => { expect(Object.keys(SATISFY).sort()).toEqual(GOALS.map((g) => g.id).sort()); });
});

describe('each goal check (fixtures)', () => {
  const ctx = (w: Fixture, f: GoalFacts): Parameters<GoalDef['check']>[0] => ({ w, f });
  for (const g of GOALS) {
    it(`${g.id}: empty world < 1, satisfied world = 1, progress stays in 0..1`, () => {
      const w0 = new Fixture(); w0.cash = 0; const f0 = emptyFacts();
      const p0 = g.check(ctx(w0, f0));
      // the debt-free goal starts at half (no debt) but needs the cash too
      expect(p0, 'empty').toBeLessThan(1);
      expect(p0).toBeGreaterThanOrEqual(0);
      const w1 = new Fixture(), f1 = emptyFacts();
      SATISFY[g.id]!(w1, f1);
      expect(g.check(ctx(w1, f1)), 'satisfied').toBeGreaterThanOrEqual(1);
    });
  }
  it('partial progress reads sensibly', () => {
    const w = new Fixture(), f = emptyFacts();
    f.bestDay = 15; expect(GOALS.find((g) => g.id === 'guests30')!.check({ w, f })).toBeCloseTo(0.5);
    w.l.push({ kind: 'chair2', open: false, x: 0, y: 0 }); expect(GOALS.find((g) => g.id === 'firstLift')!.check({ w, f })).toBe(0.5);
    w.p.push(piste(1), piste(2, 4)); expect(GOALS.find((g) => g.id === 'mixedRuns')!.check({ w, f })).toBeCloseTo((1 + 0.8 + 0) / 3);
    w.debtV = 1000; w.cash = 25_000; expect(GOALS.find((g) => g.id === 'debtFree')!.check({ w, f })).toBeCloseTo(0.25);
    w.b.push(bld('groomerGarage')); expect(GOALS.find((g) => g.id === 'groomed')!.check({ w, f })).toBe(0.5);
  });
  it('inactive buildings do not count', () => {
    const w = new Fixture(), f = emptyFacts(); w.b.push(bld('patrolHub', false));
    expect(GOALS.find((g) => g.id === 'patrol')!.check({ w, f })).toBe(0);
  });
  it('"Show me" has a target once something exists, and falls back gracefully', () => {
    const w = new Fixture(), { goals } = engine(w);
    expect(goals.focusOf('patrol')).toBeNull();
    w.b.push(bld('patrolHub')); expect(goals.focusOf('patrol')).toEqual({ x: 11, y: 11 });
    w.l.push({ kind: 'tbar', open: true, x: 7, y: 8 }); expect(goals.focusOf('firstLift')).toEqual({ x: 7, y: 8 });
    expect(goals.focusOf('nope')).toBeNull();
  });
});

describe('chain order, unlocking, rewards and events', () => {
  it('shows up to three goals of the current chapter; later chapters unlock only when the chapter is complete', () => {
    const w = new Fixture(), { goals, events } = engine(w);
    expect(goals.active().map((g) => g.id)).toEqual(['firstLift', 'greenRun', 'patrol']);
    expect(goals.active().length).toBeLessThanOrEqual(ACTIVE_GOALS);
    goals.evaluate();
    expect(events.length).toBe(0);
    // satisfy a goal from chapter 2 early: it must not complete while chapter 1 is open
    w.star = 3; goals.evaluate();
    expect(goals.isDone('stars3')).toBe(false);
    expect(goals.active().every((g) => g.chapter === 's1')).toBe(true);
  });

  it('completing goals pays a grant, emits quiet milestones, then a major milestone with the career line at chapter end', () => {
    const w = new Fixture(), f = (): GoalFacts => goalsRef.facts, { goals, events } = engine(w);
    const goalsRef = goals;
    SATISFY.firstLift!(w, f()); goals.evaluate();
    expect(goals.isDone('firstLift')).toBe(true);
    expect(w.granted).toBe(GOALS.find((g) => g.id === 'firstLift')!.reward);
    expect(events.map((e) => [e.id, e.major])).toEqual([['goal:firstLift', false]]);
    expect(events[0]!.title).toContain('first lift');
    expect(goals.active().map((g) => g.id)).toEqual(['greenRun', 'patrol', 'guests30']);
    for (const id of ['greenRun', 'patrol', 'guests30']) SATISFY[id]!(w, f());
    goals.evaluate();
    const ch1 = events.filter((e) => e.id.startsWith('chapter:'));
    expect(ch1.length).toBe(1);
    expect(ch1[0]).toMatchObject({ id: 'chapter:s1', major: true });
    expect(ch1[0]!.title).toContain('Season 1: Open for business complete');
    expect(events.filter((e) => e.major).length).toBe(1);
    expect(events.filter((e) => !e.major).length).toBe(4);
    expect(goals.chapterDone('s1')).toBe(true);
    expect(goals.active().every((g) => g.chapter === 'local')).toBe(true);
  });

  it('cascades within one evaluation when later goals are already satisfied, and the whole chain can finish', () => {
    const w = new Fixture(), { goals, events } = engine(w);
    for (const g of GOALS) SATISFY[g.id]!(w, goals.facts);
    goals.evaluate();
    expect(goals.finished).toBe(true);
    expect(goals.completedCount).toBe(GOALS.length);
    expect(events.filter((e) => e.major).map((e) => e.id)).toEqual(CHAPTERS.map((c) => `chapter:${c.id}`));
    expect(goals.granted).toBe(TOTAL_REWARDS);
    expect(goals.view().finished).toBe(true);
    expect(goals.view().chapter).toBeNull();
    expect(goals.view().active).toEqual([]);
    const before = events.length; goals.evaluate(); expect(events.length).toBe(before); // nothing is paid twice
  });

  it('is evaluated hourly off time:hour, and not while paused (tutorial)', () => {
    const w = new Fixture(), { goals, bus } = engine(w);
    SATISFY.firstLift!(w, goals.facts);
    goals.paused = true; bus.emit('time:hour', { hour: 5 });
    expect(goals.isDone('firstLift')).toBe(false); expect(w.granted).toBe(0);
    goals.paused = false; bus.emit('time:hour', { hour: 6 });
    expect(goals.isDone('firstLift')).toBe(true);
  });

  it('facts are latched from events (arrivals per day, grooming nights, rescues, profitable months)', () => {
    const w = new Fixture(), { goals, bus } = engine(w);
    for (let i = 0; i < 5; i++) bus.emit('guest:arrived', { id: i });
    expect(goals.facts).toMatchObject({ arrivalsToday: 5, bestDay: 5, lifetime: 5 });
    bus.emit('day:changed', { year: 1, day: 3 });
    for (let i = 0; i < 2; i++) bus.emit('guest:arrived', { id: i });
    expect(goals.facts).toMatchObject({ arrivalsToday: 2, bestDay: 5, lifetime: 7 });
    bus.emit('ops:grooming', { vehicles: 0, tiles: 0 }); expect(goals.facts.groomedNights).toBe(0);
    bus.emit('ops:grooming', { vehicles: 2, tiles: 40 }); expect(goals.facts.groomedNights).toBe(1);
    bus.emit('incident:resolved', { id: 1, responder: 'patrol', responseTicks: 5, outcome: 'hospitalised', severe: true }); expect(goals.facts.rescues).toBe(0);
    bus.emit('incident:resolved', { id: 2, responder: 'patrol', responseTicks: 5, outcome: 'recovered' }); expect(goals.facts.rescues).toBe(1);
    bus.emit('finance:monthClosed', { year: 1, month: 1, net: -5, income: 1, expense: 6 }); expect(goals.facts.profitMonths).toBe(0);
    bus.emit('finance:monthClosed', { year: 1, month: 2, net: 5, income: 6, expense: 1 }); expect(goals.facts.profitMonths).toBe(1);
  });

  it('silent sync completes satisfied goals without grants, events or chapter fanfare', () => {
    const w = new Fixture(), { goals, events } = engine(w);
    for (const id of ['firstLift', 'greenRun', 'patrol']) SATISFY[id]!(w, goals.facts);
    w.star = 3;
    goals.silentSync();
    expect(goals.isDone('firstLift') && goals.isDone('greenRun') && goals.isDone('patrol')).toBe(true);
    expect(goals.isDone('stars3')).toBe(false); // chapter 1 still open (guests30 missing)
    expect(events).toEqual([]); expect(w.granted).toBe(0); expect(goals.granted).toBe(0);
    SATISFY.guests30!(w, goals.facts); goals.silentSync();
    expect(goals.chapterDone('s1')).toBe(true); expect(goals.isDone('stars3')).toBe(true);
    expect(events).toEqual([]);
  });
});

describe('goals + the real sim (starter resort + bot)', () => {
  const play = (days: number, size: 64 | 128 = 128): { sim: ReturnType<typeof createSim>; log: string[]; bot: Bot } => {
    const sim = createSim({ size, seed: 61, now: () => 0 });
    const bot = new Bot(sim, {});
    const log: string[] = [];
    sim.bus.on('milestone', (e) => log.push(`${sim.game.date.day}:${e.id}:${e.major}`));
    runBot(sim, bot, days);
    return { sim, log, bot };
  };

  it('60 in-game days complete >= 5 goals, deterministically (same log + same state hash)', () => {
    const a = play(60), b = play(60);
    expect(a.sim.goals.completedCount).toBeGreaterThanOrEqual(5);
    expect(a.log).toEqual(b.log);
    expect(stateHash(a.sim).hash).toBe(stateHash(b.sim).hash);
    expect(stateHash(a.sim).parts.goals).toBe(stateHash(b.sim).parts.goals);
    expect(a.sim.economy.ledger.grant).toBe(a.sim.goals.granted);
    expect(a.sim.goals.granted).toBeGreaterThan(0);
    console.log(`[goals] 60 days (128 map): ${a.sim.goals.completedCount} goals, granted $${a.sim.goals.granted}: ${a.log.join(' ')}`);
  }, 240_000);

  it('grants stay under 10 % of year-1 revenue (bot, 64 map, one year)', () => {
    const { sim, bot } = play(DAYS_PER_YEAR, 64);
    const rev = bot.rows.filter((r) => r.year === 1).reduce((s, r) => s + r.incomeTotal, 0);
    const grants = sim.economy.ledger.grant;
    console.log(`[goals] year 1 (64 map): grants $${grants} of revenue $${Math.round(rev)} = ${(100 * grants / rev).toFixed(1)} %`);
    expect(grants).toBeGreaterThan(0);
    expect(grants).toBeLessThan(0.1 * rev);
  }, 240_000);
});
