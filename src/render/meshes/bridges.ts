import * as THREE from 'three';
import { BRIDGES, type BridgeKind } from '../../config/bridges';
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

const WHITE_CELL_U = 3.5 / 4; // Paths atlas: cell 3 = plain white
const THICK = 0.07;

interface Look { deck: number; deckAlt: number; rail: number; railH: number; railW: number; post: number; hand: number | null }
const LOOK: Record<BridgeKind, Look> = {
  footbridge: { deck: 0xa4834f, deckAlt: 0x96774a, rail: 0x8a6b43, railH: 0.2, railW: 0.03, post: 0x6e5636, hand: 0x6e5636 },
  hikeBridge: { deck: 0x7a5a3a, deckAlt: 0x68492e, rail: 0x6b4e30, railH: 0.11, railW: 0.025, post: 0x5a4228, hand: null },
  mtbBridge: { deck: 0xb89868, deckAlt: 0xa98a5c, rail: 0, railH: 0, railW: 0, post: 0x6e5636, hand: null },
  roadBridge: { deck: 0x5a5e66, deckAlt: 0x5a5e66, rail: 0x9a9a94, railH: 0.15, railW: 0.07, post: 0x8a8a84, hand: null },
};

/** Box between world points p0 -> p1 (axis-aligned run along x or z) with sloped top heights and per-face flat vertices. */
function slab(d: GeoData, x0: number, z0: number, x1: number, z1: number, hw: number, yTop0: number, yTop1: number, thick: number, rgb: number, lift = 0): void {
  const alongX = Math.abs(x1 - x0) >= Math.abs(z1 - z0);
  const c = new THREE.Color(rgb);
  // corners: (end, side) -> (x, z); y top / bottom
  const P = (e: number, side: number): [number, number] => (alongX ? [e ? x1 : x0, (z0 + z1) / 2 + side * hw] : [(x0 + x1) / 2 + side * hw, e ? z1 : z0]);
  const T = (e: number): number => (e ? yTop1 : yTop0) + lift;
  const v = (e: number, side: number, top: boolean): number[] => { const [x, z] = P(e, side); return [x, T(e) - (top ? 0 : thick), z]; };
  const quad = (pts: number[][], shade: number): void => {
    const base = d.positions.length / 3;
    pts.forEach((p, k) => { d.positions.push(p[0]!, p[1]!, p[2]!); d.uvs.push(WHITE_CELL_U, k < 2 ? 0.25 : 0.75); d.colors.push(c.r * shade, c.g * shade, c.b * shade); });
    d.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };
  // top (normal up): order so that the triangle winding faces +y for both axes (double-sided material anyway)
  quad([v(0, -1, true), v(1, -1, true), v(1, 1, true), v(0, 1, true)], 1);
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
  if (spanIdx >= 0 && bridgeSupports(br.span.length).includes(spanIdx)) {
    const [cx, cz] = at(spanIdx + 1);
    const c = grid.getCorners(x, y);
    const bed = Math.min(h(cx, cz), Math.min(...c) * HEIGHT_UNIT) - 0.06, top = br.deck * HEIGHT_UNIT - THICK;
    if (br.kind === 'roadBridge') post(d, cx, cz, horizontal ? 0.16 : hw * 0.8, horizontal ? hw * 0.8 : 0.16, bed, top, look.post);
    else for (const side of [-1, 1]) { const lat = side * (hw - 0.04); post(d, cx + (horizontal ? 0 : lat), cz + (horizontal ? lat : 0), 0.035, 0.035, bed, top, look.post); }
  }
}
