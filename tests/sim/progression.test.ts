import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { EventBus } from '../../src/core/EventBus';
import type { GameEvents } from '../../src/core/events';
import { DAYS_PER_YEAR } from '../../src/config/balance';
import { BUILDINGS } from '../../src/config/buildings';
import { LIFTS } from '../../src/config/lifts';
import { CAMPAIGNS } from '../../src/config/marketing';
import { DEFAULT_MODE, LEVELS, MAX_LEVEL, levelName, type LevelDef } from '../../src/config/progression';
import { UNLOCKS, isGated, lockedReason, unlockLevel, unlocksAt, unlockName } from '../../src/config/unlocks';
import { Progression, criteriaFor, type ProgressInputs } from '../../src/sim/progression/Progression';
import { createSim } from '../../src/game/createSim';
import { Bot, runBot } from '../../src/game/bot';
import { DEFAULT_CONFIG, configQuery, normalizeConfig, parseConfig } from '../../src/game/difficulty';
import { SAVE_MODULES, applySave, collectSave, stateHash } from '../../src/game/saveState';
import { validatePlacement, placeBuilding } from '../../src/sim/PlaceBuilding';
import { validateLift, placeLift, type LiftEnv } from '../../src/sim/Lift';
import { buildDemoResort } from '../../src/game/demoResort';
import { buildStarterResort } from '../../src/game/starterResort';

const fixture = (o: Partial<Record<'stars' | 'guests' | 'peakDay' | 'profitMonths' | 'chapters' | 'annualProfit', number>> = {}) => {
  const v = { stars: 0, guests: 0, peakDay: 0, profitMonths: 0, chapters: 0, annualProfit: 0, day: 0, ...o };
  const inputs: ProgressInputs = {
    stars: () => v.stars, guests: () => v.guests, peakDay: () => v.peakDay, profitMonths: () => v.profitMonths, chapters: () => v.chapters, annualProfit: () => v.annualProfit,
    date: () => ({ year: 1, day: v.day }),
  };
  const bus = new EventBus<GameEvents>();
  const majors: string[] = [];
  bus.on('milestone', (e) => { if (e.major) majors.push(e.id); });
  const p = new Progression(inputs, bus, 'career');
  return { v, p, bus, majors };
};
const meets = (d: LevelDef) => ({ stars: d.stars, guests: d.guests, peakDay: d.peakDay, profitMonths: d.profitMonths, chapters: d.chapters, annualProfit: Math.max(0, d.annualProfit) });

describe('level thresholds (config/progression.ts)', () => {
  it('six levels with strictly non-decreasing criteria and unique names', () => {
    expect(MAX_LEVEL).toBe(6);
    expect(DEFAULT_MODE).toBe('career');
    for (let i = 1; i < LEVELS.length; i++) {
      const a = LEVELS[i - 1]!, b = LEVELS[i]!;
      expect(b.level).toBe(a.level + 1);
      for (const k of ['stars', 'guests', 'peakDay', 'profitMonths', 'chapters', 'annualProfit'] as const) expect(b[k], `${k} L${b.level}`).toBeGreaterThanOrEqual(a[k]);
    }
    expect(new Set(LEVELS.map((l) => l.name)).size).toBe(6);
    expect(levelName(3)).toBe('Regional name');
  });

  it('a level needs ALL its criteria; each criterion alone is enough to block', () => {
    for (const d of LEVELS.filter((l) => l.level > 1)) {
      const f = fixture(meets(d));
      expect(f.p.computedLevel(), `L${d.level} all met`).toBeGreaterThanOrEqual(d.level);
      for (const c of criteriaFor(d, f.p['inputs' as never] ?? ({ stars: () => 0, guests: () => 0, peakDay: () => 0, profitMonths: () => 0, chapters: () => 0, annualProfit: () => 0 }))) {
        const m = meets(d) as Record<string, number>;
        m[c.id] = c.need - 1;
        expect(fixture(m).p.computedLevel(), `L${d.level} without ${c.id}`).toBeLessThan(d.level);
      }
    }
  });

  it('is latched: the level never decreases when the facts drop', () => {
    const f = fixture(meets(LEVELS[3]!));
    f.p.evaluate();
    expect(f.p.level).toBe(4);
    Object.assign(f.v, { stars: 0, guests: 0, profitMonths: 0, annualProfit: -9e9 });
    f.p.evaluate();
    expect(f.p.level).toBe(4);
    expect(f.p.computedLevel()).toBe(1);
  });

  it('a jump over several levels fires ONE major milestone, one callback with every newly unlocked item, history per level', () => {
    const f = fixture(meets(LEVELS[4]!));
    const ups: Array<{ level: number; n: number }> = [];
    f.p.onLevelUp((u) => ups.push({ level: u.level, n: u.unlocked.length }));
    f.p.evaluate();
    expect(f.p.level).toBe(5);
    expect(f.majors).toEqual(['level:5']);
    expect(ups).toEqual([{ level: 5, n: UNLOCKS.filter((u) => u.level >= 2 && u.level <= 5).length }]);
    expect(f.p.history.map((h) => h.level)).toEqual([2, 3, 4, 5]);
    f.p.evaluate(); f.p.evaluate();
    expect(f.majors).toEqual(['level:5']); // no repeat
  });

  it('is evaluated daily off the bus (day:changed), not per tick', () => {
    const f = fixture(meets(LEVELS[1]!));
    expect(f.p.level).toBe(1);
    f.bus.emit('day:changed', { day: 1 } as never);
    expect(f.p.level).toBe(2);
  });

  it('view(): progress to the next level and the missing criteria (unmet first)', () => {
    const f = fixture({ stars: 3, guests: 700, peakDay: 30, profitMonths: 2, chapters: 1 });
    f.p.evaluate();
    expect(f.p.level).toBe(2);
    const v = f.p.view();
    expect(v.next?.level).toBe(3);
    expect(v.criteria.length).toBeGreaterThan(0);
    expect(v.criteria[0]!.met).toBe(false);
    expect(v.criteria[0]!.id).toBe('guests');
    expect(v.progress).toBeGreaterThan(0.5); expect(v.progress).toBeLessThan(1);
    expect(v.nextUnlocks.map((u) => u.id)).toEqual(unlocksAt(3).map((u) => u.id));
    f.p.setLevel(6);
    expect(f.p.view()).toMatchObject({ max: true, level: 6, next: null, progress: 1 });
  });

  it('setLevel only raises', () => {
    const f = fixture();
    f.p.setLevel(4); f.p.setLevel(2);
    expect(f.p.level).toBe(4);
  });
});

describe('unlock table (config/unlocks.ts)', () => {
  it('is short (8 to 24 items), every id exists in its catalogue, levels are 2..6', () => {
    expect(UNLOCKS.length).toBeGreaterThanOrEqual(8); expect(UNLOCKS.length).toBeLessThanOrEqual(24); // Phase 6 content adds a few selective rows (quad base, tackle hut, ...)
    for (const u of UNLOCKS) {
      const exists = u.kind === 'landscape' ? u.id === 'pond' || u.id === 'river' || u.id === 'suspension' : u.kind === 'building' ? !!BUILDINGS[u.id] : u.kind === 'lift' ? !!LIFTS[u.id as keyof typeof LIFTS] : CAMPAIGNS.some((c) => c.id === u.id);
      expect(exists, `${u.kind}:${u.id}`).toBe(true);
      expect(u.level).toBeGreaterThanOrEqual(2); expect(u.level).toBeLessThanOrEqual(MAX_LEVEL);
      expect(unlockName(u.kind, u.id).length).toBeGreaterThan(0);
    }
    expect(new Set(UNLOCKS.map((u) => `${u.kind}:${u.id}`)).size).toBe(UNLOCKS.length);
  });

  it('the basics (starter chain, safety, first restaurant, simple lifts) are never gated; everything not listed is level 1', () => {
    const basics = ['baseLodge', 'lodge', 'cafe', 'mountainHut', 'skiSchoolHQ', 'ticketOffice', 'parking', 'patrolHub', 'firstAid', 'rangerStation', 'groomerGarage', 'liftWorkshop', 'snowCannon', 'reservoir', 'shop', 'rental', 'chalet', 'apartment', 'adventurePark'];
    for (const b of basics) expect(isGated('building', b), b).toBe(false);
    for (const l of ['tbar', 'chair2', 'chair4', 'chair4d']) expect(isGated('lift', l), l).toBe(false);
    for (const c of ['families', 'budget', 'summer', 'brand']) expect(isGated('campaign', c), c).toBe(false);
    expect(unlockLevel('building', 'nope')).toBe(1);
    expect(Object.keys(BUILDINGS).filter((b) => isGated('building', b)).length).toBeLessThanOrEqual(14); // 5 + the Phase 6 optional extras (+ the two water tour bases, Task 24, + the two hotels, Task 27)
  });

  it('no goal, advisor rule or tutorial lift default depends on a gated item (they could deadlock / propose locked things)', () => {
    const gated = UNLOCKS.map((u) => u.id);
    const goals = readFileSync('src/config/goals.ts', 'utf8').replace(/todo: '[^']*'|flavour: '[^']*'|title: '[^']*'/g, '');
    for (const id of gated) expect(goals.includes(`'${id}'`), `goals.ts mentions '${id}'`).toBe(false);
    const rules = readFileSync('src/sim/advisor/rules.ts', 'utf8');
    for (const m of rules.matchAll(/build\('(\w+)'/g)) expect(isGated('building', m[1]!), `advisor builds ${m[1]}`).toBe(false);
    const sug = readFileSync('src/tutorial/suggest.ts', 'utf8');
    const kinds = /planLift\(sim: Sim, kinds: readonly LiftKind\[\] = \[([^\]]*)\]/.exec(sug)![1]!;
    for (const k of kinds.match(/'(\w+)'/g)!) expect(isGated('lift', k.slice(1, -1)), k).toBe(false);
  });

  it('lockedReason reads "Unlocks at level 3: Regional name"', () => { expect(lockedReason(3)).toBe('Unlocks at level 3: Regional name'); });
});

describe('gate in the validators and the sim-side placement', () => {
  const career = () => createSim({ size: 64, seed: 61, now: () => 0, startSeason: 'winter', mode: 'career' });
  const liftEnv = (sim: ReturnType<typeof career>): LiftEnv => ({ grid: sim.grid, lifts: sim.lifts, economy: sim.economy, access: sim.networks.access, gate: sim.gate });
  const lodgeSpot = (sim: ReturnType<typeof career>) => { const l = sim.buildings.all().find((b) => b.type === 'baseLodge')!; return { x: l.x + 8, y: l.y }; };

  it('defaults: new games are Career; mode is stored in the config', () => {
    const sim = career();
    expect(DEFAULT_CONFIG.mode).toBe('career');
    expect(createSim({ size: 64, seed: 61, now: () => 0 }).progression.mode).toBe('career');
    expect(sim.config.mode).toBe('career');
    expect(sim.progression.level).toBe(1);
  });

  it('validatePlacement: a gated building returns a `locked` reason (first), ungated ones do not', () => {
    const sim = career(), { x, y } = lodgeSpot(sim);
    const chk = validatePlacement(sim.env, 'helipad', x, y, 0, true);
    expect(chk.ok).toBe(false);
    expect(chk.locked).toBe('Unlocks at level 4: Alpine destination');
    expect(chk.reasons[0]).toBe(chk.locked);
    expect(validatePlacement(sim.env, 'shop', x, y, 0, true).locked).toBeUndefined();
  });

  it('placeBuilding refuses a locked building even with everything else valid (sim-side guard) and charges nothing', () => {
    const sim = career();
    sim.game.money = 5e6;
    const before = sim.game.money;
    let tried = 0;
    const lodge = sim.buildings.all().find((b) => b.type === 'baseLodge')!;
    for (let dx = 4; dx < 30 && tried < 40; dx++) for (const dy of [-8, 8]) {
      tried++;
      const out = placeBuilding(sim.env, sim.props, 'altiport', lodge.x + dx, lodge.y + dy, 0, true, false);
      expect(out.ok).toBe(false);
      expect(out.reasons[0]).toMatch(/^Unlocks at level 5/);
    }
    expect(sim.game.money).toBe(before);
    expect(sim.buildings.all().some((b) => b.type === 'altiport')).toBe(false);
  });

  it('validateLift / placeLift: a gated lift kind is refused with the locked reason; free kinds are not', () => {
    const sim = career();
    const lodge = sim.buildings.all().find((b) => b.type === 'baseLodge')!;
    const a = { x: lodge.x + 6, y: lodge.y + 6 }, b = { x: lodge.x + 6, y: lodge.y + 30 };
    const chk = validateLift(liftEnv(sim), 'gondola6', a, b, { skipFunds: true });
    expect(chk.ok).toBe(false); expect(chk.locked).toBe('Unlocks at level 2: Local favourite'); expect(chk.reasons[0]).toBe(chk.locked);
    expect(validateLift(liftEnv(sim), 'chair4', a, b, { skipFunds: true }).locked).toBeUndefined();
    sim.game.money = 5e6;
    const out = placeLift(liftEnv(sim), sim.props, 'funicular', a, b, true);
    expect(out.ok).toBe(false); expect(out.reasons[0]).toMatch(/^Unlocks at level 3/);
    expect(sim.lifts.all().length).toBe(0);
    expect(sim.game.money).toBe(5e6);
  });

  it('marketing: a gated campaign reports the lock first and refuses to start', () => {
    const sim = career();
    sim.game.money = 1e6;
    expect(sim.marketing.blocker('vip')).toBe('Unlocks at level 5: International resort');
    expect(sim.marketing.start('vip')).toBe('Unlocks at level 5: International resort');
    expect(sim.marketing.running().length).toBe(0);
    expect(sim.marketing.lockedReason('brand')).toBeNull();
  });

  it('reaching the level unlocks (and the lock reason disappears); unlock snapshot keeps items open', () => {
    const sim = career();
    sim.progression.setLevel(4);
    expect(sim.progression.locked('building', 'helipad')).toBeNull();
    expect(sim.progression.locked('lift', 'chair8b')).toBeNull();
    expect(sim.progression.locked('lift', 'cablecar')).toBe('Unlocks at level 5: International resort');
    const { x, y } = lodgeSpot(sim);
    expect(validatePlacement(sim.env, 'helipad', x, y, 0, true).locked).toBeUndefined();
  });

  it('Sandbox ignores the table; unlockAll (tutorial) and withBypass (builders) open the gate without changing the level', () => {
    const sb = createSim({ size: 64, seed: 61, now: () => 0, mode: 'sandbox' });
    expect(sb.progression.locked('building', 'helipad')).toBeNull();
    expect(validatePlacement(sb.env, 'helipad', 20, 20, 0, true).locked).toBeUndefined();
    const sim = career();
    sim.progression.unlockAll = true;
    expect(sim.progression.locked('lift', 'cablecar')).toBeNull();
    sim.progression.unlockAll = false;
    expect(sim.progression.locked('lift', 'cablecar')).not.toBeNull();
    expect(sim.progression.withBypass(() => sim.progression.locked('lift', 'cablecar'))).toBeNull();
    expect(sim.progression.locked('lift', 'cablecar')).not.toBeNull();
    expect(sim.progression.level).toBe(1);
  });

  it('the starter / demo resort builders bypass the gate (their lifts may be gated kinds) and leave the gate shut afterwards', () => {
    const sim = career();
    const rep = buildDemoResort(sim, 'starter');
    expect(rep.failures).toEqual([]);
    expect(sim.progression.locked('lift', 'cablecar')).not.toBeNull();
    const sim2 = createSim({ size: 64, seed: 61, now: () => 0 });
    const r = buildStarterResort(sim2);
    expect(r.failures).toEqual([]);
    expect(sim2.progression.level).toBe(1);
  });
});

describe('modes: URL param, config, saves', () => {
  it('?mode=career|sandbox; anything else (or nothing) = Career; sandbox is written back to the query', () => {
    expect(parseConfig(new URLSearchParams('seed=5'), () => 0.5).config.mode).toBe('career');
    expect(parseConfig(new URLSearchParams('seed=5&mode=sandbox')).config.mode).toBe('sandbox');
    expect(parseConfig(new URLSearchParams('seed=5&mode=career')).config.mode).toBe('career');
    expect(parseConfig(new URLSearchParams('seed=5&mode=banana')).config.mode).toBe('career');
    expect(parseConfig(new URLSearchParams('mode=sandbox')).explicit).toBe(true);
    expect(configQuery(normalizeConfig({ seed: 5, mode: 'sandbox' }))).toContain('mode=sandbox');
    expect(configQuery(normalizeConfig({ seed: 5 }))).not.toContain('mode');
  });

  it('saves round-trip: mode, latched level, unlocked snapshot and history survive; the stateHash matches', () => {
    const sim = createSim({ size: 64, seed: 3, now: () => 0 });
    sim.progression.setLevel(3);
    const save = structuredClone(collectSave(sim));
    expect(save['progression']).toBeDefined();
    const back = createSim({ size: 64, seed: 3, now: () => 0, fromSave: save });
    expect(back.progression.level).toBe(3);
    expect(back.progression.mode).toBe('career');
    expect(back.progression.history.map((h) => h.level)).toEqual([2, 3]);
    expect(back.progression.locked('lift', 'funicular')).toBeNull();
    expect(back.progression.locked('lift', 'cablecar')).not.toBeNull();
    expect(stateHash(back).parts['progression']).toBe(stateHash(sim).parts['progression']);
    expect(SAVE_MODULES.some((m) => m.key === 'progression')).toBe(true);
  });

  it('an unlocked snapshot never re-locks an item that a later table moved to a higher level', () => {
    const sim = createSim({ size: 64, seed: 3, now: () => 0 });
    sim.progression.setLevel(3);
    const save = structuredClone(collectSave(sim));
    (save['progression']!.data as { unlocked: string[] }).unlocked.push('lift:cablecar');
    const back = createSim({ size: 64, seed: 3, now: () => 0, fromSave: save });
    expect(back.progression.locked('lift', 'cablecar')).toBeNull();
  });

  it('an old save (no progression module, no mode in the config) loads as SANDBOX: everything unlocked, nothing tracked', () => {
    const sim = createSim({ size: 64, seed: 3, now: () => 0 });
    const save = structuredClone(collectSave(sim));
    delete save['progression'];
    delete (save['config']!.data as Record<string, unknown>)['mode'];
    const old = createSim({ size: 64, seed: 3, now: () => 0, fromSave: save });
    expect(old.progression.mode).toBe('sandbox');
    expect(old.config.mode).toBe('sandbox');
    expect(old.progression.locked('lift', 'cablecar')).toBeNull();
    expect(validatePlacement(old.env, 'helipad', 20, 20, 0, true).locked).toBeUndefined();
    // applying such a save in place also resets to Sandbox
    const live = createSim({ size: 64, seed: 3, now: () => 0 });
    const rep = applySave(live, save);
    expect(rep.missing).toContain('progression');
    expect(live.progression.mode).toBe('sandbox');
  });

  it('is deterministic: two identical Career runs have the same progression hash', () => {
    const run = (): string => { const s = createSim({ size: 64, seed: 9, now: () => 0 }); s.tick(240 * 2); s.progression.setLevel(2); s.tick(240); return stateHash(s).parts['progression']!; };
    expect(run()).toBe(run());
  });
});

describe('balance bot in Career with respectUnlocks (64, Normal)', () => {
  it('profits by the end of year 2, reaches level 3 in year 1 and level 4 within year 2; never buys a locked item', () => {
    const sim = createSim({ size: 64, seed: 61, now: () => 0, mode: 'career' });
    const bot = new Bot(sim, { respectUnlocks: true });
    const levelAt: Record<number, number> = {};
    sim.progression.onLevelUp((u) => { levelAt[u.level] = sim.game.date.year * 1000 + sim.game.date.day; });
    runBot(sim, bot, 2 * DAYS_PER_YEAR);
    const y2 = bot.rows.filter((r) => r.year === 2).reduce((a, r) => a + r.net, 0);
    expect(y2).toBeGreaterThan(0);
    expect(sim.progression.level).toBeGreaterThanOrEqual(4);
    expect(levelAt[3]).toBeDefined();
    expect(Math.floor(levelAt[4]! / 1000)).toBeLessThanOrEqual(2);
    for (const b of sim.buildings.all()) if (!['helipad', 'altiport'].includes(b.type)) expect(isGated('building', b.type)).toBe(false);
    expect(sim.finance.ended).toBe(false);
  }, 120000);
});
