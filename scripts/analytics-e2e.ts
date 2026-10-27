/** `npm run analytics:e2e` (after `npm run build`): serves dist/ on the fake host `slope.test` (not localhost, so the environment gate is open) and checks, with request interception
 * (Google hosts are NEVER really contacted: allowed requests get a stub script), that: no consent / denied / headless / ?analytics=0 => zero Google requests;
 * allow => the gtag script is requested and events are queued; Google blocked or the whole network offline => the game still boots and plays. Exit code 1 on any failure. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createServer as createHttps } from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { createPagesServer } from './lib/static-server';
import { CHROME_ARGS } from './lib/harness';

const dist = join(process.cwd(), 'dist');
if (!existsSync(join(dist, 'sw.js'))) { console.error('dist/ missing: run `npm run build` first'); process.exit(1); }
const CHROMES = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
const exe = CHROMES.find((c) => existsSync(c));
if (!exe) { console.error('No Chrome found'); process.exit(1); }

// https with a throw-away self-signed cert (service workers need a secure origin; the host is not localhost so the analytics gate is open)
const tmp = mkdtempSync(join(tmpdir(), 'slope-an-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(tmp, 'k.pem'), '-out', join(tmp, 'c.pem'), '-days', '1', '-subj', '/CN=slope.test', '-addext', 'subjectAltName=DNS:slope.test'], { stdio: 'ignore' });
const handler = createPagesServer(dist, '/').listeners('request')[0] as (a: unknown, b: unknown) => void;
const server = createHttps({ key: readFileSync(join(tmp, 'k.pem')), cert: readFileSync(join(tmp, 'c.pem')) }, handler);
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const port = (server.address() as AddressInfo).port;
const origin = `https://slope.test:${port}`;
const GOOGLE = /(^|\.)(googletagmanager\.com|google-analytics\.com|analytics\.google\.com|doubleclick\.net)$/;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const browser: Browser = await puppeteer.launch({
  executablePath: exe, headless: true, defaultViewport: { width: 1280, height: 800 },
  args: [...CHROME_ARGS, `--host-resolver-rules=MAP slope.test 127.0.0.1`, '--ignore-certificate-errors'],
});
const problems: string[] = [];
const ok = (c: boolean, m: string): void => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) problems.push(m); };

interface Run { page: Page; google: string[]; errors: string[] }
async function open(path: string, o: { consent?: 'granted' | 'denied'; google: 'stub' | 'abort'; ua?: string | null; page?: Page }): Promise<Run> {
  const page = o.page ?? await browser.newPage();
  if (o.ua !== null) await page.setUserAgent(o.ua ?? UA);
  const google: string[] = [], errors: string[] = [];
  if (!o.page) {
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      let host = ''; try { host = new URL(req.url()).hostname; } catch { /* ignore */ }
      if (GOOGLE.test(host)) { google.push(req.url()); if (o.google === 'stub') void req.respond({ status: 200, contentType: 'text/javascript', body: 'window.__gtagStub=1;' }); else void req.abort('blockedbyclient'); } else void req.continue();
    });
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(`pageerror ${String(e)}`));
    if (o.consent) await page.evaluateOnNewDocument((v: string) => { try { if (!sessionStorage.getItem('__seeded')) { localStorage.setItem('slope.consent.analytics', v); sessionStorage.setItem('__seeded', '1'); } } catch { /* ignore */ } }, o.consent);
  }
  await page.goto(`${origin}${path}`, { waitUntil: 'load', timeout: 90000 });
  await new Promise((r) => setTimeout(r, 1500));
  return { page, google, errors };
}
const dl = (page: Page): Promise<string[]> => page.evaluate(() => ((window as unknown as { dataLayer?: ArrayLike<unknown>[] }).dataLayer ?? []).map((x) => JSON.stringify(Array.from(x))));
const gameOk = async (page: Page): Promise<boolean> => { try { await page.waitForFunction(() => !!(window as unknown as { __slope?: unknown }).__slope, { timeout: 60000 }); return true; } catch { return false; } };

try {
  // 1. no consent: zero requests, card shown
  let r = await open('/?menu=1&nodemo=1', { google: 'stub' });
  ok(r.google.length === 0, `no consent: 0 Google requests (${r.google.length})`);
  ok(await r.page.evaluate(() => (document.querySelector('st-main-menu') as unknown as { consentVisible: boolean }).consentVisible), 'no consent: consent card visible on the title screen');
  ok((await dl(r.page)).length === 0, 'no consent: no dataLayer at all');
  // 1b. Allow click -> script requested + app_start queued, without a reload
  await r.page.evaluate(() => { const m = document.querySelector('st-main-menu') as unknown as { root: ShadowRoot }; (m.root.querySelector('button[data-action="consent-allow"]') as HTMLButtonElement).click(); });
  await new Promise((res) => setTimeout(res, 1500));
  ok(r.google.some((u) => u.startsWith('https://www.googletagmanager.com/gtag/js?id=G-NX37ERE0S9')), `Allow: gtag script requested (${r.google.join(', ')})`);
  const layer = await dl(r.page);
  ok(layer.some((x) => x.includes('"consent","default"')) && layer.some((x) => x.includes('"config","G-NX37ERE0S9"')) && layer.some((x) => x.includes('"event","app_start"')), `Allow: consent mode + config + app_start queued (${layer.length} entries)`);
  ok(await r.page.evaluate(() => localStorage.getItem('slope.consent.analytics')) === 'granted', 'Allow: shared consent key = granted');
  await r.page.close();
  // 2. denied: zero requests on menu and game page
  r = await open('/?menu=1&nodemo=1', { consent: 'denied', google: 'stub' });
  ok(r.google.length === 0, 'denied (title): 0 Google requests');
  ok(!(await r.page.evaluate(() => (document.querySelector('st-main-menu') as unknown as { consentVisible: boolean }).consentVisible)), 'denied: card not shown again');
  await open('/?size=64&seed=3&start=winter&hints=0', { google: 'stub', page: r.page });
  ok(await gameOk(r.page), 'denied (game): boots'); ok(r.google.length === 0, `denied (game): 0 Google requests (${r.google.length})`);
  await r.page.close();
  // 3. headless UA + granted: still zero
  r = await open('/?size=64&seed=3&start=winter&hints=0', { consent: 'granted', google: 'stub', ua: null });
  ok(await gameOk(r.page), 'headless UA (granted): game boots'); ok(r.google.length === 0, `headless UA (granted): 0 Google requests (${r.google.length})`);
  await r.page.close();
  // 4. ?analytics=0
  r = await open('/?size=64&seed=3&start=winter&hints=0&analytics=0', { consent: 'granted', google: 'stub' });
  ok(r.google.length === 0, '?analytics=0 (granted): 0 Google requests'); await r.page.close();
  // 5. granted, game page: script requested, game events queued
  r = await open('/?size=64&seed=3&start=winter&hints=0', { consent: 'granted', google: 'stub' });
  ok(await gameOk(r.page), 'granted (game): boots');
  ok(r.google.length === 1 && r.google[0]!.startsWith('https://www.googletagmanager.com/gtag/js'), `granted (game): exactly one gtag script request (${r.google.length})`);
  const l5 = await dl(r.page);
  ok(l5.some((x) => x.includes('"event","game_start"')) && l5.some((x) => x.includes('"event","app_start"')), 'granted (game): app_start + game_start queued');
  ok(!l5.some((x) => /seed|name|money/i.test(x.replace(/"config"[^\]]*\]/, ''))), 'granted (game): no seed / name / money in any event');
  await r.page.close();
  // 6. granted but Google blocked (e.g. ad-blocker / captive network): game still boots and plays, no page errors
  r = await open('/?size=64&seed=3&start=winter&hints=0', { consent: 'granted', google: 'abort' });
  ok(await gameOk(r.page), 'granted + Google blocked: game boots');
  const ticks = await r.page.evaluate(() => { const s = (window as unknown as { __slope: { loop: { tickCount: number; advance(n: number): void } } }).__slope; const a = s.loop.tickCount; s.loop.advance(120); return [a, s.loop.tickCount]; });
  ok(ticks[1]! > ticks[0]!, `granted + Google blocked: the simulation advances (${ticks.join(' -> ')})`);
  const pe = r.errors.filter((e) => e.startsWith('pageerror'));
  ok(pe.length === 0, `granted + Google blocked: no page errors (${pe.join('|')})`);
  console.log(`  console errors with Google blocked: ${JSON.stringify(r.errors)}`);
  await r.page.close();
  // 7. service worker + real offline: first visit installs the SW, then the whole network is off
  r = await open('/?size=64&seed=3&start=winter&hints=0', { consent: 'granted', google: 'stub' });
  const swState = await r.page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'no serviceWorker API (insecure origin?)';
    const t = Date.now();
    while (Date.now() - t < 20000) { const reg = await navigator.serviceWorker.getRegistration(); if (reg?.active) { await new Promise((x) => setTimeout(x, 1500)); return 'active'; } await new Promise((x) => setTimeout(x, 300)); }
    return 'not active';
  });
  ok(swState === 'active', `service worker active on the fake host (${swState})`);
  const before = r.google.length;
  server.closeAllConnections(); await new Promise<void>((res) => server.close(() => res())); // the origin is really gone: only the SW cache can answer
  await r.page.setOfflineMode(true);
  await r.page.goto(`${origin}/?size=64&seed=3&start=winter&hints=0`, { waitUntil: 'load', timeout: 90000 }).catch((e: unknown) => { problems.push(`offline reload failed: ${String(e)}`); });
  ok(await r.page.evaluate(() => navigator.onLine === false), 'navigator.onLine is false');
  ok(await gameOk(r.page), 'granted + fully offline (SW cache): game boots');
  ok(r.google.length === before, `granted + offline: no Google request attempted (${r.google.length - before} new)`);
  const pe7 = r.errors.filter((e) => e.startsWith('pageerror'));
  ok(pe7.length === 0, `offline: no page errors (${pe7.join('|')})`);
  console.log(`  console errors while offline: ${JSON.stringify(r.errors)}`);
  await r.page.close();
} finally { await browser.close(); if (server.listening) server.close(); }
if (problems.length) { console.error(`\n${problems.length} problem(s)`); process.exit(1); }
console.log('\nanalytics e2e OK');
