import { DAYLIGHT, DAYS_PER_YEAR } from '../config/balance';

/** Pure seasonal daylight model (no three). Hours are game hours 0..24; `day` is a (fractional) 0-based day of year. */
export interface SunTimes { sunrise: number; sunset: number }

const TAU = Math.PI * 2;
const wave = (day: number, peakDay: number): number => Math.cos((TAU * (day - peakDay)) / DAYS_PER_YEAR);

export const sunrise = (day: number): number => DAYLIGHT.sunriseMean + DAYLIGHT.sunriseAmp * wave(day, DAYLIGHT.winterSolsticeDay);
export const sunset = (day: number): number => DAYLIGHT.sunsetMean + DAYLIGHT.sunsetAmp * wave(day, DAYLIGHT.summerSolsticeDay);
export const sunTimes = (day: number): SunTimes => ({ sunrise: sunrise(day), sunset: sunset(day) });

type DateLike = { day: number; minute?: number };
const dayF = (d: DateLike | number): number => (typeof d === 'number' ? d : d.day + (d.minute ?? 0) / 1440);

export const daylightHours = (d: DateLike | number): number => sunset(dayF(d)) - sunrise(dayF(d));
/** True between sunrise and sunset (needs `minute`). */
export function isDaylight(d: Required<DateLike>): boolean { const h = d.minute / 60; return h >= sunrise(d.day) && h < sunset(d.day); }

/** Civil twilight: first light / last light. */
export const dawnStart = (day: number): number => sunrise(day) - DAYLIGHT.twilight;
export const duskEnd = (day: number): number => sunset(day) + DAYLIGHT.twilight;
/** The dark window of a day: [sunset + twilight, sunrise - twilight (+24)]; `end` may exceed 24 (it is the next morning). */
export const nightWindow = (day: number): { start: number; end: number } => ({ start: duskEnd(day), end: dawnStart(day) + 24 });
/** True in the dark window (twilight margins excluded): after duskEnd or before dawnStart. */
export function isNightHour(day: number, hour: number): boolean { const h = ((hour % 24) + 24) % 24; return h >= duskEnd(day) || h < dawnStart(day); }

/** 0 = shortest day (9 h), 1 = longest (15.5 h). */
export const summerness = (day: number): number => {
  const lo = DAYLIGHT.sunsetMean - DAYLIGHT.sunsetAmp - (DAYLIGHT.sunriseMean + DAYLIGHT.sunriseAmp), hi = DAYLIGHT.sunsetMean + DAYLIGHT.sunsetAmp - (DAYLIGHT.sunriseMean - DAYLIGHT.sunriseAmp);
  return Math.min(1, Math.max(0, (daylightHours(day) - lo) / (hi - lo)));
};

/** Guest arrival window [from,to] hours: sunrise+1h .. sunset-2.5h clamped to 08:00-16:30 (winter) / 07:30-18:00 (summer). */
export function arrivalWindow(day: number): { from: number; to: number } {
  const k = summerness(day), r = sunrise(day), s = sunset(day);
  const minH = DAYLIGHT.arriveMinWinter + (DAYLIGHT.arriveMin - DAYLIGHT.arriveMinWinter) * k;
  const maxH = DAYLIGHT.arriveMaxWinter + (DAYLIGHT.arriveMaxSummer - DAYLIGHT.arriveMaxWinter) * k;
  return { from: Math.max(minH, r + DAYLIGHT.arriveAfter), to: Math.min(maxH, s - DAYLIGHT.arriveBefore) };
}
/** Hour at which day guests start heading home: sunset - 30 min (winter) .. sunset - 1 h (summer). */
export function dayGuestLeaveHour(day: number): number {
  const k = summerness(day);
  return sunset(day) - (DAYLIGHT.leaveBeforeWinter + (DAYLIGHT.leaveBeforeSummer - DAYLIGHT.leaveBeforeWinter) * k);
}
/** 'Auto (daylight)' lift operating hours. */
export function autoLiftHours(day: number): { from: number; to: number } {
  return { from: sunrise(day) + DAYLIGHT.liftAfter, to: sunset(day) - DAYLIGHT.liftBefore };
}
export const fmtClock = (h: number): string => { const m = Math.round(h * 60); return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
