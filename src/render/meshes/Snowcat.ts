import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { loft, type Palette } from './VehicleModels';

const pal = {
  body: [0.85, 0.27, 0.23] as Rgb3, glass: [0.5, 0.77, 0.91] as Rgb3, dark: [0.13, 0.13, 0.14] as Rgb3, rubber: [0.1, 0.1, 0.11] as Rgb3,
  trim: [0.2, 0.2, 0.22] as Rgb3, blade: [0.92, 0.92, 0.93] as Rgb3, amber: [0.95, 0.76, 0.3] as Rgb3, steel: [0.58, 0.6, 0.64] as Rgb3,
};
type Rgb3 = [number, number, number];
const paintG = (g: THREE.BufferGeometry, c: Rgb3): THREE.BufferGeometry => {
  const geo = g.index ? g.toNonIndexed() : g;
  geo.deleteAttribute('uv');
  const n = geo.getAttribute('position').count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2]; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
};
const bx = (w: number, h: number, d: number, c: Rgb3, x: number, y: number, z: number, rx = 0): THREE.BufferGeometry => {
  const g = new THREE.BoxGeometry(w, h, d); if (rx) g.rotateX(rx); g.translate(x, y, z); return paintG(g, c);
};
const cylX = (r: number, w: number, c: Rgb3, x: number, y: number, z: number, seg = 10): THREE.BufferGeometry => {
  const g = new THREE.CylinderGeometry(r, r, w, seg); g.rotateZ(Math.PI / 2); g.translate(x, y, z); return paintG(g, c);
};

/**
 * Procedural low-poly snowcat (forward = +z, origin on the ground, ~0.9 tiles long): one merged, vertex-coloured geometry (~380 triangles).
 * M8: lofted rounded body + glazed cab with a roof visor, tracks as rounded pods (sprocket / idler wheels + rubber cleats), a blade on two push
 * arms with a lifted lip, an amber light bar, beacon, exhaust stack and tiller. Same footprint / length as before.
 */
export function createSnowcatGeometry(): THREE.BufferGeometry {
  const P: Palette = { body: pal.body, glass: pal.glass, dark: pal.dark, trim: pal.trim };
  const body = loft([
    { z: -0.4, w: 0.2, y0: 0.12, y1: 0.28 }, { z: -0.33, w: 0.25, y0: 0.09, y1: 0.31 }, { z: 0.05, w: 0.26, y0: 0.09, y1: 0.3 },
    { z: 0.34, w: 0.24, y0: 0.1, y1: 0.26 }, { z: 0.42, w: 0.18, y0: 0.12, y1: 0.2 },
  ], [[0.8, 0, 'trim'], [1, 0.25, 'body'], [1, 0.7, 'body'], [0.8, 1, 'body']], P, 'body', 'body');
  const cab = loft([
    { z: -0.1, w: 0.17, y0: 0.29, y1: 0.4 }, { z: -0.07, w: 0.2, y0: 0.3, y1: 0.52 }, { z: 0.2, w: 0.2, y0: 0.3, y1: 0.5 }, { z: 0.27, w: 0.15, y0: 0.3, y1: 0.38 },
  ], [[0.92, 0, 'glass'], [1, 0.15, 'glass'], [1, 0.8, 'glass'], [0.85, 0.96, 'body'], [0.5, 1, 'body']], P, 'glass', 'glass');
  const parts: THREE.BufferGeometry[] = [body, cab];
  for (const sx of [-1, 1]) {
    const x = sx * 0.27;
    parts.push(bx(0.13, 0.12, 0.62, pal.rubber, x, 0.1, 0.0)); // belt run
    for (const z of [0.43, -0.43]) parts.push(cylX(0.1, 0.13, pal.rubber, x, 0.1, z, 8)); // sprocket / idler
    for (const z of [0.15, -0.15]) parts.push(cylX(0.05, 0.145, pal.steel, x, 0.1, z, 6)); // road wheels
    parts.push(bx(0.15, 0.03, 0.62, pal.trim, x, 0.205, 0.0)); // fender
  }
  parts.push(bx(0.1, 0.05, 0.1, pal.amber, 0, 0.55, 0.05)); // beacon
  parts.push(bx(0.34, 0.035, 0.1, pal.dark, 0, 0.52, 0.12)); // visor / roof
  parts.push(bx(0.3, 0.03, 0.04, pal.amber, 0, 0.545, 0.26)); // light bar
  const ex = new THREE.CylinderGeometry(0.018, 0.018, 0.14, 5); ex.translate(0.12, 0.42, -0.28); parts.push(paintG(ex, pal.dark));
  parts.push(bx(0.46, 0.04, 0.12, pal.amber, 0, 0.27, -0.4)); // tiller bar
  for (const sx of [-1, 1]) {
    parts.push(bx(0.025, 0.03, 0.2, pal.steel, sx * 0.17, 0.12, 0.55)); // blade arm
  }
  const bladeG = bx(0.66, 0.12, 0.05, pal.blade, 0, 0.13, 0.66, -0.18); parts.push(bladeG);
  parts.push(bx(0.66, 0.025, 0.07, pal.blade, 0, 0.2, 0.675, -0.5)); // curled lip
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
