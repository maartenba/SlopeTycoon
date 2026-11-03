import { REAL_SECONDS_PER_DAY_1X } from '@/config/balance';
import { describe, expect, it } from 'vitest';
import { DemoCamera, springStep, angleDelta, damp, easeInOutCubic, frameInside, lerpAngle, mulberry, pickPoi, planShot, shotAt, viewHeightAt, type Poi } from '../../src/render/DemoCamera';
import { DisposeBag, SeasonCycler, demoTimeScale, disposeTree } from '../../src/render/DemoScene';

const poi = (id: string, kind: Poi['kind'], x: number, z: number, zoom: [number, number] = [2, 4], extra: Partial<Poi> = {}): Poi => ({ id, kind, at: () => ({ x, z }), zoom, ...extra });

describe('DemoCamera pure helpers', () => {
  it('easing is monotonic with fixed ends', () => {
    expect(easeInOutCubic(0)).toBe(0); expect(easeInOutCubic(1)).toBe(1);
    let prev = -1;
    for (let i = 0; i <= 20; i++) { const v = easeInOutCubic(i / 20); expect(v).toBeGreaterThanOrEqual(prev); prev = v; }
    expect(easeInOutCubic(-3)).toBe(0); expect(easeInOutCubic(9)).toBe(1);
  });
  it('angles take the short way round', () => {
    expect(angleDelta(0.1, Math.PI * 2 - 0.1)).toBeCloseTo(-0.2, 6);
    expect(lerpAngle(3, -3, 0.5)).toBeCloseTo(3 + angleDelta(3, -3) / 2, 6);
  });
  it('damp is frame-rate independent', () => {
    const one = 1 - (1 - damp(2, 0.1)) ** 10;
    expect(one).toBeCloseTo(damp(2, 1), 9);
    expect(damp(2, 0)).toBe(0);
  });
  it('frameInside keeps the target inside the slab for any map / zoom / aspect', () => {
    for (const size of [64, 128]) for (const zoom of [1.25, 2, 4, 8]) for (const aspect of [0.6, 1.6, 2.4]) {
      for (const [x, z] of [[-50, -50], [0, 0], [size, size], [size + 99, size / 2], [size / 2, size / 2]]) {
        const f = frameInside({ x: x!, z: z!, yaw: 0, zoom }, size, aspect);
        const vh = viewHeightAt(size, zoom), half = Math.max(vh / 2, (vh * aspect) / 2);
        const m = Math.min(size * 0.5 - 1, half * 0.8);
        expect(f.x).toBeGreaterThanOrEqual(m - 1e-9); expect(f.x).toBeLessThanOrEqual(size - m + 1e-9);
        expect(f.z).toBeGreaterThanOrEqual(m - 1e-9); expect(f.z).toBeLessThanOrEqual(size - m + 1e-9);
      }
    }
  });
  it('mulberry is deterministic', () => {
    const a = mulberry(5), b = mulberry(5);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });
  it('pickPoi: deterministic, skips gone things, avoids repeating the kind', () => {
    const pois = [poi('v', 'village', 10, 10), poi('l', 'lake', 20, 20), poi('gone', 'skier', 0, 0, [2, 3], { at: () => null }), poi('t', 'train', 30, 30)];
    const run = (seed: number): string[] => { const r = mulberry(seed); const recent: string[] = []; let last: Poi['kind'] | null = null; const out: string[] = []; for (let i = 0; i < 12; i++) { const p: Poi = pickPoi(pois, recent, last, r)!; out.push(p.id); recent.push(p.id); if (recent.length > 2) recent.shift(); last = p.kind; } return out; };
    expect(run(3)).toEqual(run(3));
    const seq = run(3);
    expect(seq).not.toContain('gone');
    for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1]);
    expect(pickPoi([], [], null, mulberry(1))).toBeNull();
  });
  it('shots: zoom inside the POI range, frames stay in bounds across the whole plan', () => {
    const size = 128, rand = mulberry(9);
    for (let k = 0; k < 40; k++) {
      const p = poi('p', 'piste', 2 + k * 3, 120 - k * 2.5, [2.4, 5]);
      const plan = planShot(p, 0, rand, size);
      expect(plan.zoomA).toBeGreaterThanOrEqual(2.4 - 1e-9); expect(plan.zoomA).toBeLessThanOrEqual(5 + 1e-9);
      for (let t = 0; t <= plan.duration; t += plan.duration / 8) {
        const s = shotAt(plan, t, size, 1.6);
        const vh = viewHeightAt(size, s.zoom), half = Math.max(vh / 2, (vh * 1.6) / 2), m = Math.min(size / 2 - 1, half * 0.8);
        expect(s.x).toBeGreaterThanOrEqual(m - 1e-9); expect(s.x).toBeLessThanOrEqual(size - m + 1e-9);
        expect(Number.isFinite(s.yaw) && Number.isFinite(s.zoom)).toBe(true);
      }
    }
  });
  it('planShot gives distinct framings (wide / medium / close) over many draws', () => {
    const rand = mulberry(2), zs = new Set<number>();
    for (let i = 0; i < 60; i++) zs.add(Math.round(planShot(poi('p', 'lake', 64, 64, [2, 6]), 0, rand).zoomA));
    expect(zs.size).toBeGreaterThanOrEqual(3);
  });
});

describe('DemoCamera controller', () => {
  const makeCam = () => ({ target: { x: 32, y: 0, z: 32, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } }, yaw: 0, zoom: 2, minZoom: 1.25, maxZoom: 16, zoomBy() {} });
  it('runs a long loop: always in bounds, cycles through several POI kinds, no NaN', () => {
    const cam = makeCam();
    const kinds = new Set<string>();
    const pois = [poi('v', 'village', 40, 50), poi('l', 'lake', 20, 20), poi('t', 'train', 55, 45), poi('c', 'cat', 30, 35, [3, 5], { follow: true })];
    const d = new DemoCamera(cam, { size: 64, aspect: () => 1.6, pois: () => pois, seed: 4 });
    for (let i = 0; i < 6000; i++) {
      d.update(1 / 30);
      const cur = d.current(); if (cur) kinds.add(cur.kind);
      expect(Number.isFinite(cam.target.x + cam.target.z + cam.yaw + cam.zoom)).toBe(true);
      expect(cam.target.x).toBeGreaterThanOrEqual(0); expect(cam.target.x).toBeLessThanOrEqual(64);
      expect(cam.zoom).toBeGreaterThanOrEqual(cam.minZoom); expect(cam.zoom).toBeLessThanOrEqual(cam.maxZoom);
    }
    expect(kinds.size).toBeGreaterThanOrEqual(3);
  });
  it('reduced motion: one static village framing, never cuts, only a slow drift', () => {
    const cam = makeCam();
    const pois = [poi('l', 'lake', 20, 20), poi('v', 'village', 40, 50, [2, 3])];
    const d = new DemoCamera(cam, { size: 64, aspect: () => 1.6, pois: () => pois, reducedMotion: true });
    const kinds = new Set<string>();
    let maxStep = 0, last = cam.yaw;
    for (let i = 0; i < 3000; i++) { d.update(1 / 30); kinds.add(d.current()!.kind); maxStep = Math.max(maxStep, Math.abs(cam.yaw - last)); last = cam.yaw; }
    expect([...kinds]).toEqual(['village']);
    expect(maxStep).toBeLessThan(0.01);
  });
});

describe('DemoScene helpers', () => {
  it('demoTimeScale gives ~100 s days', () => { expect(REAL_SECONDS_PER_DAY_1X / demoTimeScale()).toBeCloseTo(100, 6); });
  it('SeasonCycler: waits, fades to black, jumps once at full black, alternates, fades back', () => {
    const c = new SeasonCycler(10, 1);
    const jumps: string[] = [];
    let maxFade = 0;
    for (let i = 0; i < 4000; i++) { const j = c.update(0.01); if (j) { jumps.push(j); expect(c.fade).toBe(1); } maxFade = Math.max(maxFade, c.fade); }
    expect(jumps.slice(0, 3)).toEqual(['summer', 'winter', 'summer']);
    expect(maxFade).toBe(1);
    expect(c.fade).toBeLessThanOrEqual(1);
  });
  it('DisposeBag runs everything once, newest first, survives throwing callbacks', () => {
    const bag = new DisposeBag(), order: number[] = [];
    bag.add(() => order.push(1)); bag.add(() => { throw new Error('x'); }); bag.add(() => order.push(3));
    const errs = bag.dispose();
    expect(order).toEqual([3, 1]); expect(errs).toHaveLength(1);
    expect(bag.dispose()).toEqual([]); expect(order).toEqual([3, 1]);
    let late = 0; bag.add(() => { late++; }); expect(late).toBe(1); // added after disposal: runs immediately
  });
  it('disposeTree disposes every geometry / material / texture exactly once (fake registry)', () => {
    const disposed: string[] = [];
    const res = (name: string, extra: Record<string, unknown> = {}) => ({ name, dispose: () => { disposed.push(name); }, ...extra });
    const tex = res('tex', { isTexture: true });
    const sharedMat = res('matShared');
    const objs = [
      { geometry: res('geoA'), material: sharedMat },
      { geometry: res('geoB'), material: sharedMat },
      { geometry: res('geoC'), material: [res('matM1', { map: tex }), res('matM2', { map: tex })] },
    ];
    const root = { traverse: (fn: (o: unknown) => void) => { for (const o of objs) fn(o); } };
    const n = disposeTree(root as never);
    expect(n).toBe(disposed.length);
    expect(new Set(disposed).size).toBe(disposed.length); // none twice
    expect(new Set(disposed)).toEqual(new Set(['geoA', 'geoB', 'geoC', 'matShared', 'matM1', 'matM2', 'tex']));
  });
});

describe('DemoCamera smoothness (the title camera used to wobble)', () => {
  it('springStep is exact: the same result at any step size, no overshoot, settles on the goal', () => {
    const a = { x: 0, v: 0 }, b = { x: 0, v: 0 };
    for (let i = 0; i < 100; i++) springStep(a, 10, 1.2, 0.01);
    springStep(b, 10, 1.2, 1);
    expect(a.x).toBeCloseTo(b.x, 9); expect(a.v).toBeCloseTo(b.v, 9);
    const c = { x: 0, v: 0 }; let max = -1;
    for (let i = 0; i < 2000; i++) { springStep(c, 10, 1.2, 0.01); max = Math.max(max, c.x); }
    expect(max).toBeLessThanOrEqual(10 + 1e-9); expect(c.x).toBeCloseTo(10, 6);
  });
  it('the velocity is continuous across a cut: a goal that jumps never makes the position jump or the speed step', () => {
    const s = { x: 5, v: 0 }; let prevV = 0, worst = 0;
    for (let i = 0; i < 600; i++) { const goal = i < 300 ? 5 : 45; springStep(s, goal, 0.9, 1 / 60); worst = Math.max(worst, Math.abs(s.v - prevV)); prevV = s.v; }
    expect(worst).toBeLessThan(0.7); // per-frame speed change (units / s): w^2 * distance / 60 = 0.54 here; a first-order follower jumps by rate * distance = 36
  });
  const run = (dtOf: (i: number) => number, frames: number): { poses: Array<{ x: number; z: number; y: number; yaw: number; zoom: number; t: number }> } => {
    const cam = { target: { x: 20, y: 0, z: 20, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } }, yaw: 0.9, zoom: 4, minZoom: 1, maxZoom: 12, zoomBy() {} };
    // the look height has a kink at every tile edge (bilinear ground): 0.8 per tile
    const d = new DemoCamera(cam, { size: 128, aspect: () => 1.6, pois: () => [poi('v', 'village', 60, 60, [2, 4]), poi('l', 'lift', 90, 30, [3, 6]), poi('s', 'skier', 40, 90, [4, 8], { follow: true })], groundY: (x, z) => Math.abs(((x * 0.8) % 2) - 1) * 0.8 + Math.abs(((z * 0.8) % 2) - 1) * 0.8, seed: 9 });
    const poses = []; let t = 0;
    for (let i = 0; i < frames; i++) { const dt = dtOf(i); t += dt; d.update(dt); poses.push({ x: cam.target.x, z: cam.target.z, y: cam.target.y, yaw: cam.yaw, zoom: cam.zoom, t }); }
    return { poses };
  };
  const accel = (p: Array<{ t: number; [k: string]: number }>, k: string): number => {
    let m = 0;
    for (let i = 2; i < p.length; i++) { const dt0 = p[i - 1]!.t - p[i - 2]!.t, dt1 = p[i]!.t - p[i - 1]!.t; const a = ((p[i]![k]! - p[i - 1]![k]!) / dt1 - (p[i - 1]![k]! - p[i - 2]![k]!) / dt0) / dt1; m = Math.max(m, Math.abs(a)); }
    return m;
  };
  it('over 90 s of shots (cuts included) the acceleration of every channel stays small and bounded at 60 fps', () => {
    const { poses } = run(() => 1 / 60, 5400);
    expect(accel(poses, 'x')).toBeLessThan(150); expect(accel(poses, 'z')).toBeLessThan(150); // w^2 * the longest cut (~128 tiles); the first-order follower reached 1000+
    expect(accel(poses, 'yaw')).toBeLessThan(3); expect(accel(poses, 'zoom')).toBeLessThan(6);
    expect(accel(poses, 'y')).toBeLessThan(10); // the bilinear kinks of the ground height are low-passed
  });
  it('a frame-time spike (a 120 ms hitch every second) does not make the camera lurch: the path is a function of continuous time', () => {
    const smooth = run(() => 1 / 60, 3600).poses, hitchy = run((i) => (i % 60 === 30 ? 0.12 : 1 / 60), 3600).poses;
    // compare the poses at the same elapsed time: nearest hitchy sample to each smooth time
    let worst = 0, j = 0;
    for (let i = 600; i < smooth.length; i += 7) { while (j < hitchy.length - 1 && hitchy[j]!.t < smooth[i]!.t) j++; worst = Math.max(worst, Math.hypot(hitchy[j]!.x - smooth[i]!.x, hitchy[j]!.z - smooth[i]!.z)); }
    expect(worst).toBeLessThan(6); // (tiles) the integration of the hitchy run is exact, only the shot clock / picking differ slightly
  });
});
