/** Merge scripts/analysis/out/*.json (written by `npm run analysis:hiking`) into markdown tables: `npm run analysis:hiking:report`. */
import { readdirSync, readFileSync } from 'node:fs';
import type { Summary, TrailInfo } from './hikingLib';

const dir = 'scripts/analysis/out';
const sums: Summary[] = [], infos: TrailInfo[] = [];
let speed: Array<{ what: string; tilesPerTick: number; tilesPerHour: number; kmh: number }> = [];
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
  const o = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) as { speed: typeof speed; infos: TrailInfo[]; summaries: Summary[] };
  sums.push(...o.summaries); infos.push(...o.infos); speed = o.speed;
}
const p = (v: number): string => (Number.isFinite(v) ? `${(v * 100).toFixed(0)}%` : 'n/a');
const f1 = (v: number): string => (Number.isFinite(v) ? v.toFixed(1) : 'n/a');
const SIZES = [64, 128, 256], order = ['legacy', 'new', 'baseline', 'speed3', 'speed10', 'dusk1930', 'summit', 'overnight', 'excursion', 'speed10summit', 'excSummit', 'excSummitLate', 'combo'];
const get = (sc: string, size: number): Summary | undefined => sums.find((s) => s.scenario === sc && s.size === size);
const BASE = sums.some((s) => s.scenario === 'legacy') ? 'legacy' : 'baseline';
const out: string[] = [];
out.push('### Speeds\n', '| movement | tiles/tick | tiles/hour | km/h (10 m tiles) |', '|---|---|---|---|', ...speed.map((s) => `| ${s.what} | ${s.tilesPerTick} | ${s.tilesPerHour} | ${s.kmh.toFixed(2)} |`));
out.push('\n### Trail geometry (mean of seeds)\n', '| size | seeds | lift top rel. alt | trail lodge->summit (tiles) | lift top->summit | lift length | trail tiles | snow-free |', '|---|---|---|---|---|---|---|---|');
for (const s of SIZES) { const i = infos.filter((x) => x.size === s); if (!i.length) continue; const m = (g: (x: TrailInfo) => number): number => i.reduce((a, x) => a + g(x), 0) / i.length; out.push(`| ${s} | ${i.length} | ${p(m((x) => x.relLiftTop))} | ${f1(m((x) => x.trailLenLodgeSummit))} | ${f1(m((x) => x.trailLenLiftTopSummit))} | ${f1(m((x) => x.liftLengthTiles))} | ${f1(m((x) => x.trailTiles))} | ${p(m((x) => x.hikeTilesOk / x.trailTiles))} |`); }
out.push('\n### Baseline per size\n', '| metric | 64 | 128 | 256 |', '|---|---|---|---|');
const row = (name: string, g: (s: Summary) => string): void => { out.push(`| ${name} | ${SIZES.map((z) => { const s = get(BASE, z); return s ? g(s) : '-'; }).join(' | ')} |`); };
row('guests / hikers (pref=Hike) sampled', (s) => `${s.guests} / ${s.hikers}`);
row('mean arrival hour', (s) => f1(s.arrivalHourMean));
row('day-guest stay h (p10/p50/p90)', (s) => s.stayPct.map(f1).join(' / '));
row('hikers with >=1 hike attempt', (s) => p(s.hikersWithAttempt / s.hikers));
row('arrival -> first trail tile (h)', (s) => f1(s.arrivalToTrailH));
row('hike attempts / hiker', (s) => f1(s.meanAttemptsPerHiker));
row('mean attempt start hour', (s) => f1(s.startHourMean));
row('mean path length (tiles) / goal rel. altitude', (s) => `${f1(s.meanPathLen)} / ${p(s.meanGoalRel)}`);
row('path includes a lift ride', (s) => p(s.pathWithLift));
row('attempts that cannot finish before 17:00 (path/hike-speed)', (s) => p(s.infeasibleShare));
row('attempts completed', (s) => p(s.completed / s.attempts));
row('aborted: dusk / needs / random-satisfied / no-path|unreachable', (s) => `${p(s.abortedDusk / s.attempts)} / ${p(s.abortedNeeds / s.attempts)} / ${p(s.abortedSatisfied / s.attempts)} / ${p(s.abortedNoPath / s.attempts)}`);
row('hikers reaching mid (>=50 %) / top third (>=67 %) / summit', (s) => `${p(s.mid)} / ${p(s.top3)} / ${p(s.summit)}`);
row('mean / median max altitude %', (s) => `${p(s.meanMaxRel)} / ${p(s.medMaxRel)}`);
row('hours above 50 % / 67 % per hiker', (s) => `${f1(s.meanHoursAbove50)} / ${f1(s.meanHoursAbove67)}`);
row('hikers that rode the lift (share) / rides per hiker', (s) => `${p(s.liftRideShareHikers)} / ${f1(s.hikerRidesPerHiker)}`);
row('lift rides by mode hike/bike/ski', (s) => `${s.liftRidesByMode.hike}/${s.liftRidesByMode.bike}/${s.liftRidesByMode.ski}`);
row('leaving walk h for hikers who started leaving >=30 % up (mean / p90 / n)', (s) => `${f1(s.leaveDurHigh[0]!)} / ${f1(s.leaveDurHigh[1]!)} / ${s.leaveDurHigh[2]}`);
row('leaving walk h for everyone below 30 % (mean / p90 / n)', (s) => `${f1(s.leaveDurLow[0]!)} / ${f1(s.leaveDurLow[1]!)} / ${s.leaveDurLow[2]}`);
row('left via dusk (all guests / hikers)', (s) => `${p(s.leaveClosingShare)} / ${p(s.leaveHikerClosingShare)}`);
row('top-third trail tiles snow-free (start->end of run)', (s) => `${p(s.okTop3Start)} -> ${p(s.okTop3End)}`);
row('abort reasons on trail goals', (s) => Object.entries(s.abortReasons).filter(([, v]) => v >= 3).map(([k, v]) => `${k}:${v}`).join(' '));
out.push('\n### Hiker time budget (share of alive ticks, baseline)\n', '| activity | ' + SIZES.join(' | ') + ' |', '|---|---|---|---|');
for (const c of ['trail', 'toBuilding', 'toLift', 'queue', 'ride', 'using', 'idle', 'leaving', 'sleeping']) out.push(`| ${c} | ${SIZES.map((z) => { const s = get(BASE, z); return s ? p(s.catShare[c as keyof Summary['catShare']]) : '-'; }).join(' | ')} |`);
out.push('\n### Heatmap: baseline hiker-ticks by hour x altitude band (share of the hour; bands 0-20 / 20-40 / 40-60 / 60-80 / 80-100 % of relief)\n');
for (const z of SIZES) {
  const s = get(BASE, z); if (!s) continue;
  out.push(`size ${z}: hour: band shares`, '');
  out.push('| hour | ' + ['0-20', '20-40', '40-60', '60-80', '80-100'].join(' | ') + ' | hiker-ticks |', '|---|---|---|---|---|---|---|');
  for (let h = 6; h <= 21; h++) { const r = s.heat[h]!; const t = r.reduce((a, b) => a + b, 0); out.push(`| ${h}:00 | ${r.map((v) => p(t ? v / t : NaN)).join(' | ')} | ${t} |`); }
  out.push('');
}
out.push('### Arrival hour histogram (baseline, share of arrivals)\n', '| hour | ' + SIZES.join(' | ') + ' |', '|---|---|---|---|');
for (let h = 7; h <= 16; h++) out.push(`| ${h} | ${SIZES.map((z) => { const s = get(BASE, z); if (!s) return '-'; const tot = s.arrivalHist.reduce((a, b) => a + b, 0); return p(s.arrivalHist[h]! / tot); }).join(' | ')} |`);
for (const z of SIZES) {
  out.push(`\n### What-if scenarios, size ${z}\n`, '| scenario | hikers | mid | top third | summit | mean max alt | completed | ms/tick | income/run | queue min/guest |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const sc of order) { const s = get(sc, z); if (!s) continue; out.push(`| ${sc} | ${s.hikers} | ${p(s.mid)} | ${p(s.top3)} | ${p(s.summit)} | ${p(s.meanMaxRel)} | ${p(s.completed / s.attempts)} | ${s.msPerTick.toFixed(2)} | ${Math.round(s.income)} | ${f1(s.meanQueueMinPerGuest)} |`); }
}
if (sums.some((s) => s.scenario === 'new')) {
  out.push('\n### Before (legacy) / after (excursion model + appeal goals + foot lift first)\n', '| metric | ' + SIZES.map((z) => `${z} before | ${z} after`).join(' | ') + ' |', '|---|' + SIZES.map(() => '---|---|').join(''));
  const ba = (name: string, g: (s: Summary) => string): void => { out.push(`| ${name} | ${SIZES.map((z) => [get('legacy', z), get('new', z)].map((s) => (s ? g(s) : '-')).join(' | ')).join(' | ')} |`); };
  ba('hikers sampled', (s) => `${s.hikers}`);
  ba('top third (>=67 %)', (s) => p(s.top3)); ba('mid (>=50 %)', (s) => p(s.mid)); ba('mean max altitude', (s) => p(s.meanMaxRel));
  ba('attempts completed', (s) => p(s.completed / s.attempts));
  ba('hikers that rode a lift', (s) => p(s.liftRideShareHikers)); ba('excursions starting with a lift ride', (s) => (s.exc.started ? p(s.liftFirstShare) : '-'));
  ba('arrival -> first trail (h)', (s) => f1(s.arrivalToTrailH)); ba('income / run', (s) => `${Math.round(s.income)}`);
  ba('queue min / guest', (s) => f1(s.meanQueueMinPerGuest)); ba('ms / tick', (s) => s.msPerTick.toFixed(2));
  ba('excursions started / aborted', (s) => (s.exc.started ? `${s.exc.started} / ${s.exc.aborted}` : '-'));
  ba('trek nights / completed / bed revenue', (s) => `${s.exc.trekNights ?? 0} / ${s.exc.trekDone ?? 0} / ${s.exc.bedRevenue ?? 0}`);
}
console.log(out.join('\n'));
