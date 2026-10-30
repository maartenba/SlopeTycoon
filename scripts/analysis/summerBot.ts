/**
 * Summer revenue share check (Phase 6 M6.3 STOP, docs/balance.md "M6.3 STOP check"). `npx vite-node scripts/analysis/summerBot.ts [--years 2]`
 * Human-like Career bot (unlock-respecting, lifts left on) with and without the `summer` option (campground, petting zoo, viewpoint, hike + MTB trails, bike lifts).
 */
import { createSim } from '../../src/game/createSim';
import { Bot, runBot } from '../../src/game/bot';
import { DAYS_PER_YEAR } from '../../src/config/balance';
const argv = process.argv.slice(2); const years = Number(argv[argv.indexOf('--years') + 1]) || 2;
const SUMMER = (m: number): boolean => m >= 2 && m <= 5;
const k = (n: number): string => `${n >= 0 ? '+' : ''}${(n / 1000).toFixed(1)}k`;
for (const [size, seed] of [[64, 61], [128, 7], [64, 5]] as const) for (const summer of [false, true]) {
  const sim = createSim({ size, seed, now: () => 0 });
  const bot = new Bot(sim, { respectUnlocks: true, reserve: 2_000, summerLifts: 'keep', summer, starterOpts: { lifts: size === 64 ? 1 : 2, attractions: 1, toilet: true } });
  runBot(sim, bot, years * DAYS_PER_YEAR + 1);
  const y = Number(argv[argv.indexOf('--year') + 1]) || 2, rows = bot.rows.filter((r) => r.year === y);
  const inc = (f: (m: number) => boolean): number => rows.filter((r) => f(r.month)).reduce((a, r) => a + r.incomeTotal, 0);
  const net = (f: (m: number) => boolean): number => rows.filter((r) => f(r.month)).reduce((a, r) => a + r.net, 0);
  const types = Object.entries(sim.buildings.all().reduce((a: Record<string, number>, b) => (a[b.type] = (a[b.type] ?? 0) + 1, a), {})).filter(([t]) => ['campground', 'pettingZoo', 'viewpoint', 'adventurePark', 'beach', 'alpineFarm'].includes(t)).map(([t, n]) => `${t}x${n}`).join(',');
  console.log(`${size}/${seed} summer=${summer}: y${y} income ${k(inc(() => true))} summer income ${k(inc(SUMMER))} share ${(100 * inc(SUMMER) / inc(() => true)).toFixed(1)}%  net ${k(net(() => true))} summer net ${k(net(SUMMER))}  final cash ${k(sim.game.money)}  built ${types}`);
}
