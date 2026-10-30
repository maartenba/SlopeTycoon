/** Phase 6 Task 29: Senior + School group guest types (docs/guest-types.md). */
import { afterEach, describe, expect, it } from 'vitest';
import {
  CORE_TYPE_COUNT, GUEST_TYPE_DEFS, SHIPPED_TYPES, appealFor, coreOf, extraWeight, registerGuestType, restoreShippedTypes, segmentKey, typeLabel, type ActiveCtx, type GuestTypeDef,
} from '../../../src/config/guestTypes';
import { Rng } from '../../../src/core/Rng';
import { DAYS_PER_YEAR } from '../../../src/config/balance';
import { seasonOf, weekdayOf } from '../../../src/sim/Clock';
import { calendarDayOfMonth, realMonthOfDay, simDayOf } from '../../../src/sim/calendar';
import { isHoliday } from '../../../src/sim/Pricing';
import { GuestStore, GuestType, GState } from '../../../src/sim/guests/Guest';
import { NEEDS, tickNeeds, NEUTRAL_ENV } from '../../../src/sim/guests/Needs';
import { Decider } from '../../../src/sim/guests/Decision';
import { addLessonXp, maxDifficultyFor, recordRun, skillCapOf } from '../../../src/sim/guests/Skill';
import { FamilyPhase } from '../../../src/sim/guests/Families';
import type { GuestWorld } from '../../../src/sim/guests/GuestWorld';
import { appearanceOf, Age, CLOTH_NAMES } from '../../../src/render/guestAppearance';
import { ATTRACTION_SPECS } from '../../../src/sim/attractions/registry';
import { building, fakeWorld, resetIds, rig, run, type Rig } from './helpers';
import { starterResort } from './resortFixture';

const SENIOR = CORE_TYPE_COUNT + SHIPPED_TYPES.findIndex((d) => d.id === 'senior');
const SCHOOL = CORE_TYPE_COUNT + SHIPPED_TYPES.findIndex((d) => d.id === 'school');
const senior = SHIPPED_TYPES.find((d) => d.id === 'senior')!;
const school = SHIPPED_TYPES.find((d) => d.id === 'school')!;
afterEach(() => restoreShippedTypes());

/** First absolute day (year 0) whose real date matches: month 0 = Jan, day of month, weekday 0 = Mon .. 6 = Sun. */
function dayWhere(month: number, wd: (w: number) => boolean, dom: (d: number) => boolean = () => true, holiday = false): number {
  for (let d = 0; d < DAYS_PER_YEAR; d++) {
    if (realMonthOfDay(d) === month && dom(calendarDayOfMonth(d)) && wd(weekdayOf({ year: 0, day: d })) && isHoliday(d) === holiday) return d;
  }
  throw new Error('no such day');
}
const ctxOn = (day: number, has: (id: string) => boolean = () => true, level = 99): ActiveCtx => ({
  season: seasonOf({ day }), level, hasBuilding: has, weekday: weekdayOf({ year: 0, day }), month: realMonthOfDay(day), dom: calendarDayOfMonth(day), holiday: isHoliday(day),
});

describe('Senior + School group rows (Task 29)', () => {
  it('are the third and fourth shipped extras with their segments, labels and look hooks', () => {
    expect(SENIOR).toBe(CORE_TYPE_COUNT + 2); expect(SCHOOL).toBe(CORE_TYPE_COUNT + 3);
    expect(typeLabel(SENIOR)).toBe('Senior'); expect(typeLabel(SCHOOL)).toBe('School group');
    expect(segmentKey(SENIOR)).toBe('couple'); expect(segmentKey(SCHOOL)).toBe('budget');
    expect(coreOf(SENIOR)).toBe(GuestType.Couple); expect(coreOf(SCHOOL)).toBe(GuestType.Family);
  });

  it('Senior is gated by level 2 and somewhere to sit or relieve themselves (terrace, café or toilets)', () => {
    const d = dayWhere(11, () => true);
    expect(extraWeight(senior, ctxOn(d, (id) => id === 'cafe', 1))).toBe(0);
    expect(extraWeight(senior, ctxOn(d, (id) => id === 'cafe', 2))).toBeGreaterThan(0);
    expect(extraWeight(senior, ctxOn(d, (id) => id === 'toilets', 2))).toBeGreaterThan(0);
    expect(extraWeight(senior, ctxOn(d, (id) => id === 'heatedTerrace', 2))).toBeGreaterThan(0);
    expect(extraWeight(senior, ctxOn(d, (id) => id === 'shop', 5))).toBe(0);
  });

  it('Seniors arrive more on weekdays than at weekends, and in every season', () => {
    const wk = dayWhere(11, (w) => w === 1), we = dayWhere(11, (w) => w === 5);
    expect(extraWeight(senior, ctxOn(wk))).toBeGreaterThan(extraWeight(senior, ctxOn(we)) * 1.5);
    for (const m of [0, 4, 6, 10]) expect(extraWeight(senior, ctxOn(dayWhere(m, () => true)))).toBeGreaterThan(0);
  });

  it('School groups: weekdays only, never on a holiday, only Dec 1-8 + January in winter, summer weekdays', () => {
    const has = (id: string): boolean => id === 'skiSchoolHQ' || id === 'playground';
    const w = (day: number, h = has, lvl = 99): number => extraWeight(school, ctxOn(day, h, lvl));
    const monJan = dayWhere(0, (x) => x === 1), satJan = dayWhere(0, (x) => x === 5), sunJan = dayWhere(0, (x) => x === 6);
    expect(w(monJan)).toBeGreaterThan(0);
    expect(w(satJan)).toBe(0); expect(w(sunJan)).toBe(0);
    for (let wd = 0; wd < 7; wd++) { // the whole real week: Mon-Fri on, Sat / Sun off (outside holidays)
      const day = dayWhere(0, (x) => x === wd);
      expect(w(day) > 0).toBe(wd < 5);
    }
    expect(w(dayWhere(11, (x) => x < 5, (d) => d <= 8))).toBeGreaterThan(0); // early December weekday
    expect(w(dayWhere(11, (x) => x < 5, (d) => d >= 10))).toBe(0); // late December
    expect(w(dayWhere(1, (x) => x < 5))).toBe(0); // February
    expect(w(dayWhere(2, (x) => x < 5))).toBe(0); // March
    const summerWeekday = dayWhere(6, (x) => x < 5);
    expect(w(summerWeekday, (id) => id === 'playground')).toBeGreaterThan(0);
    expect(w(dayWhere(6, (x) => x === 6), (id) => id === 'playground')).toBe(0);
    expect(w(dayWhere(9, (x) => x < 5))).toBe(0); // October: no school trips
    expect(w(simDayOf(0, 3), has, 1)).toBe(0); // level 2
    // a holiday weekday (the summer holiday block) never counts
    const hol = (() => { for (let d = 0; d < DAYS_PER_YEAR; d++) if (isHoliday(d) && weekdayOf({ year: 0, day: d }) < 5 && (realMonthOfDay(d) === 0 || seasonOf({ day: d }) === 'summer')) return d; return -1; })();
    if (hol >= 0) expect(w(hol)).toBe(0);
  });

  it('School groups need the right venue for the season (ski school / kids ground / carpet in winter; playground / petting zoo / campground in summer)', () => {
    const jan = dayWhere(0, (x) => x === 2), jul = dayWhere(6, (x) => x === 2);
    const only = (id: string) => (x: string): boolean => x === id;
    for (const id of ['skiSchoolHQ', 'kidsGround', 'magicCarpet']) { expect(extraWeight(school, ctxOn(jan, only(id)))).toBeGreaterThan(0); expect(extraWeight(school, ctxOn(jul, only(id)))).toBe(0); }
    for (const id of ['playground', 'pettingZoo', 'campground']) { expect(extraWeight(school, ctxOn(jul, only(id)))).toBeGreaterThan(0); expect(extraWeight(school, ctxOn(jan, only(id)))).toBe(0); }
    expect(extraWeight(school, ctxOn(jan, () => false))).toBe(0);
  });

  it('a context without the calendar fails the school gate (never silently on)', () => {
    expect(extraWeight(school, { season: 'winter', level: 99, hasBuilding: () => true })).toBe(0);
  });
});

describe('Spawner: groups', () => {
  const mk = (day: number, has: string[], hugeSchool: boolean) => {
    resetIds();
    const r = rig(fakeWorld([building('baseLodge', 60, 112), building('parking', 60, 100)]));
    r.state.date.year = 0; r.state.date.day = day;
    r.sim.spawner.typesV2 = true; r.sim.spawner.levelFn = () => 99; r.sim.spawner.flagsFn = () => has;
    if (hugeSchool) registerGuestType({ ...school, seasons: { winter: 1e6, summer: 1e6 } } as GuestTypeDef); // every arrival is a class (the calendar and venue gates still apply)
    return r;
  };
  const groups = (r: Rig): Map<number, number[]> => {
    const s = r.sim.store, by = new Map<number, number[]>();
    for (let i = 0; i < s.limit; i++) if (s.alive[i] && s.type[i] === SCHOOL) { const a = by.get(s.group[i]!) ?? []; a.push(s.id[i]!); by.set(s.group[i]!, a); }
    return by;
  };

  it('a school group is 9-16 people (1 teacher + 8-15 children) and counts guest by guest', () => {
    const r = mk(dayWhere(0, (x) => x === 2), [], true); // spawner "placed" set comes from the buildings: give it the ski school through the flags list
    r.sim.spawner.flagsFn = () => ['skiSchoolHQ'];
    r.sim.spawner.benchFill(r.state, 300, 300);
    const g = groups(r);
    expect(g.size).toBeGreaterThan(10);
    for (const ids of g.values()) { expect(ids.length).toBeGreaterThanOrEqual(9); expect(ids.length).toBeLessThanOrEqual(16); }
  });

  it('no school groups on Saturday or Sunday, or without the venue, even with a huge weight', () => {
    const sat = mk(dayWhere(0, (x) => x === 5), [], true); sat.sim.spawner.flagsFn = () => ['skiSchoolHQ'];
    sat.sim.spawner.benchFill(sat.state, 200, 200);
    expect(groups(sat).size).toBe(0);
    const bare = mk(dayWhere(0, (x) => x === 2), [], true);
    bare.sim.spawner.benchFill(bare.state, 200, 200);
    expect(groups(bare).size).toBe(0);
  });

  it('the guest cap holds: groups that would not fit are turned into overflow, never simulated', () => {
    const r = mk(dayWhere(0, (x) => x === 2), [], true);
    r.sim.spawner.flagsFn = () => ['skiSchoolHQ'];
    const cap = r.sim.store.capacity;
    r.sim.spawner.benchFill(r.state, cap - 4, cap); // nearly full: the next coach (9-16) cannot fit
    for (let t = 0; t < 600; t++) { run(r, 1); expect(r.sim.store.count).toBeLessThanOrEqual(cap); }
    expect(r.sim.spawner.overflow).toBeGreaterThan(0);
  });

  it('seniors and school kids arrive with the right skill (seniors never above intermediate)', () => {
    const r = mk(dayWhere(11, (x) => x === 2), ['cafe'], false);
    registerGuestType({ ...senior, seasons: { winter: 1e6 } });
    r.sim.spawner.benchFill(r.state, 400, 400);
    const s = r.sim.store; let n = 0;
    for (let i = 0; i < s.limit; i++) if (s.alive[i] && s.type[i] === SENIOR) { n++; expect(s.skill[i]!).toBeLessThanOrEqual(1); }
    expect(n).toBeGreaterThan(200);
  });
});

describe('Senior behaviour', () => {
  it('tire and need the toilet faster (needs multipliers); core types keep the exact old growth', () => {
    const s = new GuestStore(4);
    const add = (type: number): number => s.add({ x: 0, y: 0, z: 0, type, skill: 1, budget: 500, group: 0, mode: 0, overnight: false, leaveDay: 0, tick: 0 });
    const a = add(SENIOR), b = add(GuestType.Couple);
    s.state[a] = GState.Walking; s.state[b] = GState.Walking;
    const env = { ...NEUTRAL_ENV, comfort: true };
    for (let t = 0; t < 40; t++) { tickNeeds(s, a, env); tickNeeds(s, b, env); }
    expect(s.fatigue[b]).toBeCloseTo(40 * NEEDS.fatigueWalk, 6);
    expect(s.urge[b]).toBeCloseTo(40 * NEEDS.urgeWalk, 6);
    expect(s.fatigue[a]! / s.fatigue[b]!).toBeCloseTo(senior.needs!.fatigue!, 3);
    expect(s.urge[a]! / s.urge[b]!).toBeCloseTo(senior.needs!.urge!, 3);
    expect(s.hunger[a]).toBeCloseTo(s.hunger[b]!, 9); // hunger is not scaled
  });

  it('avoid black runs: the skill cap stops at intermediate (red at most), also through runs and lessons', () => {
    expect(skillCapOf(SENIOR)).toBe(1);
    expect(maxDifficultyFor(skillCapOf(SENIOR))).toBeLessThan(3); // black = difficulty 3
    expect(skillCapOf(GuestType.Solo)).toBe(3); expect(skillCapOf(SCHOOL)).toBe(3);
    const s = new GuestStore(2);
    const a = s.add({ x: 0, y: 0, z: 0, type: SENIOR, skill: 0, budget: 500, group: 0, mode: 0, overnight: false, leaveDay: 0, tick: 0 });
    const b = s.add({ x: 0, y: 0, z: 0, type: GuestType.Solo, skill: 0, budget: 500, group: 0, mode: 0, overnight: false, leaveDay: 0, tick: 0 });
    for (let k = 0; k < 400; k++) { recordRun(s, a, 3); recordRun(s, b, 3); }
    addLessonXp(s, a, 500); addLessonXp(s, b, 500);
    expect(s.skill[a]).toBe(1); expect(s.skill[b]).toBe(3);
  });

  it('prefer the terrace and the café for a meal, even when a restaurant is closer; the core types take the nearest', () => {
    resetIds();
    const near = building('lodge', 30, 60), far = building('heatedTerrace', 90, 60), cafe = building('cafe', 100, 60);
    const d = new Decider(() => null);
    d.food = [near, far, cafe];
    const rng = new Rng(7);
    const s = new GuestStore(400);
    const share = (type: number): number => {
      let n = 0, hit = 0;
      for (let k = 0; k < 150; k++) {
        const g = s.add({ x: 31, y: 61, z: 0, type, skill: 1, budget: 500, group: 0, mode: 0, overnight: false, leaveDay: 0, tick: 0, hunger: 0.7 });
        s.id[g] = 1000 + k;
        const it = d.choose(s, g, rng, 10);
        if (it.kind === 'eat') { n++; if (it.building!.type !== 'lodge') hit++; }
      }
      return n ? hit / n : 0;
    };
    const sen = share(SENIOR), cpl = share(GuestType.Couple);
    expect(sen).toBeGreaterThan(0.95);
    expect(cpl).toBeLessThan(0.4);
  });

  it('terrace and café appeal is high, sport and kids venues low; the pool amenity (Luxury Hotel) is a favourite', () => {
    const a = (id: string): number => appealFor(ATTRACTION_SPECS[id]!, id, SENIOR)!;
    expect(a('heatedTerrace')).toBeGreaterThan(1.2); expect(a('cafe')).toBeGreaterThan(1.2);
    expect(a('stuntPark')).toBeLessThan(0.2); expect(a('adventurePark')).toBeLessThan(0.2); expect(a('kidsGround')).toBeLessThan(0.2);
    const hotel = { kind: 'lodging', amenity: 'pool', appeal: [0.3, 0.3, 0.3, 0.3, 0.3, 0.3] as const };
    expect(appealFor(hotel, 'someHotel', SENIOR)).toBe(1.5);
    expect(appealFor({ kind: 'lodging', appeal: hotel.appeal }, 'chalet', SENIOR)!).toBeLessThan(1.5);
    expect(appealFor(hotel, 'someHotel', GuestType.Couple)).toBe(0.3); // core types read their column untouched
  });

  it('the senior look: grey / white hair, an older figure, brown cardigans', () => {
    let old = 0, brown = 0; const N = 600;
    for (let id = 1; id <= N; id++) { const a = appearanceOf(id, SENIOR, true); if (a.age === Age.Senior) old++; if (CLOTH_NAMES[a.top] === 'brown') brown++; }
    expect(old / N).toBeGreaterThan(0.8);
    expect(brown / N).toBeGreaterThan(0.55);
    let grey = 0; for (let id = 1; id <= N; id++) { const a = appearanceOf(id, SENIOR, true); if (a.age === Age.Senior && (a.hair === 5 || a.hair === 6)) grey++; }
    expect(grey / old).toBeGreaterThan(0.7);
  });
});

describe('School look + the Families path', () => {
  it('matching orange bibs on everybody; children stay children', () => {
    for (let id = 1; id <= 200; id++) {
      expect(CLOTH_NAMES[appearanceOf(id, SCHOOL, true, true).top]).toBe('orange');
      expect(appearanceOf(id, SCHOOL, true, true).age).toBe(Age.Child);
    }
  });

  const setup = (kidsN: number) => {
    resetIds();
    const f = starterResort(64, 2);
    f.addBuildingOnStreet('skiSchoolHQ', 36, 51);
    const base = f.guestWorld({ stats: { openLifts: 1, openPisteTiles: 100, attractions: 3, amenityVariety: 4 } });
    const world: GuestWorld = { ...base, isSnowy: () => true, isBuildingOpen: () => true };
    const r = rig(world, 5, 64);
    r.state.date.minute = 8 * 60;
    const st = r.sim.store;
    const add = (): number => { const sl = st.add({ x: 30, y: 52, z: 0, type: SCHOOL, skill: 1, budget: 800, group: 9100, mode: 0, overnight: false, leaveDay: 0, tick: 0 }); r.sim.hash.insert(sl, 30, 52); return st.id[sl]!; };
    const teacher = add(); const kids = Array.from({ length: kidsN }, add);
    return { r, teacher, kids };
  };

  it('one teacher + all the others are kids: the class drops off together at the ski school, lessons run in batches and finish, kids never roam alone', () => {
    const t = setup(13);
    let kidsAtDrop = 0, started = 0, finished = 0;
    t.r.bus.on('family:dropoff', (e) => { kidsAtDrop = e.kids; });
    t.r.bus.on('lesson:started', () => { started++; });
    t.r.bus.on('lesson:finished', () => { finished++; });
    let sawVenue = false;
    for (let k = 0; k < 120; k++) {
      run(t.r, 1);
      const fam = t.r.sim.families.groups.get(9100);
      if (fam) { expect(fam.parents).toEqual([t.teacher]); expect(fam.kids.length).toBeLessThanOrEqual(13); if (fam.phase === FamilyPhase.AtVenue) sawVenue = true; }
      expect(t.r.sim.families.unaccompaniedKids()).toEqual([]);
    }
    expect(sawVenue).toBe(true);
    expect(kidsAtDrop).toBe(13);
    expect(started).toBeGreaterThanOrEqual(3); // 13 kids / batches of 6
    expect(finished).toBeGreaterThanOrEqual(3);
    expect(t.r.sim.store.count).toBeLessThanOrEqual(14);
  });

  it('is deterministic: the same seed gives the same state hash', () => {
    const go = (): string => { const t = setup(10); run(t.r, 80); const s = t.r.sim.store; return `${s.count}:${[...s.x.slice(0, 20)].map((v) => v.toFixed(3)).join(',')}`; };
    expect(go()).toBe(go());
  });
});

describe('framework hygiene', () => {
  it('shipped list has the four extras in order and nothing else', () => {
    expect(GUEST_TYPE_DEFS.map((d) => d.id)).toEqual(['mtb', 'angler', 'senior', 'school']);
  });
});
