/** M7.4 Task 7.4.4b: the Carnival (upgrade of the old 'Winter Carnival'; docs/festivals.md "Carnival"). */
import { describe, expect, it } from 'vitest';
import { EventCalendar, type CalendarDeps } from '../../src/sim/events/EventCalendar';
import { CARNIVAL, FESTIVAL_BY_ID } from '../../src/config/festivals';
import { CAMPAIGNS, FESTIVAL_CAMPAIGN } from '../../src/config/marketing';
import { ACHIEVEMENTS } from '../../src/config/achievements';
import { DAYS_PER_YEAR } from '../../src/config/balance';
import { SEASON_OF_REAL_MONTH, monthNameOfDay, realMonthOfDay } from '../../src/sim/calendar';
import { costumed } from '../../src/sim/events/Costume';
import { streetTiles, hasStreet } from '../../src/sim/events/Street';
import { applySave, collectSave, stateHash } from '../../src/game/saveState';
import { createSim } from '../../src/game/createSim';
import { makeResort, run } from '../game/harness';

const C = FESTIVAL_BY_ID.carnival;
interface D { money: number; today: number; street: boolean; lodge: boolean; news: string[] }
function mk(over: Partial<D> = {}): { cal: EventCalendar; d: D } {
  const d: D = { money: 100_000, today: 120, street: true, lodge: true, news: [], ...over };
  const deps: CalendarDeps = {
    today: () => d.today, funds: () => d.money, pay: (a) => { d.money -= a; return true; }, refund: (a) => { d.money += a; },
    stars: () => 4, gate: () => null, hasLodge: () => d.lodge, hasBlackPiste: () => true, hasGondola: () => true, hasStreet: () => d.street, powder: () => false, hasHerd: () => false,
    critic: () => ({ stars: 4, happiness: 0.8, openShare: 1, incidents: 0 }), cheer: () => {}, news: (m) => { d.news.push(m); }, seed: 5, auto: false,
  };
  return { cal: new EventCalendar(deps), d };
}
const stepTo = (f: ReturnType<typeof mk>, day: number): void => { while (f.d.today < day) { f.d.today++; f.cal.newDay(); } };
const fourStars = (sim: { rating: object }): void => { Object.defineProperty(sim.rating, 'stars', { get: () => 4 }); };

describe('Carnival config', () => {
  it('keeps the id (save compat), is called Carnival, starts 6-11 Feb (sim day 155-160) and always ends by 15 Feb inside February / winter', () => {
    expect(C.id).toBe('carnival'); expect(C.name).toBe('Carnival'); expect(C.kind).toBe('booked'); expect(C.days).toBe(5);
    expect(C.startWindow).toEqual([155, 160]);
    for (let s = C.startWindow![0]; s <= C.startWindow![1]; s++) {
      for (let k = 0; k < C.days; k++) { expect(monthNameOfDay(s + k)).toBe('February'); expect(SEASON_OF_REAL_MONTH[realMonthOfDay(s + k)]).toBe('winter'); }
    }
    expect(C.startWindow![1] + C.days - 1).toBeLessThanOrEqual(164); // the last day (Shrove Tuesday) is 15 Feb at the latest
    expect(C.needs).toEqual(expect.arrayContaining(['lodge', 'street']));
    expect(C.fireworks).toBe('none'); // no confetti, no fireworks
    expect(C.dressing!.procession?.kind).toBe('costume');
    expect(C.blurb).toMatch(/Shrove Tuesday/);
  });
  it('the Carnival and the World Cup can both be booked in one year', () => {
    const f = mk({ today: 120 });
    expect(f.cal.book('worldCup', 142)).toBe(true); // 142-145
    expect(f.cal.blocker('carnival', 156)).toBeNull(); expect(f.cal.book('carnival', 156)).toBe(true);
  });
});

describe('Carnival needs a village street', () => {
  it('blocked with a clear reason until the street stands; the lodge is still needed', () => {
    const f = mk({ street: false });
    expect(f.cal.requirement('carnival')).toMatch(/village street/);
    expect(f.cal.blocker('carnival', 156)).toMatch(new RegExp(`${CARNIVAL.streetTiles}\\+ road or path tiles`));
    expect(f.cal.book('carnival', 156)).toBe(false);
    f.d.street = true; expect(f.cal.requirement('carnival')).toBeNull();
    f.d.lodge = false; expect(f.cal.requirement('carnival')).toMatch(/Base Lodge/);
  });
  it('streetTiles counts the largest connected road / path run near an anchor (pure)', () => {
    const N = 32, kind = new Uint8Array(N * N);
    for (let x = 4; x < 11; x++) kind[10 * N + x] = 1; // 7 road tiles
    for (let y = 20; y < 23; y++) kind[y * N + 25] = 2; // a separate 3-tile footpath
    const w = { size: N, kind: (i: number) => kind[i]!, anchors: [{ x: 8, y: 10 }] };
    expect(streetTiles(w)).toBe(7); expect(hasStreet(w)).toBe(true);
    expect(hasStreet({ ...w, anchors: [{ x: 25, y: 21 }] })).toBe(false); // only 3 tiles there
    expect(hasStreet({ ...w, anchors: [{ x: 28, y: 3 }] })).toBe(false); // nothing near this anchor
  });
});

describe('Carnival news, spend bonus and old saves', () => {
  it('news: 3 days ahead, begins, Shrove Tuesday on the last day; each exactly once; spend bonus only while it runs', () => {
    const f = mk({ today: 140 });
    expect(f.cal.book('carnival', 156)).toBe(true);
    stepTo(f, 153); expect(f.d.news.filter((m) => /^Carnival in 3 days/.test(m)).length).toBe(1);
    expect(f.cal.spendMult()).toBe(1); expect(f.cal.carnivalOn()).toBe(false);
    stepTo(f, 156); expect(f.d.news.filter((m) => /^Carnival begins/.test(m)).length).toBe(1);
    expect(f.cal.spendMult()).toBe(CARNIVAL.spendMult); expect(CARNIVAL.spendMult).toBeLessThanOrEqual(1.1);
    stepTo(f, 160); expect(f.d.news.filter((m) => /^Shrove Tuesday/.test(m)).length).toBe(1);
    stepTo(f, 161); expect(f.cal.spendMult()).toBe(1);
    stepTo(f, 170);
    expect(f.d.news.filter((m) => /^Carnival in 3 days|^Carnival begins|^Shrove Tuesday/.test(m)).length).toBe(3);
    expect(f.cal.history.carnival).toBe(1);
  });
  it('an old save with a booking at day 150 (the old window) still loads and runs', () => {
    const f = mk({ today: 140 });
    f.cal.load({ booked: [{ id: 'carnival', start: 150, end: 155 }], history: {}, rng: 1 });
    expect(f.cal.booked).toEqual([{ id: 'carnival', start: 150, end: 155 }]);
    stepTo(f, 151); expect(f.cal.active().some((e) => e.id === 'carnival')).toBe(true);
    expect(f.d.news.some((m) => /^Carnival begins/.test(m))).toBe(true);
    stepTo(f, 156); expect(f.cal.active().some((e) => e.id === 'carnival')).toBe(false); expect(f.cal.history.carnival).toBe(1);
  });
});

describe('Carnival in the sim', () => {
  const go = (): { hash: string; seen: number[]; history: string; costumes: number } => {
    const { sim } = makeResort(64, 61, { startDay: 140 });
    sim.progression.unlockAll = true; sim.game.money = 500_000; fourStars(sim);
    const start = sim.events.nextStart('carnival')!;
    expect(start % DAYS_PER_YEAR).toBeGreaterThanOrEqual(155); expect(start % DAYS_PER_YEAR).toBeLessThanOrEqual(160);
    expect(sim.events.requirement('carnival'), 'the starter resort has a street').toBeNull();
    expect(sim.events.book('carnival', start)).toBe(true);
    const seen: number[] = []; let costumes = 0;
    sim.bus.on('day:changed', () => { for (const e of sim.events.active()) if (e.id === 'carnival') seen.push(e.dayIndex); });
    run(sim, { days: start - (sim.game.date.year * DAYS_PER_YEAR + sim.game.date.day) + C.days + 1 });
    const st = sim.guestSim.store; for (let i = 0; i < st.limit; i++) if (st.alive[i] && costumed(st.id[i]!)) costumes++;
    return { hash: stateHash(sim).hash, seen, history: JSON.stringify(sim.events.history), costumes };
  };
  it('runs its five days once, is deterministic, and leaves no booking', () => {
    const a = go();
    expect(a.seen).toEqual([0, 1, 2, 3, 4]); expect(JSON.parse(a.history)).toEqual(expect.objectContaining({ carnival: 1 }));
    expect(go()).toEqual(a);
  }, 300_000);
  it('save / load mid-Carnival keeps the events state hash and the running event', () => {
    const { sim } = makeResort(64, 61, { startDay: 140 });
    sim.progression.unlockAll = true; sim.game.money = 500_000; fourStars(sim);
    const start = sim.events.nextStart('carnival')!;
    expect(sim.events.book('carnival', start)).toBe(true);
    run(sim, { days: start - (sim.game.date.year * DAYS_PER_YEAR + sim.game.date.day) + 2 });
    expect(sim.events.carnivalOn()).toBe(true);
    const save = collectSave(sim);
    const b = createSim({ size: 64, seed: 61, now: () => 0, fromSave: save });
    applySave(b, save);
    expect(stateHash(b).parts.events).toBe(stateHash(sim).parts.events);
    expect(b.events.carnivalOn()).toBe(true);
  }, 120_000);
  it('the street check reads the real network: the starter resort has one, a map with no road or path has none', () => {
    const { sim } = makeResort(64, 61, { startDay: 140 });
    sim.progression.unlockAll = true; fourStars(sim);
    expect(sim.events.requirement('carnival')).toBeNull();
    sim.networks.kind.fill(0); sim.game.date.day += 1; // no road or path anywhere (the check is cached per day)
    expect(sim.events.requirement('carnival')).toMatch(/village street/);
  });
});

describe('Costumes, campaign and trophy', () => {
  it('about CARNIVAL.costumeShare of the guests are costumed; a pure, stable hash', () => {
    let n = 0; for (let id = 1; id <= 4000; id++) if (costumed(id)) n++;
    expect(n / 4000).toBeGreaterThan(CARNIVAL.costumeShare - 0.04); expect(n / 4000).toBeLessThan(CARNIVAL.costumeShare + 0.04);
    expect(costumed(77)).toBe(costumed(77));
  });
  it('Carnival Week: a campaign with a carnival window, startOnly prerequisite, family / couple targets', () => {
    const c = CAMPAIGNS.find((x) => x.id === 'carnival')!;
    expect(c.window).toBe('carnival'); expect(c.prereqs[0]!.id).toBe('bookedCarnival'); expect(c.prereqs[0]!.startOnly).toBe(true);
    expect(c.targets.family).toBeGreaterThan(0); expect(c.targets.couple).toBeGreaterThan(0); expect(c.seasons).toEqual(['winter']);
    expect(FESTIVAL_CAMPAIGN.outside).toBeLessThan(1);
  });
  it('Carnival Week window + prerequisite follow the booked Carnival in a real sim', () => {
    const { sim } = makeResort(64, 61, { startDay: 140 });
    sim.progression.unlockAll = true; sim.game.money = 500_000; fourStars(sim);
    const m = sim.marketing, def = CAMPAIGNS.find((x) => x.id === 'carnival')!;
    expect(m.liveFactor(def)).toBeLessThan(1); // no Carnival: the outside factor
    const start = sim.events.nextStart('carnival')!;
    expect(sim.events.book('carnival', start)).toBe(true);
    run(sim, { days: start - (sim.game.date.year * DAYS_PER_YEAR + sim.game.date.day) + 1 });
    expect(m.liveFactor(def)).toBe(1);
  }, 120_000);
  it("the 'Masked Mountain' achievement is a fact tracker on costumed guests", () => {
    const a = ACHIEVEMENTS.find((x) => x.id === 'masked-mountain')!;
    expect(a.tracker).toEqual({ kind: 'fact', fact: 'masked', op: '>=', v: CARNIVAL.trophyGuests });
    expect(CARNIVAL.trophyStars).toBeGreaterThanOrEqual(3);
  });
});
