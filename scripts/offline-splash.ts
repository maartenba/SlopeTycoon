/** `npm run offline:splash` (after `npm run build`): first visit installs the service worker, then the network goes OFFLINE (CDP emulation) and the page reloads.
 * Records every splash stage (text + progress bar) with a MutationObserver, screenshots the splash while it is up and asserts that the game boots offline without
 * page errors or failed requests. Writes .weave/shots/offline-splash-*.png. Exit code 1 on failure. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer as createHttps } from 'node:https';
import { execFileSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import puppeteer from 'puppeteer-core';
import { createPagesServer } from './lib/static-server';
import { CHROME_ARGS } from './lib/harness';

const dist = join(process.cwd(), 'dist');
if (!existsSync(join(dist, 'sw.js'))) { console.error('dist/ missing: run `npm run build` first'); process.exit(1); }
const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((c) => existsSync(c));
if (!exe) { console.error('No Chrome found'); process.exit(1); }
const tmp = mkdtempSync(join(tmpdir(), 'slope-off-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(tmp, 'k.pem'), '-out', join(tmp, 'c.pem'), '-days', '1', '-subj', '/CN=slope.test', '-addext', 'subjectAltName=DNS:slope.test'], { stdio: 'ignore' });
const handler = createPagesServer(dist, '/').listeners('request')[0] as (a: unknown, b: unknown) => void;
const server = createHttps({ key: readFileSync(join(tmp, 'k.pem')), cert: readFileSync(join(tmp, 'c.pem')) }, handler);
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const origin = `https://slope.test:${(server.address() as AddressInfo).port}`;
mkdirSync('.weave/shots', { recursive: true });
const browser = await puppeteer.launch({ executablePath: exe, headless: true, defaultViewport: { width: 1280, height: 800 }, args: [...CHROME_ARGS, '--host-resolver-rules=MAP slope.test 127.0.0.1', '--ignore-certificate-errors'] });
const problems: string[] = [];
const ok = (c: boolean, m: string): void => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) problems.push(m); };
try {
  const page = await browser.newPage();
  // the analytics gate must stay closed: no consent is ever stored, so nothing external is requested either way
  const errors: string[] = [], failed: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('requestfailed', (r) => failed.push(r.url()));
  const url = `${origin}/?size=64&seed=3&start=winter&hints=0`;
  await page.goto(url, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => !!(window as unknown as { __slope?: unknown }).__slope, { timeout: 90000 });
  const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return r.active?.state ?? 'none'; });
  ok(sw === 'activated' || sw === 'activating', `online first load: service worker active (${sw})`);
  await new Promise((r) => setTimeout(r, 2500)); // let the SW finish precaching
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  ok(await page.evaluate(() => !navigator.onLine), 'network emulation: navigator.onLine is false');
  await page.evaluateOnNewDocument(() => {
    const w = window as unknown as { __splashLog: string[] };
    w.__splashLog = [];
    const snap = (): void => {
      const t = document.getElementById('splash-text')?.textContent ?? '', b = document.getElementById('splash-bar')?.getAttribute('aria-valuenow') ?? '';
      const s = `${b}|${t}`;
      if (w.__splashLog[w.__splashLog.length - 1] !== s) w.__splashLog.push(s);
    };
    new MutationObserver(snap).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    setInterval(snap, 50);
  });
  failed.length = 0; errors.length = 0;
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: '.weave/shots/offline-splash-early.png' });
  let booted = true;
  try { await page.waitForFunction(() => !!(window as unknown as { __slope?: unknown }).__slope, { timeout: 90000 }); } catch { booted = false; }
  ok(booted, 'offline reload: the game boots (__slope present)');
  await new Promise((r) => setTimeout(r, 1500));
  const log = await page.evaluate(() => (window as unknown as { __splashLog: string[] }).__splashLog);
  console.log('  splash stages (bar|text):', JSON.stringify(log));
  ok(log.some((s) => /\S/.test(s.split('|')[1] ?? '')), 'splash showed stage text while offline');
  ok(await page.evaluate(() => { const s = document.getElementById('splash'); return !s || s.hidden || getComputedStyle(s).display === 'none' || getComputedStyle(s).opacity === '0' || !s.isConnected; }), 'splash is gone once the world is up');
  await page.screenshot({ path: '.weave/shots/offline-splash-world.png' });
  ok(errors.length === 0, `no page errors (${errors.join('|')})`);
  ok(failed.length === 0, `no failed requests while offline (${failed.slice(0, 3).join(', ')})`);
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
} finally { await browser.close(); server.close(); }
if (problems.length) { console.error(`offline splash FAILED: ${problems.length}`); process.exit(1); }
console.log('offline splash OK');
