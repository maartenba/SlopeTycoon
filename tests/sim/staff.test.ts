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
  'core': '5c9ef6a9',
  'config': '0c4169f7',
  'grid': '77f6388d',
  'props': 'f326a89f',
  'networks': '4854bb95',
  'buildings': '82fa8736',
  'lifts': '2297f137',
  'cond': 'ba97dd7b',
  'names': '4e78cc93',
  'nature': '95b95716',
  'leavers': 'ae6bd29b',
  'sys.clock': '77074ba4',
  'sys.season': '757e0fce',
  'sys.weather': '00f02232',
  'sys.spawner': '8d770e56',
  'sys.guests': 'cc3fcb29',
  'sys.attractions': 'fc802f5a',
  'sys.ops': 'c298a226',
  'sys.economy': '23749ffa',
  'sys.rating': '7372d6fc',
  'families': '5271fe84',
  'openStatus': 'f48290d9',
  'sessionMeta': '77074ba4',
  'goals': 'e770c0b5',
  'yearReports': 'e696b440',
  'advisor': 'ca063e92',
  'progression': 'b8977d94',
  'scenario': '77074ba4'
};
const GOLDEN_BOT: Record<string, string> = {
  'core': 'd5198aa7',
  'config': 'd9813cdd',
  'grid': '5aa1ad93',
  'props': 'f0f8b114',
  'networks': '7e224f7e',
  'buildings': 'a84a574b',
  'lifts': 'f8565548',
  'cond': 'd91eca6f',
  'names': '7dbaace9',
  'nature': 'c49833ec',
  'leavers': 'ce6127f1',
  'sys.clock': '77074ba4',
  'sys.season': '757e0fce',
  'sys.weather': '571f0cde',
  'sys.spawner': 'fbddae0c',
  'sys.guests': 'd560653f',
  'sys.attractions': 'a6453283',
  'sys.ops': '0722578b',
  'sys.economy': 'bc552549',
  'sys.rating': '9d33bebc',
  'families': '15b427e4',
  'openStatus': 'f48290d9',
  'sessionMeta': '56cfc140',
  'goals': 'a2d076ac',
  'yearReports': '2cb63fb8',
  'advisor': 'ca063e92',
  'progression': 'fa20f826',
  'scenario': '77074ba4'
};
// RE-RECORDED (tower height caps / denser towers change the bot's lift layouts; docs/lifts-clearance.md).
// RE-RECORDED (calendar fix: daylight solstices 21 Jun / 21 Dec, temperature/snowline curve aligned to the real Alpine year; docs/time-flow.md section 10). Money 193236.89 -> 191943.33; re-recorded once more after the snowmaking-energy / nature-cache save fixes.
// RE-RECORDED (planned lift maintenance, docs/lift-ops-and-debt.md: every lift now carries `ops.maint`, and the bot's lifts are serviced in April). Taken on a tree that also holds other in-progress 0.2.x items (hiker hunger, snowmaking mode, Almabtrieb).
const GOLDEN_BOT_MONEY = 180221.69;

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
