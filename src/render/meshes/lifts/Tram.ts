import type * as THREE from 'three';
import { C, PartBuilder } from '../common';
import { finishGeometry } from './geo';
import { addHull, curveTube, hullHalfWidth } from './loft';

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
  // M8 lane E: lofted rounded cabin (tapered yellow lower shell, curved panoramic glass band all round, red roof shell) instead of a box shell; same -0.93 .. -0.5 extent
  const hy = -0.715, hW = 0.78, hL = 1.28, hH = 0.43;
  addHull(b, 0, hy, 0, { L: hL, W: hW, H: hH, rings: near ? 12 : 9, seg: near ? 24 : 18, plan: 5, sec: 3.4, taper: 0.14 }, [
    { lo: -2, hi: -0.5, color: C.yellow, layer: 'wood' },
    { lo: -0.5, hi: 0.5, color: 0xcfe4f4, layer: 'glass' },
    { lo: 0.5, hi: 2, color: C.red, layer: 'roof' },
  ]);
  for (const s of [-1, 1]) for (const z of [-0.5, -0.17, 0.17, 0.5]) b.box(s * (hullHalfWidth(hW, hL, z, 5) * 0.985), -0.84, z, 0.02, 0.28, 0.04, C.dark); // mullions follow the curved side
  for (const s of [-1, 1]) b.box(s * (hullHalfWidth(hW, hL, 0, 5) * 0.99), -0.91, 0, 0.025, 0.36, 0.32, C.dark); // door
  b.box(0, -0.45, 0, 0.04, 0.04, 1.1, C.dark); // roof rail
  if (near) { // interior: floor, perimeter benches, central pole + straps rail
    b.box(0, -0.9, 0, 0.7, 0.012, 1.16, 0x6b6f76);
    for (const s of [-1, 1]) { b.box(s * 0.3, -0.84, 0, 0.1, 0.03, 1.0, C.dark); b.box(s * 0.345, -0.82, 0, 0.025, 0.14, 1.0, C.dark); }
    for (const s of [-1, 1]) curveTube(b, [[s * 0.26, -0.55, -0.5], [s * 0.2, -0.5, -0.25], [s * 0.2, -0.5, 0.25], [s * 0.26, -0.55, 0.5]], 0.008, C.grey, 'stone', 10, 4); // curved overhead grab rails
    b.cyl(0, -0.9, 0, 0.016, 0.37, C.grey, 'stone', 6);
    b.box(0, -0.54, 0, 0.03, 0.02, 1.1, C.grey, 'stone');
    for (const z of [-0.36, 0, 0.36]) b.box(0, -0.62, z, 0.012, 0.08, 0.012, C.black);
  }
  const g = finishGeometry(b);
  g.userData.meshInfo = { family: 'cablecar', seats: 40, bubble: true, cabinSize: 40, near };
  return g;
}
