import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GAIT, idlePose, swingOf, walkPose, wavePose, type GaitPose } from './visitorGait';

/**
 * Rare high-country visitor, three model variants (`VISITOR.model`, `?visitorModel=`): 'plush' (plump storybook), 'shaggy' (tall, lean, scruffy),
 * 'bigfoot' (broad-shouldered, grey-white, apelike). Each is ONE vertex-coloured geometry per pose (<= ~900 triangles): lofted pear body, ellipsoid
 * head / face / hands / feet, cone fur tufts. Forward = +z, ~1 tile tall. Poses (walk frames, idle looks, wave frames) are built from the pure gait
 * (`visitorGait.ts`) and swapped on the same mesh: no extra draw calls.
 */
export type ModelId = 'plush' | 'shaggy' | 'bigfoot';
export const MODEL_IDS: readonly ModelId[] = ['plush', 'shaggy', 'bigfoot'];

interface Spec {
  fur: number; furShade: number; belly: number | null; face: number; muzzle: number; hand: number; foot: number; dark: number;
  /** Body loft: y0 / y1, half widths at the bottom / top, depth ratio, how far the widest point leans to the bottom (0..1), hunch (rad forward). */
  body: { y0: number; y1: number; wBot: number; wTop: number; depth: number; round: number; hunch: number };
  head: { y: number; rx: number; ry: number; rz: number; z: number; face: number; eye: number; eyeX: number; brow: number; ears: number; fringe: number };
  legs: { x: number; len: number; r0: number; r1: number; footW: number; footL: number; footH: number; toes: number };
  arms: { x: number; y: number; len: number; r0: number; r1: number; hand: number; splay: number; fingers: number };
  fur_: { hem: number; hemLen: number; hemR: number; hemY: number; top: number; topLen: number; shag: number; shagLen: number; arm: number; armLen: number };
}

const MODELS: Record<ModelId, Spec> = {
  // faithful to the reference: big pear-shaped body in long fluffy white-blue fur, pale belly, round grey-brown face with a darker muzzle, tufts on the head, long thick arms, big hands, short thick legs, big flat feet
  plush: {
    fur: 0xf6f9fd, furShade: 0xbcd3ec, belly: 0xffffff, face: 0x9a8b7f, muzzle: 0x6a5b52, hand: 0x8e7f73, foot: 0x8e7f73, dark: 0x1c1b22,
    body: { y0: 0.15, y1: 0.8, wBot: 0.33, wTop: 0.17, depth: 0.9, round: 1.2, hunch: 0 },
    head: { y: 0.92, rx: 0.215, ry: 0.185, rz: 0.195, z: 0.03, face: 1, eye: 0.034, eyeX: 0.062, brow: 0, ears: 0.05, fringe: 0 },
    legs: { x: 0.125, len: 0.2, r0: 0.105, r1: 0.1, footW: 0.11, footL: 0.16, footH: 0.05, toes: 3 },
    arms: { x: 0.29, y: 0.7, len: 0.4, r0: 0.1, r1: 0.088, hand: 0.1, splay: 0.1, fingers: 3 },
    fur_: { hem: 8, hemLen: 0.085, hemR: 0.3, hemY: 0.22, top: 4, topLen: 0.12, shag: 0, shagLen: 0.12, arm: 2, armLen: 0.08 },
  },
  // taller, leaner, long scruffy fur and a fringe over a small face; a little wilder
  shaggy: {
    fur: 0xe4edf6, furShade: 0x9db4cc, belly: 0xf6fafd, face: 0x8b7d74, muzzle: 0x5e5049, hand: 0x7f7167, foot: 0x7f7167, dark: 0x1c1b22,
    body: { y0: 0.3, y1: 0.98, wBot: 0.22, wTop: 0.16, depth: 0.85, round: 1.1, hunch: 0.1 },
    head: { y: 1.08, rx: 0.14, ry: 0.135, rz: 0.13, z: 0.05, face: 0.85, eye: 0.026, eyeX: 0.045, brow: 0, ears: 0.032, fringe: 1 },
    legs: { x: 0.095, len: 0.31, r0: 0.07, r1: 0.062, footW: 0.075, footL: 0.15, footH: 0.04, toes: 3 },
    arms: { x: 0.2, y: 0.9, len: 0.62, r0: 0.07, r1: 0.055, hand: 0.07, splay: 0.12, fingers: 3 },
    fur_: { hem: 9, hemLen: 0.27, hemR: 0.22, hemY: 0.38, top: 3, topLen: 0.26, shag: 5, shagLen: 0.2, arm: 2, armLen: 0.16 },
  },
  // broad shoulders, grey-white fur, heavier brow and a hunch; apelike but still friendly
  bigfoot: {
    fur: 0xd7dde2, furShade: 0x96a0aa, belly: 0xe9edf0, face: 0x77695f, muzzle: 0x554840, hand: 0x6c5f56, foot: 0x6c5f56, dark: 0x1c1b22,
    body: { y0: 0.22, y1: 0.92, wBot: 0.22, wTop: 0.31, depth: 0.78, round: 0.7, hunch: 0.3 },
    head: { y: 0.96, rx: 0.15, ry: 0.14, rz: 0.15, z: 0.14, face: 0.95, eye: 0.028, eyeX: 0.05, brow: 1, ears: 0.03, fringe: 0 },
    legs: { x: 0.13, len: 0.24, r0: 0.105, r1: 0.09, footW: 0.1, footL: 0.17, footH: 0.045, toes: 3 },
    arms: { x: 0.34, y: 0.82, len: 0.5, r0: 0.1, r1: 0.075, hand: 0.09, splay: 0.12, fingers: 3 },
    fur_: { hem: 8, hemLen: 0.09, hemR: 0.23, hemY: 0.26, top: 3, topLen: 0.07, shag: 3, shagLen: 0.1, arm: 2, armLen: 0.09 },
  },
};
export const modelSpec = (m: ModelId): Spec => MODELS[m];
export const legLenOf = (m: ModelId): number => MODELS[m].legs.len;

// ---- geometry helpers ------------------------------------------------------------------------------------------------------------
type ColorFn = number | ((p: THREE.Vector3, n: THREE.Vector3) => THREE.Color);
const _c = new THREE.Color();
const paint = (g: THREE.BufferGeometry, color: ColorFn): THREE.BufferGeometry => {
  g.deleteAttribute('uv');
  const p = g.getAttribute('position'), n = g.getAttribute('normal'), arr = new Float32Array(p.count * 3), v = new THREE.Vector3(), nn = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    if (typeof color === 'number') _c.set(color); else { v.fromBufferAttribute(p, i); nn.fromBufferAttribute(n, i); _c.copy(color(v, nn)); }
    arr[i * 3] = _c.r; arr[i * 3 + 1] = _c.g; arr[i * 3 + 2] = _c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
};
/** Ellipsoid with analytic smooth normals. */
const ell = (rx: number, ry: number, rz: number, color: ColorFn, x: number, y: number, z: number, ws = 8, hs = 6, rot?: [number, number, number]): THREE.BufferGeometry => {
  const g = new THREE.SphereGeometry(1, ws, hs), p = g.getAttribute('position'), n = g.getAttribute('normal'), v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.set(p.getX(i) / rx, p.getY(i) / ry, p.getZ(i) / rz).normalize(); n.setXYZ(i, v.x, v.y, v.z); p.setXYZ(i, p.getX(i) * rx, p.getY(i) * ry, p.getZ(i) * rz); }
  if (rot) { const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'YXZ')); g.applyMatrix4(m); }
  g.translate(x, y, z);
  return paint(g, color);
};
/** Tapered limb from a to b with smooth normals (open ends hidden inside the body / hand). */
const limb = (a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, color: ColorFn, seg = 7): THREE.BufferGeometry => {
  const len = a.distanceTo(b), g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, true);
  const up = new THREE.Vector3(0, 1, 0), d = new THREE.Vector3().subVectors(b, a).normalize();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, d)); g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return paint(g, color);
};
/** A fur tuft: a squashed cone from `base` towards `dir` (unit), `len` long. */
const tuft = (base: THREE.Vector3, dir: THREE.Vector3, len: number, r: number, color: ColorFn): THREE.BufferGeometry => {
  const g = new THREE.ConeGeometry(r * 1.5, len, 5, 1, true);
  g.translate(0, len / 2, 0).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)).translate(base.x, base.y, base.z);
  return paint(g, color);
};
const V3 = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** The lofted pear body: rings along y, superellipse sections (wider than deep), blunt rounded ends. */
function bodyLoft(S: Spec, color: ColorFn): THREE.BufferGeometry {
  const b = S.body, M = 6, N = 10, pos: number[] = [], idx: number[] = [];
  for (let j = 0; j <= M; j++) {
    const t = -Math.PI / 2 + (Math.PI * j) / M, v = (1 + Math.sin(t)) / 2, y = b.y0 + v * (b.y1 - b.y0);
    const base = b.wTop + (b.wBot - b.wTop) * Math.pow(1 - v, b.round), rr = base * Math.pow(Math.max(0, Math.cos(t)), 0.5);
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), e = 2 / 2.4;
      pos.push(rr * Math.sign(c) * Math.pow(Math.abs(c), e), y, rr * b.depth * Math.sign(s) * Math.pow(Math.abs(s), e) + (v > 0.5 ? 0.02 : -0.01));
    }
  }
  for (let j = 0; j < M; j++) for (let i = 0; i < N; i++) { const a = j * N + i, bb = j * N + ((i + 1) % N), c = (j + 1) * N + i, d = (j + 1) * N + ((i + 1) % N); idx.push(a, c, bb, bb, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return paint(g, color);
}

export interface PoseParams extends GaitPose {
  /** Head turn (rad) on top of the gait's counter-turn, nod (rad). */
  look: number; nod: number;
  /** Wave arm (the +x ... the -x side): raise 0..1 and wiggle (rad). */
  raise: number; wiggle: number;
  /** Breathing: chest / shoulder scale offset (about +-0.02). */
  breathe: number;
}
export const neutral = (): PoseParams => ({ ...idlePose(), look: 0, nod: 0, raise: 0, wiggle: 0, breathe: 0 });

/** One pose of one model as a single merged geometry. */
export function buildPose(model: ModelId, P: PoseParams): THREE.BufferGeometry {
  const S = MODELS[model], parts: THREE.BufferGeometry[] = [], L = S.legs, A = S.arms, B = S.body, H = S.head, F = S.fur_;
  const furCol = (base: number, shade: number): ColorFn => (_p, n) => _c.set(base).lerp(new THREE.Color(shade), Math.min(0.75, Math.max(0, 0.32 * (-n.y * 0.5 + 0.5) + (n.z < -0.3 ? 0.18 : 0))));
  const fur = furCol(S.fur, S.furShade);
  const yOff = P.bob;
  // ---- legs (swing about the hips, feet planted: the hips drop as the legs spread) ----
  const hipY = L.len + L.footH + yOff;
  const legEnds: Array<[number, number, number]> = [];
  for (const sx of [1, -1] as const) {
    const th = sx === 1 ? P.legL : P.legR, lift = sx === 1 ? P.liftL : P.liftR;
    const hip = V3(sx * L.x, hipY, -0.01), ankleY = hipY - L.len * Math.cos(th) + lift, ankleZ = hip.z + L.len * Math.sin(th);
    parts.push(limb(hip, V3(sx * L.x, ankleY + L.footH * 0.4, ankleZ), L.r0, L.r1, fur, 6));
    const pitch = -th * 0.6 - (lift > 0 ? 0.25 : 0);
    parts.push(ell(L.footW, L.footH, L.footL, S.foot, sx * L.x, ankleY, ankleZ + L.footL * 0.45, 5, 4, [pitch, 0, 0]));
    for (let k = 0; k < L.toes; k++) { // toes: rounded lobes along the front of the foot
      const f = L.toes === 1 ? 0 : k / (L.toes - 1) - 0.5, tx = sx * L.x + f * L.footW * 1.45;
      parts.push(ell(L.footW * 0.3, L.footH * 0.8, L.footL * 0.22, S.foot, tx, ankleY + 0.004 - pitch * 0.05, ankleZ + L.footL * 0.45 + L.footL * 0.82 - Math.abs(f) * 0.03, 4, 2, [pitch, 0, 0]));
    }
    legEnds.push([sx * L.x, ankleY, ankleZ]);
  }
  // ---- upper body: one group, hunched about the hips, rolled by the sway ----
  const up: THREE.BufferGeometry[] = [];
  const breath = 1 + P.breathe;
  const bl = bodyLoft(S, fur); up.push(bl);
  const bh = B.y1 - B.y0;
  if (S.belly) up.push(ell(B.wBot * 0.58 * (model === 'bigfoot' ? 0.9 : 1), bh * 0.3, 0.09 * breath, (_p, n) => _c.set(S.belly!).lerp(new THREE.Color(S.fur), n.y < -0.3 ? 0.4 : 0), 0, B.y0 + bh * 0.4, B.wBot * B.depth * 0.72 + 0.02, 7, 5));
  // jagged hem + body shag + shoulder fur
  for (let k = 0; k < F.hem; k++) { const a = (k / F.hem) * Math.PI * 2, jig = 0.82 + 0.35 * ((k * 7) % 5) / 4; up.push(tuft(V3(Math.sin(a) * F.hemR, F.hemY + 0.04, Math.cos(a) * F.hemR * B.depth), V3(Math.sin(a) * 0.25, -1, Math.cos(a) * 0.25).normalize(), F.hemLen * jig, 0.05 + 0.012 * (k % 2), S.fur)); }
  for (let k = 0; k < F.shag; k++) {
    const a = (k / F.shag) * Math.PI * 2 + 0.3, v = 0.38 + 0.4 * ((k * 5) % 7) / 6, y = B.y0 + v * bh, w = B.wTop + (B.wBot - B.wTop) * Math.pow(1 - v, B.round);
    up.push(tuft(V3(Math.sin(a) * w * 0.95, y, Math.cos(a) * w * B.depth * 0.95 - 0.01), V3(Math.sin(a) * 0.18, -1, Math.cos(a) * 0.18).normalize(), F.shagLen * (0.8 + 0.4 * ((k * 3) % 4) / 3), 0.045, k % 2 ? S.fur : S.fur));
  }
  // ---- head ----
  const hd: THREE.BufferGeometry[] = [], hx = 0, hy = H.y, hz = H.z;
  hd.push(ell(H.rx, H.ry, H.rz, fur, hx, hy, hz, 8, 5));
  const fz = hz + H.rz * 0.8; // the face sits on the front of the head
  hd.push(ell(H.rx * 0.68 * H.face, H.ry * 0.7 * H.face, H.rz * 0.4, S.face, 0, hy - H.ry * 0.05, fz, 6, 3)); // face disc
  hd.push(ell(H.rx * 0.4, H.ry * 0.33, H.rz * 0.32, S.muzzle, 0, hy - H.ry * 0.3, fz + H.rz * 0.2, 6, 4)); // darker muzzle
  hd.push(ell(H.eye * 0.55, H.eye * 0.4, H.eye * 0.4, S.dark, 0, hy - H.ry * 0.14, fz + H.rz * 0.4, 4, 3)); // nose
  for (const sx of [1, -1]) {
    const ex = sx * H.eyeX, ey = hy + H.ry * 0.24, ez = fz + H.rz * 0.22;
    hd.push(ell(H.eye, H.eye * 1.15, H.eye * 0.7, S.dark, ex, ey, ez, 6, 4), ell(H.eye * 0.3, H.eye * 0.3, H.eye * 0.3, 0xffffff, ex + sx * -H.eye * 0.2, ey + H.eye * 0.42, ez + H.eye * 0.55, 4, 2));
    hd.push(ell(H.ears, H.ears * 1.05, H.ears * 0.6, S.hand, sx * (H.rx * 0.98), hy + H.ry * 0.1, hz - H.rz * 0.05, 4, 3)); // small round ears
    if (H.brow) hd.push(ell(H.eyeX * 0.8, H.eye * 0.55, H.eye * 1.1, S.furShade, sx * H.eyeX, ey + H.eye * 1.35, ez - H.eye * 0.1, 4, 3, [0, 0, sx * -0.25])); // heavy brow
  }
  for (let k = -1; k <= 1; k++) hd.push(ell(H.eye * 0.34, H.eye * 0.34, H.eye * 0.34, S.dark, k * H.rx * 0.2, hy - H.ry * 0.5 + (k * k) * H.ry * 0.08, fz + H.rz * 0.32, 4, 2)); // a smile
  for (let k = 0; k < F.top; k++) { // tufts on top of the head
    const a = (k / Math.max(1, F.top - 1) - 0.5) * 2, up3 = V3(a * 0.55, 1, -0.1 * Math.abs(a)).normalize();
    hd.push(tuft(V3(a * H.rx * 0.5, hy + H.ry * 0.85, hz - 0.02), up3, F.topLen * (1 - Math.abs(a) * 0.25), 0.05, k % 2 ? S.fur : 0xffffff));
  }
  if (H.fringe) for (let k = 0; k < 4; k++) { const a = (k / 3 - 0.5) * 2; hd.push(tuft(V3(a * H.rx * 0.8, hy + H.ry * 0.55, fz - 0.02), V3(a * 0.3, -1, 0.35).normalize(), 0.09 + 0.03 * (k % 2), 0.035, S.fur)); }
  const headM = new THREE.Matrix4().makeTranslation(hx, hy - H.ry * 0.6, hz - 0.04).multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(P.nod, P.headYaw + P.look, 0, 'YXZ'))).multiply(new THREE.Matrix4().makeTranslation(-hx, -(hy - H.ry * 0.6), -(hz - 0.04)));
  for (const g of hd) up.push(g.applyMatrix4(headM));
  // ---- arms ----
  for (const sx of [1, -1] as const) {
    const swing = sx === 1 ? P.armL : P.armR, raised = sx === -1 && P.raise > 0;
    const sh = V3(sx * A.x, A.y * breath, 0.0);
    let d: THREE.Vector3;
    if (raised) { const ang = A.splay + P.raise * 2.5 + P.wiggle; d = V3(sx * Math.sin(ang), -Math.cos(ang), 0.15 * P.raise); } else d = V3(sx * Math.sin(A.splay), -Math.cos(swing) * Math.cos(A.splay), Math.sin(swing) * Math.cos(A.splay));
    d.normalize();
    const hand = sh.clone().addScaledVector(d, A.len);
    up.push(limb(sh, hand, A.r0, A.r1, fur, 6), ell(A.r0 * 1.12, A.r0 * 1.0, A.r0 * 1.05, fur, sh.x, sh.y, sh.z, 6, 4)); // arm + shoulder ball
    for (let k = 0; k < F.arm; k++) { const f = 0.25 + (0.6 * k) / Math.max(1, F.arm - 1), at = sh.clone().addScaledVector(d, A.len * f); up.push(tuft(at.clone().add(V3(sx * A.r0 * 0.7, 0, 0)), V3(sx * 0.35, -1, -0.1).add(d).normalize(), F.armLen * (0.8 + 0.2 * (k % 2)), 0.04, k % 2 ? S.fur : S.furShade)); }
    up.push(ell(A.hand, A.hand * 1.05, A.hand * 0.9, S.hand, hand.x, hand.y - A.hand * 0.2, hand.z, 6, 4));
    const side = V3(1, 0, 0).cross(d).normalize();
    for (let k = 0; k < A.fingers; k++) { // rounded fingers curling forward
      const f = A.fingers === 1 ? 0 : k / (A.fingers - 1) - 0.5, p = hand.clone().addScaledVector(d, A.hand * 0.85).addScaledVector(V3(1, 0, 0), f * A.hand * 1.35).addScaledVector(side, 0);
      up.push(ell(A.hand * 0.28, A.hand * 0.42, A.hand * 0.28, S.hand, p.x, p.y - A.hand * 0.1 - Math.abs(f) * 0.012, p.z + A.hand * 0.1, 4, 2));
    }
  }
  const upM = new THREE.Matrix4().makeTranslation(0, yOff, 0).multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(B.hunch * 0.6, 0, P.sway, 'YXZ'))).multiply(new THREE.Matrix4().makeTranslation(0, 0, 0));
  // the lean pivots about the hips: translate to the hip, rotate, translate back
  const pivot = new THREE.Matrix4().makeTranslation(0, L.len + L.footH, 0), unpivot = new THREE.Matrix4().makeTranslation(0, -(L.len + L.footH), 0);
  const full = new THREE.Matrix4().makeTranslation(0, yOff, 0).multiply(pivot).multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(B.hunch * 0.6, 0, P.sway, 'YXZ'))).multiply(unpivot);
  void upM;
  for (const g of up) parts.push(g.applyMatrix4(full));
  void legEnds;
  const g = mergeGeometries(parts, false)!;
  g.computeBoundingSphere();
  return g;
}

// ---- pose sets ---------------------------------------------------------------------------------------------------------------------
export const WALK_FRAMES = 8;
export const WAVE_FRAMES = 6;
export type PoseKind = 'walk' | 'idle' | 'wave';
export interface PoseSet {
  model: ModelId;
  /** `kind`, frame and head-turn bucket (-1 left, 0 centre, 1 right; walk and idle only). Built on first use, then cached. */
  get(kind: PoseKind, frame: number, look?: -1 | 0 | 1): THREE.BufferGeometry;
  dispose(): void;
}
const LOOK = 0.55;
export function createPoseSet(model: ModelId): PoseSet {
  const cache = new Map<string, THREE.BufferGeometry>();
  const legLen = legLenOf(model);
  const make = (kind: PoseKind, frame: number, look: number): THREE.BufferGeometry => {
    const P = neutral();
    if (kind === 'walk') Object.assign(P, walkPose(frame / WALK_FRAMES, { legLen }));
    else if (kind === 'wave') { const w = wavePose((frame + 0.5) / WAVE_FRAMES); Object.assign(P, idlePose(), { raise: Math.max(0.55, w.raise), wiggle: frame === 0 || frame === WAVE_FRAMES - 1 ? 0 : (frame % 2 ? 0.35 : -0.35) }); }
    P.look = look * LOOK;
    return buildPose(model, P);
  };
  return {
    model,
    get(kind, frame, look = 0) {
      const f = kind === 'idle' ? 0 : frame, key = `${kind}:${f}:${look}`;
      let g = cache.get(key);
      if (!g) { g = make(kind, f, look); cache.set(key, g); }
      return g;
    },
    dispose() { for (const g of cache.values()) g.dispose(); cache.clear(); },
  };
}
export { GAIT, swingOf };
export const triangles = (g: THREE.BufferGeometry): number => (g.index ? g.index.count : g.getAttribute('position').count) / 3;
