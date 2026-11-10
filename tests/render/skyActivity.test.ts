/** M7.4 sky activities render (docs/m74-buildings.md): pure flight paths and the instanced view within its caps. */
import { describe, expect, it } from 'vitest';
import { SkyActivity, choosePlanePlan, obstacleTop, SKY_CLEAR, planePose, canopyPose, gliderPose, JUMP_AT, PLANE, SKY_CYCLE, type SkyCentre, type SkyObstacle, type SkyRamp } from '../../src/render/SkyActivity';
import { SKY_VIEW } from '../../src/config/sky';

describe('flight paths (pure, deterministic)', () => {
  it('the plane rolls on the strip, climbs to cruise altitude, jumps, comes back along the same corridor and lands on the strip axis, with no jumps in the path', () => {
    const p0 = planePose(0, 10, 10, 0), pTop = planePose(JUMP_AT, 10, 10, 0), pEnd = planePose(0.999, 10, 10, 0);
    expect(p0.z).toBeLessThan(0.1); expect(pTop.z).toBeGreaterThan(PLANE.alt * 0.9); expect(pEnd.z).toBeLessThan(0.4);
    expect(Math.abs(pEnd.y - 10)).toBeLessThan(0.1); expect(Math.hypot(p0.x - 10, p0.y - 10)).toBeLessThan(0.1); expect(Math.hypot(pEnd.x - 10, pEnd.y - 10)).toBeLessThan(0.1); // starts and ends at the strip centre
    let prev = planePose(0, 10, 10, 0, undefined);
    for (let i = 1; i <= 1000; i++) { const u = i / 1000, p = planePose(Math.min(u, 0.9999), 10, 10, 0); expect(Number.isFinite(p.x + p.y + p.z + p.heading)).toBe(true); expect(p.z).toBeGreaterThanOrEqual(0); expect(Math.hypot(p.x - 10, p.y - 10)).toBeLessThan(20); expect(Math.hypot(p.x - prev.x, p.y - prev.y)).toBeLessThan(0.3); expect(Math.abs(p.z - prev.z)).toBeLessThan(0.1); prev = { ...p }; }
    expect(planePose(0.3, 10, 10, 0)).toEqual(planePose(0.3, 10, 10, 0));
  });
  it('the plan flips the take-off end and the turn side (mirror images about the strip)', () => {
    const f = planePose(0.3, 10, 10, 0, undefined, { dir: 1, turn: 1 }), g = planePose(0.3, 10, 10, 0, undefined, { dir: -1, turn: 1 }), h = planePose(0.3, 10, 10, 0, undefined, { dir: 1, turn: -1 });
    expect(g.x - 10).toBeCloseTo(-(f.x - 10), 6); expect(g.y - 10).toBeCloseTo(-(f.y - 10), 6); expect(h.x).toBeCloseTo(f.x, 6); expect(h.y - 10).toBeCloseTo(-(f.y - 10), 6);
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

/** The staged promo `summer` town (promo/scenes.json, scripts/promo/towns): a 2 x 7 Grass Strip crowded by the village (buildings abut both ends and the sides). Footprints from the saved town. */
const SUMMER_TOWN: SkyObstacle[] = [
  { x: 62, y: 107, w: 4, h: 3, top: 2.8 }, { x: 68, y: 108, w: 4, h: 2, top: 1.7 }, { x: 59, y: 116, w: 5, h: 4, top: 1.05 }, { x: 61, y: 110, w: 2, h: 2, top: 1.2 }, { x: 59, y: 120, w: 3, h: 3, top: 1.9 },
  { x: 59, y: 112, w: 3, h: 4, top: 2 }, { x: 67, y: 110, w: 3, h: 3, top: 1.85 }, { x: 62, y: 114, w: 3, h: 2, top: 1.9 }, { x: 63, y: 121, w: 3, h: 3, top: 1.55 }, { x: 73, y: 102, w: 3, h: 3, top: 1.4 },
  { x: 55, y: 114, w: 3, h: 2, top: 1.2 }, { x: 71, y: 115, w: 3, h: 3, top: 1.9 }, { x: 65, y: 113, w: 3, h: 3, top: 1.9 }, { x: 73, y: 110, w: 3, h: 4, top: 2.95 }, { x: 59, y: 124, w: 4, h: 3, top: 1.55 },
];
describe('the plane clears every building (promo summer town layout)', () => {
  const strip = { x: 68, y: 113, w: 2, h: 7 }, cx = strip.x + strip.w / 2, cy = strip.y + strip.h / 2, ax = Math.PI / 2;
  const frames = (f: (u: number) => ReturnType<typeof planePose>, obst: readonly SkyObstacle[]): number => { let n = 0; for (let i = 0; i < 2000; i++) { const p = f(i / 2000); const m = p.z < 0.1 ? 0.15 : 0.5; if (obst.some((o) => p.x > o.x - m && p.x < o.x + o.w + m && p.y > o.y - m && p.y < o.y + o.h + m && p.z < o.top + SKY_CLEAR - 0.01)) n++; } return n; };
  it('the chosen take-off end clears every roof by >= 1 unit through the roll, the climb, the jump leg and the landing approach, without the safety floor', () => {
    const plan = choosePlanePlan(cx, cy, ax, SUMMER_TOWN);
    expect(frames((u) => planePose(u, cx, cy, ax, undefined, plan), SUMMER_TOWN)).toBe(0);
    expect(choosePlanePlan(cx, cy, ax, SUMMER_TOWN)).toEqual(plan); // deterministic
  });
  it('the old fixed path (end 1, no plan) is not what is relied on: a plan at the blocked end WOULD hit, and the safety floor repairs any plan', () => {
    expect(frames((u) => planePose(u, cx, cy, ax, undefined, { dir: -1, turn: 1 }), SUMMER_TOWN)).toBeGreaterThan(0);
    for (const pl of [{ dir: 1, turn: 1 }, { dir: -1, turn: 1 }, { dir: 1, turn: -1 }, { dir: -1, turn: -1 }] as const) expect(frames((u) => planePose(u, cx, cy, ax, undefined, pl, SUMMER_TOWN), SUMMER_TOWN)).toBe(0);
  });
  it('canopies and the obstacle helper never sit inside a roof', () => {
    expect(obstacleTop(69, 111, SUMMER_TOWN)).toBeGreaterThan(1); expect(obstacleTop(0, 0, SUMMER_TOWN)).toBe(0);
    const plan = choosePlanePlan(cx, cy, ax, SUMMER_TOWN);
    for (let u = 0.56; u < 0.97; u += 0.005) for (let k = 0; k < 6; k++) { const c = canopyPose(u, k, cx, cy, ax, undefined, plan, SUMMER_TOWN); if (c) expect(c.z).toBeGreaterThanOrEqual(obstacleTop(c.x, c.y, SUMMER_TOWN, 0.3) > 0 ? obstacleTop(c.x, c.y, SUMMER_TOWN, 0.3) + 0.49 : 0); }
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
