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
 * (fill 1, no wages, factor 1). New modules (`staff`, `staffUpgrades`, `events`, `stories`, `rivals`, `energy`) are excluded.
 */
const GOLDEN_STARTER: Record<string, string> = {
  'core': '7bfc0bbd',
  'config': '0c4169f7',
  'grid': 'faf291c3',
  'props': 'f326a89f',
  'networks': '4854bb95',
  'buildings': 'defd0fcb',
  'lifts': '39d22bf2',
  'cond': 'ba97dd7b',
  'names': '323feaff',
  'nature': '41b50fb0',
  'leavers': '75b66968',
  'sys.clock': '77074ba4',
  'sys.season': '757e0fce',
  'sys.weather': '00f02232',
  'sys.spawner': 'a22970d2',
  'sys.guests': '3c9da463',
  'sys.attractions': 'a48da1b4',
  'sys.economy': '210da444',
  'sys.rating': 'e5465c96',
  'sys.ops': 'faf8607b',
  'families': '9592c8dc',
  'openStatus': 'f48290d9',
  'sessionMeta': '77074ba4',
  'goals': '24481a95',
  'yearReports': 'e696b440',
  'advisor': 'ca063e92',
  'progression': 'b8977d94',
  'scenario': '77074ba4'
};
const GOLDEN_BOT: Record<string, string> = {
  'core': '31c0e1a8',
  'config': 'd9813cdd',
  'grid': '410860f8',
  'props': 'f0f8b114',
  'networks': '7e224f7e',
  'buildings': 'a0aaa356',
  'lifts': '18031c1a',
  'cond': 'd91eca6f',
  'names': '21b69d9a',
  'nature': '616ad076',
  'leavers': '7244ae81',
  'sys.clock': '77074ba4',
  'sys.season': '757e0fce',
  'sys.weather': '571f0cde',
  'sys.spawner': '88eeedf8',
  'sys.guests': 'bf9ff94b',
  'sys.attractions': '3fb8c6cf',
  'sys.economy': '63a28414',
  'sys.rating': 'aa8b69de',
  'sys.ops': 'e3cf2bf0',
  'families': '72cac77e',
  'openStatus': 'f48290d9',
  'sessionMeta': '2c2097de',
  'goals': '137b8822',
  'yearReports': '102ceb83',
  'advisor': 'ca063e92',
  'progression': '7e176510',
  'scenario': '77074ba4'
};
// RE-RECORDED (energy / green buildings, item F: only `progression` moved, the unlock snapshot gained windTurbine + solarPlant; every other part is untouched, which is the proof that a game without generators is unchanged; the `energy` module is excluded like the other new modules).
// RE-RECORDED (Dig river unlock, Phase 6 Task 14: ONLY `progression` moved (8e20e249 -> 7e176510): the unlock snapshot gained landscape:river at level 2 and lift:chair6d at level 3; everything else is byte-identical).
// RE-RECORDED (Eco Centre, docs/eco.md: ONLY `progression` moved (71be28b7 -> 8e20e249): the unlock snapshot gained building:ecoCentre at level 4; money, guests, rating and every other part are byte-identical, and the `eco` module is omitted while untouched).
// RE-RECORDED (tower height caps / denser towers change the bot's lift layouts; docs/lifts-clearance.md).
// RE-RECORDED (calendar fix: daylight solstices 21 Jun / 21 Dec, temperature/snowline curve aligned to the real Alpine year; docs/time-flow.md section 10). Money 193236.89 -> 191943.33; re-recorded once more after the snowmaking-energy / nature-cache save fixes.
// RE-RECORDED (planned lift maintenance, docs/lift-ops-and-debt.md: every lift now carries `ops.maint`, and the bot's lifts are serviced in April). Taken on a tree that also holds other in-progress 0.2.x items (hiker hunger, snowmaking mode, Almabtrieb).
// RE-RECORDED (pistes as runs, docs/runs.md): open / closed is now evaluated PER RUN, so a run without enough snow closes on its own (before, the whole connected network stayed open), and `names` holds run identities. Money 180221.69 -> 183647.28.
// RE-RECORDED AGAIN (run-aware via choice, docs/runs.md phase 3). Money 183647.28 -> 187143.92.
// RE-RECORDED (NavGraph no corner cutting: diagonal nav steps no longer graze building / water corners; also the nav altitude cache now follows terraforming). Money 187143.92 -> 192905.9.
// RE-RECORDED (createSim defaults == the real game, docs/balance.md "Defaults == the real game"): autoEvents, stories, remoteSupply, campaignsV2, guestTypesV2 are now ON by default. Money 192905.9 -> 203294.15 (autoEvents +5.05%, stories +0.30%, remoteSupply / campaignsV2 0%, combined +5.39%).
// RE-RECORDED (Phase 6 M6.1: comfort need + toilets, facilities rating facet, trail access, campaigns v2, bridges / crossings; docs/balance.md "M6.1 re-record"). Money 203294.15 -> 191483.3 (-5.8%).
// RE-RECORDED (money pass, docs/balance.md "Money pass": starting cash 130k -> 150k, goal grants +2k, softer off-season relief, autumn demand 0.4 -> 0.5). Money 191483.3 -> 222414.97.
const GOLDEN_BOT_MONEY = 222414.97;

const withoutNew = (parts: Record<string, string>): Record<string, string> => { const p = { ...parts }; delete p['staff']; delete p['staffUpgrades']; delete p['events']; delete p['stories']; delete p['rivals']; delete p['runs']; delete p['energy']; return p; };

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
