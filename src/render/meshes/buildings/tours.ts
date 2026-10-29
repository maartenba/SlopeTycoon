import { C, PartBuilder, doorway, frameWin, lampPost } from '../common';

/** A parked quad bike facing +z (body, seat, handlebars, four knobbly wheels, headlight). ~120 triangles. */
export function parkedQuad(b: PartBuilder, x: number, z: number, color: number): void {
  b.box(x, 0.1, z, 0.26, 0.1, 0.5, color);
  b.box(x, 0.2, z - 0.07, 0.2, 0.05, 0.22, C.black); // seat
  b.box(x, 0.2, z + 0.17, 0.2, 0.08, 0.12, color); // tank / front cowl
  b.box(x, 0.28, z + 0.1, 0.34, 0.025, 0.03, C.black); // handlebars
  b.box(x, 0.23, z + 0.1, 0.03, 0.06, 0.03, C.grey);
  b.box(x, 0.2, z + 0.24, 0.06, 0.03, 0.02, C.yellow); // headlight
  for (const sx of [-0.17, 0.17]) for (const sz of [-0.17, 0.17]) b.cyl(x + sx, 0.075 - 0.05, z + sz, 0.075, 0.1, C.black, 'wood', 8, { rz: Math.PI / 2 });
}

/**
 * Quad Base (3x2, docs/quads.md): a timber garage with a roll-up door, two parked quads on a gravel yard, a fuel pump, a tyre stack, a helmet rack and a
 * sign. The ride itself is drawn by TourVehicles; the pad and the garage open towards the footpath / road (+z).
 */
export function quadBase(b: PartBuilder, w: number, h: number): void {
  b.box(0, 0, 0, w - 0.14, 0.03, h - 0.14, C.sand, 'stone'); // gravel yard
  // garage on the north side
  const gw = 1.5, gd = 0.8, gz = -h / 2 + gd / 2 + 0.1, gx = -w / 2 + gw / 2 + 0.12;
  b.box(gx, 0.03, gz, gw, 0.66, gd, C.wood);
  b.gable(gx, 0.69, gz, gd + 0.14, gw + 0.12, 0.26, C.roofGreen, false);
  b.box(gx - 0.1, 0.03, gz + gd / 2 + 0.01, 0.9, 0.52, 0.025, C.grey, 'stone'); // roll-up door
  for (let i = 0; i < 4; i++) b.box(gx - 0.1, 0.12 + i * 0.12, gz + gd / 2 + 0.03, 0.9, 0.015, 0.015, C.dark);
  doorway(b, gx + 0.55, gz + gd / 2, 's', 0.2, 0.42, C.dark, C.cream);
  frameWin(b, gx - 0.55, 0.36, gz + gd / 2 + 0.01, 's', 0.16);
  b.sign('QUAD TOURS', gx, 0.62, gz + gd / 2 + 0.06, 1.0, 0.24, 0, '#4a6b3a');
  // two parked quads, one tilted a little
  parkedQuad(b, 0.35, 0.12, C.green);
  parkedQuad(b, 0.8, 0.32, C.orange);
  // fuel pump
  b.box(1.2, 0.03, -0.35, 0.14, 0.4, 0.12, C.red);
  b.box(1.2, 0.3, -0.35, 0.1, 0.1, 0.01, C.white);
  b.box(1.2, 0.43, -0.35, 0.18, 0.03, 0.16, C.dark);
  // tyre stack, helmet rack
  for (let i = 0; i < 3; i++) b.cyl(-0.6, 0.03 + i * 0.07, 0.62, 0.11, 0.07, C.black, 'wood', 8);
  b.box(0.0, 0.03, -0.62, 0.5, 0.3, 0.04, C.dark);
  [-0.17, 0, 0.17].forEach((dx, i) => b.ball(dx, 0.34, -0.58, 0.06, [C.red, C.yellow, C.blue][i]!, 'roof', 6));
  lampPost(b, w / 2 - 0.15, h / 2 - 0.15, 0.5);
}
