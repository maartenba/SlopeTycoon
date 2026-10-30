import { C, PartBuilder, doorway, frameWin, lampPost } from '../common';

/** A raft stacked upright / lying on the bank (4 inflatable tubes round a floor). Local x / z = centre. ~60 triangles. */
function parkedRaft(b: PartBuilder, x: number, z: number, color: number, ry = 0): void {
  const len = 0.62, wid = 0.36, t = 0.07;
  const o = { ry };
  b.box(x, 0.05, z, len - 0.06, 0.02, wid - 0.06, C.dark, 'wood', o);
  const c = Math.cos(ry), s = Math.sin(ry);
  const at = (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c];
  for (const sz of [-1, 1]) { const [px, pz] = at(0, sz * (wid / 2 - t / 2)); b.box(px, 0.04, pz, len, t, t, color, 'roof', o); }
  for (const sx of [-1, 1]) { const [px, pz] = at(sx * (len / 2 - t / 2), 0); b.box(px, 0.04, pz, t, t, wid, color, 'roof', o); }
}

/**
 * Rafting Base (3x2, docs/water-tours.md): a timber boathouse with a green roof and a "RAFTING" sign, a rack with two stacked rafts, rafts on the bank,
 * a heap of paddles and life jackets on a hanging rail, a boat trailer and a lamp. The rafts on the water are drawn by TourVehicles; the put-in is the river tile nearby.
 */
export function raftingBase(b: PartBuilder, w: number, h: number): void {
  b.box(0, 0, 0, w - 0.14, 0.03, h - 0.14, C.sand, 'stone'); // gravel yard
  const hw = 1.5, hd = 0.8, hx = -w / 2 + hw / 2 + 0.12, hz = -h / 2 + hd / 2 + 0.1;
  b.box(hx, 0.03, hz, hw, 0.62, hd, C.wood);
  b.gable(hx, 0.65, hz, hd + 0.14, hw + 0.12, 0.28, C.roofGreen, false);
  b.box(hx - 0.18, 0.03, hz + hd / 2 + 0.01, 0.62, 0.46, 0.025, C.dark); // wide boat door
  doorway(b, hx + 0.5, hz + hd / 2, 's', 0.2, 0.4, C.dark, C.cream);
  frameWin(b, hx - 0.58, 0.34, hz + hd / 2 + 0.01, 's', 0.15);
  b.sign('RAFTING', hx, 0.58, hz + hd / 2 + 0.06, 0.96, 0.22, 0, '#2a5d86');
  // raft rack: two posts, two stacked rafts
  b.box(0.95, 0.03, -0.3, 0.05, 0.5, 0.05, C.dark); b.box(0.95, 0.03, 0.0, 0.05, 0.5, 0.05, C.dark);
  b.box(0.95, 0.3, -0.15, 0.06, 0.03, 0.4, C.dark);
  parkedRaft(b, 0.95, -0.15, C.orange, Math.PI / 2);
  // rafts resting on the bank
  parkedRaft(b, 0.3, 0.42, C.yellow, 0.2);
  parkedRaft(b, 0.95, 0.5, C.red, -0.25);
  // paddles leaning on a rail, life jackets (orange boxes) on a hanging rail
  b.box(-0.55, 0.03, 0.55, 0.5, 0.02, 0.04, C.dark);
  for (let i = 0; i < 4; i++) { b.box(-0.75 + i * 0.13, 0.03, 0.56, 0.03, 0.4, 0.015, C.wood); b.box(-0.75 + i * 0.13, 0.4, 0.56, 0.06, 0.07, 0.015, [C.red, C.blue, C.yellow, C.green][i]!); }
  for (let i = 0; i < 3; i++) b.box(-0.3 + i * 0.12, 0.3, -0.62, 0.09, 0.14, 0.04, C.orange);
  b.box(-0.2, 0.45, -0.62, 0.45, 0.02, 0.03, C.dark);
  lampPost(b, w / 2 - 0.15, h / 2 - 0.15, 0.5);
}

/**
 * Canyoning Base (2x2): a small stone and timber hut with a wetsuit rack, a coiled-rope rack, helmets, a dry bag stack, an anchor post and an abseil ladder frame. "CANYONING" sign.
 */
export function canyoningBase(b: PartBuilder, w: number, h: number): void {
  b.box(0, 0, 0, w - 0.12, 0.03, h - 0.12, C.sand, 'stone');
  const hw = 1.1, hd = 0.7, hx = -w / 2 + hw / 2 + 0.1, hz = -h / 2 + hd / 2 + 0.08;
  b.box(hx, 0.03, hz, hw, 0.34, hd, C.stone, 'stone');
  b.box(hx, 0.37, hz, hw, 0.28, hd, C.wood);
  b.gable(hx, 0.65, hz, hd + 0.12, hw + 0.1, 0.26, C.roofBlue, false);
  doorway(b, hx + 0.32, hz + hd / 2, 's', 0.18, 0.4, C.dark, C.cream);
  frameWin(b, hx - 0.3, 0.38, hz + hd / 2 + 0.01, 's', 0.15);
  b.sign('CANYONING', hx, 0.58, hz + hd / 2 + 0.06, 0.9, 0.2, 0, '#2a5d86');
  // wetsuit rack: a bar with three suits
  b.box(0.3, 0.03, 0.2, 0.04, 0.5, 0.04, C.dark); b.box(0.82, 0.03, 0.2, 0.04, 0.5, 0.04, C.dark); b.box(0.56, 0.5, 0.2, 0.56, 0.03, 0.04, C.dark);
  for (let i = 0; i < 3; i++) { b.box(0.4 + i * 0.16, 0.26, 0.2, 0.09, 0.24, 0.04, C.black); b.box(0.4 + i * 0.16, 0.18, 0.2, 0.05, 0.1, 0.04, [C.orange, C.blue, C.yellow][i]!); }
  // helmets and rope coils on a bench, dry bags
  b.box(0.5, 0.03, 0.62, 0.7, 0.14, 0.18, C.dark);
  [-0.2, -0.05, 0.1].forEach((dx, i) => b.ball(0.45 + dx + 0.2, 0.24, 0.62, 0.06, [C.red, C.yellow, C.blue][i]!, 'roof', 6));
  b.cyl(0.9, 0.03, 0.6, 0.09, 0.16, C.orange, 'roof', 8); b.cyl(0.9, 0.19, 0.6, 0.07, 0.12, C.yellow, 'roof', 8);
  b.cyl(-0.6, 0.03, 0.55, 0.08, 0.18, C.blue, 'roof', 8); b.cyl(-0.4, 0.03, 0.6, 0.08, 0.14, C.red, 'roof', 8);
  // anchor post with a rope loop and a short ladder frame
  b.box(-0.05, 0.03, 0.2, 0.05, 0.5, 0.05, C.grey, 'stone'); b.box(-0.05, 0.3, 0.2, 0.2, 0.02, 0.02, C.red);
  lampPost(b, w / 2 - 0.15, h / 2 - 0.15, 0.45);
}
