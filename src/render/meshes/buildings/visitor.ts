import { C, PartBuilder, curvedRamp, domeCap, doorway, frameWin, railing, tube, windsock } from '../common';

/** M7.4 buildings (docs/m74-buildings.md): Pizzeria, Bakery, Tourist Office, Grass Strip, Skydive Centre, Launch Ramp, Landing Field. All small, all under the 3,000-triangle budget. */

/** Pizzeria (2x2): a cream trattoria with a red roof, a striped awning over a terrace table and a wood-fired oven dome whose chimney is the smoke emitter (catalog chimney). */
export function pizzeria(b: PartBuilder, w: number, h: number): void {
  b.box(0, 0, 0, w - 0.1, 0.03, h - 0.1, C.sand, 'stone');
  const bw = 1.3, bd = 1.0, bx = -0.2, bz = -0.4;
  b.box(bx, 0.03, bz, bw, 0.72, bd, C.cream);
  b.gable(bx, 0.75, bz, bd + 0.16, bw + 0.16, 0.34, C.roofRed, false);
  doorway(b, bx - 0.3, bz + bd / 2, 's', 0.24, 0.46, C.dark, C.white);
  frameWin(b, bx + 0.3, 0.4, bz + bd / 2 + 0.01, 's', 0.2);
  b.sign('PIZZA', bx + 0.35, 0.68, bz + bd / 2 + 0.06, 0.6, 0.18, 0, '#9b2d1f', '#fff4d6');
  // wood-fired oven dome on the right + the flue
  b.cyl(0.62, 0.03, -0.35, 0.26, 0.3, C.stone, 'stone', 10);
  b.ball(0.62, 0.33, -0.35, 0.26, C.roofRed, 'stone', 8);
  b.cyl(0.55, 0.5, -0.4, 0.045, 1.0, C.grey, 'stone', 8); // flue top at y = 1.5 (catalog chimney)
  // terrace: awning + two tables with parasol-less stools
  for (let i = 0; i < 6; i++) b.box(-0.55 + i * 0.22, 0.5, 0.55, 0.22, 0.04, 0.4, i % 2 ? C.white : C.green, 'roof', { rx: 0.3 });
  for (const dx of [-0.35, 0.2]) { b.cyl(dx, 0.03, 0.62, 0.012, 0.26, C.dark, 'wood', 6); b.cyl(dx, 0.29, 0.62, 0.13, 0.025, C.red, 'wood', 8); }
}

/** Bakery (1x2): a narrow shopfront with a blue-and-white awning, bread in the window, a sign and a brick flue. */
export function bakery(b: PartBuilder, w: number, h: number): void {
  b.box(0, 0, 0, w * 0.86, 0.7, h * 0.74, C.cream);
  b.box(0, 0, 0, w * 0.9, 0.05, h * 0.78, C.stone, 'stone');
  b.gable(0, 0.7, 0, w * 0.9, h * 0.8, 0.26, C.roofBlue, false);
  const zf = h * 0.37;
  b.box(0, 0.22, zf + 0.01, 0.5, 0.26, 0.03, C.glass);
  for (let i = 0; i < 5; i++) b.box(-0.2 + i * 0.1, 0.5, zf + 0.1, 0.1, 0.035, 0.22, i % 2 ? C.white : C.blue, 'roof', { rx: 0.3 });
  b.box(-0.12, 0.2, zf + 0.06, 0.12, 0.05, 0.08, C.orange, 'wood'); b.box(0.1, 0.2, zf + 0.06, 0.16, 0.05, 0.08, C.yellow, 'wood'); // loaves
  b.sign('BAKERY', 0, 0.64, zf + 0.05, 0.52, 0.12, 0, '#3d5f86', '#fff4d6');
  b.box(0.2, 0.7, -0.4, 0.14, 0.4, 0.14, C.roofRed, 'stone'); // chimney (catalog chimney y = 1.1)
}

/** Tourist Office (2x2): a small chalet-style kiosk with a big blue 'i' board, a map stand and a flag. */
export function touristOffice(b: PartBuilder, w: number, h: number): void {
  b.box(0, 0, 0, w - 0.1, 0.03, h - 0.1, C.sand, 'stone');
  const bx = -0.1, bz = -0.3;
  b.box(bx, 0.03, bz, 1.3, 0.62, 0.9, C.wood);
  b.gable(bx, 0.65, bz, 1.06, 1.46, 0.34, C.roofGreen, false);
  doorway(b, bx - 0.3, bz + 0.45, 's', 0.22, 0.42, C.dark, C.cream);
  frameWin(b, bx + 0.3, 0.36, bz + 0.46, 's', 0.2);
  b.sign('INFO', bx + 0.3, 0.64, bz + 0.5, 0.45, 0.16, 0, '#2f6fb0', '#ffffff');
  // map stand (post + board) and a flag on a pole
  b.cyl(0.65, 0.03, 0.45, 0.025, 0.5, C.dark, 'wood', 6); b.box(0.65, 0.4, 0.45, 0.4, 0.22, 0.04, C.white); domeCap(b, 0.65, 0.62, 0.45, 0.2, 0.09, C.white, 'wood', 10, 3); b.box(0.65, 0.5, 0.48, 0.28, 0.1, 0.01, C.green); // map stand with a rounded top
  b.cyl(0.05, 0.03, 0.66, 0.02, 0.42, C.dark, 'wood', 6); b.cyl(0.05, 0.485, 0.66, 0.14, 0.03, C.blue, 'wood', 14, { rx: Math.PI / 2 }); b.ball(0.05, 0.545, 0.69, 0.022, C.white, 'wood', 6); b.box(0.05, 0.43, 0.69, 0.035, 0.09, 0.012, C.white, 'wood'); // round blue 'i' board on a post
  for (const x of [-0.78, 0.58]) { b.cyl(x, 0.03, bz + 0.52, 0.045, 0.2, C.wood, 'wood', 8); domeCap(b, x, 0.23, bz + 0.52, 0.06, 0.08, C.green, 'roof', 8, 2); } // barrel planters with shrubs
  b.cyl(bx + 0.62, 0.03, bz + 0.48, 0.02, 0.46, C.dark, 'wood', 6); b.cyl(bx - 0.62, 0.03, bz + 0.48, 0.02, 0.46, C.dark, 'wood', 6); // porch posts
  b.cyl(-0.7, 0.03, 0.55, 0.02, 1.2, C.grey, 'stone', 6); b.box(-0.58, 1.0, 0.55, 0.22, 0.14, 0.01, C.red, 'roof');
}

/** Grass Strip (7x2): a mown runway with two parallel mown lanes (stone-coloured layer reads as dry grass), a small hangar, a windsock and tie-down pegs. */
export function grassStrip(b: PartBuilder, w: number, h: number): void {
  b.box(0, 0, 0.1, w - 0.2, 0.03, h * 0.5, C.green, 'stone'); // the strip
  for (let i = 0; i < 9; i++) b.box(-w / 2 + 0.5 + i * ((w - 1) / 8), 0.035, 0.1, 0.28, 0.01, 0.06, C.white, 'stone'); // centre markers
  // hangar at the left end
  const hx = -w / 2 + 0.7;
  b.box(hx, 0.03, -h / 2 + 0.45, 1.1, 0.5, 0.6, C.stone, 'stone');
  b.gable(hx, 0.53, -h / 2 + 0.45, 0.76, 1.2, 0.26, C.roofBlue, false);
  b.box(hx, 0.05, -h / 2 + 0.76, 0.5, 0.36, 0.02, C.dark);
  // windsock: pole + orange cone
  windsock(b, w / 2 - 0.6, 0.03, -h / 2 + 0.3, 0.8);
}

/** Skydive Centre (3x2): office + packing hangar with a red-and-white roof, a parachute packing table, a stack of rigs and a sign. */
export function skydiveCentre(b: PartBuilder, w: number, h: number): void {
  b.box(0, 0, 0, w - 0.1, 0.03, h - 0.1, C.sand, 'stone');
  const bx = -0.35, bz = -0.35;
  b.box(bx, 0.03, bz, 1.5, 0.7, 0.8, C.white);
  b.gable(bx, 0.73, bz, 0.96, 1.62, 0.3, C.red, false);
  doorway(b, bx - 0.45, bz + 0.4, 's', 0.26, 0.5, C.dark, C.cream);
  frameWin(b, bx + 0.25, 0.38, bz + 0.41, 's', 0.2);
  b.sign('SKYDIVE', bx + 0.35, 0.67, bz + 0.45, 0.7, 0.16, 0, '#1f4e8c', '#ffffff');
  // packing table with a spread canopy (flat coloured patches) + a few rigs
  b.box(0.8, 0.03, 0.4, 0.8, 0.22, 0.4, C.wood);
  b.box(0.8, 0.26, 0.4, 0.74, 0.02, 0.34, C.orange, 'roof'); b.box(0.8, 0.27, 0.4, 0.3, 0.01, 0.34, C.blue, 'roof');
  [-0.1, 0.0, 0.1].forEach((dx, i) => b.box(-0.8 + dx, 0.03, 0.55, 0.09, 0.16, 0.07, [C.red, C.blue, C.yellow][i]!, 'roof'));
}

/** Launch Ramp (2x2): a timber ramp running out to a drop-off edge, a rail, a windsock and a folded wing leaning on a rack. */
export function launchRamp(b: PartBuilder, w: number, h: number): void {
  b.box(0, 0, -0.1, w - 0.2, 0.2, h - 0.5, C.wood); // deck
  for (let i = 0; i < 4; i++) b.box(0, 0.2, -0.6 + i * 0.3, w - 0.3, 0.012, 0.015, C.dark); // plank seams
  curvedRamp(b, 0, 0.06, 0.62, 0.8, 0.14, 0.9, C.wood, Math.PI / 2, false, 4); // the downhill run-out: a smooth convex roll-over (M8)
  for (const dx of [-0.5, 0.5]) { railing(b, dx, -0.3, dx, 0.95, 0.2, 0.3, C.dark, 4); } // round side rails
  for (const sx of [-1, 1]) b.box(sx * 0.62, 0.0, 0.2, 0.06, 0.2, 0.1, C.dark); // deck legs
  b.box(0, 0.2, 0.98, 0.95, 0.04, 0.05, C.orange, 'roof'); // edge trim
  const sx = -w / 2 + 0.25;
  b.cyl(sx, 0.2, -0.65, 0.02, 0.8, C.grey, 'stone', 6);
  b.box(sx + 0.15, 0.93, -0.65, 0.28, 0.09, 0.09, C.orange, 'roof', { rz: 0.1 });
  windsock(b, w / 2 - 0.25, 0.2, -0.65, 0.7);
  // folded wing leaning on a rack: two curved panels (tapered ellipse-ish) on a tube frame
  b.box(0.55, 0.2, -0.55, 0.5, 0.04, 0.3, C.blue, 'roof', { rz: 0.25 }); b.box(0.55, 0.34, -0.55, 0.24, 0.02, 0.3, C.yellow, 'roof', { rz: 0.25 });
  tube(b, 0.3, 0.2, -0.7, 0.45, 0.5, -0.7, 0.014, C.dark, 'wood', 5); tube(b, 0.8, 0.2, -0.7, 0.65, 0.5, -0.7, 0.014, C.dark, 'wood', 5);
  b.sign('FLY', 0, 0.45, -0.7, 0.3, 0.12, 0, '#2f6fb0', '#ffffff');
}

/** Landing Field (4x4): a flat mown meadow with a white target circle, a windsock and a bench. */
export function landingField(b: PartBuilder, w: number, h: number): void {
  b.box(0, 0, 0, w - 0.2, 0.03, h - 0.2, C.green, 'stone');
  b.ring(0, 0.03, 0, 0.9, 0.05, C.white, 'stone', 20, { rx: 0 });
  b.ring(0, 0.03, 0, 0.45, 0.05, C.red, 'stone', 16, { rx: 0 });
  const sx = w / 2 - 0.5, sz = -h / 2 + 0.5;
  windsock(b, sx, 0.03, sz, 0.8); // striped tapered windsock (M8)
  b.box(-w / 2 + 0.6, 0.03, h / 2 - 0.4, 0.6, 0.14, 0.2, C.wood);
  b.box(-w / 2 + 0.6, 0.17, h / 2 - 0.48, 0.6, 0.12, 0.04, C.wood);
}
