/**
 * Money curve of a human-like Career player (docs/money-tips.md, docs/balance.md "Money pass"). `npx vite-node scripts/analysis/moneyCurve.ts [--years 2] [--quick]`
 * Real new-game start (1 Dec, Normal, starting cash from the difficulty), a modest starter chain paid from the player's own cash, then one purchase a
 * month while cash allows (unlock-respecting, small reserve, takes the Starter loan when low). Prints monthly income/expense by category, min cash,
 * days below $1k (blocked on construction) and debt days.
 */
import { createSim } from '../../src/game/createSim';
import { Bot, WISHES, runBot, type MonthRow } from '../../src/game/bot';
import { DAYS_PER_YEAR, type DifficultyId } from '../../src/config/balance';

const argv = process.argv.slice(2);
const years = Number(argv[argv.indexOf('--years') + 1]) || 2;
const quick = argv.includes('--quick');
const pArg = argv[argv.indexOf('--policy') + 1];
const policy = pArg === 'eager' || pArg === 'winter' || pArg === 'heavy' ? pArg : 'careful';
const diffArg = (argv[argv.indexOf('--difficulty') + 1] as DifficultyId | undefined);
const difficulty: DifficultyId = diffArg && ['relaxed', 'normal', 'challenging'].includes(diffArg) ? diffArg : 'normal';
const runs: Array<[64 | 128 | 256, number]> = quick ? [[64, 61], [128, 7]] : [[64, 61], [64, 7], [64, 1337], [128, 61], [128, 7], [128, 1337], [256, 61], [256, 7]];
const SUMMER = (m: number): boolean => m >= 2 && m <= 5;
const k = (n: number): string => `${n >= 0 ? '+' : ''}${(n / 1000).toFixed(1)}k`;

for (const [size, seed] of runs) {
  const sim = createSim({ size, seed, difficulty, now: () => 0 });
  // careful: small chain, reserve 6k. eager: bigger chain (2 lifts above 64) + two attractions, spends down to ~2k, leaves the lifts on in summer.
  const SUMMER_ONLY = new Set(['adventurePark', 'beach', 'boatRental', 'alpineFarm']);
  const bot = new Bot(sim, policy === 'heavy'
    ? { respectUnlocks: true, reserve: 2_000, summerLifts: 'keep', policy: { wishes: WISHES.filter(([t]) => !SUMMER_ONLY.has(t)) } as never, starterOpts: { lifts: 3, liftKinds: ['tbar', 'chair4', 'gondola6'], attractions: 2, toilet: true } }
    : policy === 'winter'
    ? { respectUnlocks: true, reserve: 2_000, summerLifts: 'keep', policy: { wishes: WISHES.filter(([t]) => !SUMMER_ONLY.has(t)) } as never, starterOpts: { lifts: size === 64 ? 1 : 2, attractions: 0, toilet: true } }
    : policy === 'eager'
    ? { respectUnlocks: true, reserve: 2_000, summerLifts: 'keep', starterOpts: { lifts: size === 64 ? 1 : 2, attractions: 2, toilet: true } }
    : { respectUnlocks: true, reserve: 6_000, starterOpts: { cannons: 2, attractions: 1, toilet: true } });
  const start = sim.game.money;
  let min = start, below1k = 0, neg = 0, blockedFirstYear = 0;
  runBot(sim, bot, years * DAYS_PER_YEAR, (day) => {
    const m = sim.game.money;
    if (m < min) min = m;
    if (m < 1000) { below1k++; if (day < DAYS_PER_YEAR) blockedFirstYear++; }
    if (m < 0) neg++;
  });
  const rows = bot.rows;
  const net = (y: number, f: (r: MonthRow) => boolean = () => true): number => rows.filter((r) => r.year === y && f(r)).reduce((a, r) => a + r.net, 0);
  console.log(`\n=== ${size} seed ${seed} ${difficulty}: cash after starter chain ${Math.round(start - 0)} -> built ${JSON.stringify(bot.report?.placed ?? {})}`);
  console.log(`min cash ${Math.round(min)}  days<1k ${below1k} (year1 ${blockedFirstYear})  days<0 ${neg}  final cash ${Math.round(sim.game.money)} debt ${Math.round(sim.loans.totalDebt())}`);
  for (let y = 1; y <= years + 1; y++) if (rows.some((r) => r.year === y)) console.log(`year ${y}: net ${k(net(y))}  summer(m2-5) ${k(net(y, (r) => SUMMER(r.month)))} avg/mo ${k(net(y, (r) => SUMMER(r.month)) / 4)}`);
  const cats = new Set<string>(); for (const r of rows) { for (const c of Object.keys(r.income)) cats.add('+' + c); for (const c of Object.keys(r.expense)) cats.add('-' + c); }
  const tot = (key: string): number => rows.reduce((a, r) => a + (key[0] === '+' ? r.income[key.slice(1)] ?? 0 : r.expense[key.slice(1)] ?? 0), 0);
  console.log([...cats].map((c) => [c, tot(c)] as const).filter(([, v]) => Math.abs(v) > 500).sort((a, b) => b[1] - a[1]).map(([c, v]) => `${c} ${k(v)}`).join('  '));
  for (const [label, ms] of [['spring m0-1', [0, 1]], ['autumn m6-7', [6, 7]]] as const) {
    const sc2: Record<string, number> = {}; for (const r of rows.filter((x) => x.year === 2 && ms.includes(x.month as never))) { for (const [c, v] of Object.entries(r.income)) sc2['+' + c] = (sc2['+' + c] ?? 0) + v; for (const [c, v] of Object.entries(r.expense)) sc2['-' + c] = (sc2['-' + c] ?? 0) + v; }
    console.log(label + ' y2: ' + Object.entries(sc2).filter(([, v]) => Math.abs(v) > 300).map(([c, v]) => `${c} ${k(v)}`).join('  '));
  }
  const sumRows = rows.filter((r) => r.year === 2 && SUMMER(r.month));
  const sc: Record<string, number> = {}; for (const r of sumRows) { for (const [c, v] of Object.entries(r.income)) sc['+' + c] = (sc['+' + c] ?? 0) + v; for (const [c, v] of Object.entries(r.expense)) sc['-' + c] = (sc['-' + c] ?? 0) + v; }
  console.log('summer y2 (4 months) by category: ' + Object.entries(sc).filter(([, v]) => Math.abs(v) > 300).map(([c, v]) => `${c} ${k(v)}`).join('  '));
  console.log(rows.map((r) => `y${r.year}m${r.month}:${k(r.net)}/${k(r.cash)}`).join(' '));
}
