import { describe, expect, it } from 'vitest';
import { ToastLimiter, loadMuted, saveMuted } from '../../src/ui/toastLimiter';

describe('ToastLimiter', () => {
  it('coalesces duplicate keys within the window into a count', () => {
    const l = new ToastLimiter({ coalesceMs: 1000 });
    expect(l.push({ key: 'a', text: 'A', severity: 'info' }, 0)).toBe('shown');
    expect(l.push({ key: 'a', text: 'A', severity: 'info' }, 100)).toBe('coalesced');
    expect(l.push({ key: 'a', text: 'A', severity: 'warn' }, 200)).toBe('coalesced');
    const v = l.visible(300);
    expect(v.length).toBe(1); expect(v[0]!.count).toBe(3); expect(v[0]!.severity).toBe('warn');
    expect(l.push({ key: 'a', text: 'A', severity: 'info' }, 5000)).toBe('shown'); // expired / outside window
  });
  it('caps visible toasts; severity decides who stays', () => {
    const l = new ToastLimiter({ maxVisible: 2 });
    l.push({ key: '1', text: '1', severity: 'info' }, 0);
    l.push({ key: '2', text: '2', severity: 'warn' }, 1);
    expect(l.push({ key: '3', text: '3', severity: 'info' }, 2)).toBe('shown'); // evicts the oldest info
    expect(l.visible(3).map((t) => t.key).sort()).toEqual(['2', '3']);
    expect(l.push({ key: '4', text: '4', severity: 'bad' }, 4)).toBe('shown');
    expect(l.visible(5).length).toBe(2);
    const full = new ToastLimiter({ maxVisible: 1 });
    full.push({ key: 'x', text: 'x', severity: 'bad' }, 0);
    expect(full.push({ key: 'y', text: 'y', severity: 'info' }, 1)).toBe('dropped');
  });
  it('rate: a burst of 100 identical events yields one toast', () => {
    const l = new ToastLimiter();
    for (let i = 0; i < 100; i++) l.push({ key: 'lift', text: 'Lift closed', severity: 'warn' }, i * 10);
    expect(l.visible(1000).length).toBe(1); expect(l.visible(1000)[0]!.count).toBe(100);
  });
  it('mutes categories (but never severe ones) and expires toasts', () => {
    const l = new ToastLimiter({ muted: () => new Set(['ops']), ttlMs: 100 });
    expect(l.push({ key: 'g', text: 'g', severity: 'info', category: 'ops' }, 0)).toBe('muted');
    expect(l.push({ key: 'g2', text: 'g', severity: 'bad', category: 'ops' }, 0)).toBe('shown');
    expect(l.visible(50).length).toBe(1); expect(l.visible(200).length).toBe(0);
  });
  it('persists muted categories', () => {
    const mem = new Map<string, string>();
    const st = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } };
    saveMuted(new Set(['weather', 'ops']), st);
    expect([...loadMuted(st)].sort()).toEqual(['ops', 'weather']);
    expect(loadMuted({ getItem: () => '{bad' }).size).toBe(0);
  });
});
