import { Analytics, type AnalyticsEnv } from './Analytics';
import { analyticsAllowed } from './consent';
import { APP_VERSION } from '../ui/version';


function realEnv(): AnalyticsEnv {
  const hasWin = typeof window !== 'undefined' && typeof document !== 'undefined';
  let st: Storage | null = null;
  try { st = hasWin ? window.localStorage : null; } catch { st = null; }
  const enabled = hasWin && analyticsAllowed({
    prod: import.meta.env.PROD, hostname: location.hostname, search: location.search, userAgent: navigator.userAgent, webdriver: (navigator as { webdriver?: boolean }).webdriver,
  });
  return {
    enabled, storage: st,
    win: (hasWin ? window : {}) as unknown as Record<string, unknown>,
    createScript: () => document.createElement('script') as unknown as ReturnType<AnalyticsEnv['createScript']>,
    appendScript: (s) => { document.head.appendChild(s as unknown as Node); },
    online: () => (typeof navigator === 'undefined' ? false : navigator.onLine !== false),
    onOnline: (cb) => { window.addEventListener('online', cb); },
    now: () => Date.now(),
    clearCookies: () => { for (const c of document.cookie.split(';')) { const n = c.split('=')[0]!.trim(); if (n === '_ga' || n.startsWith('_ga_')) document.cookie = `${n}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`; } },
  };
}

let single: Analytics | null = null;
/** The page's analytics instance (created lazily; constructing it has no side effects). */
export function analytics(): Analytics { return (single ??= new Analytics(realEnv())); }
export const analyticsVersion = APP_VERSION;
