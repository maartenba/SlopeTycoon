import { C, PartBuilder, doorway, frameWin } from '../common';

/**
 * Race course huts (0.8.0, docs/race-course.md). Start Hut (1x1): a small timber hut with a red roof, a starting gate (two posts and a bar) and a bench.
 * Timing Hut (2x1): a longer hut with a blue roof, a finish arch over a red-and-white strip and a flagpole; the live board is drawn by `RaceCourseView`
 * between two posts above the roof (the hut only carries its two posts).
 */
export function startHut(b: PartBuilder, w: number, h: number): void {
  b.box(0, 0, 0, w - 0.06, 0.03, h - 0.06, C.sand, 'stone');
  b.box(-0.1, 0.03, -0.12, 0.56, 0.5, 0.42, C.wood);
  b.gable(-0.1, 0.53, -0.12, 0.5, 0.64, 0.24, C.roofRed, false);
  b.box(0.15, 0.7, -0.1, 0.07, 0.2, 0.07, C.roofRed, 'stone'); // stove pipe (no smoke)
  doorway(b, -0.2, 0.09, 's', 0.16, 0.32, C.dark, C.cream);
  // starting gate: two posts and a bar across, a bench, a ski rack
  for (const x of [0.16, 0.44]) b.cyl(x, 0.03, 0.3, 0.018, 0.3, C.red, 'wood', 6);
  b.box(0.3, 0.3, 0.3, 0.32, 0.03, 0.03, C.white, 'wood');
  b.box(-0.3, 0.03, 0.34, 0.3, 0.05, 0.1, C.dark, 'wood');
  for (const z of [-0.2, 0.0]) b.box(0.4, 0.2, z, 0.04, 0.3, 0.02, C.blue, 'wood', { rz: 0.2 }); // skis leaning on the wall
}

export function timingHut(b: PartBuilder, w: number, h: number): void {
  b.box(0, 0, 0, w - 0.08, 0.03, h - 0.08, C.sand, 'stone');
  const bz = -0.12;
  b.box(-0.2, 0.03, bz, 1.2, 0.58, 0.5, C.cream);
  b.gable(-0.2, 0.61, bz, 0.58, 1.3, 0.26, C.roofBlue, false);
  doorway(b, -0.55, bz + 0.25, 's', 0.2, 0.36, C.dark, C.white);
  frameWin(b, 0.1, 0.34, bz + 0.26, 's', 0.2);
  for (const x of [-0.42, 0.22]) b.cyl(x, 0.6, bz, 0.02, 0.42, C.dark, 'wood', 6); // two posts hold the live board (drawn by the view around y = 1.1)
  // finish arch: two posts and a chequered bar, a flagpole
  for (const x of [0.62, 0.95]) b.cyl(x, 0.03, 0.3, 0.02, 0.45, C.red, 'wood', 6);
  for (let i = 0; i < 6; i++) b.box(0.66 + i * 0.055, 0.46, 0.3, 0.055, 0.05, 0.03, i % 2 ? C.white : C.black, 'wood');
  b.cyl(-0.9, 0.03, 0.3, 0.015, 0.8, C.grey, 'stone', 6); b.box(-0.82, 0.68, 0.3, 0.16, 0.1, 0.01, C.red, 'roof');
}
