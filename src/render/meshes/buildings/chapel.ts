import { C, PartBuilder, doorway, domeCap, frameWin, pyramidRoof, wallSlab } from '../common';

/**
 * Chapel (2 x 3, docs/chapel.md): a whitewashed mountain chapel. The nave runs along z with a shingled gable roof; a square bell tower with an open belfry
 * (a bell inside), a pointed spire, a gilded ball and a small cross stands at the front (+z, the door side); arched windows glow at night (glass layer).
 * Outside: a bench by the door, three little grave markers and two shrubs on a gravel forecourt. Under 1,500 triangles.
 */
export function chapel(b: PartBuilder, w: number, h: number): void {
  b.box(0, 0, 0, w - 0.1, 0.03, h - 0.1, C.sand, 'stone'); // gravel plot
  // nave
  const nz = -0.35, nw = 0.98, nl = 1.5, wallH = 0.62;
  b.box(0, 0.03, nz, nw, wallH, nl, C.white);
  b.box(0, 0.03, nz, nw + 0.07, 0.07, nl + 0.07, C.stone, 'stone'); // plinth
  b.gable(0, 0.03 + wallH, nz, nw + 0.2, nl + 0.2, 0.36, C.roofBrown, false);
  b.box(0, 0.03 + wallH + 0.34, nz, 0.05, 0.05, nl + 0.22, C.dark, 'wood'); // ridge beam
  // tall arched windows along both sides
  for (const z of [nz - 0.42, nz + 0.1, nz + 0.55]) { frameWin(b, nw / 2, 0.3, z, 'e', 0.17); frameWin(b, -nw / 2, 0.3, z, 'w', 0.17); }
  // little round window in the back wall
  frameWin(b, 0, 0.42, nz - nl / 2, 'n', 0.16);
  // tower
  const tz = 0.72, tw = 0.62, th = 1.08;
  b.box(0, 0.03, tz, tw, th, tw, C.white);
  b.box(0, 0.03, tz, tw + 0.07, 0.07, tw + 0.07, C.stone, 'stone');
  b.box(0, 0.03 + th, tz, tw + 0.1, 0.05, tw + 0.1, C.stone, 'stone'); // belfry cornice
  // belfry openings (dark arches on four sides) and the bell inside
  for (const f of ['s', 'n', 'e', 'w'] as const) {
    const o = tw / 2;
    wallSlab(b, f === 'e' ? o : f === 'w' ? -o : 0, 0.76, f === 's' ? tz + o : f === 'n' ? tz - o : tz, f, 0.2, 0.28, 0.05, 0.012, C.dark);
  }
  b.cone(0, 0.8, tz, 0.07, 0.11, C.yellow, 'roof', 8); b.ball(0, 0.77, tz, 0.022, C.dark, 'wood', 5); // the bell
  // clock face on the front of the tower, above the door
  b.cyl(0, 0.62, tz + tw / 2 + 0.01, 0.06, 0.02, C.cream, 'stone', 10, { rx: Math.PI / 2 });
  // spire: a slender pyramid, a gilded ball and a cross
  pyramidRoof(b, 0, 0.03 + th + 0.05, tz, tw + 0.14, tw + 0.14, 0.62, C.roofBlue);
  const top = 0.03 + th + 0.05 + 0.62;
  b.ball(0, top - 0.01, tz, 0.035, C.yellow, 'wood', 6);
  b.box(0, top + 0.02, tz, 0.028, 0.2, 0.028, C.yellow, 'wood'); b.box(0, top + 0.12, tz, 0.11, 0.028, 0.028, C.yellow, 'wood');
  // door (an arched double door in the tower, steps)
  doorway(b, 0, tz + tw / 2, 's', 0.3, 0.5, C.dark, C.cream);
  // forecourt: a bench by the door, three small grave markers with rounded tops, two shrubs
  const bx = 0.62, bz = 1.22;
  b.box(bx, 0.15, bz, 0.4, 0.03, 0.12, C.wood); b.box(bx, 0.03, bz - 0.04, 0.4, 0.11, 0.012, C.dark, 'wood', {}); b.box(bx - 0.17, 0.03, bz, 0.03, 0.12, 0.1, C.dark, 'wood'); b.box(bx + 0.17, 0.03, bz, 0.03, 0.12, 0.1, C.dark, 'wood');
  b.box(bx, 0.15, bz + 0.07, 0.4, 0.15, 0.02, C.wood); // backrest
  for (const [gx, gz] of [[-0.7, 0.55], [-0.7, 0.95], [-0.55, 1.2]] as const) { b.box(gx, 0.03, gz, 0.1, 0.16, 0.03, C.grey, 'stone'); domeCap(b, gx, 0.19, gz, 0.05, 0.05, C.grey, 'stone', 6, 2); }
  for (const x of [-0.45, 0.35]) { b.cyl(x, 0.03, 1.3, 0.035, 0.1, C.wood, 'wood', 6); domeCap(b, x, 0.12, 1.3, 0.1, 0.12, C.green, 'roof', 8, 3); }
  // a lantern post by the path
  b.cyl(0.38, 0.03, 1.38, 0.014, 0.4, C.dark, 'wood', 5); b.box(0.38, 0.4, 1.38, 0.06, 0.07, 0.06, C.yellow, 'glass');
  void h;
}
