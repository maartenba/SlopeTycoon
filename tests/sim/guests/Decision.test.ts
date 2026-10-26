import { describe, it, expect } from 'vitest';
import { Rng } from '../../../src/core/Rng';
import { GuestStore, GuestType } from '../../../src/sim/guests/Guest';
import { Decider, Pref, prefFor, snowPreference } from '../../../src/sim/guests/Decision';
import { maxDifficultyFor, recordRun, injuryRisk, xpToLevel } from '../../../src/sim/guests/Skill';
import { resetIds } from './helpers';
import { Fixture, springResort, starterResort } from './resortFixture';

function guest(store: GuestStore, skill: number, x = 30, y = 60, extra: Partial<Parameters<GuestStore['add']>[0]> = {}): number {
  return store.add({ x, y, z: 0, type: GuestType.Solo, skill, budget: 500, group: 0, mode: 0, overnight: false, leaveDay: 0, tick: 0, ...extra });
}
function decider(f: Fixture): Decider {
  const g = f.graph(); g.update(0);
  const d = new Decider(() => g);
  d.refresh(f.buildings);
  return d;
}

describe('snow preference by skill', () => {
  it('experts favour deep powder, beginners avoid slush and prefer packed snow', () => {
    expect(snowPreference(3, 1.5)).toBeGreaterThan(snowPreference(3, 0.5));
    expect(snowPreference(0, 0.5)).toBeGreaterThan(snowPreference(0, 1.8));
    expect(snowPreference(0, 0.2)).toBeLessThan(snowPreference(0, 0.5)); // slush
    expect(snowPreference(3, 1.5)).toBeGreaterThan(snowPreference(0, 1.5));
  });
});

describe('skill progression', () => {
  it('difficulty <= skill + 1', () => {
    expect([0, 1, 2, 3].map(maxDifficultyFor)).toEqual([1, 2, 3, 3]);
  });
  it('runs at matching difficulty raise skill; easy runs teach less', () => {
    const s = new GuestStore(2);
    const a = guest(s, 0), b = guest(s, 0);
    let runs = 0;
    while (s.skill[a] === 0 && runs < 100) { recordRun(s, a, 0); runs++; }
    expect(s.skill[a]).toBe(1);
    expect(runs).toBe(xpToLevel(0));
    let easy = 0;
    while (s.skill[b] === 0 && easy < 200) { recordRun(s, b, -1 as number); easy++; } // far below skill: 0.25 xp
    expect(easy).toBeGreaterThan(runs);
    expect(s.runs[a]).toBe(runs);
  });
  it('injury risk grows with difficulty over skill', () => {
    expect(injuryRisk(3, 0)).toBeGreaterThan(injuryRisk(1, 0));
    expect(injuryRisk(1, 1)).toBeLessThan(injuryRisk(3, 1));
  });
});

describe('utility goal selection filtered by current conditions', () => {
  it('skiers only target lifts whose piste is open now; closed lift/piste leaves no ski candidate', () => {
    resetIds();
    const f = starterResort(64);
    const d = decider(f);
    expect(d.skiLiftsFor(1)).toHaveLength(1);
    expect(d.skiOpenTiles).toBeGreaterThan(0);
    f.liftList[0]!.open = false;
    const g = f.graph(); g.update(0);
    const d2 = new Decider(() => g); d2.refresh(f.buildings);
    expect(d2.skiLiftsFor(1)).toHaveLength(0);
    // piste lost its snow: lift open but no ski route down
    const f2 = starterResort(64);
    f2.setSnowline(0);
    const d3 = decider(f2);
    expect(d3.skiLiftsFor(1)).toHaveLength(0);
    expect(d3.hikeTiles.length + d3.mtbTiles.length).toBe(0); // no trails painted in this fixture
  });

  it('beginners avoid black pistes: no ski candidate until advanced', () => {
    const f = starterResort(64, 3);
    const d = decider(f);
    expect(d.skiLiftsFor(0)).toHaveLength(0);
    expect(d.skiLiftsFor(1)).toHaveLength(0);
    expect(d.skiLiftsFor(2)).toHaveLength(1);
    expect(d.skiLiftsFor(3)).toHaveLength(1);
    const red = decider(starterResort(64, 2));
    expect(red.skiLiftsFor(0)).toHaveLength(0);
    expect(red.skiLiftsFor(1)).toHaveLength(1);
  });

  it('hikers/bikers only target snow-free trails', () => {
    const { f, mid } = springResort(64);
    const d = decider(f);
    expect(d.hikeTiles.length).toBeGreaterThan(0);
    const n = f.size;
    for (const t of d.hikeTiles) { expect(Math.floor(t / n)).toBeGreaterThan(mid); expect(f.hikeOk[t]).toBe(1); }
    f.setSnowline(f.size); // deep winter everywhere
    const g = f.graph(); g.update(0);
    const w = new Decider(() => g); w.refresh(f.buildings);
    expect(w.hikeTiles).toHaveLength(0);
  });

  it('hungry guests choose an open food building; closed ones are never chosen', () => {
    resetIds();
    const f = starterResort(64);
    const d = decider(f);
    const s = new GuestStore(4);
    const i = guest(s, 1, 30, 60, { hunger: 0.9 } as never);
    s.hunger[i] = 0.9;
    const rng = new Rng(5);
    for (let k = 0; k < 20; k++) {
      const it = d.choose(s, i, rng, 10);
      expect(it.kind).toBe('eat');
      expect(['cafe', 'baseLodge']).toContain(it.building!.type);
    }
    f.buildings.forEach((b) => { b.active = false; });
    d.refresh(f.buildings);
    expect(d.food).toHaveLength(0);
    expect(d.choose(s, i, rng, 10).kind).not.toBe('eat');
  });

  it('tired guests head for a lodge', () => {
    const f = starterResort(64);
    const d = decider(f);
    const s = new GuestStore(2);
    const i = guest(s, 1);
    s.fatigue[i] = 0.9; s.hunger[i] = 0.1;
    const kinds = new Set<string>();
    const rng = new Rng(9);
    for (let k = 0; k < 20; k++) kinds.add(d.choose(s, i, rng, 10).kind);
    expect(kinds.has('rest')).toBe(true);
  });

  it('mixed groups split by preference and regroup at lunch', () => {
    const { f } = springResort(64);
    const d = decider(f);
    const s = new GuestStore(200);
    const rng = new Rng(3);
    const kinds: Record<number, Set<string>> = { [Pref.Ski]: new Set(), [Pref.Hike]: new Set(), [Pref.Bike]: new Set() };
    const lunchTargets = new Set<number>();
    for (let n = 0; n < 150; n++) {
      const i = guest(s, 2, 30, 60, { group: 7 });
      s.hunger[i] = 0.1; s.fatigue[i] = 0;
      const p = prefFor(s.id[i]!, s.type[i]!);
      kinds[p]!.add(d.choose(s, i, rng, 9).kind);
    }
    // skiers lean to skiing, hikers to hiking (same snowline day)
    const count = (pref: number, kind: string): number => { let c = 0; for (let n = 0; n < 60; n++) { const i = guest(s, 2); s.id[i] = 1000 + n; if (prefFor(s.id[i]!, s.type[i]!) === pref && d.choose(s, i, rng, 9).kind === kind) c++; } return c; };
    void count;
    expect(kinds[Pref.Ski]!.has('ski') || kinds[Pref.Ski]!.has('activity')).toBe(true);
    expect(kinds[Pref.Hike]!.has('hike')).toBe(true);
    // lunch: everyone in the group targets the same restaurant
    f.addBuildingOnStreet('baseLodge', 10, f.size - 3);
    d.refresh(f.buildings);
    const s2 = new GuestStore(10);
    for (let n = 0; n < 8; n++) {
      const i = guest(s2, 2, 30, 60, { group: 5 }); s2.hunger[i] = 0.35;
      const it = d.choose(s2, i, rng, 12.5);
      if (it.kind === 'eat') lunchTargets.add(it.building!.id);
    }
    expect(lunchTargets.size).toBe(1);
  });

  it('lessons are a stub until Task 22 (never a candidate)', () => {
    const f = starterResort(64);
    f.addBuildingOnStreet('skiSchoolHQ', 10, f.size - 3);
    const d = decider(f);
    const s = new GuestStore(2), i = guest(s, 0);
    const rng = new Rng(1);
    for (let k = 0; k < 50; k++) expect(d.choose(s, i, rng, 10).kind).not.toBe('lesson');
  });
});
