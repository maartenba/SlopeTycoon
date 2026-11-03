import { C, PartBuilder, chimney, domeCap, eaveBrackets, flagPole, frameWin, gambrel, roofHeightAt, tube, tyre } from '../common';

/** Alpine Farm (6x5): red-roofed barn with hayloft and chimney, silo, farm-shop stand, hay bales, tractor and a fenced pasture. */
export function alpineFarm(b: PartBuilder, w: number, h: number): void {
  const bx = -w / 2 + 1.5, bz = -h / 2 + 1.3;
  b.box(bx, 0, bz, 2.4, 0.9, 1.8, C.wood);
  for (let i = 0; i <= 6; i++) b.box(bx - 1.2 + i * 0.4, 0, bz + 0.91, 0.05, 0.9, 0.02, C.dark); // plank battens
  gambrel(b, bx, 0.9, bz, 2.4, 2.1, 0.78, C.roofRed, false); // gambrel barn roof (M8)
  b.box(bx, 1.66, bz, 0.05, 0.04, 2.15, C.dark, 'roof');
  for (const sx of [-1, 1]) eaveBrackets(b, bx + sx * 1.22, 0.9, bz, sx < 0 ? 'w' : 'e', 1.7, 0.5, 0.1);
  tube(b, bx, 1.5, bz + 0.95, bx, 1.5, bz + 1.22, 0.018, C.dark, 'wood'); b.cyl(bx, 1.455, bz + 1.22, 0.05, 0.03, C.grey, 'stone', 8, { rz: Math.PI / 2 }); // hay-hoist beam + pulley
  tube(b, bx, 1.66, bz, bx, 1.8, bz, 0.012, C.dark, 'roof'); b.box(bx + 0.07, 1.76, bz, 0.16, 0.05, 0.015, C.dark, 'roof'); b.ball(bx, 1.8, bz, 0.025, C.yellow, 'roof', 6); // weathervane (top stays under the 1.9 BUILDING_HEIGHT)
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
  domeCap(b, sx, 1.5, sz, 0.4, 0.32, C.roofBlue, 'roof', 12, 4); // rounded silo cap (M8)
  b.cyl(sx, 1.78, sz, 0.02, 0.1, C.grey, 'stone', 6);
  tube(b, sx + 0.1, 0.05, sz + 0.37, sx + 0.1, 1.5, sz + 0.37, 0.012, C.dark, 'stone', 5); tube(b, sx - 0.1, 0.05, sz + 0.37, sx - 0.1, 1.5, sz + 0.37, 0.012, C.dark, 'stone', 5); // ladder rails
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
  b.box(tx, 0.15, tz, 0.3, 0.12, 0.7, C.green); // chassis
  b.cyl(tx, 0.28 - 0.22, tz + 0.2, 0.1, 0.44, C.green, 'wood', 10, { rx: Math.PI / 2 }); // rounded bonnet
  b.box(tx, 0.35, tz - 0.12, 0.34, 0.25, 0.3, C.green);
  b.box(tx, 0.58, tz - 0.12, 0.38, 0.03, 0.34, C.dark, 'roof');
  for (const sx of [-1, 1]) b.cyl(tx + sx * 0.17, 0.36 - 0.1, tz - 0.12, 0.012, 0.2, C.dark, 'roof', 5, { rx: 0 }); // cab pillars
  tube(b, tx + 0.08, 0.34, tz + 0.3, tx + 0.08, 0.56, tz + 0.3, 0.014, C.black, 'wood'); // exhaust
  b.ball(tx, 0.26, tz + 0.46, 0.04, C.glass, 'wood', 6); // headlamp
  for (const s of [-1, 1]) { tyre(b, tx + s * 0.25, 0.0, tz - 0.22, 0.17, 0.1, 0, C.black, C.yellow, 12); tyre(b, tx + s * 0.23, 0.0, tz + 0.25, 0.1, 0.08, 0, C.black, C.yellow, 10); }
  // fenced pasture in the front half
  const x0 = -w / 2 + 0.15, x1 = w / 2 - 0.15, z0 = -h / 2 + 2.3, z1 = h / 2 - 0.15;
  const pasture = (ax: number, az: number, bx2: number, bz2: number, posts: number): void => { // two round rails + square posts (M8)
    for (const yy of [0.22, 0.12]) tube(b, ax, yy, az, bx2, yy, bz2, 0.014, C.dark, 'wood', 5);
    for (let i = 0; i <= posts; i++) b.box(ax + (bx2 - ax) * i / posts, 0, az + (bz2 - az) * i / posts, 0.05, 0.3, 0.05, C.dark);
  };
  pasture(x0, z0, x1, z0, 10); pasture(x0, z1, x1, z1, 10); pasture(x0, z0, x0, z1, 4); pasture(x1, z0, x1, z1, 4);
  b.box(0, 0.01, (z0 + z1) / 2, x1 - x0 - 0.3, 0.02, z1 - z0 - 0.3, C.green, 'wood');
  b.cyl(0.6, 0.02, z1 - 0.6, 0.18, 0.12, C.stone, 'stone', 12); b.cyl(0.6, 0.12, z1 - 0.6, 0.15, 0.02, C.water, 'stone', 12); // water trough with water
  flagPole(b, bx + 1.0, bz + 1.2, 0.8, C.red, C.white);
}
