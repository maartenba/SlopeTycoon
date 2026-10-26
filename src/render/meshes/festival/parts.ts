import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MIN_PART_THICKNESS } from '../../props/Trees';
import { col, cord, pennant } from '../../VillageDecor';

/**
 * Procedural festival props (M5.4 Task 21): flag pole, bunting string (re-uses the village pennant + cord), market stall, grandstand, finish
 * arch and the banner board. Everything is a vertex-coloured, non-indexed geometry in WORLD coordinates (tile units, y = terrain height + local),
 * so a festival's whole dressing merges into a single draw call. Banner boards are separate (textured with the festival name).
 */
const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
/** Local-space coloured box (no world transform yet). */
function put(g: THREE.BufferGeometry, hex: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  geo.deleteAttribute('uv');
  geo.translate(x, y, z);
  const c = new THREE.Color(hex), n = geo.getAttribute('position').count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}
const bx = (w: number, h: number, d: number, hex: number, x: number, y: number, z: number): THREE.BufferGeometry => put(new THREE.BoxGeometry(w, h, d), hex, x, y, z);
/** Merge local parts and place them in the world (position + yaw). */
function place(parts: THREE.BufferGeometry[], x: number, y: number, z: number, ry: number): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false)!;
  g.applyMatrix4(new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), ry), V(1, 1, 1)));
  return g;
}

export const POLE_H = 0.8;

/** A slim wooden pole; with `flag` (colour) a pennant flag flies from the top. */
export function poleGeometry(x: number, y: number, z: number, flag: number | null, dirX: number, dirZ: number): THREE.BufferGeometry[] {
  const out = [col(new THREE.CylinderGeometry(0.022, 0.03, POLE_H, 6), 0x6b4a2a, x, y + POLE_H / 2, z)];
  if (flag !== null) {
    out.push(col(new THREE.BoxGeometry(0.34, 0.2, MIN_PART_THICKNESS), flag, x + dirX * 0.17, y + POLE_H - 0.09, z + dirZ * 0.17, Math.atan2(-dirZ, dirX)));
    out.push(col(new THREE.CylinderGeometry(0.03, 0.03, 0.06, 6), 0xf2c14e, x, y + POLE_H + 0.02, z));
  }
  return out;
}

/** Bunting between two pole tops: cord with a gentle sag and pennants every ~0.2 tiles. */
export function buntingGeometry(ax: number, ay: number, az: number, bx2: number, by: number, bz: number, palette: readonly number[], k0 = 0): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [], dx = bx2 - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1, sag = 0.06 * len, nx = dx / len, nz = dz / len;
  const pts = Math.max(3, Math.round(len / 0.2));
  let prev = V(ax, ay, az), k = k0;
  for (let s = 1; s <= pts; s++) {
    const t = s / pts, cur = V(ax + dx * t, ay + (by - ay) * t - Math.sin(Math.PI * t) * sag, az + dz * t);
    out.push(cord(prev, cur));
    if (s < pts) out.push(pennant(cur.x, cur.y, cur.z, nx, nz, palette[k++ % palette.length]!));
    prev = cur;
  }
  return out;
}

/** Wooden market stall with a striped canopy and a few goods on the counter (faces local +z). */
export function stallGeometry(x: number, y: number, z: number, ry: number, canopy: number): THREE.BufferGeometry {
  const wood = 0x8b5a2b, dark = 0x5a3a20;
  const parts: THREE.BufferGeometry[] = [
    bx(0.78, 0.26, 0.34, wood, 0, 0.13, 0),
    bx(0.82, 0.03, 0.4, dark, 0, 0.27, 0.02),
    ...[[-0.38, -0.15], [0.38, -0.15], [-0.38, 0.17], [0.38, 0.17]].map(([px, pz]) => bx(0.03, 0.62, 0.03, dark, px!, 0.31, pz!)),
    bx(0.82, 0.02, 0.4, 0xf4efe2, 0, 0.62, -0.02),
  ];
  // striped canopy: alternating strips, slightly tilted towards the front
  for (let i = 0; i < 6; i++) {
    const g = put(new THREE.BoxGeometry(0.14, 0.025, 0.5), i % 2 ? 0xf4efe2 : canopy, -0.35 + i * 0.14, 0, 0);
    g.rotateX(0.18);
    g.translate(0, 0.68, 0.03);
    parts.push(g);
  }
  // goods: little crates / mugs in warm colours
  const goods = [0xd9453a, 0xf2c14e, 0x6fae5a, 0xf08a24, 0xf4efe2];
  for (let i = 0; i < 5; i++) parts.push(bx(0.09, 0.07 + (i % 2) * 0.03, 0.09, goods[i]!, -0.27 + i * 0.135, 0.31, 0.05));
  return place(parts, x, y, z, ry);
}

/** Small three-tier grandstand with a red roof and rows of spectators (faces local +z). */
export function grandstandGeometry(x: number, y: number, z: number, ry: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let t = 0; t < 3; t++) {
    parts.push(bx(2.0, 0.16, 0.34, t % 2 ? 0xb9b4a8 : 0xc8c3b6, 0, 0.08 + t * 0.16, -0.34 * t));
    parts.push(bx(2.0, 0.04, 0.2, 0x8b5a2b, 0, 0.18 + t * 0.16, -0.34 * t + 0.04));
    const seats = [0xd9534a, 0x4f86a8, 0xf2c14e, 0x6fae5a, 0xf4efe2];
    for (let k = 0; k < 9; k++) parts.push(bx(0.07, 0.1, 0.07, seats[(k + t * 2) % seats.length]!, -0.88 + k * 0.22, 0.26 + t * 0.16, -0.34 * t + 0.04));
  }
  for (const sx of [-0.98, 0.98]) parts.push(bx(0.04, 0.9, 0.04, 0x5a3a20, sx, 0.45, -0.7));
  parts.push(bx(2.1, 0.04, 1.1, 0xc0392b, 0, 0.92, -0.38));
  return place(parts, x, y, z, ry);
}

/** Finish arch: two posts, a chequered strip (the banner board hangs from it, see banner.ts). Spans local x, faces local z. */
export function finishArchGeometry(x: number, y: number, z: number, ry: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [bx(0.05, 1.05, 0.05, 0x3a3a3e, -0.9, 0.52, 0), bx(0.05, 1.05, 0.05, 0x3a3a3e, 0.9, 0.52, 0), bx(1.85, 0.04, 0.04, 0x3a3a3e, 0, 1.05, 0)];
  for (let i = 0; i < 12; i++) parts.push(bx(0.15, 0.07, 0.03, i % 2 ? 0x1b1b1b : 0xf4f4f0, -0.83 + i * 0.151, 0.98, 0.02));
  return place(parts, x, y, z, ry);
}

/** Two posts for a banner spanning across the road (the board itself is textured, see banner.ts). */
export function bannerPostsGeometry(x: number, y: number, z: number, ry: number, w: number, h: number, top: number): THREE.BufferGeometry {
  const hw = w / 2 + 0.04, parts = [bx(0.04, top + 0.1, 0.04, 0x6b4a2a, -hw, (top + 0.1) / 2, 0), bx(0.04, top + 0.1, 0.04, 0x6b4a2a, hw, (top + 0.1) / 2, 0), bx(w + 0.16, 0.03, 0.03, 0x4a3320, 0, top + 0.01, 0), bx(w + 0.16, 0.03, 0.03, 0x4a3320, 0, top - h - 0.01, 0)];
  return place(parts, x, y, z, ry);
}

