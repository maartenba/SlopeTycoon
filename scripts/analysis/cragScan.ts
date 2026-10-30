/**
 * Climbing Crag availability scan (Phase 6 Task 23, docs/climbing.md): `vite-node scripts/analysis/cragScan.ts [seeds] [sizes]`.
 * For every map it counts the tiles where a crag is VALID by the real placement rules (SiteRule.nearRock + slope / water / occupancy; auto-flatten on),
 * the cliff tiles on the map and how many valid sites a footpath could reach. Info only: nothing in the game depends on it.
 */
import { createSim } from '../../src/game/createSim';
import { BUILDINGS } from '../../src/config/buildings';
import { countCliffs, isCliffTile } from '../../src/world/Cliffs';
import { validatePlacement } from '../../src/sim/PlaceBuilding';
import { planPathTo } from '../../src/tutorial/suggest';

const seeds = (process.argv[2] ?? '61,7,5').split(',').map(Number);
const sizes = (process.argv[3] ?? '64,128,256').split(',').map(Number) as Array<64 | 128 | 256>;
const R = BUILDINGS.crag!.site.nearRock!;
console.log(`rule: >= ${R.minTiles} cliff tiles (bare rock, corner spread >= ${R.minSpread}) within ${R.radius} tiles of the 2x2 hut`);
for (const size of sizes) for (const seed of seeds) {
  const t0 = Date.now();
  const sim = createSim({ size, seed, starterResort: true, mode: 'sandbox', startSeason: 'summer', now: () => 0, money: 5e9 } as never);
  sim.progression.unlockAll = true;
  const g = sim.grid, n = sim.size;
  let cliff = 0, near = 0, valid = 0, reachable = 0, tried = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (isCliffTile(g, x, y, R.minSpread)) cliff++;
  for (let y = 6; y < n - 6; y++) for (let x = 6; x < n - 6; x++) {
    if (countCliffs(g, { x, y, w: 2, h: 2 }, R) < R.minTiles) continue;
    near++;
    if (validatePlacement(sim.env, 'crag', x, y, 0, true).reasons.length) continue;
    valid++;
    if (tried < 60 && valid % Math.max(1, Math.floor(valid / 8) || 1) === 0) { tried++; const p = planPathTo(sim, { x, y, w: 2, h: 2 }); if (p && p.length) reachable++; }
  }
  console.log(`size ${size} seed ${seed}: cliff tiles ${cliff}, rock-adjacent spots ${near}, VALID crag spots ${valid}, footpath reaches ${reachable}/${tried} sampled  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}
