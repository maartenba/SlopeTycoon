import * as THREE from 'three';
import { CROSSING } from '../../config/crossings';
import type { GeoData } from './Paths';

/**
 * Footbridge over the rail (Phase 6 Task 11, docs/crossings.md): a raised timber deck on the rail tile plus stairs on the two approach tiles.
 * Pure geometry appended to a chunk's network GeoData (flat-shaded boxes, 24 vertices each, ~25 boxes per bridge, ~300 triangles). The caller
 * passes the surface height function (`surfaceHeightAt` of the grid) so this file stays free of grid imports. UVs point at the plain white atlas cell.
 */
export type HeightFn = (x: number, z: number) => number;

const WOOD = 0xa4834f, WOOD_DARK = 0x6e5636, WOOD_RAIL = 0x8a6b43;
const WHITE_CELL_U = 3.5 / 4; // Paths atlas: 4 cells, cell 3 = plain white
const HALF_W = 0.27;

/** Axis-aligned box [x0,x1] x [y0,y1] x [z0,z1] with per-face vertices (flat shading). */
function box(d: GeoData, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, rgb: number): void {
  const c = new THREE.Color(rgb);
  const faces: Array<[number[], number[]]> = [
    [[x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z1], [1, 1, 1]], // top
    [[x0, y0, z1, x1, y0, z1, x1, y0, z0, x0, y0, z0], [0.55, 0.55, 0.55]], // bottom
    [[x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0], [0.8, 0.8, 0.8]], // north
    [[x1, y0, z1, x0, y0, z1, x0, y1, z1, x1, y1, z1], [0.8, 0.8, 0.8]], // south
    [[x0, y0, z1, x0, y0, z0, x0, y1, z0, x0, y1, z1], [0.7, 0.7, 0.7]], // west
    [[x1, y0, z0, x1, y0, z1, x1, y1, z1, x1, y1, z0], [0.7, 0.7, 0.7]], // east
  ];
  for (const [v, sh] of faces) {
    const base = d.positions.length / 3;
    for (let k = 0; k < 4; k++) {
      d.positions.push(v[k * 3]!, v[k * 3 + 1]!, v[k * 3 + 2]!);
      d.uvs.push(WHITE_CELL_U, k < 2 ? 0.25 : 0.75);
      d.colors.push(c.r * sh[0]!, c.g * sh[1]!, c.b * sh[2]!);
    }
    d.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
}

/**
 * Deck on the rail tile (x,y). `ns` = the rail runs N-S, so the walkway runs E-W across it. Rises `CROSSING.footbridge.deck` above the surface at the
 * tile centre, with side rails and four posts to the ground.
 */
export function footbridgeDeck(d: GeoData, h: HeightFn, x: number, y: number, ns: boolean): void {
  const cx = x + 0.5, cz = y + 0.5, H = CROSSING.footbridge.deck, g = h(cx, cz), top = g + H, t = 0.06;
  // local (u along the walkway, v across): map to world by axis
  const B = (u0: number, u1: number, v0: number, v1: number, y0: number, y1: number, rgb: number): void => {
    if (ns) box(d, x + u0, y0, cz + v0, x + u1, y1, cz + v1, rgb);
    else box(d, cx + v0, y0, y + u0, cx + v1, y1, y + u1, rgb);
  };
  B(0, 1, -HALF_W, HALF_W, top - t, top, WOOD); // deck
  for (const s of [-1, 1]) {
    B(0, 1, s * HALF_W - 0.015, s * HALF_W + 0.015, top, top + 0.2, WOOD_RAIL); // side rail
    B(0, 1, s * HALF_W - 0.025, s * HALF_W + 0.025, top + 0.2, top + 0.23, WOOD_DARK); // hand rail
    for (const u of [0.04, 0.96]) B(u - 0.03, u + 0.03, s * (HALF_W - 0.03) - 0.025, s * (HALF_W - 0.03) + 0.025, g - 0.02, top - t, WOOD_DARK); // posts
  }
}

/**
 * Stairs on the approach tile (x,y) climbing towards the bridge in direction `dir` (0 N, 1 E, 2 S, 3 W). Steps rise linearly from the surface at
 * the far edge to the deck height at the near edge (the same ramp as `Networks.footLift`, so guests' z matches).
 */
export function footbridgeStairs(d: GeoData, h: HeightFn, x: number, y: number, dir: number): void {
  const cx = x + 0.5, cz = y + 0.5, H = CROSSING.footbridge.deck, N = CROSSING.footbridge.steps;
  const ns = dir === 0 || dir === 2; // walkway runs N-S
  const sgn = dir === 2 || dir === 1 ? 1 : -1; // +1 when the bridge is towards +x / +z
  for (let i = 0; i < N; i++) {
    // step i occupies [i/N, (i+1)/N] of the tile measured from the FAR edge; its top is at H * (i + 1) / N
    const f0 = i / N, f1 = (i + 1) / N;
    const a0 = sgn > 0 ? f0 : 1 - f1, a1 = sgn > 0 ? f1 : 1 - f0; // along the tile in world axis terms
    const mid = (f0 + f1) / 2, wx = ns ? cx : x + (sgn > 0 ? mid : 1 - mid), wz = ns ? y + (sgn > 0 ? mid : 1 - mid) : cz;
    const g = h(wx, wz), top = g + H * f1;
    const along = (u0: number, u1: number, v0: number, v1: number, y0: number, y1: number, rgb: number): void => {
      if (ns) box(d, cx + v0, y0, y + u0, cx + v1, y1, y + u1, rgb); else box(d, x + u0, y0, cz + v0, x + u1, y1, cz + v1, rgb);
    };
    along(a0, a1, -HALF_W, HALF_W, g - 0.03, top, i % 2 ? WOOD : 0xb59460); // step
    for (const s of [-1, 1]) along(a0, a1, s * HALF_W - 0.015, s * HALF_W + 0.015, top, top + 0.2, WOOD_RAIL); // rail follows the steps
  }
}
