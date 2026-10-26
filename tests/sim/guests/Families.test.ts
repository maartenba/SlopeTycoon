import { describe, it, expect, beforeEach } from 'vitest';
import { GuestType, GState } from '../../../src/sim/guests/Guest';
import { FamilyPhase, buildingKidsProvider } from '../../../src/sim/guests/Families';
import { SKI_SCHOOL } from '../../../src/sim/attractions/SkiSchool';
import type { GuestWorld } from '../../../src/sim/guests/GuestWorld';
import { resetIds, rig, run, type Rig } from './helpers';
import { starterResort, type Fixture } from './resortFixture';
import type { GameEvents } from '../../../src/core/events';

interface Opts { snowy?: boolean; school?: boolean; kidsGround?: boolean; playground?: boolean; seed?: number; startHour?: number }
interface Log { t: number; name: string; p: unknown }

function setup(o: Opts = {}): { r: Rig; f: Fixture; log: Log[]; closed: Set<number>; ids: { school?: number; ground?: number; play?: number }; kids: number[]; parents: number[] } {
  resetIds();
  const f = starterResort(64, 2);
  const ids: { school?: number; ground?: number; play?: number } = {};
  if (o.school !== false) ids.school = f.addBuildingOnStreet('skiSchoolHQ', 36, 51).id;
  if (o.kidsGround) ids.ground = f.addBuildingOnStreet('kidsGround', 44, 51).id;
  if (o.playground) ids.play = f.addBuildingOnStreet('playground', 50, 51).id;
  const closed = new Set<number>();
  const snowy = o.snowy ?? true;
  const base = f.guestWorld({ stats: { openLifts: 1, openPisteTiles: 100, attractions: 3, amenityVariety: 4 } });
  const world: GuestWorld = { ...base, isSnowy: () => snowy, isBuildingOpen: (id) => !closed.has(id) };
  const r = rig(world, o.seed ?? 5, 64);
  r.state.date.minute = Math.round((o.startHour ?? 8) * 60);
  const log: Log[] = [];
  for (const n of ['family:dropoff', 'family:regroup', 'lesson:started', 'lesson:finished'] as const) r.bus.on(n, (p: GameEvents[typeof n]) => log.push({ t: r.state.date.tick, name: n, p }));
  const add = (type: number, skill: number): number => r.sim.store.add({ x: 30, y: 52, z: 0, type, skill, budget: 800, group: 9000, mode: 0, overnight: false, leaveDay: 0, tick: 0 });
  const p1 = add(GuestType.Family, 2), p2 = add(GuestType.Family, 2), k1 = add(GuestType.Family, 0), k2 = add(GuestType.Family, 0);
  for (const s of [p1, p2, k1, k2]) r.sim.hash.insert(s, 30, 52);
  const st = r.sim.store;
  return { r, f, log, closed, ids, kids: [k1, k2].map((s) => st.id[s]!), parents: [p1, p2].map((s) => st.id[s]!) };
}
beforeEach(() => resetIds());

describe('families: drop-off and regroup timeline', () => {
  it('winter: drop-off at ski school -> parents do their own thing -> regroup at lunch; kids learn', () => {
    const t = setup();
    const st = t.r.sim.store;
    const kid = st.slotOf(t.kids[0]!);
    const startSkill = st.skill[kid]!, startXp = st.skillXp[kid]!;
    let moneyIn = 0;
    const w = t.r.world; w.onEarn = (c, a) => { if (c === 'lessons' && moneyIn === 0) moneyIn = a; }; // first lesson only (faster walking lets the family repeat the cycle within the window)
    // rebuild: onEarn is read lazily through the world object
    let apart = false;
    for (let k = 0; k < 90; k++) {
      run(t.r, 1);
      const fam = t.r.sim.families.groups.get(9000);
      if (fam?.phase === FamilyPhase.AtVenue) {
        const p = st.slotOf(t.parents[0]!);
        if (p >= 0 && Math.hypot(st.x[p]! - st.x[st.slotOf(t.kids[0]!)]!, st.y[p]! - st.y[st.slotOf(t.kids[0]!)]!) > 2.5) apart = true;
        expect(t.r.sim.families.unaccompaniedKids()).toEqual([]);
      }
    }
    const names = t.log.map((l) => l.name);
    const iDrop = names.indexOf('family:dropoff'), iReg = names.indexOf('family:regroup');
    expect(iDrop).toBeGreaterThanOrEqual(0);
    expect(iReg).toBeGreaterThan(iDrop);
    expect(t.log[iDrop]!.p).toMatchObject({ group: 9000, venue: 'skiSchool', kids: 2 });
    expect(names).toContain('lesson:started');
    expect(names).toContain('lesson:finished');
    expect(names.indexOf('lesson:started')).toBeLessThan(names.indexOf('lesson:finished'));
    expect(t.log[iReg]!.t).toBeGreaterThan(t.log[iDrop]!.t);
    expect(apart).toBe(true); // parents left the kids behind (free time)
    expect(moneyIn).toBe(SKI_SCHOOL.fee * 2); // first lesson, two kids, charged to the 'lessons' ledger
    const after = st.slotOf(t.kids[0]!);
    if (after >= 0) expect(st.skill[after]! * 100 + st.skillXp[after]!).toBeGreaterThan(startSkill * 100 + startXp);
  });

  it('inspector text reflects the state', () => {
    const t = setup();
    const st = t.r.sim.store;
    let seen = '';
    for (let k = 0; k < 40 && !seen; k++) { run(t.r, 1); const d = t.r.sim.families.describe(st.slotOf(t.parents[0]!)); if (d?.includes('Dropping off kids at Ski School')) seen = d; }
    expect(seen).toContain('Ski School');
  });

  it('summer: Playground / Kids area when snow-free (no ski school)', () => {
    const t = setup({ snowy: false, playground: true });
    run(t.r, 60);
    const drop = t.log.find((l) => l.name === 'family:dropoff');
    expect(drop?.p).toMatchObject({ venue: 'playground' });
    expect(t.log.some((l) => l.name === 'lesson:started')).toBe(false);
  });

  it('winter without a ski school falls back to Kids Ground', () => {
    const t = setup({ school: false, kidsGround: true });
    run(t.r, 60);
    expect(t.log.find((l) => l.name === 'family:dropoff')?.p).toMatchObject({ venue: 'kidsGround' });
  });
});

describe('family happiness: school vs no school', () => {
  const mean = (t: ReturnType<typeof setup>): number => {
    const st = t.r.sim.store; let sum = 0, n = 0;
    for (const id of [...t.parents, ...t.kids]) { const s = st.slotOf(id); if (s >= 0) { sum += st.happiness[s]!; n++; } }
    return n ? sum / n : 0;
  };
  it('A/B: no Ski School / Kids Ground => lower family happiness and easy-run restriction', () => {
    const a = setup({ school: true }), b = setup({ school: false });
    let capped = false;
    for (let k = 0; k < 30; k++) {
      run(a.r, 1); run(b.r, 1);
      const sl = b.r.sim.store.slotOf(b.parents[0]!);
      if (sl >= 0 && b.r.sim.families.skillCap(sl) === 0) capped = true;
    }
    expect(b.r.sim.families.groups.get(9000)?.noSchool).toBe(true);
    expect(capped).toBe(true);
    expect(mean(a)).toBeGreaterThan(mean(b));
    expect(a.r.sim.families.groups.get(9000)?.noSchool).toBe(false);
  });
});

describe('kids safety', () => {
  it('kids never exist unaccompanied outside an open kid-safe venue (whole day, all phases)', () => {
    const t = setup({ kidsGround: true });
    for (let k = 0; k < 130; k++) {
      run(t.r, 1);
      expect(t.r.sim.families.unaccompaniedKids()).toEqual([]);
    }
    expect(t.log.some((l) => l.name === 'family:regroup')).toBe(true);
  });

  it('venue closing escorts kids back to the parents and the family regroups', () => {
    const t = setup();
    const fam = (): ReturnType<Rig['sim']['families']['groups']['get']> => t.r.sim.families.groups.get(9000);
    for (let k = 0; k < 40 && fam()?.phase !== FamilyPhase.AtVenue; k++) run(t.r, 1);
    expect(fam()?.phase).toBe(FamilyPhase.AtVenue);
    t.closed.add(t.ids.school!); // e.g. snow melts / dependency inactive
    run(t.r, 2);
    const reg = t.log.find((l) => l.name === 'family:regroup');
    expect(reg?.p).toMatchObject({ reason: 'venueClosed', group: 9000 });
    expect(fam()?.phase).not.toBe(FamilyPhase.AtVenue);
    expect(t.r.sim.families.unaccompaniedKids()).toEqual([]);
    const st = t.r.sim.store, ps = st.slotOf(t.parents[0]!), ks = st.slotOf(t.kids[0]!);
    if (ps >= 0 && ks >= 0) expect(Math.hypot(st.x[ps]! - st.x[ks]!, st.y[ps]! - st.y[ks]!)).toBeLessThan(2);
  });

  it('no instructors => the school is closed to new drop-offs', () => {
    const t = setup({ school: true, playground: false });
    t.r.sim.families.school(t.ids.school!).setInstructors(0);
    run(t.r, 40);
    expect(t.log.some((l) => l.name === 'family:dropoff')).toBe(false);
    expect(t.r.sim.families.groups.get(9000)?.noSchool).toBe(true);
  });

  it('family leaves together: kids despawn with the parents (never left behind)', () => {
    const t = setup({ startHour: 16.5 });
    const st = t.r.sim.store;
    run(t.r, 150);
    for (const id of [...t.parents, ...t.kids]) expect(st.slotOf(id)).toBe(-1);
    expect(t.r.sim.families.groups.size).toBe(0);
  });
});

describe('provider adapter', () => {
  it('maps building types to winter/summer venues using conditions', () => {
    resetIds();
    const f = starterResort(64);
    const school = f.addBuildingOnStreet('skiSchoolHQ', 36, 51), play = f.addBuildingOnStreet('playground', 50, 51);
    let snowy = true;
    const p = buildingKidsProvider(() => f.buildings, () => snowy);
    const open = (): string[] => p.areas().filter((a) => a.open).map((a) => a.kind);
    expect(open()).toContain('skiSchool'); expect(open()).not.toContain('playground');
    snowy = false;
    expect(open()).toContain('playground'); expect(open()).not.toContain('skiSchool');
    school.active = false; play.active = false;
    expect(open()).not.toContain('playground');
  });
});

describe('determinism', () => {
  it('same seed => same guest hash and event timeline', () => {
    const go = (): { h: string; names: string } => { const t = setup({ kidsGround: true, seed: 9 }); run(t.r, 100); return { h: t.r.sim.store.hash(), names: t.log.map((l) => `${l.t}:${l.name}`).join('|') }; };
    const a = go(), b = go();
    expect(a).toEqual(b);
    expect(a.names.length).toBeGreaterThan(0);
  });
});
void GState;
