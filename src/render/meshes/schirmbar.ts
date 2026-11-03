import * as THREE from 'three';
import { C, PartBuilder, skiRack, tube } from './common';

/**
 * Schirmbar (2x2, M7.8, docs/schirmbar.md): a domed umbrella bar on the slopes, modelled on the owner's reference photos.
 *
 *  - an eight-sided glass pavilion (8 yellow corner posts, rails top and bottom, glass panels between them, a door on the +z side) on a round timber deck;
 *  - a striped canvas roof in yellow and white (16 wedges of a slightly convex cone, a scalloped-looking valance band under the eave) with a golden finial,
 *    a pole and a small Bavarian blue-white flag; the roof is on the `roof` layer, so the shared roof-snow shader dusts it;
 *  - a red banner band around the lower ring (7 sign planes, the door side left free) carrying the RESORT NAME (a canvas texture made by BuildingMeshes);
 *  - inside: a curved counter against the back, five red bar stools, a few seated guests (open state only);
 *  - outside: four high tables with yellow cloths on the diagonals, a ski rack and string lights (glass-colour bulbs: they glow warm at night like windows).
 *
 * OPEN state (`closed = false`): clear panels (glass colour = the night window glow), the crowd, the lights.
 * CLOSED state (`closed = true`): the roof is pulled down like a tarpaulin to the deck, the panels are dark, no crowd, no lights, no stools or tables out.
 * Two cached geometries, swapped by `BuildingsView` when the building's open flag flips (no chunk rebuild). About 1,900 triangles open, 1,000 closed.
 * Every part is world-space plain colour or a roof / wood texel (nothing screen-space), thin features are >= 0.03, so it is flicker-safe.
 */

/** Octagon: corner radius, wall height, deck height. The apothem is R cos(22.5 deg). */
export const SB = { R: 0.88, wall: 0.62, deck: 0.06, eave: 1.0, wedges: 16 } as const;
const GOLD = 0xe0a800, STRIPE_A = 0xf2c14e, STRIPE_B = 0xfafafa, PANEL_DARK = 0x3b3430;

/** One wedge (phi0..phi1) of a surface of revolution through `profile` ((radius, y) from the bottom up), explicit outward winding, smooth normals. Exported for tests. */
export function revolveWedge(profile: ReadonlyArray<readonly [number, number]>, phi0: number, phi1: number): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [];
  const P = (k: number, phi: number): number[] => [profile[k]![0] * Math.sin(phi), profile[k]![1], profile[k]![0] * Math.cos(phi)];
  for (let k = 0; k + 1 < profile.length; k++) {
    const a = P(k, phi0), b2 = P(k, phi1), c = P(k + 1, phi1), d = P(k + 1, phi0);
    // outward = away from the axis; the winding below faces outward for phi growing (x = sin, z = cos) and y rising
    pos.push(...a, ...b2, ...c, ...a, ...c, ...d);
    uv.push(0, k, 1, k, 1, k + 1, 0, k, 1, k + 1, 0, k + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

const ROOF_OPEN: ReadonlyArray<readonly [number, number]> = [[1.0, 0.64], [1.0, 0.7], [0.94, 0.84], [0.8, 1.02], [0.6, 1.2], [0.34, 1.36], [0.08, 1.47]];
/** Pulled down: the tarpaulin drapes to the deck (the slope continues almost to the ground). */
const ROOF_CLOSED: ReadonlyArray<readonly [number, number]> = [[1.04, 0.1], [1.03, 0.3], [1.0, 0.5], [0.94, 0.84], [0.8, 1.02], [0.6, 1.2], [0.34, 1.36], [0.08, 1.47]];

export const SCHIRMBAR_BANNER = { y: 0.2, h: 0.17, w: 0.66, r: 0.84 } as const;
/** Placeholder text; BuildingMeshes swaps the sign material for the resort-name banner texture. */
export const SCHIRMBAR_SIGN = 'APRES-SKI';

function build(b: PartBuilder, closed: boolean): void {
  const { R, wall, deck } = SB, ap = R * Math.cos(Math.PI / 8), side = 2 * R * Math.sin(Math.PI / 8);
  // deck: a round timber platform, eight sides
  b.cyl(0, 0, 0, 1.0, deck, C.wood, 'wood', 8, { ry: Math.PI / 8 });
  b.cyl(0, 0, 0, 1.03, 0.025, C.dark, 'wood', 8, { ry: Math.PI / 8 });
  // wall: posts at the corners (22.5, 67.5 ... degrees from +z), panels at the face centres
  for (let k = 0; k < 8; k++) {
    const v = (k + 0.5) * Math.PI / 4, f = k * Math.PI / 4;
    b.box(R * Math.sin(v), deck, R * Math.cos(v), 0.07, wall, 0.07, C.yellow, 'wood');
    const cx = ap * Math.sin(f), cz = ap * Math.cos(f);
    const door = k === 0;
    // glass (open) or a dark shutter (closed); the door face has a door leaf and a transom instead of the full panel
    if (door) {
      b.box(cx, deck + 0.42, cz, side - 0.08, 0.14, 0.03, closed ? PANEL_DARK : C.glass, 'wood', { ry: f });
      b.box(cx, deck, cz, 0.3, 0.44, 0.045, closed ? PANEL_DARK : C.dark, 'wood', { ry: f });
      b.box(cx, deck + 0.005, cz, 0.36, 0.46, 0.03, C.yellow, 'wood', { ry: f });
      b.ball(cx + 0.1 * Math.cos(f), deck + 0.22, cz - 0.1 * Math.sin(f), 0.03, GOLD, 'wood', 4, {});
    } else {
      b.box(cx, deck + 0.04, cz, side - 0.08, wall - 0.08, 0.03, closed ? PANEL_DARK : C.glass, 'wood', { ry: f });
    }
    // rails (bottom and top) along each face
    b.box(cx, deck, cz, side, 0.05, 0.06, C.yellow, 'wood', { ry: f });
    b.box(cx, deck + wall - 0.05, cz, side, 0.05, 0.06, C.yellow, 'wood', { ry: f });
  }
  // roof: alternating yellow / white wedges, a golden cap, a pole and the Bavarian flag
  const profile = closed ? ROOF_CLOSED : ROOF_OPEN;
  for (let i = 0; i < SB.wedges; i++) {
    const p0 = (i / SB.wedges) * Math.PI * 2, p1 = ((i + 1) / SB.wedges) * Math.PI * 2;
    b.add(revolveWedge(profile, p0, p1), 'roof', i % 2 ? STRIPE_B : STRIPE_A, 0, 0, 0);
  }
  b.cone(0, 1.44, 0, 0.1, 0.12, GOLD, 'roof', 8);
  b.ball(0, 1.54, 0, 0.065, GOLD, 'roof', 6);
  b.cyl(0, 1.6, 0, 0.018, 0.34, C.white, 'wood', 5);
  // Bavarian lozenge flag: white cloth, two blue diamonds (rotated boxes)
  b.box(0.13, 1.76, 0, 0.24, 0.15, 0.03, C.white, 'roof');
  for (const dx of [0.075, 0.185]) b.box(dx, 1.76 + 0.075 - 0.045, 0.018, 0.063, 0.063, 0.012, C.blue, 'roof', { rz: Math.PI / 4 });
  // banner band around the lower ring (7 faces: the door side stays free)
  const B = SCHIRMBAR_BANNER, r = closed ? 1.02 : B.r + 0.06;
  for (let k = 1; k < 8; k++) {
    const f = k * Math.PI / 4;
    b.sign(SCHIRMBAR_SIGN, r * Math.sin(f), closed ? 0.26 : B.y + deck, r * Math.cos(f), B.w, B.h, f, '#b3261e', '#fff4d6');
  }
  // the entrance step, a pair of ski racks and the outdoor tables stay in both states; tables only open
  b.box(0, 0, 1.0 + 0.04, 0.4, 0.045, 0.16, C.dark, 'wood');
  skiRack(b, -0.62, 1.2, 4, 0.2); // the rack stands outside, left of the door
  if (closed) return;
  // inside: curved counter along the back (-z), shelf, stools, guests
  for (let i = -2; i <= 2; i++) {
    const a = Math.PI + i * 0.38, x = 0.46 * Math.sin(a), z = 0.46 * Math.cos(a);
    b.box(x, deck, z, 0.3, 0.3, 0.14, C.wood, 'wood', { ry: a });
  }
  for (let i = -2; i <= 2; i++) { const a = Math.PI + i * 0.38; b.box(0.46 * Math.sin(a), deck + 0.3, 0.46 * Math.cos(a), 0.32, 0.03, 0.2, C.dark, 'wood', { ry: a }); }
  b.box(0, deck + 0.34, -0.66, 0.6, 0.03, 0.06, C.dark, 'wood'); // back shelf
  for (let i = 0; i < 4; i++) b.cyl(-0.2 + i * 0.13, deck + 0.37, -0.66, 0.025, 0.1, [C.green, C.orange, C.red, C.blue][i]!, 'wood', 5);
  b.cyl(0, deck, 0, 0.03, wall, C.white, 'wood', 6); // the pole that carries the roof
  for (let i = -2; i <= 2; i++) {
    const a = Math.PI + i * 0.38, x = 0.3 * Math.sin(a), z = 0.3 * Math.cos(a);
    b.cyl(x, deck, z, 0.018, 0.17, C.dark, 'wood', 5); b.cyl(x, deck + 0.17, z, 0.045, 0.04, C.red, 'wood', 6);
  }
  // a few seated guests (jackets in different colours, a hat each): they sit on the stools in the middle of the counter
  const jacket = [C.blue, C.orange, C.green, C.purple];
  for (let i = 0; i < 4; i++) {
    const a = Math.PI + [-2, -1, 1, 2][i]! * 0.38, x = 0.3 * Math.sin(a), z = 0.3 * Math.cos(a);
    b.cyl(x, deck + 0.21, z, 0.045, 0.14, jacket[i]!, 'wood', 5);
    b.ball(x, deck + 0.34, z, 0.045, C.sand, 'wood', 5);
    b.cyl(x, deck + 0.39, z, 0.05, 0.03, i % 2 ? C.red : C.dark, 'roof', 5);
  }
  // high tables outside, on the four diagonals, with yellow cloths
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
    if (sx < 0 && sz > 0) continue; // the ski rack stands here
    const x = 0.84 * sx, z = 0.84 * sz;
    b.cyl(x, 0, z, 0.025, 0.34, C.dark, 'wood', 5);
    b.cyl(x, 0.34, z, 0.13, 0.04, C.yellow, 'wood', 7);
    b.cyl(x, 0.3, z, 0.1, 0.05, C.yellow, 'wood', 6); // the cloth hangs a little
  }
  // string lights under the eave (glass-colour bulbs glow warm at night) and two lanterns by the door
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    b.box(0.95 * Math.sin(a), 0.54 + 0.03 * Math.sin(i * 2.1), 0.95 * Math.cos(a), 0.04, 0.05, 0.04, C.glass, 'wood');
  }
  for (const s of [-1, 1]) { tube(b, 0.3 * s, 0.6, 0.9, 0.3 * s, 0.5, 0.9, 0.008, C.dark, 'wood', 4); b.box(0.3 * s, 0.4, 0.9, 0.07, 0.1, 0.07, C.glass, 'wood'); }
}

export const schirmbar = (b: PartBuilder): void => build(b, false);
export const schirmbarClosed = (b: PartBuilder): void => build(b, true);
