import { C, PartBuilder, flagPole } from './common';

/**
 * Viewpoint (2x2, about 330 triangles): a raised timber platform on stone footings, a railing on three sides (the open side faces +z, the view),
 * a coin-operated telescope on a pedestal at the rail, a bench, a signpost and a small flag. Meant for a ridge: it works as a hiker destination and a photo spot.
 */
export function viewpoint(b: PartBuilder, w: number, h: number): void {
  const x0 = -w / 2 + 0.12, x1 = w / 2 - 0.12, z0 = -h / 2 + 0.12, z1 = h / 2 - 0.12, deck = 0.14;
  // footings + deck planks
  for (const [fx, fz] of [[x0 + 0.1, z0 + 0.1], [x1 - 0.1, z0 + 0.1], [x0 + 0.1, z1 - 0.1], [x1 - 0.1, z1 - 0.1]] as const) b.box(fx, 0, fz, 0.18, deck - 0.02, 0.18, C.stone, 'stone');
  b.box(0, deck - 0.03, 0, x1 - x0, 0.05, z1 - z0, C.wood);
  for (let i = 1; i < 5; i++) b.box(0, deck + 0.02, z0 + ((z1 - z0) * i) / 5, x1 - x0 - 0.02, 0.012, 0.02, C.dark); // plank gaps
  // railing: back and both sides (posts + two rails), open at the front
  const top = deck + 0.02, rail = 0.34;
  for (const [px, pz] of [[x0, z0], [0, z0], [x1, z0], [x0, 0], [x1, 0], [x0, z1], [x1, z1]] as const) b.box(px, top, pz, 0.06, rail, 0.06, C.dark);
  for (const y of [0.16, 0.31]) {
    b.box(0, top + y, z0, x1 - x0, 0.04, 0.04, C.wood);
    b.box(x0, top + y, 0, 0.04, 0.04, z1 - z0, C.wood);
    b.box(x1, top + y, 0, 0.04, 0.04, z1 - z0, C.wood);
  }
  // telescope on a pedestal (front left): a barrel tilted up and out over the view
  const tx = x0 + 0.38, tz = z1 - 0.28;
  b.cyl(tx, top, tz, 0.07, 0.4, C.grey, 'stone', 8);
  b.cyl(tx, top + 0.4, tz, 0.095, 0.05, C.dark, 'stone', 8);
  b.cyl(tx, top + 0.4 - 0.2 + 0.25 - 0.06, tz + 0.12, 0.055, 0.42, C.black, 'stone', 8, { rx: Math.PI / 2 - 0.35 });
  b.cyl(tx, top + 0.46 - 0.06 + 0.1, tz + 0.3, 0.075, 0.07, C.yellow, 'stone', 8, { rx: Math.PI / 2 - 0.35 }); // brass lens ring
  // bench against the back rail
  b.box(0.28, top, z0 + 0.22, 0.7, 0.05, 0.2, C.wood);
  for (const s of [-0.28, 0.28]) b.box(0.28 + s, top, z0 + 0.22, 0.06, 0.16, 0.18, C.dark);
  b.box(0.28, top + 0.12, z0 + 0.12, 0.7, 0.1, 0.03, C.wood);
  // signpost with the name + a flag
  b.box(x1 - 0.12, top, z1 - 0.1, 0.06, 0.55, 0.06, C.dark);
  b.sign('VIEW', x1 - 0.12, top + 0.5, z1 - 0.06, 0.36, 0.14);
  flagPole(b, x0 + 0.1, z0 + 0.1, 0.75, C.red, C.white, top);
  // a stone step at the open front edge
  b.box(0.2, 0, z1 + 0.03, 0.6, 0.07, 0.14, C.stone, 'stone');
}
