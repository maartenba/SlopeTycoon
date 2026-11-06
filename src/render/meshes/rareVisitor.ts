import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Rare high-country visitor: a tall, hunched, shaggy white-grey biped (forward = +z, ~1 tile tall). Four walk poses share one material. */
const paint = (g: THREE.BufferGeometry, color: number): THREE.BufferGeometry => {
  const geo = g.index ? g.toNonIndexed() : g;
  geo.deleteAttribute('uv');
  const c = new THREE.Color(color), n = geo.getAttribute('position').count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
};
/** Ellipsoid with smooth normals, centred at (x, y, z), tilted about x. */
const ell = (rx: number, ry: number, rz: number, color: number, x: number, y: number, z: number, tilt = 0, ws = 8, hs = 5): THREE.BufferGeometry => {
  const g = new THREE.SphereGeometry(1, ws, hs), p = g.getAttribute('position'), n = g.getAttribute('normal'), v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.set(p.getX(i) / rx, p.getY(i) / ry, p.getZ(i) / rz).normalize(); n.setXYZ(i, v.x, v.y, v.z); p.setXYZ(i, p.getX(i) * rx, p.getY(i) * ry, p.getZ(i) * rz); }
  if (tilt) g.rotateX(tilt);
  g.translate(x, y, z);
  return paint(g, color);
};
/** Tapered limb hanging from (x, y, z) and swinging about x by `a` (0 = straight down). Returns the geometry and where it ends. */
const limb = (rTop: number, rBot: number, h: number, color: number, x: number, y: number, z: number, a: number): { g: THREE.BufferGeometry; ey: number; ez: number } => {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, 6, 1, true).translate(0, -h / 2, 0).rotateX(a).translate(x, y, z);
  return { g: paint(g, color), ey: y - h * Math.cos(a), ez: z + h * Math.sin(a) };
};

const WHITE = 0xf2f5f9, FLEECE = 0xdde3ea, SHADE = 0xb9c2ce, FACE = 0x30343c;

/** Shaggy fur: a ring of downward-pointing cone tufts around a point. */
const tufts = (cx: number, cy: number, cz: number, rx: number, rz: number, n: number, len: number, color: number, tilt = 0): THREE.BufferGeometry[] => {
  const out: THREE.BufferGeometry[] = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + (k % 2) * 0.2, g = new THREE.ConeGeometry(0.05, len * (0.8 + (k % 3) * 0.2), 4, 1, false).rotateX(Math.PI);
    g.translate(cx + Math.sin(a) * rx, cy - len * 0.35, cz + Math.cos(a) * rz);
    if (tilt) { g.translate(-cx, -cy, -cz); g.rotateX(tilt); g.translate(cx, cy, cz); }
    out.push(paint(g, color));
  }
  return out;
};

function pose(s: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [
    ell(0.3, 0.37, 0.24, WHITE, 0, 0.6, -0.04, 0.45, 9, 6), // big hunched torso
    ell(0.38, 0.2, 0.22, FLEECE, 0, 0.82, 0.06, 0.25, 9, 5), // heavy shoulders
    ell(0.25, 0.2, 0.22, SHADE, 0, 0.42, -0.14, 0.3, 8, 4), // rump
    ell(0.1, 0.1, 0.1, WHITE, 0, 0.86, 0.27, 0, 8, 5), // small head, low and forward
    ell(0.075, 0.06, 0.04, FACE, 0, 0.85, 0.35, 0, 7, 4), // dark face
    ell(0.11, 0.035, 0.06, FLEECE, 0, 0.94, 0.28, 0, 6, 3), // brow tuft
    ...tufts(0, 0.5, -0.02, 0.28, 0.22, 10, 0.2, FLEECE), // shaggy skirt
    ...tufts(0, 0.9, 0.04, 0.3, 0.16, 8, 0.15, WHITE), // shoulder fur
  ];
  for (const sx of [-1, 1]) {
    const leg = limb(0.12, 0.09, 0.36, WHITE, sx * 0.14, 0.38, -0.02, s * sx * 0.55);
    parts.push(leg.g, ell(0.11, 0.05, 0.19, FLEECE, sx * 0.14, leg.ey + 0.02, leg.ez + 0.08, 0, 7, 4)); // big feet
    const arm = limb(0.1, 0.07, 0.56, FLEECE, sx * 0.36, 0.84, 0.06, -s * sx * 0.45 + 0.12);
    parts.push(arm.g, ell(0.075, 0.08, 0.075, SHADE, sx * 0.36, arm.ey, arm.ez, 0, 6, 4)); // long arms, big hands
  }
  const g = mergeGeometries(parts, false)!;
  g.computeBoundingSphere();
  return g;
}
/** Walk poses in cycle order: stride, passing, opposite stride, passing. */
export function createVisitorPoses(): THREE.BufferGeometry[] { return [0.5, 0, -0.5, 0].map(pose); }
