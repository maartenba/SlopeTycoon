import type * as THREE from 'three';
import { C, PartBuilder } from '../common';
import { finishGeometry } from './geo';

export const SEAT_PITCH = 0.17;
/** Chair width across the line for `seats` riders. */
export const chairWidth = (seats: number): number => 0.1 + seats * SEAT_PITCH;

/**
 * Chair: origin at the cable grip, hangs downward (-y); +z forward. `seats` (2/4/6/8) widens the bench along x
 * (one pad + backrest section per seat); `bubble` adds a translucent weather hood (glass group). Detachable chairs get a
 * grip block with two wheels on the hanger. Footrest and safety bar on every chair; red for open chairs, grey-blue for bubbles.
 */
export function buildChairGeometry(seats = 4, bubble = false, detachable = false, near = false, bodyColor?: number, visor = false): THREE.BufferGeometry {
  const b = new PartBuilder(1, 1);
  const w = chairWidth(seats);
  const body = bodyColor ?? (bubble ? 0x6c7a89 : C.red);
  b.box(0, -0.38, 0, 0.04, 0.36, 0.04, C.grey, 'stone'); // hanger
  if (detachable) { b.box(0, -0.04, 0, 0.12, 0.08, 0.12, C.dark); for (const z of [-0.07, 0.07]) b.cyl(0, 0.0, z, 0.035, 0.03, C.black, 'wood', 6, { rz: Math.PI / 2 }); }
  else b.box(0, -0.02, 0, 0.08, 0.05, 0.08, C.dark);
  if (seats > 2) b.box(0, -0.36, 0, w * 0.9, 0.03, 0.04, C.grey, 'stone'); // spreader bar for wide benches
  b.box(0, -0.45, 0, w, 0.05, 0.2, body, 'roof'); // seat frame
  b.box(0, -0.45 + 0.1, -0.09, w, 0.22, 0.04, body, 'roof'); // backrest
  for (let i = 0; i < seats; i++) { // one pad + backrest cushion per seat
    const x = -w / 2 + 0.05 + SEAT_PITCH / 2 + i * SEAT_PITCH;
    b.box(x, -0.4, 0.0, SEAT_PITCH - 0.03, 0.025, 0.17, C.white, 'roof');
    b.box(x, -0.34, -0.065, SEAT_PITCH - 0.03, 0.17, 0.02, C.cream, 'roof');
  }
  for (const x of [-w / 2 + 0.01, w / 2 - 0.01]) b.box(x, -0.4, 0.04, 0.03, 0.1, 0.16, body, 'roof'); // armrests
  b.box(0, -0.3, 0.1, w, 0.03, 0.03, C.dark); // safety bar
  b.box(0, -0.58, 0.11, w * 0.85, 0.025, 0.1, C.dark); // footrest
  for (const x of [-w / 2 + 0.03, w / 2 - 0.03]) b.box(x, -0.58, 0.07, 0.02, 0.15, 0.02, C.dark); // footrest hangers
  if (bubble) {
    b.box(0, -0.06, 0, w + 0.06, 0.04, 0.3, C.white, 'roof'); // hood roof cap
    for (const x of [-w / 2 - 0.02, w / 2 + 0.02]) b.box(x, -0.4, 0.0, 0.025, 0.36, 0.26, 0xcfe4f4, 'glass');
    b.box(0, -0.4, 0.14, w + 0.04, 0.36, 0.025, 0xcfe4f4, 'glass'); // visor
    b.box(0, -0.1, 0.0, w + 0.04, 0.05, 0.28, 0xcfe4f4, 'glass');
    for (const x of [-w / 2 - 0.02, w / 2 + 0.02]) b.box(x, -0.4, 0.14, 0.03, 0.36, 0.03, C.dark); // hood posts
    b.box(0, -0.43, 0.14, w + 0.04, 0.03, 0.03, C.dark);
  }
  if (visor) { // high-speed chair (chair6d): a slim wind visor in front of the riders + a white roof stripe, no hood
    b.box(0, -0.4, 0.14, w + 0.04, 0.3, 0.02, 0xcfe4f4, 'glass');
    for (const x of [-w / 2 - 0.02, w / 2 + 0.02]) b.box(x, -0.4, 0.14, 0.025, 0.3, 0.025, C.dark);
    b.box(0, -0.1, -0.06, w * 0.7, 0.025, 0.2, C.white, 'roof');
  }
  if (near) addChairNearDetail(b, seats, w, body, detachable);
  const g = finishGeometry(b);
  g.userData.meshInfo = { family: 'chair', seats, bubble, detachable, cabinSize: 0, near, visor };
  return g;
}

/**
 * Close-up extras (ground cameras, < ~60 m; the base chair above is kept as is, so the near chair = base + these): curved backrest (angled wings per
 * seat + padded top roll), seat piping and side bolsters, hanger collars + grip jaws with bolts and spring, safety-bar handles and hinges, footrest
 * rubber strip. ~+230 triangles for a 4-seater.
 */
function addChairNearDetail(b: PartBuilder, seats: number, w: number, body: number, detachable: boolean): void {
  for (let i = 0; i < seats; i++) {
    const x = -w / 2 + 0.05 + SEAT_PITCH / 2 + i * SEAT_PITCH;
    for (const s of [-1, 1]) b.box(x + s * (SEAT_PITCH / 2 - 0.03), -0.4, -0.055, 0.03, 0.17, 0.02, C.cream, 'roof', { ry: -s * 0.45 }); // curved backrest wings
    b.cyl(x, -0.4, 0.088, 0.011, SEAT_PITCH - 0.035, C.white, 'roof', 6, { rz: Math.PI / 2 }); // seat-edge piping
  }
  b.cyl(0, -0.13, -0.085, 0.016, w, body, 'roof', 8, { rz: Math.PI / 2 }); // padded top roll
  for (const x of [-w / 2 + 0.01, w / 2 - 0.01]) { b.cyl(x, -0.4, -0.03, 0.016, 0.28, C.dark, 'stone', 6); } // side-frame tubes
  for (const y of [-0.2, -0.32]) b.cyl(0, y, 0, 0.026, 0.02, C.dark, 'stone', 8); // hanger collars
  if (detachable) for (const x of [-0.065, 0.065]) { b.box(x, -0.07, 0, 0.012, 0.08, 0.14, C.black); b.ball(x, -0.045, 0.05, 0.012, C.grey, 'stone', 6); }
  else {
    for (const x of [-0.035, 0.035]) b.box(x, -0.07, 0, 0.012, 0.07, 0.1, C.black);
    b.cyl(0, -0.1, 0, 0.012, 0.06, C.grey, 'stone', 6, { rz: Math.PI / 2 }); // clamp bolt
  }
  b.cyl(0, -0.04, 0.06, 0.01, 0.05, C.grey, 'stone', 6, { rx: Math.PI / 2 }); // grip spring
  for (const x of [-w / 2 + 0.01, w / 2 - 0.01]) {
    b.box(x, -0.31, 0.04, 0.02, 0.02, 0.07, C.dark); // safety bar hinge arm
    b.cyl(x, -0.32, 0.105, 0.016, 0.06, C.black, 'wood', 6, { rx: Math.PI / 2 }); // handle grip
  }
  b.box(0, -0.575, 0.11, w * 0.85, 0.012, 0.09, C.black); // footrest rubber strip
}
