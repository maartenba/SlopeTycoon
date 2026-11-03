import type * as THREE from 'three';
import { C, PartBuilder } from '../common';
import { finishGeometry } from './geo';

/** T-bar hanger: cable grip, spring-loaded retractable pole (anchor) ending in a yellow T crossbar with rubber ends. */
export function buildTBarGeometry(): THREE.BufferGeometry {
  const b = new PartBuilder(1, 1);
  b.box(0, -0.06, 0, 0.1, 0.08, 0.1, C.dark); // grip clamp on the cable
  b.cyl(0, -0.4, 0, 0.035, 0.34, C.grey, 'stone', 8); // anchor / spring housing
  b.cyl(0, -0.55, 0, 0.02, 0.18, C.black, 'stone', 6); // extendable rod
  b.cyl(0, -0.612 - 0.27, 0, 0.032, 0.54, C.yellow, 'roof', 8, { rz: Math.PI / 2 }); // T bar (round tube)
  for (const x of [-0.28, 0.28]) b.ball(x, -0.648, 0, 0.04, C.black, 'wood', 6); // rubber ends
  b.box(0, -0.36, 0, 0.05, 0.05, 0.05, C.dark); // spring collar
  const g = finishGeometry(b);
  g.userData.meshInfo = { family: 'tbar', seats: 2, bubble: false, cabinSize: 0 };
  return g;
}
