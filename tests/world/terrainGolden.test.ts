import { describe, expect, it } from 'vitest';
import { Grid } from '../../src/world/Grid';
import { generateTerrain } from '../../src/world/TerrainGen';
import { deriveSpringSites } from '../../src/world/SpringSites';

/**
 * Terrain generation golden (Phase 6 Task 44): FNV-1a over heights, tile types, occupancy flags, stream paths + levels, lake levels + tiles and forest
 * density for seeds 1-20 at 64 / 128 / 256, recorded on the commit before the river / spring work. New water systems (dug rivers, spring sites) are
 * overlays: generation must stay byte-identical. Re-record ONLY with a deliberate terrain change (and the goldens that follow it).
 */
const GOLDEN: Record<number, string[]> = {
  64: ['c5911a4b', '62e78c9b', 'fc6bce95', 'd05c81f6', 'f3e6a5c', 'bd80a892', 'c2d98ff6', '74dc36ac', '6c7e8a79', 'fdc2fe2a', '8c87fc79', 'f17767ac', '58edddb8', '4a739e68', '8f3404c', '1f87d7ec', 'e7377af7', '39bdc3fd', '2e416d0c', '5bbacacc'],
  128: ['2783d22b', '51c15e6a', '17b419b6', '48af2f3f', '49d04227', 'bde85d50', 'c7a39fed', 'afafc2c9', 'b2dffef1', 'd2e68ebd', 'f8679c92', '467c2c13', '2e0114ed', '90657a31', '6ee872c7', '6ab1fdda', '726a967e', '8c3785d7', '271df385', '87609d90'],
  256: ['7fb6e86', '438daf90', 'b530bfae', '159da62', '6fdbddf1', 'f007108c', 'bff7f02', 'f2124cc4', '8da33687', '773ca091', 'b5303853', '69e525fd', 'e364fc9e', '90be8898', '83e72529', 'af940e37', '52327424', 'a7d1c110', 'c4feb7c7', 'e766a7b4'],
};

function fnv(parts: ArrayLike<number>[]): string {
  let x = 2166136261;
  for (const a of parts) { for (let i = 0; i < a.length; i++) x = Math.imul(x ^ (a[i]! & 0xffff), 16777619); x = Math.imul(x ^ 0x1234, 16777619); }
  return (x >>> 0).toString(16);
}
function hashTerrain(g: Grid, r: ReturnType<typeof generateTerrain>): string {
  const sp = r.streams.flatMap((st) => st.path.flatMap((p) => [p.x, p.y]).concat(st.level));
  const lk = r.lakes.flatMap((l) => [l.level, ...l.tileIdx]);
  return fnv([g.heights, g.tileType, g.occupancy.flags, sp, lk, r.forestDensity]);
}

describe('terrain golden (seeds 1-20 x 64 / 128 / 256)', () => {
  for (const n of [64, 128, 256] as const) {
    it(`size ${n}: generation is byte-identical, and deriving spring sites changes nothing`, () => {
      for (let seed = 1; seed <= 20; seed++) {
        const g = new Grid(n), r = generateTerrain(g, seed);
        expect(hashTerrain(g, r), `seed ${seed}`).toBe(GOLDEN[n]![seed - 1]);
        deriveSpringSites(g, { lakes: r.lakes, streams: r.streams, villageAnchor: r.villageAnchor }, seed);
        expect(hashTerrain(g, r), `seed ${seed} after springs`).toBe(GOLDEN[n]![seed - 1]);
      }
    }, 60000);
  }
});
