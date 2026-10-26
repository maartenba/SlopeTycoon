import * as THREE from 'three';
import { PropKind } from '@/world/Props';
import { mergeParts, type Part } from './Trees';

/**
 * NEAR tree/rock meshes (ground cameras only, < ~60 m): higher-poly crowns (>= 12 radial segments), irregular noise displacement, ridged bark trunks and
 * branch bundles. Same vertex format as the standard meshes (aBase colour + foliage flag) so the same tree shader / seasons / snow caps apply. Procedural only.
 */
const TRUNK = new THREE.Color(0x5a4030), BARK2 = new THREE.Color(0x4a3426), BIRCH = new THREE.Color(0xe6e2d6), BIRCH_MARK = new THREE.Color(0x3b3a38), SNAG = new THREE.Color(0x6e665e);
const PINE = new THREE.Color(0x2f6b3a), PINE_TALL = new THREE.Color(0x3f7440), PINE_DARK = new THREE.Color(0x27593a), LARCH = new THREE.Color(0x6f9a3c);
const LEAF = new THREE.Color(0x5b8c3a), BIRCH_LEAF = new THREE.Color(0x93b955), OAK_LEAF = new THREE.Color(0x4a7a2c), SHRUB = new THREE.Color(0x4d8035);

const hash3 = (x: number, y: number, z: number, k: number): number => { const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + k * 19.19) * 43758.5453; return h - Math.floor(h); };

/** Deterministic position-hashed displacement (shared / duplicated vertices move identically): radial in xz by `amp`, vertical by `amp*0.35`. */
export function displace(g: THREE.BufferGeometry, amp: number, k = 0, cx = 0, cz = 0): THREE.BufferGeometry {
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const h = hash3(Math.round(x * 500) / 500, Math.round(y * 500) / 500, Math.round(z * 500) / 500, k) - 0.5;
    const rx = x - cx, rz = z - cz, r = Math.hypot(rx, rz);
    if (r < 1e-4) { p.setXYZ(i, x, y + h * amp * 0.2, z); continue; }
    const f = 1 + h * 2 * amp;
    p.setXYZ(i, cx + rx * f, y + h * amp * 0.35, cz + rz * f);
  }
  return g;
}

const cone = (r: number, h: number, y: number, seg: number, hs: number, amp: number, k: number): THREE.BufferGeometry => {
  const g = new THREE.ConeGeometry(r, h, seg, hs).translate(0, y + h / 2, 0);
  return displace(g, amp, k);
};
/** Ridged, slightly leaning bark trunk: 8 radial segments, 4 rings, ring radius wobble. */
const trunk = (r0: number, r1: number, h: number, k: number): THREE.BufferGeometry => displace(new THREE.CylinderGeometry(r0, r1, h, 8, 4).translate(0, h / 2, 0), 0.12, k);
const blob = (r: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, amp: number, k: number, detail = 2): THREE.BufferGeometry =>
  displace(new THREE.IcosahedronGeometry(r, detail).scale(sx, sy, sz), amp, k).translate(x, y, z);
const limb = (y: number, len: number, tilt: number, az: number, r = 0.03): THREE.BufferGeometry => {
  const g = new THREE.CylinderGeometry(r * 0.4, r, len, 5, 1).translate(0, len / 2, 0);
  g.rotateZ(-tilt); g.rotateY(az); return g.translate(0, y, 0);
};
/** Bundle of `n` limbs fanning around the trunk plus one thinner twig each (branch bundles). */
const bundle = (y: number, len: number, tilt: number, n: number, color: THREE.Color, phase = 0, r = 0.03): Part[] => {
  const out: Part[] = [];
  for (let i = 0; i < n; i++) {
    const az = phase + (i / n) * Math.PI * 2 + hash3(i, y, n, 3) * 0.4;
    out.push({ geo: limb(y + (i % 2) * 0.1, len, tilt + (i % 3) * 0.1, az, r), color, foliage: 0 });
    out.push({ geo: limb(y + 0.12 + (i % 2) * 0.1, len * 0.55, tilt + 0.5, az + 0.7, r * 0.55), color, foliage: 0 });
  }
  return out;
};
const root = (r: number, k: number): Part => ({ geo: displace(new THREE.ConeGeometry(r * 1.5, 0.12, 8, 1).translate(0, 0.06, 0).rotateX(Math.PI), 0.2, k), color: BARK2, foliage: 0 });

function conifer(): THREE.BufferGeometry {
  return mergeParts([
    { geo: trunk(0.07, 0.1, 0.5, 1), color: TRUNK, foliage: 0 }, root(0.09, 2),
    { geo: cone(0.58, 0.8, 0.32, 12, 1, 0.2, 3), color: PINE_DARK, foliage: 1 },
    { geo: cone(0.5, 0.75, 0.74, 12, 1, 0.2, 4), color: PINE, foliage: 1 },
    { geo: cone(0.4, 0.7, 1.12, 12, 1, 0.2, 5), color: PINE, foliage: 1 },
    { geo: cone(0.28, 0.6, 1.5, 12, 1, 0.2, 6), color: PINE_TALL, foliage: 1 },
    { geo: cone(0.14, 0.4, 1.8, 12, 1, 0.15, 7), color: PINE_TALL, foliage: 1 },
    ...bundle(0.55, 0.3, 1.1, 4, TRUNK, 0.2, 0.025),
  ]);
}
function pine(): THREE.BufferGeometry {
  return mergeParts([
    { geo: trunk(0.05, 0.09, 1.7, 8), color: TRUNK, foliage: 0 }, root(0.09, 9),
    { geo: cone(0.46, 0.5, 0.9, 12, 1, 0.22, 10), color: PINE_TALL, foliage: 1 },
    { geo: cone(0.38, 0.45, 1.3, 12, 1, 0.22, 11), color: PINE_TALL, foliage: 1 },
    { geo: cone(0.3, 0.45, 1.7, 12, 1, 0.22, 12), color: PINE_TALL, foliage: 1 },
    { geo: cone(0.2, 0.5, 2.05, 12, 1, 0.2, 13), color: PINE_TALL, foliage: 1 },
    ...bundle(0.7, 0.3, 0.9, 3, TRUNK, 0.5, 0.02), ...bundle(1.1, 0.25, 0.9, 3, TRUNK, 1.1, 0.018),
  ]);
}
function larch(): THREE.BufferGeometry {
  return mergeParts([
    { geo: trunk(0.05, 0.08, 1.9, 14), color: TRUNK, foliage: 0 }, root(0.08, 15),
    { geo: cone(0.38, 0.9, 0.4, 12, 1, 0.24, 16), color: LARCH, foliage: 1 },
    { geo: cone(0.3, 0.8, 0.95, 12, 1, 0.24, 17), color: LARCH, foliage: 1 },
    { geo: cone(0.2, 0.7, 1.45, 12, 1, 0.24, 18), color: LARCH, foliage: 1 },
    { geo: cone(0.1, 0.5, 1.9, 12, 1, 0.2, 19), color: LARCH, foliage: 1 },
    ...bundle(0.5, 0.35, 1.0, 5, TRUNK, 0, 0.02), ...bundle(1.0, 0.28, 1.0, 4, TRUNK, 0.6, 0.018),
  ]);
}
function deciduous(): THREE.BufferGeometry {
  return mergeParts([
    { geo: trunk(0.07, 0.1, 0.85, 20), color: TRUNK, foliage: 0 }, root(0.1, 21),
    { geo: blob(0.5, 0, 1.0, 0, 1, 0.95, 1, 0.2, 22), color: LEAF, foliage: 1, smooth: true },
    { geo: blob(0.3, 0.3, 0.85, 0.15, 1, 0.9, 1, 0.22, 23, 1), color: LEAF, foliage: 1, smooth: true },
    { geo: blob(0.28, -0.28, 1.2, -0.12, 1, 0.9, 1, 0.22, 24, 1), color: LEAF, foliage: 1, smooth: true },
    ...bundle(0.6, 0.5, 0.7, 5, TRUNK, 0, 0.03),
  ]);
}
function birch(): THREE.BufferGeometry {
  const marks: Part[] = [];
  for (let i = 0; i < 4; i++) marks.push({ geo: new THREE.BoxGeometry(0.05, 0.025, 0.012).translate(0, 0.35 + i * 0.28, 0.048).rotateY(i * 1.9), color: BIRCH_MARK, foliage: 0 });
  return mergeParts([
    { geo: trunk(0.045, 0.07, 1.3, 30), color: BIRCH, foliage: 0 }, ...marks,
    { geo: blob(0.32, 0, 1.4, 0, 1, 1.4, 1, 0.2, 31), color: BIRCH_LEAF, foliage: 1, smooth: true },
    { geo: blob(0.22, 0.14, 0.95, 0.08, 1, 1, 1, 0.22, 32, 1), color: BIRCH_LEAF, foliage: 1, smooth: true },
    ...bundle(0.8, 0.4, 0.55, 4, BIRCH, 0, 0.022),
  ]);
}
function oak(): THREE.BufferGeometry {
  return mergeParts([
    { geo: trunk(0.1, 0.16, 0.65, 40), color: TRUNK, foliage: 0 }, root(0.16, 41),
    { geo: blob(0.5, 0, 0.95, 0, 1.5, 0.85, 1.5, 0.2, 42), color: OAK_LEAF, foliage: 1, smooth: true },
    { geo: blob(0.34, 0.4, 0.8, 0.25, 1.2, 0.9, 1.2, 0.22, 43, 1), color: OAK_LEAF, foliage: 1, smooth: true },
    { geo: blob(0.3, -0.45, 0.85, -0.2, 1.2, 0.9, 1.2, 0.22, 44, 1), color: OAK_LEAF, foliage: 1, smooth: true },
    ...bundle(0.55, 0.7, 1.0, 6, TRUNK, 0, 0.04),
  ]);
}
function shrub(): THREE.BufferGeometry {
  return mergeParts([
    { geo: blob(0.3, 0, 0.22, 0, 1.1, 0.75, 1.1, 0.22, 50), color: SHRUB, foliage: 1, smooth: true },
    { geo: blob(0.2, 0.2, 0.18, 0.12, 1, 0.8, 1, 0.22, 51, 1), color: SHRUB, foliage: 1, smooth: true },
    ...bundle(0.02, 0.35, 0.5, 5, TRUNK, 0, 0.015),
  ]);
}
function snag(): THREE.BufferGeometry {
  return mergeParts([
    { geo: trunk(0.04, 0.1, 1.6, 60), color: SNAG, foliage: 0 }, root(0.1, 61),
    ...bundle(1.0, 0.45, 0.9, 5, SNAG, 0, 0.03), ...bundle(1.4, 0.3, 0.7, 3, SNAG, 1, 0.022),
  ]);
}

/** Near tree geometry for a prop kind (`undefined` for non-tree kinds). */
export function nearTreeGeometry(kind: number): THREE.BufferGeometry | undefined {
  switch (kind) {
    case PropKind.Conifer: return conifer();
    case PropKind.Deciduous: return deciduous();
    case PropKind.Pine: return pine();
    case PropKind.Larch: return larch();
    case PropKind.Birch: return birch();
    case PropKind.Oak: return oak();
    case PropKind.Shrub: return shrub();
    case PropKind.Snag: return snag();
    default: return undefined;
  }
}

/** Near rock: icosahedron detail 4 (500 facets) with two-octave displacement, flat-ish base, a few chipped facets. */
export function nearRockGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(0.38, 4);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = Math.round(p.getX(i) * 400) / 400, y = Math.round(p.getY(i) * 400) / 400, z = Math.round(p.getZ(i) * 400) / 400;
    const j = 0.78 + 0.3 * hash3(x, y, z, 1) + 0.16 * hash3(x * 3, y * 3, z * 3, 2);
    const ny = Math.max(y * j * 0.7 + 0.1, 0.0);
    p.setXYZ(i, p.getX(i) * j, ny, p.getZ(i) * j);
  }
  return mergeParts([{ geo: g, color: new THREE.Color(0x56534f), foliage: 0 }]);
}
