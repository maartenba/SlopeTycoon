import { C, PartBuilder, awning, balcony, bike, chimney, dormer, doorway, flagPole, frameWin, house, parasolTable, skiRack, stackedLogs, timberFrame, lampPost } from '../common';

/** Base Lodge (4x3): big two-wing timber-frame alpine lodge, tall central entrance tower, terrace with tables, flag. */
export function baseLodge(b: PartBuilder, w: number, h: number): void {
  b.box(0, 0, -0.2, w - 0.2, 0.9, h - 0.9, C.cream); // long hall
  timberFrame(b, 0, -0.2, w - 0.2, h - 0.9, 0.0, 0.9, C.dark, 0.8);
  b.gable(0, 0.9, -0.2, h - 0.7, w - 0.1, 0.55, C.roofRed, true);
  b.box(0, 1.43, -0.2, w - 0.05, 0.04, 0.05, C.dark, 'roof'); // ridge beam
  b.box(0, 0, 0.2, 1.4, 1.5, h - 0.4, C.wood); // central tower
  b.gable(0, 1.5, 0.2, 1.6, h - 0.2, 0.7, C.roofBrown, false);
  b.box(0, 2.18, 0.2, 0.05, 0.04, h - 0.15, C.dark, 'roof');
  // wing end gables get a wood-clad bay each side
  for (const sx of [-1, 1]) b.box(sx * (w / 2 - 0.45), 0, -0.2, 0.7, 0.7, h - 0.5, C.wood);
  // entrance
  doorway(b, 0, h / 2 - 0.0, 's', 0.6, 0.62, C.dark, C.cream);
  for (const x of [-1.6, -1.1, 1.1, 1.6]) frameWin(b, x, 0.35, h / 2 - 0.88 + 0.0, 's', 0.22, 0.08);
  for (const x of [-0.4, 0, 0.4]) frameWin(b, x, 0.76, h / 2, 's', 0.18);
  b.sign('BASE LODGE', 0, 1.25, h / 2 + 0.03, 1.2, 0.35);
  for (const sx of [-1, 1]) dormer(b, sx * 1.45, 0.9, -0.2, h - 0.7, 0.55, C.cream, C.roofBrown);
  // terrace with railing and parasol tables
  b.box(0, 0, h / 2 + 0.2, 3.4, 0.05, 0.4, C.dark);
  b.fence(-1.7, h / 2 + 0.38, 1.7, h / 2 + 0.38, C.dark, 0.25, 8);
  parasolTable(b, -1.2, h / 2 + 0.2, C.red); parasolTable(b, 1.2, h / 2 + 0.2, C.blue, 1);
  chimney(b, -1.4, 0.9, -0.5, 0.9); chimney(b, 1.4, 0.9, -0.5, 0.9);
  flagPole(b, 0, 0.2, 0.5, C.red, C.white, 2.2);
  lampPost(b, -1.9, h / 2 + 0.3, 0.5); lampPost(b, 1.9, h / 2 + 0.3, 0.5);
}

/** Lodge/Restaurant (4x3): wooden hall with A-frame glass dining room and a terrace. */
export function lodge(b: PartBuilder, w: number, h: number): void {
  b.box(0, 0, -0.1, w - 0.4, 0.8, h - 0.8, C.wood);
  timberFrame(b, 0, -0.1, w - 0.4, h - 0.8, 0, 0.8, C.dark, 0.9);
  b.gable(0, 0.8, -0.1, h - 0.5, w - 0.3, 0.6, C.roofGreen, true);
  b.box(0, 1.37, -0.1, w - 0.25, 0.04, 0.05, C.dark, 'roof');
  // A-frame glass front
  b.box(0, 0, h / 2 - 0.35, 1.8, 0.2, 0.7, C.dark);
  b.gable(0, 0.2, h / 2 - 0.35, 1.8, 0.7, 1.4, C.glass, false, 'wood');
  b.gable(0, 1.6, h / 2 - 0.35, 2.1, 0.9, 0.35, C.roofGreen, false);
  for (const x of [-0.45, 0.45]) b.box(x, 0.2, h / 2 + 0.0, 0.05, 1.2, 0.04, C.dark); // mullions
  b.box(0, 0.2, h / 2 + 0.0, 1.5, 0.05, 0.04, C.dark);
  b.sign('LODGE', -1.45, 0.52, h / 2 - 0.5, 0.7, 0.32, 0);
  frameWin(b, -1.45, 0.22, h / 2 - 0.4 + 0.0, 's', 0.2);
  // terrace both sides
  for (const sx of [-1, 1]) {
    b.box(sx * 1.45, 0, h / 2 - 0.2, 1.1, 0.05, 0.7, C.dark);
    parasolTable(b, sx * 1.45, h / 2 - 0.15, sx < 0 ? C.orange : C.red, sx);
  }
  b.fence(1.0, h / 2 + 0.14, 1.98, h / 2 + 0.14, C.dark, 0.25, 3);
  b.fence(-1.98, h / 2 + 0.14, -1.0, h / 2 + 0.14, C.dark, 0.25, 3);
  chimney(b, 1.2, 0.8, -0.5, 0.9);
  for (let i = 0; i < 4; i++) frameWin(b, -1.4 + i * 0.9, 0.3, -h / 2 + 0.3, 'n', 0.2);
  for (const sx of [-1, 1]) frameWin(b, sx * (w - 0.4) / 2, 0.3, -0.1, sx < 0 ? 'w' : 'e', 0.2);
  stackedLogs(b, 1.7, -1.0, 0.5);
}

/** Café (2x2): round pink cabin under a red conical roof, striped awning, terrace with parasols. */
export function cafe(b: PartBuilder, w: number, h: number): void {
  b.cyl(0, 0, -0.1, 0.65, 0.6, C.pink, 'wood', 12);
  b.cyl(0, 0.56, -0.1, 0.9, 0.04, C.dark, 'roof', 12); // eave ring
  b.cone(0, 0.6, -0.1, 0.85, 0.6, C.roofRed, 'roof', 12);
  b.cyl(0, 1.2, -0.1, 0.05, 0.2, C.dark);
  b.cyl(0, 1.17, -0.1, 0.09, 0.03, C.stone, 'stone', 8);
  for (let i = 0; i < 6; i++) { // windows ringed around the drum, skipping the door side
    const a = -Math.PI / 2 + 0.7 + i * 0.85;
    if (Math.abs(Math.sin(a) - 1) < 0.2 && Math.abs(Math.cos(a)) < 0.4) continue;
    b.box(Math.sin(a) * 0.655, 0.3, -0.1 + Math.cos(a) * 0.655, 0.2, 0.22, 0.05, C.glass, 'wood', { ry: a });
  }
  b.box(0, 0, 0.55, 0.28, 0.45, 0.05, C.dark);
  awning(b, 0, 0.5, 0.68, 0.9, 0.35, C.pink, C.white);
  b.sign('CAFE', 0, 0.78, 0.76, 0.5, 0.25);
  b.box(0, 0, 0.8, 1.9, 0.03, 0.4, C.stone, 'stone'); // terrace slab
  for (const x of [-0.65, 0.65]) { parasolTable(b, x, h / 2 - 0.2, x < 0 ? C.red : C.yellow, x < 0 ? 0 : 1); }
  b.box(-0.45, 0.1, 0.52, 0.3, 0.06, 0.08, C.roofGreen); // window box
  void w;
}

/** Shop (2x2): shop windows, striped awning, ski rack and a raised signboard. */
export function shop(b: PartBuilder, w: number, h: number): void {
  b.box(0, 0, -0.2, w - 0.3, 0.8, h - 0.7, C.yellow);
  b.box(0, 0.8, -0.2, w - 0.2, 0.08, h - 0.6, C.roofRed, 'roof');
  b.box(0, 0.88, -0.2, w - 0.35, 0.04, h - 0.75, C.cream, 'roof');
  const fz = -0.2 + (h - 0.7) / 2;
  awning(b, 0, 0.62, fz + 0.15, w - 0.3, 0.45, C.red, C.white);
  frameWin(b, -0.45, 0.2, fz, 's', 0.32);
  doorway(b, 0.45, fz, 's', 0.3, 0.52, C.dark, C.cream);
  b.box(0, 0.88, fz + 0.1, 1.6, 0.3, 0.04, C.dark); // sign backing
  b.sign('SHOP', 0, 0.88, fz + 0.13, 1.0, 0.3);
  skiRack(b, -0.45, h / 2 - 0.15, 4);
  b.cyl(0.8, 0, h / 2 - 0.2, 0.1, 0.25, C.orange, 'wood', 8); // sale barrel
  b.box(-w / 2 + 0.2, 0.0, -0.2, 0.05, 0.8, 0.05, C.dark);
}

/** Rental (3x2): blue counter hut with a serving window, skis and bikes on racks outside. */
export function rental(b: PartBuilder, w: number, h: number): void {
  b.box(0, 0, -0.35, w - 0.3, 0.7, h - 1.0, C.blue);
  b.gable(0, 0.7, -0.35, h - 0.8, w - 0.2, 0.35, C.roofBlue, true);
  b.sign('RENTAL', -0.6, 0.95, 0.19, 1.0, 0.4);
  doorway(b, 0.8, 0.15, 's', 0.3, 0.45);
  frameWin(b, -0.1, 0.3, 0.15, 's', 0.3, 0.06, C.cream, C.orange);
  awning(b, -0.1, 0.52, 0.3, 0.6, 0.25, C.orange, C.white);
  skiRack(b, 0.55, 0.7, 6);
  b.box(-0.2, 0.06, 0.55, 1.3, 0.04, 0.05, C.dark); b.box(-0.2, 0.0, 0.55, 0.05, 0.1, 0.05, C.dark);
  bike(b, -0.75, 0.7, C.red); bike(b, -0.45, 0.7, C.green); bike(b, -0.15, 0.7, C.yellow);
  frameWin(b, -w / 2 + 0.15, 0.3, -0.35, 'w', 0.2);
}

/** Chalet (3x3): classic alpine chalet: stone base, log walls, wide overhanging roof, balcony, stacked logs. */
export function chalet(b: PartBuilder, w: number, h: number): void {
  b.box(0, 0, 0, w - 0.4, 0.45, h - 0.5, C.stone, 'stone');
  b.box(0, 0.45, 0, w - 0.4, 0.7, h - 0.5, C.wood);
  for (let i = 0; i < 3; i++) b.box(0, 0.5 + i * 0.22, 0, w - 0.36, 0.03, h - 0.46, C.dark); // log courses
  b.gable(0, 1.15, 0, w - 0.1, h - 0.1, 0.7, C.roofBrown, false);
  b.box(0, 1.83, 0, 0.05, 0.04, h - 0.05, C.dark, 'roof');
  balcony(b, 0, 0.45, h / 2 - 0.1, w - 1.0, 0.4, C.dark);
  const fz = (h - 0.5) / 2;
  doorway(b, 0, fz, 's', 0.3, 0.4);
  frameWin(b, -0.8, 0.6, fz, 's', 0.2, 0.07, C.cream, C.red); frameWin(b, 0.8, 0.6, fz, 's', 0.2, 0.07, C.cream, C.red);
  frameWin(b, -0.8, 0.12, fz, 's', 0.16, 0.0); frameWin(b, 0.8, 0.12, fz, 's', 0.16, 0.0);
  for (const sx of [-1, 1]) frameWin(b, sx * (w - 0.4) / 2, 0.62, 0, sx < 0 ? 'w' : 'e', 0.2, 0.07, C.cream, C.red);
  chimney(b, -0.7, 1.0, -0.5, 0.8);
  stackedLogs(b, 1.2, 0.1, 0.7);
  b.box(0, 0.6, h / 2 - 0.12, 0.06, 0.5, 0.06, C.dark); // balcony centre post
}

/** Apartment (3x4): 3-storey block with balconies on every floor, entrance canopy, flat-ish roof, antenna. */
export function apartment(b: PartBuilder, w: number, h: number): void {
  b.box(0, 0, 0, w - 0.3, 2.0, h - 0.4, C.cream);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * (w - 0.3) / 2, 0, sz * (h - 0.4) / 2, 0.14, 2.0, 0.14, C.stone, 'stone'); // quoins
  for (let f = 1; f < 3; f++) b.box(0, f * 0.65 - 0.02, 0, w - 0.26, 0.04, h - 0.36, C.wood); // floor bands
  b.box(0, 2.0, 0, w - 0.1, 0.1, h - 0.2, C.roofGreen, 'roof');
  b.gable(0, 2.1, 0, w - 0.5, h - 0.8, 0.45, C.roofRed, true);
  const fz = (h - 0.4) / 2;
  const cols = [C.orange, C.blue, C.red];
  for (let f = 0; f < 3; f++) {
    if (f > 0) balcony(b, 0, 0.1 + f * 0.65, fz + 0.12, w - 0.8, 0.3, cols[f]!);
    for (const x of [-0.9, 0, 0.9]) if (f > 0 || x !== 0) frameWin(b, x, 0.3 + f * 0.65, fz, 's', 0.2, 0.06, C.white, cols[(f + 1) % 3]);
    for (const z of [-1.0, 0, 1.0]) for (const sx of [-1, 1]) frameWin(b, sx * (w - 0.3) / 2, 0.3 + f * 0.65, z, sx < 0 ? 'w' : 'e', 0.2, 0, C.white);
    for (const x of [-0.7, 0.7]) frameWin(b, x, 0.3 + f * 0.65, -fz, 'n', 0.2);
  }
  doorway(b, 0, fz, 's', 0.4, 0.55, C.dark, C.white);
  b.box(0, 0.62, fz + 0.2, 0.9, 0.05, 0.4, C.roofRed, 'roof'); // entrance canopy
  chimney(b, 1.0, 2.1, -0.7, 0.8);
  b.cyl(-0.8, 2.1, 0.4, 0.015, 0.5, C.grey, 'stone', 4); b.box(-0.8, 2.45, 0.4, 0.3, 0.02, 0.02, C.grey, 'stone');
  b.box(-0.2, 2.1, -0.6, 0.35, 0.18, 0.25, C.grey, 'stone'); // roof vent
}

/** Ski School HQ (3x3): bright red hut, banner pole, bunting, kids' sleds and slalom cones. */
export function skiSchoolHQ(b: PartBuilder, w: number, h: number): void {
  house(b, 0, 0.2, w - 0.6, h - 1.0, 0.8, C.red, C.roofBrown, 0.55, true);
  const fz = 0.2 + (h - 1.0) / 2;
  b.box(0, 0.0, fz + 0.02, w - 0.55, 0.05, 0.03, C.yellow); b.box(0, 0.4, fz + 0.02, w - 0.55, 0.03, 0.03, C.yellow); // colourful bands
  b.sign('SKI SCHOOL', 0, 0.62, fz + 0.05, 0.9, 0.3, 0, '#2d5fa8');
  // banner pole with bunting
  const px = -w / 2 + 0.2, pz = -h / 2 + 0.3;
  b.cyl(px, 0, pz, 0.03, 1.8, C.dark, 'wood', 6);
  b.box(px + 0.23, 1.2, pz, 0.4, 0.5, 0.02, C.blue, 'roof');
  b.box(px + 0.23, 1.45, pz, 0.4, 0.12, 0.025, C.yellow, 'roof');
  for (let i = 0; i < 6; i++) b.cone(px + 0.3 + i * 0.28, 1.45 - Math.sin((i / 5) * Math.PI) * 0.05 - 0.2, pz + 0.35 + i * 0.1, 0.07, 0.16, [C.red, C.yellow, C.green, C.pink, C.orange, C.blue][i]!, 'roof', 4, { rx: Math.PI });
  b.box(w / 2 - 0.3, 0, -h / 2 + 0.3, 0.12, 0.7, 0.12, C.orange);
  // kids' sleds and cones
  [[-0.9, C.red], [-0.45, C.yellow], [0, C.blue]].forEach(([x, c]) => { b.box(x as number, 0.02, h / 2 - 0.25, 0.3, 0.05, 0.5, c as number); b.box(x as number, 0.07, h / 2 - 0.5, 0.3, 0.1, 0.04, c as number); });
  [0.4, 0.7, 1.0, 1.3].forEach((x, i) => b.cone(x, 0, h / 2 - 0.25, 0.09, 0.22, i % 2 ? C.orange : C.red, 'roof', 8));
}

/**
 * Après-Ski Bar (4x3): cosy dark-timber bar under a low gable roof, 'APRÈS SKI' sign, a deck terrace with parasol tables and a patio heater,
 * string lights between posts and hanging lanterns (glass-colour bulbs = warm night glow), skis on the wall, stacked logs and a chimney.
 */
export function apresBar(b: PartBuilder, w: number, h: number): void {
  const wallZ = -0.2, depth = 1.7, front = wallZ + depth / 2; // front wall at z = 0.65
  b.box(0, 0, wallZ, w - 0.5, 0.95, depth, C.dark); // bar hall (dark timber)
  timberFrame(b, 0, wallZ, w - 0.5, depth, 0, 0.95, C.wood, 0.6);
  b.gable(0, 0.95, wallZ, depth + 0.3, w - 0.3, 0.55, C.roofBrown, true);
  b.box(0, 1.48, wallZ, w - 0.25, 0.04, 0.05, C.black, 'roof'); // ridge beam
  // front: door, glowing windows, sign
  doorway(b, 0, front - 0.03, 's', 0.5, 0.62, C.black, C.cream);
  for (const x of [-1.25, -0.65, 0.65, 1.25]) frameWin(b, x, 0.3, front - 0.03, 's', 0.24, 0.07, C.cream, C.red);
  b.sign('APRÈS SKI', 0, 0.95, front + 0.04, 1.5, 0.34, 0, '#7a1f16', '#ffe9a8');
  for (const sx of [-1, 1]) frameWin(b, sx * (w - 0.5) / 2, 0.3, wallZ, sx < 0 ? 'w' : 'e', 0.22);
  // terrace deck with railing, parasol tables, heater
  b.box(0, 0, 1.08, w - 0.3, 0.06, 0.8, C.wood);
  b.fence(-w / 2 + 0.25, h / 2 - 0.05, w / 2 - 0.25, h / 2 - 0.05, C.dark, 0.28, 9);
  parasolTable(b, -1.05, 1.0, C.red, 0); parasolTable(b, 0.35, 1.0, C.blue, 1);
  b.cyl(1.55, 0.06, 1.0, 0.03, 0.9, C.grey, 'wood', 6); b.cone(1.55, 0.92, 1.0, 0.22, 0.16, C.orange, 'roof', 10); // patio heater
  // string lights: four posts, a sagging wire and warm bulbs; lanterns at the door
  const posts = [-1.75, -0.6, 0.6, 1.75];
  for (const x of posts) b.cyl(x, 0.06, h / 2 - 0.08, 0.025, 0.9, C.dark, 'wood', 5);
  for (let i = 0; i < posts.length - 1; i++) {
    for (let k = 0; k <= 4; k++) {
      const t = k / 4, x = posts[i]! + (posts[i + 1]! - posts[i]!) * t, y = 0.93 - 0.1 * Math.sin(Math.PI * t);
      b.box(x, y - 0.05, h / 2 - 0.08, 0.07, 0.07, 0.07, C.glass); // bulb (glow)
    }
    b.beam(posts[i]!, 0.96, h / 2 - 0.08, posts[i + 1]!, 0.96, h / 2 - 0.08, 0.015, C.black, 'wood');
  }
  for (const x of [-0.42, 0.42]) { b.cyl(x, 0.62, front + 0.06, 0.012, 0.18, C.black, 'wood', 4); b.box(x, 0.46, front + 0.06, 0.1, 0.13, 0.1, C.glass); } // door lanterns
  skiRack(b, -1.78, 0.5, 4, 0);
  stackedLogs(b, -1.55, -1.2, 0.8);
  chimney(b, 1.25, 0.9, -0.45, 0.9);
  lampPost(b, 1.9, 0.9, 0.55);
}
