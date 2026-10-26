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

/** Low-poly bear (forward = +z, ~0.7 tiles long). */
export function createBearGeometry(): THREE.BufferGeometry {
  const brown = 0x7b4b2a, dark = 0x3a2416;
  const g = mergeGeometries([
    box(0.3, 0.26, 0.5, brown, 0, 0.14, 0), box(0.22, 0.2, 0.2, brown, 0, 0.26, 0.3), box(0.1, 0.08, 0.1, dark, 0, 0.28, 0.42),
    box(0.07, 0.07, 0.05, brown, 0.08, 0.46, 0.28), box(0.07, 0.07, 0.05, brown, -0.08, 0.46, 0.28),
    box(0.09, 0.16, 0.09, dark, 0.11, 0, 0.17), box(0.09, 0.16, 0.09, dark, -0.11, 0, 0.17), box(0.09, 0.16, 0.09, dark, 0.11, 0, -0.17), box(0.09, 0.16, 0.09, dark, -0.11, 0, -0.17),
  ], false)!;
  g.computeVertexNormals();
  return g;
}

/** Low-poly wolf (forward = +z, ~0.6 tiles long). */
export function createWolfGeometry(): THREE.BufferGeometry {
  const grey = 0x8a8f96, dark = 0x4a4e54;
  const g = mergeGeometries([
    box(0.16, 0.16, 0.4, grey, 0, 0.15, 0), box(0.13, 0.13, 0.16, grey, 0, 0.22, 0.26), box(0.06, 0.05, 0.1, dark, 0, 0.23, 0.38),
    box(0.04, 0.07, 0.04, dark, 0.05, 0.34, 0.24), box(0.04, 0.07, 0.04, dark, -0.05, 0.34, 0.24), box(0.05, 0.05, 0.22, dark, 0, 0.2, -0.3),
    box(0.05, 0.15, 0.05, dark, 0.06, 0, 0.13), box(0.05, 0.15, 0.05, dark, -0.06, 0, 0.13), box(0.05, 0.15, 0.05, dark, 0.06, 0, -0.13), box(0.05, 0.15, 0.05, dark, -0.06, 0, -0.13),
  ], false)!;
  g.computeVertexNormals();
  return g;
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

const quad = (bodyL: number, bodyH: number, bodyW: number, legH: number, color: number, leg: number, z0 = 0): THREE.BufferGeometry[] => {
  const out: THREE.BufferGeometry[] = [box(bodyW, bodyH, bodyL, color, 0, legH, z0)];
  const dx = bodyW / 2 - 0.03, dz = bodyL / 2 - 0.05;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push(box(0.06, legH, 0.06, leg, sx * dx, 0, z0 + sz * dz));
  return out;
};
const finish = (parts: THREE.BufferGeometry[]): THREE.BufferGeometry => { const g = mergeGeometries(parts, false)!; g.computeVertexNormals(); return g; };

export function createCowGeometry(): THREE.BufferGeometry {
  const hide = 0xf2efe8, patch = 0x3a2c25, pink = 0xe8a8a0;
  return finish([
    ...quad(0.5, 0.26, 0.2, 0.14, hide, 0x3a2c25),
    box(0.1, 0.1, 0.1, hide, 0, 0.38, 0.3), box(0.07, 0.05, 0.05, pink, 0, 0.36, 0.38),
    box(0.03, 0.05, 0.03, 0xe8d8a0, 0.05, 0.47, 0.3), box(0.03, 0.05, 0.03, 0xe8d8a0, -0.05, 0.47, 0.3),
    box(0.21, 0.12, 0.18, patch, 0, 0.3, 0.02), box(0.04, 0.2, 0.04, hide, 0, 0.18, -0.27),
  ]);
}
export function createSheepGeometry(): THREE.BufferGeometry {
  return finish([...quad(0.3, 0.2, 0.18, 0.1, 0xf4f1e8, 0x2b2b2b), box(0.09, 0.09, 0.1, 0x2b2b2b, 0, 0.26, 0.2)]);
}
export function createGoatGeometry(): THREE.BufferGeometry {
  return finish([
    ...quad(0.3, 0.14, 0.12, 0.12, 0xd8c9ac, 0x6b5a44), box(0.07, 0.09, 0.09, 0xd8c9ac, 0, 0.28, 0.2),
    box(0.02, 0.07, 0.02, 0x6b5a44, 0.03, 0.37, 0.19), box(0.02, 0.07, 0.02, 0x6b5a44, -0.03, 0.37, 0.19), box(0.03, 0.05, 0.03, 0xd8c9ac, 0, 0.22, 0.26),
  ]);
}
export function createDeerGeometry(): THREE.BufferGeometry {
  const c = 0x9a6b43, light = 0xe3cfae;
  return finish([
    ...quad(0.42, 0.2, 0.14, 0.24, c, 0x5a3a24), box(0.06, 0.22, 0.08, c, 0, 0.4, 0.22), box(0.08, 0.08, 0.14, c, 0, 0.6, 0.27),
    box(0.02, 0.14, 0.02, 0x6b5a44, 0.04, 0.68, 0.24), box(0.02, 0.14, 0.02, 0x6b5a44, -0.04, 0.68, 0.24),
    box(0.1, 0.01, 0.02, 0x6b5a44, 0.07, 0.76, 0.24), box(0.1, 0.01, 0.02, 0x6b5a44, -0.07, 0.76, 0.24), box(0.12, 0.1, 0.03, light, 0, 0.3, -0.22),
  ]);
}
export function createIbexGeometry(): THREE.BufferGeometry {
  const c = 0x8c7a62;
  return finish([
    ...quad(0.4, 0.18, 0.13, 0.2, c, 0x4e4234), box(0.06, 0.16, 0.08, c, 0, 0.34, 0.2), box(0.08, 0.08, 0.12, c, 0, 0.5, 0.25),
    box(0.03, 0.04, 0.03, 0x3a3226, 0.035, 0.57, 0.22), box(0.03, 0.04, 0.03, 0x3a3226, -0.035, 0.57, 0.22),
    box(0.03, 0.03, 0.18, 0x3a3226, 0.04, 0.6, 0.12), box(0.03, 0.03, 0.18, 0x3a3226, -0.04, 0.6, 0.12), box(0.05, 0.07, 0.03, 0x4e4234, 0, 0.44, 0.3),
  ]);
}
export function createChamoisGeometry(): THREE.BufferGeometry {
  const c = 0xa68a60;
  return finish([
    ...quad(0.34, 0.15, 0.11, 0.17, c, 0x5a4a30), box(0.05, 0.14, 0.07, c, 0, 0.3, 0.18), box(0.07, 0.07, 0.1, 0xe6d9b8, 0, 0.42, 0.22),
    box(0.015, 0.1, 0.015, 0x2a2a2a, 0.03, 0.47, 0.2), box(0.015, 0.1, 0.015, 0x2a2a2a, -0.03, 0.47, 0.2),
  ]);
}
export function createMarmotGeometry(): THREE.BufferGeometry {
  const c = 0x7b6a52;
  return finish([box(0.12, 0.1, 0.24, c, 0, 0.03, 0), box(0.09, 0.09, 0.09, 0xb99d73, 0, 0.08, 0.16), box(0.03, 0.03, 0.03, 0x4e4234, 0.04, 0.17, 0.15), box(0.03, 0.03, 0.03, 0x4e4234, -0.04, 0.17, 0.15), box(0.05, 0.04, 0.14, 0x4e4234, 0, 0.05, -0.2)]);
}
export function createFoxGeometry(): THREE.BufferGeometry {
  const c = 0xd0702a;
  return finish([
    ...quad(0.28, 0.12, 0.1, 0.1, c, 0x2b1c10), box(0.09, 0.09, 0.1, c, 0, 0.2, 0.19), box(0.05, 0.04, 0.06, 0xf4f0e8, 0, 0.19, 0.27),
    box(0.03, 0.05, 0.03, 0x2b1c10, 0.03, 0.29, 0.17), box(0.03, 0.05, 0.03, 0x2b1c10, -0.03, 0.29, 0.17), box(0.07, 0.07, 0.24, c, 0, 0.18, -0.26), box(0.06, 0.06, 0.06, 0xf4f0e8, 0, 0.18, -0.4),
  ]);
}
export function createEagleGeometry(): THREE.BufferGeometry {
  const c = 0x3b2c1e;
  return finish([box(0.09, 0.07, 0.3, c, 0, 0, 0), box(0.07, 0.07, 0.07, 0xf1e9d8, 0, 0.02, 0.2), box(0.03, 0.03, 0.05, 0xe0b030, 0, 0.03, 0.26), box(0.9, 0.015, 0.2, c, 0, 0.04, 0.02), box(0.08, 0.015, 0.14, c, 0, 0.03, -0.2)]);
}

export type NatureSpecies = 'cow' | 'sheep' | 'goat' | 'deer' | 'ibex' | 'chamois' | 'marmot' | 'fox' | 'eagle';
export const NATURE_GEOMETRY: Record<NatureSpecies, () => THREE.BufferGeometry> = {
  cow: createCowGeometry, sheep: createSheepGeometry, goat: createGoatGeometry, deer: createDeerGeometry, ibex: createIbexGeometry,
  chamois: createChamoisGeometry, marmot: createMarmotGeometry, fox: createFoxGeometry, eagle: createEagleGeometry,
};
