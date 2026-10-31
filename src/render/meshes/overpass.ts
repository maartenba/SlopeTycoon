import { HEIGHT_UNIT } from '../../config/balance';
import { overpassAlong } from '../../world/OverpassProfile';
import type { Grid } from '../../world/Grid';
import type { Networks } from '../../world/Networks';
import type { GeoData } from './Paths';
import { slab } from './bridges';

/**
 * Procedural road overpass (docs/crossings.md): per tile of the overpass an embankment block with stone side walls (ramp tiles: solid down to the ground,
 * so the walls follow the slope), an asphalt deck with a centre line and low barrier rails on both sides. The rail tile in the middle is the flat deck over
 * the train (a thin girder, the track and the train pass underneath). Deck tops carry the winter snow tint (u = BRIDGE_SNOW_U, via `slab`). Heights come
 * from `overpassAlong`, the same profile cars use (`Networks.deckY`). Flat-shaded boxes in the chunk's network mesh: no extra draw call, no `gl_FragCoord`.
 */
const STONE = 0x8d8a80, ASPHALT = 0x4b4e55, BARRIER = 0x9a9a94, LINE = 0xf2c14e;
const HW_BANK = 0.47, HW_DECK = 0.4, BARRIER_H = 0.13, BARRIER_W = 0.035;

export function overpassTileGeometry(d: GeoData, grid: Grid, net: Networks, x: number, y: number): void {
  const o = net.overpassAt(x, y);
  if (!o) return;
  const horizontal = o.axis === 'h';
  const j = horizontal ? x - o.x : y - o.y; // tile offset along the axis (0 = the rail tile)
  const s0 = j - 0.5, s1 = j + 0.5;
  const at = (s: number): [number, number] => (horizontal ? [o.x + 0.5 + s, o.y + 0.5] : [o.x + 0.5, o.y + 0.5 + s]);
  const [x0, z0] = at(s0), [x1, z1] = at(s1);
  const y0 = overpassAlong(o, s0), y1 = overpassAlong(o, s1);
  const gmin = Math.min(...grid.getCorners(x, y)) * HEIGHT_UNIT;
  const girder = j === 0;
  const thick = girder ? 0.14 : Math.max(0.1, Math.max(y0, y1) - gmin + 0.06); // ramp tiles are solid down to the ground (a plain slab over the rail)
  slab(d, x0, z0, x1, z1, HW_BANK, y0 - 0.012, y1 - 0.012, thick, STONE); // embankment / girder: the stone side walls
  slab(d, x0, z0, x1, z1, HW_DECK, y0, y1, 0.03, ASPHALT); // the road surface
  const ey = 0.006;
  slab(d, x0, z0, x1, z1, 0.012, y0 + ey, y1 + ey, 0.004, LINE); // centre line
  for (const side of [-1, 1]) {
    const lat = side * (HW_BANK - BARRIER_W / 2 - 0.01);
    const ox = horizontal ? 0 : lat, oz = horizontal ? lat : 0;
    slab(d, x0 + ox, z0 + oz, x1 + ox, z1 + oz, BARRIER_W / 2, y0 + BARRIER_H, y1 + BARRIER_H, BARRIER_H, BARRIER, 0);
  }
}
