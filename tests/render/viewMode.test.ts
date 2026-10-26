// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('@/render/textures', () => ({
  createTerrainTextures: () => ({
    grass: new THREE.Texture(), meadow: new THREE.Texture(), blossom: new THREE.Texture(),
    dirt: new THREE.Texture(), snow: new THREE.Texture(), rock: new THREE.Texture(),
  }),
}));

import { CameraController } from '@/render/CameraController';
import { ViewModeMachine, canTransition, type ViewMode } from '@/render/view/ViewMode';
import {
  Damped, EYE, FOV_MAX, FOV_MIN, LOOK_PITCH_MAX, LOOK_YAW_MAX, RIDE_FOV, ViewCameraRig, clampLook, eyeLateral, eyePosition, rideFar, wrapAngle, yawOfHeading,
  type RideKind, type RideSample,
} from '@/render/view/ViewCameraRig';
import { PERSPECTIVE_LOD_HEIGHT, horizonFraction, lodHeightFor, projectToScreen, terrainLodHeightFor } from '@/render/view/cameraMath';
import { ViewFog, fogDensityFor, fogRangeFor, fogUniforms } from '@/render/Fog';
import { TerrainMesh } from '@/render/TerrainMesh';
import { TreeLayer } from '@/render/props/Trees';
import { PropStore } from '@/world/Props';
import { Grid } from '@/world/Grid';
import { generateTerrain } from '@/world/TerrainGen';
import { pickHeightfield } from '@/render/Picking';
import { skyCss, skyGradient, lightingAt } from '@/render/Lighting';
import { GuestRenderer } from '@/render/GuestRenderer';
import { GuestStore } from '@/sim/guests/Guest';
import { generateProps } from '@/world/Props';
import { TREE_FADE_W, TREE_RIDE_FULL_DIST, TREE_RIDE_LOW_DIST, TREE_RIDE_NEAR_DIST } from '@/render/props/Trees';

const sample = (o: Partial<RideSample> = {}): RideSample => ({ x: 10, y: 5, z: 20, hx: 0, hz: -1, speed: 3, slope: 0, kind: 'ski', ...o });

describe('ViewMode state machine', () => {
  it('legal: iso <-> ride, iso <-> photo, ride <-> photo; walk: iso <-> walk, walk <-> photo; illegal: ride <-> walk, self', () => {
    const m = new ViewModeMachine();
    expect(m.mode).toBe('iso');
    expect(m.set('ride')).toBe(true); expect(m.mode).toBe('ride'); expect(m.isGround).toBe(true);
    expect(m.set('ride')).toBe(false);
    expect(m.set('walk')).toBe(false); expect(m.mode).toBe('ride');
    expect(m.set('photo')).toBe(true);
    expect(m.set('walk')).toBe(true); expect(m.set('photo')).toBe(true); // photo returns to walk
    expect(m.set('iso')).toBe(true); expect(m.isIso).toBe(true);
    expect(m.set('walk')).toBe(true); expect(m.set('ride')).toBe(false); expect(m.set('walk')).toBe(false); expect(m.set('iso')).toBe(true);
    for (const to of ['iso', 'photo'] as ViewMode[]) expect(canTransition('walk', to)).toBe(true);
    expect(canTransition('walk', 'ride')).toBe(false); expect(canTransition('ride', 'walk')).toBe(false);
  });
  it('notifies listeners (to, from) and supports unsubscribe', () => {
    const m = new ViewModeMachine(), seen: string[] = [];
    const off = m.onChange((to, from) => seen.push(`${from}>${to}`));
    m.set('ride'); m.set('iso'); off(); m.set('ride');
    expect(seen).toEqual(['iso>ride', 'ride>iso']);
  });
});

describe('rig pose maths', () => {
  const kinds = Object.keys(EYE) as RideKind[];
  it('eye = guest origin + up offset (+ forward along the heading), per ride kind', () => {
    const out = { x: 0, y: 0, z: 0 };
    for (const k of kinds) {
      eyePosition(sample({ kind: k, speed: 0 }), 0, 1, out);
      expect(out.y).toBeCloseTo(5 + EYE[k].up, 6);
      expect(out.x).toBeCloseTo(10 + eyeLateral(sample({ kind: k })), 6); // heading (0,-1): right = +x; cable carriers sit beside the line axis (seatLateral)
      expect(out.z).toBeCloseTo(20 - EYE[k].fwd, 6); // heading (0,-1)
    }
    expect(EYE.chair.up).toBeLessThan(EYE.ski.up); // cable carriers hang below the grip, skiers stand
    expect(EYE.gondola.interior && EYE.cablecar.interior && EYE.funicular.interior && !EYE.chair.interior && !EYE.ski.interior).toBe(true);
  });
  it('bob scales with speed and motion; reduced motion (0) = no bob; cable carriers do not bob', () => {
    const a = { x: 0, y: 0, z: 0 }, b = { x: 0, y: 0, z: 0 };
    let maxMoving = 0, maxReduced = 0, maxChair = 0;
    for (let t = 0; t < 2; t += 0.01) {
      eyePosition(sample({ kind: 'bike', speed: 5 }), t, 1, a); maxMoving = Math.max(maxMoving, Math.abs(a.y - 5 - EYE.bike.up));
      eyePosition(sample({ kind: 'bike', speed: 5 }), t, 0, b); maxReduced = Math.max(maxReduced, Math.abs(b.y - 5 - EYE.bike.up));
      eyePosition(sample({ kind: 'chair', speed: 5 }), t, 1, b); maxChair = Math.max(maxChair, Math.abs(b.y - 5 - EYE.chair.up));
    }
    expect(maxMoving).toBeGreaterThan(0.01); expect(maxMoving).toBeLessThanOrEqual(EYE.bike.bob + 1e-9);
    expect(maxReduced).toBeLessThan(1e-9); expect(maxChair).toBeLessThan(1e-9);
  });
  it('look clamps: +-100 deg yaw, +-60 deg pitch', () => {
    const o = { yaw: 0, pitch: 0 };
    expect(clampLook(10, 10, o)).toEqual({ yaw: LOOK_YAW_MAX, pitch: LOOK_PITCH_MAX });
    expect(clampLook(-10, -10, o)).toEqual({ yaw: -LOOK_YAW_MAX, pitch: -LOOK_PITCH_MAX });
    expect((LOOK_YAW_MAX * 180) / Math.PI).toBeCloseTo(100, 6); expect((LOOK_PITCH_MAX * 180) / Math.PI).toBeCloseTo(60, 6);
    const rig = new ViewCameraRig();
    rig.look(99, 99); expect(rig.lookYaw).toBe(LOOK_YAW_MAX); expect(rig.lookPitch).toBe(LOOK_PITCH_MAX);
    rig.look(-999, -999); expect(rig.lookYaw).toBe(-LOOK_YAW_MAX);
    rig.recentre(); expect(rig.lookYaw).toBe(0);
  });
  it('heading -> yaw: the camera looks along the heading (-Z at yaw 0)', () => {
    for (const [hx, hz] of [[0, -1], [1, 0], [0, 1], [-1, 0], [0.6, 0.8]] as const) {
      const rig = new ViewCameraRig();
      rig.update(0.016, sample({ hx, hz, speed: 0 }));
      const f = new THREE.Vector3(0, 0, -1).applyQuaternion(rig.camera.quaternion);
      expect(f.x).toBeCloseTo(hx, 2); expect(f.z).toBeCloseTo(hz, 2);
    }
    expect(yawOfHeading(0, -1)).toBeCloseTo(0, 9);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 6);
  });
  it('critically damped follower converges without overshoot, and angles take the short way', () => {
    const d = new Damped(0);
    let max = 0;
    for (let i = 0; i < 600; i++) { d.step(10, 0.2, 1 / 60); max = Math.max(max, d.value); }
    expect(d.value).toBeCloseTo(10, 3); expect(max).toBeLessThanOrEqual(10 + 1e-6);
    const a = new Damped(3.0);
    for (let i = 0; i < 300; i++) a.stepAngle(-3.0, 0.15, 1 / 60); // +3 -> -3 rad is 0.28 rad the short way
    expect(Math.abs(wrapAngle(a.value - -3.0))).toBeLessThan(0.01);
  });
  it('rig follows a moving guest (lag, then converge) and snaps on teleports', () => {
    const rig = new ViewCameraRig();
    rig.update(0.016, sample({ x: 0, z: 0 }));
    for (let i = 0; i < 20; i++) rig.update(1 / 60, sample({ x: 3, z: 0, speed: 0 }));
    expect(rig.pose.x).toBeGreaterThan(0.5); expect(rig.pose.x).toBeLessThan(3 + 1e-9); // still catching up
    for (let i = 0; i < 300; i++) rig.update(1 / 60, sample({ x: 3, z: 0, speed: 0 }));
    expect(rig.pose.x).toBeCloseTo(3 + EYE.ski.fwd * 0, 1);
    rig.update(1 / 60, sample({ x: 60, z: 50, speed: 0 })); // > 6 tiles away: teleport (lift top / new target)
    expect(rig.pose.x).toBeCloseTo(60, 1);
  });
  it('wheel changes the FOV within [FOV_MIN, FOV_MAX]; default 70; near 0.05; far scales with the map', () => {
    const rig = new ViewCameraRig();
    expect(rig.camera.fov).toBe(RIDE_FOV); expect(RIDE_FOV).toBe(70); expect(rig.camera.near).toBe(0.05);
    rig.addFov(500); for (let i = 0; i < 200; i++) rig.update(1 / 60, sample());
    expect(rig.camera.fov).toBeCloseTo(FOV_MAX, 1);
    rig.addFov(-500); for (let i = 0; i < 200; i++) rig.update(1 / 60, sample());
    expect(rig.camera.fov).toBeCloseTo(FOV_MIN, 1);
    expect(rideFar(512)).toBeGreaterThan(rideFar(128));
  });
  it('smooth return recentres the user look after the idle delay', () => {
    const rig = new ViewCameraRig(); rig.smoothReturn = true;
    rig.update(0.016, sample()); rig.look(1, 0.5);
    for (let i = 0; i < 60 * 6; i++) rig.update(1 / 60, sample());
    expect(Math.abs(rig.lookYaw)).toBeLessThan(0.01);
  });
});

describe('camera-agnostic helpers (iso unchanged)', () => {
  it('lodHeightFor(ortho) equals top - bottom for every zoom; perspective = constant near height', () => {
    const dom = document.createElement('div');
    const c = new CameraController(dom, 128);
    for (const z of [1.25, 1.5, 2, 3.7, 8, 16]) {
      c.zoom = 1; c.zoomBy(z);
      const old = c.camera.top - c.camera.bottom;
      expect(lodHeightFor(c.camera)).toBe(old);
      expect(terrainLodHeightFor(c.camera, 128)).toBe(old);
    }
    const p = new THREE.PerspectiveCamera(70, 1.6, 0.05, 200);
    expect(lodHeightFor(p)).toBe(PERSPECTIVE_LOD_HEIGHT);
    expect(terrainLodHeightFor(p, 128)).toBe(PERSPECTIVE_LOD_HEIGHT);
    expect(terrainLodHeightFor(p, 256)).toBeGreaterThan(100); // macro far LOD + protected near chunks
    c.dispose();
  });
  it('projectToScreen: ortho scale is the legacy rect.height / viewHeight / 18; behind a perspective camera = null', () => {
    const dom = document.createElement('div');
    const c = new CameraController(dom, 128); c.update(0); c.camera.updateMatrixWorld(true);
    const rect = { left: 0, top: 0, width: 1000, height: 500 };
    const r = projectToScreen(c.camera, c.target.x, c.target.y, c.target.z, rect)!;
    expect(r.x).toBeCloseTo(500, 3); expect(r.y).toBeCloseTo(250, 3);
    expect(r.scale).toBeCloseTo(500 / (c.camera.top - c.camera.bottom) / 18, 9);
    const p = new THREE.PerspectiveCamera(70, 2, 0.05, 200); p.position.set(0, 0, 0); p.lookAt(0, 0, -1); p.updateMatrixWorld(true);
    expect(projectToScreen(p, 0, 0, 5, rect)).toBeNull();
    expect(projectToScreen(p, 0, 0, -5, rect)).not.toBeNull();
    c.dispose();
  });
  it('horizon fraction: 0.5 level, lower on screen when looking up', () => {
    expect(horizonFraction(0, 70)).toBeCloseTo(0.5, 9);
    expect(horizonFraction(0.3, 70)).toBeGreaterThan(0.5);
    expect(horizonFraction(-0.3, 70)).toBeLessThan(0.5);
  });
});

describe('iso pose is restored exactly after a ground-level view', () => {
  it('freeze/thaw: target, yaw, zoom and the camera pose are bit-identical; iso input is ignored meanwhile', () => {
    const dom = document.createElement('div');
    const c = new CameraController(dom, 128);
    c.target.set(40.25, 3.5, 77.125); c.yaw = 1.2345; c.zoomBy(2.7); c.update(0.016);
    const before = { t: c.target.toArray(), yaw: c.yaw, zoom: c.zoom, pos: c.camera.position.toArray(), q: c.camera.quaternion.toArray(), proj: c.camera.projectionMatrix.toArray(), top: c.camera.top };
    c.rotateSnap(1); // a rotate tween in flight when entering
    const pose = c.freeze();
    // everything the player could do while riding: keys, wheel, drag
    for (const k of ['q', 'e', 'w', 'a', 's', 'd', 'ArrowUp']) window.dispatchEvent(new KeyboardEvent('keydown', { key: k }));
    dom.dispatchEvent(new WheelEvent('wheel', { deltaY: -500 }));
    c.update(0.5); c.update(0.5); c.focusOn(3, 3, { duration: 0.1 });
    expect(c.active).toBe(false);
    c.thaw(pose);
    expect(c.target.toArray()).toEqual(before.t); expect(c.yaw).toBe(before.yaw); expect(c.zoom).toBe(before.zoom);
    expect(c.camera.top).toBe(before.top);
    expect(c.camera.position.toArray()).toEqual(before.pos);
    expect(c.camera.quaternion.toArray()).toEqual(before.q);
    expect(c.camera.projectionMatrix.toArray()).toEqual(before.proj);
    c.update(1); expect(c.target.toArray()).toEqual(before.t); // no stale tween resumes
    c.dispose();
  });
  it('picking maths intact in iso after exit: the same screen ray hits the same tile', () => {
    const grid = new Grid(64); generateTerrain(grid, 5);
    const dom = document.createElement('div');
    const c = new CameraController(dom, 64);
    c.target.set(32, 0, 32); c.update(0.016);
    const pick = (): ReturnType<typeof pickHeightfield> => {
      c.camera.updateMatrixWorld(true); const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(0.2, -0.1), c.camera);
      return pickHeightfield(grid, ray.ray.origin, ray.ray.direction);
    };
    const a = pick();
    const pose = c.freeze(); c.update(0.1); c.thaw(pose);
    const b = pick();
    expect(a).not.toBeNull(); expect(b).toEqual(a);
    c.dispose();
  });
});

describe('fog: density 0 in iso, shared by every custom shader', () => {
  it('ViewFog installs a FogExp2 at density 0 (iso look unchanged); sizes with the map', () => {
    const scene = new THREE.Scene();
    const f = new ViewFog(scene);
    expect(scene.fog).toBeInstanceOf(THREE.FogExp2);
    expect(f.density).toBe(0); expect((scene.fog as THREE.FogExp2).density).toBe(0); expect(fogUniforms.uFogDensity.value).toBe(0);
    f.setDensity(fogDensityFor(fogRangeFor(128))); expect(fogUniforms.uFogDensity.value).toBeGreaterThan(0.005);
    expect((scene.fog as THREE.FogExp2).density).toBe(fogUniforms.uFogDensity.value);
    // 95 % at the range: 1 - exp(-(d * range)^2)
    const r = fogRangeFor(128); expect(1 - Math.exp(-Math.pow(fogDensityFor(r) * r, 2))).toBeCloseTo(0.95, 6);
    f.setDensity(0); expect(fogUniforms.uFogDensity.value).toBe(0);
    f.setColor([1, 0, 0]); expect(fogUniforms.uFogColor.value.r).toBeCloseTo(1, 6); expect((scene.fog as THREE.FogExp2).color.r).toBeCloseTo(1, 6);
  });
  it('terrain and the prop shaders (tree mesh + billboard) all carry the fog uniforms and the fog GLSL', () => {
    const grid = new Grid(64); generateTerrain(grid, 5);
    const t = new TerrainMesh(grid);
    expect(t.material.fragmentShader).toContain('uFogDensity'); expect(t.material.vertexShader).toContain('vFogDist');
    expect(t.material.uniforms.uFogDensity).toBe(fogUniforms.uFogDensity); // the SAME object: one place switches every shader
    const trees = new TreeLayer(new PropStore(grid));
    const mats = new Set<THREE.ShaderMaterial>();
    for (const l of trees.layers) for (const lv of (l as unknown as { levels: Array<{ spec: { material: THREE.ShaderMaterial } }> }).levels) mats.add(lv.spec.material);
    expect(mats.size).toBeGreaterThanOrEqual(5);
    for (const m of mats) {
      expect(m.fragmentShader).toContain('uFogDensity'); expect(m.vertexShader).toContain('vFogDist');
      expect(m.uniforms.uFogDensity).toBe(fogUniforms.uFogDensity);
      expect((m.uniforms.uLodRange!.value as THREE.Vector2).toArray()).toEqual([0, 1e9]); // iso: no distance banding
    }
  });
  it('the sky gradient horizon stop follows the camera (iso keeps 70 %) and the fog tint is the horizon colour', () => {
    const g = skyGradient(lightingAt(12));
    expect(skyCss(g)).toContain('70%'); expect(skyCss(g, 0.5)).toContain('50%');
    expect(skyCss(g, 0.5)).toBe(skyCss(g, 0.5));
  });
});

describe('perspective LOD: distance bands (ride) vs single level (iso)', () => {
  const grid = new Grid(64);
  const info = generateTerrain(grid, 3);
  const props = generateProps(grid, info.forestDensity, 3);
  const bands = (t: TreeLayer): number[][] => (t.layers[0] as unknown as { levels: Array<{ spec: { material: THREE.ShaderMaterial } }> }).levels.map((l) => (l.spec.material.uniforms.uLodRange!.value as THREE.Vector2).toArray());
  it('a perspective camera switches the layers to full / low-poly / billboard distance bands; going back to iso restores 0..1e9 and the old single level', () => {
    const trees = new TreeLayer(props);
    const ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 500); ortho.position.set(60, 60, 60); ortho.lookAt(32, 0, 32); ortho.updateMatrixWorld(true);
    trees.update(ortho, 20);
    expect(bands(trees)).toEqual([[0, 1e9], [0, 1e9], [0, 1e9], [0, 1e9], [0, 1e9], [0, 1e9]]);
    const l0 = trees.layers[0]!;
    expect(l0.activeLevel).toBe(0); // iso at view height 20: full meshes, like before
    const p = new THREE.PerspectiveCamera(70, 1.6, 0.05, 200); p.position.set(32, 5, 32); p.lookAt(40, 4, 32); p.updateMatrixWorld(true);
    for (let i = 0; i < 40; i++) trees.update(p, lodHeightFor(p));
    const b = bands(trees);
    expect(b[2]).toEqual([TREE_RIDE_LOW_DIST - TREE_FADE_W, 1e9]); expect(b[3]).toEqual([0, TREE_RIDE_NEAR_DIST + TREE_FADE_W]); expect(b[4]).toEqual([TREE_RIDE_NEAR_DIST - TREE_FADE_W, TREE_RIDE_FULL_DIST + TREE_FADE_W]); expect(b[5]).toEqual([TREE_RIDE_FULL_DIST - TREE_FADE_W, TREE_RIDE_LOW_DIST + TREE_FADE_W]);
    expect(trees.countDraws(p, lodHeightFor(p))).toBeGreaterThan(0);
    expect(trees.countDraws(p, lodHeightFor(p))).toBeLessThan(80); // draw-call budget: <= 9 species x 3 levels x a few cells
    trees.update(ortho, 20);
    expect(bands(trees)).toEqual([[0, 1e9], [0, 1e9], [0, 1e9], [0, 1e9], [0, 1e9], [0, 1e9]]);
    expect(l0.activeLevel).toBe(0);
  });
});

describe('GuestRenderer in ride views', () => {
  const mk = (): { st: GuestStore; r: GuestRenderer } => {
    const st = new GuestStore(100);
    for (let i = 0; i < 20; i++) st.add({ x: 30 + i, y: 32, z: 0, type: 0, skill: 0, budget: 1, group: 0, mode: 0, overnight: false, leaveDay: 1, tick: 0 });
    return { st, r: new GuestRenderer(st) };
  };
  const persp = (): THREE.PerspectiveCamera => { const p = new THREE.PerspectiveCamera(70, 1.6, 0.05, 300); p.position.set(28, 1, 32); p.lookAt(60, 1, 32); p.updateMatrixWorld(true); return p; };
  it('never uses the far impostor points in perspective, hides the followed guest, culls behind the camera', () => {
    const { r } = mk();
    r.update(1, lodHeightFor(persp()), persp(), 1);
    expect(r.far).toBe(false);
    const all = r.drawnCount;
    expect(all).toBeGreaterThan(10);
    r.hideSlot = 5;
    r.update(1, lodHeightFor(persp()), persp(), 1); // same tick: hideSlot is part of the change detection
    expect(r.drawnCount).toBe(all - 1);
    const p = persp(); p.lookAt(0, 1, 32); p.updateMatrixWorld(true); // looking away from everyone
    r.update(1, lodHeightFor(p), p, 2);
    expect(r.drawnCount).toBeLessThan(all - 1);
  });
  it('an orthographic far view still switches to impostors (iso unchanged)', () => {
    const { r } = mk();
    r.update(1, 80);
    expect(r.far).toBe(true);
  });
});
