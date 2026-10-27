import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANALYTICS_HOSTS } from '../../src/analytics/Analytics';

/** Owner decision: Google Analytics is allowed in the GAME, but only through src/analytics, consent first, never in the service worker / precache. */
const walk = (d: string, out: string[] = []): string[] => {
  for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|css|html|json)$/.test(f)) out.push(p); }
  return out;
};
const HOST = /googletagmanager\.com|google-analytics\.com|analytics\.google\.com|doubleclick\.net|gtag\(|dataLayer/;
const strip = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('analytics containment', () => {
  it('only the analytics host list is allowed and it is exactly the Google ones', () => {
    expect([...ANALYTICS_HOSTS]).toEqual(['googletagmanager.com', 'google-analytics.com', 'analytics.google.com']);
  });
  it('no source file outside src/analytics names an analytics host, gtag or dataLayer', () => {
    for (const f of [...walk('src'), ...walk('sw'), ...walk('vite-plugins'), 'index.html']) {
      if (f.startsWith(join('src', 'analytics'))) continue;
      expect(HOST.test(strip(readFileSync(f, 'utf8'))), f).toBe(false);
    }
  });
  it('the module loads Google only via the single script tag: no fetch / XHR / sendBeacon / WebSocket / external URL beyond the gtag script', () => {
    for (const f of walk(join('src', 'analytics'))) {
      const s = strip(readFileSync(f, 'utf8'));
      expect(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|new\s+Image\s*\(/.test(s), f).toBe(false);
      const urls = s.match(/https?:\/\/[^\s'"`)]+/g) ?? [];
      for (const u of urls) expect(u, f).toMatch(/^https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=/);
    }
  });
  it('the service worker never handles Google hosts (cross-origin is ignored) and no CSP blocks the script', () => {
    const core = readFileSync('sw/core.ts', 'utf8');
    expect(core).toContain("u.origin !== s.origin");
    expect(/Content-Security-Policy/i.test(readFileSync('index.html', 'utf8'))).toBe(false);
    if (existsSync('dist/sw.js')) expect(HOST.test(readFileSync('dist/sw.js', 'utf8'))).toBe(false);
  });
});
