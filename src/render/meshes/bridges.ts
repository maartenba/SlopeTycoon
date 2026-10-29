import * as THREE from 'three';
import { BRIDGES, SUSPENSION, type BridgeKind } from '../../config/bridges';
import { bridgeSupports } from '../../world/Bridges';
import { HEIGHT_UNIT } from '../../config/balance';
import type { Grid } from '../../world/Grid';
import type { Networks } from '../../world/Networks';
import type { GeoData } from './Paths';

/**
 * Procedural bridge meshes (Phase 6 Task 45, docs/bridges.md): footbridge (timber + rails), wooden hiking bridge (logs, low rope rail), MTB bridge
 * (planks, no rails) and road bridge (stone deck + parapets, piers). Appended per TILE to the chunk's network GeoData, so a bridge across a chunk edge
 * simply continues in the next chunk and a bridge costs no extra draw call (one network mesh per chunk). Deck heights come from `Networks.deckAlong`
 * (flat over the span, ramping over the half tile next to each bank); supports every second span tile; flat-shaded boxes, no `gl_FragCoord`.
 */
export type HeightFn = (x: number, z: number) => number;

/** u of bridge deck-top vertices (inside the white atlas cell): the net material tints them with the winter snow (Paths.ts NET_SNOW). */
export const BRIDGE_SNOW_U = 0.93;
const WHITE_CELL_U = 3.5 / 4; // Paths atlas: cell 3 = plain white
const THICK = 0.07;

interface Look { deck: number; deckAlt: number; rail: number; railH: number; railW: number; post: number; hand: number | null; /** Suspension rig colours: cable + tower. */ cable?: number }
const LOOK: Record<BridgeKind, Look> = {
  footbridge: { deck: 0xa4834f, deckAlt: 0x96774a, rail: 0x8a6b43, railH: 0.2, railW: 0.03, post: 0x6e5636, hand: 0x6e5636 },
  hikeBridge: { deck: 0x7a5a3a, deckAlt: 0x68492e, rail: 0x6b4e30, railH: 0.11, railW: 0.025, post: 0x5a4228, hand: null },
  mtbBridge: { deck: 0xb89868, deckAlt: 0xa98a5c, rail: 0, railH: 0, railW: 0, post: 0x6e5636, hand: null },
  roadBridge: { deck: 0x5a5e66, deckAlt: 0x5a5e66, rail: 0x9a9a94, railH: 0.15, railW: 0.07, post: 0x8a8a84, hand: null },
  // suspension footbridges: planks + steel cables (footpath) / rope + timber towers (hiking trail); the rails ARE the cables (rig below)
  suspensionFoot: { deck: 0x9a7b4a, deckAlt: 0x8a6c40, rail: 0, railH: 0, railW: 0, post: 0x5d636b, hand: null, cable: 0x7b8088 },
  suspensionHike: { deck: 0x8a6c40, deckAlt: 0x78593a, rail: 0, railH: 0, railW: 0, post: 0x5a4228, hand: null, cable: 0x9a8760 },
};

/** Flat ribbon (2 triangles) between two world points: vertical (a hanging rope seen from the side) or horizontal (seen from above) of the given thickness. */
function ribbon(d: GeoData, p0: [number, number, number], p1: [number, number, number], size: number, vertical: boolean, rgb: number, lateral: 'x' | 'z'): void {
  const c = new THREE.Color(rgb), base = d.positions.length / 3;
  const off = (sgn: number): [number, number, number] => (vertical ? [0, sgn * size, 0] : lateral === 'x' ? [sgn * size, 0, 0] : [0, 0, sgn * size]);
  const pts = [[p0, -1], [p1, -1], [p1, 1], [p0, 1]] as const;
  pts.forEach(([p, sg], k) => { const o = off(sg); d.positions.push(p[0] + o[0], p[1] + o[1], p[2] + o[2]); d.uvs.push(WHITE_CELL_U, k < 2 ? 0.25 : 0.75); d.colors.push(c.r * 0.9, c.g * 0.9, c.b * 0.9); });
  d.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
}

/**
 * The cable rig of one suspension span tile: per side a main cable (ribbon, parabola from the tower tops down to just above the deck at mid-span), a
 * hand rope along the deck, one hanger; the first / last span tile adds the two towers (posts + cross beam) and the back-stays to the banks. About 24 triangles
 * per span tile + 100 per bridge (a 12-tile bridge stays under 400 incl. the bank ramps). World-space geometry only: no shader tricks, nothing that crawls.
 */
function suspensionRig(d: GeoData, grid: Grid, net: Networks, h: HeightFn, br: NonNullable<ReturnType<Networks['bridgeAt']>>, look: Look, spanIdx: number, hw: number, at: (s: number) => [number, number]): void {
  const n = br.span.length, L = br.deck * HEIGHT_UNIT, top = L + SUSPENSION.towerH, mid = L + 0.16, cable = look.cable ?? look.post;
  const horizontal = br.a.y === br.b.y, lat = horizontal ? 'z' : 'x', axis = horizontal ? 'x' : 'z';
  const side = (s: number, sg: number): [number, number] => { const [x, z] = at(s); return horizontal ? [x, z + sg * (hw + 0.02)] : [x + sg * (hw + 0.02), z]; };
  const cableY = (s: number): number => { const u = (s - 0.5) / n; return mid + (top - mid) * (2 * u - 1) * (2 * u - 1); };
  const s0 = spanIdx + 0.5, s1 = spanIdx + 1.5, sm = spanIdx + 1;
  const bankLow = (t: { x: number; y: number }): number => Math.min(...grid.getCorners(t.x, t.y)) * HEIGHT_UNIT;
  for (const sg of [-1, 1]) {
    const [ax, az] = side(s0, sg), [bx, bz] = side(s1, sg);
    ribbon(d, [ax, cableY(s0), az], [bx, cableY(s1), bz], 0.026, true, cable, lat); // main cable: a vertical ribbon (double-sided material)
    ribbon(d, [ax, net.deckAlong(br, s0) + 0.13, az], [bx, net.deckAlong(br, s1) + 0.13, bz], 0.03, true, cable, lat); // hand rope along the deck
    const [mx, mz] = side(sm, sg); // hanger from the cable down to the hand rope
    ribbon(d, [mx, cableY(sm), mz], [mx, net.deckAlong(br, sm) + 0.13, mz], 0.012, false, cable, axis);
    const towerEnd = (s: number, bank: { x: number; y: number }, back: number): void => {
      const [tx, tz] = side(s, sg), bed = Math.min(h(tx, tz), bankLow(bank)) - 0.08;
      post(d, tx, tz, 0.04, 0.04, bed, top + 0.04, look.post); // tower post
      const [kx, kz] = side(back, sg); // back-stay to the anchor on the bank
      ribbon(d, [tx, top, tz], [kx, net.deckAlong(br, back) + 0.05, kz], 0.014, true, cable, lat);
    };
    if (spanIdx === 0) towerEnd(0.5, br.a, 0);
    if (spanIdx === n - 1) towerEnd(n + 0.5, br.b, n + 1);
  }
  const tower = (s: number): void => { const [x0, z0] = side(s, -1), [x1, z1] = side(s, 1); ribbon(d, [x0, top, z0], [x1, top, z1], 0.03, true, look.post, lat); }; // cross beam
  if (spanIdx === 0) tower(0.5);
  if (spanIdx === n - 1) tower(n + 0.5);
}

/** Box between world points p0 -> p1 (axis-aligned run along x or z) with sloped top heights and per-face flat vertices. */
function slab(d: GeoData, x0: number, z0: number, x1: number, z1: number, hw: number, yTop0: number, yTop1: number, thick: number, rgb: number, lift = 0): void {
  const alongX = Math.abs(x1 - x0) >= Math.abs(z1 - z0);
  const c = new THREE.Color(rgb);
  // corners: (end, side) -> (x, z); y top / bottom
  const P = (e: number, side: number): [number, number] => (alongX ? [e ? x1 : x0, (z0 + z1) / 2 + side * hw] : [(x0 + x1) / 2 + side * hw, e ? z1 : z0]);
  const T = (e: number): number => (e ? yTop1 : yTop0) + lift;
  const v = (e: number, side: number, top: boolean): number[] => { const [x, z] = P(e, side); return [x, T(e) - (top ? 0 : thick), z]; };
  const quad = (pts: number[][], shade: number, u = WHITE_CELL_U): void => {
    const base = d.positions.length / 3;
    pts.forEach((p, k) => { d.positions.push(p[0]!, p[1]!, p[2]!); d.uvs.push(u, k < 2 ? 0.25 : 0.75); d.colors.push(c.r * shade, c.g * shade, c.b * shade); });
    d.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };
  // top (normal up): order so that the triangle winding faces +y for both axes (double-sided material anyway)
  quad([v(0, -1, true), v(1, -1, true), v(1, 1, true), v(0, 1, true)], 1, BRIDGE_SNOW_U); // top faces take the winter snow tint (NET_SNOW)
  quad([v(0, 1, false), v(1, 1, false), v(1, -1, false), v(0, -1, false)], 0.5);
  quad([v(0, -1, false), v(1, -1, false), v(1, -1, true), v(0, -1, true)], 0.78);
  quad([v(1, 1, false), v(0, 1, false), v(0, 1, true), v(1, 1, true)], 0.78);
  quad([v(0, 1, false), v(0, -1, false), v(0, -1, true), v(0, 1, true)], 0.7);
  quad([v(1, -1, false), v(1, 1, false), v(1, 1, true), v(1, -1, true)], 0.7);
}

/** Vertical box centred at (x,z) with half sizes (sx, sz) from y0 to y1. */
function post(d: GeoData, x: number, z: number, sx: number, sz: number, y0: number, y1: number, rgb: number): void {
  slab(d, x - sx, z, x + sx, z, sz, y1, y1, y1 - y0, rgb); // a slab of zero length along x would collapse: use a short run instead
}

/**
 * Append the part of a bridge that lies on tile (x,y): the deck pieces of a span tile, or the ramp half of a bank tile, with rails and (on supported
 * span tiles) posts / a pier down to the bed. No-op for any other tile.
 */
export function bridgeTileGeometry(d: GeoData, grid: Grid, net: Networks, h: HeightFn, x: number, y: number): void {
  if (net.bridgeTiles === 0) return;
  let br = net.bridgeAt(x, y), seg: Array<[number, number]>;
  let spanIdx = -1;
  if (br) {
    spanIdx = br.span.findIndex((t) => t.x === x && t.y === y);
    seg = [[spanIdx + 0.5, spanIdx + 1.5]]; // span tile i (0-based) covers s in [i + 0.5, i + 1.5]
  } else {
    const bank = net.bankOf(x, y);
    if (!bank) return;
    br = bank.br;
    const n = br.span.length;
    seg = bank.end === 'a' ? [[0, 0.5]] : [[n + 0.5, n + 1]]; // the ramp is linear: one piece per bank
  }
  const spec = BRIDGES[br.kind], look = LOOK[br.kind], hw = spec.halfWidth;
  const horizontal = br.a.y === br.b.y;
  const sign = horizontal ? Math.sign(br.b.x - br.a.x) : Math.sign(br.b.y - br.a.y);
  const at = (s: number): [number, number] => (horizontal ? [br!.a.x + 0.5 + sign * s, br!.a.y + 0.5] : [br!.a.x + 0.5, br!.a.y + 0.5 + sign * s]);
  seg.forEach(([s0, s1], k) => {
    const [x0, z0] = at(s0), [x1, z1] = at(s1);
    const y0 = net.deckAlong(br!, s0), y1 = net.deckAlong(br!, s1);
    const alt = (k + (spanIdx < 0 ? 0 : spanIdx)) % 2 === 1;
    slab(d, x0, z0, x1, z1, hw, y0, y1, THICK, alt ? look.deckAlt : look.deck);
    if (look.railH > 0) {
      for (const side of [-1, 1]) {
        const lat = side * (hw - look.railW / 2);
        const ox = horizontal ? 0 : lat, oz = horizontal ? lat : 0;
        slab(d, x0 + ox, z0 + oz, x1 + ox, z1 + oz, look.railW / 2, y0 + look.railH, y1 + look.railH, look.railH, look.rail, 0); // rail / parapet wall
        if (look.hand !== null) slab(d, x0 + ox, z0 + oz, x1 + ox, z1 + oz, look.railW * 0.9, y0 + look.railH + 0.03, y1 + look.railH + 0.03, 0.03, look.hand);
      }
    }
  });
  if (spec.suspension) { if (spanIdx >= 0) suspensionRig(d, grid, net, h, br, look, spanIdx, hw, at); return; } // hung deck: no piers
  if (spanIdx >= 0 && bridgeSupports(br.span.length).includes(spanIdx)) {
    const [cx, cz] = at(spanIdx + 1);
    const c = grid.getCorners(x, y);
    const bed = Math.min(h(cx, cz), Math.min(...c) * HEIGHT_UNIT) - 0.06, top = br.deck * HEIGHT_UNIT - THICK;
    if (br.kind === 'roadBridge') post(d, cx, cz, horizontal ? 0.16 : hw * 0.8, horizontal ? hw * 0.8 : 0.16, bed, top, look.post);
    else for (const side of [-1, 1]) { const lat = side * (hw - 0.04); post(d, cx + (horizontal ? 0 : lat), cz + (horizontal ? lat : 0), 0.035, 0.035, bed, top, look.post); }
  }
}
