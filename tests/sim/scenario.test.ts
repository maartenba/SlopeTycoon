import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/EventBus';
import type { GameEvents } from '../../src/core/events';
import { SCENARIOS, getScenario, scenarioSimOptions } from '../../src/config/scenarios';
import { deadlineDays, maxScore, validateScenario, type ScenarioDef } from '../../src/sim/scenario/ScenarioDef';
import { ScenarioRunner, computeScore, compare, evalFact, medalFor, timeLabel, type ScenarioWorld } from '../../src/sim/scenario/ScenarioRunner';
import { emptyFacts } from '../../src/sim/goals/Goals';
import { createSim, type Sim } from '../../src/game/createSim';
import { Bot, runBot } from '../../src/game/bot';
import { collectSave, applySave, stateHash } from '../../src/game/saveState';
import { SAVE_MODULES } from '../../src/game/saveState';

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;
const base = (): ScenarioDef => clone(SCENARIOS[0]!);
const errs = (raw: unknown): string => validateScenario(raw).errors.join(' | ');

describe('scenario schema validator', () => {
  it('all six shipped scenarios are valid, unique and in the picker order', () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual(['first-tracks', 'family-valley', 'powder-dreams', 'summer-escape', 'alpine-giant', 'safe-slopes']);
    expect(new Set(SCENARIOS.map((s) => s.seed + ':' + s.mapSize)).size).toBe(6);
    for (const s of SCENARIOS) { const r = validateScenario(s); expect(r.errors, s.id).toEqual([]); expect(r.ok).toBe(true); }
  });
  it('rejects an unknown key (top level, nested, objective) with the path', () => {
    expect(errs({ ...base(), colour: 'red' })).toMatch(/colour: unknown key/);
    const m = base(); (m.modifiers as Record<string, unknown>).gravity = 2; expect(errs(m)).toMatch(/modifiers\.gravity: unknown key/);
    const o = base(); (o.objectives[0] as unknown as Record<string, unknown>).extra = 1; expect(errs(o)).toMatch(/objectives\[0\]\.extra: unknown key/);
  });
  it('rejects out-of-range numbers with a clear message', () => {
    expect(errs({ ...base(), stars: 9 })).toMatch(/stars: must be an integer in 1\.\.5/);
    expect(errs({ ...base(), mapSize: 100 })).toMatch(/mapSize: must be 64, 128 or 256/);
    const m = base(); m.modifiers = { snowMultiplier: 50 }; expect(errs(m)).toMatch(/snowMultiplier: must be a number in 0\.2\.\.3/);
    const g = base(); g.modifiers = { guestMix: { family: 99 } }; expect(errs(g)).toMatch(/guestMix\.family/);
    const w = base(); w.objectives[0]!.weight = 0; expect(errs(w)).toMatch(/weight/);
  });
  it('rejects unknown building ids, lift kinds and gated items', () => {
    const o = base(); o.objectives[2] = { id: 'x', title: 'x', fact: 'buildings', arg: 'castle', op: '>=', target: 1, weight: 5 }; expect(errs(o)).toMatch(/unknown building id 'castle'/);
    const l = base(); l.objectives[2] = { id: 'x', title: 'x', fact: 'liftsOpen', arg: 'rocket', op: '>=', target: 1, weight: 5 }; expect(errs(l)).toMatch(/unknown lift kind 'rocket'/);
    expect(errs({ ...base(), starter: { buildings: ['castle'] } })).toMatch(/unknown building id 'castle'/);
    expect(errs({ ...base(), modifiers: { disabledBuildings: ['castle'] } })).toMatch(/unknown building id/);
    expect(errs({ ...base(), unlocks: ['lift:warp'] })).toMatch(/unknown gated item/);
  });
  it('rejects unknown facts, missing / extra arguments and bad comparators', () => {
    const o = base(); o.objectives[0] = { ...o.objectives[0]!, fact: 'moonPhase' as never }; expect(errs(o)).toMatch(/unknown fact 'moonPhase'/);
    const a = base(); a.objectives[0] = { ...a.objectives[0]!, arg: 3 }; expect(errs(a)).toMatch(/takes no argument/);
    const b = base(); b.objectives[2] = { id: 'x', title: 'x', fact: 'buildings', op: '>=', target: 1, weight: 5 }; expect(errs(b)).toMatch(/needs an argument/);
    const c = base(); c.objectives[0] = { ...c.objectives[0]!, op: '=!' as never }; expect(errs(c)).toMatch(/op: must be one of/);
    const d = base(); d.objectives[0] = { ...d.objectives[0]!, fact: 'level' }; expect(errs(d)).toMatch(/'level' needs unlocks: 'career'/);
  });
  it('rejects deadlines <= 0, fractional, several units, absurdly long, and objective deadlines / holds past the end', () => {
    expect(errs({ ...base(), deadline: { days: 0 } })).toMatch(/deadline must be a positive whole number \(> 0\)/);
    expect(errs({ ...base(), deadline: { months: -2 } })).toMatch(/> 0/);
    expect(errs({ ...base(), deadline: { days: 3 } })).toMatch(/between 7 days and 10 years/);
    expect(errs({ ...base(), deadline: { days: 10, years: 1 } })).toMatch(/exactly one of/);
    expect(errs({ ...base(), deadline: { years: 50 } })).toMatch(/between 7 days/);
    const by = base(); by.objectives[0]!.by = { years: 3 }; expect(errs(by)).toMatch(/after the scenario deadline/);
    const hold = base(); hold.objectives[0]!.hold = 400; expect(errs(hold)).toMatch(/hold/);
  });
  it('requires a mandatory goal, unique ids, resolvable medal references, ordered thresholds, a reachable gold score and an empty bronze', () => {
    const m = base(); m.objectives.forEach((o) => { delete o.mandatory; }); expect(errs(m)).toMatch(/at least one objective must be mandatory/);
    const cp = base(); cp.objectives = [{ id: 'cap', title: 'c', fact: 'incidents', arg: 'created', op: '<=', target: 5, weight: 10, mandatory: true }]; cp.medals = { bronze: {}, silver: {}, gold: {} }; expect(errs(cp)).toMatch(/must be a goal/);
    const d = base(); d.objectives[1]!.id = d.objectives[0]!.id; expect(errs(d)).toMatch(/duplicate objective id/);
    const r = base(); r.medals.gold = { objectives: ['nope'], minScore: 10 }; expect(errs(r)).toMatch(/unknown objective id 'nope'/);
    const o = base(); o.medals.silver = { minScore: 100 }; o.medals.gold = { minScore: 50 }; expect(errs(o)).toMatch(/must grow bronze/);
    const hi = base(); hi.medals.gold = { minScore: 99999 }; expect(errs(hi)).toMatch(/above the best possible score/);
    const br = base(); br.medals.bronze = { minScore: 5 }; expect(errs(br)).toMatch(/bronze is awarded/);
  });
  it('rejects non-objects, bad slugs and a starter building that is also disabled', () => {
    expect(validateScenario(null).ok).toBe(false); expect(validateScenario([]).ok).toBe(false);
    expect(errs({ ...base(), id: 'Bad Id' })).toMatch(/id: must be a lower-case slug/);
    expect(errs({ ...base(), starter: { buildings: ['cafe'] }, modifiers: { disabledBuildings: ['cafe'] } })).toMatch(/also in disabledBuildings/);
  });
  it('the validator never throws on hostile input', () => {
    for (const x of [undefined, 1, 'x', { objectives: 5 }, { medals: [] }, { modifiers: 3, deadline: 'soon', failure: null, score: [] }]) expect(() => validateScenario(x)).not.toThrow();
  });
  it('each scenario lies in a sane budget: 5-10 objectives, >= 1 optional objective, tagline short, fixed seed 0..999999999', () => {
    for (const s of SCENARIOS) {
      expect(s.objectives.length, s.id).toBeGreaterThanOrEqual(5); expect(s.objectives.length, s.id).toBeLessThanOrEqual(10);
      expect(s.objectives.some((o) => !o.mandatory), s.id).toBe(true);
      expect(s.tagline.length, s.id).toBeLessThanOrEqual(90);
      expect(maxScore(s), s.id).toBeGreaterThanOrEqual(s.medals.gold.minScore ?? 0);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------- objective evaluation (fixtures)

interface Fx { stars: number; money: number; debt: number; lifetime: number; day: number; buildings: Array<{ type: string; active: boolean }>; hospitalised: number; created: number; family: boolean; season: 'winter' | 'summer'; open: boolean; level: number; happy: number }
function world(fx: Partial<Fx> = {}): { w: ScenarioWorld; fx: Fx; facts: ReturnType<typeof emptyFacts> } {
  const f: Fx = { stars: 1, money: 100_000, debt: 0, lifetime: 0, day: 0, buildings: [], hospitalised: 0, created: 0, family: false, season: 'winter', open: true, level: 1, happy: 0.8, ...fx };
  const facts = emptyFacts();
  const w: ScenarioWorld = {
    buildings: () => f.buildings.map((b) => ({ ...b, x: 0, y: 0, w: 1, h: 1 })), lifts: () => [{ kind: 'chair4', open: true, x: 0, y: 0 }], pistes: () => [{ difficulty: 1, tiles: 10, x: 0, y: 0 }, { difficulty: 3, tiles: 6, x: 0, y: 0 }],
    trailTiles: () => 12, stars: () => f.stars, money: () => f.money, debt: () => f.debt, grant: () => {},
    facts: () => ({ ...facts, lifetime: f.lifetime }), mtbTiles: () => 5, hikeTiles: () => 7, highTrailTiles: () => 3, happiness: () => f.happy, familyHappiness: () => f.happy,
    annualProfit: () => 50_000, lastMonthNet: () => 12_000, incidents: (k) => (k === 'hospitalised' ? f.hospitalised : f.created), level: () => f.level,
    openNow: () => f.open, season: () => f.season, isFamily: () => f.family, today: () => f.day,
  };
  return { w, fx: f, facts };
}
const def = (over: Partial<ScenarioDef> = {}): ScenarioDef => ({ ...clone(SCENARIOS[0]!), ...over });
function runner(d: ScenarioDef, fx: Partial<Fx> = {}) {
  const bus = new EventBus<GameEvents>(); const ww = world(fx);
  const r = new ScenarioRunner(d, () => ww.w, bus);
  const log: Array<[string, unknown]> = [];
  bus.on('scenario:objective', (e) => log.push(['objective', e.id])); bus.on('scenario:finished', (e) => log.push(['finished', e]));
  r.begin();
  const day = (n = 1): void => { for (let i = 0; i < n; i++) { ww.fx.day++; bus.emit('day:changed', { year: 1, day: ww.fx.day }); } };
  return { r, bus, ...ww, day, log };
}

describe('objective evaluation', () => {
  it('comparators and fact catalogue read the world', () => {
    expect(compare(3, '>=', 3)).toBe(true); expect(compare(3, '>', 3)).toBe(false); expect(compare(2, '<=', 3)).toBe(true); expect(compare(3, '<', 3)).toBe(false);
    const { w, fx } = world({ buildings: [{ type: 'cafe', active: true }, { type: 'cafe', active: false }, { type: 'shop', active: true }], lifetime: 77 });
    const c = { family: 4, summer: 5, openDays: 6, happy: 0.7, famHappy: 0.9 };
    expect(evalFact(w, 'buildings', 'cafe', c)).toBe(1); expect(evalFact(w, 'lifetimeGuests', undefined, c)).toBe(77);
    expect(evalFact(w, 'pisteTiles', undefined, c)).toBe(16); expect(evalFact(w, 'pisteTiles', 3, c)).toBe(6); expect(evalFact(w, 'liftsOpen', 'gondola6', c)).toBe(0); expect(evalFact(w, 'liftKinds', undefined, c)).toBe(1);
    expect(evalFact(w, 'familyGuests', undefined, c)).toBe(4); expect(evalFact(w, 'openDays', undefined, c)).toBe(6); expect(evalFact(w, 'happiness', undefined, c)).toBeCloseTo(70);
    expect(evalFact(w, 'incidents', 'hospitalised', c)).toBe(fx.hospitalised);
  });
  it('>= objectives latch; the scenario is READY (not won) when the mandatory ones are met, and wins automatically at the deadline', () => {
    const d = def();
    const t = runner(d, { stars: 3, lifetime: 600 });
    t.day();
    expect(t.r.state('guests')!.met).toBe(true); expect(t.r.ready).toBe(true); expect(t.r.finished).toBeNull();
    t.fx.stars = 1; t.day(); expect(t.r.state('stars')!.met, 'latched').toBe(true);
    t.day(deadlineDays(d.deadline));
    expect(t.r.finished).toMatchObject({ result: 'won', reason: expect.stringContaining('Deadline') });
  });
  it('finishNow banks the medal with the speed bonus; refused when not ready', () => {
    const d = def();
    const t = runner(d, { stars: 3, lifetime: 100 });
    t.day(); expect(t.r.finishNow()).toBe(false); expect(t.r.ready).toBe(false);
    t.fx.lifetime = 600; t.day(5);
    expect(t.r.medalNow()).toBe('bronze');
    expect(t.r.finishNow()).toBe(true);
    const f = t.r.finished!;
    expect(f.result).toBe('won'); expect(f.medal).toBe('bronze'); expect(f.score).toBeGreaterThan(70); // 40 + 30 + most of the 30 speed bonus
    expect(t.log.filter((x) => x[0] === 'finished').length).toBe(1);
  });
  it('wins at once when EVERY objective is met', () => {
    const d = def();
    const all = def({ objectives: [
      { id: 'a', title: 'a', fact: 'lifetimeGuests', op: '>=', target: 100, weight: 10, mandatory: true },
      { id: 'b', title: 'b', fact: 'stars', op: '>=', target: 3, weight: 10 }], medals: { bronze: {}, silver: {}, gold: {} } });
    const t = runner(all, { stars: 2, lifetime: 500 });
    t.day(); expect(t.r.finished).toBeNull(); expect(t.r.ready).toBe(true);
    t.fx.stars = 3; t.day();
    expect(t.r.finished).toMatchObject({ result: 'won', reason: 'Every objective met.' });
    expect(d.objectives.length).toBeGreaterThan(0);
  });
  it('<= caps on monotonic facts fail for good (and fail the scenario when mandatory); caps on non-monotonic facts follow the value', () => {
    const d = def({ objectives: [
      { id: 'g', title: 'g', fact: 'lifetimeGuests', op: '>=', target: 99999, weight: 10, mandatory: true },
      { id: 'cap', title: 'cap', fact: 'incidents', arg: 'created', op: '<=', target: 2, weight: 10 },
      { id: 'debt', title: 'debt', fact: 'debt', op: '<=', target: 0, weight: 10 }], medals: { bronze: {}, silver: {}, gold: {} } });
    const t = runner(d, { debt: 500 });
    t.day(); expect(t.r.state('debt')!.met).toBe(false); t.fx.debt = 0; t.day(); expect(t.r.state('debt')!.met).toBe(true); t.fx.debt = 9; t.day(); expect(t.r.state('debt')!.met).toBe(false);
    t.fx.created = 3; t.day(); expect(t.r.state('cap')!.failed).toBe(true); t.fx.created = 0; t.day(); expect(t.r.state('cap')!.failed, 'stays failed').toBe(true);
    const m = runner(def({ objectives: [{ id: 'g', title: 'g', fact: 'lifetimeGuests', op: '>=', target: 99999, weight: 10, mandatory: true }, { id: 'cap', title: 'cap', fact: 'incidents', arg: 'created', op: '<=', target: 2, weight: 10, mandatory: true }], medals: { bronze: {}, silver: {}, gold: {} } }));
    m.day(); m.fx.created = 5; m.day();
    expect(m.r.finished).toMatchObject({ result: 'lost', reason: expect.stringContaining('Objective failed') });
  });
  it('hold: must stay met N consecutive days; resets when broken; then latched', () => {
    const d = def({ objectives: [{ id: 'h', title: 'h', fact: 'stars', op: '>=', target: 4, weight: 10, mandatory: true, hold: 3 }], medals: { bronze: {}, silver: {}, gold: {} } });
    const t = runner(d, { stars: 4 });
    t.day(); expect(t.r.state('h')!.met).toBe(false); // begin + 1 day = 2 of 3
    t.fx.stars = 3; t.day(); expect(t.r.state('h')!.hold).toBe(0);
    t.fx.stars = 4; t.day(2); expect(t.r.state('h')!.met).toBe(false); t.day(); expect(t.r.finished?.result).toBe('won');
  });
  it("objective deadline 'by': fails when not met in time", () => {
    const d = def({ objectives: [
      { id: 'a', title: 'a', fact: 'lifetimeGuests', op: '>=', target: 100, weight: 10, mandatory: true, by: { days: 10 } }], medals: { bronze: {}, silver: {}, gold: {} } });
    const t = runner(d); t.day(9); expect(t.r.finished).toBeNull(); t.day(2);
    expect(t.r.finished).toMatchObject({ result: 'lost' });
  });
  it('failure conditions: bankruptcy, rating below X for N months, time up (not ready)', () => {
    const a = runner(def()); a.bus.emit('finance:declaredBankrupt', { money: -1, day: 1, reason: 'declared' });
    expect(a.r.finished).toMatchObject({ result: 'lost', medal: 'none', reason: expect.stringContaining('bankrupt') });
    const d = def({ failure: { bankrupt: true, ratingBelow: { stars: 2, months: 2 } } });
    const b = runner(d, { stars: 1.5 }); b.day(28); expect(b.r.finished).toBeNull(); b.day();
    expect(b.r.finished).toMatchObject({ result: 'lost', reason: expect.stringContaining('below 2') });
    const c = runner(def({ failure: { bankrupt: false } })); c.bus.emit('finance:declaredBankrupt', { money: -1, day: 1, reason: 'declared' }); expect(c.r.finished).toBeNull();
    const t = runner(def()); t.day(deadlineDays(def().deadline)); expect(t.r.finished).toMatchObject({ result: 'lost', reason: 'Time is up.' });
  });
  it('rating recovery resets the below-X month counter', () => {
    const d = def({ failure: { bankrupt: true, ratingBelow: { stars: 2, months: 2 } } });
    const t = runner(d, { stars: 1.5 }); t.day(20); t.fx.stars = 3; t.day(); t.fx.stars = 1.5; t.day(28);
    expect(t.r.finished).toBeNull();
  });
  it('medal thresholds: bronze on a plain win, silver / gold need their objectives AND the score', () => {
    const d = SCENARIOS[0]!;
    const met = new Set(['guests', 'stars']);
    expect(medalFor(d, met, 70)).toBe('bronze');
    expect(medalFor(d, new Set(['guests', 'stars', 'school', 'profit', 'guests3k']), d.medals.silver.minScore!)).toBe('silver');
    expect(medalFor(d, new Set(d.medals.gold.objectives), d.medals.gold.minScore!)).toBe('gold');
    expect(medalFor(d, new Set(d.medals.gold.objectives), 0), 'objectives without the score').toBe('bronze');
  });
  it('score = points + speed bonus x time left + margin bonus (clamped)', () => {
    const d = def({ score: { speedBonus: 40, marginBonus: 20, margin: { fact: 'money', par: 100_000 } } });
    const total = deadlineDays(d.deadline);
    expect(computeScore(d, new Set(['guests']), 0, 0)).toBe(40 + 40);
    expect(computeScore(d, new Set(['guests']), total / 2, 50_000)).toBe(40 + 20 + 10);
    expect(computeScore(d, new Set(), total * 2, 1e9)).toBe(20);
  });
  it('timeLabel uses the game calendar: 180-day years, 15-day months', () => {
    expect(timeLabel(0, 180)).toBe('Year 1, Month 1 \u00B7 180 days left');
    expect(timeLabel(41 + 180 + 30, 540)).toBe('Year 2, Month 4 \u00B7 289 days left'.replace('Month 4', 'Month ' + (Math.floor(((41 + 30) % 180) / 15) + 1)).replace('289', String(540 - 251)));
    expect(timeLabel(179, 180)).toBe('Year 1, Month 12 \u00B7 1 day left');
    expect(timeLabel(999, 180)).toContain('0 days left');
  });
  it('serialize / load restores everything; another scenario id or version is refused', () => {
    const t = runner(def(), { stars: 3, lifetime: 600 }); t.day(3);
    const s = JSON.parse(JSON.stringify(t.r.serialize()));
    const u = runner(def()); expect(u.r.load(s)).toBe(true);
    expect(JSON.stringify(u.r.serialize())).toBe(JSON.stringify(s));
    expect(u.r.load({ ...s, id: 'other-one' })).toBe(false); expect(u.r.load({ ...s, v: 99 })).toBe(false); expect(u.r.load(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------- real sim

const mk = (id: string, extra: Partial<Parameters<typeof createSim>[0]> = {}): Sim => createSim({ ...scenarioSimOptions(getScenario(id)!), now: () => 0, ...extra });

describe('scenario in the sim', () => {
  it('createSim wires the runner, rules and start state from the definition', () => {
    const s = mk('alpine-giant');
    expect(s.scenario).toBeTruthy(); expect(s.config.scenario).toBe('alpine-giant'); expect(s.size).toBe(256);
    expect(s.loans.totalDebt()).toBe(400_000); expect(s.game.money).toBe(250_000 + 400_000);
    expect(s.progression.mode).toBe('sandbox');
    expect(s.goals.paused).toBe(true);
    const f = mk('first-tracks'); expect(f.size).toBe(64); expect(f.config.scenario).toBe('first-tracks');
    expect(createSim({ size: 64, seed: 1, now: () => 0 }).scenario).toBeNull();
  });
  it('rule hooks: no loans, cost multipliers, disabled buildings, guest mix, bears, avalanche and incident bias, weather', () => {
    const d = getScenario('safe-slopes')!;
    const s = mk('safe-slopes');
    expect(s.safety.wildlife.bearsOverride).toBe(4); expect(s.safety.avalanche.gainMult).toBe(3); expect(s.weather.harsh).toBe(1.5);
    expect(s.guestSim.injuryMult).toBeCloseTo(s.difficulty.incidents * 2.5);
    const f = mk('family-valley'); expect(f.guestSim.spawner.mixBias).toEqual([0.6, 1, 2.5, 1, 1, 0.6]);
    const p = mk('powder-dreams'); expect(p.snow.snowfallMult).toBe(0.3);
    expect(d.modifiers.bearsMax).toBe(4);
  });
  it('modifier hooks with explicit values (a patched definition)', () => {
    const d = getScenario('first-tracks')!;
    const saved = d.modifiers;
    d.modifiers = { noLoans: true, costMultipliers: { construction: 2, upkeep: 0.5, wages: 2 }, disabledBuildings: ['cafe'] };
    try {
      const s = mk('first-tracks');
      expect(s.loans.disabled).toBe(true);
      expect(s.loans.take('starter', s.creditCtx(), { year: 1, month: 0 })).toMatchObject({ ok: false, reason: 'No loans in this scenario' });
      expect(s.loans.offers(s.creditCtx()).every((o) => !o.available)).toBe(true);
      expect(s.progression.locked('building', 'cafe')).toBe('Not available in this scenario');
      expect(s.progression.locked('building', 'shop')).toBeNull();
      expect(s.economy.constructionMultiplier()).toBeCloseTo(2 * 1); // winter start: season factor 1
      s.progression.unlockAll = true; expect(s.progression.locked('building', 'cafe'), 'sandbox continue releases it').toBeNull();
    } finally { d.modifiers = saved; }
  });
  it('snowMultiplier changes snow depth (same seed / weather, fewer centimetres)', () => {
    const o = scenarioSimOptions(getScenario('powder-dreams')!);
    const withRule = createSim({ ...o, now: () => 0 }), without = createSim({ ...o, scenario: undefined, now: () => 0 });
    withRule.tick(240 * 40); without.tick(240 * 40);
    const sum = (s: Sim): number => s.grid.snowDepth.reduce((a, v) => a + v, 0);
    expect(sum(withRule)).toBeLessThan(sum(without));
  });
  it('guestMix changes the family share of arrivals', () => {
    const share = (id: string | null): number => {
      const o = scenarioSimOptions(getScenario('family-valley')!);
      const s = createSim({ ...o, ...(id ? {} : { scenario: undefined }), now: () => 0 });
      const bot = new Bot(s, { policy: null, expand: false, marketing: false });
      let fam = 0, all = 0;
      s.bus.on('guest:arrived', (e) => { all++; const sl = s.guestSim.store.slotOf(e.id); if (sl >= 0 && s.guestSim.store.type[sl] === 2) fam++; });
      runBot(s, bot, 30);
      return all ? fam / all : 0;
    };
    const a = share('family-valley'), b = share(null);
    expect(a).toBeGreaterThan(b + 0.1);
  });
  it('is deterministic: two runs of the same scenario give the same state hash and the same runner state', () => {
    const run = (): { h: string; sc: string } => { const s = mk('first-tracks'); runBot(s, new Bot(s), 20); return { h: stateHash(s).hash, sc: JSON.stringify(s.scenario!.serialize()) }; };
    const a = run(), b = run();
    expect(a.h).toBe(b.h); expect(a.sc).toBe(b.sc);
  });
  it('save module `scenario`: id + version + progress round-trip mid-scenario; the restored game keeps its rules and start day', () => {
    const s = mk('first-tracks'); const bot = new Bot(s); runBot(s, bot, 20);
    const mod = SAVE_MODULES.find((m) => m.key === 'scenario')!;
    expect(mod.version).toBe(1);
    const modules = JSON.parse(JSON.stringify(collectSave(s)));
    expect(modules.scenario.data).toMatchObject({ id: 'first-tracks', v: 1 });
    const r = createSim({ size: s.size, seed: s.seed, now: () => 0, fromSave: modules });
    expect(r.scenario).toBeTruthy(); expect(r.config.scenario).toBe('first-tracks');
    expect(JSON.stringify(r.scenario!.serialize())).toBe(JSON.stringify(s.scenario!.serialize()));
    expect(r.scenario!.view().elapsed).toBe(s.scenario!.view().elapsed);
    // keeps running from the same clock
    s.tick(240 * 5); r.tick(240 * 5);
    expect(r.scenario!.view().elapsed).toBeGreaterThanOrEqual(20); expect(r.scenario!.view().elapsed).toBe(s.scenario!.view().elapsed);
  });
  it('an old save (no scenario module, no config.scenario) loads as a normal game without a scenario', () => {
    const s = createSim({ size: 64, seed: 5, now: () => 0 });
    const modules = JSON.parse(JSON.stringify(collectSave(s)));
    delete modules.scenario;
    const r = createSim({ size: 64, seed: 5, now: () => 0, fromSave: modules });
    expect(r.scenario).toBeNull(); expect(r.config.scenario).toBeNull();
    expect(applySave(createSim({ size: 64, seed: 5, now: () => 0 }), modules).missing).toContain('scenario');
  });
  it('a scenario save that lost its scenario data restarts the scenario clock instead of timing out at once', () => {
    const s = mk('first-tracks'); s.tick(240 * 3);
    const modules = JSON.parse(JSON.stringify(collectSave(s)));
    modules.scenario.data = { ...modules.scenario.data, id: 'someone-else' };
    const r = createSim({ size: s.size, seed: s.seed, now: () => 0, fromSave: modules });
    expect(r.scenario!.finished).toBeNull(); expect(r.scenario!.view().elapsed).toBeLessThan(2);
  });
  it('forceResult ends the scenario with the requested result; continueSandbox releases the rules', () => {
    const s = mk('first-tracks'); const events: string[] = [];
    s.bus.on('scenario:finished', (e) => events.push(`${e.result}:${e.medal}`));
    s.scenario!.forceResult('won'); expect(events).toEqual(['won:bronze']); s.scenario!.forceResult('lost'); expect(events.length, 'only once').toBe(1);
    s.scenario!.continueSandbox(); expect(s.scenario!.sandbox).toBe(true); expect(s.scenario!.active).toBe(false);
    const l = mk('first-tracks'); l.scenario!.forceResult('lost');
    expect(l.scenario!.finished).toMatchObject({ result: 'lost', medal: 'none' });
  });
});
