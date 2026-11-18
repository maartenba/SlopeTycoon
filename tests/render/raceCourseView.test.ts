import { describe, expect, it } from 'vitest';
import { RaceCourseView, GATE_CAP, GATE_TRIS, BOARD_SLOTS, boardLines, fmtTime } from '../../src/render/race/RaceCourseView';
import { SPONSORS } from '../../src/config/raceSponsors';
import { courseGates } from '../../src/sim/race/RaceCourse';
import { courseFixture } from '../sim/race/helpers';

describe('RaceCourseView', () => {
  it('draws one gate per derived gate on a marked course: 2 instanced meshes + 1 board mesh = 3 draw calls, inside the triangle budget', () => {
    const f = courseFixture(3); f.s.setRunCourse(f.id, true);
    const v = new RaceCourseView(f.s.grid, f.s.race, () => 0, () => 'Black Run');
    v.update(1);
    expect(v.gateCount).toBe(courseGates(f.run, f.s.size).length);
    expect(v.gateCount).toBeGreaterThan(5);
    expect(v.gateCount).toBeLessThanOrEqual(GATE_CAP);
    const meshes = v.group.children.filter((o) => (o as { isMesh?: boolean }).isMesh);
    expect(meshes.length).toBe(3);
    // budget (plan): <= +3 draw calls, <= +8k triangles with 3 courses: 3 x (<= 120 gates) x 14 + boards
    expect(GATE_TRIS).toBeLessThanOrEqual(60);
    expect(3 * 120 * GATE_TRIS + BOARD_SLOTS * 4).toBeLessThan(8000);
    expect(v.triangles()).toBeLessThan(8000);
    expect(v.boardCount).toBe(1);
    v.dispose();
  });
  it('shows nothing without a course, and drops the gates when the course is unmarked', () => {
    const f = courseFixture(3);
    const v = new RaceCourseView(f.s.grid, f.s.race, () => 0, () => 'x');
    v.update(1); expect(v.gateCount).toBe(0); expect(v.boardCount).toBe(0);
    f.s.setRunCourse(f.id, true); v.update(1); expect(v.gateCount).toBeGreaterThan(0);
    f.s.setRunCourse(f.id, false); v.update(1); expect(v.gateCount).toBe(0);
    v.dispose();
  });
  it('board text is pure: name, best time, racers', () => {
    expect(fmtTime(72_400)).toBe('1:12.4'); expect(fmtTime(5_040)).toBe('0:05.0');
    expect(boardLines('Black Run 2', 72_400, 7)).toEqual(['BLACK RUN 2', 'BEST 1:12.4', 'RACERS 7']);
    expect(boardLines('x', null, 0)[1]).toBe('BEST --:--.-');
  });
  it('race days (0.8.1): the board shows RACE DAY live, then the winner for a few days, and the sponsor on the third line; no extra mesh', () => {
    expect(boardLines('Black Run 2', 72_400, 7, { winnerMs: null, sponsor: 'Hinterwald Cheese Dairy', live: true })).toEqual(['BLACK RUN 2', 'RACE DAY - LIVE', 'HINTERWALD CHEESE DAIRY']);
    expect(boardLines('Black Run 2', 72_400, 7, { winnerMs: 70_100, sponsor: null, live: false })).toEqual(['BLACK RUN 2', 'WIN 1:10.1', 'RACERS 7']);
    expect(boardLines('Black Run 2', 72_400, 7, { winnerMs: null, sponsor: null, live: false })[1]).toBe('BEST 1:12.4');
    for (const sp of SPONSORS) expect(boardLines('x', null, 0, { winnerMs: null, sponsor: sp.name, live: false })[2].length).toBeLessThanOrEqual(28);
    const f = courseFixture(3); f.s.setRunCourse(f.id, true);
    const v = new RaceCourseView(f.s.grid, f.s.race, () => 0, () => 'Black Run', f.s.raceDay);
    v.update(1);
    expect(v.group.children.filter((o) => (o as { isMesh?: boolean }).isMesh).length).toBe(3); // still 3 draw calls
    v.dispose();
  });
});
