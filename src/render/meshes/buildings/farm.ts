import { C, PartBuilder, chimney, flagPole, frameWin, roofHeightAt } from '../common';

/** Alpine Farm (6x5): red-roofed barn with hayloft and chimney, silo, farm-shop stand, hay bales, tractor and a fenced pasture. */
export function alpineFarm(b: PartBuilder, w: number, h: number): void {
  const bx = -w / 2 + 1.5, bz = -h / 2 + 1.3;
  b.box(bx, 0, bz, 2.4, 0.9, 1.8, C.wood);
  for (let i = 0; i <= 6; i++) b.box(bx - 1.2 + i * 0.4, 0, bz + 0.91, 0.05, 0.9, 0.02, C.dark); // plank battens
  b.gable(bx, 0.9, bz, 2.7, 2.1, 0.75, C.roofRed, false);
  b.box(bx, 1.62, bz, 0.05, 0.04, 2.15, C.dark, 'roof');
  // barn door (cross-braced) + hayloft hatch
  b.box(bx, 0, bz + 0.92, 0.8, 0.7, 0.05, C.dark);
  b.box(bx, 0.7, bz + 0.92, 0.9, 0.04, 0.06, C.cream);
  b.box(bx, 0.0, bz + 0.95, 0.8, 0.03, 0.03, C.cream, 'wood', { rz: 0.8 });
  b.box(bx, 0.97, bz + 0.92, 0.3, 0.3, 0.04, C.cream);
  b.box(bx, 1.0, bz + 0.94, 0.22, 0.22, 0.04, C.dark);
  frameWin(b, bx + 0.85, 0.4, bz + 0.9, 's', 0.16, 0.05, C.cream, C.red);
  void roofHeightAt;
  chimney(b, bx - 0.8, 0.9, bz - 0.4, 0.8);
  // silo
  const sx = bx + 1.9, sz = bz - 0.1;
  b.cyl(sx, 0, sz, 0.36, 1.5, C.stone, 'stone', 12);
  for (const y of [0.4, 0.8, 1.2]) b.cyl(sx, y, sz, 0.375, 0.04, C.grey, 'stone', 12);
  b.cone(sx, 1.5, sz, 0.42, 0.35, C.roofBlue, 'roof', 12);
  // farm shop stand
  const shx = w / 2 - 1.1, shz = -h / 2 + 1.0;
  b.box(shx, 0, shz, 1.2, 0.5, 0.8, C.cream);
  b.gable(shx, 0.5, shz, 0.9, 1.4, 0.4, C.roofBrown, true);
  b.sign('FARM SHOP', shx, 0.3, shz + 0.41, 0.9, 0.3);
  frameWin(b, shx - 0.45, 0.2, shz + 0.4 + 0.0, 's', 0.12);
  // haystack, hay bales, milk churns
  b.cyl(bx + 1.8, 0, bz + 0.9, 0.3, 0.45, C.yellow, 'wood', 10);
  b.cone(bx + 1.8, 0.45, bz + 0.9, 0.3, 0.25, C.yellow, 'wood', 10);
  [[0.0, 0.0], [0.38, 0.0], [0.19, 0.2]].forEach(([dx, dz], i) => b.cyl(sx + 0.3 + dx!, i === 2 ? 0.34 : 0, shz + 1.45 + dz!, 0.17, 0.34, C.yellow, 'wood', 8, { rz: Math.PI / 2 }));
  for (const dx of [0, 0.2]) b.cyl(shx - 0.8 + dx, 0, shz + 0.65, 0.07, 0.25, C.grey, 'wood', 6);
  // tractor
  const tx = w / 2 - 1.2, tz = -h / 2 + 2.0;
  b.box(tx, 0.15, tz, 0.4, 0.2, 0.7, C.green);
  b.box(tx, 0.35, tz - 0.12, 0.34, 0.25, 0.3, C.green);
  b.box(tx, 0.58, tz - 0.12, 0.38, 0.03, 0.34, C.dark, 'roof');
  for (const s of [-1, 1]) { b.cyl(tx + s * 0.25, 0.0, tz - 0.22, 0.17, 0.1, C.black, 'wood', 8, { rz: Math.PI / 2 }); b.cyl(tx + s * 0.23, 0.0, tz + 0.25, 0.1, 0.08, C.black, 'wood', 8, { rz: Math.PI / 2 }); }
  // fenced pasture in the front half
  const x0 = -w / 2 + 0.15, x1 = w / 2 - 0.15, z0 = -h / 2 + 2.3, z1 = h / 2 - 0.15;
  b.fence(x0, z0, x1, z0, C.dark, 0.3, 10);
  b.fence(x0, z1, x1, z1, C.dark, 0.3, 10);
  b.fence(x0, z0, x0, z1, C.dark, 0.3, 4);
  b.fence(x1, z0, x1, z1, C.dark, 0.3, 4);
  b.box(0, 0.01, (z0 + z1) / 2, x1 - x0 - 0.3, 0.02, z1 - z0 - 0.3, C.green, 'wood');
  b.cyl(0.6, 0.02, z1 - 0.6, 0.18, 0.12, C.stone, 'stone', 8); // water trough
  flagPole(b, bx + 1.0, bz + 1.2, 0.8, C.red, C.white);
}
