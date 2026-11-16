import { describe, expect, it } from 'vitest';
import { ToastHold, bannerChip, phoneMode } from '@/ui/phoneCards';

describe('phoneCards (pure)', () => {
  it('mode priority: modal > tool > sheet > idle', () => {
    expect(phoneMode({ modal: false, tool: false, sheet: false })).toBe('idle');
    expect(phoneMode({ modal: false, tool: false, sheet: true })).toBe('sheet');
    expect(phoneMode({ modal: false, tool: true, sheet: true })).toBe('tool');
    expect(phoneMode({ modal: true, tool: true, sheet: true })).toBe('modal');
  });
  it('banner chip: goal > rudi > news, only when idle', () => {
    expect(bannerChip({ mode: 'idle', goal: true, rudi: true, news: true })).toBe('goal');
    expect(bannerChip({ mode: 'idle', goal: false, rudi: true, news: true })).toBe('rudi');
    expect(bannerChip({ mode: 'idle', goal: false, rudi: false, news: true })).toBe('news');
    expect(bannerChip({ mode: 'idle', goal: false, rudi: false, news: false })).toBeNull();
    for (const m of ['tool', 'sheet', 'modal'] as const) expect(bannerChip({ mode: m, goal: true, rudi: true, news: true })).toBeNull();
  });
  it('toast hold queues while held and releases one at a time', () => {
    const h = new ToastHold<string>(3);
    expect(h.offer('a')).toBe(true);
    h.held = true;
    expect(h.offer('b')).toBe(false); h.offer('c'); h.offer('d'); h.offer('e');
    expect(h.size).toBe(3); // oldest dropped
    expect(h.next()).toBeUndefined();
    h.held = false;
    expect([h.next(), h.next(), h.next(), h.next()]).toEqual(['c', 'd', 'e', undefined]);
  });
});
