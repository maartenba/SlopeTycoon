import { describe, expect, it } from 'vitest';
import { bestCategory, formatIssues, formatMonthCard, formatRecap, monthName, moneyDelta, ratingDelta, type RecapInput } from '../../src/ui/recap';

const base = (o: Partial<RecapInput> = {}): RecapInput => ({
  date: { year: 2, day: 47 }, season: 'winter', cash: 52_340, stars: 3.5,
  monthStartMoney: 48_000, monthStartStars: 3,
  last: { year: 2, month: 2, net: 4_300, income: 12_000, expense: 7_700, guests: 41, ratingDelta: 0.5 },
  goals: [{ title: 'reach a 3-star rating', progress: 0.5 }, { title: 'Welcome 80 guests in a day', progress: 0.25 }, { title: 'third', progress: 0 }],
  advice: [{ title: 'build a first aid post' }, { title: 'Open the lift' }, { title: 'third' }],
  issues: { openIncidents: 0, closedLifts: 0, brokenLifts: 0, closedPistes: 0, lowCash: false },
  ...o,
});

describe('recap formatting', () => {
  it('month names, money and rating deltas', () => {
    expect(monthName(0)).toBe('April'); expect(monthName(13)).toBe('May'); expect(monthName(9)).toBe('January');
    expect(moneyDelta(1200)).toBe('+$1,200'); expect(moneyDelta(-300)).toBe('-$300'); expect(moneyDelta(0.2)).toBe('$0');
    expect(ratingDelta(0.5)).toEqual({ text: 'Up half a star', tone: 'good' });
    expect(ratingDelta(-1)).toEqual({ text: 'Down 1 star', tone: 'bad' });
    expect(ratingDelta(1.5).text).toBe('Up 1.5 stars');
    expect(ratingDelta(0.1)).toEqual({ text: 'Steady', tone: 'neutral' });
  });
  it('formatRecap: date, cash, trend, change, last month, top 2 goals / advice, capitalised', () => {
    const m = formatRecap(base());
    expect(m.title).toBe('Welcome back');
    expect(m.subtitle).toBe('Winter · July, year 2');
    expect(m.cash).toBe('$52,340');
    expect(m.trend).toEqual({ text: 'Up half a star', tone: 'good' });
    expect(m.change).toEqual({ text: '+$4,340 this month', tone: 'good' });
    expect(m.lastMonth).toEqual({ text: 'June: +$4,300 net', tone: 'good' });
    expect(m.goals).toEqual([{ text: 'Reach a 3-star rating', pct: 50 }, { text: 'Welcome 80 guests in a day', pct: 25 }]);
    expect(m.advice).toEqual(['Build a first aid post', 'Open the lift']);
    expect(m.issues).toEqual([]); expect(m.reduced).toBe(false);
  });
  it('old save without sessionMeta: reduced recap (no trend / change / last month), still has cash, goals and advice', () => {
    const m = formatRecap(base({ monthStartMoney: undefined, monthStartStars: undefined, last: null }));
    expect(m.reduced).toBe(true); expect(m.trend).toBeNull(); expect(m.change).toBeNull(); expect(m.lastMonth).toBeNull();
    expect(m.cash).toBe('$52,340'); expect(m.goals.length).toBe(2); expect(m.advice.length).toBe(2);
  });
  it('issues: plural, broken lifts are not double counted as closed, low cash', () => {
    expect(formatIssues({ openIncidents: 2, closedLifts: 3, brokenLifts: 1, closedPistes: 1, lowCash: true })).toEqual([
      '1 lift is broken down', '2 incidents are still open', '2 lifts are closed', '1 piste is closed', 'Cash is running low']);
    expect(formatIssues({ openIncidents: 1, closedLifts: 0, brokenLifts: 0, closedPistes: 0, lowCash: false })).toEqual(['1 incident is still open']);
  });
  it('no raw ids / undefined / NaN in any string; every line starts uppercase', () => {
    const m = formatRecap(base({ issues: { openIncidents: 1, closedLifts: 2, brokenLifts: 1, closedPistes: 2, lowCash: true } }));
    const all = [m.title, m.subtitle, m.cash, m.trend!.text, m.change!.text, m.lastMonth!.text, ...m.goals.map((g) => g.text), ...m.advice, ...m.issues];
    for (const s of all) { expect(s).not.toMatch(/undefined|NaN|[a-z]+[A-Z][a-z]+_|_/); expect(s[0]).toBe(s[0]!.toUpperCase()); }
  });
});

describe('month card formatting', () => {
  const r = { year: 1, month: 11, incomeTotal: 20_000, expenseTotal: 25_500, net: -5_500, guests: 1, income: { lifts: 9000, passes: 4000, shops: 7000, grant: 99_999, other: 50_000 } };
  it('title, totals, tone, guests, rating delta and the best earner (grants and other never win)', () => {
    const m = formatMonthCard(r, -0.5);
    expect(m.title).toBe('March closed');
    expect(m.income.text).toBe('$20,000'); expect(m.expense.text).toBe('$25,500');
    expect(m.net).toEqual({ label: 'Net', text: '-$5,500', tone: 'bad' });
    expect(m.guests).toBe('1 guest in the resort');
    expect(m.rating).toEqual({ text: 'Down half a star', tone: 'bad' });
    expect(m.highlight).toBe('Best earner: Lift tickets ($9,000)');
  });
  it('positive net is good; no rating info -> null; no income -> a plain line', () => {
    expect(formatMonthCard({ ...r, net: 10 }).net.tone).toBe('good');
    expect(formatMonthCard(r).rating).toBeNull();
    expect(formatMonthCard({ ...r, income: {}, net: 0 }).highlight).toBe('A quiet month');
    expect(bestCategory({ lessons: 5, rental: 7 })).toEqual({ label: 'Rentals', amount: 7 });
  });
});

import { EventBus } from '../../src/core/EventBus';
import type { GameEvents } from '../../src/core/events';
import { wireMonthCard } from '../../src/ui/recap';
import { ToastLimiter } from '../../src/ui/toastLimiter';

describe('wireMonthCard', () => {
  const report = { year: 1, month: 4, incomeTotal: 10, expenseTotal: 4, net: 6, guests: 3, income: { lifts: 10 } };
  const mk = (enabled: () => boolean, rep: typeof report | undefined = report) => {
    const bus = new EventBus<GameEvents>(), shown: Array<{ title: string; key: string }> = [];
    const lim = new ToastLimiter({ maxVisible: 1, ttlMs: 8000, coalesceMs: 60_000 });
    wireMonthCard(bus, { enabled, report: () => rep, ratingDelta: () => 0.5, show: (m, key) => { if (lim.push({ key, text: m.title, severity: 'info' }, 0) === 'shown') shown.push({ title: m.title, key }); } });
    return { bus, shown };
  };
  const close = { year: 1, month: 4, net: 6, income: 10, expense: 4 };
  it('shows once per closed month (limiter), with the formatted card', () => {
    const { bus, shown } = mk(() => true);
    bus.emit('finance:monthClosed', close); bus.emit('finance:monthClosed', close);
    expect(shown).toEqual([{ title: 'August closed', key: 'month:1:4' }]);
  });
  it('silent when the Settings toggle is off, or when the report does not match the event', () => {
    const a = mk(() => false); a.bus.emit('finance:monthClosed', close); expect(a.shown).toEqual([]);
    const b = mk(() => true, { ...report, month: 3 }); b.bus.emit('finance:monthClosed', close); expect(b.shown).toEqual([]);
  });
});

import { shouldShowRecap } from '../../src/ui/recap';
describe('shouldShowRecap', () => {
  const o = { loadedSave: true, demo: false, tutorialMode: false, tutorialActive: false };
  it('only after loading a save; never on a new game, the demo or during the tutorial', () => {
    expect(shouldShowRecap(o)).toBe(true);
    expect(shouldShowRecap({ ...o, loadedSave: false })).toBe(false);
    expect(shouldShowRecap({ ...o, demo: true })).toBe(false);
    expect(shouldShowRecap({ ...o, tutorialMode: true })).toBe(false);
    expect(shouldShowRecap({ ...o, tutorialActive: true })).toBe(false);
  });
});

describe('month card: year report hint (M5.3)', () => {
  it('shows "Year report ready" on the last month only when the report exists', () => {
    const r = { year: 2, month: 11, incomeTotal: 100, expenseTotal: 50, net: 50, guests: 3, income: { lifts: 100 } };
    expect(formatMonthCard(r, undefined, 'Year report ready').highlight).toBe('Year report ready');
    expect(formatMonthCard(r).highlight).toContain('Best earner');
    const bus = new EventBus<GameEvents>(), shown: Array<string | null> = [];
    let ready = true;
    wireMonthCard(bus, { enabled: () => true, report: () => r, ratingDelta: () => undefined, show: (m) => { shown.push(m.highlight); }, yearReportReady: () => ready });
    bus.emit('finance:monthClosed', { year: 2, month: 11, net: 50, income: 100, expense: 50 });
    ready = false;
    bus.emit('finance:monthClosed', { year: 2, month: 11, net: 50, income: 100, expense: 50 });
    expect(shown[0]).toBe('Year report ready'); expect(shown[1]).toContain('Best earner');
  });
});
