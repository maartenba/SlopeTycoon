/** M7.4 sky activities render (docs/m74-buildings.md): pure flight paths and the instanced view within its caps. */
import { describe, expect, it } from 'vitest';
import { SkyActivity, planePose, canopyPose, gliderPose, JUMP_AT, PLANE, SKY_CYCLE, type SkyCentre, type SkyRamp } from '../../src/render/SkyActivity';
import { SKY_VIEW } from '../../src/config/sky';

describe('flight paths (pure, deterministic)', () => {
  it('the plane rolls on the strip, climbs in a circle to cruise altitude, descends and lands back on the strip axis', () => {
    const p0 = planePose(0, 10, 10, 0), pTop = planePose(JUMP_AT, 10, 10, 0), pEnd = planePose(0.999, 10, 10, 0);
    expect(p0.z).toBeLessThan(0.1); expect(pTop.z).toBeGreaterThan(PLANE.alt * 0.9); expect(pEnd.z).toBeLessThan(0.4);
    expect(Math.abs(pEnd.y - 10)).toBeLessThan(0.1); // on the strip axis
    for (let u = 0; u < 1; u += 0.02) { const p = planePose(u, 10, 10, 0); expect(Number.isFinite(p.x + p.y + p.z + p.heading)).toBe(true); expect(p.z).toBeGreaterThanOrEqual(0); expect(Math.hypot(p.x - 10, p.y - 10)).toBeLessThan(PLANE.radius + 8); }
    expect(planePose(0.3, 10, 10, 0)).toEqual(planePose(0.3, 10, 10, 0));
  });
  it('canopies exist only after the jump, start at the plane and spiral down to the strip', () => {
    expect(canopyPose(0.2, 0, 10, 10, 0)).toBeNull(); expect(canopyPose(JUMP_AT, 0, 10, 10, 0)).toBeNull(); expect(canopyPose(0.99, 0, 10, 10, 0)).toBeNull();
    const a = canopyPose(JUMP_AT + 0.02, 1, 10, 10, 0)!, z = canopyPose(0.96, 1, 10, 10, 0)!;
    expect(a.z).toBeGreaterThan(z.z); expect(z.z).toBeLessThan(0.6); expect(Math.hypot(z.x - 10, z.y - 10)).toBeLessThan(3);
  });
  it('a glider leaves the ramp, circles lazily mid-way and ends over the landing field, never below the ground', () => {
    const ramp = { x: 5, y: 5 }, land = { x: 35, y: 30 };
    const a = gliderPose(0, ramp, land, 20, 8), m = gliderPose(0.5, ramp, land, 20, 8), e = gliderPose(1, ramp, land, 20, 8);
    expect(Math.hypot(a.x - ramp.x, a.y - ramp.y)).toBeLessThan(0.1); expect(Math.hypot(e.x - land.x, e.y - land.y)).toBeLessThan(0.1);
    expect(a.z).toBeGreaterThan(e.z); expect(m.z).toBeGreaterThan(e.z);
    for (let u = 0; u <= 1; u += 0.05) expect(gliderPose(u, ramp, land, 20, 8).z).toBeGreaterThan(8);
  });
});

describe('SkyActivity view', () => {
  const centres = (n: number, users = 6): SkyCentre[] => Array.from({ length: n }, (_, i) => ({ id: i + 1, users, open: true, strip: { x: 10 + i * 12, y: 10, w: 7, h: 2 } }));
  const ramps = (n: number, users = 3): SkyRamp[] => Array.from({ length: n }, (_, i) => ({ id: 50 + i, users, open: true, x: 5 + i * 8, y: 5, w: 2, h: 2, landing: { x: 30, y: 30 } }));
  it('draws nothing when closed or empty; a plane + canopies for an open busy centre; capped at SKY_VIEW (planes, canopies, 6 gliders in all)', () => {
    const v = new SkyActivity(() => 0, () => [], () => []);
    v.update(1); expect(v.drawn).toEqual({ planes: 0, canopies: 0, gliders: 0 });
    const closed = new SkyActivity(() => 0, () => [{ ...centres(1)[0]!, open: false }], () => [{ ...ramps(1)[0]!, open: false }]);
    closed.update(1); expect(closed.drawn).toEqual({ planes: 0, canopies: 0, gliders: 0 });
    const busy = new SkyActivity(() => 0, () => centres(4), () => ramps(5));
    let maxC = 0;
    for (let t = 1; t < SKY_CYCLE * 2; t += 3) { busy.update(t); expect(busy.drawn.planes).toBe(SKY_VIEW.planes); expect(busy.drawn.canopies).toBeLessThanOrEqual(SKY_VIEW.planes * SKY_VIEW.canopiesPerPlane); expect(busy.drawn.gliders).toBeLessThanOrEqual(SKY_VIEW.gliders); maxC = Math.max(maxC, busy.drawn.canopies); }
    expect(maxC).toBeGreaterThan(0); expect(busy.drawn.gliders).toBe(SKY_VIEW.gliders);
    expect(busy.group.children.length).toBe(3); // 3 draw calls
  });
  it('a glider needs a landing field; far zoom hides everything', () => {
    const nl = new SkyActivity(() => 0, () => [], () => [{ ...ramps(1)[0]!, landing: null }]);
    nl.update(5); expect(nl.drawn.gliders).toBe(0);
    const far = new SkyActivity(() => 0, () => centres(1), () => ramps(1)); far.far = true; far.update(7); expect(far.group.visible).toBe(false);
  });
});
