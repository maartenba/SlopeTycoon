import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GAIT, idlePose, swingOf, walkPose, wavePose, type GaitPose } from './visitorGait';

/**
 * Rare high-country visitor model: ONE vertex-coloured geometry per pose (<= ~1,800 triangles): lofted pear body, ellipsoid head / face / hands /
 * feet, and many overlapping droplet-shaped fur lobes (rounded tips, bluish roots to white tips) layered in rows. Forward = +z, ~1 tile tall.
 * Poses (walk frames, idle looks, wave frames) are built from the pure gait (`visitorGait.ts`) and swapped on the same mesh: no extra draw calls.
 * Fur on limbs follows the limb, skirt lobes lean with the stride, the head mane leans with the sway and the head turn.
 */
interface Spec {
  fur: number; furShade: number; furRoot: number; belly: number; face: number; muzzle: number; hand: number; foot: number; dark: number;
  /** Body loft: y0 / y1, half widths at the bottom / top, depth ratio, how far the widest point leans to the bottom (0..1), hunch (rad forward). */
  body: { y0: number; y1: number; wBot: number; wTop: number; depth: number; round: number; hunch: number };
  head: { y: number; rx: number; ry: number; rz: number; z: number; face: number; eye: number; eyeX: number; ears: number };
  legs: { x: number; len: number; r0: number; r1: number; footW: number; footL: number; footH: number; toes: number };
  arms: { x: number; y: number; len: number; r0: number; r1: number; hand: number; splay: number; fingers: number };
}

// big rounded pear body in long fluffy white-blue fur, pale belly, big round grey-brown face with a darker muzzle, thick arms, big hands, short thick legs, big flat feet
const S: Spec = {
  fur: 0xf8fbff, furShade: 0xbcd3ec, furRoot: 0xb3cbeb, belly: 0xffffff, face: 0x9a8b7f, muzzle: 0x6a5b52, hand: 0x8e7f73, foot: 0x8e7f73, dark: 0x1c1b22,
  body: { y0: 0.15, y1: 0.8, wBot: 0.33, wTop: 0.21, depth: 0.9, round: 1.2, hunch: 0 },
  head: { y: 0.96, rx: 0.25, ry: 0.215, rz: 0.225, z: 0.03, face: 1, eye: 0.05, eyeX: 0.08, ears: 0.05 },
  legs: { x: 0.125, len: 0.2, r0: 0.115, r1: 0.105, footW: 0.115, footL: 0.16, footH: 0.05, toes: 3 },
  arms: { x: 0.31, y: 0.7, len: 0.4, r0: 0.125, r1: 0.108, hand: 0.115, splay: 0.1, fingers: 3 },
};
export const legLen = S.legs.len;

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
/** A fur lobe: a droplet (ellipsoid tapering to a rounded tip) from `base` along `dir` (unit), `len` long, `r` wide; vertex colour runs from the bluish root to the pale tip. */
const lobe = (base: THREE.Vector3, dir: THREE.Vector3, len: number, r: number, tip = 0xffffff): THREE.BufferGeometry => {
  const g = new THREE.SphereGeometry(1, 5, 3), p = g.getAttribute('position'), n = g.getAttribute('normal'), col = new Float32Array(p.count * 3);
  const root = new THREE.Color(S.furRoot), top = new THREE.Color(tip), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), t = (y + 1) / 2, k = 1 - 0.35 * Math.max(0, y);
    n.setXYZ(i, p.getX(i), y, p.getZ(i));
    p.setXYZ(i, p.getX(i) * r * k, (y + 1) * len * 0.5 - len * 0.12, p.getZ(i) * r * k);
    c.copy(root).lerp(top, Math.min(1, 0.1 + t * 1.05)); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.deleteAttribute('uv'); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)).translate(base.x, base.y, base.z);
  return g;
};
let lobeNo = 0;
/** Deterministic jitter in [-1, 1] by lobe order (the same in every pose, so the fur does not shimmer between frames). */
const jit = (): number => { lobeNo++; const x = Math.sin(lobeNo * 12.9898) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; };
/** A lobe with a slight random lean and size variation. */
const fluff = (base: THREE.Vector3, dir: THREE.Vector3, len: number, r: number, tip = 0xffffff): THREE.BufferGeometry => {
  const a = jit(), b = jit(), c = jit();
  return lobe(base, dir.clone().add(V3(a * 0.18, b * 0.14, c * 0.18)).normalize(), len * (1 + 0.2 * c), r * (1 + 0.15 * a), tip);
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

/** One pose as a single merged geometry. */
export function buildPose(P: PoseParams): THREE.BufferGeometry {
  lobeNo = 0;
  const parts: THREE.BufferGeometry[] = [], L = S.legs, A = S.arms, B = S.body, H = S.head;
  const furCol = (base: number, shade: number): ColorFn => (_p, n) => _c.set(base).lerp(new THREE.Color(shade), Math.min(0.75, Math.max(0, 0.32 * (-n.y * 0.5 + 0.5) + (n.z < -0.3 ? 0.18 : 0))));
  const fur = furCol(S.fur, S.furShade);
  const yOff = P.bob, bh = B.y1 - B.y0, breath = 1 + P.breathe;
  const wAt = (y: number): number => { const v = Math.min(1, Math.max(0, (y - B.y0) / bh)); return B.wTop + (B.wBot - B.wTop) * Math.pow(1 - v, B.round); };
  /** `n` lobes in a ring around `axis` at `o`: radial offset `rad`, pointing outward by `out` and along the axis by `along`. */
  const ring = (dst: THREE.BufferGeometry[], o: THREE.Vector3, axis: THREE.Vector3, n: number, a0: number, rad: number, out: number, along: number, len: number, r: number): void => {
    const p1 = V3(1, 0, 0), p2 = new THREE.Vector3().crossVectors(axis, p1).normalize();
    for (let k = 0; k < n; k++) {
      const a = a0 + (k / n) * Math.PI * 2, radial = p1.clone().multiplyScalar(Math.cos(a)).addScaledVector(p2, Math.sin(a));
      dst.push(fluff(o.clone().addScaledVector(radial, rad), radial.clone().multiplyScalar(out).addScaledVector(axis, along).normalize(), len, r));
    }
  };
  // ---- legs (swing about the hips, feet planted: the hips drop as the legs spread) ----
  const hipY = L.len + L.footH + yOff;
  for (const sx of [1, -1] as const) {
    const th = sx === 1 ? P.legL : P.legR, lift = sx === 1 ? P.liftL : P.liftR;
    const hip = V3(sx * L.x, hipY, -0.01), ankleY = hipY - L.len * Math.cos(th) + lift, ankleZ = hip.z + L.len * Math.sin(th);
    const ankle = V3(sx * L.x, ankleY + L.footH * 0.4, ankleZ), axis = ankle.clone().sub(hip).normalize();
    parts.push(limb(hip, ankle, L.r0, L.r1, fur, 6));
    ring(parts, hip.clone().addScaledVector(axis, L.len * 0.7), axis, 2, Math.PI * 0.5 + (sx > 0 ? 0.3 : 0.9), L.r1 * 0.85, 0.8, 0.45, 0.12, 0.07); // cuff above the foot
    const pitch = -th * 0.6 - (lift > 0 ? 0.25 : 0);
    parts.push(ell(L.footW, L.footH, L.footL, S.foot, sx * L.x, ankleY, ankleZ + L.footL * 0.45, 5, 4, [pitch, 0, 0]));
    for (let k = 0; k < L.toes; k++) { // toes: rounded lobes along the front of the foot
      const f = L.toes === 1 ? 0 : k / (L.toes - 1) - 0.5, tx = sx * L.x + f * L.footW * 1.45;
      parts.push(ell(L.footW * 0.3, L.footH * 0.8, L.footL * 0.22, S.foot, tx, ankleY + 0.004 - pitch * 0.05, ankleZ + L.footL * 0.45 + L.footL * 0.82 - Math.abs(f) * 0.03, 4, 2, [pitch, 0, 0]));
    }
  }
  // ---- upper body: one group, rolled by the sway ----
  const up: THREE.BufferGeometry[] = [];
  up.push(bodyLoft(S, fur));
  up.push(ell(B.wBot * 0.6, bh * 0.32, 0.09 * breath, (_p, n) => _c.set(S.belly).lerp(new THREE.Color(S.fur), n.y < -0.3 ? 0.4 : 0), 0, B.y0 + bh * 0.4, B.wBot * B.depth * 0.72 + 0.02, 7, 5)); // pale belly patch
  // ragged skirt around the hips and thighs (leans with the leg on its side), a second row higher up on the back and flanks, tufts on the back
  const stride = (x: number): number => 0.45 * Math.sin(x >= 0 ? P.legL : P.legR);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.2, sx = Math.sin(a), cz = Math.cos(a), w = wAt(0.34) * 0.98;
    up.push(fluff(V3(sx * w, 0.36, cz * w * B.depth), V3(sx * 0.4, -1, cz * 0.4 + stride(sx)).normalize(), 0.24, 0.1));
  }
  for (let k = 0; k < 4; k++) {
    const a = Math.PI * (0.45 + (k / 3) * 1.1), sx = Math.sin(a), cz = Math.cos(a), w = wAt(0.5) * 0.97;
    up.push(fluff(V3(sx * w, 0.52, cz * w * B.depth), V3(sx * 0.5, -1, cz * 0.5 + stride(sx) * 0.5).normalize(), 0.21, 0.09));
  }
  const backs: Array<[number, number]> = [[-0.08, 0.7], [0.1, 0.62], [-0.1, 0.5], [0.1, 0.4], [0, 0.3]];
  for (const [bx, by] of backs) up.push(fluff(V3(bx, by, -wAt(by) * B.depth * 0.92 - 0.01), V3(bx * 0.8, -0.8, -0.7).normalize(), 0.21, 0.09));
  // ---- head ----
  const hd: THREE.BufferGeometry[] = [], hx = 0, hy = H.y, hz = H.z;
  hd.push(ell(H.rx, H.ry, H.rz, fur, hx, hy, hz, 8, 5));
  const fz = hz + H.rz * 0.8; // the face sits on the front of the head
  hd.push(ell(H.rx * 0.68 * H.face, H.ry * 0.72 * H.face, H.rz * 0.4, S.face, 0, hy - H.ry * 0.05, fz, 6, 3)); // face disc
  hd.push(ell(H.rx * 0.5, H.ry * 0.4, H.rz * 0.34, S.muzzle, 0, hy - H.ry * 0.3, fz + H.rz * 0.2, 6, 4)); // big round muzzle patch
  hd.push(ell(H.eye * 0.55, H.eye * 0.4, H.eye * 0.4, S.dark, 0, hy - H.ry * 0.16, fz + H.rz * 0.42, 4, 3)); // nose
  for (const sx of [1, -1]) {
    const ex = sx * H.eyeX, ey = hy + H.ry * 0.22, ez = fz + H.rz * 0.24;
    hd.push(ell(H.eye, H.eye * 1.15, H.eye * 0.7, S.dark, ex, ey, ez, 6, 4), ell(H.eye * 0.38, H.eye * 0.38, H.eye * 0.38, 0xffffff, ex + sx * -H.eye * 0.2, ey + H.eye * 0.42, ez + H.eye * 0.55, 4, 2)); // eye + highlight
    hd.push(ell(H.ears, H.ears * 1.05, H.ears * 0.6, S.hand, sx * (H.rx * 0.98), hy + H.ry * 0.12, hz - H.rz * 0.05, 4, 3)); // small round ears
  }
  for (let k = -1; k <= 1; k++) hd.push(ell(H.eye * 0.3, H.eye * 0.3, H.eye * 0.3, S.dark, k * H.rx * 0.2, hy - H.ry * 0.52 + (k * k) * H.ry * 0.08, fz + H.rz * 0.32, 4, 2)); // a smile
  // fur hood framing the face (rim of the face disc, pointing outward and a little back), big messy mane on top
  for (let k = 0; k < 8; k++) {
    if (k === 6) continue; // leave the chin open
    const a = (k / 8) * Math.PI * 2 + 0.2, x = Math.cos(a) * H.rx * 0.72, y = hy + Math.sin(a) * H.ry * 0.74, zz = hz + H.rz * Math.sqrt(Math.max(0, 1 - (x / H.rx) ** 2 - ((y - hy) / H.ry) ** 2));
    hd.push(fluff(V3(x, y, zz - 0.02), V3(Math.cos(a) * 0.8, Math.sin(a) * 0.8 - 0.25, -0.35).normalize(), 0.16, 0.075));
  }
  for (let k = 0; k < 3; k++) { const a = (k - 1) * 0.6; hd.push(fluff(V3(Math.sin(a) * H.rx * 0.8, hy + H.ry * (0.15 - 0.3 * (k % 2)), hz - H.rz * 0.85), V3(Math.sin(a) * 0.5, -0.5, -1).normalize(), 0.17, 0.095)); } // fur at the back of the head
  const lean = P.sway * 4 + P.look * 0.2;
  for (let k = 0; k < 7; k++) {
    const a = (k / 6 - 0.5) * 2, up3 = V3(a * 0.6 + lean, 1, -0.2 - 0.1 * Math.abs(a)).normalize();
    hd.push(fluff(V3(a * H.rx * 0.5, hy + H.ry * (0.88 - 0.14 * Math.abs(a)) + (k % 2) * 0.02, hz - 0.03 - (k % 2) * 0.06), up3, 0.21 * (1 - Math.abs(a) * 0.25), 0.09));
  }
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
    up.push(limb(sh, hand, A.r0, A.r1, fur, 6), ell(A.r0 * 1.15, A.r0 * 1.05, A.r0 * 1.1, fur, sh.x, sh.y, sh.z, 6, 4)); // arm + shoulder ball
    up.push(fluff(sh.clone().add(V3(sx * 0.03, A.r0 * 0.7, 0.03)), V3(sx * 0.7, 0.2, 0.2).normalize(), 0.15, 0.085)); // shoulder ruff
    for (let k = 0; k < 2; k++) { const at = sh.clone().addScaledVector(d, A.len * (0.3 + k * 0.27)); up.push(fluff(at.add(V3(sx * A.r0 * 0.7, 0.02, -0.02)), V3(sx * 0.3, 0, -0.1).addScaledVector(d, 1.1).normalize(), 0.17, 0.085)); } // upper-arm fur
    ring(up, sh.clone().addScaledVector(d, A.len * 0.93), d, 2, 0.4, A.r1 * 0.9, 0.7, 0.85, 0.13, 0.07); // fluffy cuff above the hand
    up.push(ell(A.hand, A.hand * 1.05, A.hand * 0.9, S.hand, hand.x, hand.y - A.hand * 0.2, hand.z, 6, 4));
    for (let k = 0; k < A.fingers; k++) { // rounded fingers curling forward
      const f = A.fingers === 1 ? 0 : k / (A.fingers - 1) - 0.5, p = hand.clone().addScaledVector(d, A.hand * 0.85).addScaledVector(V3(1, 0, 0), f * A.hand * 1.35);
      up.push(ell(A.hand * 0.3, A.hand * 0.44, A.hand * 0.3, S.hand, p.x, p.y - A.hand * 0.1 - Math.abs(f) * 0.012, p.z + A.hand * 0.1, 4, 2));
    }
  }
  // the lean pivots about the hips: translate to the hip, rotate, translate back
  const pivot = new THREE.Matrix4().makeTranslation(0, L.len + L.footH, 0), unpivot = new THREE.Matrix4().makeTranslation(0, -(L.len + L.footH), 0);
  const full = new THREE.Matrix4().makeTranslation(0, yOff, 0).multiply(pivot).multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(B.hunch * 0.6, 0, P.sway, 'YXZ'))).multiply(unpivot);
  for (const g of up) parts.push(g.applyMatrix4(full));
  const g = mergeGeometries(parts, false)!;
  g.computeBoundingSphere();
  return g;
}

// ---- pose sets ---------------------------------------------------------------------------------------------------------------------
export const WALK_FRAMES = 8;
export const WAVE_FRAMES = 6;
export type PoseKind = 'walk' | 'idle' | 'wave';
export interface PoseSet {
  /** `kind`, frame and head-turn bucket (-1 left, 0 centre, 1 right; walk and idle only). Built on first use, then cached. */
  get(kind: PoseKind, frame: number, look?: -1 | 0 | 1): THREE.BufferGeometry;
  dispose(): void;
}
const LOOK = 0.55;
export function createPoseSet(): PoseSet {
  const cache = new Map<string, THREE.BufferGeometry>();
  const make = (kind: PoseKind, frame: number, look: number): THREE.BufferGeometry => {
    const P = neutral();
    if (kind === 'walk') Object.assign(P, walkPose(frame / WALK_FRAMES, { legLen }));
    else if (kind === 'wave') { const w = wavePose((frame + 0.5) / WAVE_FRAMES); Object.assign(P, idlePose(), { raise: Math.max(0.55, w.raise), wiggle: frame === 0 || frame === WAVE_FRAMES - 1 ? 0 : (frame % 2 ? 0.35 : -0.35) }); }
    P.look = look * LOOK;
    return buildPose(P);
  };
  return {
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
