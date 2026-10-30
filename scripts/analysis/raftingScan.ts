/**
 * Water tour availability scan (Phase 6 Task 24, docs/water-tours.md): `vite-node scripts/analysis/raftingScan.ts [seeds] [sizes]`.
 * For every map it lists the NATURAL streams (length, drop, flow classes at nominal flow) and counts the tiles where a Rafting Base / Canyoning Base is VALID by the real
 * placement rules (SiteRule.nearWaterway: a put-in within 3 tiles, brisk flow / steep drop / gorge on the slice). Info only: nothing in the game depends on it.
 */
import { createSim } from '../../src/game/createSim';
import { validatePlacement } from '../../src/sim/PlaceBuilding';

const seeds = (process.argv[2] ?? '61,7,5').split(',').map(Number);
const sizes = (process.argv[3] ?? '64,128,256').split(',').map(Number) as Array<64 | 128 | 256>;
for (const size of sizes) for (const seed of seeds) {
  const t0 = Date.now();
  const sim = createSim({ size, seed, starterResort: true, mode: 'sandbox', startSeason: 'summer', now: () => 0, money: 5e9 } as never);
  sim.progression.unlockAll = true;
  const n = sim.size;
  const ways = sim.waterEnv.ways();
  const rows = ways.map((w) => { const f = sim.waterEnv.flow(w.id, true)!; return `${w.id}:${w.path.length}t drop ${w.level[0]! - w.level[w.level.length - 1]!} brisk+ ${f.cls.filter((c) => c >= 1).length} rapids ${f.rapidsTiles}`; });
  const valid = { raftingBase: 0, canyoningBase: 0 };
  for (const type of ['raftingBase', 'canyoningBase'] as const) {
    const w = type === 'raftingBase' ? 3 : 2, h = 2;
    for (let y = 2; y < n - 4; y++) for (let x = 2; x < n - 4; x++) if (!validatePlacement(sim.env, type, x, y, 0, true).reasons.length) valid[type]++;
    void w; void h;
  }
  console.log(`size ${size} seed ${seed}: ${ways.length} streams [${rows.join(' | ')}]  VALID raft spots ${valid.raftingBase}, canyoning spots ${valid.canyoningBase}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}
