/**
 * `npm run music:e2e` (after `npm run build`): real-page check of the in-game music (owner mp3 files) in Chrome over https. Checks: no mp3 requested before the first
 * gesture; the files are 200 `audio/mpeg`; no console / page errors; the engine runs and a game track really plays (media element advancing); a situation change (storm)
 * triggers a crossfade to the storm track; an open bar (forced proximity) hands off to a bar song, the game track pauses and later resumes where it stopped; Music off pauses.
 * It inspects the audio graph / element state: it CANNOT HEAR anything. The title music (fade-out on game start, offline cache) is checked by `npm run menu-music:e2e`. Exit 1 on failure.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer as createHttps } from 'node:https';
import { execFileSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import puppeteer from 'puppeteer-core';
import { createPagesServer } from './lib/static-server';
import { CHROME_ARGS } from './lib/harness';
import { requireFreshDist } from './lib/dist-guard';

const dist = join(process.cwd(), 'dist');
requireFreshDist();
const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((c) => existsSync(c));
if (!exe) { console.error('No Chrome found'); process.exit(1); }
const tmp = mkdtempSync(join(tmpdir(), 'slope-music-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(tmp, 'k.pem'), '-out', join(tmp, 'c.pem'), '-days', '1', '-subj', '/CN=slope.test', '-addext', 'subjectAltName=DNS:slope.test'], { stdio: 'ignore' });
const handler = createPagesServer(dist, '/').listeners('request')[0] as (a: unknown, b: unknown) => void;
const server = createHttps({ key: readFileSync(join(tmp, 'k.pem')), cert: readFileSync(join(tmp, 'c.pem')) }, handler);
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const origin = `https://slope.test:${(server.address() as AddressInfo).port}`;
mkdirSync('.weave/shots', { recursive: true });

const browser = await puppeteer.launch({ executablePath: exe, headless: true, defaultViewport: { width: 1280, height: 800 }, args: [...CHROME_ARGS, '--host-resolver-rules=MAP slope.test 127.0.0.1', '--ignore-certificate-errors'], protocolTimeout: 300000 });
const problems: string[] = [];
const ok = (c: boolean, m: string): void => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) problems.push(m); };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const A = 'window.__audio';
try {
  const page = await browser.newPage();
  const errors: string[] = [], reqs: Array<{ url: string; status: number; type: string }> = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (process.env.MM_DEBUG) console.log('console:', m.type(), m.text().slice(0, 200)); if (m.type() === 'error' && !/GPU stall|GL Driver Message/.test(m.text())) errors.push(m.text()); });
  page.on('response', (r) => { if (r.url().endsWith('.mp3') && !r.url().includes('/audio/sfx/')) reqs.push({ url: r.url(), status: r.status(), type: r.headers()['content-type'] ?? '' }); });
  await page.goto(`${origin}/?size=64&seed=3&start=winter&hints=0`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(`!!${A}`, { timeout: 120000 });
  await sleep(2500);
  ok(reqs.length === 0, 'no mp3 requested before the first gesture');
  ok((await page.evaluate(`${A}.engine.state`)) === 'locked', 'engine locked before a gesture');
  // force a known situation: winter, 08:00, clear (the 10 Hz sampler would overwrite setInputs, so wrap it)
  await page.evaluate(`(() => { const m = ${A}.music; window.__force = { season: 'winter', weather: 'clear', hour: 8, festival: false, busy: 0 }; const o = m.setInputs.bind(m); m.setInputs = (p) => o({ ...p, ...window.__force }); o(window.__force); })()`);
  await page.mouse.click(640, 400);
  await page.waitForFunction(`!!${A}.music.currentTrack`, { timeout: 60000 });
  await sleep(4000);
  const s1 = await page.evaluate(`(() => { const m = ${A}.music, c = m.player.cur; return { eng: ${A}.engine.state, track: m.currentTrack, sit: m.situation, playing: !!c && !c.el.paused && c.el.currentTime > 0.5, t: c ? c.el.currentTime : -1, started: m.stats.started, errors: m.player.stats.errors }; })()`) as { eng: string; track: string; sit: string; playing: boolean; t: number; started: number; errors: number };
  ok(s1.eng === 'running', `engine running (${s1.eng})`);
  ok(s1.sit === 'winter-morning' && /^winter-(mountain-morning|early-slopes)$/.test(s1.track), `winter morning track plays (${s1.sit}, ${s1.track})`);
  ok(s1.playing, `the media element is really advancing (${s1.t.toFixed(1)} s)`);
  ok(reqs.length >= 1 && reqs.every((r) => r.status === 200 && /^audio\/mpeg/.test(r.type) && /\/audio\/game-/.test(r.url)), `game files 200 audio/mpeg: ${JSON.stringify(reqs.map((r) => [r.url.split('/').pop(), r.status, r.type]))}`);
  ok(s1.errors === 0 && errors.length === 0, `no load / console / page errors (${errors.slice(0, 3).join(' | ')})`);
  // situation change: storm -> after the settle time a crossfade to the storm track
  const before = await page.evaluate(`${A}.music.stats.crossfades`) as number;
  await page.evaluate(`window.__force.weather = 'storm'`);
  await page.waitForFunction(`${A}.music.currentTrack === 'storm-tente-restringida'`, { timeout: 90000 });
  const s2 = await page.evaluate(`({ cf: ${A}.music.stats.crossfades, sit: ${A}.music.situation })`) as { cf: number; sit: string };
  ok(s2.cf === before + 1 && s2.sit === 'storm', `storm triggered one crossfade to Tente Restringida (${JSON.stringify(s2)})`);
  await sleep(6000);
  ok((await page.evaluate(`${A}.music.player.active.filter((a) => !a.el.paused).length`)) === 1, 'after the crossfade only the storm track plays');
  // an open bar: force the proximity level (the 10 Hz sampler passes its own state, so wrap ambience.update)
  await page.evaluate(`(() => { const a = ${A}.ambience, o = a.update.bind(a); window.__bar = 0; a.update = (s, dt) => o({ ...s, apres: window.__bar, zoom: 8 }, dt); })()`);
  const held = await page.evaluate(`${A}.music.player.cur.el.currentTime`) as number;
  await page.evaluate(`window.__bar = 1`);
  await page.waitForFunction(`${A}.ambience.apres.handoff.phase === 'apres' && !!${A}.ambience.apres.currentTrack`, { timeout: 60000 });
  await sleep(4000);
  const s3 = await page.evaluate(`(() => { const b = ${A}.ambience.apres, m = ${A}.music; return { bar: b.currentTrack, barPlaying: b.player.active.filter((a) => !a.el.paused).length, game: m.player.active.filter((a) => !a.el.paused).length, phase: b.handoff.phase }; })()`) as { bar: string; barPlaying: number; game: number; phase: string };
  ok(/^bar-/.test(s3.bar) && s3.phase === 'apres', `hand-off to a bar song (${s3.bar}, ${s3.phase})`);
  ok(s3.barPlaying === 1 && s3.game === 0, `bar song plays, the game track is paused (bar ${s3.barPlaying}, game ${s3.game})`);
  const frozen = await page.evaluate(`${A}.music.player.cur.el.currentTime`) as number;
  await sleep(2000);
  ok((await page.evaluate(`${A}.music.player.cur.el.currentTime`)) === frozen && frozen >= held, 'the game track keeps its position while the bar plays');
  ok(reqs.some((r) => /\/audio\/apres-/.test(r.url) && r.status === 200 && /^audio\/mpeg/.test(r.type)), 'bar file 200 audio/mpeg');
  await page.evaluate(`window.__bar = 0`);
  await page.waitForFunction(`${A}.ambience.apres.handoff.phase === 'main'`, { timeout: 60000 });
  await sleep(4000);
  const s4 = await page.evaluate(`(() => { const b = ${A}.ambience.apres, m = ${A}.music, c = m.player.cur; return { barPlaying: b.player.active.filter((a) => !a.el.paused).length, game: m.player.active.filter((a) => !a.el.paused).length, t: c.el.currentTime }; })()`) as { barPlaying: number; game: number; t: number };
  ok(s4.barPlaying === 0 && s4.game === 1 && s4.t >= frozen, `leaving the bar: bar paused, the game track resumes from ${frozen.toFixed(1)} s (${s4.t.toFixed(1)} s now)`);
  // Music off pauses (position kept), on resumes
  await page.evaluate(`${A}.settings.set({ musicOn: false })`);
  await sleep(3000);
  ok((await page.evaluate(`${A}.music.player.active.every((a) => a.el.paused)`)) === true, 'Music off: the element is paused');
  await page.evaluate(`${A}.settings.set({ musicOn: true })`);
  await sleep(2500);
  ok((await page.evaluate(`${A}.music.player.active.some((a) => !a.el.paused)`)) === true, 'Music on: playing again');
  ok(errors.length === 0, `no console / page errors in the whole run (${errors.slice(0, 3).join(' | ')})`);
  await page.screenshot({ path: '.weave/shots/music-e2e.png' });
} catch (e) { ok(false, `exception: ${String(e)}`); }
finally { await browser.close(); server.close(); }
if (problems.length) { console.error('music e2e FAILED'); process.exit(1); }
console.log('music e2e OK');
