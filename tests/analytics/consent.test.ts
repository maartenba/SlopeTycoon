import { describe, expect, it } from 'vitest';
import { CONSENT_KEY, analyticsAllowed, parseConsent, readConsent, writeConsent } from '../../src/analytics/consent';

const mem = (init: Record<string, string> = {}) => { const m = new Map(Object.entries(init)); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };

describe('analytics consent (pure)', () => {
  it('shares the website key and only accepts granted / denied', () => {
    expect(CONSENT_KEY).toBe('slope.consent.analytics');
    expect(parseConsent('granted')).toBe('granted'); expect(parseConsent('denied')).toBe('denied');
    for (const bad of [null, undefined, '', 'true', 'GRANTED', 1, {}]) expect(parseConsent(bad)).toBeNull();
  });
  it('read / write round trip; absent = null; broken storage never throws', () => {
    const s = mem();
    expect(readConsent(s)).toBeNull();
    expect(writeConsent(s, 'granted')).toBe(true); expect(readConsent(s)).toBe('granted');
    writeConsent(s, 'denied'); expect(readConsent(s)).toBe('denied');
    const broken = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(readConsent(broken)).toBeNull(); expect(writeConsent(broken, 'granted')).toBe(false);
    expect(readConsent(null)).toBeNull(); expect(writeConsent(null, 'granted')).toBe(false);
  });
  const ok = { prod: true, hostname: 'slopetycoon.com', search: '', userAgent: 'Mozilla/5.0 Chrome/120' };
  it('environment gate: production on a real host only', () => {
    expect(analyticsAllowed(ok)).toBe(true);
    expect(analyticsAllowed({ ...ok, prod: false })).toBe(false); // dev / tests
    for (const h of ['localhost', '127.0.0.1', '[::1]', 'box.local', '']) expect(analyticsAllowed({ ...ok, hostname: h }), h).toBe(false);
    expect(analyticsAllowed({ ...ok, search: '?analytics=0' })).toBe(false);
    expect(analyticsAllowed({ ...ok, search: '?seed=1&analytics=0' })).toBe(false);
    expect(analyticsAllowed({ ...ok, userAgent: 'Mozilla/5.0 HeadlessChrome/120' })).toBe(false);
  });
});
