/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate bodies poke the untyped window.__slope debug handle */
/** Promo capture runner (M7.6.2, docs/promo-video.md).
 *   npx vite-node scripts/promo/capture.ts --build-towns [--town winter,apres]      # build + save the staged towns into .weave/promo/towns (game save format)
 *   npx vite-node scripts/promo/capture.ts --draft [--cut 90|30] [--shot s01,s05] [--jobs 2] [--format jpg|png|webcodecs] [--force]
 *   npx vite-node scripts/promo/capture.ts --final ...                              # 2560x1440, 30 fps, JPEG quality 95 (long: do not start casually)
 * Every shot loads its saved town (the game's own save through `?load=`), applies only date / hour / weather / camera, then steps the real game with `__slope.frameStep`
 * (virtual clock, fixed dt) and grabs the WebGL canvas in the same task as the render (toBlob -> POST to a local frame sink). Frames: .weave/promo/frames/<draft|final>/<shot>/%05d.jpg
 * (a shot is skipped when its `.done` marker matches; --force re-shoots). The 30 s teaser reuses the 90 s shots (first `len` seconds, see `film.shots[].cuts.c30`). */
import { mkdirSync, readFileSync, writeFileSync, existsSync, appendFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { launch, startServer } from '../lib/harness';
import { installLib } from './lib';
import { installFilm } from './film';
import { runSetups } from './setups';

const arg = (k: string, d = ''): string => { const i = process.argv.indexOf(`--${k}`); return i > 0 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith('--') ? process.argv[i + 1]! : i > 0 ? '1' : d; };
const final = arg('final') === '1';
const RES = (final ? 'final' : 'draft') + (arg('tag') ? `-${arg('tag')}` : ''); // --tag 4k -> frames/final-4k (never mixes resolutions)
const W = Number(arg('w', final ? '2560' : '1280')), H = Number(arg('h', final ? '1440' : '720'));
const fpsArg = Number(arg('fps', '0')); // probing: override the film fps
const freezeCam = arg('freezecam') === '1'; // flicker probe: the camera stays at its first pose while time (sim, sun, atmosphere, water) runs
const fmt = arg('format', 'jpg') as 'jpg' | 'png' | 'webcodecs';
const quality = Number(arg('quality', final ? '95' : '88')) / 100;
const jobs = Math.max(1, Number(arg('jobs', '1')));
const cut = arg('cut', '90');
const only = arg('shot').split(',').filter(Boolean);
const force = arg('force') === '1';
const lenOverride = Number(arg('len', '0')); // probing: shorten every selected shot to N seconds
const manifest = JSON.parse(readFileSync(arg('manifest', 'promo/scenes.json'), 'utf8'));
const FILM = manifest.film;
const TOWNS = '.weave/promo/towns', FRAMES = `.weave/promo/frames/${RES}`;
mkdirSync(TOWNS, { recursive: true }); mkdirSync(FRAMES, { recursive: true });
const ts = (): string => new Date().toISOString().slice(11, 19);

// ---- frame sink ----
const sink = createServer((rq, rs) => {
  if (rq.method === 'OPTIONS') { rs.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST' }); rs.end(); return; }
  const u = new URL(rq.url ?? '/', 'http://x'); const name = u.searchParams.get('name') ?? 'x';
  const ch: Buffer[] = []; rq.on('data', (c) => ch.push(c));
  rq.on('end', () => {
    const f = join(FRAMES, name); mkdirSync(dirname(f), { recursive: true });
    if (u.searchParams.get('append')) appendFileSync(f, Buffer.concat(ch)); else writeFileSync(f, Buffer.concat(ch));
    rs.setHeader('Access-Control-Allow-Origin', '*'); rs.end('ok');
  });
});
await new Promise<void>((r) => sink.listen(0, '127.0.0.1', r)); const sinkPort = (sink.address() as any).port;

const srv = await startServer();
const closers: Array<() => Promise<void> | void> = [() => srv.stop(), () => { sink.close(); }];

async function newPage(br: any): Promise<any> {
  const page = await br.newPage(); await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  const errs: string[] = []; (page as any).__errs = errs;
  page.on('console', (m: any) => { const t = m.text(); if (m.type() === 'error' || (/shader|webgl|THREE\./i.test(t) && m.type() !== 'log' && m.type() !== 'info' && !/GPU stall/i.test(t))) errs.push(t.slice(0, 200)); });
  page.on('pageerror', (e: any) => errs.push(`[pageerror] ${String(e)}`));
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem('slope.quality', 'high'); localStorage.setItem('slope.consent.analytics', 'denied'); localStorage.setItem('slope.ride.slowmo', '0'); } catch { /* ignore */ } });
  return page;
}

// ---- towns ----
async function buildTown(br: any, id: string): Promise<void> {
  const t = FILM.towns[id]; const t0 = Date.now();
  const page = await newPage(br);
  const q = new URLSearchParams({ size: '128', seed: '5', start: t.season, hints: '0', mode: 'career', name: 'Alpenglow', starter: '0' });
  await page.goto(`${srv.url}?${q}`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => !!(window as any).__slope, { timeout: 120000 });
  await page.evaluate(installLib);
  const info = await runSetups(page, { start: { season: t.season, month: t.month, dom: t.dom, hour: t.hour }, setups: t.setups });
  const meta = await page.evaluate(async () => {
    const P = (window as any).__promo, s = (window as any).__slope; P.freeze();
    const { encodeSave, makeMeta } = await P.imp('/src/persist/Serializer.ts');
    const { bytes } = await encodeSave(s.sim, makeMeta(s.sim, 'promo'));
    let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { b64: btoa(bin), pistes: P.pistes ?? null, sledLine: P.sledLine ?? null, hash: s.frameHash(), buildings: s.sim.buildings.all().length, lifts: s.sim.lifts.all().length, guests: s.guestSim.store.count };
  });
  writeFileSync(`${TOWNS}/${id}.slope`, Buffer.from(meta.b64, 'base64'));
  writeFileSync(`${TOWNS}/${id}.info.json`, JSON.stringify({ id, pistes: meta.pistes, sledLine: meta.sledLine, hash: meta.hash, buildings: meta.buildings, lifts: meta.lifts, guests: meta.guests, failed: info.failed, built: new Date().toISOString() }, null, 1));
  console.log(`[${ts()}] town ${id}: ${meta.buildings} buildings, ${meta.lifts} lifts, ${(meta.b64.length * 0.75 / 1024).toFixed(0)} kB, hash ${meta.hash}, failed=${JSON.stringify(info.failed)}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  await page.close();
}

// ---- shots ----
const loadedIn = new WeakSet<object>();
async function renderShot(br: any, shot: any, fps: number): Promise<{ frames: number; ms: number; skipped?: boolean }> {
  const dir = join(FRAMES, shot.id); const marker = join(dir, '.done');
  const nFrames = Math.round(shot.len * fps) + 1; // frame 0 at t = 0 .. frame n-1 at t = len
  const want = JSON.stringify({ n: nFrames, W, H, fmt, fps });
  if (!force && existsSync(marker) && readFileSync(marker, 'utf8').startsWith(want.slice(0, -1))) return { frames: nFrames, ms: 0, skipped: true };
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const t0 = Date.now(); const town = shot.town;
  const infoFile = `${TOWNS}/${town}.info.json`; if (!existsSync(infoFile)) throw new Error(`town ${town} not built (run --build-towns)`);
  const info = JSON.parse(readFileSync(infoFile, 'utf8'));
  const page = await newPage(br);
  if (!loadedIn.has(br)) { // put every town into this browser's IndexedDB once (the game loads saves through ?load=<slot>)
    await page.goto(`${srv.url}?uikit=1`, { waitUntil: 'load', timeout: 120000 });
    for (const id of Object.keys(FILM.towns)) {
      const f = `${TOWNS}/${id}.slope`; if (!existsSync(f)) continue;
      const b64 = readFileSync(f).toString('base64');
      await page.evaluate(async (slot: string, data: string) => {
        const R = await (new Function('u', 'return import(u)') as any)('/src/game/restore.ts'); const be = R.openBackend(); const bin = atob(data); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        await be.put(slot, u8, { meta: { name: slot, date: { year: 0, day: 0, minute: 0 }, money: 0, rating: 0, guests: 0, mapSize: 128, savedAt: Date.now(), config: {} }, auto: false, seed: 5 });
      }, `promo-${id}`, b64);
    }
    loadedIn.add(br);
  }
  await page.goto(`${srv.url}?load=promo-${town}&hints=0&mode=career&name=Alpenglow&stepmode=1`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => !!(window as any).__slope, { timeout: 120000 });
  await page.evaluate(installLib); await page.evaluate(installFilm);
  await page.evaluate((i: any) => { const P = (window as any).__promo; P.pistes = i.pistes; P.sledLine = i.sledLine; }, info);
  // 1 sim tick = 10 game minutes: runSetups starts early enough that a crowd spawned now has settled by the shot hour
  const rs = await runSetups(page, { start: shot.start, setups: shot.after ?? [] });
  if (rs.failed.length) console.log(`[${ts()}] ${shot.id} setup problems: ${rs.failed.join('; ')}`);
  const scene = { start: shot.start, atmos: shot.atmos };
  const prep = await page.evaluate(async (sh: any, sc: any) => {
    const P = (window as any).__promo, s = (window as any).__slope; P.hideUi();
    P.freeze(); const out: any = {};
    s.atmos.force({ ...(sc.atmos ?? {}), hour: sh.hour?.[0]?.[1] ?? sc.start.hour });
    const wx = sh.weather?.[0]; if (wx) P.weather(wx.kind, wx.kind === 'clear' ? 0 : (wx.intensity ?? 1), wx.wind ?? 0.1, wx.fog ?? 0); else P.clearWeather();
    if (sh.cue) out.cue = P.cue(sh.cue);
    if (sh.mode === 'ride') { // a rider early on the line (p in [lo, hi], default 0.03..0.22; the film uses 0.5..0.75: below ~0.5 the rider is still in the station hall (progress is per tick, 0.07 -> 0.58 in one step)): the ride has to last the whole shot (the camera follows the guest to the top station and past it)
      s.loop.setSpeed(1); const lo = sh.ride.p?.[0] ?? 0.03, hi = sh.ride.p?.[1] ?? 0.22; let g = 0, id = 0;
      const pick2 = (): number => { const st = s.guestSim.store; let best = 0, bp = 9; for (let i = 0; i < st.limit; i++) { if (!st.alive[i] || st.state[i] !== 5 /* GState.Riding */) continue; const q = s.view.liftProgress(st.id[i]); if (q >= lo && q <= hi && q < bp) { bp = q; best = st.id[i]; } } return best; };
      while (!(id = pick2()) && g++ < 600) P.adv(1);
      if (id) id = s.view.ride(id); out.ride = id; s.loop.setSpeed(0);
    }
    else if (sh.mode === 'free' && sh.chase) { // a free camera that chases a lift rider from beside the line (the ride camera itself sits between the two cables: every oncoming chair fills the frame for 2-5 frames, which reads as flicker)
      s.loop.setSpeed(1); const lo = sh.chase.p?.[0] ?? 0.5, hi = sh.chase.p?.[1] ?? 0.75; let g = 0, id = 0;
      const pickC = (): number => { const st = s.guestSim.store; let best = 0, bp = 9; for (let i = 0; i < st.limit; i++) { if (!st.alive[i] || st.state[i] !== 5 /* GState.Riding */) continue; const q = s.view.liftProgress(st.id[i]); if (q >= lo && q <= hi && q < bp) { bp = q; best = st.id[i]; } } return best; };
      while (!(id = pickC()) && g++ < 600) P.adv(1);
      if (id) { out.follow = s.view.ride(id); P.chaseId = id; } s.loop.setSpeed(0);
    }
    else if (sh.mode === 'free') {
      // a ride rig has to be active for the free camera: follow a guest far from the first camera position (its figure is hidden by the rig)
      const st = s.guestSim.store; let best = 0, bd = -1; const a = P.anchor(sh.keys[0].at); for (let i = 0; i < st.limit; i++) if (st.alive[i]) { const d = a ? Math.hypot(st.x[i] - a.x, st.y[i] - a.z) : 0; if (d > bd) { bd = d; best = st.id[i]; } }
      out.follow = s.view.ride(best); s.loop.setSpeed(0);
    }
    if (sh.mode !== 'ride') out.prep = await P.prepShot(sh, sc);
    s.frameCam?.(0, 0);
    return out;
  }, shot, scene);
  if ((shot.mode === 'free' && !prep.follow) || (shot.mode === 'ride' && !prep.ride)) console.log(`[${ts()}] ${shot.id} WARNING no guest to follow (${JSON.stringify(prep)})`);
  if (prep.cue && !prep.cue.ok) console.log(`[${ts()}] ${shot.id} WARNING sky cue not found ${JSON.stringify(prep.cue)}`);
  if (arg('eval')) console.log('[eval]', JSON.stringify(await page.evaluate(arg('eval'))));
  await page.evaluate((r: number) => { (window as any).__slope.frameStepRate = r; }, shot.rate ?? 1);
  if (freezeCam) await page.evaluate(() => { (window as any).__promo.freezeCam = true; });
  if (fmt === 'webcodecs') await page.evaluate((p: number, f: string, w: number, h: number, fp: number) => (window as any).__promo.encStart(p, f, w, h, fp, w * h * 12), sinkPort, `${shot.id}/video.h264`, W, H, fps);
  await page.evaluate(() => (window as any).__slope.frameStep(0, 8)); // preroll: terrain / prop builds settle, no sim time passes (then every clock restarts from the same state)
  const dt = 1 / fps; const ext = fmt === 'png' ? 'png' : 'jpg';
  let bytes = 0; const rideLog: string[] = [];
  for (let i = 0; i < nFrames; i++) {
    const name = `${shot.id}/${String(i + 1).padStart(5, '0')}.${ext}`;
    if (shot.mode === 'ride' && prep.ride && i % Math.round(fps / 2) === 0) rideLog.push(`${(i / fps).toFixed(1)}s ${(await page.evaluate((id: number) => (window as any).__slope.view.liftProgress(id), prep.ride)).toFixed(2)}`);
    bytes += await page.evaluate((n: string, f: string, qq: number, p: number, st: [number, number]) => (window as any).__promo.grab(n, f, qq, p, st), name, fmt, quality, sinkPort, [i === 0 ? 0 : dt, 1]);
  }
  if (fmt === 'webcodecs') await page.evaluate(() => (window as any).__promo.encEnd());
  if (rideLog.length) console.log(`[${ts()}] ${shot.id} ride progress: ${rideLog.join(', ')} (must stay < 1: the camera follows the guest to the top station and past it)`);
  if (shot.follow) { // a follow shot must run DOWNHILL: the leading carrier's terrain height falls over the shot (promo/scenes.json cue p0 < 0.5 = outbound leg)
    const log: Array<[number, number]> = await page.evaluate(() => (window as any).__promo.followLog ?? []);
    const h0 = log[0]?.[1] ?? 0, h1 = log[log.length - 1]?.[1] ?? 0; const bad = log.length < 2 || h1 >= h0 - 0.5;
    console.log(`[${ts()}] ${shot.id} follow heights ${log.length ? `${h0.toFixed(2)} -> ${h1.toFixed(2)}` : 'none'}${bad ? ' ERROR: the follow shot does not go downhill' : ' ok (downhill)'}`);
    if (bad) process.exitCode = 3;
  }
  if (arg('evalend')) console.log('[evalend]', JSON.stringify(await page.evaluate(arg('evalend'))));
  const res = await page.evaluate(() => { const s = (window as any).__slope; s.frameStepEnd(); return { hash: s.frameHash(), tick: s.loop.tickCount }; });
  const errs = [...new Set<string>((page as any).__errs)];
  if (errs.length) console.log(`[${ts()}] ${shot.id} page errors: ${errs.slice(0, 3).join(' | ')}`);
  const ms = Date.now() - t0;
  writeFileSync(marker, `${want.slice(0, -1)},"hash":"${res.hash}","tick":${res.tick},"ms":${ms},"kb":${Math.round(bytes / 1024)}}`);
  await page.close();
  return { frames: nFrames, ms };
}

try {
  const brs: any[] = [];
  for (let j = 0; j < jobs; j++) brs.push(await launch());
  closers.push(async () => { for (const b of brs) await b.close(); });
  if (arg('build-towns') === '1') {
    const ids = (arg('town') ? arg('town').split(',') : Object.keys(FILM.towns));
    for (const id of ids) await buildTown(brs[0], id);
  } else {
    const fps = fpsArg || (final ? FILM.fps : FILM.draftFps);
    let shots: any[] = FILM.shots;
    if (cut === '30') shots = shots.filter((s) => s.cuts.c30);
    if (only.length) shots = shots.filter((s) => only.some((o) => s.id.startsWith(o)));
    if (lenOverride > 0) shots = shots.map((s) => ({ ...s, len: lenOverride }));
    const total = shots.reduce((a, s) => a + Math.round(s.len * fps) + 1, 0); let done = 0; const tAll = Date.now(); const queue = shots.slice(); const timings: any[] = [];
    console.log(`[${ts()}] ${RES} ${W}x${H} ${fps} fps ${fmt} q${quality}: ${shots.length} shots, ${total} frames, ${jobs} job(s)`);
    await Promise.all(brs.map(async (br) => {
      for (;;) {
        const shot = queue.shift(); if (!shot) return;
        const r = await renderShot(br, shot, fps);
        done += r.frames; const el = (Date.now() - tAll) / 1000; const eta = done ? el / done * (total - done) : 0;
        timings.push({ shot: shot.id, frames: r.frames, ms: r.ms, skipped: !!r.skipped });
        console.log(`[${ts()}] ${shot.id}: ${r.skipped ? 'skipped (done)' : `${r.frames} frames in ${(r.ms / 1000).toFixed(0)} s = ${(r.ms / r.frames).toFixed(0)} ms/frame`}  total ${done}/${total}  ETA ${(eta / 60).toFixed(1)} min`);
      }
    }));
    const wall = (Date.now() - tAll) / 1000; const rendered = timings.filter((t) => !t.skipped).reduce((a, t) => a + t.frames, 0);
    console.log(`[${ts()}] done: ${rendered} frames rendered in ${wall.toFixed(0)} s = ${(rendered ? wall / rendered : 0).toFixed(2)} s/frame wall (${(rendered / Math.max(1, wall)).toFixed(2)} frames/s)`);
    writeFileSync(`${FRAMES}/timings-${cut}-${Date.now()}.json`, JSON.stringify({ RES, W, H, fps, fmt, jobs, wall, rendered, timings }, null, 1));
  }
} finally { for (const c of closers.reverse()) { try { await c(); } catch { /* ignore */ } } }
