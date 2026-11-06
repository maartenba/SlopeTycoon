/**
 * `npm run audio:census` (after `npm run build`): MEASURES which ambient / event sounds a busy winter resort really fires (owner report: "a faint beep / honk happens very often").
 * Real page in Chrome (https), 128 / seed 5, the large demo resort (lifts, village, road + cars, train + level crossing, cannons), speed 3, with the audio debug log on
 * (`__slope.audio.log`, src/audio/audioLog.ts): every one-shot and loop start with id, source (sample | synth), gain and time. Two camera phases: default view and zoomed in over the village.
 * Prints a per-id table: count, per REAL minute and per IN-GAME hour (one game hour = 6.25 s at speed 1). It inspects the engine; it CANNOT HEAR anything.
 * Env: CENSUS_SEC (seconds per phase, default 90), CENSUS_SPEED (default 3), CENSUS_SEED, CENSUS_START (winter | summer).
 */
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer as createHttps } from 'node:https';
import { execFileSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import puppeteer from 'puppeteer-core';
import { createPagesServer } from './lib/static-server';
import { CHROME_ARGS } from './lib/harness';
import { TICKS_PER_SECOND } from '../src/config/balance';

const dist = join(process.cwd(), 'dist');
if (!existsSync(join(dist, 'index.html'))) { console.error('dist/ missing: run `npm run build` first'); process.exit(1); }
const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((c) => existsSync(c));
if (!exe) { console.error('No Chrome found'); process.exit(1); }
const tmp = mkdtempSync(join(tmpdir(), 'slope-census-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(tmp, 'k.pem'), '-out', join(tmp, 'c.pem'), '-days', '1', '-subj', '/CN=slope.test', '-addext', 'subjectAltName=DNS:slope.test'], { stdio: 'ignore' });
const handler = createPagesServer(dist, '/').listeners('request')[0] as (a: unknown, b: unknown) => void;
const server = createHttps({ key: readFileSync(join(tmp, 'k.pem')), cert: readFileSync(join(tmp, 'c.pem')) }, handler);
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const origin = `https://slope.test:${(server.address() as AddressInfo).port}`;
const SEC = Number(process.env.CENSUS_SEC ?? 90), SPEED = Number(process.env.CENSUS_SPEED ?? 3), SEED = process.env.CENSUS_SEED ?? '5', START = process.env.CENSUS_START ?? 'winter';
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: exe, headless: true, defaultViewport: { width: 1280, height: 800 }, args: [...CHROME_ARGS, '--host-resolver-rules=MAP slope.test 127.0.0.1', '--ignore-certificate-errors'], protocolTimeout: 600000 });
type Row = { id: string; source: string; n: number; perMin: number };
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 200)));
  await page.goto(`${origin}/?size=128&seed=${SEED}&start=${START}&hints=0`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction('!!window.__audio && !!window.__slope && !!window.__slope.audio', { timeout: 180000 });
  await page.mouse.click(640, 400);
  await page.waitForFunction("window.__audio.engine.state === 'running'", { timeout: 60000 });
  const rep = await page.evaluate("(() => { const r = window.__slope.populateDemo('large'); return { placed: r.placed, lifts: r.lifts.length, failures: r.failures }; })()") as { placed: Record<string, number>; lifts: number; failures: string[] };
  console.log('demo resort:', JSON.stringify(rep));
  console.log('level crossings:', await page.evaluate("window.__slope.sim.crossings.list().length"), '(the bell only rings while a barrier is down)');
  await page.evaluate("window.__slope.loop.setSpeed(0)");
  const phases: Array<{ name: string; js: string }> = [
    { name: 'default view (camera untouched)', js: "1" },
    { name: 'zoomed in on a running lift', js: "(() => { const s = window.__slope, c = s.renderer.controls, l = s.sim.lifts.all().find((l) => l.open) ?? s.sim.lifts.all()[0]; c.focusOn((l.bottom.x + l.top.x) / 2, (l.bottom.y + l.top.y) / 2, { zoom: 14, duration: 0 }); return 1; })()" },
    { name: 'zoomed in on the village', js: "(() => { const s = window.__slope, c = s.renderer.controls, b = s.buildings.all().find((b) => b.type === 'chalet') ?? s.buildings.all()[0]; c.focusOn(b.x + b.w / 2, b.y + b.h / 2, { zoom: 14, duration: 0 }); return 1; })()" },
  ];
  for (const ph of phases) {
    await page.evaluate(ph.js);
    await page.evaluate("window.__slope.setHour(10)");
    await page.evaluate("window.__slope.audio.log('all'); window.__slope.loop.setSpeed(" + SPEED + ")");
    const t0 = await page.evaluate("window.__slope.loop.tickCount") as number;
    const w0 = Date.now();
    await sleep(SEC * 1000);
    const ticks = (await page.evaluate("window.__slope.loop.tickCount") as number) - t0, real = (Date.now() - w0) / 1000;
    const rows = await page.evaluate("window.__slope.audio.counts()") as Row[];
    await page.evaluate("window.__slope.loop.setSpeed(0)");
    // 150 s per game day at 1x = 24 game hours -> 6.25 s per hour at 1x; the tick rate is read from the loop (ticks per real second at 1x)
    const tickRate = TICKS_PER_SECOND;
    const gameHours = tickRate ? ticks / tickRate / 6.25 : NaN;
    console.log(`\n== ${ph.name}: ${real.toFixed(0)} s real, ${ticks} ticks${tickRate ? `, ${gameHours.toFixed(1)} game hours` : ''} (speed ${SPEED})`);
    console.log('id'.padEnd(18), 'source'.padEnd(7), 'count'.padStart(6), 'per real min'.padStart(13), 'per game hour'.padStart(14));
    for (const r of rows) console.log(r.id.padEnd(18), r.source.padEnd(7), String(r.n).padStart(6), (r.n / (real / 60)).toFixed(1).padStart(13), (gameHours ? (r.n / gameHours).toFixed(2) : 'n/a').padStart(14));
  }
} finally { await browser.close(); server.close(); }
