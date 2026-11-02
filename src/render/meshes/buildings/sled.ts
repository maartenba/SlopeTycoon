import { C, PartBuilder, doorway, frameWin, lampPost } from '../common';

/** A parked toboggan (runners, slatted deck, curled nose) facing +z. ~50 triangles. */
function parkedSled(b: PartBuilder, x: number, z: number, color: number, rot = 0): void {
  for (const sx of [-0.07, 0.07]) b.box(x + sx, 0.02, z, 0.02, 0.02, 0.4, C.grey, 'wood', { ry: rot });
  b.box(x, 0.045, z, 0.2, 0.03, 0.36, color, 'wood', { ry: rot });
  b.box(x, 0.08, z + 0.18, 0.18, 0.05, 0.02, color, 'wood', { ry: rot }); // curled nose
}

/**
 * Sled Rental (3x2, docs/sled-runs.md): a timber hut with a snowy gable roof, a counter window, a rack of wooden toboggans, a stack of helmets, a sign and
 * a lamp on a trodden yard. The run itself is the painted layer; the hut opens towards the footpath (+z).
 */
export function sledRental(b: PartBuilder, w: number, h: number): void {
  b.box(0, 0, 0, w - 0.12, 0.03, h - 0.12, C.white, 'stone');
  const hw = 1.3, hd = 0.8, hz = -h / 2 + hd / 2 + 0.08, hx = -w / 2 + hw / 2 + 0.12;
  b.box(hx, 0.03, hz, hw, 0.58, hd, C.wood);
  b.gable(hx, 0.61, hz, hd + 0.14, hw + 0.12, 0.26, C.roofRed, false);
  b.gable(hx, 0.64, hz, hd + 0.2, hw + 0.18, 0.26, C.white, false); // snow cap
  doorway(b, hx - 0.35, hz + hd / 2, 's', 0.2, 0.42, C.dark, C.cream);
  frameWin(b, hx + 0.2, 0.34, hz + hd / 2 + 0.01, 's', 0.2);
  b.box(hx + 0.2, 0.28, hz + hd / 2 + 0.05, 0.34, 0.03, 0.1, C.dark); // counter shelf
  b.sign('SLED RENTAL', hx, 0.56, hz + hd / 2 + 0.07, 0.95, 0.2, 0, '#b5542f');
  // toboggan rack on the right, three leaning on a rail
  b.box(0.95, 0.03, 0.2, 0.04, 0.36, 0.04, C.dark); b.box(0.45, 0.03, 0.2, 0.04, 0.36, 0.04, C.dark); b.box(0.7, 0.32, 0.2, 0.56, 0.04, 0.04, C.dark);
  [0.55, 0.7, 0.85].forEach((x, i) => parkedSled(b, x, 0.32, [C.red, C.blue, C.yellow][i]!, 0));
  // helmet stack and a bench
  [-0.1, 0.02, 0.14].forEach((dx, i) => b.ball(dx, 0.1, 0.45, 0.06, [C.red, C.green, C.orange][i]!, 'roof', 6));
  b.box(-0.05, 0.03, 0.45, 0.5, 0.05, 0.12, C.dark);
  lampPost(b, w / 2 - 0.15, h / 2 - 0.15, 0.5);
}

/**
 * Alpine Coaster station (4x3): a steel-and-timber station building with a roof canopy over a loading platform and a short length of coaster rail with two parked cars,
 * a ticket window, a sign and a lamp. The long rail and the moving cars are drawn by SledRunView / TourVehicles.
 */
export function alpineCoaster(b: PartBuilder, w: number, h: number): void {
  b.box(0, 0, 0, w - 0.14, 0.03, h - 0.14, C.stone, 'stone');
  const bw = 1.6, bd = 0.9, bz = -h / 2 + bd / 2 + 0.1, bx = -w / 2 + bw / 2 + 0.14;
  b.box(bx, 0.03, bz, bw, 0.7, bd, C.grey, 'stone');
  b.gable(bx, 0.73, bz, bd + 0.16, bw + 0.14, 0.28, C.roofBlue, false);
  doorway(b, bx - 0.5, bz + bd / 2, 's', 0.22, 0.46, C.dark, C.cream);
  frameWin(b, bx + 0.15, 0.4, bz + bd / 2 + 0.01, 's', 0.2);
  frameWin(b, bx + 0.6, 0.4, bz + bd / 2 + 0.01, 's', 0.2);
  b.sign('ALPINE COASTER', bx, 0.64, bz + bd / 2 + 0.07, 1.2, 0.22, 0, '#d33a2c');
  // loading platform with a canopy on four posts, and a rail stub with two cars
  const px = 0.9, pz = 0.25;
  b.box(px, 0.03, pz, 1.5, 0.08, 0.8, C.dark);
  for (const dx of [-0.65, 0.65]) for (const dz of [-0.3, 0.3]) b.box(px + dx, 0.11, pz + dz, 0.05, 0.6, 0.05, C.grey);
  b.box(px, 0.71, pz, 1.6, 0.05, 0.9, C.red);
  b.box(px, 0.2, pz, 1.4, 0.025, 0.05, C.grey); // rail
  for (const dx of [-0.35, 0.3]) { b.box(px + dx, 0.22, pz, 0.4, 0.1, 0.22, C.red); b.box(px + dx + 0.18, 0.28, pz, 0.08, 0.08, 0.18, C.red); b.ball(px + dx - 0.05, 0.4, pz, 0.05, C.yellow, 'roof', 6); }
  lampPost(b, -w / 2 + 0.2, h / 2 - 0.2, 0.55);
}
