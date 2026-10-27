import type { GameDate } from '../core/GameState';
import type { SeasonId } from '../core/events';
import { DAYS_PER_MONTH, DAYS_PER_YEAR, MONTHS_PER_YEAR, MINUTES_PER_DAY } from '../config/balance';
import { seasonOf, weekdayOf } from './Clock';

/**
 * The real (northern hemisphere, Alps) calendar laid over the sim's day numbering. Pure labels: NO sim state depends on it.
 *
 * The sim year (`date.day` 0..179) starts at the first day of spring and the seasons run 60/30/60/30 days. The calendar offset of 3 months
 * (45 days) maps sim day 0 to 1 April, so: spring = Apr-May, summer = Jun-Sep, autumn = Oct-Nov, winter = Dec-Mar, and a new game
 * (sim day 120) starts on 1 December. Months are 15 days; the displayed day of month is 1..15. `date.year` is the GAME year and rolls on
 * 1 April (start of the sim year, with the year report); the label never invents another year number.
 * Docs: docs/time-flow.md "Calendar".
 */
export const CALENDAR_OFFSET_MONTHS = 3;
export const CALENDAR_OFFSET_DAYS = CALENDAR_OFFSET_MONTHS * DAYS_PER_MONTH;

export const REAL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
export const REAL_MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
/** The same names indexed by SIM month (0 = first month of the sim year = April). Use with `monthIndex(date)` / `report.month`. */
export const SIM_MONTHS: readonly string[] = Array.from({ length: MONTHS_PER_YEAR }, (_, m) => REAL_MONTHS[(m + CALENDAR_OFFSET_MONTHS) % MONTHS_PER_YEAR]!);
export const SIM_MONTHS_SHORT: readonly string[] = Array.from({ length: MONTHS_PER_YEAR }, (_, m) => REAL_MONTHS_SHORT[(m + CALENDAR_OFFSET_MONTHS) % MONTHS_PER_YEAR]!);
export const WEEKDAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

const wrap = (n: number, m: number): number => ((n % m) + m) % m;

/** Real month (0 = January .. 11 = December) of a sim day of year. */
export const realMonthOfDay = (simDay: number): number => Math.floor(wrap(Math.floor(simDay) + CALENDAR_OFFSET_DAYS, DAYS_PER_YEAR) / DAYS_PER_MONTH);
/** Sim day of year (0..179) of a real month (0 = January) and day of month (1..15). */
export const simDayOf = (realMonth: number, dayOfMonth = 1): number => wrap(wrap(realMonth, MONTHS_PER_YEAR) * DAYS_PER_MONTH + (dayOfMonth - 1) - CALENDAR_OFFSET_DAYS, DAYS_PER_YEAR);
/** Real month name / short name for a sim day of year. */
export const monthNameOfDay = (simDay: number, short = false): string => (short ? REAL_MONTHS_SHORT : REAL_MONTHS)[realMonthOfDay(simDay)]!;
/** Day of month 1..15. */
export const calendarDayOfMonth = (simDay: number): number => wrap(Math.floor(simDay), DAYS_PER_MONTH) + 1;

/** Short label of a sim day of year: 'Dec 3'. */
export const dayOfYearLabel = (simDay: number): string => `${monthNameOfDay(simDay, true)} ${calendarDayOfMonth(simDay)}`;

export interface FormattedDate {
  weekday: string; day: number; month: string; monthShort: string; season: string; year: number;
  /** 'Sat 14 Feb · Winter · Year 1' */
  chip: string;
  /** 'Sat 14 Feb' */
  short: string;
  /** 'Y1 · Sat 14 Feb · 23:18' (single line, for the speed panel). */
  clock: string;
  /** Tooltip: day of year + time. */
  tooltip: string;
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const hhmm = (minute: number): string => `${String(Math.floor(minute / 60) % 24).padStart(2, '0')}:${String(Math.floor(minute % 60)).padStart(2, '0')}`;

/** THE date formatter (HUD chip, speed panel, news, year report, saves list, goals text). */
export function formatGameDate(d: Pick<GameDate, 'year' | 'day'> & { minute?: number }): FormattedDate {
  const weekday = WEEKDAYS_SHORT[weekdayOf(d)]!;
  const day = calendarDayOfMonth(d.day), monthShort = monthNameOfDay(d.day, true), month = monthNameOfDay(d.day), season = cap(seasonOf(d));
  const short = `${weekday} ${day} ${monthShort}`;
  const minute = d.minute ?? 0;
  return {
    weekday, day, month, monthShort, season, year: d.year, short,
    chip: `${short} · ${season} · Year ${d.year}`,
    clock: `Y${d.year} · ${short} · ${hhmm(minute)}`,
    tooltip: `${weekday} ${day} ${month}, ${season}, game year ${d.year} (starts 1 April)\nDay ${d.day + 1} of ${DAYS_PER_YEAR}${d.minute === undefined ? '' : ` · ${hhmm(d.minute % MINUTES_PER_DAY)}`}`,
  };
}

/** Real-calendar boundaries by season (for docs, tests and the Events month strip): sim month index -> season. */
export const SEASON_OF_REAL_MONTH: readonly SeasonId[] = ['winter', 'winter', 'winter', 'spring', 'spring', 'summer', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'winter'];
