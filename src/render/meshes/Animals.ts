import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { chamferBox } from './common';

const paint = (g: THREE.BufferGeometry, color: number, x: number, y: number, z: number): THREE.BufferGeometry => {
  const geo = g.index ? g.toNonIndexed() : g;
  geo.deleteAttribute('uv');
  geo.translate(x, y, z);
  const c = new THREE.Color(color), n = geo.getAttribute('position').count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
};
/** Soft box: chunky bevel (28 % of the smallest side) so bodies and limbs read rounder than plain cuboids; slivers < 0.04 stay plain boxes. */
const box = (w: number, h: number, d: number, c: number, x: number, y: number, z: number) => {
  const m = Math.min(w, h, d);
  return paint(m >= 0.04 ? chamferBox(w, h, d, m * 0.28) : new THREE.BoxGeometry(w, h, d), c, x, y + h / 2, z);
};


// ---- M8 (task 8.4): smooth primitives. Rounded ellipsoid bodies, tapered cylinder legs, cone ears / horns / beaks (all vertex-coloured, smooth normals) ----
interface Rot { rx?: number; ry?: number; rz?: number }
const place = (g: THREE.BufferGeometry, color: number, x: number, y: number, z: number, r: Rot): THREE.BufferGeometry => {
  if (r.rx) g.rotateX(r.rx);
  if (r.rz) g.rotateZ(r.rz);
  if (r.ry) g.rotateY(r.ry);
  return paint(g, color, x, y, z);
};
/** Ellipsoid (UV sphere ws x hs: 2 * ws * (hs - 1) triangles) centred at (x, y, z) with correct smooth normals; rotations are applied about the centre. */
const ell = (rx: number, ry: number, rz: number, color: number, x: number, y: number, z: number, r: Rot = {}, ws = 8, hs = 5): THREE.BufferGeometry => {
  const g = new THREE.SphereGeometry(1, ws, hs), p = g.getAttribute('position'), n = g.getAttribute('normal'), v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i) / rx, p.getY(i) / ry, p.getZ(i) / rz).normalize(); // gradient of the ellipsoid, taken before scaling
    n.setXYZ(i, v.x, v.y, v.z);
    p.setXYZ(i, p.getX(i) * rx, p.getY(i) * ry, p.getZ(i) * rz);
  }
  return place(g, color, x, y, z, r);
};
/** Tapered open cylinder (2 * seg triangles) standing on (x, y, z), height h, optionally tilted about x / z (legs, tails, antlers, ears, beaks). */
const tube = (rTop: number, rBot: number, h: number, color: number, x: number, y: number, z: number, r: Rot = {}, seg = 5): THREE.BufferGeometry =>
  place(new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, true).translate(0, h / 2, 0), color, x, y, z, r);
/** Cone (seg + seg triangles with the base cap) standing on (x, y, z). */
const cone = (rBot: number, h: number, color: number, x: number, y: number, z: number, r: Rot = {}, seg = 4): THREE.BufferGeometry =>
  place(new THREE.ConeGeometry(rBot, h, seg, 1, false).translate(0, h / 2, 0), color, x, y, z, r);
const keepNormals = (parts: THREE.BufferGeometry[]): THREE.BufferGeometry => mergeGeometries(parts, false)!;
interface Torso { L: number; H: number; W: number; legH: number; c: number; leg: number; legR?: number; belly?: number; rump?: number }
/** Chest + rump ellipsoids (the rump slightly smaller and lower: a tapered trunk, not a box) and four tapered legs (10 triangles each). */
const torso = (t: Torso): THREE.BufferGeometry[] => {
  const cy = t.legH + t.H * 0.5, lr = t.legR ?? 1, rump = t.rump ?? 0.9;
  const out = [ell(t.W / 2, t.H / 2, t.L * 0.33, t.c, 0, cy, t.L * 0.16, {}, 8, 4), ell(t.W / 2 * rump, t.H / 2 * rump, t.L * 0.32, t.c, 0, cy - t.H * 0.03, -t.L * 0.16, {}, 8, 4)];
  const dx = t.W / 2 * 0.62, dz = t.L / 2 - 0.07, top = t.legH + t.H * 0.35;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push(tube(0.036 * lr, 0.021 * lr, top, t.leg, sx * dx, 0, sz * dz, {}, 5));
  return out;
};

/** Low-poly bear (forward = +z, ~0.7 tiles long). */
export function createBearGeometry(): THREE.BufferGeometry {
  const brown = 0x7b4b2a, dark = 0x3a2416, snout = 0x9a6a44;
  return keepNormals([
    ell(0.15, 0.14, 0.2, brown, 0, 0.25, 0.08, {}, 8, 4), ell(0.14, 0.13, 0.17, brown, 0, 0.24, -0.14, {}, 8, 4), // shoulder hump + hindquarters
    ell(0.1, 0.1, 0.1, brown, 0, 0.3, 0.27, { rx: 0.25 }, 7, 4), ell(0.05, 0.045, 0.06, snout, 0, 0.27, 0.36, { rx: 0.2 }, 6, 3), cone(0.022, 0.03, dark, 0, 0.29, 0.415, { rx: Math.PI / 2 }, 4), // head, snout, nose
    ell(0.035, 0.035, 0.02, brown, 0.075, 0.39, 0.25, {}, 5, 3), ell(0.035, 0.035, 0.02, brown, -0.075, 0.39, 0.25, {}, 5, 3), // ears
    ...[[0.1, 0.17], [-0.1, 0.17], [0.1, -0.17], [-0.1, -0.17]].map(([x, z]) => tube(0.065, 0.045, 0.2, dark, x!, 0, z!, {}, 6)),
  ]);
}

/** Low-poly wolf (forward = +z, ~0.6 tiles long). */
export function createWolfGeometry(): THREE.BufferGeometry {
  const grey = 0x8a8f96, dark = 0x4a4e54;
  return keepNormals([
    ell(0.075, 0.09, 0.17, grey, 0, 0.2, 0.06, {}, 7, 4), ell(0.065, 0.08, 0.15, grey, 0, 0.19, -0.1, {}, 7, 4),
    ell(0.055, 0.055, 0.07, grey, 0, 0.28, 0.24, { rx: 0.3 }, 6, 4), ell(0.03, 0.028, 0.06, dark, 0, 0.26, 0.31, { rx: 0.2 }, 5, 3), // head, muzzle
    cone(0.02, 0.07, dark, 0.035, 0.31, 0.22, {}, 3), cone(0.02, 0.07, dark, -0.035, 0.31, 0.22, {}, 3), // ears
    tube(0.035, 0.012, 0.22, dark, 0, 0.2, -0.22, { rx: -2.0 }, 5), // low brush tail
    ...[[0.05, 0.12], [-0.05, 0.12], [0.05, -0.13], [-0.05, -0.13]].map(([x, z]) => tube(0.026, 0.015, 0.21, dark, x!, 0, z!, {}, 5)),
  ]);
}

export const ANIMAL_MAX = 32;

/** Ranger ATV with a rider in a green jacket (forward = +z, ~0.5 tiles long). */
export function createRangerAtvGeometry(): THREE.BufferGeometry {
  const parts = [
    box(0.26, 0.1, 0.46, 0x5a8f3a, 0, 0.1, 0), box(0.2, 0.05, 0.22, 0x2a2a2e, 0, 0.2, -0.06), box(0.28, 0.03, 0.04, 0x2a2a2e, 0, 0.3, 0.14),
    box(0.14, 0.2, 0.1, 0x2e6b3a, 0, 0.22, -0.06), box(0.08, 0.08, 0.08, 0xf0c8a0, 0, 0.42, -0.06), box(0.09, 0.04, 0.09, 0x2e6b3a, 0, 0.5, -0.06),
    box(0.1, 0.04, 0.04, 0xf08a24, 0, 0.58, -0.06),
    box(0.3, 0.1, 0.1, 0x8a8f96, 0, 0.12, -0.28),
  ];
  for (const sx of [-0.15, 0.15]) for (const sz of [-0.16, 0.16]) parts.push(box(0.07, 0.14, 0.14, 0x1a1a1a, sx, 0, sz));
  const g = mergeGeometries(parts, false)!;
  g.computeVertexNormals();
  return g;
}

/** Floating 'bear sighted' paw marker (flat, faces up): pad + four toes, readable above tree canopies. */
export function createPawMarkerGeometry(): THREE.BufferGeometry {
  const pad = 0x8a4b1e, ring = 0xfff1c9;
  const parts = [
    paint(new THREE.CylinderGeometry(0.34, 0.34, 0.03, 14), ring, 0, 0, 0),
    paint(new THREE.CylinderGeometry(0.2, 0.22, 0.05, 10), pad, 0, 0.02, 0.07),
    ...[[-0.2, -0.12], [-0.07, -0.2], [0.07, -0.2], [0.2, -0.12]].map(([x, z]) => paint(new THREE.CylinderGeometry(0.075, 0.075, 0.05, 8), pad, x!, 0.02, z! - 0.02)),
  ];
  return mergeGeometries(parts, false)!;
}

/** Instanced bears + wolves + ranger ATVs + paw markers (4 draw calls). */
export class AnimalHerd {
  readonly group = new THREE.Group();
  readonly bears: THREE.InstancedMesh;
  readonly wolves: THREE.InstancedMesh;
  readonly rangers: THREE.InstancedMesh;
  readonly paws: THREE.InstancedMesh;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private q2 = new THREE.Quaternion(); private up = new THREE.Vector3(0, 1, 0); private right = new THREE.Vector3(1, 0, 0);
  private p = new THREE.Vector3(); private sc = new THREE.Vector3(1, 1, 1);

  constructor() {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.bears = new THREE.InstancedMesh(createBearGeometry(), mat, ANIMAL_MAX);
    this.wolves = new THREE.InstancedMesh(createWolfGeometry(), mat, ANIMAL_MAX);
    this.rangers = new THREE.InstancedMesh(createRangerAtvGeometry(), mat, ANIMAL_MAX);
    this.paws = new THREE.InstancedMesh(createPawMarkerGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.92 }), ANIMAL_MAX);
    this.paws.renderOrder = 9;
    for (const m of [this.bears, this.wolves, this.rangers, this.paws]) { m.count = 0; m.frustumCulled = false; this.group.add(m); }
  }
  /** `pitch` > 0 lowers the head (foraging), `scale` enlarges the animal so it reads at the default zoom. */
  set(kind: 'bear' | 'wolf' | 'ranger', i: number, x: number, y: number, z: number, yaw: number, scale = 1.5, pitch = 0): void {
    if (i >= ANIMAL_MAX) return;
    this.q.setFromAxisAngle(this.up, yaw);
    if (pitch) this.q.multiply(this.q2.setFromAxisAngle(this.right, pitch));
    this.m.compose(this.p.set(x, y, z), this.q, this.sc.setScalar(scale));
    (kind === 'bear' ? this.bears : kind === 'wolf' ? this.wolves : this.rangers).setMatrixAt(i, this.m);
  }
  paw(i: number, x: number, y: number, z: number, spin: number, scale = 1): void {
    if (i >= ANIMAL_MAX) return;
    this.q.setFromAxisAngle(this.up, spin);
    this.m.compose(this.p.set(x, y, z), this.q, this.sc.setScalar(scale));
    this.paws.setMatrixAt(i, this.m);
  }
  commit(bears: number, wolves: number, rangers = 0, paws = 0): void {
    this.paws.count = Math.min(paws, ANIMAL_MAX); this.paws.instanceMatrix.needsUpdate = true;
    this.bears.count = Math.min(bears, ANIMAL_MAX); this.wolves.count = Math.min(wolves, ANIMAL_MAX); this.rangers.count = Math.min(rangers, ANIMAL_MAX);
    this.bears.instanceMatrix.needsUpdate = true; this.wolves.instanceMatrix.needsUpdate = true; this.rangers.instanceMatrix.needsUpdate = true;
  }
  dispose(): void { this.bears.geometry.dispose(); this.wolves.geometry.dispose(); this.rangers.geometry.dispose(); this.paws.geometry.dispose(); (this.bears.material as THREE.Material).dispose(); }
}

// ---------------------------------------------------------------- Nature (livestock + wild fauna), forward = +z

const finish = (parts: THREE.BufferGeometry[]): THREE.BufferGeometry => keepNormals(parts);

export function createCowGeometry(): THREE.BufferGeometry {
  const hide = 0xf2efe8, patch = 0x3a2c25, pink = 0xe8a8a0, horn = 0xe8d8a0;
  return finish([
    ...torso({ L: 0.52, H: 0.26, W: 0.2, legH: 0.12, c: hide, leg: 0x3a2c25 }),
    ell(0.1, 0.1, 0.12, patch, 0, 0.3, 0.04, {}, 6, 3), ell(0.08, 0.05, 0.09, patch, 0.02, 0.38, -0.2, {}, 5, 3), // coat patches
    ell(0.07, 0.07, 0.13, hide, 0, 0.35, 0.3, { rx: 0.9 }, 6, 4), // neck
    ell(0.06, 0.07, 0.085, hide, 0, 0.36, 0.38, { rx: 0.35 }, 6, 4), ell(0.045, 0.035, 0.035, pink, 0, 0.32, 0.45, {}, 5, 3), // head, muzzle
    cone(0.012, 0.045, horn, 0.05, 0.41, 0.37, { rz: -0.9 }, 3), cone(0.012, 0.045, horn, -0.05, 0.41, 0.37, { rz: 0.9 }, 3), // horns
    ell(0.04, 0.015, 0.025, hide, 0.075, 0.39, 0.35, { rz: -0.4 }, 4, 3), ell(0.04, 0.015, 0.025, hide, -0.075, 0.39, 0.35, { rz: 0.4 }, 4, 3), // ears
    tube(0.012, 0.008, 0.2, hide, 0, 0.38, -0.3, { rx: Math.PI - 0.12 }, 4), ell(0.02, 0.03, 0.02, patch, 0, 0.12, -0.31, {}, 4, 3), // tail + tuft
  ]);
}
export function createSheepGeometry(): THREE.BufferGeometry {
  const wool = 0xf4f1e8, face = 0x2b2b2b;
  return finish([
    ...torso({ L: 0.3, H: 0.2, W: 0.18, legH: 0.09, c: wool, leg: face, legR: 0.8 }),
    ell(0.07, 0.05, 0.08, wool, 0.02, 0.29, 0.0, {}, 6, 3), ell(0.06, 0.05, 0.07, wool, -0.03, 0.28, -0.11, {}, 6, 3), // fluffy lumps
    ell(0.04, 0.045, 0.06, face, 0, 0.25, 0.2, { rx: 0.4 }, 6, 4), ell(0.03, 0.02, 0.03, wool, 0, 0.3, 0.17, {}, 4, 3), // face, forelock
    ell(0.03, 0.012, 0.018, face, 0.05, 0.27, 0.185, { rz: -0.5 }, 4, 3), ell(0.03, 0.012, 0.018, face, -0.05, 0.27, 0.185, { rz: 0.5 }, 4, 3),
  ]);
}
export function createGoatGeometry(): THREE.BufferGeometry {
  const c = 0xd8c9ac, dk = 0x6b5a44;
  return finish([
    ...torso({ L: 0.3, H: 0.14, W: 0.12, legH: 0.12, c, leg: dk, legR: 0.8 }),
    ell(0.04, 0.07, 0.04, c, 0, 0.27, 0.15, { rx: 0.6 }, 6, 3), ell(0.035, 0.04, 0.06, c, 0, 0.3, 0.21, { rx: 0.5 }, 6, 4),
    tube(0.012, 0.004, 0.08, dk, 0.025, 0.31, 0.2, { rx: -0.5, rz: -0.25 }, 4), tube(0.012, 0.004, 0.08, dk, -0.025, 0.31, 0.2, { rx: -0.5, rz: 0.25 }, 4), // swept-back horns
    cone(0.012, 0.045, c, 0, 0.23, 0.245, { rx: Math.PI }, 3), tube(0.012, 0.006, 0.05, dk, 0, 0.2, -0.16, { rx: 0.9 }, 4), // beard, tail
  ]);
}
export function createDeerGeometry(): THREE.BufferGeometry {
  const c = 0x9a6b43, light = 0xe3cfae, ant = 0x6b5a44;
  const antler = (s: 1 | -1): THREE.BufferGeometry[] => [
    tube(0.01, 0.005, 0.12, ant, s * 0.03, 0.7, 0.26, { rx: -0.3, rz: -s * 0.35 }, 4),
    tube(0.008, 0.004, 0.07, ant, s * 0.065, 0.78, 0.23, { rx: -0.2, rz: s * 0.5 }, 4), tube(0.008, 0.004, 0.06, ant, s * 0.06, 0.74, 0.27, { rx: -0.9, rz: -s * 0.1 }, 4),
  ];
  return finish([
    ...torso({ L: 0.42, H: 0.19, W: 0.13, legH: 0.24, c, leg: 0x5a3a24, legR: 0.8 }),
    ell(0.045, 0.12, 0.05, c, 0, 0.5, 0.25, { rx: 0.45 }, 6, 4), ell(0.045, 0.045, 0.08, c, 0, 0.62, 0.3, { rx: 0.5 }, 6, 4), ell(0.022, 0.02, 0.03, 0x3a2a1c, 0, 0.6, 0.37, {}, 4, 3), // neck, head, nose
    ell(0.04, 0.012, 0.025, c, 0.05, 0.67, 0.25, { rz: -0.6 }, 4, 3), ell(0.04, 0.012, 0.025, c, -0.05, 0.67, 0.25, { rz: 0.6 }, 4, 3), // ears
    ...antler(1), ...antler(-1), ell(0.05, 0.05, 0.03, light, 0, 0.3, -0.25, {}, 5, 3),
  ]);
}
export function createIbexGeometry(): THREE.BufferGeometry {
  const c = 0x8c7a62, horn = 0x3a3226;
  return finish([
    ...torso({ L: 0.4, H: 0.18, W: 0.13, legH: 0.18, c, leg: 0x4e4234, legR: 0.85 }),
    ell(0.04, 0.09, 0.05, c, 0, 0.4, 0.22, { rx: 0.5 }, 6, 3), ell(0.04, 0.045, 0.07, c, 0, 0.5, 0.27, { rx: 0.5 }, 6, 4),
    tube(0.017, 0.006, 0.2, horn, 0.03, 0.52, 0.22, { rx: -1.0, rz: -0.18 }, 4), tube(0.017, 0.006, 0.2, horn, -0.03, 0.52, 0.22, { rx: -1.0, rz: 0.18 }, 4), // long swept horns
    cone(0.015, 0.05, 0x4e4234, 0, 0.44, 0.3, { rx: Math.PI }, 3),
  ]);
}
export function createChamoisGeometry(): THREE.BufferGeometry {
  const c = 0xa68a60;
  return finish([
    ...torso({ L: 0.34, H: 0.15, W: 0.11, legH: 0.15, c, leg: 0x5a4a30, legR: 0.8 }),
    ell(0.035, 0.08, 0.04, c, 0, 0.32, 0.18, { rx: 0.5 }, 6, 3), ell(0.035, 0.04, 0.06, 0xe6d9b8, 0, 0.4, 0.22, { rx: 0.5 }, 6, 4),
    tube(0.01, 0.005, 0.1, 0x2a2a2a, 0.025, 0.42, 0.2, { rx: -0.15, rz: -0.1 }, 4), tube(0.01, 0.005, 0.1, 0x2a2a2a, -0.025, 0.42, 0.2, { rx: -0.15, rz: 0.1 }, 4),
  ]);
}
export function createMarmotGeometry(): THREE.BufferGeometry {
  const c = 0x7b6a52, face = 0xb99d73, dk = 0x4e4234;
  return finish([
    ell(0.065, 0.06, 0.13, c, 0, 0.07, -0.01, {}, 7, 4), ell(0.045, 0.045, 0.05, face, 0, 0.1, 0.14, { rx: 0.2 }, 6, 4),
    ell(0.02, 0.015, 0.02, dk, 0, 0.09, 0.185, {}, 4, 3), ell(0.015, 0.015, 0.01, dk, 0.035, 0.145, 0.12, {}, 4, 3), ell(0.015, 0.015, 0.01, dk, -0.035, 0.145, 0.12, {}, 4, 3),
    tube(0.03, 0.02, 0.13, dk, 0, 0.06, -0.12, { rx: -1.35 }, 5), ell(0.018, 0.014, 0.025, dk, 0.04, 0.012, 0.06, {}, 4, 3), ell(0.018, 0.014, 0.025, dk, -0.04, 0.012, 0.06, {}, 4, 3),
  ]);
}
export function createFoxGeometry(): THREE.BufferGeometry {
  const c = 0xd0702a, dk = 0x2b1c10, wh = 0xf4f0e8;
  return finish([
    ...torso({ L: 0.28, H: 0.12, W: 0.1, legH: 0.1, c, leg: dk, legR: 0.7 }),
    ell(0.05, 0.05, 0.055, c, 0, 0.2, 0.17, { rx: 0.2 }, 6, 4), cone(0.03, 0.07, c, 0, 0.17, 0.215, { rx: Math.PI / 2 }, 5), ell(0.012, 0.012, 0.012, dk, 0, 0.18, 0.285, {}, 4, 3), // head, pointed snout, nose
    cone(0.02, 0.07, dk, 0.03, 0.235, 0.15, {}, 3), cone(0.02, 0.07, dk, -0.03, 0.235, 0.15, {}, 3), // ears
    ell(0.045, 0.045, 0.13, c, 0, 0.18, -0.22, { rx: 0.2 }, 6, 4), ell(0.035, 0.035, 0.05, wh, 0, 0.2, -0.34, { rx: 0.2 }, 5, 3), // bushy tail + white tip
  ]);
}
export function createEagleGeometry(): THREE.BufferGeometry {
  const c = 0x3b2c1e, dk = 0x261b11;
  return finish([
    ell(0.045, 0.04, 0.15, c, 0, 0, 0, {}, 7, 4), ell(0.035, 0.035, 0.04, 0xf1e9d8, 0, 0.02, 0.17, {}, 6, 3), cone(0.013, 0.05, 0xe0b030, 0, 0.012, 0.19, { rx: Math.PI / 2 }, 3),
    ell(0.22, 0.01, 0.1, c, 0.2, 0.035, 0.02, { rz: 0.1 }, 6, 3), ell(0.22, 0.01, 0.1, c, -0.2, 0.035, 0.02, { rz: -0.1 }, 6, 3), // wings, a shallow dihedral
    ell(0.07, 0.01, 0.07, dk, 0, 0.02, -0.17, {}, 5, 3), // fanned tail
  ]);
}

/** Petting-zoo rabbit (forward = +z, ~0.2 tiles long): round body, head with long upright ears, cotton tail. Not a nature species: only the zoo view draws it. */
export function createRabbitGeometry(): THREE.BufferGeometry {
  const fur = 0xcbb79a, light = 0xf3ece0, dk = 0x3a2c25;
  return finish([
    ell(0.05, 0.055, 0.08, fur, 0, 0.065, -0.01, {}, 7, 4), ell(0.04, 0.04, 0.045, fur, 0, 0.1, 0.1, {}, 6, 4),
    ell(0.014, 0.06, 0.012, fur, 0.022, 0.2, 0.09, { rz: -0.12 }, 4, 3), ell(0.014, 0.06, 0.012, fur, -0.022, 0.2, 0.09, { rz: 0.12 }, 4, 3),
    ell(0.025, 0.025, 0.025, light, 0, 0.07, -0.095, {}, 5, 3), ell(0.01, 0.01, 0.008, dk, 0.025, 0.115, 0.135, {}, 4, 3), ell(0.01, 0.01, 0.008, dk, -0.025, 0.115, 0.135, {}, 4, 3),
    ell(0.02, 0.025, 0.045, fur, 0.04, 0.03, -0.03, {}, 4, 3), ell(0.02, 0.025, 0.045, fur, -0.04, 0.03, -0.03, {}, 4, 3),
  ]);
}
/** Petting-zoo donkey (forward = +z, ~0.5 tiles long): grey body, long head with big ears, pale muzzle and belly, tufted tail. */
export function createDonkeyGeometry(): THREE.BufferGeometry {
  const c = 0x8e8a84, light = 0xd8d2c6, dark = 0x4a4540;
  return finish([
    ...torso({ L: 0.42, H: 0.2, W: 0.14, legH: 0.2, c, leg: dark, legR: 0.9 }),
    ell(0.05, 0.12, 0.055, c, 0, 0.4, 0.23, { rx: 0.5 }, 6, 4), ell(0.045, 0.05, 0.095, c, 0, 0.52, 0.31, { rx: 0.6 }, 6, 4), ell(0.04, 0.035, 0.04, light, 0, 0.49, 0.39, {}, 5, 3),
    ell(0.02, 0.085, 0.014, c, 0.04, 0.6, 0.26, { rz: -0.25 }, 4, 3), ell(0.02, 0.085, 0.014, c, -0.04, 0.6, 0.26, { rz: 0.25 }, 4, 3), // big ears
    ell(0.06, 0.04, 0.15, light, 0, 0.21, 0, {}, 6, 3), ell(0.012, 0.045, 0.1, dark, 0, 0.53, 0.2, { rx: 0.5 }, 4, 3), // belly, mane
    tube(0.015, 0.01, 0.15, dark, 0, 0.31, -0.24, { rx: 0.2 }, 4), ell(0.02, 0.03, 0.02, dark, 0, 0.17, -0.26, {}, 4, 3),
  ]);
}

export type NatureSpecies = 'cow' | 'sheep' | 'goat' | 'deer' | 'ibex' | 'chamois' | 'marmot' | 'fox' | 'eagle';
export const NATURE_GEOMETRY: Record<NatureSpecies, () => THREE.BufferGeometry> = {
  cow: createCowGeometry, sheep: createSheepGeometry, goat: createGoatGeometry, deer: createDeerGeometry, ibex: createIbexGeometry,
  chamois: createChamoisGeometry, marmot: createMarmotGeometry, fox: createFoxGeometry, eagle: createEagleGeometry,
};

/** Almabtrieb cow (M5.4 Task 21): the plain cow with a flower headdress (wreath + bouquet + ribbons) and a bell on a red strap. Not a nature species: only the festival procession uses it. */
export function createDecoratedCowGeometry(): THREE.BufferGeometry {
  const flowers = [0xd9453a, 0xf2c14e, 0xfafafa, 0xf06292, 0x8e5bd0];
  const parts: THREE.BufferGeometry[] = [createCowGeometry(),
    box(0.2, 0.035, 0.2, 0x3f7d33, 0, 0.45, 0.36), // leaf base on the head
    box(0.1, 0.12, 0.1, 0xf2c14e, 0, 0.48, 0.36), box(0.06, 0.1, 0.06, 0xd9453a, 0, 0.6, 0.36), // bouquet
    box(0.04, 0.2, 0.03, 0xd9453a, 0.11, 0.26, 0.36), box(0.04, 0.2, 0.03, 0x4f86a8, -0.11, 0.26, 0.36), // ribbons
    box(0.14, 0.04, 0.06, 0xa83a30, 0, 0.3, 0.34), box(0.07, 0.08, 0.06, 0xe8b830, 0, 0.2, 0.36), // strap + bell
  ];
  flowers.forEach((c, i) => { const a = (i / flowers.length) * Math.PI * 2; parts.push(box(0.05, 0.05, 0.05, c, Math.cos(a) * 0.11, 0.46, 0.36 + Math.sin(a) * 0.11)); });
  return finish(parts);
}

/** Carnival reveller (about 0.5 tiles tall): harlequin costume, ruff and a tall pointed hat (forward = +z). */
export function createCostumeFigureGeometry(): THREE.BufferGeometry {
  // M8 lane D: tapered legs and arms, an egg-shaped torso in two colours, a round head, a flared ruff and a curved pointed hat (cone + brim), instead of stacked boxes
  return finish([
    tube(0.033, 0.026, 0.22, 0xd9453a, -0.04, 0, 0, {}, 6), tube(0.033, 0.026, 0.22, 0xf2c14e, 0.04, 0, 0, {}, 6), // legs, one of each colour
    ell(0.05, 0.03, 0.065, 0x1b1b1b, -0.04, 0.02, 0.02, {}, 6, 3), ell(0.05, 0.03, 0.065, 0x1b1b1b, 0.04, 0.02, 0.02, {}, 6, 3), // shoes
    ell(0.105, 0.13, 0.075, 0x8e5bd0, 0, 0.33, 0, {}, 10, 6), ell(0.055, 0.115, 0.08, 0x2ba6a0, 0.055, 0.33, 0.004, {}, 8, 5), // torso (half teal)
    tube(0.026, 0.021, 0.19, 0xf2c14e, -0.13, 0.2, 0, { rz: -0.35 }, 6), tube(0.026, 0.021, 0.19, 0xd9453a, 0.13, 0.2, 0, { rz: 0.35 }, 6), // arms
    tube(0.12, 0.075, 0.05, 0xf4efe2, 0, 0.42, 0, {}, 10), // flared ruff
    ell(0.065, 0.07, 0.065, 0xf0c8a0, 0, 0.51, 0, {}, 10, 6), // head
    ell(0.07, 0.045, 0.02, 0x8a5a2e, 0, 0.52, 0.062, {}, 8, 4), cone(0.018, 0.07, 0x6a3f1e, 0, 0.49, 0.095, { rx: Math.PI / 2 }, 5), // Carnival (M7.4): wooden mask with a long nose
    tube(0.015, 0.035, 0.12, 0xd9b44a, 0.1, 0.36, 0.13, { rx: Math.PI / 2 }, 6), tube(0.05, 0.015, 0.05, 0xd9b44a, 0.1, 0.36, 0.25, { rx: Math.PI / 2 }, 8), // a small brass horn (the band): tube + bell
    tube(0.1, 0.1, 0.02, 0xd9453a, 0, 0.56, 0, {}, 12), // hat brim
    cone(0.075, 0.2, 0xd9453a, 0, 0.57, 0, { rx: -0.12 }, 10), ell(0.022, 0.022, 0.022, 0xf2c14e, 0, 0.78, -0.025, {}, 6, 3), // curved pointed hat + bobble
  ]);
}

/** World Cup racer in a tuck (forward = +z): coloured suit, helmet, two skis and poles. */
export function createRacerGeometry(): THREE.BufferGeometry {
  // M8 lane D: rounded tuck (ellipsoid torso and thighs, tapered shins), a round helmet with a goggle strap, tapered skis with upturned tips, poles tucked under the arms
  const ski = (x: number): THREE.BufferGeometry[] => [
    box(0.07, 0.02, 0.46, 0x1b1b1b, x, 0, -0.02), // ski body
    ell(0.034, 0.014, 0.05, 0x1b1b1b, x, 0.022, 0.25, { rx: -0.35 }, 6, 3), // upturned tip
  ];
  return finish([
    ...ski(-0.06), ...ski(0.06),
    tube(0.03, 0.04, 0.15, 0x2a5fb0, -0.05, 0.02, -0.04, { rx: -0.9 }, 6), tube(0.03, 0.04, 0.15, 0x2a5fb0, 0.05, 0.02, -0.04, { rx: -0.9 }, 6), // shins
    ell(0.06, 0.05, 0.1, 0x2a5fb0, 0, 0.13, -0.05, {}, 8, 4), // thighs
    ell(0.085, 0.07, 0.12, 0xe8453c, 0, 0.19, 0.04, { rx: 0.25 }, 10, 5), // tucked torso (egg)
    ell(0.05, 0.05, 0.05, 0xf4efe2, 0, 0.26, 0.15, {}, 8, 5), box(0.07, 0.025, 0.02, 0x1b1b1b, 0, 0.265, 0.195), // helmet + goggles
    tube(0.012, 0.012, 0.3, 0x888888, -0.1, 0.12, 0.05, { rx: Math.PI / 2 + 0.1 }, 5), tube(0.012, 0.012, 0.3, 0x888888, 0.1, 0.12, 0.05, { rx: Math.PI / 2 + 0.1 }, 5), // poles
  ]);
}
