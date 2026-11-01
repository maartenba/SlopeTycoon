/** Scratch tuner: `vite-node scripts/analysis/difficultyTune.ts -- challenging '{"upkeep":1.2}' [size] [seeds]` applies overrides to one difficulty row and prints profit by year per seed (M7.2, docs/economy-audit.md section 4). */
import { createSim } from '../../src/game/createSim';
import { Bot, runBot } from '../../src/game/bot';
import { DAYS_PER_YEAR, DIFFICULTY, type DifficultyId } from '../../src/config/balance';
const [id, ov, sizeA, seedsA] = process.argv.slice(2).filter((a) => a !== '--');
Object.assign(DIFFICULTY[id as DifficultyId], JSON.parse(ov || '{}'));
const size = Number(sizeA || 64) as 64 | 128 | 256;
const seeds = (seedsA || '61,7,5').split(',').map(Number);
const k = (n: number): string => `${n >= 0 ? '+' : ''}${(n / 1000).toFixed(1)}k`;
const t: number[] = [];
for (const seed of seeds) {
  const sim = createSim({ size, seed, difficulty: id as DifficultyId, now: () => 0 });
  const bot = new Bot(sim, { respectUnlocks: true });
  let min = sim.game.money;
  runBot(sim, bot, 3 * DAYS_PER_YEAR, () => { min = Math.min(min, sim.game.money); });
  const net = (y: number): number => bot.rows.filter((r) => r.year === y).reduce((a, r) => a + r.net, 0);
  const s2 = bot.rows.filter((r) => r.year === 2 && r.month >= 2 && r.month <= 5);
  t.push(net(2));
  console.log(`${id} ${size}/${seed}: y1 ${k(net(1))} y2 ${k(net(2))} y3 ${k(net(3))} summer/mo ${k(s2.reduce((a, r) => a + r.net, 0) / Math.max(1, s2.length))} min ${k(min)}${sim.finance.ended ? ' BANKRUPT' : ''}`);
}
console.log(`MEAN y2 ${k(t.reduce((a, b) => a + b, 0) / t.length)}`);
