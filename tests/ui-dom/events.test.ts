// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { el, registerComponents } from '../../src/ui';
import { EventCalendar, type CalendarDeps } from '../../src/sim/events/EventCalendar';
import { buildEventsView, dayLabel, rangeLabel } from '../../src/ui/eventsFormat';

registerComponents();
const root = (e: Element): ShadowRoot => (e as unknown as { root: ShadowRoot }).root;

const cal = (today: number, money = 50_000): { c: EventCalendar; d: { money: number } } => {
  const d = { money };
  const deps: CalendarDeps = { today: () => today, funds: () => d.money, pay: (a) => { d.money -= a; return true; }, stars: () => 4, hasLodge: () => true, hasBlackPiste: () => false, powder: () => false, hasHerd: () => false, critic: () => ({ stars: 4, happiness: 0.8, openShare: 1, incidents: 0 }), cheer: () => {}, news: () => {}, seed: 1, auto: true };
  return { c: new EventCalendar(deps), d };
};

describe('events format', () => {
  it('labels days and ranges', () => {
    expect(dayLabel(0)).toBe('Apr 1'); expect(dayLabel(135)).toBe('Jan 1'); expect(dayLabel(180 + 14, 0)).toBe('Apr 15, year 1');
    expect(rangeLabel(135, 143)).toBe('Jan 1 – Jan 8'); expect(rangeLabel(10, 11)).toBe('Apr 11');
  });
  it('view lists upcoming bookings and one card per bookable festival with blockers', () => {
    const { c } = cal(120);
    c.book('christmasMarket', 125);
    const v = buildEventsView(c, 120, 50_000);
    expect(v.upcoming.some((u) => u.id === 'christmasMarket' && u.cancellable)).toBe(true);
    expect(v.cards.map((x) => x.def.id)).toEqual(['christmasMarket', 'carnival', 'musicFestival', 'mountainConcertSummer', 'mountainConcertWinter', 'worldCup']);
    expect(v.cards.find((x) => x.def.id === 'worldCup')!.general).toMatch(/black piste/);
  });
});

describe('st-events', () => {
  it('shows the calendar, books a festival and cancels it', () => {
    const { c } = cal(120);
    const p = el('st-events'); document.body.append(p);
    const book = vi.fn((id: string, start: number) => c.blocker(id as 'carnival', start) ?? (c.book(id as 'carnival', start) ? null : 'no'));
    const cancel = vi.fn((id: string, start: number) => (c.cancel(id as 'carnival', start) ? null : 'Cannot cancel'));
    p.bind({ view: () => buildEventsView(c, 120, 50_000), book, cancel });
    const r = root(p);
    expect(r.textContent).toMatch(/No festival this week/);
    expect(r.textContent).toMatch(/Winter Carnival/); expect(r.textContent).toMatch(/Needs: .*black piste/);
    const cards = [...r.querySelectorAll('.card')];
    expect(cards.length).toBe(6); // + Mountain Concert summer / winter (Task 41)
    expect(r.textContent).toMatch(/Mountain Concert/); expect(r.textContent).toMatch(/Snow Concert/); expect(r.textContent).toMatch(/gondola or cable car/);
    const xmas = cards.find((x) => /Christmas Market/.test(x.textContent ?? ''))!;
    (xmas.querySelector('button') as HTMLButtonElement).click();
    expect(book).toHaveBeenCalledOnce();
    expect(c.booked.length).toBe(1);
    expect(r.textContent).toMatch(/Coming up[\s\S]*Christmas Market/);
    const cancelBtn = [...r.querySelectorAll('button')].find((b) => b.textContent === 'Cancel') as HTMLButtonElement;
    cancelBtn.click();
    expect(c.booked.length).toBe(0);
    // a locked card disables its button
    const wc = [...r.querySelectorAll('.card')].find((x) => /World Cup/.test(x.textContent ?? ''))!;
    expect((wc.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('st-events: Mountain Concert (Task 41)', () => {
  const make = (gondola: boolean) => {
    const d = { money: 50_000 };
    const deps: CalendarDeps = { today: () => 120, funds: () => d.money, pay: (a) => { d.money -= a; return true; }, stars: () => 4, hasLodge: () => true, hasBlackPiste: () => false, hasGondola: () => gondola, powder: () => false, hasHerd: () => false, critic: () => ({ stars: 4, happiness: 0.8, openShare: 1, incidents: 0 }), cheer: () => {}, news: () => {}, seed: 1, auto: true };
    return new EventCalendar(deps);
  };
  it('lists both editions; without a gondola the reason + a Show me (Lifts drawer) shows, with one the next full date shows', () => {
    const c = make(false);
    const p = el('st-events'); document.body.append(p);
    const showMe = vi.fn();
    p.bind({ view: () => buildEventsView(c, 120, 50_000), book: () => null, cancel: () => null, showMe });
    const r = root(p);
    expect(r.textContent).toMatch(/Mountain Concert/); expect(r.textContent).toMatch(/Snow Concert/);
    expect(r.textContent).toMatch(/Starts Sep 1/); expect(r.textContent).toMatch(/Starts Mar 1/);
    expect(r.textContent).toMatch(/Needs a gondola or cable car/);
    const btn = [...r.querySelectorAll('button')].find((b) => b.textContent === 'Show me') as HTMLButtonElement;
    btn.click(); expect(showMe).toHaveBeenCalledWith('lifts', expect.stringMatching(/mountainConcert/));
    const c2 = make(true);
    p.bind({ view: () => buildEventsView(c2, 120, 50_000), book: () => null, cancel: () => null, showMe });
    expect(r.textContent).toMatch(/Next: .*Mar.*Winter/);
    p.remove();
  });
  it('a running concert has a Show me that goes to the stage', () => {
    const c = make(true);
    c.debugStart('mountainConcertWinter', 2);
    const p = el('st-events'); document.body.append(p);
    const showMe = vi.fn();
    p.bind({ view: () => buildEventsView(c, 120, 50_000), book: () => null, cancel: () => null, showMe });
    const r = root(p);
    expect(r.textContent).toMatch(/Snow Concert · day 1 of 2/);
    ([...r.querySelectorAll('.row button')].find((b) => b.textContent === 'Show me') as HTMLButtonElement).click();
    expect(showMe).toHaveBeenCalledWith('stage', 'mountainConcertWinter');
    p.remove();
  });
});
