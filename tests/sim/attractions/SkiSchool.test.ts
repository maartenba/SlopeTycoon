import { describe, it, expect } from 'vitest';
import { SkiSchool, SKI_SCHOOL } from '../../../src/sim/attractions/SkiSchool';

function school(instructors: number): { s: SkiSchool; earned: Array<[string, number]>; finished: number[][] } {
  const earned: Array<[string, number]> = [], finished: number[][] = [];
  const s = new SkiSchool(1, { earn: (c, a) => earned.push([c, a]), onFinished: (_i, g) => finished.push(g.kids) });
  s.setInstructors(instructors);
  return { s, earned, finished };
}

describe('SkiSchool runtime', () => {
  it('lesson capacity follows the instructor count', () => {
    const { s } = school(1);
    expect(s.capacity).toBe(SKI_SCHOOL.kidsPerInstructor);
    s.setInstructors(3);
    expect(s.capacity).toBe(3 * SKI_SCHOOL.kidsPerInstructor);
    s.setInstructors(-5); expect(s.instructors).toBe(0);
    s.setInstructors(999); expect(s.instructors).toBe(SKI_SCHOOL.maxInstructors);
  });
  it('queues groups that do not fit and starts them as capacity frees up', () => {
    const { s } = school(1); // 4 kids at a time
    s.enroll(1, [1, 2, 3], 0); s.enroll(2, [4, 5, 6], 0); // 3 + 3 > 4
    s.update(0);
    expect(s.activeKids).toBe(3);
    expect(s.queuedKids).toBe(3);
    expect(s.activeKids).toBeLessThanOrEqual(s.capacity);
    s.update(SKI_SCHOOL.lessonTicks);
    expect(s.queuedKids).toBe(0); expect(s.activeKids).toBe(3);
    expect(s.lessonsTotal).toBe(2);
  });
  it('more instructors => both groups learn at once; quality reflects the ratio', () => {
    const a = school(1), b = school(2);
    for (const x of [a, b]) { x.s.enroll(1, [1, 2, 3], 0); x.s.enroll(2, [4, 5, 6], 0); x.s.update(0); }
    expect(b.s.activeKids).toBe(6); expect(a.s.activeKids).toBe(3);
    expect(b.s.quality()).toBeGreaterThan(a.s.quality());
  });
  it('charges the lesson fee to the lessons ledger when a lesson finishes, and counts lessons today', () => {
    const { s, earned, finished } = school(2);
    s.newDay(3);
    s.enroll(1, [1, 2], 0);
    s.update(0); s.update(SKI_SCHOOL.lessonTicks - 1);
    expect(earned).toEqual([]);
    s.update(SKI_SCHOOL.lessonTicks);
    expect(earned).toEqual([['lessons', SKI_SCHOOL.fee * 2]]);
    expect(finished).toEqual([[1, 2]]);
    expect(s.lessonsToday).toBe(1);
    s.newDay(4); expect(s.lessonsToday).toBe(0);
  });
  it('zero instructors: nothing starts; withdraw removes a group', () => {
    const { s } = school(0);
    expect(s.isOpen()).toBe(false);
    s.enroll(1, [1], 0); s.update(0);
    expect(s.activeKids).toBe(0); expect(s.queuedKids).toBe(1);
    s.withdraw(1); expect(s.queuedKids).toBe(0);
  });
});
