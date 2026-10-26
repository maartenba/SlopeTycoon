import { C, PartBuilder, awning, chimney, doorway, frameWin, lampPost, parasolTable, picnicTable } from '../common';

/** Boat Rental (2x2): boathouse with a long jetty, moored rowing boats and a canoe rack. */
export function boatRental(b: PartBuilder, w: number, h: number): void {
  b.box(-0.4, 0, -0.4, 0.8, 0.5, 0.8, C.blue);
  b.gable(-0.4, 0.5, -0.4, 0.9, 0.9, 0.3, C.roofRed, false);
  b.sign('BOATS', -0.4, 0.2, 0.01, 0.6, 0.2, 0);
  doorway(b, -0.65, 0.0, 's', 0.2, 0.35, C.dark);
  b.box(-0.4, 0.3, 0.07, 0.04, 0.04, 0.2, C.dark); // sign bracket
  awning(b, -0.4, 0.38, 0.12, 0.5, 0.2, C.red, C.white);
  b.box(0.5, 0.08, 0, 0.5, 0.06, h - 0.1, C.wood); // jetty deck
  for (let i = 0; i < 4; i++) b.box(0.5, 0.0, -h / 2 + 0.2 + i * 0.5, 0.56, 0.1, 0.04, C.dark);
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) b.cyl(0.5 + s * 0.27, -0.1, -h / 2 + 0.2 + i * 0.5, 0.025, 0.3, C.dark, 'wood', 5); // piles
  b.box(0.5, 0.14, 0.75, 0.06, 0.2, 0.06, C.white); b.ball(0.5, 0.34, 0.75, 0.04, C.red); // jetty mooring light
  // boats
  b.box(0.1, 0.05, 0.5, 0.35, 0.18, 0.7, C.red);
  b.cone(0.1, 0.05, 0.95, 0.19, 0.25, C.red, 'wood', 4, { rx: Math.PI / 2 * 3 });
  b.box(0.1, 0.23, 0.5, 0.3, 0.02, 0.1, C.white);
  b.box(0.1, 0.23, 0.35, 0.3, 0.02, 0.1, C.wood);
  b.box(0.92, 0.05, -0.1, 0.3, 0.15, 0.55, C.yellow);
  b.cone(0.92, 0.05, 0.3, 0.16, 0.2, C.yellow, 'wood', 4, { rx: Math.PI / 2 * 3 });
  b.box(-0.8, 0.15, 0.55, 0.06, 0.05, 0.5, C.orange, 'wood', { rx: 0.0 }); b.box(-0.8, 0.0, 0.55, 0.03, 0.15, 0.03, C.dark); // paddle
  void w;
}

/** Beach (4x3): sand, striped parasols with towels, lifeguard tower with flag, sandcastle and a beach ball. */
export function beach(b: PartBuilder, w: number, h: number): void {
  b.box(0, 0, 0, w - 0.1, 0.05, h - 0.1, C.sand, 'stone');
  b.box(-0.2, 0.05, 0.9, w - 1.0, 0.01, 0.4, 0xe7cd8a, 'stone'); // wet sand strip
  const cols = [C.red, C.blue, C.yellow];
  cols.forEach((c, i) => {
    const x = -1.2 + i * 1.2, z = -0.3 + (i % 2) * 0.6;
    b.cyl(x, 0.05, z, 0.025, 0.7, C.white, 'wood', 6);
    b.cone(x, 0.65, z, 0.4, 0.2, c, 'roof', 10);
    b.cone(x, 0.65, z, 0.41, 0.12, C.white, 'roof', 5, { ry: 0.3, sy: 0.9 });
    b.box(x + 0.1, 0.05, z + 0.4, 0.4, 0.02, 0.2, cols[(i + 1) % 3]!, 'wood', { ry: 0.3 });
    b.box(x - 0.35, 0.05, z + 0.3, 0.2, 0.02, 0.45, cols[(i + 2) % 3]!, 'wood', { ry: -0.2 });
  });
  // lifeguard tower
  const lx = w / 2 - 0.4, lz = -h / 2 + 0.45;
  for (const dx of [-0.13, 0.13]) for (const dz of [-0.13, 0.13]) b.box(lx + dx, 0, lz + dz, 0.04, 0.65, 0.04, C.white);
  b.box(lx, 0.6, lz, 0.4, 0.05, 0.4, C.white);
  b.box(lx, 0.65, lz, 0.34, 0.25, 0.34, C.red);
  frameWin(b, lx, 0.72, lz + 0.17, 's', 0.1, 0, C.white);
  b.box(lx, 0.9, lz, 0.5, 0.04, 0.5, C.white, 'roof');
  b.box(lx, 0.0, lz + 0.35, 0.18, 0.04, 0.4, C.wood, 'wood', { rx: -0.9 }); // ladder
  b.cyl(lx + 0.2, 0.9, lz + 0.2, 0.015, 0.3, C.white, 'wood', 5); b.box(lx + 0.3, 1.1, lz + 0.2, 0.18, 0.1, 0.01, C.red, 'roof');
  // sandcastle, ball, bar hut
  b.box(-w / 2 + 0.6, 0.05, h / 2 - 0.6, 0.35, 0.15, 0.35, 0xe3c785, 'stone');
  for (const dx of [-0.17, 0.17]) b.cyl(-w / 2 + 0.6 + dx, 0.05, h / 2 - 0.6 + dx, 0.07, 0.25, 0xe3c785, 'stone', 6);
  b.ball(0.3, 0.05, 0.9, 0.09, C.pink, 'roof');
  b.box(-w / 2 + 0.2, 0.05, h / 2 - 0.2, 0.5, 0.2, 0.2, C.water, 'wood');
  b.box(-0.2, 0.05, -h / 2 + 0.3, 0.6, 0.35, 0.35, C.wood);
  b.gable(-0.2, 0.4, -h / 2 + 0.3, 0.45, 0.7, 0.18, C.roofBlue, true);
  awning(b, -0.2, 0.3, -h / 2 + 0.55, 0.6, 0.2, C.yellow, C.white);
}

/** Ice Rink (5x4): oval ice sheet with striped boards, warm-up hut, floodlight masts, centre circle and benches. */
export function iceRink(b: PartBuilder, w: number, h: number): void {
  const rx = w / 2 - 0.15, rz = h / 2 - 0.15;
  b.cyl(0, 0, 0, 1, 0.06, C.white, 'stone', 28, { sx: rx, sz: rz });
  b.cyl(0, 0.06, 0, 1, 0.01, 0xcfeeff, 'stone', 28, { sx: rx - 0.1, sz: rz - 0.1 });
  const n = 20;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    b.box(Math.cos(a) * rx, 0, Math.sin(a) * rz, 0.1, 0.22, ((Math.PI * 2 * Math.max(rx, rz)) / n) * 0.9, i % 2 ? C.red : C.blue, 'wood', { ry: -a });
    b.box(Math.cos(a) * rx, 0.22, Math.sin(a) * rz, 0.12, 0.02, ((Math.PI * 2 * Math.max(rx, rz)) / n) * 0.9, C.white, 'wood', { ry: -a });
  }
  b.cyl(0, 0.07, 0, 0.3, 0.01, C.blue, 'stone', 16);
  b.box(0, 0.07, 0, 2 * rx - 0.8, 0.012, 0.04, C.red, 'stone');
  for (const x of [-1.2, 1.2]) b.box(x, 0.07, 0, 0.03, 0.012, 2 * rz - 0.8, C.blue, 'stone');
  // warm-up hut
  b.box(-2.1, 0, -1.5, 0.6, 0.45, 0.6, C.cream);
  b.gable(-2.1, 0.45, -1.5, 0.7, 0.7, 0.25, C.roofRed, true);
  frameWin(b, -2.1, 0.2, -1.2, 's', 0.14);
  chimney(b, -2.25, 0.45, -1.6, 0.35);
  // floodlight masts
  for (const [x, z] of [[2.3, -1.8], [2.3, 1.8], [-2.3, 1.8]] as const) {
    b.cyl(x, 0, z, 0.03, 1.1, C.grey, 'wood', 6);
    b.box(x, 1.1, z, 0.26, 0.1, 0.08, C.dark);
    b.box(x - 0.07, 1.1, z + 0.05, 0.08, 0.07, 0.03, C.glass); b.box(x + 0.07, 1.1, z + 0.05, 0.08, 0.07, 0.03, C.glass);
  }
  picnicTable(b, 1.0, rz + 0.45); picnicTable(b, -0.5, rz + 0.45);
  b.sign('ICE RINK', 0, 0.3, rz + 0.12, 1.0, 0.3, 0, '#2d5fa8');
}

/** Heated Terrace (3x3): timber deck with patio heaters, glass windbreak, tables and a stone stove with chimney. */
export function heatedTerrace(b: PartBuilder, w: number, h: number): void {
  chimney(b, 0, 0.1, -0.9, 1.2); // stone fire stove (smoke in the cold)
  b.box(0, 0.1, -0.9, 0.7, 0.5, 0.35, C.stone, 'stone'); // stove hearth
  b.box(0, 0.12, -0.72, 0.3, 0.18, 0.04, C.orange);
  b.box(0, 0, 0, w - 0.2, 0.1, h - 0.2, C.wood);
  for (let i = 0; i < 6; i++) b.box(0, 0.1, -h / 2 + 0.25 + i * 0.4, w - 0.25, 0.01, 0.02, C.dark);
  b.fence(-w / 2 + 0.15, h / 2 - 0.15, w / 2 - 0.15, h / 2 - 0.15, C.dark, 0.3, 6);
  b.fence(-w / 2 + 0.15, -h / 2 + 0.15, -w / 2 + 0.15, h / 2 - 0.15, C.dark, 0.3, 4);
  // glass windbreak panels along the right side and back
  const glass = 0xcfe8f5;
  for (let i = 0; i < 4; i++) { b.box(w / 2 - 0.15, 0.1, -0.9 + i * 0.55, 0.03, 0.5, 0.5, glass); b.box(w / 2 - 0.15, 0.1, -0.9 + i * 0.55 - 0.27, 0.04, 0.52, 0.03, C.grey, 'stone'); }
  for (const [x, z] of [[-0.9, -0.9], [0.9, -0.9], [0.9, 0.3]] as const) {
    b.cyl(x, 0.1, z, 0.03, 1.1, C.grey, 'wood', 6);
    b.cone(x, 1.2, z, 0.25, 0.18, C.orange, 'roof', 10);
    b.cyl(x, 1.1, z, 0.06, 0.1, C.red, 'wood', 8);
  }
  for (const [x, z] of [[-0.3, 0], [-0.3, 0.8]] as const) {
    parasolTable(b, x, z, x < 0 ? C.red : C.orange, 0);
    b.box(x + 0.3, 0.1, z, 0.15, 0.15, 0.15, C.red);
  }
  lampPost(b, -w / 2 + 0.2, h / 2 - 0.2, 0.55);
}

/** Stunt Park (6x4): kickers, quarter pipe, funbox, down-rail and flat bar, flags and a coach hut. */
export function stuntPark(b: PartBuilder, w: number, h: number): void {
  b.wedge(-w / 2 + 1, 0, -h / 2 + 0.8, 1.6, 0.6, 1.0, C.blue);
  b.wedge(-w / 2 + 1, 0, h / 2 - 0.8, 1.6, 0.6, 1.0, C.red);
  b.wedge(1.6, 0, -0.9, 1.6, 0.9, 1.2, C.orange, Math.PI);
  b.box(0.2, 0, 0.4, 1.0, 0.35, 0.8, C.purple);
  b.box(0.2, 0.35, 0.4, 1.1, 0.04, 0.9, C.yellow);
  for (const x of [-0.4, 0.4, 1.2]) b.box(x + 1.0, 0, 0.8, 0.05, 0.3, 0.05, C.dark);
  b.box(1.6, 0.3, 0.8, 1.8, 0.05, 0.06, C.grey);
  b.box(1.6, 0, 1.4, 0.05, 0.3, 0.05, C.dark); b.box(0.9, 0, -0.1, 0.05, 0.3, 0.05, C.dark);
  b.box(1.6, 0.3, 1.4, 0.9, 0.05, 0.06, C.pink, 'wood', { ry: 0.0 });
  // quarter pipe (two wedges back to back with a deck)
  b.wedge(-0.4, 0, -h / 2 + 0.5, 1.0, 0.8, 1.2, C.green, Math.PI);
  b.box(-0.85, 0.8, -h / 2 + 0.5, 0.2, 0.04, 1.2, C.white);
  b.sign('STUNT PARK', 0, 0.9, -h / 2 + 0.1, 1.4, 0.45, 0, '#7a2fc0');
  for (const z of [-0.7, 0.9]) { b.cyl(-w / 2 + 0.2, 0, z, 0.03, 0.8, C.dark, 'wood', 6); b.box(-w / 2 + 0.2, 0.55, z + 0.2, 0.02, 0.2, 0.4, z < 0 ? C.yellow : C.pink, 'roof'); }
  b.box(w / 2 - 0.5, 0, h / 2 - 0.5, 0.6, 0.4, 0.5, C.cream); b.gable(w / 2 - 0.5, 0.4, h / 2 - 0.5, 0.6, 0.7, 0.2, C.roofBlue, true); // coach hut
  [0.2, 0.5, 0.8].forEach((dx, i) => b.cone(w / 2 - 1.4 + dx, 0, h / 2 - 0.3, 0.07, 0.2, i % 2 ? C.orange : C.red, 'roof', 6));
}

/** Adventure Park (6x6): four rope-course towers linked by bridges, net pyramid, zip line, climbing wall and ticket hut. */
export function adventurePark(b: PartBuilder, w: number, h: number): void {
  b.box(0, 0, 0, w - 0.3, 0.03, h - 0.3, C.green, 'stone');
  const px = w / 2 - 0.9, pz = h / 2 - 0.9;
  const tw: Array<[number, number, number]> = [[-px, -pz, 1.4], [px, -pz, 1.0], [px, pz, 1.7], [-px, pz, 1.2]];
  tw.forEach(([x, z, hh], i) => {
    for (const dx of [-0.3, 0.3]) for (const dz of [-0.3, 0.3]) b.box(x + dx, 0, z + dz, 0.08, hh, 0.08, C.wood);
    b.box(x, 0, z, 0.6, 0.05, 0.03, C.dark, 'wood', { ry: Math.PI / 4 }); b.box(x, hh * 0.5, z, 0.6, 0.04, 0.03, C.dark, 'wood', { ry: -Math.PI / 4 }); // cross braces
    b.box(x, hh, z, 0.8, 0.06, 0.8, C.dark);
    b.cone(x, hh + 0.05, z, 0.65, 0.4, i % 2 ? C.roofRed : C.roofBlue, 'roof', 4, { ry: Math.PI / 4 });
    b.fence(x - 0.35, z + 0.35, x + 0.35, z + 0.35, C.wood, 0.2, 2);
    b.box(x + 0.4, 0, z + 0.4, 0.05, hh, 0.02, C.orange, 'wood', { ry: Math.PI / 4 }); // rope ladder side
  });
  for (let i = 0; i < 4; i++) {
    const [x0, z0, h0] = tw[i]!, [x1, z1, h1] = tw[(i + 1) % 4]!;
    const len = Math.hypot(x1 - x0, z1 - z0) - 0.8;
    const ang = Math.atan2(-(z1 - z0), x1 - x0);
    const hm = (h0 + h1) / 2 + 0.03;
    b.box((x0 + x1) / 2, hm - 0.1, (z0 + z1) / 2, len, 0.03, 0.1, C.orange, 'wood', { ry: ang });
    b.box((x0 + x1) / 2, hm + 0.15, (z0 + z1) / 2, len, 0.02, 0.02, C.dark, 'wood', { ry: ang });
    for (let k = 1; k < 6; k++) { // rope-net strands hanging below
      const t = k / 6, sag = Math.sin(t * Math.PI) * 0.12;
      b.box(x0 + (x1 - x0) * t, hm - 0.5 - sag, z0 + (z1 - z0) * t, 0.015, 0.4, 0.015, C.sand, 'wood');
    }
  }
  b.box(0, 0.7, 0, 3.6, 0.02, 0.02, C.grey, 'wood', { ry: Math.PI / 4 });
  b.cone(0, 0, 0, 0.7, 0.45, C.pink, 'roof', 4, { ry: Math.PI / 4 }); // net pyramid
  b.box(0, 0.25, 0, 0.5, 0.02, 0.5, C.dark, 'wood', { ry: Math.PI / 4 });
  b.sign('ADVENTURE', 0, 0.5, h / 2 - 0.1, 1.6, 0.5, 0, '#2d7a3f');
  b.box(-1.5, 0, 0.3, 0.1, 0.5, 0.1, C.dark);
  // climbing wall + ticket hut
  b.box(-w / 2 + 0.3, 0, 0, 0.12, 0.9, 1.4, C.wood);
  [0.1, 0.4, 0.7].forEach((y, i) => b.box(-w / 2 + 0.38, y, -0.4 + i * 0.4, 0.05, 0.07, 0.07, [C.red, C.yellow, C.blue][i]!));
  b.box(1.4, 0, h / 2 - 0.5, 0.6, 0.4, 0.5, C.cream); b.gable(1.4, 0.4, h / 2 - 0.5, 0.6, 0.7, 0.2, C.roofGreen, true);
  frameWin(b, 1.4, 0.15, h / 2 - 0.25, 's', 0.14);
}
