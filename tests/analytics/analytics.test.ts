import { describe, expect, it, vi } from 'vitest';
import { Analytics, GA_ID, GA_SCRIPT_URL, RATE_MAX, SESSION_EVENT_CAP, type AnalyticsEnv, type ScriptLike } from '../../src/analytics/Analytics';
import { CONSENT_KEY } from '../../src/analytics/consent';

function mk(o: { enabled?: boolean; consent?: 'granted' | 'denied'; online?: boolean; storage?: boolean } = {}) {
  const store = new Map<string, string>(o.consent ? [[CONSENT_KEY, o.consent]] : []);
  const scripts: ScriptLike[] = [];
  const onlineCbs: Array<() => void> = [];
  let t = 0;
  const state = { online: o.online ?? true };
  const env: AnalyticsEnv = {
    enabled: o.enabled ?? true,
    storage: o.storage === false ? null : { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => { store.set(k, v); } },
    win: {},
    createScript: () => ({ src: '', async: false, onerror: null, onload: null }),
    appendScript: (s) => { scripts.push(s); },
    online: () => state.online,
    onOnline: (cb) => { onlineCbs.push(cb); },
    now: () => (t += 1),
    clearCookies: vi.fn(),
  };
  const a = new Analytics(env);
  const dl = (): unknown[][] => ((env.win.dataLayer ?? []) as ArrayLike<unknown>[]).map((x) => Array.from(x));
  return { a, env, scripts, store, state, dl, goOnline: () => { state.online = true; onlineCbs.forEach((f) => f()); } };
}

describe('Analytics: consent first, offline safe', () => {
  it('no consent (absent): nothing is loaded, queued or sent', () => {
    const m = mk(); m.a.init();
    expect(m.a.track('level_up', { level: 2 })).toBe(false);
    expect(m.scripts).toHaveLength(0); expect(m.env.win.dataLayer).toBeUndefined(); expect(m.env.win.gtag).toBeUndefined();
  });
  it('denied: nothing is loaded or sent', () => {
    const m = mk({ consent: 'denied' }); m.a.init();
    expect(m.a.track('level_up', { level: 2 })).toBe(false);
    expect(m.scripts).toHaveLength(0); expect(m.env.win.dataLayer).toBeUndefined();
  });
  it('environment gate closed (dev / headless / localhost): never loads even with consent granted', () => {
    const m = mk({ consent: 'granted', enabled: false }); m.a.init();
    expect(m.a.track('level_up', { level: 2 })).toBe(false);
    m.a.setConsent('granted');
    expect(m.scripts).toHaveLength(0); expect(m.env.win.dataLayer).toBeUndefined();
  });
  it('granted + online: injects exactly the one gtag script, consent mode v2 default denied -> update, no page view, no signals, events flushed through the queue', () => {
    const m = mk({ consent: 'granted' }); m.a.init();
    expect(m.scripts).toHaveLength(1); expect(m.scripts[0]!.src).toBe(GA_SCRIPT_URL); expect(m.scripts[0]!.async).toBe(true);
    expect(m.a.track('level_up', { level: 2 })).toBe(true); // before the script loaded: queued in dataLayer
    const dl = m.dl();
    expect(dl[0]).toEqual(['consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' }]);
    expect(dl[1]).toEqual(['consent', 'update', { analytics_storage: 'granted' }]);
    const cfg = dl.find((x) => x[0] === 'config')!;
    expect(cfg[1]).toBe(GA_ID); expect(cfg[2]).toMatchObject({ send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false, transport_type: 'beacon' });
    expect(dl.at(-1)).toEqual(['event', 'level_up', { level: 2 }]);
    m.scripts[0]!.onload?.(); expect(m.a.loadState).toBe('loaded');
    m.a.track('level_up', { level: 3 }); expect(m.scripts).toHaveLength(1); // never injected twice
  });
  it('offline at boot: no script, events dropped (no queue); loads once when back online', () => {
    const m = mk({ consent: 'granted', online: false }); m.a.init();
    expect(m.scripts).toHaveLength(0);
    expect(m.a.track('level_up', { level: 2 })).toBe(false);
    expect(m.env.win.dataLayer).toBeUndefined(); // nothing persisted / queued
    m.goOnline();
    expect(m.scripts).toHaveLength(1);
    expect(m.dl().some((x) => x[0] === 'event')).toBe(false); // the dropped event never comes back
  });
  it('offline coming back without consent never loads', () => {
    const m = mk({ online: false }); m.a.init(); m.goOnline();
    expect(m.scripts).toHaveLength(0);
  });
  it('going offline mid-session drops events', () => {
    const m = mk({ consent: 'granted' }); m.a.init(); m.scripts[0]!.onload?.();
    m.state.online = false;
    expect(m.a.track('level_up', { level: 2 })).toBe(false);
  });
  it('script failure is silent: no throw, bounded retries (2 attempts), then gives up', () => {
    const m = mk({ consent: 'granted' }); m.a.init();
    m.scripts[0]!.onerror?.(); expect(m.a.loadState).toBe('failed');
    expect(() => m.a.track('level_up', { level: 2 })).not.toThrow(); // second (last) attempt
    expect(m.scripts).toHaveLength(2);
    m.scripts[1]!.onerror?.();
    for (let i = 0; i < 20; i++) { m.goOnline(); m.a.track('level_up', { level: 2 }); }
    expect(m.scripts).toHaveLength(2);
  });
  it('a throwing environment never propagates', () => {
    const m = mk({ consent: 'granted' });
    m.env.appendScript = () => { throw new Error('csp'); };
    expect(() => { m.a.init(); m.a.track('level_up', { level: 1 }); m.a.setConsent('denied'); }).not.toThrow();
  });
  it('granting later (card / Settings) loads without a reload; revoking stops sending and sets the ga-disable flag', () => {
    const m = mk(); m.a.init();
    const seen: Array<string | null> = []; m.a.subscribe((c) => seen.push(c));
    m.a.setConsent('granted');
    expect(m.store.get(CONSENT_KEY)).toBe('granted'); expect(m.scripts).toHaveLength(1);
    expect(m.a.track('goal_done', { id: 'a' })).toBe(true);
    m.a.setConsent('denied');
    expect(m.env.win[`ga-disable-${GA_ID}`]).toBe(true);
    expect(m.a.track('goal_done', { id: 'b' })).toBe(false);
    expect(m.env.clearCookies).toHaveBeenCalled();
    expect(m.dl().filter((x) => x[0] === 'consent' && (x[2] as { analytics_storage?: string }).analytics_storage === 'denied').length).toBeGreaterThan(1);
    expect(seen).toEqual(['granted', 'denied']);
  });
  it('without storage the choice is kept for the session in memory', () => {
    const m = mk({ storage: false }); m.a.setConsent('granted');
    expect(m.a.consent()).toBe('granted'); expect(m.scripts).toHaveLength(1);
  });
  it('rejects non-whitelisted events and params', () => {
    const m = mk({ consent: 'granted' }); m.a.init();
    expect(m.a.track('purchase', { value: 5 })).toBe(false);
    m.a.track('goal_done', { id: 'ok', playerName: 'Ann' });
    expect(m.dl().at(-1)).toEqual(['event', 'goal_done', { id: 'ok' }]);
  });
  it('rate limit and caps: per-event cap, per-minute window, session total', () => {
    const m = mk({ consent: 'granted' }); m.a.init();
    for (let i = 0; i < 10; i++) m.a.track('error', { kind: 'error' });
    expect(m.dl().filter((x) => x[1] === 'error')).toHaveLength(5); // error cap 5
    const m2 = mk({ consent: 'granted' }); m2.a.init();
    let ok = 0; for (let i = 0; i < 100; i++) if (m2.a.track('goal_done', { id: `g${i}` })) ok++;
    expect(ok).toBeLessThanOrEqual(RATE_MAX);
    expect(SESSION_EVENT_CAP).toBe(200);
    const m3 = mk({ consent: 'granted' }); m3.a.init();
    let t = 0; (m3.env as { now(): number }).now = () => (t += 61_000);
    let n = 0; const names = ['goal_done', 'achievement', 'festival_booked', 'staff_upgrade', 'scenario_result'] as const;
    for (let i = 0; i < 1000; i++) if (m3.a.track(names[i % 5]!, { id: `a${i % 5}`, result: 'won' })) n++;
    expect(n).toBeLessThanOrEqual(SESSION_EVENT_CAP); expect(m3.a.sent).toBe(n);
  });
});
