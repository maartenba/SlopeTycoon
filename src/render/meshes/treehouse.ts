import { C, PartBuilder, frameWin } from './common';

/**
 * Treehouse (2x2, about 650 triangles): a fat trunk with a plank deck high in the crown, a small timber cabin with a mossy gable roof and a lit window,
 * a rope ladder, and a sagging rope bridge to a second little platform on a slimmer trunk. The deck stays below the 2.0 cable overfly limit.
 */
export function treehouse(b: PartBuilder, w: number, h: number, depth = 0): void {
  void w; void h;
  // on a slope the building is seated mid-footprint: both trunks reach down to the lowest corner (a tree grows out of the hillside, no stone plinth)
  if (depth > 0.01) {
    b.cyl(-0.25, -depth, -0.2, 0.16, depth + 0.02, 0x6b4a2e, 'wood', 10);
    b.cyl(0.62, -depth, 0.35, 0.1, depth + 0.02, 0x75553a, 'wood', 8);
  }
  const dy = 0.8; // deck height
  // main trunk + root flare, and the second tree
  b.cyl(-0.25, 0, -0.2, 0.17, 1.6, 0x6b4a2e, 'wood', 10);
  b.cyl(-0.25, 0, -0.2, 0.23, 0.18, 0x6b4a2e, 'wood', 10);
  b.cyl(0.62, 0, 0.35, 0.11, 1.1, 0x75553a, 'wood', 8);
  // crown cones (leaf mass) behind and above the cabin so it sits in the trees
  b.cone(-0.25, 1.52, -0.2, 0.42, 0.42, 0x3f7d33, 'roof', 8); // a thin canopy above the cabin roof: the cabin still shows from the iso camera
  b.cone(0.62, 1.0, 0.35, 0.3, 0.34, 0x4a8a38, 'roof', 7);
  // deck: planks on two bearers
  for (const z of [-0.5, 0.1]) b.box(-0.25, dy - 0.06, z, 1.15, 0.05, 0.06, C.dark);
  b.box(-0.25, dy - 0.02, -0.2, 1.2, 0.05, 0.95, C.wood);
  // cabin
  b.box(-0.35, dy + 0.03, -0.3, 0.7, 0.46, 0.62, C.wood);
  b.gable(-0.35, dy + 0.49, -0.3, 0.78, 0.84, 0.26, C.roofGreen, true);
  frameWin(b, -0.35, dy + 0.2, -0.3 + 0.31, 's', 0.16, 0.05, C.cream, C.roofGreen);
  b.box(-0.05, dy + 0.03, -0.3 + 0.31, 0.13, 0.28, 0.03, C.dark); // door
  // deck railing (front and right) + knotted posts
  for (const x of [-0.82, -0.25, 0.32]) b.box(x, dy + 0.03, 0.27, 0.04, 0.26, 0.04, C.dark);
  b.box(-0.25, dy + 0.24, 0.27, 1.16, 0.035, 0.035, C.wood);
  b.box(0.32, dy + 0.24, -0.2, 0.035, 0.035, 0.92, C.wood);
  b.box(0.32, dy + 0.03, -0.2, 0.04, 0.22, 0.04, C.dark);
  // rope ladder (front of the trunk): two ropes + rungs
  for (const dx of [-0.07, 0.07]) b.box(0.12 + dx, 0.05, 0.42, 0.015, dy - 0.04, 0.015, 0xcdb68a);
  for (let i = 0; i < 6; i++) b.box(0.12, 0.12 + i * 0.14, 0.42, 0.17, 0.025, 0.03, C.wood);
  // second platform + rope bridge: planks sag along a shallow arc between the two decks
  b.box(0.62, 0.64, 0.35, 0.42, 0.04, 0.42, C.wood);
  const ax = 0.32, az = 0.0, bx = 0.5, bz = 0.3, n = 6;
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t, y = dy - 0.02 + (0.66 - (dy - 0.02)) * t - Math.sin(Math.PI * t) * 0.09;
    b.box(x, y, z, 0.2, 0.025, 0.07, C.wood, 'wood', { ry: Math.atan2(bx - ax, bz - az) });
    for (const s of [-1, 1]) b.box(x + s * 0.1 * Math.cos(Math.atan2(bx - ax, bz - az)), y + 0.17, z - s * 0.1 * Math.sin(Math.atan2(bx - ax, bz - az)), 0.014, 0.014, 0.05, 0xcdb68a);
  }
  // a lantern on the cabin: glass-coloured = warm night glow
  b.box(-0.82 + 0.05, dy + 0.3, -0.3 + 0.28, 0.07, 0.09, 0.07, C.glass);
}
