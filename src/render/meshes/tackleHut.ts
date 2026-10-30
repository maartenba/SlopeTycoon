import { C, PartBuilder, chimney, doorway, frameWin } from './common';

/**
 * Tackle & bait hut (2x2, about 420 triangles): a little timber cabin with a sloped roof and stove pipe, a "BAIT" sign, a rod rack with rods leaning on the wall,
 * a drying rack with three fish, a bucket and a crate of bait tins on a small plank porch. Anglers themselves are drawn by the guest renderer.
 */
export function tackleHut(b: PartBuilder, w: number, h: number): void {
  const bw = 1.05, bd = 0.72, cz = -0.28;
  b.box(0, 0, cz + 0.02, bw + 0.1, 0.06, bd + 0.1, C.dark); // sill
  b.box(0, 0.06, cz, bw, 0.5, bd, 0xb98a55);
  b.gable(0, 0.56, cz, bd + 0.22, bw + 0.16, 0.3, C.roofGreen, false);
  const fz = cz + bd / 2;
  doorway(b, -0.22, fz, 's', 0.22, 0.42, C.dark, C.cream);
  frameWin(b, 0.26, 0.26, fz, 's', 0.2, 1, C.cream, C.roofGreen);
  b.sign('BAIT', 0.26, 0.5, fz + 0.045, 0.34, 0.12);
  chimney(b, 0.42, 0.86, cz - 0.2, 0.2);
  // porch planks + bait crate + bucket
  b.box(0, 0.0, fz + 0.2, 1.1, 0.05, 0.36, C.wood);
  b.box(-0.45, 0.05, fz + 0.2, 0.2, 0.13, 0.16, C.cream); b.box(-0.45, 0.18, fz + 0.2, 0.17, 0.03, 0.13, C.dark);
  b.cyl(0.4, 0.05, fz + 0.24, 0.07, 0.13, C.blue, 'wood', 7);
  // rod rack against the right wall: two posts, a crossbar, four rods leaning out
  const rx = bw / 2 + 0.16;
  for (const dz of [-0.2, 0.2]) b.box(rx, 0, cz + dz, 0.04, 0.5, 0.04, C.dark);
  b.box(rx, 0.38, cz, 0.04, 0.04, 0.5, C.dark);
  for (let i = 0; i < 4; i++) b.cyl(rx + 0.07, 0.05, cz - 0.18 + i * 0.12, 0.012, 0.95, i % 2 ? C.dark : C.yellow, 'wood', 4, { rz: 0.25 });
  // drying rack with fish (left)
  const lx = -bw / 2 - 0.2;
  for (const dz of [-0.2, 0.2]) b.box(lx, 0, cz + dz, 0.03, 0.45, 0.03, C.dark);
  b.box(lx, 0.42, cz, 0.03, 0.03, 0.5, C.dark);
  for (let i = 0; i < 3; i++) b.box(lx, 0.22, cz - 0.14 + i * 0.14, 0.035, 0.18, 0.07, i === 1 ? C.orange : C.stone, 'stone');
  // a rowing-boat shaped canoe resting behind the hut
  b.box(0.1, 0.0, cz - 0.62, 0.9, 0.1, 0.26, C.red, 'wood', { ry: 0.0 });
  void w; void h;
}
