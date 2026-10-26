import type * as THREE from 'three';
import { C, PartBuilder } from '../common';
import { finishGeometry } from './geo';

/**
 * Cable-car cabin (large, hangs from a four-wheel carriage on the track cable; total drop < 1 so it clears the ground at a station):
 * door and window frames on both sides, panoramic windows, roof rail.
 */
export function buildTramGeometry(near = false): THREE.BufferGeometry {
  const b = new PartBuilder(1, 1);
  b.box(0, -0.2, 0, 0.5, 0.2, 0.5, C.grey, 'stone'); // carriage
  for (const z of [-0.18, 0.18]) for (const x of [-0.18, 0.18]) b.cyl(x, -0.05, z, 0.06, 0.05, C.black, 'wood', 6, { rz: Math.PI / 2 });
  b.box(0, -0.48, 0, 0.08, 0.28, 0.08, C.dark); // suspension
  b.box(0, -0.5, 0, 0.5, 0.04, 0.9, C.dark);
  b.box(0, -0.93, 0, 0.74, 0.43, 1.2, C.yellow); // body
  b.box(0, -0.52, 0, 0.78, 0.07, 1.28, C.red, 'roof'); // roof
  b.box(0, -0.96, 0, 0.78, 0.05, 1.28, C.red, 'roof'); // skirt
  for (const s of [-1, 1]) {
    const x = s * 0.375;
    b.box(x, -0.82, 0, 0.02, 0.25, 1.0, 0xcfe4f4, 'glass'); // window band
    for (const z of [-0.5, -0.17, 0.17, 0.5]) b.box(x + s * 0.005, -0.84, z, 0.02, 0.28, 0.04, C.dark); // mullions
    b.box(x + s * 0.005, -0.91, 0, 0.025, 0.36, 0.32, C.dark); // door
    b.box(x + s * 0.006, -0.88, 0, 0.026, 0.25, 0.02, C.yellow);
  }
  b.box(0, -0.82, 0.605, 0.62, 0.25, 0.02, 0xcfe4f4, 'glass'); b.box(0, -0.82, -0.605, 0.62, 0.25, 0.02, 0xcfe4f4, 'glass');
  b.box(0, -0.45, 0, 0.04, 0.04, 1.1, C.dark); // roof rail
  if (near) { // interior: floor, perimeter benches, central pole + straps rail
    b.box(0, -0.9, 0, 0.7, 0.012, 1.16, 0x6b6f76);
    for (const s of [-1, 1]) { b.box(s * 0.3, -0.84, 0, 0.1, 0.03, 1.0, C.dark); b.box(s * 0.345, -0.82, 0, 0.025, 0.14, 1.0, C.dark); }
    b.cyl(0, -0.9, 0, 0.016, 0.37, C.grey, 'stone', 6);
    b.box(0, -0.54, 0, 0.03, 0.02, 1.1, C.grey, 'stone');
    for (const z of [-0.36, 0, 0.36]) b.box(0, -0.62, z, 0.012, 0.08, 0.012, C.black);
  }
  const g = finishGeometry(b);
  g.userData.meshInfo = { family: 'cablecar', seats: 40, bubble: true, cabinSize: 40, near };
  return g;
}
