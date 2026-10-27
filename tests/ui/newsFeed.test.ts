import { describe, expect, it } from 'vitest';
import { GAME_EVENT_NAMES } from '../../src/core/events';
import { NewsFeed, digestText } from '../../src/ui/newsFeed';
import { DEFAULT_MUTED, NEWS_FORMATTERS, TIER_RANK, formatEvent, type NewsItem, type PlaceText } from '../../src/ui/newsFormat';
import { ToastLimiter, loadMuted } from '../../src/ui/toastLimiter';

const item = (o: Partial<NewsItem> = {}): NewsItem => ({ text: 't', severity: 'warn', tier: 'important', icon: 'x', key: 'k', category: 'incident', ...o });
const where = (x: number, y: number): PlaceText => ({ name: 'Blue Run 3', on: 'on Blue Run 3', near: 'near Blue Run 3' + (x + y > 1e9 ? '' : '') });

describe('news tiers', () => {
  it('every event has a tier (or is ignored) and per-guest / noisy events never become rows', () => {
    const f = new NewsFeed();
    const arrived = formatEvent('guest:arrived', { id: 1 } as never)!;
    const left = formatEvent('guest:left', { id: 1, reason: 'injured' } as never)!;
    const inj = formatEvent('incident:injury', { guestId: 1, x: 1, y: 1 })!;
    const groom = formatEvent('ops:grooming', { vehicles: 1, tiles: 9 })!;
    const rain = formatEvent('weather:changed', { kind: 'rain', previous: 'clear', temperature: 3, snowline: 1, precipitation: 'rain' })!;
    for (const it of [arrived, left, inj, groom, rain]) { expect(it.tier).toBe('trivial'); expect(f.push(it, 1)).toBe('counted'); }
    expect(f.rows.length).toBe(0);
    expect(f.today.arrived).toBe(1); expect(f.today.left).toBe(1); expect(f.today.injuries).toBe(1);
    for (const n of GAME_EVENT_NAMES) { const t = NEWS_FORMATTERS[n]; expect(t === 'ignored' || typeof t === 'function', n).toBe(true); }
    expect(TIER_RANK.critical).toBeGreaterThan(TIER_RANK.important);
  });
  it('safety/finance events are important or critical', () => {
    expect(formatEvent('incident:avalanche', { x: 1, y: 2, severity: 1, buried: 2 }, { where })!.tier).toBe('critical');
    expect(formatEvent('incident:wildlife', { x: 1, y: 2, kind: 'bear', outcome: 'attack' }, { where })!.tier).toBe('critical');
    expect(formatEvent('incident:wildlife', { x: 1, y: 2, kind: 'bear', outcome: 'sighting' }, { where })!.tier).toBe('info');
    expect(formatEvent('finance:monthClosed', { year: 0, month: 1, net: 5, income: 6, expense: 1 })!.tier).toBe('important');
    expect(formatEvent('finance:bankruptcyWarning', { money: -1, daysLeft: 3 })!.tier).toBe('critical');
    expect(formatEvent('rating:changed', { stars: 4, previous: 3, reason: 'r' })!.tier).toBe('important');
    expect(formatEvent('piste:opened', { id: 1, open: false })!.tier).toBe('important');
    expect(formatEvent('incident:resolved', { id: 1, responder: 'patrol', responseTicks: 2, outcome: 'recovered' })!.counter).toBe('rescues');
  });
});

describe('NewsFeed', () => {
  it('coalesces by key within a day (×N, aggregated wording) and starts a new row on the next day', () => {
    const f = new NewsFeed();
    const closed = formatEvent('piste:opened', { id: 1, open: false })!;
    expect(f.push(closed, 5)).toBe('row');
    expect(f.push(closed, 5)).toBe('coalesced'); expect(f.push(closed, 5)).toBe('coalesced');
    expect(f.rows[0]!.count).toBe(3); expect(f.rows[0]!.text).toBe('3 pistes closed');
    expect(f.push(closed, 6)).toBe('row');
    expect(f.rows.length).toBe(2);
  });
  it('keeps at most 30 rows, evicting lower tiers first', () => {
    const f = new NewsFeed();
    f.push(item({ key: 'crit', tier: 'critical', severity: 'bad' }), 0);
    for (let i = 0; i < 80; i++) f.push(item({ key: `a${i}`, tier: i % 2 ? 'info' : 'important' }), i);
    expect(f.rows.length).toBe(30);
    expect(f.rows.some((r) => r.key === 'crit')).toBe(true);
  });
  it('filters by tier and clears', () => {
    const f = new NewsFeed();
    f.push(item({ key: 'a', tier: 'info' }), 0); f.push(item({ key: 'b', tier: 'important' }), 0); f.push(item({ key: 'c', tier: 'critical' }), 0);
    expect(f.visible('all').length).toBe(3); expect(f.visible('important').length).toBe(2); expect(f.visible('critical').map((r) => r.key)).toEqual(['c']);
    f.clear(); expect(f.rows.length).toBe(0);
  });
  it('mutes categories except critical items', () => {
    const f = new NewsFeed({ muted: () => new Set(['weather']) });
    expect(f.push(item({ category: 'weather', tier: 'important', severity: 'warn' }), 0)).toBe('muted');
    expect(f.push(item({ key: 'z', category: 'weather', tier: 'critical', severity: 'bad' }), 0)).toBe('row');
  });
  it('writes a daily digest instead of per-guest rows', () => {
    const f = new NewsFeed();
    for (let i = 0; i < 34; i++) f.push(formatEvent('guest:arrived', { id: i } as never)!, 11);
    for (let i = 0; i < 12; i++) f.push(formatEvent('guest:left', { id: i, reason: 'tired' } as never)!, 11);
    expect(f.rows.length).toBe(0);
    const d = f.newDay(12, 11)!;
    expect(d.text).toBe('Apr 12: 34 guests arrived, 12 left');
    expect(f.today.arrived).toBe(0);
    expect(f.visible('important').length).toBe(0); expect(f.visible('all').length).toBe(1);
    expect(f.newDay(13, 12)).toBeNull();
    expect(digestText({ arrived: 0, left: 0, rescues: 5, injuries: 0, grooming: 0, wildlife: 0, avalancheControl: 0 }, -1)).toBe('Rescues: 5');
  });
  it('a burst of 1000 mixed events yields few rows', () => {
    const f = new NewsFeed();
    for (let i = 0; i < 1000; i++) {
      f.push(formatEvent('guest:arrived', { id: i } as never)!, 3);
      if (i % 10 === 0) f.push(formatEvent('piste:opened', { id: i, open: i % 20 === 0 })!, 3);
      if (i % 50 === 0) f.push(formatEvent('incident:resolved', { id: i, responder: 'patrol', responseTicks: 2, outcome: 'recovered' })!, 3);
    }
    expect(f.rows.length).toBeLessThanOrEqual(5);
  });
});

describe('toast tiers & cooldown', () => {
  it('only critical/important tiers toast', () => {
    const l = new ToastLimiter();
    expect(l.push({ key: 'a', text: 'a', severity: 'info', tier: 'info' }, 0)).toBe('filtered');
    expect(l.push({ key: 'b', text: 'b', severity: 'info', tier: 'trivial' }, 0)).toBe('filtered');
    expect(l.push({ key: 'c', text: 'c', severity: 'warn', tier: 'important' }, 0)).toBe('shown');
  });
  it('per-key cooldown silences repeats (but never critical)', () => {
    const l = new ToastLimiter({ coalesceMs: 100, ttlMs: 100, cooldownMs: 10000 });
    expect(l.push({ key: 'm', text: 'm', severity: 'warn', tier: 'important' }, 0)).toBe('shown');
    expect(l.push({ key: 'm', text: 'm', severity: 'warn', tier: 'important' }, 500)).toBe('cooldown');
    expect(l.push({ key: 'm', text: 'm', severity: 'bad', tier: 'critical' }, 600)).toBe('shown');
    expect(l.push({ key: 'm', text: 'm', severity: 'warn', tier: 'important' }, 20000)).toBe('shown');
  });
  it('never shows more than 4 toasts for a flood of distinct important events', () => {
    const l = new ToastLimiter({ maxVisible: 4 });
    for (let i = 0; i < 50; i++) l.push({ key: `k${i}`, text: 'x', severity: 'warn', tier: 'important' }, i);
    expect(l.visible(60).length).toBe(4);
  });
  it('default muted categories (weather, ops) when nothing is stored', () => {
    expect([...loadMuted({ getItem: () => null })].sort()).toEqual([...DEFAULT_MUTED].sort());
  });
});
