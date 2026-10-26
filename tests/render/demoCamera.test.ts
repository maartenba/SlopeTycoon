import { REAL_SECONDS_PER_DAY_1X } from '@/config/balance';
import { describe, expect, it } from 'vitest';
import { DemoCamera, angleDelta, damp, easeInOutCubic, frameInside, lerpAngle, mulberry, pickPoi, planShot, shotAt, viewHeightAt, type Poi } from '../../src/render/DemoCamera';
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
