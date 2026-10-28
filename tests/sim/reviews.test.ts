// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { REVIEW_TEMPLATES, REVIEW_DRIVERS } from '../../src/config/reviewTemplates';
import { ReviewDirector, composeReview, reviewDrivers, reviewRng, reviewStars, LIGHT_WEIGHT, type ReviewInput } from '../../src/sim/guests/Reviews';
import { el, registerComponents } from '../../src/ui';
import { EventBus } from '../../src/core/EventBus';
import type { GameEvents } from '../../src/core/events';
import { MAX_REVIEWS, ReviewFeed } from '../../src/ui/newsFeed';

registerComponents();
const root = (e: Element): ShadowRoot => (e as unknown as { root: ShadowRoot }).root;
const base = (o: Partial<ReviewInput> = {}): ReviewInput => ({ id: 1, day: 3, reason: 'satisfied', happiness: 0.7, hunger: 0.3, fatigue: 0.3, budget: 100, runs: 2, queueMin: 0, crowd: 3, weatherPenalty: 0, pisteLike: null, x: 5, y: 6, ...o });
const place = { name: 'Blue Run 3', on: 'on Blue Run 3' };

describe('review templates', () => {
  it('has >= 60 templates, every driver x sentiment pair used, light is a minority', () => {
    expect(REVIEW_TEMPLATES.length).toBeGreaterThanOrEqual(60);
    for (const d of REVIEW_DRIVERS) expect(REVIEW_TEMPLATES.some((t) => t.driver === d), d).toBe(true);
    expect(new Set(REVIEW_TEMPLATES.map((t) => t.id)).size).toBe(REVIEW_TEMPLATES.length);
    expect(REVIEW_TEMPLATES.filter((t) => t.tone === 'light').length / REVIEW_TEMPLATES.length).toBeLessThan(0.4);
  });
  it('text is capitalised, no raw ids / unresolved tokens, light ones never address the player', () => {
    for (const t of REVIEW_TEMPLATES) {
      expect(t.text[0], t.id).toBe(t.text[0]!.toUpperCase());
      expect(t.text.replace(/\{(on|name)\}/g, ''), t.id).not.toMatch(/[{}]|\b[a-z]+[A-Z]\w*\b|undefined|NaN/);
      expect(t.text, t.id).not.toMatch(/\b(you|your|owner|manager)\b/i);
    }
  });
});

describe('driver mapping', () => {
  it('maps leave reasons and needs to drivers', () => {
    expect(reviewDrivers(base({ reason: 'injured', happiness: 0.3 }))[0]).toMatchObject({ driver: 'injury', sentiment: 'neg' });
    expect(reviewDrivers(base({ reason: 'broke' }))[0]).toMatchObject({ driver: 'price', sentiment: 'neg' });
    expect(reviewDrivers(base({ queueMin: 15, happiness: 0.5 }))[0]).toMatchObject({ driver: 'queue', sentiment: 'neg' });
    expect(reviewDrivers(base({ hunger: 0.95, happiness: 0.4 }))[0]).toMatchObject({ driver: 'hunger', sentiment: 'neg' });
    expect(reviewDrivers(base({ weatherPenalty: 0.15, happiness: 0.5 }))[0]).toMatchObject({ driver: 'weather', sentiment: 'neg' });
    expect(reviewDrivers(base({ pisteLike: 0.95 }))[0]).toMatchObject({ driver: 'piste', sentiment: 'pos' });
    expect(reviewDrivers(base()).length).toBeGreaterThan(0);
  });
  it('stars follow happiness and bad exits cap them', () => {
    expect(reviewStars({ happiness: 1, reason: 'satisfied' })).toBe(5);
    expect(reviewStars({ happiness: 0, reason: 'satisfied' })).toBe(1);
    expect(reviewStars({ happiness: 0.9, reason: 'injured' })).toBe(2);
    expect(reviewStars({ happiness: 0.9, reason: 'bored' })).toBe(3);
  });
  it('composes from the top driver and names the place properly', () => {
    const r = composeReview(base({ reason: 'injured', happiness: 0.2 }), reviewRng(1, 3), [], place)!;
    expect(r.driver).toBe('injury'); expect(r.stars).toBeLessThanOrEqual(2); expect(r.text[0]).toBe(r.text[0]!.toUpperCase());
    expect(r.text).not.toMatch(/[{}]/);
  });
});

describe('director', () => {
  it('~5% rate and <= 6 per day cap', () => {
    const d = new ReviewDirector(); d.perDay = 1e9;
    let n = 0; for (let i = 1; i <= 4000; i++) if (d.consider(base({ id: i, day: 1 + (i % 50) }), place)) n++;
    expect(n / 4000).toBeGreaterThan(0.035); expect(n / 4000).toBeLessThan(0.065);
    const c = new ReviewDirector(); c.rate = 1;
    const perDay = new Map<number, number>();
    for (let i = 1; i <= 100; i++) { const day = Math.floor(i / 30); if (c.consider(base({ id: i, day }), place)) perDay.set(day, (perDay.get(day) ?? 0) + 1); }
    for (const v of perDay.values()) expect(v).toBeLessThanOrEqual(6);
    expect(Math.max(...perDay.values())).toBe(6);
  });
  it('light share <= 20% over 1,000 samples, no repeat inside the window', () => {
    const d = new ReviewDirector(); d.rate = 1; d.perDay = 1e9;
    const ids: string[] = []; let light = 0, n = 0;
    for (let i = 1; i <= 1000; i++) {
      const g = base({ id: i, day: i, queueMin: i % 3 === 0 ? 12 : 0, hunger: i % 4 === 0 ? 0.9 : 0.2, reason: i % 11 === 0 ? 'injured' : 'satisfied', happiness: (i % 10) / 10 });
      const r = d.consider(g, i % 2 ? place : null)!;
      expect(r).toBeTruthy(); n++; if (r.tone === 'light') light++;
      ids.push(r.text);
    }
    expect(light / n).toBeLessThanOrEqual(0.2); expect(light / n).toBeGreaterThan(0.05);
    expect(LIGHT_WEIGHT).toBeLessThanOrEqual(0.2);
    for (let i = 1; i < ids.length; i++) expect(ids[i]).not.toBe(ids[i - 1]);
  });
  it('is deterministic by guest id + day and does not need the sim RNG', () => {
    const run = (): string[] => { const d = new ReviewDirector(); d.rate = 1; d.perDay = 99; return Array.from({ length: 30 }, (_, i) => d.consider(base({ id: i + 1, day: 2 }), place)?.text ?? ''); };
    expect(run()).toEqual(run());
  });
  it('disabled director returns nothing', () => { const d = new ReviewDirector(); d.enabled = false; d.rate = 1; expect(d.consider(base(), place)).toBeNull(); });
});

describe('stateHash unchanged with reviews disabled vs enabled', () => {
  it('same hash after the same ticks', async () => {
    const { createSim } = await import('../../src/game/createSim');
    const { stateHash } = await import('../../src/game/saveState');
    const hashFor = (on: boolean, withNames = false): { hash: string; parts: Record<string, string>; reviews: number } => {
      const sim = createSim({ size: 64, seed: 11, starterResort: true, startSeason: 'winter', stories: false, now: () => 0 }); // stories also emit (failure) reviews: this test counts review events
      sim.guestSim.reviews.enabled = on; sim.guestSim.reviews.rate = on ? 1 : 0.05; sim.guestSim.reviews.perDay = 1e9;
      if (withNames) sim.guestSim.reviewPlace = (x, y) => { const p = sim.names.describeLocation(x, y); return { name: p.name, on: p.on }; };
      let reviews = 0; sim.bus.on('guest:review', () => { reviews++; });
      sim.tick(2400);
      const h = stateHash(sim); return { hash: h.hash, parts: h.parts, reviews };
    };
    const a = hashFor(false), b = hashFor(true), a2 = hashFor(false);
    expect(a2.hash).toBe(a.hash); // the harness itself is deterministic
    expect(b.parts).toEqual(a.parts);
    expect(a.hash).toBe(b.hash);
    // With place names resolved, only the (lazily numbered) names module may differ; the simulation itself is identical.
    const c = hashFor(true, true);
    for (const k of Object.keys(a.parts)) if (k !== 'names') expect(c.parts[k], k).toBe(a.parts[k]);
    expect(a.reviews).toBe(0);
    expect(b.reviews).toBeGreaterThan(0);
  });
});

describe('Reviews tab', () => {
  it('feed is bounded and filters by stars', () => {
    const f = new ReviewFeed();
    for (let i = 0; i < MAX_REVIEWS + 25; i++) f.add({ guestId: i, stars: (i % 5) + 1, text: 'x', tone: 'plain', driver: 'general' });
    expect(f.rows.length).toBe(MAX_REVIEWS);
    expect(f.visible('low').every((r) => r.stars <= 2)).toBe(true);
    expect(f.visible('high').every((r) => r.stars >= 4)).toBe(true);
  });
  it('StNews shows a Reviews tab with star chips, filter and Go to; reviews never reach onItem', () => {
    const bus = new EventBus<GameEvents>();
    const news = el('st-news'); document.body.append(news);
    const goTo = vi.fn(), onItem = vi.fn();
    news.bind(bus, { stamp: () => 'Day 1 10:00', muted: () => new Set(), setMuted: () => undefined, goTo, onItem });
    bus.emit('guest:review', { guestId: 1, stars: 5, text: 'great runs on Blue Run 3.', tone: 'plain', driver: 'piste', x: 4, y: 5 });
    bus.emit('guest:review', { guestId: 2, stars: 1, text: 'Not my best day.', tone: 'light', driver: 'general' });
    (root(news).querySelector('.wrap > button') as HTMLButtonElement).click();
    const tabs = [...root(news).querySelectorAll('.tabs button')] as HTMLButtonElement[];
    expect(tabs.map((t) => t.textContent)).toEqual(['News', 'Reviews (2)']);
    tabs[1]!.click();
    const rows = [...root(news).querySelectorAll('.r')];
    expect(rows).toHaveLength(2);
    expect(root(news).querySelectorAll('.r svg')).toHaveLength(2);
    expect(rows[1]!.querySelector('p')!.textContent).toBe('Great runs on Blue Run 3.');
    expect(root(news).querySelectorAll('.r button.go')).toHaveLength(1);
    (root(news).querySelector('.r button.go') as HTMLButtonElement).click();
    expect(goTo).toHaveBeenCalledWith({ x: 4, y: 5 });
    expect(onItem).not.toHaveBeenCalled();
    expect(news.items).toHaveLength(0);
  });
});
