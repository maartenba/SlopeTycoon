import { describe, expect, it } from 'vitest';
import { advanceDate, dayOfYear, monthIndex, seasonOf, seasonOfMonth, seasonYear, yearFraction } from '@/sim/Clock';
import { seasonName, SEASON_CENTERS } from '@/render/Season';
import { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import type { GameDate } from '@/core/GameState';
import { DAYS_PER_YEAR, GAME_MINUTES_PER_TICK, MINUTES_PER_DAY } from '@/config/balance';

const d = (day: number, minute = 0, year = 1): GameDate => ({ year, day, minute, tick: 0 });
const TICKS_PER_DAY = MINUTES_PER_DAY / GAME_MINUTES_PER_TICK;

describe('Clock calendar', () => {
  it('maps days to months and seasons (2 spring, 4 summer, 2 autumn, 4 winter)', () => {
    expect(monthIndex(d(0))).toBe(0);
    expect(monthIndex(d(14))).toBe(0);
    expect(monthIndex(d(15))).toBe(1);
    expect(monthIndex(d(179))).toBe(11);
    expect(dayOfYear(d(12))).toBe(12);
    const seasons = Array.from({ length: 12 }, (_, m) => seasonOfMonth(m));
    expect(seasons).toEqual(['spring', 'spring', 'summer', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'winter', 'winter', 'winter', 'winter']);
  });

  it('season boundaries land exactly on month boundaries and agree with render/Season', () => {
    for (const [day, expectT] of [[0, 0], [30, 0.25], [90, 0.5], [120, 0.75]] as const) {
      expect(seasonYear(d(day))).toBeCloseTo(expectT, 12);
      expect(seasonName(seasonYear(d(day)))).toBe(seasonOf(d(day)));
      expect(seasonName(seasonYear(d(day - 1 < 0 ? 179 : day - 1, 1439)))).toBe(seasonOf(d(day - 1 < 0 ? 179 : day - 1)));
    }
    for (let day = 0; day < DAYS_PER_YEAR; day++) expect(seasonName(seasonYear(d(day, 700)))).toBe(seasonOf(d(day)));
    expect(seasonYear(d(179, 1439))).toBeLessThan(1);
    // mid-season = render centre
    expect(seasonYear(d(60))).toBeCloseTo(SEASON_CENTERS.summer, 12);
    expect(seasonYear(d(150))).toBeCloseTo(SEASON_CENTERS.winter, 12);
    expect(seasonYear(d(15))).toBeCloseTo(SEASON_CENTERS.spring, 12);
    expect(seasonYear(d(105))).toBeCloseTo(SEASON_CENTERS.autumn, 12);
  });

  it('yearFraction is linear 0..1', () => {
    expect(yearFraction(d(0))).toBe(0);
    expect(yearFraction(d(90))).toBe(0.5);
    expect(yearFraction(d(179, 1439))).toBeLessThan(1);
  });
});

describe('advanceDate', () => {
  it('rolls minute -> day -> month -> year and emits events', () => {
    const bus = new EventBus<GameEvents>();
    const log: string[] = [];
    bus.on('time:hour', (e) => log.push(`h${e.hour}`));
    bus.on('day:changed', (e) => log.push(`d${e.day}`));
    bus.on('month:changed', (e) => log.push(`m${e.month}`));
    bus.on('year:changed', (e) => log.push(`y${e.year}`));
    const date = d(DAYS_PER_YEAR - 1, MINUTES_PER_DAY - GAME_MINUTES_PER_TICK);
    advanceDate(date, bus);
    expect(date).toEqual({ year: 2, day: 0, minute: 0, tick: 1 });
    expect(log).toEqual(['h0', 'd0', 'm0', 'y2']);
  });

  it('a day takes the configured number of ticks; month boundary emits month:changed once', () => {
    const bus = new EventBus<GameEvents>();
    let months = 0, days = 0, hours = 0;
    bus.on('month:changed', () => months++);
    bus.on('day:changed', () => days++);
    bus.on('time:hour', () => hours++);
    const date = d(0);
    for (let i = 0; i < TICKS_PER_DAY * 16; i++) advanceDate(date, bus);
    expect(date.day).toBe(16);
    expect(days).toBe(16);
    expect(months).toBe(1);
    expect(hours).toBe(24 * 16);
    expect(date.tick).toBe(TICKS_PER_DAY * 16);
  });

  it('works without a bus', () => {
    const date = d(0);
    advanceDate(date);
    expect(date.minute).toBe(GAME_MINUTES_PER_TICK);
  });
});
