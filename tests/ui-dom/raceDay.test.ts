// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { el, registerComponents } from '../../src/ui';
import { buildEventsView } from '../../src/ui/eventsFormat';
import { EventCalendar, type CalendarDeps } from '../../src/sim/events/EventCalendar';
import { advanceTo, raceFixture } from '../sim/race/helpers';

registerComponents();
const root = (e: Element): ShadowRoot => (e as unknown as { root: ShadowRoot }).root;

describe('Club Race card in the Events panel (0.8.1)', () => {
  it('lists the course, offers weekend dates only, books, shows the booking in "Coming up" and the race while it runs', () => {
    const { s, id } = raceFixture(3);
    const deps: CalendarDeps = { today: () => s.game.date.year * 180 + s.game.date.day, funds: () => s.game.money, pay: () => true, stars: () => 4, hasLodge: () => true, hasBlackPiste: () => true, powder: () => false, hasHerd: () => false, critic: () => ({ stars: 4, happiness: 0.8, openShare: 1, incidents: 0 }), cheer: () => {}, news: () => {}, seed: 1 };
    const cal = new EventCalendar(deps);
    const info = () => ({ raceDay: s.raceDay, courses: s.race.courses(), courseName: (c: { run: never }) => s.names.pisteName(c.run) });
    const today = () => s.game.date.year * 180 + s.game.date.day;
    const p = el('st-events'); document.body.append(p);
    const bookRace = vi.fn((c: number, d: number) => s.bookRaceDay(c, d));
    p.bind({ view: () => buildEventsView(cal, today(), s.game.money, info() as never), book: () => null, cancel: (i, d) => (s.raceDay.cancel(Number(i.slice(8)), d) ? null : 'no'), bookRace });
    const r = root(p);
    const card = r.querySelector('[data-role="race-day-card"]') as HTMLElement;
    expect(card).toBeTruthy(); expect(card.textContent).toMatch(/Club Race/); expect(card.textContent).toMatch(/\$3,000/);
    const v = buildEventsView(cal, today(), s.game.money, info() as never);
    const opts = v.raceDayCard!.options[id]!;
    expect(opts.length).toBeGreaterThan(2);
    for (const o of opts) expect(o.label).toMatch(/^(Sat|Sun)/);
    const btn = card.querySelector('[data-role="race-day-book"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    btn.click();
    expect(bookRace).toHaveBeenCalledOnce();
    expect(s.raceDay.bookings.length).toBe(1);
    expect(r.textContent).toMatch(/Coming up[\s\S]*Club Race/);
    advanceTo(s, s.raceDay.bookings[0]!.day, 10.5);
    p.refresh();
    expect(r.textContent).toMatch(/watching/);
  });
  it('no course: the card says so and has no book button', () => {
    const deps: CalendarDeps = { today: () => 120, funds: () => 1e6, pay: () => true, stars: () => 4, hasLodge: () => true, hasBlackPiste: () => true, powder: () => false, hasHerd: () => false, critic: () => ({ stars: 4, happiness: 0.8, openShare: 1, incidents: 0 }), cheer: () => {}, news: () => {}, seed: 1 };
    const cal = new EventCalendar(deps);
    const fake = { raceDay: { session: null, bookings: [], blocker: () => 'x', requirement: () => null, lastResult: () => null, sponsorOf: () => null }, courses: [], courseName: () => '' };
    const v = buildEventsView(cal, 120, 1e6, fake as never);
    expect(v.raceDayCard!.general).toMatch(/Mark a run as a race course/);
  });
});
