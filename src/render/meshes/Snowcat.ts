import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const part = (g: THREE.BufferGeometry, color: number, x: number, y: number, z: number): THREE.BufferGeometry => {
  const geo = g.index ? g.toNonIndexed() : g;
  geo.deleteAttribute('uv');
  geo.translate(x, y, z);
  const c = new THREE.Color(color), n = geo.getAttribute('position').count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
};
const box = (w: number, h: number, d: number, c: number, x: number, y: number, z: number): THREE.BufferGeometry => part(new THREE.BoxGeometry(w, h, d), c, x, y + h / 2, z);

/** Procedural low-poly snowcat (forward = +z, origin on the ground, ~0.9 tiles long): one merged, vertex-coloured geometry. */
export function createSnowcatGeometry(): THREE.BufferGeometry {
  const parts = [
    box(0.2, 0.14, 0.9, 0x222222, -0.24, 0, 0), box(0.2, 0.14, 0.9, 0x222222, 0.24, 0, 0), // tracks
    box(0.5, 0.2, 0.8, 0xd9453a, 0, 0.1, 0), // body
    box(0.4, 0.2, 0.32, 0x7fc4e8, 0, 0.3, 0.1), // cab
    box(0.46, 0.05, 0.12, 0xf2c14e, 0, 0.28, -0.4), // tiller bar
    box(0.62, 0.08, 0.1, 0xe8e8e8, 0, 0.1, 0.5), // blade
    box(0.1, 0.05, 0.1, 0xf2c14e, 0, 0.5, 0.1), // beacon
  ];
  const g = mergeGeometries(parts, false)!;
  g.computeVertexNormals();
  return g;
}

export const SNOWCAT_MAX = 32;

/** Instanced fleet: 1 draw call for bodies + 1 for headlight glows (night only). */
export class SnowcatFleet {
  readonly group = new THREE.Group();
  readonly bodies: THREE.InstancedMesh;
  readonly lights: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);
  private pos = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);

  constructor() {
    this.bodies = new THREE.InstancedMesh(createSnowcatGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), SNOWCAT_MAX);
    const glow = new THREE.PlaneGeometry(0.9, 1.6); glow.rotateX(-Math.PI / 2); glow.translate(0, 0.02, 1.45);
    this.lights = new THREE.InstancedMesh(glow, new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }), SNOWCAT_MAX);
    for (const mesh of [this.bodies, this.lights]) { mesh.count = 0; mesh.frustumCulled = false; this.group.add(mesh); }
    this.lights.renderOrder = 6;
  }

  /** Set instance i (world position, yaw radians about +y; forward = +z). */
  set(i: number, x: number, y: number, z: number, yaw: number): void {
    if (i >= SNOWCAT_MAX) return;
    this.q.setFromAxisAngle(this.up, yaw);
    this.m.compose(this.pos.set(x, y, z), this.q, this.one);
    this.bodies.setMatrixAt(i, this.m); this.lights.setMatrixAt(i, this.m);
  }
  commit(count: number, night: boolean): void {
    const n = Math.min(count, SNOWCAT_MAX);
    this.bodies.count = n; this.lights.count = night ? n : 0;
    this.bodies.instanceMatrix.needsUpdate = true; this.lights.instanceMatrix.needsUpdate = true;
  }
  dispose(): void {
    this.bodies.geometry.dispose(); (this.bodies.material as THREE.Material).dispose();
    this.lights.geometry.dispose(); (this.lights.material as THREE.Material).dispose();
  }
}
