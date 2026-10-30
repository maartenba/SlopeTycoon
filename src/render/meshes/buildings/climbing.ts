import { C, PartBuilder, doorway, frameWin, lampPost } from '../common';

/**
 * Climbing Crag base hut (2x2, docs/climbing.md): a small timber hut with a pitched roof, a gear rack with coiled ropes, quickdraws and helmets, a crash
 * pad in front of a little practice boulder with coloured holds, a chalk bucket and an anchor post with a rope. The real wall is the natural rock face the
 * site rule requires nearby (the climbers are drawn on it by CragClimbers).
 */
export function crag(b: PartBuilder, w: number, h: number): void {
  b.box(0, 0, 0, w - 0.12, 0.03, h - 0.12, C.sand, 'stone'); // gravel apron
  // hut (back left)
  const hw = 0.95, hd = 0.7, hx = -w / 2 + hw / 2 + 0.12, hz = -h / 2 + hd / 2 + 0.1;
  b.box(hx, 0.03, hz, hw, 0.6, hd, C.wood);
  b.gable(hx, 0.63, hz, hd + 0.14, hw + 0.12, 0.24, C.roofBrown, false);
  doorway(b, hx + 0.22, hz + hd / 2, 's', 0.2, 0.4, C.dark, C.cream);
  frameWin(b, hx - 0.2, 0.34, hz + hd / 2 + 0.01, 's', 0.15);
  b.sign('CRAG', hx, 0.58, hz + hd / 2 + 0.06, 0.55, 0.2, 0, '#7a5a3a');
  // gear rack beside the hut: two posts, a bar, coiled ropes + helmets
  const rx = hx + hw / 2 + 0.28, rz = hz + 0.05;
  for (const dz of [-0.2, 0.2]) b.box(rx, 0.03, rz + dz, 0.05, 0.5, 0.05, C.dark);
  b.box(rx, 0.5, rz, 0.05, 0.04, 0.5, C.dark);
  [[-0.14, C.red], [0.0, C.yellow], [0.14, C.blue]].forEach(([dz, col]) => b.ring(rx + 0.04, 0.33, rz + (dz as number), 0.07, 0.03, col as number, 'wood', 10, { rx: 0 }));
  [-0.1, 0.1].forEach((dz, i) => b.ball(rx - 0.04, 0.54, rz + dz, 0.05, i ? C.orange : C.green, 'roof', 6));
  // practice boulder + crash pad + anchor post (front right)
  const bx = w / 2 - 0.5, bz = h / 2 - 0.42;
  b.box(bx, 0.03, bz - 0.12, 0.62, 0.5, 0.36, C.grey, 'stone');
  b.box(bx, 0.53, bz - 0.12, 0.44, 0.06, 0.28, C.stone, 'stone');
  [[-0.2, 0.12, C.red], [0.0, 0.26, C.yellow], [0.18, 0.18, C.blue], [-0.05, 0.4, C.green], [0.2, 0.38, C.orange]].forEach(([dx, y, col]) => b.box(bx + (dx as number), y as number, bz + 0.07, 0.07, 0.06, 0.04, col as number, 'wood'));
  b.box(bx, 0.03, bz + 0.3, 0.7, 0.07, 0.34, C.blue); // crash pad
  b.box(bx + 0.34, 0.03, bz - 0.12, 0.05, 0.7, 0.05, C.dark); // anchor post + rope
  b.box(bx + 0.34, 0.71, bz - 0.12, 0.2, 0.03, 0.03, C.grey);
  b.box(bx + 0.24, 0.2, bz - 0.12, 0.02, 0.55, 0.02, C.orange, 'wood');
  // chalk bucket + bench
  b.cyl(-0.1, 0.03, h / 2 - 0.3, 0.07, 0.12, C.white, 'wood', 8);
  b.box(-0.45, 0.03, h / 2 - 0.25, 0.4, 0.2, 0.12, C.wood);
  lampPost(b, -w / 2 + 0.15, h / 2 - 0.15, 0.5);
}
