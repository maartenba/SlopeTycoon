import { C, PartBuilder, car, chimney, doorway, flagPole, frameWin, lampPost } from '../common';

/** Train Station (4x2): station hall with clock tower, long platform canopy on posts, benches, signal and track bed. */
export function trainStation(b: PartBuilder, w: number, h: number): void {
  b.box(0, 0, h / 2 - 0.45, w - 0.2, 0.18, 0.9, C.stone, 'stone'); // platform
  b.box(0, 0.18, h / 2 - 0.82, w - 0.2, 0.02, 0.06, C.yellow, 'stone'); // safety line
  b.box(-1.0, 0.18, h / 2 - 0.45, 1.1, 0.6, 0.7, C.cream);
  b.gable(-1.0, 0.78, h / 2 - 0.45, 0.9, 1.3, 0.35, C.roofRed, true);
  b.box(-1.0, 0.78, h / 2 - 0.45, 0.3, 0.55, 0.3, C.cream); // clock tower
  b.box(-1.0, 1.33, h / 2 - 0.45, 0.4, 0.05, 0.4, C.roofRed, 'roof');
  b.cone(-1.0, 1.38, h / 2 - 0.45, 0.28, 0.3, C.roofRed, 'roof', 4, { ry: Math.PI / 4 });
  b.cyl(-1.0, 0.95, h / 2 - 0.29, 0.1, 0.03, C.white, 'wood', 12, { rx: Math.PI / 2 }); // clock face
  b.box(-1.0, 1.02, h / 2 - 0.275, 0.015, 0.09, 0.01, C.black); b.box(-0.97, 0.99, h / 2 - 0.275, 0.07, 0.015, 0.01, C.black);
  doorway(b, -1.2, h / 2 - 0.1, 's', 0.2, 0.4, C.dark);
  frameWin(b, -0.8, 0.32, h / 2 - 0.1, 's', 0.16, 0.0);
  for (let i = 0; i < 4; i++) b.box(0.1 + i * 0.5, 0.18, h / 2 - 0.2, 0.05, 0.7, 0.05, C.dark);
  b.box(0.85, 0.88, h / 2 - 0.2, 2.1, 0.05, 0.7, C.roofGreen, 'roof');
  b.box(0.85, 0.93, h / 2 - 0.2, 2.2, 0.03, 0.04, C.dark, 'roof');
  b.sign('STATION', -1.0, 0.5, h / 2 - 0.1, 0.9, 0.22, 0, '#1f3f7a');
  for (const x of [0.5, 1.3]) { b.box(x, 0.18, h / 2 - 0.2, 0.5, 0.04, 0.14, C.wood); b.box(x, 0.18, h / 2 - 0.27, 0.5, 0.14, 0.03, C.wood); }
  // tracks
  b.box(0, 0, -0.3, w - 0.2, 0.04, 0.9, C.grey, 'stone');
  for (const z of [-0.55, -0.05]) b.box(0, 0.04, z, w - 0.2, 0.03, 0.05, C.black, 'stone');
  for (let i = 0; i < 12; i++) b.box(-w / 2 + 0.3 + i * 0.32, 0.04, -0.3, 0.1, 0.02, 0.8, C.dark);
  b.cyl(w / 2 - 0.3, 0, -0.8, 0.025, 0.55, C.grey, 'wood', 5); // signal
  b.box(w / 2 - 0.3, 0.45, -0.8, 0.08, 0.16, 0.06, C.dark); b.box(w / 2 - 0.3, 0.52, -0.77, 0.05, 0.05, 0.02, C.red);
  chimney(b, -1.3, 0.78, h / 2 - 0.6, 0.3);
  lampPost(b, w / 2 - 0.2, h / 2 - 0.6, 0.55);
}

/** Altiport (8x3): runway with markings and edge lights, control tower with beacon, hangar, small plane, fuel drums and a windsock. */
export function altiport(b: PartBuilder, w: number, h: number): void {
  b.box(0, 0, -0.4, w - 0.3, 0.05, 1.0, C.asphalt, 'stone');
  for (let i = 0; i < 9; i++) b.box(-w / 2 + 0.7 + i * 0.8, 0.05, -0.4, 0.4, 0.01, 0.06, C.white, 'stone');
  b.box(-w / 2 + 0.2, 0.05, -0.4, 0.06, 0.01, 0.9, C.yellow, 'stone');
  b.box(w / 2 - 0.2, 0.05, -0.4, 0.06, 0.01, 0.9, C.yellow, 'stone');
  for (let i = 0; i < 9; i++) for (const z of [-0.95, 0.15]) b.box(-w / 2 + 0.5 + i * 0.9, 0.05, z, 0.05, 0.04, 0.05, C.glass); // edge lights
  for (let i = 0; i < 3; i++) for (const s of [-1, 1]) b.box(s * (w / 2 - 0.55), 0.05, -0.4 + (i - 1) * 0.28, 0.35, 0.01, 0.08, C.white, 'stone'); // thresholds
  // apron + tower
  b.box(0.8, 0, h / 2 - 0.5, 3.0, 0.05, 0.8, C.grey, 'stone');
  b.box(-2.5, 0, h / 2 - 0.5, 0.6, 1.1, 0.6, C.cream);
  frameWin(b, -2.5, 0.5, h / 2 - 0.2, 's', 0.16);
  b.box(-2.5, 1.1, h / 2 - 0.5, 0.8, 0.35, 0.8, C.glass);
  for (const [dx, dz] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]] as const) b.box(-2.5 + dx, 1.1, h / 2 - 0.5 + dz, 0.05, 0.35, 0.05, C.dark);
  b.box(-2.5, 1.45, h / 2 - 0.5, 0.95, 0.06, 0.95, C.roofRed, 'roof');
  b.cyl(-2.5, 1.51, h / 2 - 0.5, 0.015, 0.25, C.grey, 'stone', 5); b.ball(-2.5, 1.74, h / 2 - 0.5, 0.05, C.red, 'roof');
  // hangar
  b.box(1.5, 0.05, h / 2 - 0.5, 1.6, 0.5, 0.7, C.blue);
  b.gable(1.5, 0.55, h / 2 - 0.5, 0.8, 1.7, 0.25, C.roofBlue, true);
  b.box(1.5, 0.05, h / 2 - 0.14, 1.2, 0.4, 0.04, C.dark);
  b.sign('ALTIPORT', -0.5, 0.45, h / 2 - 0.12, 1.1, 0.3, 0, '#1f3f7a');
  // parked plane
  const px = 0.1, pz = h / 2 - 0.45;
  b.cyl(px, 0.12, pz, 0.08, 0.7, C.white, 'wood', 8, { rz: Math.PI / 2 });
  b.cone(px + 0.4, 0.12, pz, 0.08, 0.14, C.red, 'roof', 8, { rz: -Math.PI / 2 });
  b.box(px + 0.05, 0.19, pz, 0.2, 0.02, 0.9, C.white, 'wood');
  b.box(px - 0.32, 0.2, pz, 0.12, 0.1, 0.02, C.red); b.box(px - 0.32, 0.17, pz, 0.12, 0.02, 0.3, C.white);
  b.box(px + 0.1, 0.04, pz + 0.12, 0.05, 0.1, 0.05, C.dark); b.box(px + 0.1, 0.04, pz - 0.12, 0.05, 0.1, 0.05, C.dark);
  // fuel drums + windsock
  for (const dz of [0, 0.2]) b.cyl(w / 2 - 1.0, 0.05, h / 2 - 0.35 - dz, 0.08, 0.22, C.red, 'wood', 8);
  b.cyl(w / 2 - 0.3, 0, h / 2 - 0.4, 0.03, 0.8, C.dark, 'wood', 6);
  b.cone(w / 2 - 0.3, 0.6, h / 2 - 0.4, 0.1, 0.4, C.orange, 'roof', 8, { rz: Math.PI / 2 });
  flagPole(b, -3.2, h / 2 - 0.3, 0.6, C.blue, C.white);
}

/** Parking (5x4): marked bays, ticket booth with barrier arm, lamp posts and a handful of differently coloured cars. */
export function parking(b: PartBuilder, w: number, h: number): void {
  b.box(0, 0, 0, w - 0.1, 0.04, h - 0.1, C.asphalt, 'stone');
  for (let i = 0; i <= 5; i++) b.box(-w / 2 + 0.3 + i * 0.84, 0.04, -h / 2 + 0.9, 0.04, 0.01, 1.4, C.white, 'stone');
  for (let i = 0; i <= 5; i++) b.box(-w / 2 + 0.3 + i * 0.84, 0.04, h / 2 - 0.9, 0.04, 0.01, 1.4, C.white, 'stone');
  b.box(0.3, 0.04, 0, w - 1.2, 0.01, 0.04, C.yellow, 'stone'); // centre lane line
  const cars = [C.red, C.blue, C.yellow, C.green, C.pink, C.orange, C.purple];
  [0, 1, 3].forEach((i) => car(b, -w / 2 + 0.72 + i * 0.84, -h / 2 + 0.9, cars[i]!, 0, 0.9));
  [2, 4].forEach((i) => car(b, -w / 2 + 0.72 + i * 0.84, h / 2 - 0.9, cars[(i + 3) % 7]!, Math.PI, 0.9));
  // ticket booth + barrier
  b.box(-w / 2 + 0.3, 0, 0, 0.35, 0.5, 0.35, C.orange);
  b.box(-w / 2 + 0.3, 0.5, 0, 0.45, 0.05, 0.45, C.roofRed, 'roof');
  frameWin(b, -w / 2 + 0.3, 0.25, 0.175, 's', 0.12);
  b.box(-w / 2 + 0.3, 0.0, 0.45, 0.05, 0.3, 0.05, C.dark);
  b.box(-w / 2 + 0.6, 0.27, 0.45, 0.6, 0.03, 0.03, C.red); b.box(-w / 2 + 0.65, 0.27, 0.45, 0.1, 0.03, 0.035, C.white);
  b.sign('P', w / 2 - 0.3, 0.8, 0, 0.4, 0.4, 0, '#2d5fa8', '#ffffff');
  b.cyl(w / 2 - 0.3, 0, -0.03, 0.03, 0.6, C.dark, 'wood', 6);
  lampPost(b, 0.4, 0.15, 0.7); lampPost(b, -1.2, -0.2, 0.7);
  void doorway;
}
