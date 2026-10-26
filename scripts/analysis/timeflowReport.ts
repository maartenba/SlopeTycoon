/** Markdown tables from scripts/analysis/out/timeflow.json (written by `npm run analysis:timeflow`). Usage: npm run analysis:timeflow:report */
import { readFileSync, writeFileSync } from 'node:fs';
import { MODELS, type TraceResult, type SpeedRow } from './timeflowLib';

const path = process.argv[2] ?? 'scripts/analysis/out/timeflow.json';
const d = JSON.parse(readFileSync(path, 'utf8')) as { catalog: SpeedRow[]; clock: Array<Record<string, number>>; pacing: Record<string, Array<Record<string, number | string>>>; traces: TraceResult[]; hikes: Array<Record<string, number | string>> };
const f = (v: number, n = 1): string => (Number.isFinite(v) ? v.toFixed(n) : 'n/a');
const mean = (a: number[]): number => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const out: string[] = [];
const T = (head: string[], rows: string[][]): void => { out.push(`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`), ''); };

out.push('### Static speed catalogue (as encoded in src/, 1x = 10 ticks/s, "3x" button = 4x rate = 40 ticks/s)', '');
T(['Agent', 'tiles/tick', 'tiles/s 1x', 'm/s 1x', 'tiles/s "3x"', 'm/s "3x"', 'realistic', 'comfortable t/s', 'x too fast'], d.catalog.map((r) => {
  const live = r.what.includes('render');
  return [r.what, r.tilesPerTick === null ? '-' : f(r.tilesPerTick, 2), f(r.tilesPerS1x), f(r.mps1x, 0), live ? f(r.tilesPerS1x) : f(r.tilesPerS1x * 4), live ? f(r.mps1x, 0) : f(r.mps1x * 4, 0), r.real, r.comfort, Number.isFinite(r.ratio) ? `${f(r.ratio, 1)}x` : '-'];
}));

out.push('### Clock maths: what an honest clock would demand', '');
T(['day at 1x (s)', 'game h per real s', 'walk 1.4 m/s => tiles/s', 'ski 10 m/s => tiles/s', 'chair 2 m/s => tiles/s'], d.clock.map((c) => [String(c.d), f(c.gameHoursPerRealS!, 2), f(c.walkTilesPerS!, 1), f(c.skiTilesPerS!, 1), f(c.chairTilesPerS!, 1)]));

const sizes = [...new Set(d.traces.map((t) => t.size))];
out.push('### Measured on-screen speeds under the current model (M0, mean over moving ticks / p95 / max), tiles per tick -> tiles/s at 1x (x10)', '');
const rows: string[][] = [];
for (const s of sizes) {
  const ts = d.traces.filter((t) => t.model === 'M0' && t.size === s);
  for (const c of ['walk', 'hike', 'bike', 'ski-green', 'ski-blue', 'ski-red', 'ski-black', 'ski-off']) {
    const sp = ts.map((t) => t.speeds[c]!).filter((x) => x.n > 0);
    if (!sp.length) continue;
    rows.push([String(s), c, String(sp.reduce((a, x) => a + x.n, 0)), f(mean(sp.map((x) => x.mean)), 2), f(mean(sp.map((x) => x.p95)), 2), f(Math.max(...sp.map((x) => x.max)), 2), f(mean(sp.map((x) => x.mean)) * 10, 0), f(mean(sp.map((x) => x.p95)) * 10, 0)]);
  }
}
T(['map', 'mode', 'samples', 'mean t/tick', 'p95', 'max', 'mean t/s @1x', 'p95 t/s @1x'], rows);

out.push('### Vehicles (M0): tiles/tick and ticks from spawn to arrival', '');
const vr: string[][] = [];
for (const s of sizes) for (const k of ['car', 'bus', 'train', 'plane']) {
  const ts = d.traces.filter((t) => t.model === 'M0' && t.size === s).map((t) => t.vehicles[k]!).filter((v) => v.n > 0);
  if (ts.length) vr.push([String(s), k, String(ts.reduce((a, v) => a + v.n, 0)), f(mean(ts.map((v) => v.tilesPerTick.mean)), 2), f(mean(ts.map((v) => v.tilesPerTick.mean)) * 10, 0), f(mean(ts.map((v) => v.tripTicks.mean)), 1), f(mean(ts.map((v) => v.tripTicks.mean)) * 0.1, 1)]);
}
T(['map', 'kind', 'n', 'tiles/tick', 'tiles/s @1x', 'mean trip ticks', 'trip real s @1x'], vr);

out.push('### Time budget of a guest day (M0, completed guests; mean of seeds)', '');
T(['map', 'guests/day', 'presence h', 'ticks walking share', 'tiles walked/guest', 'walk ticks now', 'walk ticks @ comfortable', 'walk h now', 'walk h @ comfortable (D=24)', 'real s walking @1x now', 'real s @ 2 t/s'], sizes.map((s) => {
  const ts = d.traces.filter((t) => t.model === 'M0' && t.size === s);
  const wn = mean(ts.map((t) => t.walkTicksNow)), wc = mean(ts.map((t) => t.walkTicksComfort));
  return [String(s), f(mean(ts.map((t) => t.guestsPerDay))), f(mean(ts.map((t) => t.presenceH))), `${f(mean(ts.map((t) => t.walkShare)) * 100, 0)}%`, f(mean(ts.map((t) => t.tilesWalkedPerGuest)), 0), f(wn, 1), f(wc, 0), f((wn * 6) / 60, 1), f((wc * 6) / 60, 0), f(wn / 10, 1), f(wc / 10, 0)];
}));

out.push('### A guest day on screen at 1x (completed guests; ticks x real seconds per tick = D/240)', '');
T(['map', 'model', 'sec/tick', 'whole stay s', 'walking s', 'ski-mode moving s (runs + walk to lift)', 'queueing s', 'runs/skier', 'one 20-tile walk s'], sizes.flatMap((sz) => ['M0', 'A', 'E'].map((id) => {
  const m = MODELS.find((x) => x.id === id)!, spt = m.daySeconds / 240;
  const ts = d.traces.filter((t) => t.model === id && t.size === sz); if (!ts.length) return [String(sz), id, '-', '-', '-', '-', '-', '-', '-'];
  const skiTicks = mean(ts.map((t) => ['ski-green', 'ski-blue', 'ski-red', 'ski-black', 'ski-off'].reduce((a, c) => a + (t.ticksByCat[c] ?? 0), 0)));
  const walkTicks = mean(ts.map((t) => ['walk', 'hike', 'bike'].reduce((a, c) => a + (t.ticksByCat[c] ?? 0), 0)));
  const walkTps = mean(ts.map((t) => t.speeds.walk!.p95)) * (240 / m.daySeconds);
  return [String(sz), id, f(spt, 2), f(mean(ts.map((t) => t.presenceTicks)) * spt, 0), f(walkTicks * spt, 1), f(skiTicks * spt, 1), f(mean(ts.map((t) => t.queueMinPerGuest)) / 6 * spt, 1), f(mean(ts.map((t) => t.runsPerSkier))), f(20 / walkTps, 1)];
})));

out.push('### Models compared (headless winter starter resorts, 6 days x 3 seeds; hiking = summer resort + trails, 8 days x 4 seeds, unweighted mean of runs)', '');
const mr: string[][] = [];
for (const s of sizes) for (const m of MODELS) {
  const ts = d.traces.filter((t) => t.model === m.id && t.size === s); if (!ts.length) continue;
  const hk = d.hikes.filter((h) => h.model === m.id && h.size === s);
  const tps = 240 / m.daySeconds;
  mr.push([String(s), m.id, `${m.daySeconds}`, f(mean(ts.map((t) => t.speeds.walk!.p95)) * tps, 1), f(mean(ts.map((t) => t.speeds['ski-blue']!.p95)) * tps, 1), f(mean(ts.map((t) => t.guestsPerDay))), f(mean(ts.map((t) => t.runsPerSkier))), f(mean(ts.map((t) => t.ridesPerGuest))), f(mean(ts.map((t) => t.liftRidesPerDay)), 0), f(mean(ts.map((t) => t.incomePerDay)), 0), f(mean(ts.map((t) => t.incomePerDay)) / (m.daySeconds / 60), 0), f(mean(ts.map((t) => t.queueMinPerGuest))), f(mean(ts.map((t) => t.stars))), `${f(mean(ts.map((t) => t.walkShare)) * 100, 0)}%`, f(mean(ts.map((t) => t.msPerTick)), 2), hk.length ? `${f(mean(hk.map((h) => h.hikers as number)), 0)} / ${f(mean(hk.map((h) => (h.completed as number) / Math.max(1, h.attempts as number))) * 100, 0)}% / ${f(mean(hk.map((h) => h.top3 as number)) * 100, 0)}%` : '-']);
}
T(['map', 'model', 'day s', 'walk p95 t/s', 'ski blue p95 t/s', 'guests/day', 'runs/skier', 'lift rides/guest', 'lift rides/day', 'income/day', 'income / real min', 'queue min', 'stars', 'walk share', 'ms/tick', 'hikers / done % / top3 %'], mr);

out.push('### Visual-chaser lag (model B/C: sim untouched, drawn position follows the sim path at comfortable speed: walk 2, hike 1.5, bike 4, ski 4-10 t/s)', '');
T(['map', 'model', 'mean lag s', 'p95 lag s', 'moving-agent-ticks with lag > 3 s', 'with lag > 10 tiles'], sizes.flatMap((s) => ['M0', 'E'].map((id) => {
  const ts = d.traces.filter((t) => t.model === id && t.size === s);
  return [String(s), id, f(mean(ts.map((t) => t.chase.meanLagS)), 1), f(mean(ts.map((t) => t.chase.p95LagS)), 1), `${f(mean(ts.map((t) => t.chase.shareLagOver3s)) * 100, 0)}%`, `${f(mean(ts.map((t) => t.chase.shareHidden)) * 100, 0)}%`];
})));

out.push('### Pacing (real minutes), per model day length', '');
const pr: string[][] = [];
for (const m of MODELS) for (const p of d.pacing[m.id] ?? []) pr.push([m.id, String(p.speed), f(p.daySeconds as number, 0), f(p.ticksPerS as number, 1), f(p.yearMinutes as number, 0), f(p.winterMinutes as number, 0)]);
T(['model', 'speed', 'day s', 'ticks/s', '360-day year min', '120-day winter min'], pr);

const text = out.join('\n');
writeFileSync(path.replace(/\.json$/, '.md'), text);
// eslint-disable-next-line no-console
console.log(text);
