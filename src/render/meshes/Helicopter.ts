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
    // M8: an ellipsoid cabin + glass bubble, a tapered tail boom, round skids on struts, an engine hump and a rotor mast (was a stack of boxes)
    const ell = (rx: number, ry: number, rz: number, c: number, x: number, y: number, z: number, seg = 10, rings = 7): THREE.BufferGeometry => paint(new THREE.SphereGeometry(1, seg, rings).scale(rx, ry, rz), c, x, y, z);
    const cyl = (rt: number, rb: number, len: number, c: number, x: number, y: number, z: number, rx = 0, rz = 0, seg = 8): THREE.BufferGeometry => paint(new THREE.CylinderGeometry(rt, rb, len, seg).rotateX(rx).rotateZ(rz), c, x, y, z);
    const boom = new THREE.CylinderGeometry(0.03, 0.09, 0.95, 8).rotateX(Math.PI / 2); // narrow end (+z of the cylinder top) towards the tail
    boom.rotateY(Math.PI);
    const body = mergeGeometries([
      ell(0.3, 0.27, 0.55, 0xd9302c, 0, 0.5, 0.05, 12, 8), ell(0.25, 0.2, 0.3, 0x8fd3f0, 0, 0.55, 0.38, 10, 7), // cabin + canopy
      paint(boom, 0xd9302c, 0, 0.58, -0.85), ell(0.13, 0.08, 0.22, 0xb52420, 0, 0.74, -0.1, 8, 5), // tail boom + engine hump
      box(0.05, 0.3, 0.14, 0xe8e8e8, 0, 0.72, -1.28), box(0.3, 0.025, 0.06, 0xe8e8e8, 0, 0.62, -1.15), // tail fin + stabiliser
      cyl(0.015, 0.015, 0.7, 0x333333, 0.32, 0.12, 0.15, Math.PI / 2, 0, 6), cyl(0.015, 0.015, 0.7, 0x333333, -0.32, 0.12, 0.15, Math.PI / 2, 0, 6), // skid tubes
      cyl(0.013, 0.013, 0.26, 0x333333, 0.3, 0.24, 0.35), cyl(0.013, 0.013, 0.26, 0x333333, -0.3, 0.24, 0.35), cyl(0.013, 0.013, 0.26, 0x333333, 0.3, 0.24, -0.1), cyl(0.013, 0.013, 0.26, 0x333333, -0.3, 0.24, -0.1),
      cyl(0.025, 0.025, 0.12, 0x222222, 0, 0.8, -0.1), box(0.1, 0.02, 0.1, 0x222222, 0, 0.84, -0.1),
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
