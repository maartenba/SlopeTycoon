/**
 * `npm run sfx:e2e` (after `npm run build`): real-page check of the recorded samples (public/audio/sfx) in Chrome over https. Checks: nothing under audio/sfx is requested before the first gesture;
 * a footstep plays the SYNTH until its pool is decoded and a SAMPLE afterwards; files are 200 `audio/mpeg`, only under ./audio/sfx/, no console / page errors; beds start from the ambience mix and the
 * decoded memory stays under the cap; every shipped loop decodes to its table length in Chrome (gapless) and its wrap-around jump is small (seam measurement of the DECODED output, not a listening test);
 * a storm triggers a thunder sample; the service worker caches the files and an OFFLINE reload plays cached samples and falls back silently to the synth for files never cached.
 * It inspects the audio graph / counters: it CANNOT HEAR anything (docs/playtest-audio.md is the by-ear list). Exit 1 on failure.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer as createHttps } from 'node:https';
import { execFileSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import puppeteer from 'puppeteer-core';
import { SAMPLES, SAMPLE_DEFS } from '../src/config/audioSamples';
import { createPagesServer } from './lib/static-server';
import { CHROME_ARGS } from './lib/harness';
import { requireFreshDist } from './lib/dist-guard';

const dist = join(process.cwd(), 'dist');
requireFreshDist();
const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((c) => existsSync(c));
if (!exe) { console.error('No Chrome found'); process.exit(1); }
const tmp = mkdtempSync(join(tmpdir(), 'slope-sfx-'));
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
  let offline = false;
  const errors: string[] = [], reqs: Array<{ url: string; status: number; type: string; fromSw: boolean }> = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (process.env.MM_DEBUG) console.log('console:', m.type(), m.text().slice(0, 200)); const t = m.text(); if (m.type() === 'error' && !/GPU stall|GL Driver Message/.test(t) && !(offline && /Failed to load resource/.test(t))) errors.push(t); });
  page.on('response', (r) => { if (r.url().includes('/audio/sfx/')) reqs.push({ url: r.url(), status: r.status(), type: r.headers()['content-type'] ?? '', fromSw: r.fromServiceWorker() }); });
  await page.goto(`${origin}/?size=64&seed=3&start=winter&hints=0`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(`!!${A}`, { timeout: 120000 });
  await page.waitForFunction(`navigator.serviceWorker.getRegistration().then((r) => !!r && !!r.active && !!navigator.serviceWorker.controller)`, { timeout: 120000 });
  await sleep(2500);
  ok(reqs.length === 0, 'no audio/sfx file requested before the first gesture');
  ok((await page.evaluate(`${A}.engine.state`)) === 'locked' && (await page.evaluate(`${A}.samples.stats.loaded`)) === 0, 'engine locked, nothing decoded before a gesture');
  await page.mouse.click(640, 400);
  await page.waitForFunction(`${A}.engine.state === 'running'`, { timeout: 60000 });
  // 1. a footstep: the synth first (never delayed), a sample once the pool is decoded
  const first = await page.evaluate(`(() => { const a = ${A}; const played = a.sfx.play('stepSnow', { pitch: 1 }); return { played, shots: a.samples.stats.shots, fallbacks: a.samples.stats.fallbacks, ready: a.samples.roleReady('stepSnow') }; })()`) as { played: boolean; shots: number; fallbacks: number; ready: boolean };
  ok(first.played && first.shots === 0 && first.fallbacks === 1 && !first.ready, `first footstep plays the synth while the pool loads (${JSON.stringify(first)})`);
  await page.waitForFunction(`${A}.samples.roleReady('stepSnow')`, { timeout: 60000 });
  await sleep(400);
  const second = await page.evaluate(`(() => { const a = ${A}; const played = a.sfx.play('stepSnow', { pitch: 1 }); return { played, shots: a.samples.stats.shots }; })()`) as { played: boolean; shots: number };
  ok(second.played && second.shots === 1, `after the pool is decoded the footstep is a sample (${JSON.stringify(second)})`);
  for (const role of ['stepGravel', 'stepGrass', 'stepWood', 'stepRoad', 'birdChirp', 'cowbell', 'churchBell', 'bell', 'clank', 'creak', 'avalanche', 'thud']) await page.evaluate(`${A}.sfx.play('${role}')`);
  await page.waitForFunction(`['stepGravel', 'stepGrass', 'stepWood', 'stepRoad', 'birdChirp', 'bell', 'clank', 'thud'].every((r) => ${A}.samples.roleReady(r))`, { timeout: 90000 });
  ok(true, 'footstep / bird / bell / clank / thud pools decode on first use');
  // 2. beds from the ambience mix (wind + crowd), forced like music-e2e
  await page.evaluate(`(() => { const a = ${A}.ambience, o = a.update.bind(a); window.__st = { wind: 0.6, crowd: 60, zoom: 8, weather: 'clear', lifts: 1, stream: 0 }; a.update = (s, dt) => o({ ...s, ...window.__st }, dt); })()`);
  await page.waitForFunction(`${A}.samples.activeBeds.includes('wind-a') && ${A}.samples.activeBeds.includes('crowd')`, { timeout: 90000 });
  const beds = await page.evaluate(`({ beds: ${A}.samples.activeBeds, mem: ${A}.samples.memoryBytes, eng: ${A}.engine.state })`) as { beds: string[]; mem: number; eng: string };
  ok(beds.eng === 'running' && beds.mem > 0 && beds.mem < SAMPLES.memoryCapMB * 1048576, `beds play (${beds.beds.join(', ')}); decoded memory ${(beds.mem / 1048576).toFixed(1)} MB < ${SAMPLES.memoryCapMB} MB cap`);
  await page.evaluate(`window.__st.lifts = 1`);
  await page.waitForFunction(`${A}.samples.activeBeds.includes('lift-a')`, { timeout: 90000 });
  // 2b. batch 2: the per-kind lift beds, queue / bar crowd and the cannon near beds start from forced proximity (the real probe feeds the same fields), requested only after the gesture
  await page.evaluate(`Object.assign(window.__st, { gondola: 1, cablecar: 1, funicular: 1, buildings: 1, apres: 0.9, cannon: 1, lifts: 1, crowd: 80 })`);
  await page.waitForFunction(`['gondola-a', 'cablecar', 'funicular', 'crowd-queue-a', 'bar-crowd-a'].every((id) => ${A}.samples.activeBeds.includes(id)) && ${A}.samples.activeBeds.some((id) => id.startsWith('cannon-near'))`, { timeout: 120000 });
  const b2 = await page.evaluate(`({ beds: ${A}.samples.activeBeds, mem: ${A}.samples.memoryBytes })`) as { beds: string[]; mem: number };
  ok(b2.beds.filter((id) => id.startsWith('cannon-near')).length === 1, `a forced gondola / cable car / funicular / queue / bar / cannon scene plays the new beds, ONE cannon near bed (${b2.beds.join(', ')}); decoded ${(b2.mem / 1048576).toFixed(1)} MB`);
  await page.evaluate(`Object.assign(window.__st, { gondola: 0, cablecar: 0, funicular: 0, apres: 0, cannon: 0, buildings: 0, crowd: 60 })`);
  // 2c. tower clanks (short one-shots + the whole passage) and the rare-visitor call: synth first, recordings once decoded
  await page.evaluate(`${A}.sfx.play('towerClank', { tag: 'short' }); ${A}.sfx.play('distantCall', { gain: 0.5 })`);
  await page.waitForFunction(`${A}.samples.roleReady('towerClank', 'short') && ${A}.samples.roleReady('towerClank', 'pass') && ${A}.samples.roleReady('distantCall')`, { timeout: 90000 });
  const tc = await page.evaluate(`(async () => { const a = ${A}, files = []; for (const tag of ['short', 'pass']) { await new Promise((r) => setTimeout(r, 1200)); a.sfx.play('towerClank', { tag, gain: 0.5 }); files.push(a.samples.lastFile); } await new Promise((r) => setTimeout(r, 6000)); a.sfx.play('distantCall', { gain: 0.5 }); files.push(a.samples.lastFile); return files; })()`) as string[];
  ok(/^mach-tower-clank-0[1-4]$/.test(tc[0]!) && tc[1] === 'mach-tower-pass-01' && /^creature-call-0[1-3]$/.test(tc[2]!), `tower clank (short / whole passage) and the visitor call play recordings (${tc.join(', ')})`);
  // 3. seam measurement of the decoded loops in Chrome (gapless decode: the length equals the table, the wrap-around jump is small next to the typical sample step)
  const seams = await page.evaluate(`(async (defs) => {
    const out = [];
    for (const d of defs) {
      const bytes = await (await fetch('./audio/sfx/' + d.id + '.mp3')).arrayBuffer();
      const rate = d.rate || 44100, ctx = new OfflineAudioContext(1, 1, rate), buf = await ctx.decodeAudioData(bytes), x = buf.getChannelData(0), n = x.length;
      let s2 = 0; for (let i = 1; i < n; i++) { const e = x[i] - x[i - 1]; s2 += e * e; }
      out.push({ id: d.id, sec: n / rate, want: d.dur, ratio: Math.abs(x[0] - x[n - 1]) / (Math.sqrt(s2 / (n - 1)) || 1e-9) });
    }
    return out;
  })(${JSON.stringify(SAMPLE_DEFS.filter((s) => s.role === 'bed').map((s) => ({ id: s.id, rate: s.rate, dur: s.dur })))})`) as Array<{ id: string; sec: number; want: number; ratio: number }>;
  const badLen = seams.filter((s) => Math.abs(s.sec - s.want) > 0.06), badSeam = seams.filter((s) => s.ratio > 4);
  ok(seams.length >= 38 && badLen.length === 0, `${seams.length} loops decode to their table length in Chrome (gapless)${badLen.length ? ': ' + JSON.stringify(badLen) : ''}`);
  ok(badSeam.length === 0, `loop wrap-around jump <= 4x the typical sample step (worst ${Math.max(...seams.map((s) => s.ratio)).toFixed(2)})${badSeam.length ? ': ' + JSON.stringify(badSeam) : ''}`);
  // 4. a storm: thunder (forced rng so the roll hits), the sample plays once decoded
  await page.evaluate(`(() => { const a = ${A}; a.ambience.rng = () => 0; window.__st.weather = 'storm'; })()`);
  await page.waitForFunction(`${A}.sfx.played.thunder >= 1`, { timeout: 60000 });
  await page.waitForFunction(`${A}.samples.roleReady('thunder')`, { timeout: 60000 });
  const shots0 = await page.evaluate(`${A}.samples.stats.shots`) as number;
  await page.waitForFunction(`${A}.samples.stats.shots > ${shots0} && ${A}.sfx.played.thunder >= 2`, { timeout: 60000 });
  ok(true, 'a storm triggers thunder (synth first, then a sample)');
  await page.evaluate(`window.__st.weather = 'clear'; ${A}.ambience.rng = () => 0.5`);
  // 5. network: only ./audio/sfx/*.mp3, 200 audio/mpeg
  ok(reqs.length > 20 && reqs.every((r) => r.status === 200 && /^audio\/mpeg/.test(r.type) && /\/audio\/sfx\/[a-z0-9-]+\.mp3$/.test(r.url)), `${reqs.length} sample requests, all 200 audio/mpeg under audio/sfx (${[...new Set(reqs.filter((r) => r.status !== 200 || !/^audio\/mpeg/.test(r.type)).map((r) => r.url))].slice(0, 3).join(', ')})`);
  ok(errors.length === 0, `no console / page errors (${errors.slice(0, 3).join(' | ')})`);
  // 6. service worker cache + offline
  const cachedUrls = await page.evaluate(async () => { const o: string[] = []; for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) if (r.url.includes('/audio/sfx/')) o.push(r.url); return o; });
  ok(cachedUrls.length > 20, `the service worker runtime-cached ${cachedUrls.length} sample files`);
  const uncached = SAMPLE_DEFS.find((d) => !cachedUrls.some((u) => u.endsWith(`/${d.id}.mp3`)))!.id; // a file nobody asked for online
  // really offline: stop the server (the service worker's own fetches would not obey the page's network emulation)
  server.closeAllConnections(); await new Promise<void>((r) => server.close(() => r()));
  offline = true; reqs.length = 0; errors.length = 0;
  await page.reload({ waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(`!!${A}`, { timeout: 120000 });
  await page.mouse.click(640, 400);
  await page.waitForFunction(`${A}.engine.state === 'running'`, { timeout: 60000 });
  await page.evaluate(`${A}.sfx.play('stepSnow')`);
  await page.waitForFunction(`${A}.samples.roleReady('stepSnow')`, { timeout: 60000 });
  ok(reqs.some((r) => r.fromSw && r.status === 200), 'offline: cached samples are served by the service worker and decode');
  await page.evaluate(`${A}.samples.load(['${uncached}'])`); await page.waitForFunction(`${A}.samples.stats.failed >= 1`, { timeout: 20000 }).catch(() => undefined); // never fetched online: not in the cache, so the offline load fails and the synth stays in charge
  const off = await page.evaluate(`({ played: ${A}.sfx.play('stepGrass'), eng: ${A}.engine.state, errs: ${A}.samples.stats.failed })`) as { played: boolean; eng: string; errs: number };
  ok(off.played && off.eng === 'running' && off.errs >= 1 && !(await page.evaluate(`${A}.samples.isReady('${uncached}')`)), `offline: a file that was never cached fails quietly (the synth stays), a footstep still plays, the engine keeps running (${JSON.stringify(off)})`);
  ok(errors.length === 0, `offline: no page errors (${errors.slice(0, 3).join(' | ')})`);
} catch (e) { ok(false, `exception: ${String(e)}`); }
finally { await browser.close(); try { server.close(); } catch { /* already closed */ } }
if (problems.length) { console.error('sfx e2e FAILED'); process.exit(1); }
console.log('sfx e2e OK');
