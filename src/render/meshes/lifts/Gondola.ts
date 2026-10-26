import type * as THREE from 'three';
import { C, PartBuilder, chamferBox } from '../common';
import { finishGeometry } from './geo';

const GLASS = 0xcfe4f4;

/**
 * Gondola cabin, long axis along the line (z). `size` = passengers: 6 = compact blue cabin with small windows,
 * 10 = longer, taller red cabin with panoramic window band, door frames and a roof fairing. Hangs from a carriage with two wheels.
 */
export function buildGondolaGeometry(size = 6, near = false): THREE.BufferGeometry {
  const b = new PartBuilder(1, 1);
  const big = size >= 10;
  const W = big ? 0.5 : 0.42, L = big ? 0.8 : 0.52, H = big ? 0.44 : 0.4;
  const accent = big ? C.roofRed : C.blue;
  b.box(0, -0.06, 0, 0.1, 0.08, 0.18, C.dark); // grip carriage
  for (const z of [-0.06, 0.06]) b.cyl(0, 0.0, z, 0.035, 0.04, C.black, 'wood', 6, { rz: Math.PI / 2 });
  b.box(0, -0.3, 0, 0.04, 0.25, 0.04, C.grey, 'stone'); // hanger arm
  if (big) b.box(0, -0.3, 0, 0.04, 0.04, 0.3, C.grey, 'stone');
  const top = -0.5, y0 = top - H;
  b.add(chamferBox(W, H, L, Math.min(0.05, W * 0.16)), 'wood', C.white, 0, y0 + H / 2, 0); // body shell (rounded: chunky bevel)
  b.add(chamferBox(W + 0.04, 0.06, L + 0.04, 0.022), 'roof', accent, 0, top - 0.02 + 0.03, 0); // roof fairing
  b.box(0, y0 - 0.03, 0, W + 0.04, 0.05, L + 0.04, accent, 'roof'); // skirt
  b.box(0, top - 0.0, 0, 0.14, 0.05, L * 0.6, C.grey, 'stone'); // roof equipment
  // windows (glass group) + frames
  if (big) {
    for (const s of [-1, 1]) {
      b.box(s * (W / 2 + 0.006), y0 + 0.09, 0, 0.02, 0.28, L - 0.1, GLASS, 'glass');
      for (const z of [-0.2, 0.2]) b.box(s * (W / 2 + 0.012), y0 + 0.08, z, 0.015, 0.3, 0.03, C.dark); // sliding doors
      b.box(s * (W / 2 + 0.012), y0 + 0.08, 0, 0.015, 0.3, 0.02, C.dark);
    }
    b.box(0, y0 + 0.09, L / 2 + 0.006, W - 0.1, 0.28, 0.02, GLASS, 'glass');
    b.box(0, y0 + 0.09, -L / 2 - 0.006, W - 0.1, 0.28, 0.02, GLASS, 'glass');
  } else {
    for (const s of [-1, 1]) for (const z of [-0.12, 0.12]) b.box(s * (W / 2 + 0.006), y0 + 0.12, z, 0.02, 0.17, 0.17, GLASS, 'glass');
    b.box(0, y0 + 0.12, L / 2 + 0.006, W - 0.14, 0.17, 0.02, GLASS, 'glass');
    b.box(0, y0 + 0.12, -L / 2 - 0.006, W - 0.14, 0.17, 0.02, GLASS, 'glass');
  }
  b.box(0, y0 + 0.02, 0, W + 0.01, 0.03, L + 0.01, C.grey, 'stone'); // lower trim
  if (near) { // interior (the shell is a solid box, so from inside you see these through the culled back faces): floor, two benches with backrests, grab pole, window sills, door handles
    b.box(0, y0 + 0.04, 0, W - 0.04, 0.012, L - 0.04, 0x6b6f76);
    for (const s of [-1, 1]) {
      b.box(s * (W / 2 - 0.08), y0 + 0.1, 0, 0.1, 0.03, L - 0.1, 0x3d6fb6); // bench seat
      b.box(s * (W / 2 - 0.04), y0 + 0.13, 0, 0.025, 0.14, L - 0.1, 0x3d6fb6); // backrest
      b.box(s * (W / 2 - 0.08), y0 + 0.04, 0, 0.09, 0.06, L - 0.14, C.dark); // bench base
      b.box(s * (W / 2 + 0.02), y0 + (big ? 0.07 : 0.11), 0, 0.02, 0.012, L - 0.08, C.grey, 'stone'); // window sill
      for (const z of [big ? -0.2 : -0.06, big ? 0.2 : 0.06]) b.cyl(s * (W / 2 + 0.018), y0 + 0.14, z, 0.007, 0.07, C.grey, 'stone', 6); // door handles
    }
    b.cyl(0, y0 + 0.04, 0, 0.016, H - 0.06, C.grey, 'stone', 8); // central grab pole
    b.box(0, y0 + H - 0.04, 0, W - 0.06, 0.012, L - 0.06, 0xe9edf0); // ceiling liner
  }
  const g = finishGeometry(b);
  g.userData.meshInfo = { family: 'gondola', seats: size, bubble: true, cabinSize: size, near };
  return g;
}
