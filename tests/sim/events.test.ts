import { describe, expect, it } from 'vitest';
import { EventCalendar, criticScore, type CalendarDeps } from '../../src/sim/events/EventCalendar';
import { EVENTS, FESTIVALS, FESTIVAL_BY_ID, BOOKABLE_FESTIVALS } from '../../src/config/festivals';
import { createSim } from '../../src/game/createSim';
import { Bot, runBot } from '../../src/game/bot';
import { applySave, collectSave, stateHash, SAVE_MODULES } from '../../src/game/saveState';
import { makeResort, run } from '../game/harness';
import { DAYS_PER_YEAR } from '../../src/config/balance';

interface Fx { cal: EventCalendar; d: { today: number; money: number; stars: number; lodge: boolean; black: boolean; powder: boolean; herd: boolean; level: string | null }; news: string[]; cheered: number[]; spent: number[] }
function mk(over: Partial<{ today: number; money: number; stars: number; auto: boolean }> = {}): Fx {
  const d = { today: over.today ?? 100, money: over.money ?? 100_000, stars: over.stars ?? 4, lodge: true, black: true, powder: false, herd: false, level: null as string | null };
  const news: string[] = [], cheered: number[] = [], spent: number[] = [];
  const deps: CalendarDeps = {
    today: () => d.today, funds: () => d.money, pay: (a) => { d.money -= a; spent.push(a); return true; }, refund: (a) => { d.money += a; spent.push(-a); },
    stars: () => d.stars, gate: () => d.level, hasLodge: () => d.lodge, hasBlackPiste: () => d.black, powder: () => d.powder, hasHerd: () => d.herd,
    critic: () => ({ stars: d.stars, happiness: 0.8, openShare: 1, incidents: 0 }), cheer: (a) => { cheered.push(a); }, news: (m) => { news.push(m); }, seed: 5, auto: over.auto ?? false,
  };
  return { cal: new EventCalendar(deps), d, news, cheered, spent };
}
const advance = (f: Fx, days: number): void => { for (let i = 0; i < days; i++) { f.d.today++; f.cal.newDay(); } };

describe('festivals config', () => {
  it('covers the planned set, each bookable one with a dressing spec and a cost', () => {
    for (const id of ['almabtrieb', 'christmasMarket', 'carnival', 'musicFestival', 'worldCup', 'newYear', 'critic', 'powder']) expect(FESTIVAL_BY_ID[id as keyof typeof FESTIVAL_BY_ID]).toBeTruthy();
    for (const f of BOOKABLE_FESTIVALS) { expect(f.dressing, f.id).toBeTruthy(); expect(f.cost).toBeGreaterThan(0); expect(f.arrivalMult).toBeGreaterThan(1); }
    for (const f of FESTIVALS.filter((x) => x.dressing)) { expect(f.dressing!.palette.length).toBeGreaterThan(0); expect(f.dressing!.bunting[1]).toBeGreaterThanOrEqual(f.dressing!.bunting[0]); }
    expect(FESTIVAL_BY_ID.worldCup.dressing!.grandstand).toBe(true);
    expect(FESTIVAL_BY_ID.carnival.dressing!.procession?.kind).toBe('costume');
    expect(FESTIVAL_BY_ID.almabtrieb.dressing!.procession?.kind).toBe('cow');
  });
});

describe('EventCalendar: prerequisites', () => {
  const winterStart = 155; // doy: inside the Christmas Market window
  it('needs lead time, the right season and window, a lodge, stars, cash and a black piste (World Cup)', () => {
    const f = mk({ today: 120 });
    expect(f.cal.blocker('christmasMarket', 121)).toMatch(/notice/);
    expect(f.cal.blocker('christmasMarket', winterStart)).toBeNull();
    expect(f.cal.blocker('christmasMarket', 50)).toMatch(/notice|Only in/);
    expect(f.cal.blocker('christmasMarket', 100 + 180)).toMatch(/Only in/); // summer
    expect(f.cal.blocker('christmasMarket', 140)).toMatch(/season/); // winter but before the start window
    f.d.lodge = false; expect(f.cal.blocker('christmasMarket', winterStart)).toMatch(/Lodge/); f.d.lodge = true;
    f.d.stars = 1; expect(f.cal.blocker('christmasMarket', winterStart)).toMatch(/stars/); f.d.stars = 4;
    f.d.money = 100; expect(f.cal.blocker('christmasMarket', winterStart)).toMatch(/cash/); f.d.money = 100_000;
    f.d.level = 'Reach level 4'; expect(f.cal.blocker('christmasMarket', winterStart)).toBe('Reach level 4'); f.d.level = null;
    f.d.today = 125;
    expect(f.cal.blocker('worldCup', 140)).toBeNull();
    f.d.black = false; expect(f.cal.blocker('worldCup', 140)).toMatch(/black piste/);
    expect(f.cal.blocker('powder', 140)).toMatch(/Not bookable/);
  });
  it('rejects overlapping bookings', () => {
    const f = mk({ today: 120 });
    expect(f.cal.book('christmasMarket', 155)).toBe(true);
    expect(f.cal.blocker('carnival', 140)).toBeNull(); // not overlapping 155..162
    expect(f.cal.blocker('worldCup', 158)).toMatch(/already booked/);
  });
  it('pays on booking, refunds 80% on cancel before it starts, not after', () => {
    const f = mk({ today: 120 });
    f.cal.book('christmasMarket', 155);
    expect(f.d.money).toBe(100_000 - 3_000);
    expect(f.cal.cancel('christmasMarket', 155)).toBe(true);
    expect(f.d.money).toBe(100_000 - 3_000 + 3_000 * EVENTS.refund);
    f.cal.book('christmasMarket', 155);
    f.d.today = 156;
    expect(f.cal.cancel('christmasMarket', 155)).toBe(false);
  });
});

describe('EventCalendar: payoff', () => {
  it('arrival multiplier + daily cheer while a festival runs, exactly neutral otherwise; the booking is removed afterwards', () => {
    const f = mk({ today: 120 });
    expect(f.cal.arrivalMult()).toBe(1);
    f.cal.book('christmasMarket', 155);
    advance(f, 34); // day 154
    expect(f.cal.arrivalMult()).toBe(1);
    advance(f, 1); // 155: begins
    expect(f.cal.arrivalMult()).toBe(FESTIVAL_BY_ID.christmasMarket.arrivalMult);
    expect(f.news.some((n) => /Christmas Market begins/.test(n))).toBe(true);
    expect(f.cal.active().map((e) => e.id)).toEqual(['christmasMarket']);
    expect(f.cheered.length).toBeGreaterThan(0);
    advance(f, 7); // day 162: last day
    expect(f.cal.active()[0]!.finale).toBe(true);
    advance(f, 1);
    expect(f.cal.active()).toEqual([]); expect(f.cal.arrivalMult()).toBe(1);
    expect(f.cal.booked).toEqual([]); expect(f.cal.history.christmasMarket).toBe(1);
  });
  it('fireworks are scheduled on the finale day only (booked) and on the eve (New Year)', () => {
    const f = mk({ today: 120, auto: true });
    f.cal.book('christmasMarket', 155);
    advance(f, 35); expect(f.cal.fireworksToday()).toBeNull(); // first day (155)
    advance(f, 7); expect(f.cal.fireworksToday()?.id).toBe('christmasMarket'); // last day (162)
    f.d.today = DAYS_PER_YEAR - 1; expect(f.cal.fireworksToday()?.id).toBe('newYear');
    f.d.today = DAYS_PER_YEAR; expect(f.cal.fireworksToday()).toBeNull(); // day 0: the show was last night
  });
});

describe('EventCalendar: automatic events', () => {
  it('off by default: no New Year, critic, powder or Almabtrieb', () => {
    const f = mk({ today: 170, auto: false }); f.d.powder = true; f.d.herd = true;
    advance(f, 40); f.cal.newHour();
    expect(f.cal.active()).toEqual([]); expect(f.news).toEqual([]); expect(f.cal.arrivalMult()).toBe(1);
  });
  it('critic: announced 3 days ahead, visits, scores the resort and a good review lifts arrivals for a while', () => {
    const f = mk({ today: 10, auto: true });
    advance(f, 1);
    const day = f.cal.nextCritic!;
    expect(day).toBeGreaterThanOrEqual(11 + EVENTS.criticFirst[0] - 1);
    expect(f.cal.upcoming().some((u) => u.id === 'critic')).toBe(false); // not announced yet
    f.d.today = day - 4; f.cal.newDay(); expect(f.news.some((n) => /critic will visit/.test(n))).toBe(false);
    f.d.today = day - 3; f.cal.newDay();
    expect(f.news.filter((n) => /critic will visit/.test(n)).length).toBe(1);
    expect(f.cal.upcoming().find((u) => u.id === 'critic')?.daysAway).toBe(3);
    f.d.today = day; f.cal.newDay();
    expect(f.cal.lastReview?.score).toBe(criticScore({ stars: 4, happiness: 0.8, openShare: 1, incidents: 0 }));
    expect(f.cal.lastReview!.score).toBeGreaterThanOrEqual(EVENTS.goodReview);
    expect(f.cal.arrivalMult()).toBe(EVENTS.goodMult);
    f.d.today = day + EVENTS.reviewDays; f.cal.newDay();
    expect(f.cal.arrivalMult()).toBe(1);
    expect(f.cal.nextCritic!).toBeGreaterThanOrEqual(day + EVENTS.criticGap[0]);
  });
  it('critic score: rating dominates, mood / open runs / incidents move it, half steps, clamped', () => {
    const base = { stars: 3, happiness: 0.6, openShare: 1, incidents: 0 };
    expect(criticScore(base) % 0.5).toBe(0);
    expect(criticScore({ ...base, stars: 5, happiness: 1 })).toBeGreaterThan(criticScore(base));
    expect(criticScore({ ...base, incidents: 1 })).toBeLessThan(criticScore(base));
    expect(criticScore({ ...base, openShare: 0 })).toBeLessThan(criticScore(base));
    expect(criticScore({ stars: 5, happiness: 1, openShare: 1, incidents: 0 })).toBe(5);
    expect(criticScore({ stars: 0, happiness: 0, openShare: 0, incidents: 1 })).toBe(0);
  });
  it('a bad review scares a few guests off', () => {
    const f = mk({ today: 10, auto: true, stars: 0.5 });
    advance(f, 1);
    f.d.today = f.cal.nextCritic!; f.cal.newDay();
    expect(f.cal.lastReview!.score).toBeLessThanOrEqual(EVENTS.badReview);
    expect(f.cal.arrivalMult()).toBe(EVENTS.badMult);
  });
  it('powder day: snowfall in winter, once per cooldown, +20% arrivals for that day only', () => {
    const f = mk({ today: 130, auto: true });
    f.cal.newHour(); expect(f.cal.active()).toEqual([]);
    f.d.powder = true; f.cal.newHour();
    expect(f.cal.active().map((e) => e.id)).toEqual(['powder']);
    expect(f.cal.arrivalMult()).toBe(FESTIVAL_BY_ID.powder.arrivalMult);
    expect(f.news.filter((n) => /Powder day/.test(n)).length).toBe(1);
    f.cal.newHour(); expect(f.news.filter((n) => /Powder day/.test(n)).length).toBe(1);
    advance(f, 1); f.cal.newHour(); expect(f.cal.active()).toEqual([]); // cooldown
    advance(f, EVENTS.powderCooldown); f.cal.newHour(); expect(f.cal.active().map((e) => e.id)).toEqual(['powder']);
    f.d.today = 60; f.cal.newHour(); // summer
  });
  it('Almabtrieb: runs for the autumn descent when cows exist (retrofit), derived from the livestock calendar', () => {
    const f = mk({ today: 100, auto: true });
    expect(f.cal.active().some((e) => e.id === 'almabtrieb')).toBe(false);
    f.d.herd = true;
    const days = Array.from({ length: DAYS_PER_YEAR }, (_, i) => i).filter((d) => { f.d.today = d; return f.cal.active().some((e) => e.id === 'almabtrieb'); });
    expect(days.length).toBeGreaterThanOrEqual(5);
    expect(days.every((d) => d >= 90 && d < 120)).toBe(true); // early autumn
    f.d.today = days[0]!; expect(f.cal.active().find((e) => e.id === 'almabtrieb')!.dayIndex).toBe(0);
    f.d.today = days.at(-1)!; expect(f.cal.active().find((e) => e.id === 'almabtrieb')!.finale).toBe(true);
  });
  it('New Year: the eve and day 0, with the show on the eve', () => {
    const f = mk({ today: DAYS_PER_YEAR - 1, auto: true });
    expect(f.cal.active().map((e) => e.id)).toContain('newYear');
    f.d.today = DAYS_PER_YEAR; expect(f.cal.active().map((e) => e.id)).toContain('newYear');
    f.d.today = DAYS_PER_YEAR + 1; expect(f.cal.active().map((e) => e.id)).not.toContain('newYear');
  });
});

describe('EventCalendar: save', () => {
  it('round-trips bookings, critic schedule and review', () => {
    const f = mk({ today: 120, auto: true });
    f.cal.book('christmasMarket', 155); advance(f, 1);
    f.d.today = f.cal.nextCritic!; f.cal.newDay();
    const g = mk({ today: f.d.today, auto: true });
    g.cal.load(JSON.parse(JSON.stringify(f.cal.serialize())));
    expect(JSON.stringify(g.cal.serialize())).toBe(JSON.stringify(f.cal.serialize()));
    g.cal.load(null); expect(g.cal.booked).toEqual([]);
  });
});

describe('events in the sim (createSim)', () => {
  it('is a registered save module and the default (no booking, auto off) leaves arrivals untouched', () => {
    expect(SAVE_MODULES.some((m) => m.key === 'events')).toBe(true);
    const { sim } = makeResort(64, 1, { startDay: 167 });
    expect(sim.events.arrivalMult()).toBe(1); expect(sim.events.auto).toBe(false);
  });

  it('a booked festival pays, runs, lifts the spawner attractiveness and is part of the save', () => {
    const { sim } = makeResort(64, 61, { startDay: 100 });
    sim.progression.unlockAll = true;
    run(sim, { days: 12 });
    const start = sim.events.nextStart('christmasMarket')!;
    sim.game.money = Math.max(sim.game.money, 50_000);
    expect(sim.events.blocker('christmasMarket', start)).toBeNull();
    const m0 = sim.game.money;
    expect(sim.events.book('christmasMarket', start)).toBe(true);
    expect(sim.game.money).toBe(m0 - FESTIVAL_BY_ID.christmasMarket.cost);
    expect(JSON.parse(JSON.stringify(collectSave(sim).events!.data)).booked.length).toBe(1);
    sim.game.date.day = start % DAYS_PER_YEAR; sim.game.date.year = Math.floor(start / DAYS_PER_YEAR);
    expect(sim.events.arrivalMult()).toBe(FESTIVAL_BY_ID.christmasMarket.arrivalMult);
    expect(sim.events.active().map((e) => e.id)).toEqual(['christmasMarket']);
  }, 60_000);

  it('a 365-day headless run with one festival is deterministic', () => {
    const go = (): string => {
      const sim = createSim({ size: 64, seed: 61, now: () => 0, autoEvents: true });
      const bot = new Bot(sim);
      let booked = false;
      runBot(sim, bot, 365, () => {
        if (booked) return;
        const day = sim.game.date.year * DAYS_PER_YEAR + sim.game.date.day;
        const s = sim.events.nextStart('musicFestival') ?? day;
        // force the prerequisites a fresh bot may miss, then book (deterministic either way)
        sim.progression.unlockAll = true;
        if (sim.events.blocker('musicFestival', s) === null) { sim.events.book('musicFestival', s); booked = true; }
      });
      const h = stateHash(sim);
      return `${booked}:${h.hash}:${sim.events.history.musicFestival ?? 0}:${sim.game.money}`;
    };
    const a = go(), b = go();
    expect(a).toBe(b);
    expect(a.startsWith('true:')).toBe(true); // the festival really was booked and ran
    expect(a.split(':')[2]).toBe('1');
  }, 120_000);

  it('save / load mid-festival gives the same state hash as the uninterrupted control run', () => {
    const make = (): ReturnType<typeof createSim> => { const { sim } = makeResort(64, 61, { startDay: 100 }); sim.events.setAuto(true); return sim; };
    const a = make(); run(a, { days: 3 });
    const b = createSim({ size: 64, seed: 61, now: () => 0, fromSave: collectSave(a), autoEvents: true });
    applySave(b, collectSave(a));
    expect(stateHash(b).parts.events).toBe(stateHash(a).parts.events);
  }, 60_000);
});
