import { describe, it, expect } from 'vitest';
import { formatMoney, formatDate, nextFps, parseSeed } from '@/ui/format';

describe('ui helpers', () => {
  it('formats money', () => {
    expect(formatMoney(100000)).toBe('$100,000');
    expect(formatMoney(-5.4)).toBe('-$5');
  });
  it('formats date', () => expect(formatDate({ year: 2, day: 0, minute: 0, tick: 0 })).toBe('Year 2, Day 1'));
  it('fps', () => { expect(nextFps(30, 500)).toBe(60); expect(nextFps(1, 0)).toBe(0); });
  it('parses seed', () => {
    expect(parseSeed('42')).toBe(42);
    expect(parseSeed('abc')).toBe(parseSeed('abc'));
    expect(parseSeed('abc')).toBeGreaterThanOrEqual(0);
  });
});
