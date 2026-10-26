import { DAYS_PER_MONTH, DAYS_PER_YEAR } from '../../config/balance';
import { EXPENSE_CATEGORIES, LEDGER_CATEGORIES } from '../../config/prices';
import { seasonOfMonth } from '../Clock';
import { STATS_DAYS, type StatsHistory } from './StatsHistory';

/**
 * Debug / screenshot helper (`__slope.stats.demoYear()`): fills the history with two plausible in-game years ending at the last day of
 * `endYear` (own LCG, never the sim RNG), growing slightly from year to year. Not used by the game itself.
 */
export function fillDemoStats(h: StatsHistory, endYear: number, seed = 7): void {
  let s = seed >>> 0;
  const rnd = (): number => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const lastAbs = (endYear + 1) * DAYS_PER_YEAR - 1, first = lastAbs - STATS_DAYS + 1;
  const series: Record<string, Float32Array | Uint16Array> = {};
  const u = (id: string): Uint16Array => (series[id] = new Uint16Array(STATS_DAYS)) as Uint16Array;
  const f = (id: string): Float32Array => (series[id] = new Float32Array(STATS_DAYS)) as Float32Array;
  const arrivals = u('arrivals'), family = u('family'), peak = u('peak'), income = f('income'), expense = f('expense'), rating = f('rating'), happy = f('happiness');
  const created = u('incCreated'), resolved = u('incResolved'), hosp = u('hospitalised'), runs = u('runs'), snow = f('snow'), skiable = f('skiable'), quality = f('quality');
  const weather = u('weather'), temp = f('temp'), queue = f('queue'), wild = u('wildlife'), attacks = u('attacks');
  const inc = Object.fromEntries(LEDGER_CATEGORIES.map((c) => [c, f(`inc:${c}`)])), exp = Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c, f(`exp:${c}`)]));
  const share: Record<string, number> = { lifts: 0.34, passes: 0.1, lodging: 0.22, shops: 0.05, restaurants: 0.13, bars: 0.04, recreation: 0.07, rental: 0.03, lessons: 0.02, other: 0 };
  for (let abs = first; abs <= lastAbs; abs++) {
    const i = abs % STATS_DAYS, doy = abs % DAYS_PER_YEAR, month = Math.floor(doy / DAYS_PER_MONTH), season = seasonOfMonth(month), yearIx = abs >= first + DAYS_PER_YEAR ? 1 : 0;
    const winter = season === 'winter', summer = season === 'summer';
    const base = (winter ? 62 : summer ? 38 : 14) * (1 + 0.28 * yearIx) * (0.85 + 0.3 * rnd());
    const arr = Math.round(base), gain = Math.round(base * 1.6);
    arrivals[i] = arr; family[i] = Math.round(arr * (0.38 + 0.08 * rnd())); peak[i] = gain + Math.round(rnd() * 8);
    let tot = 0;
    for (const c of LEDGER_CATEGORIES) { const v = c === 'other' ? 0 : Math.round(arr * 52 * (share[c] ?? 0) * (0.9 + 0.2 * rnd())); inc[c]![i] = v; tot += v; }
    income[i] = tot;
    const cost = Math.round(1500 + (winter ? 500 : 100) + 220 * yearIx);
    exp.upkeep![i] = cost * 0.4; exp.staff![i] = cost * 0.35; exp.energy![i] = cost * 0.2; exp.maintenance![i] = cost * 0.05; expense[i] = cost;
    rating[i] = Math.min(5, 3.4 + 0.5 * yearIx + 0.35 * Math.sin(doy / 30) + 0.4 * rnd()); happy[i] = 0.78 + 0.12 * rnd();
    const hit = rnd() < 0.18 ? 1 : 0; created[i] = hit; resolved[i] = hit; hosp[i] = hit && rnd() < 0.2 ? 1 : 0; runs[i] = arr * 5;
    snow[i] = winter ? 0.7 + 0.5 * rnd() : summer ? 0 : 0.2 * rnd(); skiable[i] = winter ? 0.8 + 0.2 * rnd() : 0.1 * rnd(); quality[i] = 0.55 + 0.3 * rnd();
    weather[i] = winter ? (rnd() < 0.35 ? 2 : rnd() < 0.5 ? 0 : 1) : summer ? (rnd() < 0.2 ? 4 : 0) : 1;
    temp[i] = winter ? -6 + 4 * rnd() : summer ? 14 + 8 * rnd() : 3 + 5 * rnd(); queue[i] = 1 + 5 * rnd(); wild[i] = rnd() < 0.03 ? 1 : 0; attacks[i] = 0;
  }
  h.load({ lastAbs, len: STATS_DAYS, acc: {}, cum: {}, cumInit: false, series });
}
