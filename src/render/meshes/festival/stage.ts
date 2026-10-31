import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { col } from '../../VillageDecor';
import { buntingGeometry, poleGeometry } from './parts';

/**
 * Mountain concert set (Task 41, docs/festivals.md): a stage with a truss, speaker stacks, a crowd barrier and a crowd, plus a separate ADDITIVE light mesh
 * (translucent light cones, lamp and heater glows; no point lights). Everything is vertex-coloured geometry in WORLD coordinates so the whole concert is
 * 2 draw calls (solid + lights); the solid part merges into the festival's shared solid mesh.
 *
 * Local frame of a stage: origin at the centre of the stage floor, +z is the front (the crowd side), +x the stage's right; the stage floor spans
 * x -2..2, z -1..1, the crowd area z 1..4.
 */
export type StageEdition = 'summer' | 'winter';
const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
const box = (w: number, h: number, d: number, hex: number, x: number, y: number, z: number): THREE.BufferGeometry => col(new THREE.BoxGeometry(w, h, d), hex, x, y, z);

export const STAGE_H = { floor: 0.16, truss: 1.4, roof: 1.5 } as const;
const TRUSS = 0x3a3a42, DARK = 0x1f1f24, WOOD = 0x6b4a2a;

/** Place local geometry into the world (position + yaw). */
function placeLocal(parts: THREE.BufferGeometry[], x: number, y: number, z: number, ry: number): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false)!;
  g.applyMatrix4(new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), ry), V(1, 1, 1)));
  return g;
}

/** The stage itself: floor with a skirt, back wall, truss frame, light cans, speaker stacks, front barrier; summer: bunting + flags; winter: snow on the roof, warm lamp bulbs, heater posts. */
export function stageGeometry(x: number, y: number, z: number, ry: number, edition: StageEdition, palette: readonly number[]): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // floor + skirt (reaches below the floor so a slightly sloped site shows no gap)
  parts.push(box(4.0, 0.46, 2.0, WOOD, 0, STAGE_H.floor / 2 - 0.15, 0), box(4.04, 0.03, 2.04, 0x8b5a2b, 0, STAGE_H.floor + 0.005, 0));
  // back wall (dark backdrop) and a drum riser
  parts.push(box(3.9, 1.05, 0.06, edition === 'summer' ? 0x3a3550 : 0x34404f, 0, STAGE_H.floor + 0.52, -0.92), box(0.7, 0.1, 0.6, 0x4a3320, 0.7, STAGE_H.floor + 0.06, -0.4));
  // truss: four posts, a back beam, a front beam, two side beams
  for (const sx of [-1.9, 1.9]) for (const sz of [-0.92, 0.92]) parts.push(box(0.07, STAGE_H.truss, 0.07, TRUSS, sx, STAGE_H.floor + STAGE_H.truss / 2, sz));
  const top = STAGE_H.floor + STAGE_H.truss;
  parts.push(box(3.95, 0.07, 0.07, TRUSS, 0, top, -0.92), box(3.95, 0.07, 0.07, TRUSS, 0, top, 0.92), box(0.07, 0.07, 1.85, TRUSS, -1.9, top, 0), box(0.07, 0.07, 1.85, TRUSS, 1.9, top, 0));
  // truss cross-bracing on the front beam: small diagonal-looking blocks every 0.25
  for (let i = 0; i < 15; i++) parts.push(box(0.04, 0.05, 0.04, 0x55555e, -1.75 + i * 0.25, top - 0.06, 0.92));
  // light cans under the front beam
  for (let i = 0; i < 6; i++) parts.push(box(0.1, 0.1, 0.12, 0xdadada, -1.5 + i * 0.6, top - 0.1, 0.9));
  // speaker stacks on both sides, a monitor wedge at the front edge
  for (const sx of [-2.2, 2.2]) {
    parts.push(box(0.34, 0.5, 0.34, DARK, sx, STAGE_H.floor + 0.25 - 0.15, 0.1), box(0.3, 0.42, 0.3, DARK, sx, STAGE_H.floor + 0.7 - 0.15, 0.1));
    parts.push(box(0.2, 0.2, 0.02, 0x55555e, sx, 0.12, 0.28), box(0.14, 0.14, 0.02, 0x55555e, sx, 0.55, 0.26));
  }
  parts.push(box(0.5, 0.12, 0.28, DARK, -0.6, STAGE_H.floor + 0.06, 0.82));
  // front barrier (crowd area): a low rail on posts, 4 wide, at local z 1.15
  for (let i = 0; i < 5; i++) parts.push(box(0.04, 0.2, 0.04, 0xb9b4a8, -2 + i, 0.1 - 0.0, 1.15));
  parts.push(box(4.0, 0.03, 0.03, 0xd9d4c8, 0, 0.2, 1.15));
  if (edition === 'summer') {
    // open-air rig: bunting from the front truss corners to two flag poles, pennants along the front beam
    const tops = [V(-1.9, top, 0.92), V(1.9, top, 0.92)];
    for (const sx of [-2.35, 2.35]) parts.push(...poleGeometry(sx, 0, 1.3, palette[(sx > 0 ? 1 : 0) % palette.length]!, sx > 0 ? -1 : 1, 0));
    parts.push(...buntingGeometry(tops[0]!.x, tops[0]!.y, tops[0]!.z, tops[1]!.x, tops[1]!.y, tops[1]!.z, palette, 0));
    parts.push(...buntingGeometry(-1.9, top, 0.92, -2.35, 0.8, 1.3, palette, 3), ...buntingGeometry(1.9, top, 0.92, 2.35, 0.8, 1.3, palette, 7));
  } else {
    // winter: a snow-covered roof, snow caps on the speakers, warm lamp bulbs along the front beam and heater posts beside the crowd
    parts.push(box(4.05, 0.05, 2.05, 0x3b3b44, 0, STAGE_H.roof, 0), box(4.1, 0.1, 2.1, 0xf4f7fb, 0, STAGE_H.roof + 0.075, 0), box(3.9, 0.06, 1.9, 0xeaf0f7, 0, STAGE_H.roof + 0.16, 0));
    for (const sx of [-2.2, 2.2]) parts.push(box(0.32, 0.05, 0.32, 0xf4f7fb, sx, STAGE_H.floor + 0.925 - 0.15 + 0.02, 0.1));
    parts.push(box(4.0, 0.06, 0.12, 0xf4f7fb, 0, STAGE_H.floor - 0.1, 1.04)); // snow banked against the front
    for (let i = 0; i < 9; i++) parts.push(box(0.05, 0.05, 0.05, 0xffd98a, -1.8 + i * 0.45, top - 0.03, 0.96));
    for (const sx of [-2.3, 2.3]) parts.push(col(new THREE.CylinderGeometry(0.025, 0.035, 0.9, 6), 0x55555e, sx, 0.45, 2.3), box(0.2, 0.05, 0.2, 0x3a3a42, sx, 0.92, 2.3), col(new THREE.CylinderGeometry(0.1, 0.03, 0.12, 8), 0x7a4a2a, sx, 0.88, 2.3));
  }
  return placeLocal(parts, x, y, z, ry);
}

/** One crowd member: a small body and head (world position). */
export function crowdGeometry(people: ReadonlyArray<{ x: number; z: number; c: number }>, ground: (x: number, z: number) => number, palette: readonly number[], edition: StageEdition): THREE.BufferGeometry | null {
  if (!people.length) return null;
  const parts: THREE.BufferGeometry[] = [];
  const winterCols = [0xc0392b, 0x2f6fa8, 0xf2c14e, 0x3a8a5a, 0x8e5bd0];
  people.forEach((p, i) => {
    const y = ground(p.x, p.z), c = edition === 'winter' ? winterCols[p.c % winterCols.length]! : palette[p.c % palette.length]!;
    parts.push(box(0.075, 0.15, 0.075, c, p.x, y + 0.075, p.z), box(0.06, 0.06, 0.06, i % 3 === 0 ? 0xe8c8a0 : i % 3 === 1 ? 0xc89868 : 0xf0d4b4, p.x, y + 0.18, p.z));
    if (edition === 'winter') parts.push(box(0.07, 0.025, 0.07, i % 2 ? 0xf4efe2 : 0x2a2a30, p.x, y + 0.225, p.z)); // beanies
  });
  return mergeGeometries(parts, false);
}

export interface LightMeshOpts { x: number; y: number; z: number; ry: number; edition: StageEdition }
/**
 * Additive light geometry: translucent cones (apex at the light cans, fanning out over the crowd; colour fades with distance), plus warm glows for the
 * lamp bulbs and the heaters (winter). Attributes `aBase` (the pivot), `aAxis` (sway axis, world), `aPhase`, `aSway` (0 = fixed) drive the vertex shader sway.
 */
export function concertLightsGeometry(o: LightMeshOpts): THREE.BufferGeometry {
  const pos: number[] = [], colr: number[] = [], base: number[] = [], axis: number[] = [], phase: number[] = [], sway: number[] = [];
  const c = Math.cos(o.ry), s = Math.sin(o.ry);
  const W = (u: number, h: number, v: number): THREE.Vector3 => V(o.x + u * c + v * s, o.y + h, o.z - u * s + v * c);
  const dirW = (u: number, v: number): THREE.Vector3 => V(u * c + v * s, 0, -u * s + v * c);
  const uAxis = dirW(1, 0).normalize(), vAxis = dirW(0, 1).normalize();
  const hues = o.edition === 'summer' ? [0xf06292, 0x4fc3f7, 0xaed581, 0xba68c8, 0xf2c14e, 0x4fc3f7] : [0xffd98a, 0xfff0c8, 0x9fc8ff, 0xffd98a, 0xfff0c8, 0x9fc8ff];
  const push = (p: THREE.Vector3, k: THREE.Color, f: number, b: THREE.Vector3, ax: THREE.Vector3, ph: number, sw: number): void => {
    pos.push(p.x, p.y, p.z); colr.push(k.r * f, k.g * f, k.b * f); base.push(b.x, b.y, b.z); axis.push(ax.x, ax.y, ax.z); phase.push(ph); sway.push(sw);
  };
  const SEG = 8, top = STAGE_H.floor + STAGE_H.truss - 0.1;
  for (let i = 0; i < 6; i++) {
    const u = -1.5 + i * 0.6, apex = W(u, top, 0.9), k = new THREE.Color(hues[i]!);
    // aim: forward and down onto the crowd, fanned out by index
    const aimU = (i - 2.5) * 0.55, tip = W(u + aimU, 0.1, 3.0 + (i % 2) * 0.5);
    const dir = tip.clone().sub(apex), len = dir.length();
    dir.normalize();
    const side = new THREE.Vector3().crossVectors(dir, V(0, 1, 0)).normalize(), up = new THREE.Vector3().crossVectors(side, dir).normalize();
    const R = 0.38 + (i % 3) * 0.04;
    const ring = (t: number): THREE.Vector3 => V(0, 0, 0).addScaledVector(side, Math.cos(t) * R).addScaledVector(up, Math.sin(t) * R).add(apex).addScaledVector(dir, len);
    const ax = i % 2 ? uAxis : vAxis, ph = i * 1.7;
    for (let sI = 0; sI < SEG; sI++) {
      const a0 = (sI / SEG) * Math.PI * 2, a1 = ((sI + 1) / SEG) * Math.PI * 2, r0 = ring(a0), r1 = ring(a1);
      push(apex, k, 1.0, apex, ax, ph, 1); push(r0, k, 0.12, apex, ax, ph, 1); push(r1, k, 0.12, apex, ax, ph, 1);
    }
  }
  const glow = (p: THREE.Vector3, r: number, hex: number, f: number): void => {
    const k = new THREE.Color(hex), pts = [V(r, 0, 0), V(-r, 0, 0), V(0, r, 0), V(0, -r, 0), V(0, 0, r), V(0, 0, -r)];
    for (const [a, b, d] of [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]] as const) for (const q of [a, b, d]) push(p.clone().add(pts[q]!), k, f, p, V(0, 1, 0), 0, 0);
  };
  if (o.edition === 'winter') {
    for (let i = 0; i < 9; i++) glow(W(-1.8 + i * 0.45, STAGE_H.floor + STAGE_H.truss - 0.03, 0.96), 0.07, 0xffc060, 1.0);
    for (const sx of [-2.3, 2.3]) { glow(W(sx, 0.98, 2.3), 0.14, 0xff8a3a, 1.0); glow(W(sx, 0.7, 2.3), 0.3, 0xff7a2a, 0.35); }
  } else {
    for (let i = 0; i < 6; i++) glow(W(-1.5 + i * 0.6, top, 0.9), 0.07, hues[i]!, 1.0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colr), 3));
  g.setAttribute('aBase', new THREE.BufferAttribute(new Float32Array(base), 3));
  g.setAttribute('aAxis', new THREE.BufferAttribute(new Float32Array(axis), 3));
  g.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(phase), 1));
  g.setAttribute('aSway', new THREE.BufferAttribute(new Float32Array(sway), 1));
  return g;
}

export interface LightUniforms { uTime: { value: number }; uMotion: { value: number } }
/** Additive, depth-write-free material whose vertex shader sways each cone about its apex (uMotion 0 = static: reduced motion). */
export function makeLightMaterial(): { material: THREE.MeshBasicMaterial; uniforms: LightUniforms } {
  const uniforms: LightUniforms = { uTime: { value: 0 }, uMotion: { value: 1 } };
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  material.name = 'concertLights';
  material.onBeforeCompile = (sh): void => {
    sh.uniforms.uTime = uniforms.uTime; sh.uniforms.uMotion = uniforms.uMotion;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aBase; attribute vec3 aAxis; attribute float aPhase; attribute float aSway; uniform float uTime; uniform float uMotion;')
      .replace('#include <begin_vertex>', `vec3 transformed = vec3(position);
      { float ang = sin(uTime * 0.55 + aPhase) * 0.3 * uMotion * aSway; vec3 rel = position - aBase; vec3 k = aAxis;
        rel = rel * cos(ang) + cross(k, rel) * sin(ang) + k * dot(k, rel) * (1.0 - cos(ang)); transformed = aBase + rel; }`);
  };
  return { material, uniforms };
}
