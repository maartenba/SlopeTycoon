/**
 * Seed scan for scenario maps (docs/scenarios.md). Scans seeds 1..200 for a size + preset, scores the terrain (skiable flank, vertical drop,
 * lakes, forest, steepness, depending on `--focus`) and then checks the top candidates by building the starter chain with the bot's opening
 * (no placement failure allowed). Usage:
 *   SCAN_SIZE=128 SCAN_PRESET=gentle SCAN_FOCUS=family [SCAN_EXCLUDE=61 SCAN_FROM=1 SCAN_TO=200] npx vite-node scripts/analysis/scenarioSeedScan.ts
 * SCAN_FOCUS: easy (skiable + gentle valley), family (flat village + gentle flank), snow (big drop + peaks), summer (lakes + forest + skiable),
 * giant (skiable + drop + lakes), safe (drop + forest).
 */
import { Grid } from '../../src/world/Grid';
import { generateTerrain } from '../../src/world/TerrainGen';
import { skiableStats } from '../../src/world/Skiable';
import { createSim } from '../../src/game/createSim';
import { buildStarterResort } from '../../src/game/starterResort';
import type { TerrainPresetId } from '../../src/world/TerrainPresets';

const arg = (k: string, d: string): string => process.env[`SCAN_${k.toUpperCase()}`] ?? d;
const size = Number(arg('size', '128')) as 64 | 128 | 256;
const preset = arg('preset', 'balanced') as TerrainPresetId;
const focus = arg('focus', 'easy');
const from = Number(arg('from', '1')), to = Number(arg('to', '200'));
const exclude = arg('exclude', '').split(',').filter(Boolean).map(Number);

const rows: Array<{ seed: number; score: number; skiable: number; drop: number; lakes: number; forest: number; relief: number }> = [];
for (let seed = from; seed <= to; seed++) {
  if (exclude.includes(seed)) continue;
  const g = new Grid(size);
  const t = generateTerrain(g, seed, preset);
  const s = skiableStats(g);
  let forest = 0;
  for (let i = 0; i < t.forestDensity.length; i++) forest += t.forestDensity[i]!;
  forest = forest / t.forestDensity.length / 255;
  const lakes = t.lakes.length;
  const score = focus === 'family' ? s.skiableFrac * 2.5 + s.dropFrac * 0.5 + Math.min(lakes, 2) * 0.1
    : focus === 'snow' ? s.dropFrac * 2 + s.skiableFrac + (s.totalRelief / 40) * 0.2
    : focus === 'summer' ? Math.min(lakes, 4) * 0.35 + forest * 1.5 + s.skiableFrac + s.dropFrac * 0.5
    : focus === 'giant' ? s.skiableFrac * 1.5 + s.dropFrac * 1.5 + Math.min(lakes, 3) * 0.15
    : focus === 'safe' ? s.dropFrac * 1.5 + forest * 1.5 + s.skiableFrac * 0.5
    : s.skiableFrac * 2 + s.dropFrac + Math.min(lakes, 2) * 0.1;
  rows.push({ seed, score, skiable: s.skiableFrac, drop: s.dropFrac, lakes, forest, relief: s.totalRelief });
}
rows.sort((a, b) => b.score - a.score);
console.log(`scan ${size}/${preset}/${focus}: ${rows.length} seeds; top candidates (chain buildability checked):`);
let shown = 0;
for (const r of rows) {
  if (shown >= 8) break;
  const sim = createSim({ size, seed: r.seed, preset, startSeason: 'winter', money: 1_000_000, now: () => 0 });
  const rep = buildStarterResort(sim, { funds: 5_000_000 });
  const ok = rep.failures.length === 0;
  console.log(`seed ${String(r.seed).padStart(3)} score ${r.score.toFixed(2)} skiable ${r.skiable.toFixed(2)} drop ${r.drop.toFixed(2)} lakes ${r.lakes} forest ${r.forest.toFixed(2)} relief ${r.relief.toFixed(0)} chain ${ok ? 'OK' : 'FAIL ' + rep.failures.join('; ')} lifts ${rep.lifts.length} pisteTiles ${rep.pisteTiles}`);
  shown++;
}
