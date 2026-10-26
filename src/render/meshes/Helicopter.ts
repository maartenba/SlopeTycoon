import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const paint = (g: THREE.BufferGeometry, color: number, x: number, y: number, z: number): THREE.BufferGeometry => {
  const geo = g.index ? g.toNonIndexed() : g;
  geo.deleteAttribute('uv');
  geo.translate(x, y, z);
  const c = new THREE.Color(color), n = geo.getAttribute('position').count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
};
const box = (w: number, h: number, d: number, c: number, x: number, y: number, z: number) => paint(new THREE.BoxGeometry(w, h, d), c, x, y, z);

/** Low-poly rescue helicopter (forward = +z, ~1.6 tiles long) with a separately spinning rotor. NOT verified at runtime (no WebGL). */
export class HelicopterMesh {
  readonly group = new THREE.Group();
  private rotor: THREE.Mesh;
  private tail: THREE.Mesh;

  constructor() {
    const body = mergeGeometries([
      box(0.55, 0.45, 1.0, 0xd9302c, 0, 0.45, 0), box(0.5, 0.3, 0.38, 0x8fd3f0, 0, 0.55, 0.45), box(0.12, 0.12, 0.9, 0xd9302c, 0, 0.55, -0.85),
      box(0.05, 0.3, 0.14, 0xe8e8e8, 0, 0.7, -1.28), box(0.7, 0.04, 0.05, 0x333333, 0, 0.12, 0.2), box(0.7, 0.04, 0.05, 0x333333, 0, 0.12, -0.2),
      box(0.06, 0.3, 0.06, 0x333333, 0.3, 0.27, 0), box(0.06, 0.3, 0.06, 0x333333, -0.3, 0.27, 0),
    ], false)!;
    body.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.group.add(new THREE.Mesh(body, mat));
    const rg = mergeGeometries([box(2.0, 0.025, 0.1, 0x222222, 0, 0, 0), box(0.1, 0.025, 2.0, 0x222222, 0, 0, 0)], false)!;
    this.rotor = new THREE.Mesh(rg, mat); this.rotor.position.y = 0.86;
    const tg = box(0.03, 0.4, 0.04, 0x222222, 0, 0, 0);
    this.tail = new THREE.Mesh(tg, mat); this.tail.position.set(0.04, 0.7, -1.28);
    this.group.add(this.rotor, this.tail);
    this.group.visible = false;
  }

  /** Place (x, z = tile coords; y = altitude), yaw about +y; `spin` = rotor phase in radians. */
  set(x: number, y: number, z: number, yaw: number, spin: number): void {
    this.group.position.set(x, y, z); this.group.rotation.y = yaw; this.rotor.rotation.y = spin; this.tail.rotation.x = spin * 2;
  }
  dispose(): void {
    this.group.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
  }
}
