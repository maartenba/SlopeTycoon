import { C, PartBuilder, awning, balcony, chimney, doorway, flagPole, frameWin, lampPost, parasolTable, wallSlab } from './common';

/**
 * Small Hotel (5x4, Phase 6 Task 27, docs/hotels.md): a two-floor cream hotel under a red gable roof (framed windows on both floors, balconies, a
 * chimney for the lobby kitchen), a glazed lobby / restaurant wing in front with an entrance canopy and a HOTEL sign, a small terrace with parasol
 * tables, a flag and a lamp. Windows are C.glass vertex colours (warm night glow); the roofs are the snow-catching layer.
 */
export function hotelSmall(b: PartBuilder, w: number, h: number): void {
  const bw = 4.6, bd = 2.2, cz = -0.6, wallH = 1.7, fz = cz + bd / 2; // main block: z -1.7 .. 0.5
  b.box(0, 0, cz, bw, wallH, bd, C.cream);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * bw / 2, 0, cz + sz * bd / 2, 0.14, wallH, 0.14, C.stone, 'stone'); // quoins
  b.box(0, 0.84, cz, bw + 0.04, 0.05, bd + 0.04, C.wood); // floor band
  b.box(0, 0, cz, bw + 0.1, 0.18, bd + 0.1, C.stone, 'stone'); // plinth
  b.gable(0, wallH, cz, bd + 0.3, bw + 0.3, 0.62, C.roofRed, true);
  b.box(0, wallH + 0.6, cz, bw + 0.34, 0.04, 0.05, C.dark, 'roof'); // ridge beam
  // windows: two floors on the front, ends and back
  for (let f = 0; f < 2; f++) {
    const y = 0.32 + f * 0.86;
    for (const x of [-1.85, -0.95, 0.95, 1.85]) frameWin(b, x, y, fz, 's', 0.2, 0.06, C.white, f ? C.roofBlue : C.roofGreen);
    if (f === 1) frameWin(b, 0, y, fz, 's', 0.2, 0.06, C.white, C.roofBlue);
    for (const x of [-1.6, -0.55, 0.55, 1.6]) frameWin(b, x, y, cz - bd / 2, 'n', 0.2);
    for (const sx of [-1, 1]) for (const z of [-0.95, -0.2]) frameWin(b, sx * bw / 2, y, cz + z * 0.9 - 0.1, sx < 0 ? 'w' : 'e', 0.2, 0, C.white);
  }
  balcony(b, -1.4, 0.9, fz + 0.12, 1.6, 0.3, C.wood); balcony(b, 1.4, 0.9, fz + 0.12, 1.6, 0.3, C.wood);
  // lobby / restaurant wing in front: low glazed block with a flat roof, canopy and sign
  const lz = fz + 0.55, lw = 2.2, ld = 1.1, lh = 0.92; // z 0.5 .. 1.6
  b.box(0, 0, lz, lw, lh, ld, C.cream);
  b.box(0, lh, lz, lw + 0.16, 0.07, ld + 0.16, C.roofBrown, 'roof');
  const wz = lz + ld / 2;
  for (const x of [-0.8, 0.8]) wallSlab(b, x, 0.2, wz, 's', 0.5, 0.55, 0.05, 0.015, C.glass); // big restaurant panes
  for (const x of [-1.1, 1.1]) b.box(x, 0.0, wz + 0.01, 0.07, lh, 0.06, C.white); // mullions at the corners
  doorway(b, 0, wz, 's', 0.36, 0.55, C.dark, C.white);
  awning(b, 0, 0.66, wz + 0.2, 0.9, 0.34, C.red, C.white); // entrance awning
  b.sign('HOTEL', 0, lh + 0.14, wz - 0.02, 0.9, 0.24, 0, '#2d5fa8', '#ffffff');
  b.box(-0.42, 0.0, wz + 0.34, 0.04, 0.66, 0.04, C.white); b.box(0.42, 0.0, wz + 0.34, 0.04, 0.66, 0.04, C.white);
  // terrace with parasol tables on the right of the wing
  b.box(1.9, 0, 1.1, 1.3, 0.05, 1.4, C.wood);
  parasolTable(b, 1.7, 0.85, C.orange, 0); parasolTable(b, 2.15, 1.45, C.red, 1);
  // chimney (lobby kitchen), flag, lamp
  chimney(b, 1.5, 2.1, cz + 0.05, 0.6);
  flagPole(b, -2.35, 1.0, 1.6, C.red, C.white);
  lampPost(b, -1.4, 1.65, 0.6);
  void w; void h;
}
