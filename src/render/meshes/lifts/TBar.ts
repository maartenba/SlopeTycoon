import type * as THREE from 'three';
import { C, PartBuilder } from '../common';
import { finishGeometry } from './geo';

/** T-bar hanger: cable grip, spring-loaded retractable pole (anchor) ending in a yellow T crossbar with rubber ends. */
export function buildTBarGeometry(): THREE.BufferGeometry {
  const b = new PartBuilder(1, 1);
  b.box(0, -0.06, 0, 0.1, 0.08, 0.1, C.dark); // grip clamp on the cable
  b.cyl(0, -0.4, 0, 0.035, 0.34, C.grey, 'stone', 6); // anchor / spring housing
  b.cyl(0, -0.55, 0, 0.02, 0.18, C.black, 'stone', 6); // extendable rod
  b.box(0, -0.62, 0, 0.56, 0.05, 0.06, C.yellow, 'roof'); // T bar
  for (const x of [-0.28, 0.28]) b.box(x, -0.64, 0, 0.06, 0.08, 0.08, C.black);
  const g = finishGeometry(b);
  g.userData.meshInfo = { family: 'tbar', seats: 2, bubble: false, cabinSize: 0 };
  return g;
}
