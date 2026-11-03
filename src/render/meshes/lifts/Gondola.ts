import type * as THREE from 'three';
import { C, PartBuilder } from '../common';
import { finishGeometry } from './geo';
import { addHull, curveTube, hullHalfWidth } from './loft';

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
  b.ball(0, -0.105, 0, 0.05, C.dark, 'wood', 8, { sy: 0.8, sz: 1.5 }); // rounded grip body on the cable
  for (const z of [-0.06, 0.06]) b.cyl(0, 0.0, z, 0.035, 0.04, C.black, 'wood', 6, { rz: Math.PI / 2 });
  curveTube(b, [[0, -0.1, 0], [0, -0.2, 0.014], [0, -0.32, -0.012], [0, -0.43, 0]], 0.024, C.grey, 'stone', 8, 6); // curved vertical hanger arm
  const top = -0.5, y0 = top - H, yc = top - H / 2, hh = H / 2;
  const seg = near ? 24 : 20, rings = near ? 10 : 8;
  addHull(b, 0, yc, 0, { L, W, H, rings, seg, plan: 4, sec: 3, taper: 0.24 }, [
    { lo: -2, hi: -0.62, color: C.white, layer: 'wood' }, // lower shell (tapered)
    { lo: -0.62, hi: -0.32, color: accent, layer: 'roof' }, // branding stripe
    { lo: -0.32, hi: 0.56, color: GLASS, layer: 'glass' }, // curved glass band all round
    { lo: 0.56, hi: 2, color: accent, layer: 'roof' }, // roof shell
  ]);
  addHull(b, 0, top - 0.005, 0, { L: L * 0.5, W: W * 0.45, H: 0.15, rings: near ? 8 : 6, seg: near ? 16 : 12, plan: 3, sec: 2.6, taper: 0 }, [{ lo: -2, hi: 2, color: C.white, layer: 'wood' }]); // roof pod
  b.ball(0, top - 0.03, 0, 0.032, C.grey, 'stone', 6); // hanger socket
  // door seams + frames on the curved side (placed on the hull side at window height)
  const seams = big ? [-0.2, 0.2] : [-0.12, 0.12], wy = yc + hh * 0.08, wh = hh * 0.5;
  for (const s of [-1, 1]) for (const z of seams) {
    const x = hullHalfWidth(W, L, z) * 0.985 * s;
    b.box(x, wy - wh / 2, z, 0.012, wh, 0.018, 0x4a4f57);
  }
  if (big) for (const s of [-1, 1]) b.cyl(s * (hullHalfWidth(W, L, 0) + 0.004), wy - 0.02, 0, 0.007, 0.3, C.grey, 'stone', 4, { rx: Math.PI / 2 }); // sliding-door bar
  if (near) { // interior (seen through the glass band; sized to sit inside the tapered hull): floor, two benches with backrests, grab pole, door handles, ceiling liner
    const iw = W * 0.52, il = L - 0.2;
    b.box(0, y0 + 0.07, 0, iw, 0.012, il, 0x6b6f76);
    for (const s of [-1, 1]) {
      b.ball(s * (iw / 2 - 0.05), y0 + 0.135 - 0.5, 0, 0.5, 0x3d6fb6, 'wood', 6, { sx: 0.1, sy: 0.03, sz: il - 0.04 }); // rounded cushion (ellipsoid)
      b.ball(s * (iw / 2 + 0.005), y0 + 0.22 - 0.5, 0, 0.5, 0x3d6fb6, 'wood', 6, { sx: 0.03, sy: 0.15, sz: il - 0.04, rz: s * 0.12 }); // backrest, leaning a little
      b.box(s * (iw / 2 - 0.05), y0 + 0.07, 0, 0.09, 0.05, il - 0.08, C.dark); // bench base
      for (const z of big ? [-0.2, 0.2] : [-0.06, 0.06]) b.cyl(s * (hullHalfWidth(W, L, z) * 0.99 + 0.006), y0 + 0.17, z, 0.007, 0.07, C.grey, 'stone', 6); // door handles
    }
    b.cyl(0, y0 + 0.07, 0, 0.016, H - 0.16, C.grey, 'stone', 8); // central grab pole
    b.box(0, top - 0.07, 0, iw, 0.012, il, 0xe9edf0); // ceiling liner
  }
  const g = finishGeometry(b);
  g.userData.meshInfo = { family: 'gondola', seats: size, bubble: true, cabinSize: size, near };
  return g;
}
