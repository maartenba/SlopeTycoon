/**
 * Star distribution probe (Task 23, docs/rating.md): samples the daily rating of the starter, demo and bot resorts and prints a
 * histogram of the displayed stars + the mean 0..100 score. Usage: `npx vite-node scripts/analysis/ratingDistribution.ts [days]`.
 */
import { createSim, type Sim } from '../../src/game/createSim';
import { Bot, runBot } from '../../src/game/bot';
import { buildDemoResort, type DemoLevel } from '../../src/game/demoResort';

const days = Number(process.argv[2] ?? 360);
/** NOTOILET=1: comfort on but the free starter toilet removed. COMFORT=0: the old game (no comfort need, no free toilet) for the before / after tables of docs/rating.md. */
const CMF = process.env.COMFORT === '0' ? { comfortNeed: false } : {};
interface Agg { e: number[]; n: number; score: number; hist: Record<string, number>; comps: Record<string, number> }
const mk = (): Agg => ({ e: [], n: 0, score: 0, hist: {}, comps: {} });
function sample(sim: Sim, a: Agg): void {
  const b = sim.rating.breakdown();
  a.n++; a.score += b.score; a.hist[String(b.stars)] = (a.hist[String(b.stars)] ?? 0) + 1;
  const sp = sim.sustain.last(); if (sp && sp.raw.energyPerGuest >= 0) a.e.push(sp.raw.energyPerGuest);
  for (const c of b.components) a.comps[c.id] = (a.comps[c.id] ?? 0) + c.score;
}
const raw = (sim: Sim): string => { const p = sim.sustain.last(); return p ? `   sustain ${p.score} (energy ${p.energy.toFixed(2)} [${p.raw.energyPerGuest.toFixed(2)} $/guest], trees ${p.trees.toFixed(2)} [loss ${(100 * p.raw.treeLoss).toFixed(1)}%], habitat ${p.habitat.toFixed(2)} [overlap ${(100 * p.raw.habitatOverlap).toFixed(1)}%]) | share ${(100 * sim.rivals.share).toFixed(0)}% rivals ${sim.rivals.rivals.map((r) => `${r.name} ${r.stars.toFixed(1)}★`).join(', ')}` : ''; };
function show(name: string, a: Agg): void {
  const h = Object.keys(a.hist).sort((x, y) => Number(x) - Number(y)).map((k) => `${k}★ ${(100 * a.hist[k]! / a.n).toFixed(0)}%`).join(', ');
  const c = Object.entries(a.comps).map(([k, v]) => `${k} ${(v / a.n).toFixed(0)}`).join(' ');
  const es = [...a.e].sort((x, y) => x - y), q = (p: number): string => (es.length ? es[Math.floor(p * (es.length - 1))]!.toFixed(1) : '-');
  console.log(`${name}: energy $/guest p10 ${q(0.1)} p50 ${q(0.5)} p90 ${q(0.9)}\n  mean score ${(a.score / a.n).toFixed(1)} | ${h} | ${c}`);
}
function runPlain(name: string, make: () => Sim): void {
  const sim = make(), a = mk();
  if (process.env.NOTOILET === '1') { for (const b of sim.buildings.all().filter((x) => x.type === 'toilets')) sim.buildings.remove(b.id); sim.refreshCoverage(undefined, true); } // facilities probe: comfort need on, free toilet removed
  for (let d = 0; d < days; d++) { sim.tick(240); if (d >= 10) sample(sim, a); }
  show(name, a);
  console.log(raw(sim));
}
for (const seed of [61, 7]) {
  runPlain(`starter 64/${seed}`, () => createSim({ size: 64, seed, starterResort: true, mode: 'sandbox', ...CMF, now: () => 0 }));
  for (const lvl of ['starter', 'large'] as DemoLevel[]) runPlain(`demo-${lvl} 64/${seed}`, () => { const s = createSim({ size: 64, seed, mode: 'sandbox', ...CMF, now: () => 0 }); buildDemoResort(s, lvl); return s; });
  { const sim = createSim({ size: 64, seed, ...CMF, now: () => 0 }), bot = new Bot(sim, { staffUpgrades: process.env.UPG === '1', greenEnergy: process.env.GREEN === '1' }), a = mk();
    runBot(sim, bot, 2 * 180, () => { if (sim.game.date.year >= 1 || sim.game.date.day > 10) sample(sim, a); });
    show(`bot 64/${seed}${process.env.UPG === '1' ? ' +upgrades' : ''}${process.env.GREEN === '1' ? ' +solar' : ''}`, a); console.log(raw(sim));
    console.log(`   y2 net ${Math.round(bot.rows.filter((r) => r.year === 2).reduce((s, r) => s + r.net, 0))}`); }
}
