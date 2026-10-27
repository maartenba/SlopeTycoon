/**
 * Payback table of the green buildings (docs/energy.md). For each generator: bot resort (SIZE env, default 64; SEEDS env, default 61,7) played to the end of year 1, the generator is
 * placed + connected, then two more years are played; reports the energy dollars it took off the bill per year (`energy.totalApplied` delta), upkeep
 * and the simple payback in game years (cost / (applied - upkeep)). Usage: `npx vite-node scripts/analysis/energyPayback.ts [types,comma,separated]`.
 */
import { createSim, type Sim } from '../../src/game/createSim';
import { Bot, runBot } from '../../src/game/bot';
import { BUILDINGS } from '../../src/config/buildings';
import { DAYS_PER_YEAR } from '../../src/config/balance';
import { anchors, buildNetwork, findSite, placeSite, planPathTo, planRoadTo } from '../../src/tutorial/suggest';
import { TileType } from '../../src/world/Grid';

const SIZE = Number(process.env.SIZE ?? 64);
const types = (process.argv[2] ?? 'solarArray,solarPlant,windTurbine,smallHydro,biomassHeating').split(',');
const anchorFor = (sim: Sim, type: string): { x: number; y: number } => {
  if (type === 'smallHydro') { let best: { x: number; y: number } | null = null, bd = 1e9; const l = anchors(sim).lodge; for (let i = 0; i < sim.grid.tileType.length; i++) if (sim.grid.tileType[i] === TileType.Stream) { const x = i % sim.size, y = (i / sim.size) | 0, d = Math.hypot(x - l.x, y - l.y); if (d < bd) { bd = d; best = { x, y }; } } return best ?? l; }
  if (type === 'windTurbine') { let best = { x: 32, y: 32 }, bh = -1; for (let y = 6; y < sim.size - 6; y++) for (let x = 6; x < sim.size - 6; x++) { const h = sim.grid.getCorner(x, y); if (h > bh) { bh = h; best = { x, y }; } } return best; }
  return anchors(sim).lodge;
};
const place = (sim: Sim, type: string): boolean => {
  const def = BUILDINGS[type]!, route = def.access === 'road' ? 'road' as const : 'path' as const;
  const site = findSite(sim, type, anchorFor(sim, type), { rmax: type === 'windTurbine' || type === 'smallHydro' ? 12 : 30, route: type === 'windTurbine' ? undefined : route });
  if (!site) return false;
  sim.game.money += def.cost * 2; // the player saves up: only the energy economics are measured
  const out = placeSite(sim, site);
  if (!out.ok) return false;
  const acc = def.access, p = acc === 'road' ? planRoadTo(sim, site.rect) : planPathTo(sim, site.rect);
  if (p?.length) buildNetwork(sim, acc === 'road' ? 2 : 1, p);
  sim.buildings.reevaluate();
  return sim.buildings.get(out.building!.id)!.active;
};

console.log('type            seed  cost   upkeep/yr  applied/yr  wasted/yr  net/yr  payback(y)  sustain before->after (energy part)');
for (const type of types) for (const seed of (process.env.SEEDS ?? '61,7').split(',').map(Number)) {
  const sim = createSim({ size: SIZE as 64 | 128 | 256, seed, now: () => 0 }), bot = new Bot(sim);
  runBot(sim, bot, DAYS_PER_YEAR);
  const before = sim.sustain.last();
  if (!place(sim, type)) { console.log(`${type.padEnd(15)} ${seed}   no valid connected site`); continue; }
  const a0 = sim.energy.totalApplied, w0 = sim.energy.totalWasted;
  runBot(sim, bot, 2 * DAYS_PER_YEAR);
  const after = sim.sustain.last(), def = BUILDINGS[type]!;
  const applied = (sim.energy.totalApplied - a0) / 2, wasted = (sim.energy.totalWasted - w0) / 2, upkeep = def.upkeep * DAYS_PER_YEAR * sim.difficulty.upkeep;
  const net = applied - upkeep, pay = net > 0 ? def.cost / net : Infinity;
  console.log(`${type.padEnd(15)} ${String(seed).padEnd(4)} ${String(def.cost).padStart(6)} ${upkeep.toFixed(0).padStart(9)} ${applied.toFixed(0).padStart(11)} ${wasted.toFixed(0).padStart(10)} ${net.toFixed(0).padStart(7)} ${pay.toFixed(1).padStart(10)}  ${before?.score}->${after?.score} (${before?.energy.toFixed(2)}->${after?.energy.toFixed(2)})`);
}
