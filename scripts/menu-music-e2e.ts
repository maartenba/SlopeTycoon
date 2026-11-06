/** `npm run menu-music:e2e` (after `npm run build`): real-page check of the title-screen music. Loads the title screen over https, waits for NO audio request before a gesture, clicks, then checks both mp3 files (200, audio/mpeg, via the service worker cache offline), no console / page errors, the engine runs, the music plays, and leave() fades it out. Cannot hear anything: it inspects the audio graph state only. Exit 1 on failure. */
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
const tmp = mkdtempSync(join(tmpdir(), "slope-mm-"));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(tmp, 'k.pem'), '-out', join(tmp, 'c.pem'), '-days', '1', '-subj', '/CN=slope.test', '-addext', 'subjectAltName=DNS:slope.test'], { stdio: 'ignore' });
const handler = createPagesServer(dist, '/').listeners('request')[0] as (a: unknown, b: unknown) => void;
const server = createHttps({ key: readFileSync(join(tmp, 'k.pem')), cert: readFileSync(join(tmp, 'c.pem')) }, handler);
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const origin = `https://slope.test:${(server.address() as AddressInfo).port}`;
mkdirSync('.weave/shots', { recursive: true });

const browser = await puppeteer.launch({ executablePath: exe, headless: true, defaultViewport: { width: 1280, height: 800 }, args: [...CHROME_ARGS, '--host-resolver-rules=MAP slope.test 127.0.0.1', '--ignore-certificate-errors'], protocolTimeout: 300000 });
const problems: string[] = [];
const ok = (c: boolean, m: string): void => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) problems.push(m); };
const A = 'window.__menuAudio';
try {
  const page = await browser.newPage();
  const errors: string[] = [], reqs: Array<{ url: string; status: number; type: string; fromSw: boolean }> = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (process.env.MM_DEBUG) console.log('console:', m.type(), m.text().slice(0, 200)); if (m.type() === 'error' && !/GPU stall|GL Driver Message/.test(m.text())) errors.push(m.text()); });
  page.on('response', (r) => { if (r.url().endsWith('.mp3') && !r.url().includes('/audio/sfx/')) reqs.push({ url: r.url(), status: r.status(), type: r.headers()['content-type'] ?? '', fromSw: r.fromServiceWorker() }); });
  // FIRST VISIT, title screen only (no game page before): the title registers the service worker itself (docs/pwa.md), so the menu music is cached from the first visit.
  await page.goto(`${origin}/`, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(`navigator.serviceWorker.getRegistration().then((r) => !!r && !!r.active && r.active.state === 'activated' && !!navigator.serviceWorker.controller)`, { timeout: 120000 });
  ok(true, 'first title visit: service worker registered, active and controlling the title page');
  await new Promise((r) => setTimeout(r, 3000)); // let it finish precaching
  reqs.length = 0;
  await page.waitForFunction(() => !!(window as unknown as { __menuAudio?: unknown }).__menuAudio, { timeout: 90000 });
  await new Promise((r) => setTimeout(r, 1500));
  ok(reqs.length === 0, 'no mp3 requested before the first gesture');
  ok((await page.evaluate(`${A}.engine.state === 'locked'`)) === true, 'engine locked before a gesture');
  await page.mouse.click(640, 400);
  await page.waitForFunction(`${A}.music.playing`, { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1500));
  const s1 = await page.evaluate(`({ eng: ${A}.engine.state, ...${A}.music.stats, track: ${A}.music.currentTrack })`) as { eng: string; started: number; loaded: number; errors: number };
  ok(s1.eng === 'running', `engine running (${s1.eng})`);
  ok(s1.started === 1 && s1.errors === 0, `music started, no load errors (${JSON.stringify(s1)})`);
  ok(reqs.length === 2 && reqs.every((r) => r.status === 200 && /^audio\/mpeg/.test(r.type)), `both files fetched (the second preloaded): ${JSON.stringify(reqs.map((r) => [r.url.split('/').pop(), r.status, r.type]))}`);
  ok(errors.length === 0, `no console / page errors (${errors.slice(0, 3).join(' | ')})`);
  const cached = await page.evaluate(async () => (await (await caches.open((await caches.keys())[0]!)).keys()).map((r) => r.url).filter((u) => u.endsWith('.mp3')).length);
  ok(cached === 2, `both mp3 runtime-cached by the service worker (${cached})`);
  // game start: the fade-out
  const t0 = Date.now();
  const left = await page.evaluate(`new Promise((res) => { const m = ${A}; m.leave(() => res({ playing: m.music.playing })); })`) as { playing: boolean };
  ok(!left.playing, `music stopped when the game starts (leave() waited about ${Date.now() - t0} ms)`);
  // offline: reload, gesture, music plays from the cache
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  reqs.length = 0; errors.length = 0;
  await page.reload({ waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => !!(window as unknown as { __menuAudio?: unknown }).__menuAudio, { timeout: 90000 });
  await page.mouse.click(640, 400);
  await page.waitForFunction(`${A}.music.playing`, { timeout: 30000 });
  ok(reqs.length >= 1 && reqs.every((r) => r.status === 200 && r.fromSw), `offline: music files served by the service worker (${reqs.length})`);
  ok(errors.length === 0, `offline: no errors (${errors.slice(0, 3).join(' | ')})`);
  mkdirSync('.weave/shots', { recursive: true });
  await page.screenshot({ path: '.weave/shots/menu-music-title.png' });
} catch (e) { ok(false, `exception: ${String(e)}`); try { const pg = (await browser.pages())[1]!; console.log(await pg.evaluate(`JSON.stringify({ a: !!window.__menuAudio, st: window.__menuAudio && window.__menuAudio.engine.state, ms: window.__menuAudio && window.__menuAudio.music.stats })`)); } catch { /* ignore */ } }
finally { await browser.close(); server.close(); }
if (problems.length) { console.error('menu music e2e FAILED'); process.exit(1); }
console.log('menu music e2e OK');
