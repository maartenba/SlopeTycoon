import type { GameDate } from '../core/GameState';
import type { GameBus, SeasonId } from '../core/events';
import {
  DAYS_PER_MONTH, DAYS_PER_YEAR, GAME_MINUTES_PER_TICK, MINUTES_PER_DAY, MONTHS_PER_YEAR, SEASON_MONTHS,
} from '../config/balance';

const SEASON_IDS: readonly SeasonId[] = ['spring', 'summer', 'autumn', 'winter'];
const MINUTES_PER_MONTH = DAYS_PER_MONTH * MINUTES_PER_DAY;
const MINUTES_PER_YEAR = DAYS_PER_YEAR * MINUTES_PER_DAY;

/** 0-based day of year (0..359). */
export const dayOfYear = (d: Pick<GameDate, 'day'>): number => d.day;
/** 0-based month (0..11). */
export const monthIndex = (d: Pick<GameDate, 'day'>): number => Math.floor(d.day / DAYS_PER_MONTH);
/** 0-based day within the month. */
export const dayOfMonth = (d: Pick<GameDate, 'day'>): number => d.day % DAYS_PER_MONTH;
/** Fractional hour of day, 0..24. */
export const hourOfDay = (d: Pick<GameDate, 'minute'>): number => d.minute / 60;
/** Linear position in the year, 0..1 (days + time of day). */
export const yearFraction = (d: Pick<GameDate, 'day' | 'minute'>): number => (d.day * MINUTES_PER_DAY + d.minute) / MINUTES_PER_YEAR;

/** Season that owns a month (2 spring, 4 summer, 2 autumn, 4 winter). */
export function seasonOfMonth(month: number): SeasonId {
  let m = ((month % MONTHS_PER_YEAR) + MONTHS_PER_YEAR) % MONTHS_PER_YEAR;
  for (let i = 0; i < 4; i++) {
    if (m < SEASON_MONTHS[i]!) return SEASON_IDS[i]!;
    m -= SEASON_MONTHS[i]!;
  }
  return 'winter';
}
export const seasonOf = (d: Pick<GameDate, 'day'>): SeasonId => seasonOfMonth(monthIndex(d));

/**
 * Render season position (the 0..1 `t` of render/Season.ts: quarters spring/summer/autumn/winter, centres .125/.375/.625/.875).
 * Piecewise-linear remap of the calendar so unequal season lengths (2/4/2/4 months) still occupy a quarter each:
 * a season's first month boundary lands exactly on t = k/4 and `seasonName(seasonYear(d))` always equals `seasonOf(d)`.
 */
export function seasonYear(d: Pick<GameDate, 'day' | 'minute'>): number {
  const months = (d.day * MINUTES_PER_DAY + d.minute) / MINUTES_PER_MONTH;
  let start = 0;
  for (let i = 0; i < 4; i++) {
    const len = SEASON_MONTHS[i]!;
    if (months < start + len || i === 3) return Math.min(0.999999, (i + (months - start) / len) / 4);
    start += len;
  }
  return 0;
}

/** Advance the date by one tick (GAME_MINUTES_PER_TICK) and emit boundary events. Mutates `date`. */
export function advanceDate(date: GameDate, bus?: Pick<GameBus, 'emit'>): void {
  const prevHour = Math.floor(date.minute / 60);
  date.tick++;
  date.minute += GAME_MINUTES_PER_TICK;
  let newDay = false;
  while (date.minute >= MINUTES_PER_DAY) { date.minute -= MINUTES_PER_DAY; date.day++; newDay = true; }
  let newYear = false;
  while (date.day >= DAYS_PER_YEAR) { date.day -= DAYS_PER_YEAR; date.year++; newYear = true; }
  if (!bus) return;
  const hour = Math.floor(date.minute / 60);
  if (hour !== prevHour) bus.emit('time:hour', { hour });
  if (newDay) {
    bus.emit('day:changed', { year: date.year, day: date.day });
    if (date.day % DAYS_PER_MONTH === 0) bus.emit('month:changed', { year: date.year, month: monthIndex(date) });
    if (newYear) bus.emit('year:changed', { year: date.year });
  }
}

export const serializeDate = (d: GameDate): GameDate => ({ year: d.year, day: d.day, minute: d.minute, tick: d.tick });
export function loadDate(target: GameDate, src: GameDate): void { target.year = src.year; target.day = src.day; target.minute = src.minute; target.tick = src.tick; }

/** Day of year (0..359) at which a season's first month begins. */
export function seasonStartDay(season: SeasonId): number {
  let m = 0;
  for (let i = 0; i < 4; i++) { if (SEASON_IDS[i] === season) return m * DAYS_PER_MONTH; m += SEASON_MONTHS[i]!; }
  return 0;
}

/** Inverse of `seasonYear`: render season position t in [0,1) -> day of year (0..359). */
export function dayFromSeasonYear(t: number): number {
  const f = (((t % 1) + 1) % 1) * 4;
  const i = Math.min(3, Math.floor(f));
  let start = 0;
  for (let k = 0; k < i; k++) start += SEASON_MONTHS[k]!;
  const months = start + (f - i) * SEASON_MONTHS[i]!;
  return Math.min(DAYS_PER_YEAR - 1, Math.floor(months * DAYS_PER_MONTH));
}

/** Season progress for the HUD: day within the season (1-based), season length in days, the next season and days left. */
export function seasonProgress(d: Pick<GameDate, 'day'>): { season: SeasonId; day: number; length: number; next: SeasonId; daysLeft: number } {
  const season = seasonOf(d);
  const i = SEASON_IDS.indexOf(season);
  const length = SEASON_MONTHS[i]! * DAYS_PER_MONTH;
  const day = d.day - seasonStartDay(season) + 1;
  return { season, day, length, next: SEASON_IDS[(i + 1) % 4]!, daysLeft: length - day + 1 };
}

/**
 * Jump the calendar to `dayOfYear` (hour default 08:00). Always moves forward in time: a target at or before the current day lands in
 * the next year. Pure (no events: the season system notices the new month on its next tick). Returns days skipped.
 */
export function jumpTo(date: GameDate, dayOfYear: number, hour = 8): number {
  const target = ((Math.floor(dayOfYear) % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR;
  const skipped = (target - date.day + DAYS_PER_YEAR) % DAYS_PER_YEAR;
  if (target < date.day) date.year++;
  date.day = target;
  date.minute = Math.max(0, Math.min(MINUTES_PER_DAY - GAME_MINUTES_PER_TICK, Math.floor(hour * 60)));
  return skipped;
}

/** Weekday 0..6 (0 = Monday ... 5 = Saturday, 6 = Sunday) derived from the absolute day index (7-day weeks). */
export const weekdayOf = (d: Pick<GameDate, 'year' | 'day'>): number => (((d.year * DAYS_PER_YEAR + d.day) % 7) + 7) % 7;
