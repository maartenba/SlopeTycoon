/**
 * Analytics consent (pure; docs/analytics.md). One localStorage key shared with the website (same origin on GitHub Pages):
 * `slope.consent.analytics` = 'granted' | 'denied' | absent. Nothing is loaded or sent until it is 'granted'.
 */
export const CONSENT_KEY = 'slope.consent.analytics';
export type Consent = 'granted' | 'denied' | null;
export interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem?(k: string): void }

export const parseConsent = (raw: unknown): Consent => (raw === 'granted' || raw === 'denied' ? raw : null);

export function readConsent(st: StorageLike | null | undefined): Consent {
  try { return parseConsent(st?.getItem(CONSENT_KEY)); } catch { return null; }
}
/** Returns false when the choice could not be persisted (private mode): the caller keeps it in memory for the session. */
export function writeConsent(st: StorageLike | null | undefined, v: 'granted' | 'denied'): boolean {
  try { if (!st) return false; st.setItem(CONSENT_KEY, v); return true; } catch { return false; }
}

export interface EnvProbe { prod: boolean; hostname: string; search: string; userAgent: string; webdriver?: boolean }
const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|::1|0\.0\.0\.0)$|\.local(host)?$/i;
/**
 * The environment gate: analytics only runs in a production build on a real (non-local) host, never for `?analytics=0`, never under a
 * headless / automated browser, so the owner's numbers are not polluted by agents, tests or dev sessions.
 */
export function analyticsAllowed(p: EnvProbe): boolean {
  if (!p.prod) return false;
  if (!p.hostname || LOCAL_HOST.test(p.hostname)) return false;
  if (/(^|[?&])analytics=0(&|$)/.test(p.search)) return false;
  if (/HeadlessChrome|Puppeteer|Playwright|PhantomJS/i.test(p.userAgent)) return false;
  return true;
}
