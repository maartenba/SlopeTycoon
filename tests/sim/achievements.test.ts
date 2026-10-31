import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import * as THREE from 'three';
import { EventBus } from '../../src/core/EventBus';
import { GAME_EVENT_NAMES, type GameBus, type GameEvents } from '../../src/core/events';
import { ACHIEVEMENTS, ACHIEVEMENT_BY_ID, EVAC_TICKS, SCENARIO_IDS, TIER_POINTS, cosmeticUnlockedBy } from '../../src/config/achievements';
import { COSMETICS, COSMETIC_BY_ID, DEFAULT_COSMETIC_IDS, cosmeticsOf, COSMETIC_KINDS } from '../../src/config/cosmetics';
import { LIFTS } from '../../src/config/lifts';
import { Achievements, counterKey, eventsOf, matches, type AchFacts, type RunKind } from '../../src/sim/meta/Achievements';
import { ProfileStore } from '../../src/persist/ProfileStore';
import { IdbStore } from '../../src/persist/IdbStore';
import { AchievementAnnouncer } from '../../src/ui/achievementToasts';
import { confettiAllowed, feedbackPolicy } from '../../src/render/fx';
import { BuildingMeshes } from '../../src/render/meshes';
import { buildChairGeometry } from '../../src/render/meshes/lifts/Chair';
import { geometryHash } from '../../src/render/meshes/lifts/geo';
import { VillageDecor } from '../../src/render/VillageDecor';
import { createSim } from '../../src/game/createSim';
import { Bot, runBot } from '../../src/game/bot';
import { collectSave, applySave, stateHash } from '../../src/game/saveState';

const FACTS: AchFacts = { stars: 2, level: 1, guests: 30, openLifts: 1, money: 1000, festivals: 0, report: null };
function mk(kind: RunKind = 'career', facts: Partial<AchFacts> = {}) {
  const bus: GameBus = new EventBus<GameEvents>();
  const f = { ...FACTS, ...facts };
  const a = new Achievements(bus, { runKind: () => kind, facts: () => f, now: () => 1_700_000_000_000, gameId: 'gtest' });
  a.arm();
  const got: string[] = [];
  a.onUnlock((d) => got.push(d.id));
  return { bus, a, got, facts: f };
}
const days = (bus: GameBus, n: number): void => { for (let i = 0; i < n; i++) bus.emit('day:changed', { year: 1, day: i }); };

describe('achievement catalogue (table-driven)', () => {
  it('has 48 unique ids across three tiers, with titles, descriptions, scopes and icons', () => {
    expect(ACHIEVEMENTS.length).toBe(48);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(48);
    for (const a of ACHIEVEMENTS) {
      expect(a.id, a.id).toMatch(/^[a-z][a-z0-9-]{1,39}$/);
      expect(a.title.length, a.id).toBeGreaterThan(2); expect(a.description.length, a.id).toBeGreaterThan(10);
      expect([1, 2, 3]).toContain(a.tier); expect(['any', 'career', 'scenario']).toContain(a.scope);
    }
    for (const t of [1, 2, 3] as const) expect(ACHIEVEMENTS.filter((a) => a.tier === t).length, `tier ${t}`).toBeGreaterThanOrEqual(5);
    expect(ACHIEVEMENTS.filter((a) => a.hidden).length).toBeGreaterThanOrEqual(3);
    expect(TIER_POINTS).toEqual({ 1: 1, 2: 3, 3: 5 });
  });

  it('every achievement has a valid tracker and every event it listens to exists in GAME_EVENT_NAMES', () => {
    const known = new Set<string>(GAME_EVENT_NAMES);
    for (const a of ACHIEVEMENTS) {
      const t = a.tracker;
      expect(['event', 'render', 'fact', 'streak', 'window', 'distinct', 'report', 'scenario'], a.id).toContain(t.kind);
      for (const ev of eventsOf(t)) expect(known.has(ev), `${a.id}: unknown event ${ev}`).toBe(true);
      if (t.kind === 'event') expect((t.n ?? 1), a.id).toBeGreaterThanOrEqual(1);
      if (t.kind === 'render') expect(t.n, a.id).toBeGreaterThan(0);
      if (t.kind === 'scenario' && t.scenario !== 'any' && t.scenario !== 'all') expect(SCENARIO_IDS, a.id).toContain(t.scenario);
      if (t.kind === 'distinct') expect(t.n, a.id).toBeLessThanOrEqual(Object.keys(LIFTS).length);
      if (t.kind === 'report' && t.metric === 'award') expect(t.award, a.id).toBeTruthy();
    }
  });

  it('achievements that share a counter share one rule (no double counting)', () => {
    const rule = (a: (typeof ACHIEVEMENTS)[number]): string => { const t = a.tracker; return t.kind === 'event' ? JSON.stringify([t.event, t.where ?? null, t.by ?? null, t.per ?? 'profile']) : ''; };
    const by = new Map<string, string>();
    for (const a of ACHIEVEMENTS) if (a.tracker.kind === 'event') { const k = counterKey(a), r = rule(a); expect(by.get(k) ?? r, `counter ${k}`).toBe(r); by.set(k, r); }
  });

  it('rewards: every cosmetic reward exists, is unique and non-default; every non-default cosmetic has exactly one unlocker', () => {
    const rewards = ACHIEVEMENTS.filter((a) => a.reward).map((a) => a.reward!);
    expect(new Set(rewards).size).toBe(rewards.length);
    for (const r of rewards) { expect(COSMETIC_BY_ID[r], r).toBeTruthy(); expect(COSMETIC_BY_ID[r]!.default, r).toBeFalsy(); }
    for (const c of COSMETICS.filter((x) => !x.default)) expect(cosmeticUnlockedBy(c.id), c.id).toBeTruthy();
    for (const c of COSMETICS.filter((x) => x.default)) expect(cosmeticUnlockedBy(c.id)).toBeNull();
    for (const k of COSMETIC_KINDS) expect(cosmeticsOf(k).filter((c) => c.default).length, k).toBe(1);
    expect(DEFAULT_COSMETIC_IDS.length).toBe(COSMETIC_KINDS.length);
  });

  it('only tier-3 achievements are listed as rare confetti candidates; hidden ones exist', () => {
    expect(ACHIEVEMENT_BY_ID['roy-gold']!.tier).toBe(3);
    expect(ACHIEVEMENTS.filter((a) => a.hidden).every((a) => a.tier <= 2)).toBe(true);
  });
});

describe('trackers: event counters, thresholds, filters', () => {
  it('a single-shot event unlocks once; `where` filters the payload', () => {
    const { bus, a, got } = mk();
    bus.emit('ops:grooming', { vehicles: 0, tiles: 0 });
    expect(got).toEqual([]);
    bus.emit('ops:grooming', { vehicles: 2, tiles: 90 });
    expect(got).toEqual(['first-groom']);
    bus.emit('ops:grooming', { vehicles: 1, tiles: 40 });
    expect(got).toEqual(['first-groom']);
    expect(a.isUnlocked('first-groom')).toBe(true);
    expect(a.counter('groomNights')).toBe(2);
  });
  it('first lift opened: a lift BUILT while playing that is open at a day check (a pre-built starter lift never counts)', () => {
    const { bus, got, facts } = mk('career', { openLifts: 1 });
    days(bus, 2); expect(got).not.toContain('first-lift'); // nothing was built after arming
    facts.openLifts = 0;
    bus.emit('lift:built', { id: 1, kind: 'chair4' }); days(bus, 2); expect(got).not.toContain('first-lift'); // built but not open yet
    facts.openLifts = 1; days(bus, 1); expect(got).toContain('first-lift');
  });
  it('a profile counter threshold counts across games (the counter comes from the profile)', () => {
    const { bus, a, got } = mk();
    a.loadProfile({ v: 1, unlocked: {}, counters: { guests: 997 }, cosmetics: { owned: [], selected: {} } });
    for (let i = 0; i < 2; i++) bus.emit('guest:arrived', { id: i });
    expect(got).toContain('first-guest'); expect(got).not.toContain('guests-1000');
    expect(a.progress(ACHIEVEMENT_BY_ID['guests-1000']!)).toEqual({ value: 999, target: 1000 });
    bus.emit('guest:arrived', { id: 9 });
    expect(got).toContain('guests-1000');
    expect(a.counter('guests')).toBe(1000);
  });
  it('two achievements sharing one counter count each event once', () => {
    const { bus, a } = mk();
    for (let i = 0; i < 5; i++) bus.emit('incident:resolved', { id: i, responder: 'patrol', responseTicks: 3, outcome: 'recovered' });
    expect(a.counter('rescues')).toBe(5);
  });
  it('evacuation within 30 minutes needs a stranded + evacuated + fast response', () => {
    const { bus, got } = mk();
    bus.emit('incident:resolved', { id: 1, responder: 'patrol', responseTicks: EVAC_TICKS + 1, outcome: 'evacuated', kind: 'stranded' });
    bus.emit('incident:resolved', { id: 2, responder: 'patrol', responseTicks: 2, outcome: 'evacuated', kind: 'injury' });
    expect(got).not.toContain('evac-30');
    bus.emit('incident:resolved', { id: 3, responder: 'patrol', responseTicks: EVAC_TICKS, outcome: 'evacuated', kind: 'stranded' });
    expect(got).toContain('evac-30');
  });
  it('`matches` handles missing fields', () => {
    expect(matches([{ f: 'x', op: '!=', v: true }], {})).toBe(true);
    expect(matches([{ f: 'x', op: '>=', v: 1 }], {})).toBe(false);
    expect(matches(undefined, {})).toBe(true);
  });
  it('building type filters: the farm, ranger station and snow cannon', () => {
    const { bus, got } = mk();
    bus.emit('building:placed', { id: 1, type: 'chalet', x: 1, y: 1 }); expect(got).toEqual([]);
    for (const [i, t] of ['alpineFarm', 'rangerStation', 'snowCannon'].entries()) bus.emit('building:placed', { id: 2 + i, type: t, x: 1, y: 1 });
    expect(got.sort()).toEqual(['first-farm', 'first-ranger', 'snow-cannon']);
  });
});

describe('trackers: facts, streaks, windows, distinct sets, reports, scenarios', () => {
  it('fact trackers are checked on the day change (level 4 / 6, Almabtrieb)', () => {
    const { bus, got, facts } = mk('career');
    facts.level = 4; facts.festivals = 1; days(bus, 1);
    expect(got.sort()).toEqual(['farm-parade', 'level-4']);
    facts.level = 6; days(bus, 1);
    expect(got).toContain('level-6');
  });
  it('streak: 50 days without an uncontrolled avalanche; a controlled release does not reset it; needs an open lift', () => {
    const { bus, a, got, facts } = mk();
    days(bus, 30);
    bus.emit('incident:avalanche', { x: 1, y: 1, severity: 1, controlled: true });
    days(bus, 19);
    expect(got).toContain('boom'); expect(got).not.toContain('quiet-mountain');
    expect(a.progress(ACHIEVEMENT_BY_ID['quiet-mountain']!)).toEqual({ value: 49, target: 50 });
    days(bus, 1);
    expect(got).toContain('quiet-mountain');
    // reset by a real avalanche
    const b = mk();
    days(b.bus, 40); b.bus.emit('incident:avalanche', { x: 1, y: 1, severity: 1 }); days(b.bus, 40);
    expect(b.got).not.toContain('quiet-mountain');
    // closed resort: the days do not count
    const c = mk('career', { openLifts: 0 });
    days(c.bus, 60); expect(c.got).not.toContain('quiet-mountain');
    void facts;
  });
  it('window: a whole winter without a hospitalised guest (violation closes it; a clean winter unlocks)', () => {
    const { bus, got } = mk();
    bus.emit('season:changed', { season: 'winter', previous: 'autumn' });
    bus.emit('incident:resolved', { id: 1, responder: 'patrol', responseTicks: 2, outcome: 'hospitalised' });
    bus.emit('season:changed', { season: 'spring', previous: 'winter' });
    expect(got).not.toContain('safe-winter');
    bus.emit('season:changed', { season: 'winter', previous: 'autumn' });
    bus.emit('incident:resolved', { id: 2, responder: 'patrol', responseTicks: 2, outcome: 'recovered' });
    bus.emit('season:changed', { season: 'spring', previous: 'winter' });
    expect(got).toContain('safe-winter');
  });
  it('window: a winter that was not observed from its start (no start event) never unlocks', () => {
    const { bus, got } = mk();
    bus.emit('season:changed', { season: 'spring', previous: 'winter' });
    expect(got).not.toContain('safe-winter');
  });
  it('window with the same start and end (zero-debt year): debt in the year breaks it; the next clean year counts; career only', () => {
    const { bus, got } = mk('career');
    bus.emit('year:changed', { year: 2 });
    bus.emit('finance:debtWarning', { money: -10, negDays: 1, level: 1 });
    bus.emit('year:changed', { year: 3 });
    expect(got).not.toContain('zero-debt');
    bus.emit('year:changed', { year: 4 });
    expect(got).toContain('zero-debt');
    const s = mk('sandbox');
    s.bus.emit('year:changed', { year: 2 }); s.bus.emit('year:changed', { year: 3 });
    expect(s.got).not.toContain('zero-debt');
  });
  it('window with retry (back from the brink): waits for money >= 0 at a later month end', () => {
    const { bus, got, facts } = mk('career', { money: -5000 });
    bus.emit('finance:debtWarning', { money: -5000, negDays: 8, level: 2 });
    bus.emit('month:changed', { year: 1, month: 3 }); expect(got).not.toContain('back-from-brink');
    facts.money = 1200;
    bus.emit('month:changed', { year: 1, month: 4 }); expect(got).toContain('back-from-brink');
  });
  it('distinct: every lift type in one game (aliases collapse, per game)', () => {
    const { bus, a, got } = mk();
    const kinds = Object.keys(LIFTS);
    expect(kinds.length).toBe(12);
    for (const k of kinds.slice(0, 11)) bus.emit('lift:built', { id: 1, kind: k });
    bus.emit('lift:built', { id: 2, kind: 'chairlift' }); // alias of chair4
    expect(got).not.toContain('all-lifts');
    expect(a.progress(ACHIEVEMENT_BY_ID['all-lifts']!)!.value).toBe(11);
    bus.emit('lift:built', { id: 3, kind: kinds[11]! });
    expect(got).toContain('all-lifts');
  });
  it('report trackers: a full year in profit, the gold headline, the wildlife award; partial years never count', () => {
    const r = (over: Partial<NonNullable<AchFacts['report']>> = {}): NonNullable<AchFacts['report']> => ({ year: 1, partial: false, profit: 5000, headline: 'silver', awards: { wildlife: 1 }, ...over });
    const a1 = mk('career', { report: r({ partial: true, headline: 'gold' }) });
    a1.bus.emit('year:report', { year: 1 }); expect(a1.got).toEqual([]);
    const a2 = mk('career', { report: r() });
    a2.bus.emit('year:report', { year: 1 });
    expect(a2.got.sort()).toEqual(['wildlife-friendly', 'year-profit']);
    const a3 = mk('career', { report: r({ headline: 'gold', profit: -1, awards: {} }) });
    a3.bus.emit('year:report', { year: 1 }); expect(a3.got).toEqual(['roy-gold']);
  });
  it('scenario medals: any / silver / gold and the "all six" collections use the profile counters', () => {
    const { bus, a, got } = mk('scenario');
    bus.emit('scenario:finished', { id: 'first-tracks', result: 'won', medal: 'bronze', score: 80, reason: '' });
    expect(got).toEqual(['first-medal']);
    bus.emit('scenario:finished', { id: 'family-valley', result: 'lost', medal: 'none', score: 0, reason: '' });
    bus.emit('scenario:finished', { id: 'tutorial', result: 'won', medal: 'gold', score: 0, reason: '' });
    expect(got).toEqual(['first-medal']);
    bus.emit('scenario:finished', { id: 'family-valley', result: 'won', medal: 'gold', score: 190, reason: '' });
    expect(got).toContain('scenario-silver'); expect(got).toContain('scenario-gold');
    for (const id of SCENARIO_IDS) bus.emit('scenario:finished', { id, result: 'won', medal: 'bronze', score: 80, reason: '' });
    expect(got).toContain('scenarios-all'); expect(got).not.toContain('scenarios-gold');
    expect(a.progress(ACHIEVEMENT_BY_ID['scenarios-gold']!)).toEqual({ value: 1, target: SCENARIO_IDS.length });
    for (const id of SCENARIO_IDS) bus.emit('scenario:finished', { id, result: 'won', medal: 'gold', score: 190, reason: '' });
    expect(got).toContain('scenarios-gold');
  });
  it('render counters (photos, walked metres, ride-alongs) only count through note() while armed', () => {
    const bus: GameBus = new EventBus<GameEvents>();
    const a = new Achievements(bus, { runKind: () => 'career', facts: () => FACTS, now: () => 5 });
    a.note('photos'); expect(a.counter('photos')).toBe(0); // not armed: headless / loading
    a.arm();
    const got: string[] = []; a.onUnlock((d) => got.push(d.id));
    a.note('photos'); expect(got).toEqual(['first-photo']);
    for (let i = 0; i < 9; i++) a.note('photos');
    expect(got).toContain('photos-10');
    a.note('walkM', 4990); expect(got).not.toContain('walk-5km');
    a.note('walkM', 20); expect(got).toContain('walk-5km');
    a.note('rideGondola'); expect(got).toContain('ride-gondola');
    a.note('photos', -3); a.note('photos', NaN); expect(a.counter('photos')).toBe(10);
  });
});

describe('unlocking: idempotence, scopes, per-game state, sandbox tag', () => {
  it('unlocking is idempotent: one listener call, the first timestamp wins, the reward is owned once', () => {
    let t = 100;
    const bus: GameBus = new EventBus<GameEvents>();
    const a = new Achievements(bus, { runKind: () => 'career', facts: () => FACTS, now: () => t++ });
    a.arm();
    let calls = 0; a.onUnlock(() => calls++);
    expect(a.unlock('first-lift', true)).toBe(true);
    expect(a.unlock('first-lift', true)).toBe(false);
    bus.emit('lift:built', { id: 1, kind: 'chair4' }); bus.emit('day:changed', { year: 1, day: 1 });
    expect(calls).toBe(1); expect(a.record('first-lift')!.at).toBe(100);
    expect(a.profileData().cosmetics.owned).toEqual(['chair:blue']);
    expect(a.unlock('nope', true)).toBe(false);
  });
  it('events before arm() are ignored (a sandbox starter resort is a gift)', () => {
    const bus: GameBus = new EventBus<GameEvents>();
    const a = new Achievements(bus, { runKind: () => 'sandbox', facts: () => FACTS });
    bus.emit('ops:grooming', { vehicles: 1, tiles: 9 });
    expect(a.unlockedCount()).toBe(0);
  });
  it('sandbox cannot earn career or scenario achievements; any-scope ones count and carry the sandbox tag', () => {
    const s = mk('sandbox', { level: 6 });
    days(s.bus, 1);
    expect(s.got).not.toContain('level-6');
    s.bus.emit('scenario:finished', { id: 'first-tracks', result: 'won', medal: 'gold', score: 1, reason: '' });
    expect(s.got).not.toContain('first-medal');
    s.bus.emit('ops:grooming', { vehicles: 1, tiles: 9 });
    expect(s.got).toEqual(['first-groom']);
    expect(s.a.record('first-groom')!.sandbox).toBe(true);
    const c = mk('career'); c.bus.emit('ops:grooming', { vehicles: 1, tiles: 9 });
    expect(c.a.record('first-groom')!.sandbox).toBeUndefined();
    // a career game cannot earn scenario-scope medals either
    const k = mk('career'); k.bus.emit('scenario:finished', { id: 'first-tracks', result: 'won', medal: 'gold', score: 1, reason: '' });
    expect(k.got).toEqual([]);
    for (const d of ACHIEVEMENTS) { expect(s.a.eligible(d, 'sandbox'), d.id).toBe(d.scope === 'any'); expect(s.a.eligible(d, 'scenario'), d.id).toBe(d.scope !== 'career'); expect(s.a.eligible(d, 'career'), d.id).toBe(d.scope !== 'scenario'); }
  });
  it('per-game state survives save / load (a window opened before the save completes after it); profile data is separate', () => {
    const one = mk();
    one.bus.emit('season:changed', { season: 'winter', previous: 'autumn' });
    days(one.bus, 20);
    for (const k of Object.keys(LIFTS).slice(0, 4)) one.bus.emit('lift:built', { id: 1, kind: k });
    const saved = JSON.parse(JSON.stringify(one.a.serializeRun()));
    const two = mk(); two.a.loadRun(saved);
    expect(two.a.gameId).toBe('gtest');
    expect(two.a.progress(ACHIEVEMENT_BY_ID['quiet-mountain']!)!.value).toBe(20);
    expect(two.a.progress(ACHIEVEMENT_BY_ID['all-lifts']!)!.value).toBe(4);
    two.bus.emit('season:changed', { season: 'spring', previous: 'winter' });
    expect(two.got).toContain('safe-winter');
    // hostile run data is cleaned
    two.a.loadRun({ n: { a: -1, b: 'x', c: 4 }, sets: { s: [1, 'x'] }, win: { w: 7, v: 1 } });
    expect(two.a.serializeRun().n).toEqual({ c: 4 }); expect(two.a.serializeRun().sets).toEqual({ s: ['x'] }); expect(two.a.serializeRun().win).toEqual({ v: 1 });
    two.a.loadRun(null); expect(two.a.serializeRun().n).toEqual({});
  });
});

describe('profile persistence', () => {
  it('unlocks survive deleting every save slot and a reload (own IndexedDB database)', async () => {
    const f = new IDBFactory();
    const store = new ProfileStore(f, { getItem: () => null, setItem: () => {}, removeItem: () => {} });
    const bus: GameBus = new EventBus<GameEvents>();
    const a = new Achievements(bus, { runKind: () => 'career', facts: () => FACTS, now: () => 1234 });
    a.onPersist((d) => { void store.update((p) => { p.achievements = JSON.parse(JSON.stringify(d)); }); });
    a.arm();
    bus.emit('ops:grooming', { vehicles: 1, tiles: 9 });
    bus.emit('guest:arrived', { id: 1 });
    a.flush();
    await store.update(() => {}); // drain
    // a save slot exists, then is deleted
    const saves = new IdbStore(f);
    await saves.put('slot1', new Uint8Array([1, 2, 3]), { meta: {} as never, auto: false, seed: 1 });
    await saves.delete('slot1');
    expect(await saves.list()).toEqual([]);
    const again = new ProfileStore(f, { getItem: () => null, setItem: () => {}, removeItem: () => {} });
    await again.ready;
    expect(Object.keys(again.getProfile().achievements.unlocked).sort()).toEqual(['first-groom', 'first-guest']);
    expect(again.getProfile().achievements.unlocked['first-groom']!.at).toBe(1234);
    a.unlock('first-photo', true); a.flush(); await store.update(() => {});
    const third = new ProfileStore(f, { getItem: () => null, setItem: () => {}, removeItem: () => {} }); await third.ready;
    expect(third.getProfile().achievements.cosmetics.owned).toEqual(['frame:alpine']);
    // a second engine loads it and does not unlock twice
    const bus2: GameBus = new EventBus<GameEvents>(); const b = new Achievements(bus2, { runKind: () => 'career', facts: () => FACTS });
    b.loadProfile(again.getProfile().achievements); b.arm();
    let n = 0; b.onUnlock(() => n++);
    bus2.emit('ops:grooming', { vehicles: 1, tiles: 9 }); expect(n).toBe(0);
    expect(b.owns('frame:alpine')).toBe(false); // `again` was read before the third unlock: only what was persisted by then
  });
  it('resetProfile clears achievements, cosmetics and scenario results but not the saves', async () => {
    const f = new IDBFactory();
    const store = new ProfileStore(f, { getItem: () => null, setItem: () => {}, removeItem: () => {} });
    await store.recordResult('first-tracks', { result: 'won', medal: 'gold', score: 10, days: 5 });
    await store.update((p) => { p.achievements.unlocked['first-lift'] = { at: 1 }; p.achievements.cosmetics.owned.push('chair:blue'); });
    const saves = new IdbStore(f); await saves.put('slot1', new Uint8Array([9]), { meta: {} as never, auto: false, seed: 1 });
    await store.resetProfile();
    expect(store.getProfile().scenarios).toEqual({}); expect(store.getProfile().achievements.unlocked).toEqual({}); expect(store.getProfile().achievements.cosmetics.owned).toEqual([]);
    expect((await saves.list()).length).toBe(1);
  });
  it('a corrupt stored profile falls back to an empty one; v1 placeholders migrate', async () => {
    const ls = new Map<string, string>([['slopetycoon.profile', '{not json']]);
    const s = new ProfileStore(undefined, { getItem: (k) => ls.get(k) ?? null, setItem: (k, v) => { ls.set(k, v); }, removeItem: (k) => { ls.delete(k); } });
    await s.ready; expect(s.recovered).toBe(true); expect(s.getProfile().achievements.unlocked).toEqual({});
    ls.set('slopetycoon.profile', JSON.stringify({ v: 1, scenarios: {}, achievements: { first: { at: 5 } } }));
    const t = new ProfileStore(undefined, { getItem: (k) => ls.get(k) ?? null, setItem: () => {}, removeItem: () => {} }); await t.ready;
    expect(t.getProfile().achievements.unlocked).toEqual({}); expect(t.getProfile().v).toBe(2);
  });
});

describe('quiet unlock announcements', () => {
  const def = (id: string) => ACHIEVEMENT_BY_ID[id]!;
  it('one toast per 10 s, queued in order; nothing while held (tutorial) and shown later', () => {
    let now = 0, held = true;
    const shown: string[] = [], boom: string[] = [];
    const an = new AchievementAnnouncer({ show: (d) => shown.push(d.id), confetti: (d) => boom.push(d.id), hold: () => held, now: () => now });
    an.push(def('first-lift')); an.push(def('first-guest')); an.push(def('first-lift'));
    expect(an.pending).toBe(2); expect(shown).toEqual([]);
    held = false; now = 500; an.pump(); expect(shown).toEqual(['first-lift']);
    now = 5000; an.pump(); expect(shown).toEqual(['first-lift']);
    now = 10_600; an.pump(); expect(shown).toEqual(['first-lift', 'first-guest']);
    expect(boom).toEqual([]);
  });
  it('only tier-3 asks for confetti, and the feedback policy decides (Off / reduced motion = none)', () => {
    let now = 0; const boom: string[] = [];
    const an = new AchievementAnnouncer({ show: () => {}, confetti: (d) => boom.push(d.id), hold: () => false, now: () => now });
    an.push(def('roy-gold')); now = 20_000; an.push(def('four-stars')); now = 40_000; an.pump();
    expect(boom).toEqual(['roy-gold']);
    expect(confettiAllowed(feedbackPolicy('subtle'), true)).toBe(true);
    expect(confettiAllowed(feedbackPolicy('off'), true)).toBe(false);
    expect(confettiAllowed(feedbackPolicy('lively', { reducedMotion: true }), true)).toBe(false);
  });
  it('caps the queue (old ones drop from the toast queue, the shelf keeps them)', () => {
    const an = new AchievementAnnouncer({ show: () => {}, confetti: () => {}, hold: () => true, now: () => 0, maxQueue: 3 });
    for (const a of ACHIEVEMENTS.slice(0, 6)) an.push(a);
    expect(an.pending).toBe(3);
  });
});

describe('cosmetics: selection and application', () => {
  it('selection needs ownership; locked / unknown / wrong-kind ids are refused; defaults come back after a reset', () => {
    const { a } = mk();
    expect(a.selected('chair')).toBe('chair:red');
    expect(a.select('chair', 'chair:blue')).toBe(false);
    a.unlock('first-lift', true);
    expect(a.select('chair', 'chair:blue')).toBe(true); expect(a.selected('chair')).toBe('chair:blue');
    expect(a.select('palette', 'chair:blue')).toBe(false); expect(a.select('palette', 'palette:nope')).toBe(false);
    let n = 0; a.onCosmetics(() => n++);
    a.resetProfile();
    expect(n).toBe(1); expect(a.selected('chair')).toBe('chair:red'); expect(a.owns('chair:blue')).toBe(false);
  });
  it('a locked item selected in a stale profile falls back to the default', () => {
    const { a } = mk();
    a.loadProfile({ v: 1, unlocked: {}, counters: {}, cosmetics: { owned: [], selected: { palette: 'palette:slate' } } });
    expect(a.selected('palette')).toBe('palette:classic');
  });
  it('building palette: roof / wood materials re-tint live; the default palette gives the identical colours', () => {
    const reg = new BuildingMeshes();
    const g = reg.create('chalet', undefined, 3);
    const mats = (g.children as THREE.Mesh[]).map((m) => m.material as THREE.MeshLambertMaterial);
    const base = mats.map((m) => m.color.getHex());
    const slate = COSMETIC_BY_ID['palette:slate']!.palette!;
    reg.setPalette(slate);
    const tinted = mats.map((m) => m.color.getHex());
    expect(tinted.some((c, i) => c !== base[i]), 'a palette changes at least one layer').toBe(true);
    reg.setPalette(COSMETIC_BY_ID['palette:classic']!.palette!);
    expect(mats.map((m) => m.color.getHex())).toEqual(base);
    reg.setPalette(null);
    expect(mats.map((m) => m.color.getHex())).toEqual(base);
    reg.setPalette(slate);
    const later = reg.create('cafe', undefined, 3); // materials created after the switch use it too
    expect((later.children as THREE.Mesh[]).some((m) => (m.material as THREE.MeshLambertMaterial).color.getHex() !== new THREE.Color(1, 1, 1).getHex())).toBe(true);
    reg.dispose();
  });
  it('lift chair colour: a colour changes the chair geometry, the default is byte-identical', () => {
    const def = geometryHash(buildChairGeometry(4, false, false, false));
    expect(geometryHash(buildChairGeometry(4, false, false, false, undefined))).toBe(def);
    expect(geometryHash(buildChairGeometry(4, false, false, false, 0x2f6fb3))).not.toBe(def);
    expect(geometryHash(buildChairGeometry(4, false, true, true, 0x3f9a55))).not.toBe(geometryHash(buildChairGeometry(4, false, true, true)));
  });
  it('village flags: bunting adds pennants only when a set is chosen (default unchanged), and none again afterwards', () => {
    const vd = new VillageDecor(() => 0);
    const env = { size: 64, blocked: () => false };
    vd.build({ x: 20, y: 20, w: 4, h: 3 }, env, 1);
    const count = (): number => vd.plants.geometry.getAttribute('position')?.count ?? 0, wood = (): number => vd.wood.geometry.getAttribute('position')?.count ?? 0;
    const p0 = count(), w0 = wood();
    vd.setFlags(COSMETIC_BY_ID['flags:festival']!.flags!.colors);
    expect(count()).toBeGreaterThan(p0); expect(wood()).toBeGreaterThan(w0);
    vd.setFlags([]);
    expect(count()).toBe(p0); expect(wood()).toBe(w0);
    vd.dispose();
  });
});

describe('headless integration', () => {
  const run = (defer = false) => {
    const sim = createSim({ size: 64, seed: 1, now: () => 0, ...(defer ? { deferAchievements: true } : {}) });
    const bot = new Bot(sim);
    runBot(sim, bot, 180);
    return sim;
  };
  it('a bot year on the starter map unlocks a sensible, deterministic set; stateHash is unchanged by the trackers', () => {
    const a = run(), b = run(true);
    const ids = a.achievements.unlockedIds();
    for (const must of ['first-guest', 'first-lift', 'first-groom', 'first-rescue', 'black-month', 'guests-1000']) expect(ids, must).toContain(must);
    for (const never of ['first-photo', 'walk-5km', 'ride-gondola', 'scenario-gold']) expect(ids, never).not.toContain(never); // render-only / scenario-only
    expect(b.achievements.unlockedIds()).toEqual([]); // deferred = never armed
    expect(stateHash(a).hash).toBe(stateHash(b).hash);
    expect(Object.keys(stateHash(a).parts)).not.toContain('achievementsRun');
    expect(ids).toMatchSnapshot(); // the snapshot pins the deterministic set across runs
  }, 120_000);
  it('the achievementsRun module round-trips through collectSave / applySave', () => {
    const sim = createSim({ size: 64, seed: 2, now: () => 0 });
    const bot = new Bot(sim); runBot(sim, bot, 25);
    const before = sim.achievements.serializeRun();
    expect(Object.keys(before.n).length).toBeGreaterThan(0);
    const save = JSON.parse(JSON.stringify(collectSave(sim)));
    expect(save.achievementsRun.v).toBe(1);
    const other = createSim({ size: 64, seed: 2, now: () => 0, fromSave: save });
    expect(other.achievements.serializeRun()).toEqual(before);
    delete save.achievementsRun;
    const old = createSim({ size: 64, seed: 2, now: () => 0, fromSave: save });
    expect(old.achievements.serializeRun().n).toEqual({});
    void applySave;
  }, 60_000);
});
