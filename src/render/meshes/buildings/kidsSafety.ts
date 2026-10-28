import { C, PartBuilder, awning, chimney, doorway, flagPole, frameWin, redCross } from '../common';

/** Magic Carpet (1x6): conveyor belt with chevrons, side walls, a glazed canopy tunnel over the loading end and drive housings. */
export function magicCarpet(b: PartBuilder, _w: number, h: number): void {
  const L = h - 0.4;
  b.box(0, 0.05, 0, 0.5, 0.12, L, C.black);
  b.box(0, 0.17, 0, 0.4, 0.03, L, C.orange);
  for (let i = 0; i < 12; i++) b.box(0, 0.2, -L / 2 + 0.2 + i * (L / 12), 0.4, 0.015, 0.06, i % 2 ? C.yellow : C.red);
  for (const x of [-0.27, 0.27]) { b.box(x, 0.12, 0, 0.04, 0.2, L, C.blue); b.box(x, 0.32, 0, 0.03, 0.02, L, C.white); }
  // canopy tunnel over the loading end: ribs, sloped perspex roof, end beams
  const z0 = L / 2 - 1.6, z1 = L / 2 - 0.1;
  for (let z = z0; z <= z1 + 0.01; z += 0.5) {
    for (const x of [-0.3, 0.3]) b.box(x, 0, z, 0.05, 0.62, 0.05, C.dark);
    b.box(0, 0.6, z, 0.72, 0.05, 0.05, C.dark);
    for (const s of [-1, 1]) b.box(s * 0.27, 0.62, z, 0.3, 0.04, 0.04, C.red, 'wood', { rz: -s * 0.35 });
  }
  b.box(0, 0.7, (z0 + z1) / 2, 0.9, 0.04, z1 - z0 + 0.15, C.red, 'roof');
  b.gable(0, 0.74, (z0 + z1) / 2, 0.9, z1 - z0 + 0.1, 0.12, C.roofRed, false);
  for (const x of [-0.31, 0.31]) b.box(x, 0.2, (z0 + z1) / 2, 0.02, 0.4, z1 - z0, 0xbfe3f5);
  // drive housing at the top, return pulley at the bottom
  b.box(0, 0, -L / 2 + 0.1, 0.5, 0.35, 0.3, C.grey, 'stone');
  b.cyl(0, 0.1, L / 2 - 0.02, 0.1, 0.5, C.dark, 'stone', 8, { rz: Math.PI / 2 });
  b.sign('MAGIC CARPET', 0, 0.95, z1 + 0.12, 0.7, 0.28, 0, '#d9453a');
  b.box(0, 0.0, z1 + 0.11, 0.05, 0.95, 0.03, C.dark);
}

/** Kids Ground (4x4): fenced play slope with slide, rope tow, tiny hut, snowman, cones. */
export function kidsGround(b: PartBuilder, w: number, h: number): void {
  b.box(0, 0, 0, w - 0.3, 0.04, h - 0.3, C.white);
  const x = w / 2 - 0.2, z = h / 2 - 0.2;
  b.fence(-x, -z, x, -z, C.red, 0.3, 8); b.fence(-x, z, x, z, C.yellow, 0.3, 8);
  b.fence(-x, -z, -x, z, C.blue, 0.3, 8); b.fence(x, -z, x, z, C.green, 0.3, 8);
  // slide
  b.box(-1, 0, -1, 0.5, 0.6, 0.5, C.blue);
  b.box(-1, 0.6, -1, 0.56, 0.04, 0.56, C.red, 'roof');
  b.wedge(-1, 0.04, -0.4, 0.9, 0.55, 0.3, C.red, Math.PI / 2 * 3, 'wood');
  // little hill + rope tow
  b.wedge(0.9, 0.04, -0.4, 1.6, 0.5, 1.3, C.white, Math.PI, 'stone');
  for (const pz of [-1.0, 0.4]) { b.cyl(0.35, 0.04, pz, 0.03, 0.55, C.dark, 'wood', 6); b.box(0.35, 0.56, pz, 0.14, 0.04, 0.14, C.yellow); }
  b.box(0.35, 0.5, -0.3, 0.02, 0.02, 1.4, C.black);
  for (let i = 0; i < 3; i++) b.box(0.35, 0.34, -0.8 + i * 0.5, 0.05, 0.14, 0.03, C.red);
  // cones
  [[0.3, 0.2], [0.8, 0.5], [1.3, 0.2], [0.5, 0.9], [1.1, 0.9]].forEach(([px, pz], i) => b.cone(px! - 0.2, 0.04, pz! + 0.6, 0.1, 0.25, i % 2 ? C.orange : C.pink, 'roof', 8));
  // mini hut + snowman
  b.box(1.2, 0, -1.2, 0.6, 0.4, 0.6, C.green);
  b.gable(1.2, 0.4, -1.2, 0.7, 0.7, 0.3, C.roofRed, true);
  frameWin(b, 1.2, 0.15, -0.9, 's', 0.14);
  b.ball(-1.2, 0.04, 1.0, 0.16, C.white, 'stone'); b.ball(-1.2, 0.3, 1.0, 0.11, C.white, 'stone');
  b.cone(-1.2, 0.34, 1.1, 0.025, 0.1, C.orange, 'roof', 5, { rx: Math.PI / 2 });
  b.cyl(-1.2, 0.5, 1.0, 0.06, 0.06, C.blue, 'wood', 6);
}

/** Playground (3x3): swing set, slide, sandpit, merry-go-round, seesaw, spring rider and a bench. */
export function playground(b: PartBuilder, w: number, h: number): void {
  b.box(0, 0, 0, w - 0.3, 0.05, h - 0.3, C.sand);
  for (const x of [-1.0, -0.2]) { b.box(x, 0, -0.8, 0.05, 0.8, 0.05, C.red, 'wood', { rz: 0.2 }); b.box(x, 0, -0.8, 0.05, 0.8, 0.05, C.red, 'wood', { rz: -0.2 }); }
  b.box(-0.6, 0.8, -0.8, 1.0, 0.05, 0.05, C.red);
  for (const x of [-0.8, -0.4]) { b.box(x, 0.25, -0.8, 0.02, 0.55, 0.02, C.dark); b.box(x, 0.2, -0.8, 0.2, 0.04, 0.1, C.yellow); }
  b.box(0.8, 0, 0.2, 0.4, 0.55, 0.4, C.blue);
  b.box(0.8, 0.55, 0.2, 0.46, 0.04, 0.46, C.red, 'roof');
  b.wedge(0.8, 0.05, 0.7, 0.6, 0.5, 0.25, C.yellow, Math.PI / 2 * 3, 'wood');
  b.cyl(-0.6, 0.05, 0.6, 0.35, 0.06, C.green); b.cyl(-0.6, 0.05, 0.6, 0.03, 0.3, C.dark, 'wood', 6);
  b.box(0.4, 0.2, -0.7, 0.9, 0.05, 0.12, C.orange, 'wood', { rz: 0.2 }); b.box(0.4, 0, -0.7, 0.1, 0.18, 0.12, C.dark);
  // sandpit with border, spring rider, bench
  b.box(0.7, 0.04, -0.2, 0.7, 0.03, 0.5, 0xf6e6b0, 'stone');
  for (const [sx, sz, lx, lz] of [[0.7, -0.45, 0.76, 0.05], [0.7, 0.05, 0.76, 0.05], [0.33, -0.2, 0.05, 0.5], [1.07, -0.2, 0.05, 0.5]] as const) b.box(sx, 0.04, sz, lx, 0.1, lz, C.wood);
  b.cyl(-1.2, 0.05, 0.1, 0.02, 0.25, C.grey, 'stone', 6); b.ball(-1.2, 0.3, 0.1, 0.12, C.pink);
  b.box(0, 0.12, 1.15, 0.8, 0.04, 0.2, C.wood); b.box(0, 0.2, 1.25, 0.8, 0.15, 0.03, C.wood);
  for (const x of [-0.35, 0.35]) b.box(x, 0.05, 1.15, 0.05, 0.08, 0.15, C.dark);
  b.fence(-w / 2 + 0.2, h / 2 - 0.1, w / 2 - 0.2, h / 2 - 0.1, C.green, 0.25, 8);
}

/** Ski Patrol Hub (3x2): red station with a white roof, red cross, flag, sled rack and an ambulance garage with a parked ambulance. */
export function patrolHub(b: PartBuilder, w: number, h: number): void {
  b.box(-0.3, 0, 0, w - 1.2, 0.8, h - 0.4, C.red);
  b.box(-0.3, 0.8, 0, w - 1.0, 0.1, h - 0.2, C.white, 'roof');
  b.gable(-0.3, 0.9, 0, h - 0.5, w - 1.2, 0.3, C.roofRed, true);
  redCross(b, -0.3, 0.25, h / 2 - 0.19, 0.45, 's');
  b.sign('PATROL', -1.0, 0.5, h / 2 - 0.19, 0.6, 0.26, 0, '#ffffff', '#c0392b');
  frameWin(b, 0.2, 0.4, h / 2 - 0.2, 's', 0.18, 0.0, C.white);
  frameWin(b, -0.3, 0.2, -h / 2 + 0.2, 'n', 0.2);
  // garage wing with roll-up door
  b.box(1.0, 0, 0, 1.2, 0.7, h - 0.4, C.white);
  b.box(1.0, 0.7, 0, 1.3, 0.06, h - 0.2, C.roofRed, 'roof');
  b.box(1.0, 0, h / 2 - 0.19, 0.9, 0.55, 0.05, C.grey, 'stone');
  for (let i = 0; i < 4; i++) b.box(1.0, 0.08 + i * 0.13, h / 2 - 0.16, 0.9, 0.02, 0.03, C.dark);
  b.box(1.0, 0.58, h / 2 - 0.16, 1.0, 0.04, 0.05, C.red);
  // ambulance parked outside, turned sideways
  b.box(1.0, 0.04, h / 2 + 0.3, 0.85, 0.2, 0.42, C.white, 'wood');
  b.box(1.25, 0.2, h / 2 + 0.3, 0.3, 0.14, 0.38, C.glass);
  b.box(1.0, 0.24, h / 2 + 0.3, 0.45, 0.1, 0.4, C.white);
  b.box(1.0, 0.14, h / 2 + 0.51, 0.5, 0.05, 0.02, C.red); b.box(1.0, 0.31, h / 2 + 0.3, 0.1, 0.04, 0.2, C.red, 'roof');
  for (const wx of [0.7, 1.3]) for (const wz of [h / 2 + 0.09, h / 2 + 0.51]) b.cyl(wx, 0, wz, 0.06, 0.05, C.black, 'wood', 6, { rx: Math.PI / 2 });
  // flag + sled rack (rescue toboggans)
  flagPole(b, -w / 2 + 0.3, -0.2, 0.9, C.red, C.white, 0.9);
  for (const z of [-0.4, 0.0, 0.4]) b.box(-w / 2 - 0.1, 0.02, z, 0.1, 0.04, 0.6, C.red, 'wood', { rz: 0.1 });
  b.box(-w / 2 - 0.1, 0.0, 0, 0.04, 0.3, 1.2, C.dark);
}

/** First-Aid Hut (2x2): small white hut with red crosses, door, window, bench and a rescue sled. */
export function firstAid(b: PartBuilder, w: number, h: number): void {
  b.box(0, 0, 0, w - 0.6, 0.6, h - 0.6, C.white);
  b.gable(0, 0.6, 0, h - 0.5, w - 0.5, 0.4, C.roofRed, true);
  const fz = (h - 0.6) / 2;
  redCross(b, -0.25, 0.28, fz + 0.01, 0.35, 's');
  doorway(b, 0.35, fz, 's', 0.22, 0.4, C.dark, C.red);
  redCross(b, 0, 0.78, fz + 0.12, 0.2, 's'); // roof-front plate
  redCross(b, (w - 0.6) / 2 + 0.01, 0.25, 0, 0.3, 'e');
  frameWin(b, -(w - 0.6) / 2, 0.25, 0, 'w', 0.18);
  chimney(b, -0.3, 0.6, -0.2, 0.3);
  flagPole(b, 0.55, -0.4, 0.5, C.red, C.white, 0.6);
  b.box(-0.3, 0.1, fz + 0.3, 0.5, 0.03, 0.14, C.wood); b.box(-0.3, 0.0, fz + 0.3, 0.5, 0.1, 0.03, C.dark);
  b.box(0.7, 0.0, 0.3, 0.12, 0.03, 0.5, C.red, 'wood', { rz: 0.15 }); // rescue sled
}

/** Warning sign (1x1): red warning triangle with an avalanche pictogram, an info plate and striped marker stakes. */
export function warningSign(b: PartBuilder): void {
  b.cyl(0, 0, 0, 0.04, 1.0, C.dark, 'wood', 6);
  b.gable(0, 0.58, 0.02, 0.7, 0.04, 0.6, C.red, false, 'wood');
  b.gable(0, 0.64, 0.045, 0.5, 0.03, 0.42, C.white, false, 'wood');
  b.gable(0, 0.66, 0.065, 0.3, 0.02, 0.22, C.black, false, 'wood'); // mountain
  for (const [x, y] of [[0.12, 0.73], [0.17, 0.69], [0.08, 0.7]] as const) b.box(x, y, 0.08, 0.05, 0.05, 0.02, C.black); // tumbling snow blocks
  b.sign('!', 0, 0.35, 0.05, 0.28, 0.2, 0, '#f2c14e', '#2a2a2e');
  for (const x of [-0.38, 0.38]) { b.cyl(x, 0, 0.1, 0.025, 0.7, C.red, 'wood', 6); b.cyl(x, 0.3, 0.1, 0.027, 0.12, C.black, 'wood', 6); b.cyl(x, 0.55, 0.1, 0.027, 0.12, C.black, 'wood', 6); }
  b.box(0, 0, 0, 0.2, 0.06, 0.2, C.stone, 'stone');
}

/** Ticket Office (2x2): booth with ticket windows, awning, turnstiles and queue barriers. */
export function ticketOffice(b: PartBuilder, w: number, h: number): void {
  b.box(0, 0, -0.2, w - 0.8, 0.75, h - 0.9, C.green);
  b.box(0, 0.75, -0.1, w - 0.3, 0.07, h - 0.4, C.roofRed, 'roof');
  const fz = -0.2 + (h - 0.9) / 2;
  for (const x of [-0.3, 0.3]) { frameWin(b, x, 0.28, fz, 's', 0.25, 0, C.white); b.box(x, 0.2, fz + 0.1, 0.34, 0.03, 0.14, C.wood); }
  b.box(0, 0.88, h / 2 - 0.55, 1.2, 0.3, 0.04, C.dark);
  b.sign('TICKETS', 0, 0.88, h / 2 - 0.52, 1.1, 0.3);
  awning(b, 0.0, 0.62, h / 2 - 0.62, 1.2, 0.3, C.yellow, C.white);
  // turnstiles
  for (const x of [-0.5, 0.0, 0.5]) {
    b.box(x, 0, h / 2 - 0.2, 0.06, 0.4, 0.06, C.grey, 'stone');
    for (let a = 0; a < 3; a++) b.box(x, 0.35, h / 2 - 0.2, 0.2, 0.02, 0.02, C.dark, 'wood', { ry: a * Math.PI / 3 });
  }
  b.fence(-0.8, h / 2 - 0.05, 0.8, h / 2 - 0.05, C.red, 0.3, 4);
  b.box(w / 2 - 0.15, 0, -0.2, 0.05, 0.9, 0.05, C.dark); b.box(w / 2 - 0.15, 0.55, -0.2, 0.02, 0.3, 0.3, C.white); // price board
}

/** Toilets (1x1): a small timber hut with a pitched roof, a door with a crescent plate, a high vent slit and a hand-wash trough (about 120 triangles). */
export function toilets(b: PartBuilder, w: number, h: number): void {
  const bw = Math.min(0.62, w - 0.3), bd = Math.min(0.58, h - 0.34);
  b.box(0, 0, -0.06, bw, 0.62, bd, C.wood);
  b.gable(0, 0.62, -0.06, bd + 0.1, bw + 0.12, 0.22, C.roofRed, false);
  const fz = -0.06 + bd / 2;
  doorway(b, 0, fz, 's', 0.2, 0.4, C.dark, C.white);
  b.box(0, 0.4, fz + 0.015, 0.07, 0.07, 0.015, C.yellow); // crescent plate stand-in
  b.box(0, 0.5, -0.06 + bd / 2 + 0.01, 0.3, 0.04, 0.02, C.dark); // vent slit
  b.box(0.3, 0.0, 0.34, 0.26, 0.1, 0.1, C.stone, 'stone'); // wash trough
}
