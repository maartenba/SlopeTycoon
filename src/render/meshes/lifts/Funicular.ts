import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { C, PartBuilder } from '../common';
import { STRAND_OFFSET, samplePath, type CablePath } from '../../../sim/Lift';
import { finishGeometry } from './geo';

/**
 * Funicular car: origin on the track (pitched by the instance). Three stepped compartments (each floor lower than the previous,
 * so the floors are level on the slope), window bands, a headlamp pair and roof lights.
 */
export function buildFunicularCarGeometry(near = false): THREE.BufferGeometry {
  const b = new PartBuilder(1, 1);
  const GLASS = 0xcfe4f4;
  b.box(0, 0.02, 0, 0.8, 0.07, 1.7, C.dark); // underframe
  for (const z of [-0.65, 0.65]) for (const x of [-0.3, 0.3]) b.cyl(x, 0.0, z, 0.06, 0.06, C.black, 'wood', 6, { rz: Math.PI / 2 });
  for (let i = 0; i < 3; i++) { // stepped compartments: front is lower (carries the downhill end), back is higher
    const z = -0.55 + i * 0.55, step = (2 - i) * 0.06;
    b.box(0, 0.09 + step, z, 0.88, 0.42, 0.52, i === 1 ? C.roofGreen : C.green);
    b.box(0, 0.51 + step, z, 0.92, 0.05, 0.56, C.cream, 'roof'); // roof
    b.box(0, 0.09 + step, z, 0.92, 0.05, 0.56, C.dark); // skirt
    for (const s of [-1, 1]) {
      b.box(s * 0.445, 0.22 + step, z, 0.02, 0.2, 0.4, GLASS, 'glass');
      b.box(s * 0.452, 0.21 + step, z, 0.02, 0.24, 0.04, C.dark); // door line
    }
    b.box(0, 0.56 + step, z, 0.12, 0.05, 0.12, C.glass); // roof light
  }
  // end faces: windscreens + headlamps
  b.box(0, 0.24, 0.84, 0.64, 0.2, 0.02, GLASS, 'glass');
  b.box(0, 0.24, -0.84, 0.64, 0.2, 0.02, GLASS, 'glass');
  for (const x of [-0.3, 0.3]) { b.box(x, 0.13, 0.86, 0.1, 0.07, 0.03, C.yellow, 'roof'); b.box(x, 0.13, -0.86, 0.1, 0.07, 0.03, C.red, 'roof'); }
  if (near) { // interior per compartment: stepped floor, two benches, handrail
    for (let i = 0; i < 3; i++) {
      const z = -0.55 + i * 0.55, step = (2 - i) * 0.06;
      b.box(0, 0.13 + step, z, 0.84, 0.012, 0.5, 0x6b6f76);
      for (const s of [-1, 1]) { b.box(s * 0.3, 0.17 + step, z, 0.14, 0.03, 0.44, C.dark); b.box(s * 0.38, 0.2 + step, z, 0.025, 0.14, 0.44, C.dark); }
      b.box(0, 0.43 + step, z, 0.02, 0.02, 0.46, C.grey, 'stone');
    }
  }
  const g = finishGeometry(b);
  g.userData.meshInfo = { family: 'funicular', seats: 60, bubble: true, cabinSize: 60, near };
  return g;
}

/** Rails + sleepers along the path (vertex-coloured). */
export function buildTrackGeometry(path: CablePath): THREE.BufferGeometry {
  const b = new PartBuilder(1, 1);
  const n = path.pts.length;
  for (let i = 0; i < n; i++) {
    const s = samplePath(path, path.cum[i]!);
    const next = samplePath(path, Math.min(path.length, path.cum[i]! + 0.01));
    void next;
    b.box(s.x, s.y - 0.06, s.z, 1.0, 0.05, 0.12, C.dark, 'wood', { ry: s.yaw });
  }
  const rails: THREE.BufferGeometry[] = [];
  for (const lat of [STRAND_OFFSET, -STRAND_OFFSET]) {
    for (let i = 1; i < n; i++) {
      const p = samplePath(path, path.cum[i - 1]!, lat), q = samplePath(path, path.cum[i]!, lat);
      const len = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
      if (len < 1e-6) continue;
      const g = new THREE.BoxGeometry(0.05, 0.05, len);
      const m = new THREE.Matrix4().lookAt(new THREE.Vector3(p.x, p.y, p.z), new THREE.Vector3(q.x, q.y, q.z), new THREE.Vector3(0, 1, 0));
      g.applyMatrix4(m.setPosition((p.x + q.x) / 2, (p.y + q.y) / 2 - 0.02, (p.z + q.z) / 2));
      const col = new THREE.Color(C.grey);
      const arr = new Float32Array(g.getAttribute('position').count * 3);
      for (let k = 0; k < arr.length; k += 3) { arr[k] = col.r; arr[k + 1] = col.g; arr[k + 2] = col.b; }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      rails.push(g);
    }
  }
  const base = finishGeometry(b);
  return mergeGeometries([base, ...rails.map((g) => g.toNonIndexed())], false) ?? base;
}
