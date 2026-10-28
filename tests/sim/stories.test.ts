import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/EventBus';
import type { GameEvents } from '../../src/core/events';
import { GState, GuestStore, GuestType, Skill } from '../../src/sim/guests/Guest';
import { Act } from '../../src/sim/guests/Decision';
import { Stories, checkWish, type WishObs } from '../../src/sim/guests/Stories';
import { STORY, WISHES, WISH_BY_KIND, type WishKind, type WishNeed } from '../../src/config/storyWishes';
import { createSim } from '../../src/game/createSim';
import { collectSave } from '../../src/game/saveState';
import { Bot, runBot } from '../../src/game/bot';

const obs = (o: Partial<WishObs> = {}): WishObs => ({ runs: 0, runMax: 0, queueMax: 0, visited: [], lesson: false, excursion: false, happiness: 0.8, leaving: false, ...o });

describe('checkWish (pure, one block per wish type)', () => {
  it('runs: wins at n runs, loses on leaving short', () => {
    expect(checkWish('runs', 4, obs({ runs: 3 }))).toBe('pending');
    expect(checkWish('runs', 4, obs({ runs: 4 }))).toBe('win');
    expect(checkWish('runs', 4, obs({ runs: 2, leaving: true }))).toBe('lose');
  });
  it('black: needs the raw black difficulty (3), red is not enough', () => {
    expect(checkWish('black', 0, obs({ runMax: 2 }))).toBe('pending');
    expect(checkWish('black', 0, obs({ runMax: 3 }))).toBe('win');
    expect(checkWish('black', 0, obs({ runMax: 2, leaving: true }))).toBe('lose');
  });
  it('meal: any food venue; a bar does not count', () => {
    expect(checkWish('meal', 0, obs({ visited: ['apresBar', 'shop'] }))).toBe('pending');
    expect(checkWish('meal', 0, obs({ visited: ['cafe'] }))).toBe('win');
    expect(checkWish('meal', 0, obs({ leaving: true }))).toBe('lose');
  });
  it('apres: the après bar only', () => {
    expect(checkWish('apres', 0, obs({ visited: ['cafe'] }))).toBe('pending');
    expect(checkWish('apres', 0, obs({ visited: ['apresBar'] }))).toBe('win');
    expect(checkWish('apres', 0, obs({ leaving: true }))).toBe('lose');
  });
  it('lesson', () => {
    expect(checkWish('lesson', 0, obs())).toBe('pending');
    expect(checkWish('lesson', 0, obs({ lesson: true }))).toBe('win');
    expect(checkWish('lesson', 0, obs({ leaving: true }))).toBe('lose');
  });
  it('excursion', () => {
    expect(checkWish('excursion', 0, obs())).toBe('pending');
    expect(checkWish('excursion', 0, obs({ excursion: true }))).toBe('win');
    expect(checkWish('excursion', 0, obs({ leaving: true }))).toBe('lose');
  });
  it('shortQueue: a long wait fails at once, n runs without one wins', () => {
    expect(checkWish('shortQueue', 3, obs({ runs: 2, queueMax: 4 }))).toBe('pending');
    expect(checkWish('shortQueue', 3, obs({ runs: 1, queueMax: STORY.queueLimitMin + 1 }))).toBe('lose');
    expect(checkWish('shortQueue', 3, obs({ runs: 3, queueMax: 5 }))).toBe('win');
  });
  it('happyDay: judged when the guest heads home', () => {
    expect(checkWish('happyDay', 0, obs({ happiness: 0.2 }))).toBe('pending');
    expect(checkWish('happyDay', 0, obs({ leaving: true, happiness: 0.8 }))).toBe('win');
    expect(checkWish('happyDay', 0, obs({ leaving: true, happiness: 0.4 }))).toBe('lose');
  });
  it('every wish kind has data and wording in the plain voice', () => {
    const kinds: WishKind[] = ['runs', 'black', 'meal', 'apres', 'lesson', 'excursion', 'shortQueue', 'happyDay'];
    expect(WISHES.map((w) => w.kind).sort()).toEqual([...kinds].sort());
    for (const k of kinds) { const w = WISH_BY_KIND[k]; expect(w.win.plain.length).toBeGreaterThan(1); expect(w.lose.length).toBeGreaterThan(1); expect(w.review.length).toBeGreaterThan(0); expect(w.tip).toBeLessThanOrEqual(STORY.tipCapPerDay); }
  });
});

/** A tiny rig: a real GuestStore + bus, deterministic arrivals. */
function rig(o: { has?: (n: WishNeed) => boolean; kid?: boolean; seed?: number } = {}) {
  const store = new GuestStore(64), bus = new EventBus<GameEvents>();
  const tips: number[] = [], news: GameEvents['story:resolved'][] = [], reviews: GameEvents['guest:review'][] = [];
  let day = 5;
  bus.on('story:resolved', (e) => news.push(e)); bus.on('guest:review', (e) => reviews.push(e));
  const types = new Map<number, string>([[1, 'cafe'], [2, 'apresBar'], [3, 'shop']]);
  const st = new Stories({ store, bus, seed: o.seed ?? 7, today: () => day, has: o.has ?? (() => true), buildingType: (id) => types.get(id) ?? null, isKid: () => !!o.kid, tip: (a) => tips.push(a) });
  st.enabled = true;
  const arrive = (skill: number = Skill.Advanced, drop = true): number => {
    if (drop && store.count >= 60) for (let i = 0; i < store.limit; i++) if (store.alive[i] && !st.isStory(store.id[i]!)) store.remove(i);
    const slot = store.add({ x: 3, y: 3, z: 0, type: GuestType.Solo, skill, budget: 200, group: 0, mode: 0, overnight: false, leaveDay: 99, tick: 0 });
    return store.id[slot]!;
  };
  /** Force the next arrival into a story with a given wish (scan guest ids until the rng makes one, then keep only a matching kind). */
  const make = (kind: WishKind, skill: number = Skill.Advanced): { id: number; slot: number } => {
    for (let k = 0; k < 4000; k++) {
      const id = arrive(skill); st.onArrived(id);
      const s = st.active.find((x) => x.id === id);
      if (s && s.kind === kind) return { id, slot: store.slotOf(id) };
      if (s) st.active.splice(st.active.indexOf(s), 1);
      store.remove(store.slotOf(id));
    }
    throw new Error(`no ${kind} story after 4000 arrivals`);
  };
  return { store, bus, st, tips, news, reviews, make, arrive, setDay: (d: number) => { day = d; } };
}

describe('Stories (observer module)', () => {
  it('about 1.5% of arrivals become story guests, never more than maxActive, and the guest store is never changed by arrivals', () => {
    const r = rig();
    let made = 0;
    for (let i = 0; i < 4000; i++) { const id = r.arrive(); const sl = r.store.slotOf(id); const before = r.store.happiness[sl]; r.st.onArrived(id); expect(r.store.happiness[sl]).toBe(before); if (r.st.isStory(id)) made++; r.st.active.length = 0; r.store.remove(sl); }
    expect(made / 4000).toBeGreaterThan(0.008); expect(made / 4000).toBeLessThan(0.025);
    const r2 = rig();
    for (let i = 0; i < 3000; i++) r2.st.onArrived(r2.arrive(Skill.Advanced, false));
    expect(r2.st.active.length).toBeLessThanOrEqual(STORY.maxActive);
  });

  it('is inert when disabled', () => {
    const r = rig(); r.st.enabled = false;
    for (let i = 0; i < 1000; i++) r.st.onArrived(r.arrive());
    expect(r.st.active.length).toBe(0);
  });

  it('only offers wishes the resort can serve', () => {
    const r = rig({ has: () => false });
    for (let i = 0; i < 3000; i++) { r.st.onArrived(r.arrive()); }
    r.st.active.length = Math.min(r.st.active.length, 8);
    for (const s of r.st.active) expect(['runs', 'shortQueue', 'happyDay']).toContain(s.kind);
    expect(r.st.active.length).toBeGreaterThan(0);
  });

  it('lesson wishes only go to kids; black only to advanced adults', () => {
    const adults = rig(); for (let i = 0; i < 4000; i++) adults.st.onArrived(adults.arrive(Skill.Beginner)); adults.st.active.forEach((s) => expect(['lesson', 'black']).not.toContain(s.kind));
    const kids = rig({ kid: true }); for (let i = 0; i < 4000; i++) kids.st.onArrived(kids.arrive()); kids.st.active.forEach((s) => expect(s.kind).not.toBe('black'));
  });

  it('runs wish: resolves from the store, tips once, lifts mood a little, plain news', () => {
    const r = rig(); const { id, slot } = r.make('runs');
    const n = r.st.active.find((s) => s.id === id)!.n;
    r.store.runs[slot] = n - 1; r.st.update(10); expect(r.news.length).toBe(0);
    const h = r.store.happiness[slot]!; r.store.runs[slot] = n; r.st.update(11);
    expect(r.news.length).toBe(1); expect(r.news[0]!.outcome).toBe('granted'); expect(r.news[0]!.text).toContain(r.news[0]!.name);
    expect(r.tips).toEqual([WISH_BY_KIND.runs.tip]); expect(r.store.happiness[slot]!).toBeCloseTo(Math.min(1, h + STORY.happyLift), 5);
    expect(r.reviews.length).toBe(0); expect(r.st.granted).toBe(1); expect(r.st.isStory(id)).toBe(false);
    r.st.update(12); expect(r.news.length).toBe(1); // resolved once
  });

  it('black wish: runMax 3 wins', () => {
    const r = rig(); const { slot } = r.make('black');
    r.store.runMax[slot] = 2; r.st.update(1); expect(r.news.length).toBe(0);
    r.store.runMax[slot] = 3; r.st.update(2); expect(r.news[0]!.outcome).toBe('granted');
  });

  it('meal / apres wishes: a visit counted from the heading + visit counter, or from the Using state', () => {
    const r = rig(); const m = r.make('meal');
    r.store.act[m.slot] = Act.ToBuilding; r.store.target[m.slot] = 3; r.st.update(1); // heading to a shop
    r.store.act[m.slot] = Act.None; r.store.visits[m.slot] = 1; r.st.update(2); expect(r.news.length).toBe(0);
    r.store.act[m.slot] = Act.ToBuilding; r.store.target[m.slot] = 1; r.st.update(3);
    r.store.act[m.slot] = Act.None; r.store.visits[m.slot] = 2; r.st.update(4); expect(r.news[0]!.outcome).toBe('granted');
    const a = r.make('apres'); r.store.state[a.slot] = GState.Using; r.store.target[a.slot] = 2; r.st.update(5);
    expect(r.news.at(-1)!.wish).toBe('apres'); expect(r.news.at(-1)!.outcome).toBe('granted');
  });

  it('lesson wish: lesson:started with the guest among the kids', () => {
    const r = rig({ kid: true }); const { id } = r.make('lesson');
    r.st.onLesson([id + 999]); r.st.update(1); expect(r.news.length).toBe(0);
    r.st.onLesson([id]); r.st.update(2); expect(r.news[0]!.outcome).toBe('granted');
  });

  it('excursion wish: Act.Excursion', () => {
    const r = rig(); const { slot } = r.make('excursion');
    r.store.act[slot] = Act.Excursion; r.st.update(1); expect(r.news[0]!.outcome).toBe('granted');
  });

  it('shortQueue wish fails on a long lift queue wait (mild review), not on a short one', () => {
    const r = rig(); const { slot } = r.make('shortQueue');
    r.store.state[slot] = GState.Queueing; r.store.actTick[slot] = 0; r.st.update(4); expect(r.news.length).toBe(0); // 1 min
    r.st.update(40); // 10 min
    expect(r.news[0]!.outcome).toBe('failed'); expect(r.tips.length).toBe(0); expect(r.reviews.length).toBe(1);
  });

  it('happyDay wish: judged when the guest starts leaving', () => {
    const r = rig(); const a = r.make('happyDay'); r.store.happiness[a.slot] = 0.9; r.store.state[a.slot] = GState.Leaving; r.st.update(1);
    expect(r.news.at(-1)!.outcome).toBe('granted');
    const b = r.make('happyDay'); r.store.happiness[b.slot] = 0.3; r.store.state[b.slot] = GState.Leaving; r.st.update(2);
    expect(r.news.at(-1)!.outcome).toBe('failed');
  });

  it('failure: guest:left without the wish gives one mild 2-3 star plain review and a plain news line, no tip', () => {
    const r = rig(); const { id, slot } = r.make('black');
    r.store.happiness[slot] = 0.8; r.st.update(1);
    r.st.onLeft(id);
    expect(r.news.length).toBe(1); expect(r.news[0]!.outcome).toBe('failed'); expect(r.news[0]!.tone).toBe('plain');
    expect(r.reviews.length).toBe(1); expect(r.reviews[0]!.stars).toBeGreaterThanOrEqual(2); expect(r.reviews[0]!.stars).toBeLessThanOrEqual(3); expect(r.reviews[0]!.tone).toBe('plain');
    expect(r.tips.length).toBe(0); expect(r.st.failed).toBe(1);
    r.st.onLeft(id); expect(r.news.length).toBe(1);
  });

  it('tips are capped per day across all stories', () => {
    const r = rig(); const paid: number[] = [];
    for (let i = 0; i < 12; i++) { const m = r.make('black'); r.store.runMax[m.slot] = 3; r.st.update(i); }
    for (const t of r.tips) paid.push(t);
    expect(paid.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(STORY.tipCapPerDay);
    r.setDay(6); const m = r.make('black'); r.store.runMax[m.slot] = 3; r.st.update(99); expect(r.tips.at(-1)).toBe(WISH_BY_KIND.black.tip);
  });

  it('light wording is an occasional touch (<= 20% of success lines), failures never light', () => {
    let light = 0, total = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const r = rig({ seed });
      for (let i = 0; i < 40; i++) { const m = r.make('runs'); r.store.runs[m.slot] = 99; r.st.update(i); }
      for (const n of r.news) { total++; if (n.tone === 'light') light++; }
      const f = rig({ seed }); const q = f.make('runs'); f.st.onLeft(q.id); expect(f.news[0]!.tone).toBe('plain');
    }
    expect(total).toBeGreaterThan(200); expect(light / total).toBeLessThan(0.2); expect(light / total).toBeGreaterThan(0.03);
  });

  it('pin only works for story guests; resolving unpins; save round trip keeps rng, stories and pin', () => {
    const r = rig(); const { id, slot } = r.make('black');
    r.st.pin(id + 500); expect(r.st.pinned).toBe(0);
    r.st.pin(id); expect(r.st.pinned).toBe(id); expect(r.st.info(id)!.pinned).toBe(true);
    const saved = JSON.parse(JSON.stringify(r.st.serialize()));
    const r2 = rig({ seed: 99 }); r2.st.load(saved);
    expect(r2.st.pinned).toBe(id); expect(r2.st.active.length).toBe(r.st.active.length);
    expect(r2.st.serialize()).toEqual(r.st.serialize());
    r.store.runMax[slot] = 3; r.st.update(1); expect(r.st.pinned).toBe(0);
  });

  it('inspector info: goal and progress', () => {
    const r = rig(); const { id, slot } = r.make('runs');
    r.store.runs[slot] = 1; r.st.update(1);
    const i = r.st.info(id)!; expect(i.goal).toMatch(/^Wants to ski \d runs$/); expect(i.progress).toMatch(/^1 \/ \d runs$/); expect(i.name).toContain(' from ');
    expect(r.st.info(id + 1)).toBeNull();
  });
});

describe('Stories in a real sim', () => {
  it('on by default (= the real game), off with stories: false; save module round trips', () => {
    const off = createSim({ size: 64, seed: 61, now: () => 0, stories: false });
    expect(off.stories.enabled).toBe(false);
    const on = createSim({ size: 64, seed: 61, now: () => 0 });
    expect(on.stories.enabled).toBe(true);
    expect(collectSave(on)['stories']).toBeTruthy();
  });

  it('a bot run with stories: wishes get resolved, news + tips flow, and two-year profit differs by < 5% from the same run without', () => {
    const play = (stories: boolean) => {
      const sim = createSim({ size: 64, seed: 61, now: () => 0, stories });
      const news: string[] = []; sim.bus.on('story:resolved', (e) => news.push(e.text));
      const bot = new Bot(sim, {}); runBot(sim, bot, 360);
      return { sim, news, net: bot.rows.reduce((a, r) => a + r.net, 0) };
    };
    const a = play(false), b = play(true);
    expect(a.news.length).toBe(0);
    expect(b.sim.stories.granted + b.sim.stories.failed).toBeGreaterThan(2);
    expect(b.news.length).toBe(b.sim.stories.granted + b.sim.stories.failed);
    const delta = Math.abs(b.net - a.net) / Math.max(1, Math.abs(a.net));
    console.log(`[stories] profit without ${Math.round(a.net)} with ${Math.round(b.net)} delta ${(delta * 100).toFixed(2)}% granted ${b.sim.stories.granted} failed ${b.sim.stories.failed}`);
    expect(delta).toBeLessThan(0.05);
  }, 120_000);
});
