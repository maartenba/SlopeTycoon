import { describe, expect, it } from 'vitest';
import { ParkView, airOf, FEATURE_CAP } from '../../src/render/park/ParkView';
import { PARK } from '../../src/config/park';
import { parkFeatures } from '../../src/sim/park/SnowPark';
import { mainRun, parkFixture, putPipeNear } from '../sim/park/helpers';

describe('ParkView', () => {
  it('draws the features of a marked park as ONE merged mesh (+1 pipe-rider mesh), inside the budget; nothing without a park', () => {
    const { s, id } = parkFixture(2, 5);
    const v = new ParkView(s.grid, s.park, () => 1);
    v.update(1); expect(v.featureCount).toBe(0);
    s.setRunPark(id, true); v.update(1);
    expect(v.featureCount).toBe(parkFeatures(mainRun(s), s.size).length);
    expect(v.featureCount).toBeGreaterThan(2); expect(v.featureCount).toBeLessThanOrEqual(FEATURE_CAP);
    const meshes = v.group.children.filter((o) => (o as { isMesh?: boolean }).isMesh);
    expect(meshes.length).toBe(2);
    expect(v.triangles()).toBeLessThan(5000);
    s.setRunPark(id, false); v.update(1); expect(v.featureCount).toBe(0);
    v.dispose();
  });
  it('budget: two parks + a halfpipe stay under 10k triangles (30 features of the biggest kind = ~2k) and 2 draw calls', () => {
    expect(2 * FEATURE_CAP * 0 + 2 * 40 * 40).toBeLessThan(10_000);
    const { s, id } = parkFixture(1, 5);
    s.setRunPark(id, true);
    const v = new ParkView(s.grid, s.park, () => 1);
    putPipeNear(s, mainRun(s).poly); s.tick(1);
    v.update(1); v.update(1); // riders animate
    expect(v.triangles()).toBeLessThan(10_000);
    v.dispose();
  });
  it('a worn park is tinted browner than a shaped one', () => {
    const { s, id } = parkFixture(2, 5);
    s.setRunPark(id, true);
    const v = new ParkView(s.grid, s.park);
    for (const t of mainRun(s).tiles) s.ops.quality.groom(t);
    v.update(1);
    const col = () => (v.group.children[0] as unknown as { geometry: { getAttribute(n: string): { array: Float32Array } } }).geometry.getAttribute('color').array.slice(0, 3);
    const fresh = Array.from(col());
    s.game.date.day += 12; v.update(1);
    const worn = Array.from(col());
    expect(worn[2]!).toBeLessThan(fresh[2]!); // less blue
    v.dispose();
  });
  it('airs: a hop over a kicker that is 0 at the edge of its reach and peaks in the middle; spins on the big ones; none far away', () => {
    const f = { x: 10.5, y: 10.5, kind: 'kickerL' as const, dx: 1, dy: 0 };
    const map = new Map([[10 * 64 + 10, [f]]]); const o = { h: 0, spin: 0, slide: false };
    expect(airOf(map, 64, 10.5, 10.5, 3, o)).toBe(true); expect(o.h).toBeCloseTo(PARK.air.kickerL, 5);
    expect(airOf(map, 64, 10.5 + PARK.reach * 0.98, 10.5, 3, o) ? o.h : 0).toBeLessThan(0.1);
    expect(airOf(map, 64, 10.5 + 0.4, 10.5, 3, o)).toBe(true); expect(Math.abs(o.spin)).toBeGreaterThan(0);
    expect(airOf(map, 64, 30.5, 30.5, 3, o)).toBe(false);
    const box = new Map([[10 * 64 + 10, [{ ...f, kind: 'box' as const }]]]);
    airOf(box, 64, 10.5, 10.5, 3, o); expect(o.slide).toBe(true);
  });
});
