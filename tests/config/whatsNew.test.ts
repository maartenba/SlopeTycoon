import { describe, expect, it, vi } from 'vitest';
import { buildUpdateCard, compareVersions, entriesBetween, fetchWhatsNew, parseWhatsNewJson, updateReminderDue, whatsNewOnLaunch, WHATS_NEW, type WhatsNewEntry } from '../../src/config/whatsNew';

const E = (v: string, ...h: string[]): WhatsNewEntry => ({ version: v, date: '2026-01-01', highlights: h.length ? h : [`${v} thing`] });
const L = [E('0.2.4'), E('0.2.3'), E('0.2.2'), E('0.2.1')];

describe('version logic', () => {
  it('compares numerically (0.2.10 > 0.2.9) and sorts unparsable lowest', () => {
    expect(compareVersions('0.2.10', '0.2.9')).toBeGreaterThan(0); expect(compareVersions('1.0.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('0.2.3', '0.2.3')).toBe(0); expect(compareVersions('dev', '0.0.1')).toBeLessThan(0);
  });
  it('entriesBetween: newer than running, up to the target, newest first', () => {
    expect(entriesBetween(L, '0.2.2').map((e) => e.version)).toEqual(['0.2.4', '0.2.3']);
    expect(entriesBetween(L, '0.2.2', '0.2.3').map((e) => e.version)).toEqual(['0.2.3']);
    expect(entriesBetween(L, '0.2.4')).toEqual([]);
  });
});
describe('update card model', () => {
  it('shows the new version and every highlight section between running and new', () => {
    const m = buildUpdateCard('0.2.2', L);
    expect(m.title).toBe('A new version is available: 0.2.4'); expect(m.sections.map((s) => s.version)).toEqual(['0.2.4', '0.2.3']); expect(m.fallback).toBe(false);
  });
  it('falls back to "A new version is ready" when offline / failed / same version', () => {
    expect(buildUpdateCard('0.2.2', null)).toMatchObject({ title: 'A new version is ready', fallback: true, sections: [] });
    expect(buildUpdateCard('0.2.2', [])).toMatchObject({ fallback: true });
    expect(buildUpdateCard('0.2.4', L)).toMatchObject({ title: 'A new version is ready', fallback: true });
  });
});
describe('reminder throttle', () => {
  it('at most once per hour', () => {
    expect(updateReminderDue(null, 1000)).toBe(true);
    expect(updateReminderDue(1000, 1000 + 59 * 60_000)).toBe(false);
    expect(updateReminderDue(1000, 1000 + 60 * 60_000)).toBe(true);
    expect(updateReminderDue(5000, 1000)).toBe(true); // clock went back: do not stay silent forever
    expect(updateReminderDue(Number.NaN, 1000)).toBe(true);
  });
});
describe('network fetch (same-origin, offline-safe)', () => {
  const ok = { entries: [{ version: '0.2.4', date: '2026-10-30', highlights: ['a', 'b'] }] };
  it('fetches with no-store when online', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ok }));
    expect(await fetchWhatsNew({ online: true, fetch: f })).toEqual(ok.entries);
    expect(f).toHaveBeenCalledWith('./whats-new.json', { cache: 'no-store' });
  });
  it('offline: no request at all; failures and junk give null', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ok }));
    expect(await fetchWhatsNew({ online: false, fetch: f })).toBeNull(); expect(f).not.toHaveBeenCalled();
    expect(await fetchWhatsNew({ online: true, fetch: async () => { throw new Error('net'); } })).toBeNull();
    expect(await fetchWhatsNew({ online: true, fetch: async () => ({ ok: false, json: async () => ok }) })).toBeNull();
    expect(await fetchWhatsNew({ online: true, fetch: async () => ({ ok: true, json: async () => { throw new Error('bad'); } }) })).toBeNull();
    expect(parseWhatsNewJson({ entries: [{ version: 'x', highlights: [] }, 5] })).toBeNull();
    expect(parseWhatsNewJson('nope')).toBeNull();
  });
});
describe('after-reload card', () => {
  it('first ever launch records the version without a card', () => { expect(whatsNewOnLaunch(null, '0.2.3', L)).toEqual({ show: [], store: '0.2.3' }); });
  it('same or older version: nothing', () => { expect(whatsNewOnLaunch('0.2.3', '0.2.3', L)).toEqual({ show: [], store: null }); expect(whatsNewOnLaunch('0.2.4', '0.2.3', L).show).toEqual([]); });
  it('upgrade: highlights of every version since, and the new one is stored', () => {
    const r = whatsNewOnLaunch('0.2.2', '0.2.4', L); expect(r.show.map((e) => e.version)).toEqual(['0.2.4', '0.2.3']); expect(r.store).toBe('0.2.4');
  });
  it('dev builds never show it', () => { expect(whatsNewOnLaunch('0.2.1', 'dev', L)).toEqual({ show: [], store: null }); });
  it('bundled list is newest first', () => { expect(WHATS_NEW[0]!.version).toBe('0.2.7'); });
});
