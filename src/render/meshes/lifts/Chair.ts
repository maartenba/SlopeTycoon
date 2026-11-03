import type * as THREE from 'three';
import { C, PartBuilder } from '../common';
import { finishGeometry } from './geo';
import { addHood, curveTube } from './loft';

/** Smoked amber-grey bubble glass (translucent through the existing glass layer). */
export const HOOD_GLASS = 0xe3a24e;

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
  if (bubble) b.cyl(0, -0.3, 0, 0.026, 0.3, C.grey, 'stone', 6); // short stem; the arched one-piece hanger is added below
  else b.cyl(0, -0.56, 0, 0.022, 0.36, C.grey, 'stone', 6); // hanger (round rod)
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
  for (const x of [-w / 2 + 0.01, w / 2 - 0.01]) { b.box(x, -0.4, 0.0, 0.03, 0.1, 0.08, body, 'roof'); b.cyl(x, -0.38, 0.04, 0.02, 0.16, body, 'roof', 6, { rx: Math.PI / 2 }); } // armrests (rounded tops)
  b.cyl(0, -0.3 - w / 2, 0.1, 0.017, w, C.dark, 'stone', 6, { rz: Math.PI / 2 }); // safety bar (round tube)
  if (bubble) { // rounded footrest bar on curved hangers
    b.cyl(0, -0.58 - w * 0.45, 0.11, 0.02, w * 0.9, C.dark, 'stone', 6, { rz: Math.PI / 2 });
    for (const x of [-w / 2 + 0.03, w / 2 - 0.03]) curveTube(b, [[x, -0.46, 0.04], [x, -0.54, 0.08], [x, -0.57, 0.11]], 0.012, C.dark, 'stone', 3, 4);
  } else {
    b.box(0, -0.58, 0.11, w * 0.85, 0.025, 0.1, C.dark); // footrest
    for (const x of [-w / 2 + 0.03, w / 2 - 0.03]) b.box(x, -0.58, 0.07, 0.02, 0.15, 0.02, C.dark); // footrest hangers
  }
  if (bubble) addBubbleHood(b, w);
  if (visor) { // high-speed chair (chair6d): a slim wind visor in front of the riders + a white roof stripe, no hood
    b.box(0, -0.4, 0.14, w + 0.04, 0.3, 0.02, 0xcfe4f4, 'glass');
    for (const x of [-w / 2 - 0.02, w / 2 + 0.02]) b.box(x, -0.4, 0.14, 0.025, 0.3, 0.025, C.dark);
    b.box(0, -0.1, -0.06, w * 0.7, 0.025, 0.2, C.white, 'roof');
  }
  if (near) addChairNearDetail(b, seats, w, body, detachable, bubble);
  const g = finishGeometry(b);
  g.userData.meshInfo = { family: 'chair', seats, bubble, detachable, cabinSize: 0, near, visor };
  return g;
}

/**
 * Bubble chair (M8 lane D): a swept, rounded smoked-glass hood over the bench (half superellipsoid, closed at the back, open at the front and underneath), a one-piece
 * arched tubular hanger from the grip down both sides of the bench, a rounded rim along the hood base and a pair of ski / board holders on each side.
 */
function addBubbleHood(b: PartBuilder, w: number): void {
  const half = w / 2;
  const arch: Array<[number, number, number]> = [];
  for (let i = 0; i <= 10; i++) { const th = (Math.PI * i) / 10; arch.push([half * Math.cos(th), -0.43 + 0.37 * Math.pow(Math.sin(th), 0.55), -0.015]); }
  curveTube(b, arch, 0.016, C.grey, 'stone', 12, 5);
  addHood(b, 0, -0.42, 0.015, half + 0.035, 0.34, 0.32, HOOD_GLASS, 6, 12);
  curveTube(b, [[0, -0.4, 0.15], [0, -0.2, 0.13], [0, -0.1, 0.06], [0, -0.075, -0.02], [0, -0.1, -0.1], [0, -0.3, -0.15]], 0.011, C.dark, 'stone', 8, 4); // hood spine rib
  for (const s of [-1, 1]) {
    b.cyl(s * (half + 0.03), -0.56, 0.0, 0.013, 0.28, C.white, 'roof', 5, { rx: Math.PI / 2 }); // rounded rim along the hood base
    b.cyl(s * (half + 0.045), -0.58, -0.02, 0.011, 0.22, C.dark, 'stone', 5, { rx: Math.PI / 2 }); // ski / board holder rail
  }
  }

/**
 * Close-up extras (ground cameras, < ~60 m; the base chair above is kept as is, so the near chair = base + these): curved backrest (angled wings per
 * seat + padded top roll), seat piping and side bolsters, hanger collars + grip jaws with bolts and spring, safety-bar handles and hinges, footrest
 * rubber strip. ~+230 triangles for a 4-seater.
 */
function addChairNearDetail(b: PartBuilder, seats: number, w: number, body: number, detachable: boolean, bubble = false): void {
  for (let i = 0; i < seats; i++) {
    const x = -w / 2 + 0.05 + SEAT_PITCH / 2 + i * SEAT_PITCH;
    if (!bubble) for (const s of [-1, 1]) b.box(x + s * (SEAT_PITCH / 2 - 0.03), -0.4, -0.055, 0.03, 0.17, 0.02, C.cream, 'roof', { ry: -s * 0.45 }); // curved backrest wings
    b.cyl(x, -0.4 - (SEAT_PITCH - 0.035) / 2, 0.088, 0.011, SEAT_PITCH - 0.035, C.white, 'roof', 6, { rz: Math.PI / 2 }); // seat-edge piping
  }
  b.cyl(0, -0.13 - w / 2, -0.085, 0.016, w, body, 'roof', 8, { rz: Math.PI / 2 }); // padded top roll
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
