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

/** A hay bale (a box with two darker straps). */
function hay(b: PartBuilder, x: number, y: number, z: number, rot = 0): void {
  b.box(x, y, z, 0.3, 0.16, 0.18, C.yellow, 'wood', { ry: rot });
}

/** A small parked sleigh (runners, curved-ish box, seat) facing +z. ~50 triangles. */
function parkedSleigh(b: PartBuilder, x: number, z: number, color: number): void {
  for (const sx of [-0.1, 0.1]) b.box(x + sx, 0.02, z, 0.03, 0.03, 0.5, C.black);
  b.box(x, 0.06, z, 0.26, 0.1, 0.42, color);
  b.box(x, 0.15, z - 0.2, 0.26, 0.14, 0.03, color); // back rest
  b.box(x, 0.16, z - 0.08, 0.22, 0.03, 0.14, C.dark); // seat
  b.box(x, 0.1, z + 0.26, 0.04, 0.12, 0.03, color); // front curl
}

/**
 * Sleigh Stable (4x3, docs/winter-tours.md): a timber stable with a SNOWY gable roof (white cap), hay bales, a hitching rail, a parked sleigh in the yard,
 * a fence stub and a lamp. The horse sleigh itself is drawn by TourVehicles; the yard opens towards the road / footpath (+z).
 */
export function sleighStable(b: PartBuilder, w: number, h: number): void {
  b.box(0, 0, 0, w - 0.14, 0.03, h - 0.14, C.white, 'stone'); // snowy yard
  const sw = 2.0, sd = 1.0, sx = -w / 2 + sw / 2 + 0.14, sz = -h / 2 + sd / 2 + 0.1;
  b.box(sx, 0.03, sz, sw, 0.7, sd, C.wood);
  b.gable(sx, 0.73, sz, sd + 0.16, sw + 0.16, 0.3, C.roofBrown, false);
  b.gable(sx, 0.76, sz, sd + 0.24, sw + 0.22, 0.3, C.white, false); // the snow load on the roof
  for (const dx of [-0.5, 0.5]) { // two stable doors, upper halves open (dark)
    b.box(sx + dx, 0.03, sz + sd / 2 + 0.01, 0.4, 0.5, 0.025, C.dark);
    b.box(sx + dx, 0.34, sz + sd / 2 + 0.03, 0.34, 0.15, 0.015, C.black);
  }
  frameWin(b, sx + 0.05, 0.4, sz + sd / 2 + 0.01, 's', 0.16);
  b.sign('SLEIGH RIDES', sx, 0.62, sz + sd / 2 + 0.07, 1.0, 0.2, 0, '#8a3b2e');
  // hay bales stacked beside the stable
  hay(b, w / 2 - 0.45, 0.03, -0.55); hay(b, w / 2 - 0.45, 0.19, -0.55); hay(b, w / 2 - 0.75, 0.03, -0.5, 0.2); hay(b, w / 2 - 0.5, 0.03, -0.25, -0.1);
  // hitching rail with a feed trough
  b.box(0.2, 0.03, 0.55, 0.04, 0.3, 0.04, C.dark); b.box(1.0, 0.03, 0.55, 0.04, 0.3, 0.04, C.dark); b.box(0.6, 0.3, 0.55, 0.9, 0.04, 0.04, C.dark);
  b.box(0.6, 0.03, 0.4, 0.4, 0.07, 0.12, C.wood);
  parkedSleigh(b, -0.2, 0.35, C.red);
  // fence stub + snow cap on the fence rail
  for (let i = 0; i < 3; i++) b.box(-w / 2 + 0.2 + i * 0.3, 0.03, h / 2 - 0.15, 0.04, 0.26, 0.04, C.dark);
  b.box(-w / 2 + 0.5, 0.26, h / 2 - 0.15, 0.7, 0.04, 0.05, C.dark);
  lampPost(b, w / 2 - 0.15, h / 2 - 0.15, 0.5);
}

/**
 * Snowshoe Hut (2x2): a small log hut with a snowy roof, a rack of snowshoes and poles leaning at the wall, a signpost and a bench. Guided walks start here.
 */
export function snowshoeHut(b: PartBuilder, w: number, h: number): void {
  b.box(0, 0, 0, w - 0.12, 0.03, h - 0.12, C.white, 'stone');
  const hw = 1.1, hd = 0.8, hz = -h / 2 + hd / 2 + 0.08;
  b.box(0, 0.03, hz, hw, 0.56, hd, C.dark);
  for (let i = 0; i < 4; i++) b.box(0, 0.1 + i * 0.13, hz + hd / 2 + 0.012, hw + 0.04, 0.02, 0.02, C.wood); // log ends
  b.gable(0, 0.59, hz, hd + 0.14, hw + 0.12, 0.24, C.roofBrown, false);
  b.gable(0, 0.62, hz, hd + 0.2, hw + 0.18, 0.24, C.white, false);
  doorway(b, -0.2, hz + hd / 2, 's', 0.22, 0.4, C.black, C.cream);
  frameWin(b, 0.3, 0.33, hz + hd / 2 + 0.01, 's', 0.15);
  b.cyl(0.35, 0.8, hz - 0.1, 0.05, 0.28, C.stone, 'stone', 6); // chimney
  b.sign('SNOWSHOE TOURS', 0, 0.55, hz + hd / 2 + 0.07, 0.9, 0.16, 0, '#44546a');
  // rack with snowshoes (flat teardrop-ish ovals as boxes) and poles
  b.box(0.7, 0.03, 0.15, 0.04, 0.34, 0.04, C.dark); b.box(0.3, 0.03, 0.15, 0.04, 0.34, 0.04, C.dark); b.box(0.5, 0.3, 0.15, 0.5, 0.04, 0.04, C.dark);
  for (const dx of [0.36, 0.5, 0.64]) { b.box(dx, 0.1, 0.15, 0.1, 0.2, 0.025, C.wood); b.box(dx, 0.1, 0.15, 0.06, 0.12, 0.03, C.white); }
  for (const dx of [-0.55, -0.45, -0.35]) b.box(dx, 0.03, 0.1, 0.015, 0.4, 0.015, C.grey, 'wood', { rz: 0.12 });
  // signpost + bench
  b.box(-0.8, 0.03, 0.5, 0.04, 0.5, 0.04, C.dark); b.box(-0.8, 0.4, 0.5, 0.26, 0.09, 0.025, C.yellow);
  b.box(0.4, 0.03, 0.55, 0.4, 0.14, 0.12, C.wood);
}

/** A parked snowscooter facing +z: body, long seat, windscreen, ski + track. ~70 triangles. */
export function parkedScooter(b: PartBuilder, x: number, z: number, color: number): void {
  b.box(x, 0.08, z, 0.22, 0.1, 0.46, color);
  b.box(x, 0.18, z - 0.06, 0.18, 0.04, 0.22, C.black); // seat
  b.box(x, 0.18, z + 0.16, 0.18, 0.08, 0.14, color); // cowl
  b.box(x, 0.24, z + 0.1, 0.1, 0.1, 0.015, C.glass); // windscreen
  b.box(x, 0.02, z - 0.08, 0.14, 0.06, 0.28, C.black); // track
  for (const sx of [-0.1, 0.1]) b.box(x + sx, 0.03, z + 0.22, 0.03, 0.03, 0.26, C.grey); // skis
}

/**
 * Snowscooter Base (3x2): a steel-roofed workshop with a snowy roof, three parked scooters, fuel drums, a helmet rack and a sign.
 */
export function snowscooterBase(b: PartBuilder, w: number, h: number): void {
  b.box(0, 0, 0, w - 0.14, 0.03, h - 0.14, C.white, 'stone');
  const gw = 1.5, gd = 0.8, gz = -h / 2 + gd / 2 + 0.1, gx = -w / 2 + gw / 2 + 0.12;
  b.box(gx, 0.03, gz, gw, 0.62, gd, C.grey, 'stone');
  b.gable(gx, 0.65, gz, gd + 0.14, gw + 0.12, 0.22, C.roofBlue, false);
  b.gable(gx, 0.68, gz, gd + 0.2, gw + 0.18, 0.22, C.white, false);
  b.box(gx - 0.1, 0.03, gz + gd / 2 + 0.01, 0.9, 0.5, 0.025, C.blue);
  for (let i = 0; i < 4; i++) b.box(gx - 0.1, 0.12 + i * 0.11, gz + gd / 2 + 0.03, 0.9, 0.015, 0.015, C.dark);
  doorway(b, gx + 0.55, gz + gd / 2, 's', 0.2, 0.4, C.dark, C.cream);
  b.sign('SNOWSCOOTERS', gx, 0.57, gz + gd / 2 + 0.06, 1.0, 0.2, 0, '#c8452b');
  parkedScooter(b, 0.3, 0.2, C.red); parkedScooter(b, 0.7, 0.3, C.orange); parkedScooter(b, 1.1, 0.15, C.yellow);
  for (const [dx, dz] of [[1.2, -0.45], [1.0, -0.5]] as const) b.cyl(dx, 0.03, dz, 0.07, 0.2, C.red, 'wood', 8); // fuel drums
  b.box(-0.2, 0.03, -0.62, 0.5, 0.3, 0.04, C.dark);
  [-0.17, 0, 0.17].forEach((dx, i) => b.ball(dx - 0.2, 0.34, -0.58, 0.06, [C.red, C.yellow, C.blue][i]!, 'roof', 6));
  lampPost(b, w / 2 - 0.15, h / 2 - 0.15, 0.5);
}
