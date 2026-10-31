import { describe, expect, it } from 'vitest';
import { EventCalendar, type CalendarDeps } from '../../src/sim/events/EventCalendar';
import { BOOKABLE_FESTIVALS, FESTIVAL_BY_ID } from '../../src/config/festivals';
import { DAYS_PER_YEAR } from '../../src/config/balance';
import { SEASON_OF_REAL_MONTH, monthNameOfDay, realMonthOfDay } from '../../src/sim/calendar';
import { applySave, collectSave, stateHash } from '../../src/game/saveState';
import { createSim } from '../../src/game/createSim';
import { buildEventsView } from '../../src/ui/eventsFormat';
import { makeResort, run } from '../game/harness';

/** Task 41 (D-P7): Mountain Concert, summer + winter editions, alongside the Summer Music Festival (docs/festivals.md). */
const SUMMER = FESTIVAL_BY_ID.mountainConcertSummer, WINTER = FESTIVAL_BY_ID.mountainConcertWinter, MUSIC = FESTIVAL_BY_ID.musicFestival;

function mk(over: { gondola?: boolean; level?: string | null; today?: number } = {}): { cal: EventCalendar; d: { gondola: boolean; level: string | null; today: number; money: number } } {
  const d = { gondola: over.gondola ?? true, level: over.level ?? null, today: over.today ?? 100, money: 100_000 };
  const deps: CalendarDeps = {
    today: () => d.today, funds: () => d.money, pay: (a) => { d.money -= a; return true; }, refund: (a) => { d.money += a; },
    stars: () => 4, gate: () => d.level, hasLodge: () => true, hasBlackPiste: () => true, hasGondola: () => d.gondola, powder: () => false, hasHerd: () => false,
    critic: () => ({ stars: 4, happiness: 0.8, openShare: 1, incidents: 0 }), cheer: () => {}, news: () => {}, seed: 5, auto: false,
  };
  return { cal: new EventCalendar(deps), d };
}

describe('Mountain Concert config (both editions, alongside the Summer Music Festival)', () => {
  it('two bookable rows with prerequisites, 1-2 days, an uplift and a cheer; the Summer Music Festival is still there', () => {
    expect(MUSIC.kind).toBe('booked');
    expect(BOOKABLE_FESTIVALS.map((f) => f.id)).toEqual(expect.arrayContaining(['musicFestival', 'mountainConcertSummer', 'mountainConcertWinter']));
    for (const f of [SUMMER, WINTER]) {
      expect(f.kind).toBe('booked'); expect(f.minLevel).toBe(3); expect(f.needs).toContain('gondola');
      expect(f.days).toBeGreaterThanOrEqual(1); expect(f.days).toBeLessThanOrEqual(2); expect(f.cost).toBeGreaterThan(0);
      expect(f.arrivalMult).toBeGreaterThan(1); expect(f.cheer).toBeGreaterThan(0); expect(f.leadDays).toBeGreaterThanOrEqual(3);
      expect(f.dressing?.stage).toBeTruthy(); expect(f.startWindow).toBeTruthy();
    }
    expect(SUMMER.dressing!.stage!.edition).toBe('summer'); expect(WINTER.dressing!.stage!.edition).toBe('winter');
  });

  it('the WINTER edition lands in March (a winter month of the real calendar), the SUMMER edition in a summer month', () => {
    const [w0, w1] = WINTER.startWindow!, [s0, s1] = SUMMER.startWindow!;
    for (let d = w0; d <= w1; d++) {
      expect(monthNameOfDay(d)).toBe('March');
      expect(SEASON_OF_REAL_MONTH[realMonthOfDay(d)], `winter start day ${d}`).toBe('winter');
    }
    for (let d = s0; d <= s1; d++) {
      expect(SEASON_OF_REAL_MONTH[realMonthOfDay(d)], `summer start day ${d}`).toBe('summer');
      expect(SEASON_OF_REAL_MONTH[realMonthOfDay(d + SUMMER.days - 1)], 'summer last day').toBe('summer');
    }
    expect(monthNameOfDay(s0)).toBe('September');
    // and the calendar agrees: the season gate accepts exactly those windows
    const f = mk({ today: 20 });
    expect(f.cal.blocker('mountainConcertWinter', w0)).toBeNull();
    expect(f.cal.blocker('mountainConcertSummer', s0)).toBeNull();
    expect(f.cal.blocker('mountainConcertWinter', s0)).toMatch(/Only in/);
    expect(f.cal.blocker('mountainConcertSummer', w0)).toMatch(/Only in/);
    expect(f.cal.blocker('mountainConcertSummer', s0 - 1)).toMatch(/season|Only in/);
  });

  it('the summer edition starts after the last day of the Summer Music Festival (no overlap, the earliest gap) and ends inside the summer', () => {
    const musicLast = MUSIC.startWindow![1] + MUSIC.days - 1; // latest possible last day of the festival
    expect(SUMMER.startWindow![0]).toBeGreaterThan(musicLast);
    expect(SUMMER.startWindow![0] - musicLast).toBeLessThanOrEqual(2); // directly after (Aug 15 free): a 30-day gap does not fit in summer (docs/festivals.md)
    const f = mk({ today: 20 });
    expect(f.cal.book('musicFestival', MUSIC.startWindow![1])).toBe(true);
    expect(f.cal.book('mountainConcertSummer', SUMMER.startWindow![0])).toBe(true);
  });
});

/** The starter resort shows < 3 stars on day 0: pin the rating so the stars check does not hide the gondola reason. */
const fourStars = (sim: { rating: object }): void => { Object.defineProperty(sim.rating, 'stars', { get: () => 4 }); };

describe('Mountain Concert prerequisites', () => {
  it('need a gondola or cable car, level 3 and cash; the reason is shown', () => {
    const f = mk({ today: 20 });
    const w = WINTER.startWindow![0];
    expect(f.cal.requirement('mountainConcertWinter')).toBeNull();
    f.d.gondola = false;
    expect(f.cal.requirement('mountainConcertWinter')).toBe('Needs a gondola or cable car');
    expect(f.cal.blocker('mountainConcertSummer', SUMMER.startWindow![0])).toBe('Needs a gondola or cable car');
    expect(f.cal.book('mountainConcertWinter', w)).toBe(false);
    f.d.gondola = true; f.d.level = 'Reach level 3';
    expect(f.cal.blocker('mountainConcertWinter', w)).toBe('Reach level 3');
    f.d.level = null; f.d.money = 100;
    expect(f.cal.blocker('mountainConcertWinter', w)).toMatch(/cash/);
  });

  it('createSim: no gondola = blocked; a gondola or a cable car unlocks it; a chairlift does not', () => {
    const { sim } = makeResort(64, 61, { startDay: 100 });
    sim.progression.unlockAll = true; fourStars(sim);
    sim.game.money = 200_000;
    const l = sim.lifts.all()[0]!, kind0 = l.kind;
    expect(sim.events.requirement('mountainConcertWinter')).toBe('Needs a gondola or cable car');
    for (const k of ['gondola6', 'gondola10', 'cablecar'] as const) { l.kind = k; expect(sim.events.requirement('mountainConcertSummer'), k).toBeNull(); }
    l.kind = 'chair6'; expect(sim.events.requirement('mountainConcertSummer')).not.toBeNull();
    l.kind = kind0;
  });

  it('the Events view lists both editions with a full date and the reason they are unmet', () => {
    const { sim } = makeResort(64, 61, { startDay: 100 });
    sim.progression.unlockAll = true; sim.game.money = 200_000; fourStars(sim);
    const today = sim.game.date.year * DAYS_PER_YEAR + sim.game.date.day;
    const v = buildEventsView(sim.events, today, sim.game.money);
    const sc = v.cards.find((c) => c.def.id === 'mountainConcertSummer')!, wc = v.cards.find((c) => c.def.id === 'mountainConcertWinter')!;
    expect(sc && wc).toBeTruthy();
    expect(wc.general).toBe('Needs a gondola or cable car');
    expect(wc.window).toMatch(/Mar/); expect(sc.window).toMatch(/Sep/);
    sim.lifts.all()[0]!.kind = 'gondola6';
    const v2 = buildEventsView(sim.events, today, sim.game.money);
    const w2 = v2.cards.find((c) => c.def.id === 'mountainConcertWinter')!, s2 = v2.cards.find((c) => c.def.id === 'mountainConcertSummer')!;
    expect(w2.general).toBeNull(); expect(w2.next).toMatch(/Mar/); expect(s2.next).toMatch(/Sep/);
  });
});

describe('both editions occur in the sim when booked', () => {
  const go = (): { hash: string; seen: string[]; history: string; money: number; mult: number[] } => {
    const { sim } = makeResort(64, 61, { startDay: 100 });
    sim.progression.unlockAll = true; sim.game.money = 500_000; fourStars(sim);
    sim.lifts.all()[0]!.kind = 'gondola6';
    expect(sim.events.auto).toBe(true);
    const sStart = sim.events.nextStart('mountainConcertSummer')!, wStart = sim.events.nextStart('mountainConcertWinter')!;
    expect(sim.events.book('mountainConcertSummer', sStart)).toBe(true);
    expect(sim.events.book('mountainConcertWinter', wStart)).toBe(true);
    const seen = new Set<string>(), mult: number[] = [];
    sim.bus.on('day:changed', () => { for (const e of sim.events.active()) if (e.id.startsWith('mountainConcert')) { seen.add(`${e.id}:${e.dayIndex}`); mult.push(sim.events.arrivalMult()); } });
    run(sim, { days: sStart - (sim.game.date.year * DAYS_PER_YEAR + sim.game.date.day) + 4 });
    return { hash: stateHash(sim).hash, seen: [...seen].sort(), history: JSON.stringify(sim.events.history), money: sim.game.money, mult };
  };
  it('winter (March) and summer (September) each run for their length, end, leave no booking and lift arrivals while on; deterministic', () => {
    const a = go();
    expect(a.seen).toEqual(['mountainConcertSummer:0', 'mountainConcertSummer:1', 'mountainConcertWinter:0', 'mountainConcertWinter:1']);
    expect(JSON.parse(a.history)).toEqual(expect.objectContaining({ mountainConcertSummer: 1, mountainConcertWinter: 1 }));
    expect(a.mult.every((m) => m >= 1.25 * 0.9)).toBe(true);
    const b = go();
    expect(b).toEqual(a);
  }, 300_000);

  it('save / load mid-concert keeps the events state hash', () => {
    const { sim } = makeResort(64, 61, { startDay: 100 });
    sim.progression.unlockAll = true; sim.game.money = 500_000; fourStars(sim); sim.lifts.all()[0]!.kind = 'gondola6';
    const start = sim.events.nextStart('mountainConcertWinter')!;
    expect(sim.events.book('mountainConcertWinter', start)).toBe(true);
    run(sim, { days: start - (sim.game.date.year * DAYS_PER_YEAR + sim.game.date.day) + 1 });
    expect(sim.events.active().some((e) => e.id === 'mountainConcertWinter')).toBe(true);
    const save = collectSave(sim);
    const b = createSim({ size: 64, seed: 61, now: () => 0, fromSave: save });
    applySave(b, save);
    expect(stateHash(b).parts.events).toBe(stateHash(sim).parts.events);
    expect(b.events.active().some((e) => e.id === 'mountainConcertWinter')).toBe(true);
  }, 120_000);
});
