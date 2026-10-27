import { describe, expect, it } from 'vitest';
import { DAYLIGHT, DAYS_PER_MONTH, DAYS_PER_YEAR, START_DAY_OF_YEAR, snowlineFraction, TEMP_PER_RELIEF } from '../../src/config/balance';
import { BOOKABLE_FESTIVALS, FESTIVAL_BY_ID } from '../../src/config/festivals';
import { seasonOf } from '../../src/sim/Clock';
import { REAL_MONTHS, SEASON_OF_REAL_MONTH, SIM_MONTHS, calendarDayOfMonth, dayOfYearLabel, formatGameDate, monthNameOfDay, realMonthOfDay, simDayOf } from '../../src/sim/calendar';
import { daylightHours } from '../../src/sim/Daylight';
import { NEW_YEAR_EVE_DOY } from '../../src/sim/events/EventCalendar';
import { phaseFor } from '../../src/sim/nature/Livestock';

/** The calendar table: real month -> season. Label-only mapping (sim seasons are 60/30/60/30 days from sim day 0 = 1 April). */
const TABLE: Array<[string, string, number]> = [
  ['January', 'winter', 135], ['February', 'winter', 150], ['March', 'winter', 165], ['April', 'spring', 0], ['May', 'spring', 15], ['June', 'summer', 30],
  ['July', 'summer', 45], ['August', 'summer', 60], ['September', 'summer', 75], ['October', 'autumn', 90], ['November', 'autumn', 105], ['December', 'winter', 120],
];

describe('real calendar over the sim year', () => {
  it('maps all 12 months to the expected season and first sim day', () => {
    for (const [i, [name, season, first]] of TABLE.entries()) {
      expect(REAL_MONTHS[i]).toBe(name);
      expect(simDayOf(i, 1)).toBe(first);
      expect(monthNameOfDay(first)).toBe(name);
      expect(SEASON_OF_REAL_MONTH[i]).toBe(season);
      for (const d of [first, first + DAYS_PER_MONTH - 1]) { expect(seasonOf({ day: d % DAYS_PER_YEAR })).toBe(season); expect(realMonthOfDay(d)).toBe(i); }
    }
  });
  it('winter is Dec-Mar, spring Apr-May, summer Jun-Sep, autumn Oct-Nov; season lengths stay 60/30/60/30', () => {
    const n: Record<string, number> = {};
    for (let d = 0; d < DAYS_PER_YEAR; d++) n[seasonOf({ day: d })] = (n[seasonOf({ day: d })] ?? 0) + 1;
    expect(n).toEqual({ spring: 30, summer: 60, autumn: 30, winter: 60 });
    expect(SIM_MONTHS[0]).toBe('April'); expect(SIM_MONTHS[11]).toBe('March');
  });
  it('a new game starts on 1 December, February is winter', () => {
    expect(monthNameOfDay(START_DAY_OF_YEAR)).toBe('December'); expect(calendarDayOfMonth(START_DAY_OF_YEAR)).toBe(1);
    expect(seasonOf({ day: simDayOf(1, 14) })).toBe('winter');
  });
  it('day labels and round trip', () => {
    expect(dayOfYearLabel(0)).toBe('Apr 1'); expect(dayOfYearLabel(179)).toBe('Mar 15');
    for (let d = 0; d < DAYS_PER_YEAR; d++) expect(simDayOf(realMonthOfDay(d), calendarDayOfMonth(d))).toBe(d);
  });
  it('formatGameDate: chip, clock line, tooltip', () => {
    const f = formatGameDate({ year: 1, day: simDayOf(1, 14), minute: 23 * 60 + 18 });
    expect(f.month).toBe('February'); expect(f.day).toBe(14); expect(f.season).toBe('Winter');
    expect(f.chip).toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) 14 Feb · Winter · Year 1$/);
    expect(f.clock).toBe(`Y1 · ${f.short} · 23:18`);
    expect(f.tooltip).toContain('Day 164 of 180'); expect(f.tooltip).toContain('23:18');
    expect(formatGameDate({ year: 2, day: 0 }).chip).toContain('1 Apr · Spring · Year 2');
  });
});

describe('climate curves vs month names (documented offsets, sim unchanged)', () => {
  it('daylight extremes sit at 1 Aug / 1 Feb (real solstices are 21 Jun / 21 Dec: known offset, see docs/time-flow.md)', () => {
    expect([monthNameOfDay(DAYLIGHT.summerSolsticeDay), calendarDayOfMonth(DAYLIGHT.summerSolsticeDay)]).toEqual(['August', 1]);
    expect([monthNameOfDay(DAYLIGHT.winterSolsticeDay), calendarDayOfMonth(DAYLIGHT.winterSolsticeDay)]).toEqual(['February', 1]);
    const hours = Array.from({ length: DAYS_PER_YEAR }, (_, d) => daylightHours(d));
    expect(Math.abs(hours.indexOf(Math.max(...hours)) - DAYLIGHT.summerSolsticeDay)).toBeLessThanOrEqual(1);
    expect(Math.abs(hours.indexOf(Math.min(...hours)) - DAYLIGHT.winterSolsticeDay)).toBeLessThanOrEqual(1);
  });
  it('temperature: coldest in winter (Feb), warmest in summer (Aug), snow to the valley Dec-Mar, snow-free valley Jun-Sep', () => {
    const t = Array.from({ length: DAYS_PER_YEAR }, (_, d) => snowlineFraction(d) * TEMP_PER_RELIEF);
    expect(seasonOf({ day: t.indexOf(Math.min(...t)) })).toBe('winter'); expect(monthNameOfDay(t.indexOf(Math.min(...t)))).toBe('February');
    expect(seasonOf({ day: t.indexOf(Math.max(...t)) })).toBe('summer'); expect(monthNameOfDay(t.indexOf(Math.max(...t)))).toBe('August');
    for (let d = simDayOf(11, 1); d < DAYS_PER_YEAR; d++) expect(snowlineFraction(d)).toBeLessThan(0.05);
    for (let d = simDayOf(5, 1); d <= simDayOf(8, 15); d++) expect(snowlineFraction(d)).toBeGreaterThan(0.9);
  });
});

describe('festival and event windows', () => {
  const m = (id: string): [string, string] => { const w = FESTIVAL_BY_ID[id as keyof typeof FESTIVAL_BY_ID].startWindow!; return [monthNameOfDay(w[0]), monthNameOfDay(w[1])]; };
  it('Christmas Market starts in December, Carnival in February, World Cup Jan-Feb, Music Festival Jun-Aug', () => {
    expect(m('christmasMarket')).toEqual(['December', 'December']);
    expect(m('carnival')).toEqual(['February', 'February']);
    expect(m('worldCup')).toEqual(['January', 'February']);
    expect(m('musicFestival')).toEqual(['June', 'August']);
  });
  it('every booked window sits inside its allowed season', () => {
    for (const f of BOOKABLE_FESTIVALS) for (let d = f.startWindow![0]; d <= f.startWindow![1]; d++) expect(f.seasons).toContain(seasonOf({ day: d }));
  });
  it('New Year is the last day of December / 1 January; Almabtrieb runs in early October', () => {
    expect(monthNameOfDay(NEW_YEAR_EVE_DOY)).toBe('December'); expect(calendarDayOfMonth(NEW_YEAR_EVE_DOY)).toBe(15);
    expect(monthNameOfDay(NEW_YEAR_EVE_DOY + 1)).toBe('January');
    const descend = Array.from({ length: DAYS_PER_YEAR }, (_, d) => d).filter((d) => phaseFor(d) === 'descend');
    expect(new Set(descend.map((d) => monthNameOfDay(d)))).toEqual(new Set(['October']));
  });
});
