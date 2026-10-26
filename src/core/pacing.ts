import { sunTimes } from '../sim/Daylight';
import { DAYS_PER_MONTH, DAYS_PER_YEAR, REAL_SECONDS_PER_DAY_1X, SEASON_MONTHS, SPEED_MULTIPLIERS } from '../config/balance';
/**
 * Pacing layer ("Fast nights"): a pure time-scale factor as a function of the in-game hour.
 * It only changes how many sim ticks run per real second; the sim itself stays tick-based and deterministic.
 */
export const NIGHT_WARP_MAX = 3;
/** Dusk ease-in 20:30-21:30, full warp 21:30-05:30, dawn ease-out 05:30-06:30. */
export const WARP_DUSK_START = 20.5;
export const WARP_NIGHT_START = 21.5;
export const WARP_NIGHT_END = 5.5;
export const WARP_DAWN_END = 6.5;

const smooth = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * Dynamic nights: with a day's sunrise/sunset the full warp window is [sunset + 45 min, sunrise - 45 min]; it eases in over the following
 * hour (WARP_EASE) and eases out over the hour before that, so the warp is back to 1 exactly at sunrise - 45 min (dawn glow plays at normal speed).
 * Summer nights are short, winter nights long, both warped. Without `sun` the legacy fixed constants above are used.
 */
export const WARP_EASE = 1;
export const WARP_MARGIN = 0.75;

/** Tick-rate multiplier (1..NIGHT_WARP_MAX) for an in-game hour (wraps at 24). Continuous. `sun` = today's sunrise/sunset (sim/Daylight.ts). */
export function nightWarp(hourIn: number, sun?: { sunrise: number; sunset: number }): number {
  const h = ((hourIn % 24) + 24) % 24;
  let k: number;
  if (sun) {
    const inStart = sun.sunset + WARP_MARGIN, full0 = inStart + WARP_EASE; // ease in
    const outEnd = sun.sunrise - WARP_MARGIN, full1 = outEnd - WARP_EASE; // ease out (full warp until full1)
    const x = h < 12 ? h + 24 : h; // evening hours as-is, early morning shifted to the next day
    const evening = h >= 12 ? h : h + 24;
    const dusk = smooth(inStart, full0, evening);
    const dawn = 1 - smooth(full1 + 24, outEnd + 24, x);
    k = Math.min(dusk, dawn);
  } else if (h >= WARP_NIGHT_START || h <= WARP_NIGHT_END) k = 1;
  else if (h >= WARP_DUSK_START) k = smooth(WARP_DUSK_START, WARP_NIGHT_START, h);
  else if (h >= WARP_NIGHT_END && h < WARP_DAWN_END) k = 1 - smooth(WARP_NIGHT_END, WARP_DAWN_END, h);
  else k = 0;
  return 1 + (NIGHT_WARP_MAX - 1) * k;
}

/** HUD indicator text while the warp is noticeably above 1 ('' otherwise). */
export function warpIndicator(warp: number): string {
  if (!(warp > 1.05)) return '';
  return `🌙»${warp >= NIGHT_WARP_MAX - 0.05 ? '»' : ''}`;
}

// ---- Real-time cost of calendar spans (docs/time-flow.md: "seasons reachable") ----

/** Real seconds `days` game days take at speed index `speed` (1..3) without fast nights (the worst case; fast nights make it ~30 % shorter). */
export const realSecondsForDays = (days: number, speed: number): number => (days * REAL_SECONDS_PER_DAY_1X) / (SPEED_MULTIPLIERS[speed] ?? 1);
/** Same, in minutes. */
export const realMinutesForDays = (days: number, speed: number): number => realSecondsForDays(days, speed) / 60;
/** Real minutes of each season (spring, summer, autumn, winter) and the whole year at a speed index. */
export function seasonRealMinutes(speed: number): { spring: number; summer: number; autumn: number; winter: number; year: number } {
  const m = (i: number): number => realMinutesForDays(SEASON_MONTHS[i]! * DAYS_PER_MONTH, speed);
  return { spring: m(0), summer: m(1), autumn: m(2), winter: m(3), year: realMinutesForDays(DAYS_PER_YEAR, speed) };
}

// ---- Real-time estimates with fast nights (scenario deadlines, docs/time-flow.md) ----
const warpTicks = 240;
let meanInvWarp: number | null = null;
/** Mean of 1/warp over a day's ticks, averaged over 12 days spread across the year (fast nights make the average day ~30 % shorter). */
export function fastNightsFactor(): number {
  if (meanInvWarp !== null) return meanInvWarp;
  let sum = 0, n = 0;
  for (let d = 0; d < DAYS_PER_YEAR; d += DAYS_PER_YEAR / 12) {
    const sun = sunTimes(d);
    for (let t = 0; t < warpTicks; t++) { sum += 1 / nightWarp((t * 24) / warpTicks, sun); n++; }
  }
  return (meanInvWarp = sum / n);
}
/** Real seconds one game day takes at speed index `speed` (1..3), optionally with fast nights. */
export const realSecondsPerDay = (speed: number, fastNights: boolean): number => (REAL_SECONDS_PER_DAY_1X / (SPEED_MULTIPLIERS[speed] ?? 1)) * (fastNights ? fastNightsFactor() : 1);
/** Real minutes `days` game days take at a speed index. */
export const realMinutesWithNights = (days: number, speed: number, fastNights = true): number => (days * realSecondsPerDay(speed, fastNights)) / 60;
/** 'about 25 min' / 'about 2.5 h' / 'under a minute'. */
export function formatRealMinutes(min: number): string {
  if (min < 1) return 'under a minute';
  if (min < 90) return `about ${Math.round(min / (min < 10 ? 0.5 : min < 30 ? 1 : 5)) * (min < 10 ? 0.5 : min < 30 ? 1 : 5)} min`;
  const h = min / 60;
  return `about ${h < 10 ? (Math.round(h * 2) / 2).toString() : Math.round(h).toString()} h`;
}
/** Scenario deadline as real time at each speed button: 'about 7.5 h at 1×, about 2.5 h at 3×, about 25 min at 10× (fast nights on)'. */
export function deadlineRealTimeText(days: number, fastNights = true): string {
  const parts = [1, 2, 3].map((s) => `${formatRealMinutes(realMinutesWithNights(days, s, fastNights))} at ${SPEED_MULTIPLIERS[s]}×`);
  return `${parts.join(', ')}${fastNights ? ' (fast nights on)' : ''}`;
}
