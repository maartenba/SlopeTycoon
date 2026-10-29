import { C, PartBuilder } from './common';

/** Petting zoo (3x3, about 450 triangles): a fenced pen with a straw floor, a gate arch with the sign, a little shed with hay, a trough and a feed station. The animals are drawn by `PettingZooView`. */
export function pettingZoo(b: PartBuilder, w: number, h: number): void {
  const x0 = -w / 2 + 0.12, x1 = w / 2 - 0.12, z0 = -h / 2 + 0.12, z1 = h / 2 - 0.12;
  b.box(0, 0, 0, w - 0.1, 0.02, h - 0.1, 0x86b66a, 'wood'); // meadow
  b.box(0, 0.02, 0.35, w - 0.7, 0.012, h - 1.3, 0xe3c785, 'wood'); // straw floor
  // fence: back and sides, front with the gate gap
  b.fence(x0, z0, x1, z0, C.wood, 0.34, 8);
  b.fence(x0, z0, x0, z1, C.wood, 0.34, 6);
  b.fence(x1, z0, x1, z1, C.wood, 0.34, 6);
  b.fence(x0, z1, -0.38, z1, C.wood, 0.34, 3);
  b.fence(0.38, z1, x1, z1, C.wood, 0.34, 3);
  // gate arch with the sign
  for (const s of [-1, 1]) b.box(s * 0.4, 0, z1, 0.07, 0.62, 0.07, C.dark);
  b.box(0, 0.56, z1, 0.9, 0.07, 0.07, C.dark);
  b.sign('PETTING ZOO', 0, 0.6, z1 + 0.04, 0.78, 0.2);
  // shed (back left): timber box, gable roof, open front with hay
  b.box(-0.7, 0.02, z0 + 0.4, 0.9, 0.42, 0.5, C.wood);
  b.gable(-0.7, 0.44, z0 + 0.4, 0.62, 1.0, 0.2, C.roofRed, true);
  b.box(-0.7, 0.02, z0 + 0.67, 0.5, 0.3, 0.03, C.dark);
  b.box(-0.35, 0.02, z0 + 0.62, 0.22, 0.16, 0.18, C.yellow); b.box(-0.35, 0.18, z0 + 0.62, 0.2, 0.12, 0.16, C.yellow);
  // water trough + feed station (right back)
  b.box(0.7, 0.02, z0 + 0.35, 0.55, 0.12, 0.2, C.stone, 'stone'); b.box(0.7, 0.12, z0 + 0.35, 0.48, 0.02, 0.14, C.water, 'wood');
  b.box(1.05, 0.02, z0 + 0.8, 0.22, 0.3, 0.16, C.dark); b.box(1.05, 0.32, z0 + 0.8, 0.28, 0.04, 0.2, C.roofBlue, 'roof');
  b.cyl(1.05, 0.34, z0 + 0.8, 0.045, 0.06, C.orange, 'wood', 6); // a feed bucket
  // a log to climb on, a few flowers at the gate
  b.cyl(-0.9, 0.09 - 0.25, 0.55, 0.07, 0.5, C.dark, 'wood', 7, { rz: Math.PI / 2, ry: 0.5 });
  for (const [fx, c] of [[-0.62, C.pink], [-0.56, C.yellow], [0.6, C.red], [0.66, C.white]] as const) b.box(fx, 0.02, z1 + 0.14, 0.05, 0.07, 0.05, c);
}
