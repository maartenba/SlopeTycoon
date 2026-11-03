import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  DENSITY_STEPS, PERSP_CAMERA_SLACK, STATIC_SET_HZ, STATIC_SUN_HZ, castDensityTarget, castHash, mixSig, needsStaticRender, quantiseDensity, slewDensity, staticLoadScale, treeCasts, SIG_SEED, type StaticState,
} from '@/render/shadowSchedule';
import { ShadowRig } from '@/render/ShadowRig';
import { SHADOW_MAP_SIZE } from '@/render/shadowFit';
import { shadowPassUniforms } from '@/render/shadowChunk';

const base: StaticState = { hasStatic: true, windowChanged: false, age: 0, sunChanged: false, setChanged: false, densityChanged: false, cameraMoved: false };

describe('static refresh decision (pure)', () => {
  it('nothing changed: the cached static depth is reused for ever', () => {
    expect(needsStaticRender({ ...base, age: 1000 })).toBe(false);
  });
  it('no static map yet, or a new window: render at once, whatever the age or the load', () => {
    expect(needsStaticRender({ ...base, hasStatic: false }, 0.1)).toBe(true);
    expect(needsStaticRender({ ...base, windowChanged: true }, 0.1)).toBe(true);
  });
  it('sun steps, static-set changes, density steps and a moved perspective camera wait for their own rate', () => {
    expect(needsStaticRender({ ...base, sunChanged: true, age: 0.5 / STATIC_SUN_HZ })).toBe(false);
    expect(needsStaticRender({ ...base, sunChanged: true, age: 1.01 / STATIC_SUN_HZ })).toBe(true);
    for (const k of ['setChanged', 'densityChanged', 'cameraMoved'] as const) {
      expect(needsStaticRender({ ...base, [k]: true, age: 0.5 / STATIC_SET_HZ })).toBe(false);
      expect(needsStaticRender({ ...base, [k]: true, age: 1.01 / STATIC_SET_HZ })).toBe(true);
    }
  });
  it('under load only the static rate drops (never the window fit)', () => {
    expect(staticLoadScale(1 / 60)).toBe(1);
    expect(staticLoadScale(1 / 35)).toBeLessThan(1);
    expect(staticLoadScale(1 / 20)).toBeLessThan(staticLoadScale(1 / 35));
    const age = 1.2 / STATIC_SET_HZ;
    expect(needsStaticRender({ ...base, setChanged: true, age }, 1)).toBe(true);
    expect(needsStaticRender({ ...base, setChanged: true, age }, staticLoadScale(1 / 20))).toBe(false);
    expect(needsStaticRender({ ...base, windowChanged: true }, staticLoadScale(1 / 20))).toBe(true);
  });
  it('camera slack is a few world units', () => { expect(PERSP_CAMERA_SLACK).toBeGreaterThan(0); expect(PERSP_CAMERA_SLACK).toBeLessThan(10); });
});

describe('tree cast density: gradual, nested, no pop', () => {
  it('is 1 below half the budget, 0 at the budget, strictly falling in between (the old hard cut was 1 -> 0 in one step)', () => {
    const B = 1_200_000;
    expect(castDensityTarget(0, B)).toBe(1);
    expect(castDensityTarget(B * 0.5, B)).toBe(1);
    expect(castDensityTarget(B, B)).toBe(0);
    expect(castDensityTarget(B * 3, B)).toBe(0);
    let prev = 1;
    for (let t = 0.5; t <= 1.0001; t += 0.02) { const d = castDensityTarget(B * t, B); expect(d).toBeLessThanOrEqual(prev + 1e-12); expect(prev - d).toBeLessThan(0.1); prev = d; }
    expect(Number.isFinite(castDensityTarget(NaN, B))).toBe(true);
  });
  it('slews at a bounded rate (a huge dt cannot jump) and quantises to steps', () => {
    let d = 1; d = slewDensity(d, 0, 10); expect(d).toBeGreaterThan(0.5); // capped dt 0.25 s * 0.25/s
    d = slewDensity(0.5, 0.5, 1); expect(d).toBe(0.5);
    for (let i = 0; i < 40; i++) d = slewDensity(d, 0, 0.1); expect(d).toBe(0);
    expect(quantiseDensity(0.5 + 1e-9) * DENSITY_STEPS).toBeCloseTo(8, 9);
    expect(quantiseDensity(-1)).toBe(0); expect(quantiseDensity(7)).toBe(1);
  });
  it('a density step only adds or removes the trees between two hashes (nested sets: no reshuffle)', () => {
    const seeds = Array.from({ length: 2000 }, (_, i) => ((i * 0.6180339887) % 1));
    const count = (d: number): number => seeds.filter((s) => treeCasts(s, d)).length;
    let prev = 0;
    for (let k = 0; k <= DENSITY_STEPS; k++) {
      const d = k / DENSITY_STEPS, c = count(d);
      expect(c).toBeGreaterThanOrEqual(prev);
      for (const s of seeds) if (treeCasts(s, Math.max(0, d - 1 / DENSITY_STEPS))) expect(treeCasts(s, d)).toBe(true);
      expect(c - prev).toBeLessThan(seeds.length * 0.2); // one step flips ~1/16 of the trees, not all of them
      prev = c;
    }
    expect(count(1)).toBe(seeds.length); expect(count(0)).toBe(0);
    for (const s of seeds) { const h = castHash(s); expect(h).toBeGreaterThanOrEqual(0); expect(h).toBeLessThan(1); }
  });
  it('signature mixing is order sensitive and stable', () => {
    expect(mixSig(SIG_SEED, 5)).toBe(mixSig(SIG_SEED, 5));
    expect(mixSig(mixSig(SIG_SEED, 1), 2)).not.toBe(mixSig(mixSig(SIG_SEED, 2), 1));
    expect(mixSig(SIG_SEED, 1)).not.toBe(mixSig(SIG_SEED, 2));
  });
});

/** A fake renderer that records, per `render`, which meshes the pass would draw (visible, in the scene's current children) and which target it drew into. */
function fakeRenderer(): { gl: THREE.WebGLRenderer; passes: Array<{ names: string[]; target: unknown }>; copies: number } {
  const state = { target: null as unknown, copies: 0, passes: [] as Array<{ names: string[]; target: unknown }> };
  const gl = {
    outputColorSpace: THREE.SRGBColorSpace, autoClear: true, info: { render: { triangles: 0, calls: 0 } },
    getRenderTarget: () => state.target, setRenderTarget: (t: unknown) => { state.target = t; }, clear: () => {},
    copyTextureToTexture: () => { state.copies++; },
    render: (scene: THREE.Scene) => {
      const names: string[] = [];
      const walk = (o: THREE.Object3D): void => { if (!o.visible) return; if ((o as THREE.Mesh).isMesh && o.name) names.push(o.name); for (const c of o.children) walk(c); };
      for (const c of scene.children) walk(c);
      state.passes.push({ names, target: state.target });
    },
  } as unknown as THREE.WebGLRenderer;
  return { gl, get passes() { return state.passes; }, get copies() { return state.copies; } };
}

describe('ShadowRig: static cache + per-frame dynamic pass', () => {
  const mesh = (name: string, x = 0): THREE.Mesh => { const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()); m.name = name; m.position.x = x; return m; };
  const setup = (): { rig: ShadowRig; fr: ReturnType<typeof fakeRenderer>; scene: THREE.Scene; cam: THREE.OrthographicCamera; focus: THREE.Vector3; dyn: THREE.Group; frame: (dt?: number, f?: THREE.Vector3) => void } => {
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff), mesh('houseA', 3), mesh('houseB', -3));
    const dyn = new THREE.Group(); dyn.userData.shadowDynamic = true; dyn.add(mesh('guest')); scene.add(dyn);
    const fr = fakeRenderer();
    const rig = new ShadowRig(fr.gl, scene);
    rig.setEnabled(true);
    const cam = new THREE.OrthographicCamera(-15, 15, 10, -10, 0.1, 400); cam.position.set(40, 40, 40); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    const focus = new THREE.Vector3(0, 0, 0);
    const frame = (dt = 1 / 60, f = focus): void => rig.update(dt, true, cam, f, [0.4, 0.8, 0.3], 0, 0, [-3, 60]);
    return { rig, fr, scene, cam, focus, dyn, frame };
  };
  it('the first frame renders the static set once, then only the dynamic casters every frame (static depth is copied, never re-rendered)', () => {
    const { rig, fr, frame } = setup();
    frame();
    expect(rig.stats.staticPasses).toBe(1);
    expect(fr.passes[0]!.names.sort()).toEqual(['houseA', 'houseB']); // the guest is NOT in the static pass
    for (let i = 0; i < 30; i++) frame();
    expect(rig.stats.staticPasses).toBe(1);
    expect(rig.stats.dynPasses).toBe(31);
    expect(fr.copies).toBe(31);
    for (const p of fr.passes.slice(1)) expect(p.names).toEqual(['guest']); // only the dynamic root (and the lights) is drawn
    rig.dispose();
  });
  it('dynamic casters are drawn every single frame, at any frame rate (never throttled), and the scene is restored after each pass', () => {
    const { rig, fr, scene, frame } = setup();
    const before = scene.children.slice();
    for (const dt of [1 / 144, 1 / 60, 1 / 30, 1 / 12, 0.1]) { const n = rig.stats.dynPasses; frame(dt); expect(rig.stats.dynPasses).toBe(n + 1); }
    expect(scene.children).toEqual(before);
    for (const o of scene.children) expect(o.visible).toBe(true);
    expect(fr.passes.length).toBeGreaterThan(5);
    rig.dispose();
  });
  it('a panned view inside the window keeps the static map; leaving the window refits and re-renders at once', () => {
    const { rig, frame, focus } = setup();
    frame();
    const n = rig.stats.staticPasses;
    frame(1 / 60, new THREE.Vector3(0.5, 0, 0.5)); frame(1 / 60, new THREE.Vector3(1, 0, 0.2));
    expect(rig.stats.staticPasses).toBe(n);
    frame(1 / 60, new THREE.Vector3(60, 0, 60));
    expect(rig.stats.staticPasses).toBe(n + 1);
    void focus; rig.dispose();
  });
  it('a changed static set (a new building) re-renders the static map at its rate; a new dynamic caster alone does not', () => {
    const { rig, scene, dyn, frame } = setup();
    frame(); for (let i = 0; i < 10; i++) frame(0.05);
    const n = rig.stats.staticPasses;
    dyn.add(mesh('guest2')); for (let i = 0; i < 10; i++) frame(0.05);
    expect(rig.stats.staticPasses).toBe(n);
    scene.add(mesh('houseC', 5)); for (let i = 0; i < 6; i++) frame(0.05);
    expect(rig.stats.staticPasses).toBe(n + 1);
  });
  it('staticRateScale slows the static refresh of a pure change (the title demo) but never a window re-fit; a hitching frame defers a pure refresh by one frame', () => {
    const { rig, scene, frame } = setup();
    for (let i = 0; i < 60; i++) frame(1 / 60);
    rig.staticRateScale = 0.25; // set rate 8 Hz -> 2 Hz: a new building waits 0.5 s
    scene.add(mesh('houseB2', 4)); for (let i = 0; i < 3; i++) frame(1 / 60); // old cache: renders at once (age >> 0.5 s)
    const n = rig.stats.staticPasses;
    scene.add(mesh('houseC', 5)); for (let i = 0; i < 20; i++) frame(1 / 60); // 0.33 s since the last static render < 0.5 s
    expect(rig.stats.staticPasses).toBe(n);
    for (let i = 0; i < 20; i++) frame(1 / 60); // past 0.5 s
    expect(rig.stats.staticPasses).toBe(n + 1);
    // a re-fit is never throttled by the scale
    frame(1 / 60, new THREE.Vector3(80, 0, 80));
    expect(rig.stats.staticPasses).toBe(n + 2);
    // a spike frame (dt 0.2 after smooth 60 fps frames) defers a pure refresh by a frame, a normal frame after it renders it
    rig.staticRateScale = 1;
    for (let i = 0; i < 30; i++) frame(1 / 60);
    const m1 = rig.stats.staticPasses;
    scene.add(mesh('houseE', -4)); for (let i = 0; i < 12 && rig.stats.staticPasses === m1; i++) frame(1 / 60); // renders at once (cache old), so the cache is fresh again
    const m0 = rig.stats.staticPasses;
    scene.add(mesh('houseD', -5)); for (let i = 0; i < 4; i++) frame(1 / 60); // the scan notices it, the 8 Hz rate is not due yet
    expect(rig.stats.staticPasses).toBe(m0);
    frame(0.2);
    expect(rig.stats.staticPasses).toBe(m0);
    frame(1 / 60);
    expect(rig.stats.staticPasses).toBe(m0 + 1);
    rig.dispose();
  });
  it('reports why the static map was re-rendered (bisect counters) and freezeStatic stops further re-renders', () => {
    const { rig, scene, frame } = setup();
    frame();
    expect(rig.stats.why.first).toBe(1);
    for (let i = 0; i < 10; i++) frame(0.05);
    scene.add(mesh('houseC', 5)); for (let i = 0; i < 6; i++) frame(0.05);
    expect(rig.stats.why.set).toBe(1);
    rig.freezeStatic = true;
    const n = rig.stats.staticPasses;
    scene.add(mesh('houseE', 6)); for (let i = 0; i < 10; i++) frame(0.05);
    expect(rig.stats.staticPasses).toBe(n);
    rig.dispose();
  });
  it('shadows off at night: nothing renders; memory is the 24 MB the doc promises and both targets are freed when High goes off', () => {
    const { rig, fr } = setup();
    rig.update(1 / 60, true, new THREE.OrthographicCamera(), new THREE.Vector3(), [0.4, 0.8, 0.3], 1, 0, [-3, 60]);
    expect(fr.passes.length).toBe(0);
    rig.update(1 / 60, true, new THREE.OrthographicCamera(-15, 15, 10, -10, 0.1, 400), new THREE.Vector3(), [0.4, 0.8, 0.3], 0, 0, [-3, 60]);
    expect(rig.stats.memMB).toBeLessThanOrEqual(28);
    expect(rig.stats.memMB).toBe(2 * SHADOW_MAP_SIZE * SHADOW_MAP_SIZE * 3 / 1048576);
    rig.setEnabled(false);
    expect(rig.stats.memMB).toBe(0);
    expect(rig.uniforms.tShadow.value).toBeNull();
    expect(shadowPassUniforms.uShDens.value).toBe(1);
  });
  it('the heavy-budget density is gradual: a rising triangle count thins the trees in small steps, never 1 -> 0 at once', () => {
    const { rig, fr, scene } = setup();
    const trees = new THREE.Group(); trees.userData.shadowHeavy = true; trees.add(mesh('forest')); scene.add(trees);
    const info = (fr.gl as unknown as { info: { render: { triangles: number } } }).info.render;
    const seen: number[] = [];
    const cam = new THREE.OrthographicCamera(-15, 15, 10, -10, 0.1, 400); cam.position.set(40, 40, 40); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
    info.triangles = 1_150_000; // between 50 % and 100 % of the budget: a fractional density
    for (let i = 0; i < 400; i++) { rig.update(0.05, true, cam, new THREE.Vector3(), [0.4, 0.8, 0.3], 0, 0, [-3, 60]); if (seen[seen.length - 1] !== rig.stats.density) seen.push(rig.stats.density); }
    expect(seen.length).toBeGreaterThan(3);
    for (let i = 1; i < seen.length; i++) expect(Math.abs(seen[i]! - seen[i - 1]!)).toBeLessThanOrEqual(0.2);
    expect(seen[seen.length - 1]!).toBeGreaterThan(0); expect(seen[seen.length - 1]!).toBeLessThan(0.4);
    rig.dispose();
  });
});
