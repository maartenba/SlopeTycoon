import * as THREE from 'three';
import { C, PartBuilder, balcony, flagPole, frameWin, lampPost, pyramidRoof, wallSlab } from './common';

/** The heated pool, building-local: basin x 0.1 .. 2.5, z 0.9 .. 2.2 (2.4 x 1.3 tiles) inside the pool deck. Steam (BuildingDef.steam) rises from its centre. */
export const POOL_BASIN = { x0: 0.1, x1: 2.5, z0: 0.9, z1: 2.2, floor: 0.03, water: 0.065, deck: 0.1 } as const;

/** Sun lounger on the deck (long axis along x, backrest at -x). */
function lounger(b: PartBuilder, x: number, z: number, towel: number, ry = 0): void {
  b.box(x, POOL_BASIN.deck, z, 0.52, 0.05, 0.2, C.white, 'wood', { ry });
  b.box(x + Math.cos(ry) * 0.13, POOL_BASIN.deck, z - Math.sin(ry) * 0.13, 0.5, 0.025, 0.18, towel, 'roof', { ry }); // striped towel
  b.box(x - Math.cos(ry) * 0.3, POOL_BASIN.deck + 0.06, z + Math.sin(ry) * 0.3, 0.22, 0.04, 0.2, C.white, 'wood', { ry, rz: 0.75 }); // raised backrest
}
/** Double door of the pavilion: white frame, dark leaves with glass panes (glow at night), a timber step (no stone layer: the hotel stays within four meshes). */
function grandDoor(b: PartBuilder, x: number, z: number): void {
  b.box(x, 0, z + 0.01, 0.62, 0.68, 0.05, C.white);
  for (const s of [-1, 1]) { b.box(x + s * 0.14, 0, z + 0.04, 0.24, 0.6, 0.04, C.dark); b.box(x + s * 0.14, 0.26, z + 0.065, 0.14, 0.26, 0.02, C.glass); }
  b.box(x, 0, z + 0.14, 0.8, 0.05, 0.22, C.wood);
}
/** Deck parasol: pole + a low cone canopy. */
function parasol(b: PartBuilder, x: number, z: number, color: number): void {
  b.cyl(x, POOL_BASIN.deck, z, 0.02, 0.62, C.white, 'wood', 6);
  b.cone(x, POOL_BASIN.deck + 0.5, z, 0.36, 0.14, color, 'roof', 8);
}

/**
 * Luxury Hotel (6x6, Phase 6 Task 27, docs/hotels.md): a three-floor cream hotel under a slate roof with a corner tower (pyramid roof), an entrance pavilion with a
 * columned canopy and a GRAND sign, balconies, a flag and lamps; in front the POOL DECK: a stone deck round a recessed basin (coping, floor), loungers with towels,
 * parasols and pool lamps. The water is a separate flat quad (`poolWaterGeometry`, added by BuildingMeshes) between the basin floor and the deck top, so no faces are coplanar.
 */
export function hotelLuxury(b: PartBuilder, w: number, h: number): void {
  const bw = 5.4, bd = 2.2, cz = -1.7, wallH = 2.0, fz = cz + bd / 2; // main wing: z -2.8 .. -0.6
  b.box(0, 0, cz, bw, wallH, bd, C.cream);
  b.box(0, 0, cz, bw + 0.1, 0.2, bd + 0.1, C.stone, 'wood'); // plinth
  for (const f of [1, 2]) b.box(0, f * 0.66 - 0.02, cz, bw + 0.04, 0.05, bd + 0.04, C.white); // floor bands
  for (const sx of [-1, 1]) b.box(sx * bw / 2, 0, cz - bd / 2, 0.14, wallH, 0.14, C.stone, 'wood'); // back quoins
  b.gable(0, wallH, cz, bd + 0.3, bw + 0.3, 0.55, C.roofBlue, true);
  b.box(0, wallH + 0.53, cz, bw + 0.34, 0.04, 0.05, C.dark, 'roof'); // ridge beam
  // windows on the front (between the pavilion and the tower), the west end and the back
  for (let f = 0; f < 3; f++) {
    const y = 0.3 + f * 0.66;
    for (const x of [-0.1, 0.6, 1.3]) frameWin(b, x, y, fz, 's', 0.19, 0, C.white);
    for (const x of [-2.2, -1.3, -0.4, 0.5, 1.4, 2.3]) wallSlab(b, x, y, cz - bd / 2, 'n', 0.19, 0.23, 0.05, 0.015, C.glass); // back: plain panes (the box count stays under the anti z-fight growth cap)
    for (const z of [-0.4, 0.4]) wallSlab(b, -bw / 2, y, cz + z, 'w', 0.19, 0.23, 0.05, 0.015, C.glass);
  }
  for (const f of [1, 2]) balcony(b, 0.6, 0.06 + f * 0.66, fz + 0.12, 2.2, 0.28, C.white);
  // entrance pavilion (forward of the wing, left of centre): taller, with a gable towards the front and a canopy on columns
  const px = -1.4, pw = 1.8, pd = 1.2, pcz = -0.6 + pd / 2 - 0.0, ph = 2.2; // z -0.6 .. 0.6
  b.box(px, 0, pcz - 0.0, pw, ph, pd, C.cream);
  b.gable(px, ph, pcz, pw + 0.2, pd + 0.2, 0.5, C.roofBlue, false);
  const pz = pcz + pd / 2; // pavilion front wall z = 0.6
  grandDoor(b, px, pz);
  b.box(px, 0.7, pz + 0.38, 1.5, 0.07, 0.8, C.white, 'roof'); // canopy slab
  for (const sx of [-1, 1]) b.cyl(px + sx * 0.66, 0, pz + 0.7, 0.045, 0.7, C.white, 'wood', 10);
  for (const f of [1, 2]) for (const sx of [-0.55, 0.55]) frameWin(b, px + sx, 0.9 + (f - 1) * 0.6, pz, 's', 0.2, 0, C.white);
  b.sign('GRAND', px, 1.52, pz + 0.02, 1.0, 0.28, 0, '#1f3a5f', '#f6e7b4');
  for (const sx of [-1, 1]) for (const f of [0, 1, 2]) wallSlab(b, px + sx * pw / 2, 0.45 + f * 0.6, pcz, sx < 0 ? 'w' : 'e', 0.18, 0.22, 0.05, 0.015, C.glass);
  // corner tower with a pyramid roof (east end of the wing)
  const tx = 2.35, tw = 1.0;
  b.box(tx, 0, cz, tw, 2.6, tw + 0.2, C.cream);
  pyramidRoof(b, tx, 2.6, cz, tw + 0.2, tw + 0.4, 0.5, C.roofBlue);
  for (const f of [0, 1, 2]) { frameWin(b, tx, 0.35 + f * 0.7, cz + (tw + 0.2) / 2, 's', 0.18, 0, C.white); wallSlab(b, tx + tw / 2, 0.35 + f * 0.7, cz, 'e', 0.18, 0.22, 0.05, 0.015, C.glass); }
  // ---- pool deck: surround slabs round the basin, coping, basin floor ----
  const P = POOL_BASIN, cx = (P.x0 + P.x1) / 2, pzc = (P.z0 + P.z1) / 2, dx0 = -0.3, dx1 = 2.9, dz0 = 0.2, dz1 = 2.9;
  const dwid = dx1 - dx0, dh = P.deck;
  b.box((dx0 + dx1) / 2, 0, (dz0 + P.z0) / 2, dwid, dh, P.z0 - dz0, 0xd8d2c4, 'wood'); // north strip (along the hotel)
  b.box((dx0 + dx1) / 2, 0, (P.z1 + dz1) / 2, dwid, dh, dz1 - P.z1, 0xd8d2c4, 'wood'); // south strip
  b.box((dx0 + P.x0) / 2, 0, pzc, P.x0 - dx0, dh, P.z1 - P.z0, 0xd8d2c4, 'wood'); // west strip
  b.box((P.x1 + dx1) / 2, 0, pzc, dx1 - P.x1, dh, P.z1 - P.z0, 0xd8d2c4, 'wood'); // east strip
  b.box(cx, 0, pzc, P.x1 - P.x0, P.floor, P.z1 - P.z0, 0xa8d8e6, 'wood'); // basin floor (pale tiles)
  // coping: four thin white rims on the deck round the basin
  b.box(cx, dh, P.z0 - 0.04, P.x1 - P.x0 + 0.16, 0.025, 0.08, C.white, 'wood'); b.box(cx, dh, P.z1 + 0.04, P.x1 - P.x0 + 0.16, 0.025, 0.08, C.white, 'wood');
  b.box(P.x0 - 0.04, dh, pzc, 0.08, 0.025, P.z1 - P.z0, C.white, 'wood'); b.box(P.x1 + 0.04, dh, pzc, 0.08, 0.025, P.z1 - P.z0, C.white, 'wood');
  // loungers + parasols + pool lamps (glass bulbs glow at night)
  for (const [x, c] of [[0.55, C.blue], [1.25, C.red], [1.95, C.blue]] as const) lounger(b, x, 0.55, c);
  for (const [x, c] of [[0.6, C.red], [1.3, C.blue], [2.0, C.red]] as const) lounger(b, x, 2.55, c, Math.PI);
  parasol(b, 2.55, 0.6, C.orange); parasol(b, -0.05, 2.55, C.orange);
  for (const [x, z] of [[P.x0 - 0.04, P.z0 - 0.04], [P.x1 + 0.04, P.z1 + 0.04]] as const) { b.cyl(x, dh, z, 0.02, 0.2, C.dark, 'wood', 6); b.box(x, dh + 0.2, z, 0.07, 0.06, 0.07, C.glass); }
  // drive side: flag, lamps
  flagPole(b, -2.7, 1.25, 1.9, C.red, C.white);
  lampPost(b, -2.6, 0.5, 0.55); lampPost(b, -0.45, 1.5, 0.55);
  void w; void h;
}

/**
 * The pool water: a flat grid at `POOL_BASIN.water`, lighter in the middle and deeper blue at the rim (static vertex colours: no noise, no time term, so nothing can shimmer
 * under camera motion). Position + colour only (a basic, unlit material).
 */
export function poolWaterGeometry(): THREE.BufferGeometry {
  const P = POOL_BASIN, nx = 8, nz = 5, pos: number[] = [], col: number[] = [];
  const vtx = (i: number, j: number): void => {
    const u = i / nx, v = j / nz, x = P.x0 + (P.x1 - P.x0) * u, z = P.z0 + (P.z1 - P.z0) * v;
    const e = Math.min(Math.min(u, 1 - u) * (P.x1 - P.x0), Math.min(v, 1 - v) * (P.z1 - P.z0)); // distance to the nearest rim (tiles)
    const k = Math.min(1, e / 0.45);
    pos.push(x, P.water, z);
    col.push(0.13 + 0.3 * k, 0.55 + 0.32 * k, 0.74 + 0.2 * k);
  };
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    vtx(i, j); vtx(i, j + 1); vtx(i + 1, j);
    vtx(i + 1, j); vtx(i, j + 1); vtx(i + 1, j + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}
