import { describe, expect, it } from 'vitest';
import { createSim } from '../../src/game/createSim';
import { Bot, runBot } from '../../src/game/bot';
import { stateHash, applySave, collectSave } from '../../src/game/saveState';
import { STAFF } from '../../src/config/staff';
import { makeResort, run } from '../game/harness';

/**
 * Parts of the game with Auto staff. First recorded before Task 19 on a pristine tree (staff hooks are no-ops: the only additions were the staff modules).
 * RE-RECORDED in Task 23 (M5.4) on purpose: the rating gained its sustainability facet and a renormalised WEIGHTS table (and the bot builds on open ground and
 * replants), which shifts every rating-driven arrival; see docs/rating.md. Auto-vs-pre-staff equivalence is still pinned by the per-pool tests below
 * (fill 1, no wages, factor 1). New modules (`staff`, `staffUpgrades`, `events`, `stories`, `rivals`) are excluded.
 */
const GOLDEN_STARTER: Record<string, string> = {
  'core': '0e10676d',
  'config': '0c4169f7',
  'grid': 'f0329a39',
  'props': 'f326a89f',
  'networks': '4854bb95',
  'buildings': '82fa8736',
  'lifts': '867cf91b',
  'cond': 'ba97dd7b',
  'names': '4e78cc93',
  'nature': '917ca5b7',
  'leavers': '75b66968',
  'sys.clock': '77074ba4',
  'sys.season': '757e0fce',
  'sys.weather': '48001143',
  'sys.spawner': 'd6477849',
  'sys.guests': 'd84b2a08',
  'sys.attractions': '2f55affb',
  'sys.ops': 'e2e12903',
  'sys.economy': '41747b56',
  'sys.rating': 'fa114b69',
  'families': 'c043a5c0',
  'openStatus': 'f48290d9',
  'sessionMeta': '77074ba4',
  'goals': '91ed146f',
  'yearReports': 'e696b440',
  'advisor': 'ca063e92',
  'progression': 'b8977d94',
  'scenario': '77074ba4'
};
const GOLDEN_BOT: Record<string, string> = {
  'core': 'eb3fa788',
  'config': 'd9813cdd',
  'grid': 'dc59b188',
  'props': 'f0f8b114',
  'networks': '7e224f7e',
  'buildings': 'a84a574b',
  'lifts': '3f7a6596',
  'cond': 'd91eca6f',
  'names': '1a3cb02c',
  'nature': '3339dd42',
  'leavers': '60e0b595',
  'sys.clock': '77074ba4',
  'sys.season': '757e0fce',
  'sys.weather': 'cfda327d',
  'sys.spawner': '6ca57e98',
  'sys.guests': '133b0758',
  'sys.attractions': 'cf4f5ee8',
  'sys.ops': '22104486',
  'sys.economy': 'cb460f36',
  'sys.rating': '5f6795e5',
  'families': 'd440d194',
  'openStatus': 'f48290d9',
  'sessionMeta': '871fbe98',
  'goals': '580b9638',
  'yearReports': '40ddfd31',
  'advisor': 'ca063e92',
  'progression': '95d25f9b', // re-recorded: the landscape:pond unlock joins the level snapshot
  'scenario': '77074ba4'
};
// RE-RECORDED (tower height caps / denser towers change the bot's lift layouts; docs/lifts-clearance.md).
const GOLDEN_BOT_MONEY = 193236.89;

const withoutNew = (parts: Record<string, string>): Record<string, string> => { const p = { ...parts }; delete p['staff']; delete p['staffUpgrades']; delete p['events']; delete p['stories']; delete p['rivals']; return p; };

describe('staff: Auto is bit-identical to the pre-staff game (golden hash)', () => {
  it('starter resort, 64 / seed 1 / mid-winter, 3 days', () => {
    const { sim } = makeResort(64, 1, { startDay: 167 }); run(sim, { days: 3 });
    expect(withoutNew(stateHash(sim).parts)).toEqual(GOLDEN_STARTER);
  });
  it('bot-played 64 / seed 61, 200 days (grooming, patrol, lifts, schools, money)', () => {
    const play = () => { const s = createSim({ size: 64, seed: 61, now: () => 0 }); runBot(s, new Bot(s), 200); return s; };
    const sim = play();
    // Cross-platform float drift: `sys.spawner` serialises the float arrival accumulator, which is fed by Math.exp (Elasticity)
    // and Math.cos (Daylight). V8's libm port can round the last ulp differently on Linux x64 vs macOS arm64 (CI saw only
    // sys.spawner differ, every other part, incl. core, equal). So the golden compares the stable parts everywhere and the exact
    // spawner hash + money only off CI; the same-platform self-consistency (run twice) below guards real non-determinism everywhere.
    const { 'sys.spawner': spawner, ...stable } = withoutNew(stateHash(sim).parts);
    const { 'sys.spawner': goldenSpawner, ...goldenStable } = GOLDEN_BOT;
    expect(stable).toEqual(goldenStable);
    if (!process.env.CI) { expect(spawner).toBe(goldenSpawner); expect(sim.game.money).toBe(GOLDEN_BOT_MONEY); }
    else expect(Math.abs(sim.game.money - GOLDEN_BOT_MONEY) / GOLDEN_BOT_MONEY).toBeLessThan(0.01);
    const again = play();
    expect(stateHash(again).parts).toEqual(stateHash(sim).parts);
    expect(again.game.money).toBe(sim.game.money);
  });
});

describe('staff: per-pool override', () => {
  const resort = () => makeResort(64, 1, { startDay: 167 }).sim;

  it('Auto is the default for all four pools, fill 1, no extra wages, morale dead band', () => {
    const sim = resort();
    for (const p of ['instructors', 'patrol', 'groomers', 'liftOps'] as const) { expect(sim.staff.isAuto(p)).toBe(true); expect(sim.staff.fill(p)).toBe(1); }
    expect(sim.staff.extraWagesPerDay()).toBe(0);
    expect(sim.staff.wageMult()).toBe(1);
    expect(sim.staff.breakdownFactor()).toBe(1);
    const n = sim.staff.needs(true);
    expect(n.instructors).toBeGreaterThan(0); expect(n.patrol).toBeGreaterThan(0); expect(n.groomers).toBeGreaterThan(0); expect(n.liftOps).toBeGreaterThan(0);
  });

  it('switching a pool to override starts at today\'s headcount (nothing changes until the player edits it)', () => {
    const sim = resort(), need = sim.staff.needs(true).patrol;
    sim.staff.setAuto('patrol', false);
    expect(sim.staff.headcount('patrol')).toBe(need);
    expect(sim.staff.fill('patrol')).toBe(1);
    expect(sim.staff.extraWagesPerDay()).toBe(0);
    sim.staff.setAuto('patrol', true);
    expect(sim.staff.isAuto('patrol')).toBe(true);
  });

  it('understaffed instructors shrink ski-school capacity; overstaffing never adds any', () => {
    const sim = resort();
    const hq = sim.buildings.all().find((b) => b.type === 'skiSchoolHQ')!;
    const school = sim.guestSim.families.school(hq.id);
    const base = school.capacity;
    expect(base).toBe(school.instructors * 4);
    sim.staff.setCount('instructors', Math.floor(sim.staff.needs(true).instructors / 2));
    expect(sim.staff.fill('instructors')).toBeLessThan(1);
    expect(school.capacity).toBeLessThan(base);
    sim.staff.setCount('instructors', 30);
    expect(school.capacity).toBe(base);
    expect(sim.staff.extraWagesPerDay()).toBeGreaterThan(0);
  });

  it('understaffed lift operators slow loading; patrol slows the sled speed', () => {
    const sim = resort(), l = sim.lifts.all()[0]!;
    const rate = sim.guestSim.queues.ratePerTick(l);
    sim.staff.setCount('liftOps', 1);
    expect(sim.guestSim.queues.ratePerTick(l)).toBeLessThan(rate);
    expect(sim.guestSim.queues.ratePerTick(l)).toBeGreaterThanOrEqual(rate * 0.3 - 1e-9);
    sim.staff.setCount('patrol', 1);
    sim.staff.setAuto('patrol', false); // stays override
    expect(sim.safety.patrol.speedFactor()).toBeLessThanOrEqual(1);
  });

  it('groomers: a crew cap of 0 means no snowcat drives at night', () => {
    const sim = resort();
    sim.staff.setCount('groomers', 0);
    expect(sim.ops.grooming.crewLimit()).toBe(0);
    for (let i = 0; i < 4 * 240; i++) { sim.tick(1); expect(sim.ops.grooming.cats.length).toBe(0); }
    sim.staff.setAuto('groomers', true);
    expect(sim.ops.grooming.crewLimit()).toBeNull();
  });

  it('fleetNeed ignores the crew cap', () => {
    const sim = resort(), need = sim.ops.grooming.fleetNeed();
    sim.staff.setCount('groomers', 0);
    expect(sim.ops.grooming.fleetNeed()).toBe(need);
  });

  it('wage level scales the staff bill and drives morale; sloppy crews break lifts more', () => {
    const sim = resort();
    sim.staff.setWage('low');
    expect(sim.staff.wageMult()).toBeLessThan(1);
    for (let d = 0; d < 20; d++) sim.staff.newDay();
    expect(sim.staff.morale).toBeCloseTo(0.4, 5);
    expect(sim.staff.breakdownFactor()).toBeGreaterThan(1);
    sim.staff.setWage('high');
    for (let d = 0; d < 30; d++) sim.staff.newDay();
    expect(sim.staff.morale).toBeCloseTo(0.9, 5);
    expect(sim.staff.breakdownFactor()).toBeLessThan(1);
    sim.staff.setWage('normal');
    for (let d = 0; d < 30; d++) sim.staff.newDay();
    expect(sim.staff.breakdownFactor()).toBe(1);
  });

  it('understaffing drags morale down even at normal wages', () => {
    const sim = resort();
    sim.staff.setCount('liftOps', 1);
    for (let d = 0; d < 30; d++) sim.staff.newDay();
    expect(sim.staff.morale).toBeLessThan(STAFF.moraleTarget.normal);
  });

  it('lift breakdown rate follows the morale factor', () => {
    const sim = resort(), l = sim.lifts.all()[0]!;
    const base = sim.liftOps.breakdownPerHour(l);
    sim.staff.setWage('low'); for (let d = 0; d < 20; d++) sim.staff.newDay();
    expect(sim.liftOps.breakdownPerHour(l)).toBeGreaterThan(base);
  });

  it('survives a save/load round trip (staff module)', () => {
    const sim = resort();
    sim.staff.setCount('patrol', 3); sim.staff.setWage('high'); for (let d = 0; d < 5; d++) sim.staff.newDay();
    const mod = collectSave(sim)['staff']!;
    const fresh = resort();
    applySave(fresh, { ...collectSave(fresh), staff: JSON.parse(JSON.stringify(mod)) });
    expect(fresh.staff.serialize()).toEqual(sim.staff.serialize());
    expect(fresh.staff.isAuto('patrol')).toBe(false);
    expect(fresh.staff.wage).toBe('high');
  });
});
