import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const load = (): unknown => { const m = { exports: {} as unknown }; new Function('module', `${readFileSync('site/assets/consent.js', 'utf8')}`)(m); return m.exports; };
const C = load() as {
  KEY: string; ID: string;
  readConsent: (s: { getItem: (k: string) => string | null }) => 'granted' | 'denied' | null;
  writeConsent: (s: { setItem: (k: string, v: string) => void }, v: string) => boolean;
  envAllowsAnalytics: (host: string, ua: string, webdriver?: boolean) => boolean;
  decide: (s: { stored: 'granted' | 'denied' | null; host: string; ua: string; webdriver?: boolean; reopened?: boolean }) => { showBar: boolean; load: boolean };
  gtagPlan: (id?: string) => unknown[][];
};
const mem = (init: Record<string, string> = {}) => { const m = { ...init }; return { getItem: (k: string) => m[k] ?? null, setItem: (k: string, v: string) => { m[k] = v; }, m }; };
const REAL = { host: 'slopetycoon.com', ua: 'Mozilla/5.0 (Macintosh) Chrome/130 Safari/537.36', webdriver: false };

describe('site consent logic', () => {
  it('uses the shared key and the owner measurement id', () => { expect(C.KEY).toBe('slope.consent.analytics'); expect(C.ID).toBe('G-NX37ERE0S9'); });
  it('reads only granted / denied, everything else is "absent"', () => {
    expect(C.readConsent(mem())).toBeNull(); expect(C.readConsent(mem({ [C.KEY]: 'granted' }))).toBe('granted'); expect(C.readConsent(mem({ [C.KEY]: 'denied' }))).toBe('denied');
    expect(C.readConsent(mem({ [C.KEY]: 'maybe' }))).toBeNull(); expect(C.readConsent({ getItem: () => { throw new Error('blocked'); } })).toBeNull();
  });
  it('writes valid values only and survives blocked storage', () => {
    const s = mem(); expect(C.writeConsent(s, 'granted')).toBe(true); expect(s.m[C.KEY]).toBe('granted'); expect(C.writeConsent(s, 'yes')).toBe(false); expect(s.m[C.KEY]).toBe('granted');
    expect(C.writeConsent({ setItem: () => { throw new Error('blocked'); } }, 'denied')).toBe(false);
  });
  it('shows the bar only without a stored choice (or when reopened) and loads gtag only when granted', () => {
    expect(C.decide({ stored: null, ...REAL })).toEqual({ showBar: true, load: false });
    expect(C.decide({ stored: 'denied', ...REAL })).toEqual({ showBar: false, load: false });
    expect(C.decide({ stored: 'granted', ...REAL })).toEqual({ showBar: false, load: true });
    expect(C.decide({ stored: 'granted', reopened: true, ...REAL })).toEqual({ showBar: true, load: true });
  });
  it('never loads analytics on localhost, private hosts, webdriver or headless browsers', () => {
    for (const host of ['localhost', '127.0.0.1', '192.168.1.5', 'dev.local', '[::1]']) expect(C.decide({ stored: 'granted', ...REAL, host }).load, host).toBe(false);
    expect(C.decide({ stored: 'granted', ...REAL, webdriver: true }).load).toBe(false);
    expect(C.decide({ stored: 'granted', ...REAL, ua: 'Mozilla/5.0 HeadlessChrome/130.0' }).load).toBe(false);
    expect(C.envAllowsAnalytics('slopetycoon.com', 'Mozilla/5.0 Firefox/130', false)).toBe(true);
  });
  it('follows Consent Mode v2: default denied, update granted, page view only in config, no signals / ad personalisation', () => {
    const plan = C.gtagPlan();
    expect(plan[0]).toEqual(['consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' }]);
    expect(plan[1]).toEqual(['consent', 'update', { analytics_storage: 'granted' }]);
    expect(plan[2]![0]).toBe('js');
    expect(plan[3]).toEqual(['config', 'G-NX37ERE0S9', { send_page_view: true, allow_google_signals: false, allow_ad_personalization_signals: false }]);
  });
});
