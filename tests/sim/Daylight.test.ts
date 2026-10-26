import { describe, expect, it } from 'vitest';
import {
  arrivalWindow, autoLiftHours, dawnStart, dayGuestLeaveHour, daylightHours, duskEnd, fmtClock, isDaylight, isNightHour, nightWindow, sunrise, sunset, summerness,
} from '@/sim/Daylight';
import { DAYS_PER_YEAR, DAYLIGHT } from '@/config/balance';
import { seasonOf } from '@/sim/Clock';

const WINTER = DAYLIGHT.winterSolsticeDay, SUMMER = DAYLIGHT.summerSolsticeDay;

describe('daylight curve', () => {
  it('hits the design numbers at the solstices and equinoxes', () => {
    expect(sunrise(WINTER)).toBeCloseTo(7.75, 6); expect(sunset(WINTER)).toBeCloseTo(16.75, 6); expect(daylightHours(WINTER)).toBeCloseTo(9, 6);
    expect(sunrise(SUMMER)).toBeCloseTo(5.25, 6); expect(sunset(SUMMER)).toBeCloseTo(20.75, 6); expect(daylightHours(SUMMER)).toBeCloseTo(15.5, 6);
    for (const d of [15, 105]) { expect(sunrise(d)).toBeCloseTo(6.5, 6); expect(sunset(d)).toBeCloseTo(18.75, 6); expect(daylightHours(d)).toBeGreaterThan(12); expect(daylightHours(d)).toBeLessThan(12.5); }
  });
  it('solstices sit in the middle of the winter / summer seasons of the 60/120/60/120 (180-day year) layout', () => {
    expect(seasonOf({ day: WINTER })).toBe('winter'); expect(seasonOf({ day: SUMMER })).toBe('summer');
    expect(seasonOf({ day: 15 })).toBe('spring'); expect(seasonOf({ day: 105 })).toBe('autumn');
  });
  it('is monotonic between the solstices (daylight grows into summer, shrinks into winter, sunrise/sunset never reverse)', () => {
    for (let d = WINTER - DAYS_PER_YEAR; d < SUMMER; d += 1) { // winter(prev) -> summer
      expect(sunrise(d + 1), `d${d}`).toBeLessThanOrEqual(sunrise(d) + 1e-12);
      expect(sunset(d + 1)).toBeGreaterThanOrEqual(sunset(d) - 1e-12);
      expect(daylightHours(d + 1)).toBeGreaterThanOrEqual(daylightHours(d) - 1e-12);
    }
    for (let d = SUMMER; d < WINTER; d += 1) {
      expect(sunrise(d + 1)).toBeGreaterThanOrEqual(sunrise(d) - 1e-12);
      expect(sunset(d + 1)).toBeLessThanOrEqual(sunset(d) + 1e-12);
      expect(daylightHours(d + 1)).toBeLessThanOrEqual(daylightHours(d) + 1e-12);
    }
  });
  it('is symmetric about the solstices and continuous over the year wrap', () => {
    for (const k of [5, 22, 45, 75]) {
      expect(sunrise(WINTER + k)).toBeCloseTo(sunrise(WINTER - k), 9); expect(sunset(SUMMER + k)).toBeCloseTo(sunset(SUMMER - k), 9);
      expect(daylightHours(SUMMER + k)).toBeCloseTo(daylightHours(SUMMER - k), 9);
    }
    expect(sunrise(DAYS_PER_YEAR)).toBeCloseTo(sunrise(0), 9); expect(sunset(DAYS_PER_YEAR)).toBeCloseTo(sunset(0), 9);
    expect(Math.abs(sunrise(DAYS_PER_YEAR - 0.01) - sunrise(0))).toBeLessThan(1e-3);
    expect(Math.abs(sunset(DAYS_PER_YEAR - 0.25) - sunset(0.25))).toBeLessThan(0.04);
  });
  it('stays inside the sane ranges all year', () => {
    for (let d = 0; d < DAYS_PER_YEAR; d++) {
      expect(sunrise(d)).toBeGreaterThanOrEqual(5.25 - 1e-9); expect(sunrise(d)).toBeLessThanOrEqual(7.75 + 1e-9);
      expect(sunset(d)).toBeGreaterThanOrEqual(16.75 - 1e-9); expect(sunset(d)).toBeLessThanOrEqual(20.75 + 1e-9);
      expect(summerness(d)).toBeGreaterThanOrEqual(0); expect(summerness(d)).toBeLessThanOrEqual(1);
    }
  });
  it('isDaylight / twilight / night window helpers', () => {
    expect(isDaylight({ day: WINTER, minute: 12 * 60 })).toBe(true);
    expect(isDaylight({ day: WINTER, minute: 17 * 60 })).toBe(false);
    expect(isDaylight({ day: SUMMER, minute: 17 * 60 })).toBe(true);
    expect(isDaylight({ day: SUMMER, minute: 5 * 60 })).toBe(false);
    expect(duskEnd(WINTER) - sunset(WINTER)).toBeCloseTo(0.75, 9); expect(sunrise(WINTER) - dawnStart(WINTER)).toBeCloseTo(0.75, 9);
    const w = nightWindow(SUMMER); expect(w.start).toBeCloseTo(21.5, 6); expect(w.end).toBeCloseTo(24 + 4.5, 6);
    expect(isNightHour(SUMMER, 23)).toBe(true); expect(isNightHour(SUMMER, 3)).toBe(true); expect(isNightHour(SUMMER, 5)).toBe(false); expect(isNightHour(SUMMER, 21)).toBe(false);
    expect(isNightHour(WINTER, 17.6)).toBe(true); expect(isNightHour(WINTER, 6.9)).toBe(true); expect(isNightHour(WINTER, 12)).toBe(false);
    expect(fmtClock(16.75)).toBe('16:45'); expect(fmtClock(5.25)).toBe('05:15');
  });
});

describe('schedules follow the sun', () => {
  it('arrival window = [sunrise + 1 h, sunset - 2.5 h] clamped (08:00-16:30 winter, 07:30-18:00 summer)', () => {
    const w = arrivalWindow(WINTER); expect(w.from).toBeCloseTo(8.75, 6); expect(w.to).toBeCloseTo(14.25, 6);
    const s = arrivalWindow(SUMMER); expect(s.from).toBeCloseTo(7.5, 6); expect(s.to).toBeCloseTo(18, 6); // 5:15+1 = 6:15 clamps up to 07:30; 20:45-2.5 = 18:15 clamps to 18:00
    for (let d = 0; d < DAYS_PER_YEAR; d++) {
      const a = arrivalWindow(d);
      expect(a.from).toBeGreaterThanOrEqual(7.5 - 1e-9); expect(a.to).toBeLessThanOrEqual(18 + 1e-9); expect(a.to - a.from).toBeGreaterThan(5);
      expect(a.from).toBeGreaterThanOrEqual(sunrise(d) + 1 - 1e-9 > 7.5 ? sunrise(d) + 1 - 1e-9 : 7.5 - 1e-9);
    }
  });
  it('day guests leave at sunset - 30 min (winter) / - 1 h (summer), before dark and after the last arrivals', () => {
    expect(dayGuestLeaveHour(WINTER)).toBeCloseTo(16.25, 6); expect(dayGuestLeaveHour(SUMMER)).toBeCloseTo(19.75, 6);
    for (let d = 0; d < DAYS_PER_YEAR; d++) { expect(dayGuestLeaveHour(d)).toBeLessThan(sunset(d)); expect(dayGuestLeaveHour(d)).toBeGreaterThan(arrivalWindow(d).to + 1.5); }
  });
  it('auto lift hours = [sunrise + 45 min, sunset - 15 min]', () => {
    const w = autoLiftHours(WINTER); expect(w.from).toBeCloseTo(8.5, 6); expect(w.to).toBeCloseTo(16.5, 6);
    const s = autoLiftHours(SUMMER); expect(s.from).toBeCloseTo(6, 6); expect(s.to).toBeCloseTo(20.5, 6);
  });
});
