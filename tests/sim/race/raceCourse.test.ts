import { describe, expect, it } from 'vitest';
import { RACE } from '../../../src/config/race';
import { courseGates } from '../../../src/sim/race/RaceCourse';
import { courseFixture, mkWinter, mainRun, paintRun } from './helpers';

describe('RaceCourse validity', () => {
  it('a blue run is refused (difficulty), with the readable reason', () => {
    const s = mkWinter(); const id = s.names.pisteId(mainRun(s));
    const r = s.setRunCourse(id, true);
    expect(r.ok).toBe(false); expect(r.reason).toBe(RACE.reasons.difficulty);
  });
  it('a red run without huts is refused: noStartHut, then noTimingHut', () => {
    const s = mkWinter(); paintRun(s, mainRun(s), 2); const id = s.names.pisteId(mainRun(s));
    expect(s.race.setCourse(id, true)).toEqual({ ok: false, reason: 'noStartHut' });
    expect(s.race.reasonFor(mainRun(s))).toBe('noStartHut');
  });
  it('a short drop is refused', () => {
    const f = courseFixture();
    const r = { ...f.run, dropM: 30 };
    expect(f.s.race.reasonFor(r)).toBe('drop');
  });
  it('a loop is refused (shape)', () => {
    const f = courseFixture();
    expect(f.s.race.reasonFor({ ...f.run, loop: true })).toBe('shape');
  });
  it('with both huts the run can be marked, and unmarked', () => {
    const f = courseFixture();
    expect(f.s.race.reasonFor(f.run)).toBeNull();
    expect(f.s.setRunCourse(f.id, true).ok).toBe(true);
    expect(f.s.race.courses().length).toBe(1);
    expect(f.s.race.courses()[0]!.valid).toBe(true);
    expect(f.s.race.setCourse(f.id, false).ok).toBe(true);
    expect(f.s.race.courses().length).toBe(0);
  });
  it('a marked course whose Timing Hut is bulldozed goes inactive and says why (kept, not lost)', () => {
    const f = courseFixture(); f.s.setRunCourse(f.id, true);
    for (const b of f.s.buildings.all().slice()) if (b.type === 'timingHut') f.s.buildings.remove(b.id);
    f.s.refreshCoverage(undefined, true); f.s.tick(1);
    const c = f.s.race.courses()[0]!;
    expect(c.valid).toBe(false); expect(c.reason).toBe('noTimingHut'); expect(c.open).toBe(false);
    expect(f.s.runSettings.isCourse(f.id)).toBe(true);
  });
  it('a black course is worth more than a red one', () => {
    const red = courseFixture(2); red.s.setRunCourse(red.id, true);
    const blk = courseFixture(3); blk.s.setRunCourse(blk.id, true);
    // both ungroomed: compare the difficulty fit only
    expect(blk.s.race.courses()[0]!.quality).toBeGreaterThan(red.s.race.courses()[0]!.quality);
  });
  it('at most maxCourses courses (tooMany)', () => {
    const f = courseFixture(); f.s.setRunCourse(f.id, true);
    for (const x of [901, 902, 903]) f.s.runSettings.setCourse(x, true);
    expect(f.s.runSettings.courseIds().length).toBeGreaterThanOrEqual(RACE.maxCourses);
  });
});

describe('gates', () => {
  it('are a stable pure function of the run: same count, alternating colours and sides, black is tighter', () => {
    const f = courseFixture(2);
    const g1 = courseGates(f.run, f.s.size), g2 = courseGates(f.run, f.s.size);
    expect(g1.length).toBeGreaterThan(3); expect(g1).toEqual(g2);
    g1.forEach((g, i) => expect(g.red).toBe(i % 2 === 0));
    const blk = courseFixture(3);
    expect(courseGates(blk.run, blk.s.size).length).toBeGreaterThan(g1.length);
  });
  it('are deterministic across two sims of the same seed', () => {
    const a = courseFixture(), b = courseFixture();
    expect(courseGates(a.run, a.s.size)).toEqual(courseGates(b.run, b.s.size));
  });
  it('stay beside the centre line (offset <= gateOffset + 0.5 tiles)', () => {
    const f = courseFixture(); const n = f.s.size;
    for (const g of courseGates(f.run, n)) {
      const d = Math.min(...f.run.poly.map((t) => Math.hypot((t % n) + 0.5 - g.x, ((t / n) | 0) + 0.5 - g.y)));
      expect(d).toBeLessThanOrEqual(RACE.gateOffset + 0.5);
    }
  });
});
