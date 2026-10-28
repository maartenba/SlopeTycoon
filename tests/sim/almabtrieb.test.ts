import { describe, expect, it } from 'vitest';
import { EventCalendar, almabtriebWindow, type CalendarDeps } from '../../src/sim/events/EventCalendar';
import { phaseFor } from '../../src/sim/nature/Livestock';
import { EVENTS } from '../../src/config/festivals';
import { createSim } from '../../src/game/createSim';
import { buildDemoResort } from '../../src/game/demoResort';
import { stateHash } from '../../src/game/saveState';
import { DAYS_PER_YEAR } from '../../src/config/balance';
import { buildEventsView } from '../../src/ui/eventsFormat';
import { simDayOf } from '../../src/sim/calendar';
import { FestivalDressing } from '../../src/render/festival/FestivalDressing';
import { dressingWorldOf } from '../../src/render/festival/dressingWorld';

const mk = (herd: boolean, today = 0, auto = true) => {
  const d = { today, herd }, news: string[] = [];
  const deps: CalendarDeps = {
    today: () => d.today, funds: () => 1e6, pay: () => true, stars: () => 4, hasLodge: () => true, hasBlackPiste: () => true, powder: () => false, hasHerd: () => d.herd,
    critic: () => ({ stars: 4, happiness: 0.8, openShare: 1, incidents: 0 }), cheer: () => {}, news: (m) => { news.push(m); }, seed: 3, auto,
  };
  const cal = new EventCalendar(deps);
  const step = (n: number): void => { for (let i = 0; i < n; i++) { d.today++; cal.newDay(); } };
  return { cal, d, news, step };
};

describe('Almabtrieb: calendar window = livestock descent phase', () => {
  it('the window is exactly the days phaseFor says descend, 1-11 October', () => {
    const w = almabtriebWindow();
    for (let d = 0; d < DAYS_PER_YEAR; d++) expect(phaseFor(d) === 'descend', `day ${d}`).toBe(d >= w.first && d <= w.last);
    expect(w.first).toBe(simDayOf(9, 1)); // 1 October
    expect(w.last - w.first + 1).toBeGreaterThanOrEqual(3);
  });
  it('needs a herd: with cows it runs the whole window every year, without cows never', () => {
    const w = almabtriebWindow();
    for (const herd of [false, true]) {
      const f = mk(herd);
      for (let y = 0; y < 3; y++) for (let d = 0; d < DAYS_PER_YEAR; d++) {
        f.d.today = y * DAYS_PER_YEAR + d;
        const on = f.cal.active().some((e) => e.id === 'almabtrieb');
        expect(on, `y${y} d${d}`).toBe(herd && d >= w.first && d <= w.last);
      }
    }
  });
  it('is announced 3 days ahead (once per year), begins with a news item, and lists in upcoming with its date', () => {
    const w = almabtriebWindow(), f = mk(true, w.first - 6);
    f.step(1);
    expect(f.news).toEqual([]);
    expect(f.cal.upcoming().some((u) => u.id === 'almabtrieb' && u.daysAway === 5)).toBe(true);
    f.step(2); // 3 days ahead
    expect(f.news.filter((n) => /Almabtrieb in 3 days/.test(n))).toHaveLength(1);
    f.step(1); expect(f.news.filter((n) => /Almabtrieb in/.test(n))).toHaveLength(1); // not repeated
    f.step(2); // first day
    expect(f.news.filter((n) => /Almabtrieb begins/.test(n))).toHaveLength(1);
    expect(f.cal.active().find((e) => e.id === 'almabtrieb')!.dayIndex).toBe(0);
    f.step(3); expect(f.news.filter((n) => /Almabtrieb begins/.test(n))).toHaveLength(1);
    expect(EVENTS.almAnnounceDays).toBe(3);
  });
  it('the Events panel lists it with its date (coming up, then running) and on the month strip', () => {
    const w = almabtriebWindow(), f = mk(true, w.first - 5);
    let v = buildEventsView(f.cal, f.d.today, 1e6);
    const up = v.upcoming.find((r) => r.id === 'almabtrieb')!;
    expect(up.when).toMatch(/Oct/); expect(up.note).toMatch(/5 days/);
    expect(v.strip.some((c) => c.events.some((e) => e.id === 'almabtrieb'))).toBe(true);
    f.d.today = w.first + 1; v = buildEventsView(f.cal, f.d.today, 1e6);
    expect(v.running.find((r) => r.id === 'almabtrieb')!.note).toMatch(/day 2 of/);
  });
  it('no news and no event without a herd or with auto events off', () => {
    const w = almabtriebWindow();
    const a = mk(false, w.first - 5); a.step(10); expect(a.news).toEqual([]);
    const b = mk(true, w.first - 5, false); b.step(10); expect(b.news).toEqual([]); expect(b.cal.active()).toEqual([]);
  });
  it('gives a small arrival bonus while it runs (exactly 1 otherwise) and the save keeps the notice flags', () => {
    const w = almabtriebWindow(), f = mk(true, w.first - 4);
    expect(f.cal.arrivalMult()).toBe(1);
    f.step(1); f.step(4);
    expect(f.cal.arrivalMult()).toBeGreaterThan(1);
    expect(f.cal.arrivalMult()).toBeLessThanOrEqual(1.1);
    const f2 = mk(true, f.d.today); f2.cal.load(f.cal.serialize()); const n = f2.news.length; f2.step(1);
    expect(f2.news.length).toBe(n); // no second 'begins' after a reload
  });
  it('debugStart runs it on demand (news + active), then it ends', () => {
    const f = mk(false, 40);
    expect(f.cal.debugStart('almabtrieb', 2)).toBe(true);
    expect(f.cal.active().map((e) => e.id)).toEqual(['almabtrieb']);
    expect(f.news.some((n) => /Almabtrieb begins/.test(n))).toBe(true);
    f.step(2); expect(f.cal.active()).toEqual([]);
    expect(f.cal.debugStart('nope' as never)).toBe(false);
  });
});

describe('Almabtrieb: a real sim year with an Alpine Farm', () => {
  const year = (seed: number) => {
    const news: string[] = [], on: number[] = [];
    const sim = createSim({ size: 64, seed, startSeason: 'winter', now: () => 0, hooks: { toast: (t: string) => news.push(t) } });
    buildDemoResort(sim, 'large');
    expect(sim.buildings.all().some((b) => b.type === 'alpineFarm')).toBe(true);
    let last = -1, shown = 0;
    while (sim.game.date.year < 2 || sim.game.date.day < 125) {
      sim.tick(1);
      const d = sim.game.date.day;
      if (d !== last) { last = d; if (sim.events.active().some((e) => e.id === 'almabtrieb')) { on.push(d); shown = Math.max(shown, sim.nature.livestock.visibleCount()); } }
    }
    return { sim, news, on, shown };
  };
  it('runs every autumn on the same days, announced, with visible cows and the parade cheer; deterministic', () => {
    const a = year(61), w = almabtriebWindow();
    expect([...new Set(a.on)]).toEqual(Array.from({ length: w.last - w.first + 1 }, (_, i) => w.first + i));
    expect(a.news.filter((n) => /Almabtrieb in 3 days/.test(n))).toHaveLength(1);
    expect(a.news.filter((n) => /Almabtrieb begins/.test(n))).toHaveLength(1);
    expect(a.news.filter((n) => /^Almabtrieb! The decorated cows/.test(n))).toHaveLength(1); // the herd arrival cheer
    expect(a.shown).toBeGreaterThan(0);
    expect(a.sim.nature.livestock.festivals).toBe(1);
    expect(a.sim.events.active().some((e) => e.id === 'almabtrieb')).toBe(false);
    const b = year(61);
    expect(stateHash(b.sim).hash).toBe(stateHash(a.sim).hash);
  }, 120_000);
});

describe('Almabtrieb: dressing during the event, nothing after', () => {
  it('props exist while it runs and are gone (0 props, empty meshes) afterwards', () => {
    const sim = createSim({ size: 64, seed: 61, startSeason: 'autumn', now: () => 0 });
    buildDemoResort(sim, 'large');
    const d = new FestivalDressing(() => 0, () => dressingWorldOf(sim), 61);
    sim.events.debugStart('almabtrieb', 2);
    d.setEvents(sim.events.active().map((e) => ({ id: e.id, start: e.start })));
    d.update(0.1, 12);
    expect(d.propCount()).toBeGreaterThan(8);
    expect(d.labels).toContain('Almabtrieb');
    expect(d.procession.drawn).toBeGreaterThan(0);
    d.setEvents([]); d.update(0.1, 12);
    expect(d.propCount()).toBe(0);
    expect(d.procession.drawn).toBe(0);
  });
});

describe('Almabtrieb: Rudi advice', () => {
  const mkSim = () => { const s = createSim({ size: 64, seed: 61, starterResort: true, startSeason: 'summer', now: () => 0 } as never); s.tick(60); s.advisor.reset(); return s; };
  const adv = (s: ReturnType<typeof mkSim>) => { s.advisor.evaluate(true); return s.advisor.ranked().find((a) => a.id === 'farm.almabtrieb'); };
  it('no farm: suggests building an Alpine Farm (with a build action); quiet in winter and with auto events off', () => {
    const s = mkSim();
    for (const b of s.buildings.all().slice()) if (b.type === 'alpineFarm') s.buildings.remove(b.id);
    s.game.date.day = almabtriebWindow().first - 40;
    const a = adv(s)!;
    expect(a.title).toBe('Almabtrieb in autumn');
    expect(a.why).toMatch(/Alpine Farm/);
    expect(a.action?.building).toBe('alpineFarm');
    s.game.date.day = simDayOf(11, 5); expect(adv(s)).toBeUndefined(); // December
    s.game.date.day = almabtriebWindow().first - 40; s.events.setAuto(false); expect(adv(s)).toBeUndefined();
  });
  it('farm + herd: counts down 5 days ahead, "is on" during the window, and Show me lands on the base station', () => {
    const s = createSim({ size: 64, seed: 61, startSeason: 'summer', now: () => 0 });
    buildDemoResort(s, 'large'); s.tick(60); s.advisor.reset();
    expect(s.buildings.all().some((b) => b.type === 'alpineFarm')).toBe(true);
    const w = almabtriebWindow();
    s.game.date.day = w.first - 10; expect(adv(s)).toBeUndefined();
    s.game.date.day = w.first - 3; expect(adv(s)!.title).toBe('Almabtrieb in 3 days');
    expect(adv(s)!.target).toBeTruthy();
    s.game.date.day = w.first + 1; expect(adv(s)!.title).toBe('Almabtrieb is on');
    s.game.date.day = w.last + 1; expect(adv(s)).toBeUndefined();
  });
});
