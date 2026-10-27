/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate bodies poke the untyped window.__slope debug API */
/* Visual QA harness: drives the installed Chrome (SwiftShader WebGL) via puppeteer-core and screenshots the real game.
 * Usage: npm run shot -- --size 64 --seed 61 --start summer --hour 12 --zoom 1 --target lodge --out name [--yaw 0.5] [--tutorial 1] [--w 1600 --h 1000] [--eval "js"]
 * Prints every console message / page error / failed request. Exit code 2 when a shader/GL error was seen. */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import puppeteer, { type Browser } from 'puppeteer-core';

export interface ShotOpts {
  size?: number; seed?: number; start?: string; hour?: number; zoom?: number; target?: string; out?: string; yaw?: number;
  w?: number; h?: number; extra?: string; ticks?: number; evalJs?: string; days?: number;
  /** Steps run after boot, ';'-separated: `key:F3`, `type:text` (keyboard), `mouse:x,y` (click), `move:x,y` (hover), `wheel:dy`, `click:<text of a button or css>`, `wait:ms`, `eval:js` (result logged). Clicks pierce shadow roots (innermost match by css, or button whose text/title/aria-label contains the text). */
  /** Touch emulation (hasTouch + isMobile + `?touch=1`): steps `tap:x,y`, `tdrag:x1,y1,x2,y2`, `pinch:cx,cy,d1,d2` (two fingers, distances in px), `hold:x,y,ms` (long press). */
  touch?: boolean;
  /** localStorage entries set before the game boots (e.g. `{ "slope.a11y.v1": "{\"palette\":\"cbsafe\"}" }`). */
  local?: Record<string, string>;
  steps?: string; viewport?: string; overlap?: boolean; bare?: boolean;
  /** JS run in the page BEFORE `ticks` (e.g. `__slope.populateDemo('Medium'); __slope.spawnGuests(150,'skiers')`). */
  pre?: string;
  /** Ground-level view after the ticks/eval: `ride` (skier POV), `lift` (first lift rider). `guest`: 'auto' (default) or a guest id. `vticks`: extra sim ticks AFTER entering the view. */
  view?: string; guest?: string; vticks?: number; freeze?: boolean; /** JS run in the page after entering the view (e.g. `__slope.view.freeCam(x,y,z,yaw,pitch)`), before the screenshot. */ vjs?: string;
  /** `--view photo` options: `photoFilter`, `photoFrame`, `photoAspect`, `photoHour`, `photoVignette` (0..100), `photoHero` (hero-shot preset), `photoFov`, `photoScale` (1|2), `photoOrbit` ('yaw,pitch,dist' overrides), `photoSave` (export a PNG to .weave/shots/photo-export-<out>.png and assert it has no transparent sky pixels). */
  /** `--view walk` options (Task 12, docs/walk-mode.md): `walkAt` ('x,y' tile | 'lodge' | 'station' = first lift's bottom station | 'lake'), `walkYaw` / `walkPitch` (degrees; yaw 0 = north = -z), `walkScript` (semicolon list: `w:2` hold keys for 2 s, `Rw:2` run, `look:30,-5` turn yaw/pitch degrees, `e` interact). The headless run drives the PURE walker with synthetic key input (no pointer lock). */
  walkAt?: string; walkYaw?: number; walkPitch?: number; walkScript?: string;
  /** `--walk-start default|choose:x,y`: enter walk mode through the real default entry (nearest path) or a street-view drop at tile x,y (instead of `walkAt`). */
  walkStart?: string;
  /** `--walk-drop x,y`: stay in the iso view in 'choose start' mode with the drop cursor over tile x,y (the marker + ring shot). */
  walkDrop?: string;
  photoFilter?: string; photoFrame?: string; photoAspect?: string; photoHour?: number; photoVignette?: number; photoHero?: boolean; photoFov?: number; photoScale?: number; photoOrbit?: string; photoSave?: boolean; photoFrom?: string;
}
export interface ShotResult { file: string; errors: string[]; logs: string[] }

const CHROMES = [
  ...(process.env.CHROME_PATH ? [process.env.CHROME_PATH] : []),
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];
export const CHROME_ARGS = ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-gpu-sandbox', '--no-sandbox', '--hide-scrollbars', '--mute-audio'];

function freePort(): Promise<number> {
  return new Promise((res, rej) => { const s = createServer(); s.listen(0, () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); }); s.on('error', rej); });
}

export async function startServer(): Promise<{ url: string; stop: () => void }> {
  const port = await freePort();
  const p: ChildProcess = spawn('npx', ['vite', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: { ...process.env, SLOPE_NO_HMR: '1' } });
  await new Promise<void>((res, rej) => {
    const t = setTimeout(() => rej(new Error('vite did not start')), 60000);
    p.stdout?.on('data', (d: Buffer) => { if (String(d).includes('Local')) { clearTimeout(t); res(); } });
    p.on('exit', () => rej(new Error('vite exited')));
  });
  return { url: `http://127.0.0.1:${port}/`, stop: () => { try { if (p.pid) process.kill(-p.pid); } catch { p.kill(); } } };
}

export async function launch(): Promise<Browser> {
  const exe = CHROMES.find((c) => existsSync(c));
  if (!exe) throw new Error('No Chrome/Chromium/Edge found');
  return puppeteer.launch({ executablePath: exe, headless: true, args: CHROME_ARGS, defaultViewport: null, protocolTimeout: 1800000 });
}

export async function shot(browser: Browser, base: string, o: ShotOpts): Promise<ShotResult> {
  let w = o.w ?? 1600, h = o.h ?? 1000;
  if (o.viewport) { const m = /^(\d+)x(\d+)$/.exec(o.viewport); if (m) { w = Number(m[1]); h = Number(m[2]); } }
  const q = new URLSearchParams({ size: String(o.size ?? 64), seed: String(o.seed ?? 61), start: o.start ?? 'winter', hints: '0' });
  if (o.bare) for (const k of Array.from(q.keys())) q.delete(k);
  if (o.extra) for (const [k, v] of new URLSearchParams(o.extra)) q.set(k, v);
  if (o.touch) q.set('touch', '1');
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, ...(o.touch ? { hasTouch: true, isMobile: true } : {}) });
  if (o.local) await page.evaluateOnNewDocument((kv: Record<string, string>) => { for (const [k, v] of Object.entries(kv)) { try { localStorage.setItem(k, v); } catch { /* blocked */ } } }, o.local);
  const errors: string[] = [], logs: string[] = [];
  page.on('console', (m) => { const t = `[${m.type()}] ${m.text()}`; logs.push(t); if (m.type() === 'error' || /shader|webgl|THREE\./i.test(m.text()) && m.type() !== 'log') errors.push(t); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${String(e)}`));
  page.on('requestfailed', (r) => errors.push(`[requestfailed] ${r.url()}`));
  await page.goto(`${base}?${q}`, { waitUntil: 'load', timeout: 90000 });
  const gl = await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'));
  if (!gl) errors.push('[harness] WebGL2 context could not be created');
  if (o.bare) await new Promise((r) => setTimeout(r, 6000));
  else {
    try { await page.waitForFunction(() => !!(window as unknown as { __slope?: unknown }).__slope, { timeout: 90000 }); }
    catch (e) { console.log([...errors, ...logs.slice(-12)].join('\n')); await page.close(); throw e; } // show why the game never booted
  }
  if (!o.bare) await page.evaluate((a) => {
    const s = (window as unknown as { __slope: Record<string, any> }).__slope;
    const c = s.renderer.controls;
    if (a.target && a.target !== 'lodge') { const [x, z] = a.target.split(',').map(Number); c.target.set(x, 0, z); }
    else if (a.target === 'lodge') { const b = s.buildings.all().find((q: any) => q.type === 'baseLodge'); if (b) { const g = s.buildingsView.get(b.id); c.target.set(b.x + b.w / 2, g ? g.position.y : 0, b.y + b.h / 2); } }
    if (a.zoom) { c.zoom = 1; c.zoomBy(a.zoom); }
    if (a.yaw !== undefined) c.yaw = a.yaw;
    if (a.hour !== undefined) { s.lighting.disableNight = false; }
  }, { target: o.target ?? '', zoom: o.zoom, yaw: o.yaw, hour: o.hour });
  if (o.hour !== undefined && !o.bare) await page.evaluate((hh) => { (window as any).__slope.setHour(hh); }, o.hour);
  if (o.pre) await page.evaluate(o.pre);
  if (o.ticks) { // advance the sim headlessly (guests spawn, queue, ski) before shooting
    await page.evaluate((n) => {
      const s = (window as any).__slope, loop = s.loop;
      if (loop.paused) loop.setSpeed(1);
      const target = loop.tickCount + n;
      let guard = 0;
      while (loop.tickCount < target && guard++ < 1e6) loop.advance(1);
    }, o.ticks);
  }
  if (o.evalJs) await page.evaluate(o.evalJs);
  if (o.view === 'ride' || o.view === 'lift') {
    const res = await page.evaluate(async (a) => {
      const s = (window as any).__slope, loop = s.loop;
      if (loop.paused) loop.setSpeed(1);
      const adv = (n: number): void => { const t = loop.tickCount + n; let g = 0; while (loop.tickCount < t && g++ < 1e6) loop.advance(1); };
      let id = 0, tries = 0;
      if (a.view === 'lift') { while (!s.view.liftRiders('chair') && tries++ < 600) adv(5); id = s.view.rideLift('chair'); let g2 = 0; while (id && g2++ < 300) { const p = s.view.liftProgress(id); if (p > 0.4 && p < 0.6) break; adv(2); id = s.view.rideLift('chair'); } }
      else { if (a.view === 'ride' && !(a.guest && a.guest !== 'auto')) while (!s.view.skiers() && tries++ < 400) adv(5); id = a.guest && a.guest !== 'auto' ? s.view.ride(Number(a.guest)) : s.view.rideAuto(); }
      if (id && a.vticks) adv(a.vticks);
      if (id && a.freeze) loop.setSpeed(0); // static frame: the guest stays exactly where it is
      return { id, tries, stats: s.view.stats() };
    }, { view: o.view, guest: o.guest ?? 'auto', vticks: o.vticks ?? 0, freeze: !!o.freeze });
    logs.push(`[view] ${JSON.stringify(res)}`);
    if (!res.id) errors.push('[harness] no guest to ride along with');
    if (o.vjs) logs.push(`[vjs] ${JSON.stringify(await page.evaluate(o.vjs))}`);
  }
  if (o.view === 'walk') {
    const res = await page.evaluate((a) => {
      const s = (window as any).__slope, loop = s.loop;
      if (loop.paused) loop.setSpeed(1);
      const out: any = { ok: false };
      let x = 0, z = 0, yaw = (a.yaw ?? 0) * Math.PI / 180;
      const at = a.at ?? 'lodge';
      if (at === 'lodge') { const b = s.buildings.all().find((q: any) => q.type === 'baseLodge') ?? s.buildings.all()[0]; if (b) { x = b.x + b.w / 2; z = b.y + b.h + 2.5; } }
      else if (at === 'station') { const l = s.sim.lifts.all()[0]; if (l) { x = l.bottom.x + 1; z = l.bottom.y + 3.2; const dx = l.bottom.x + 1 - x, dz = l.bottom.y + 1 - z; if (a.yaw === undefined) yaw = Math.atan2(-dx, -dz); } }
      else { const [px, pz] = at.split(',').map(Number); x = px! + 0.5; z = pz! + 0.5; }
      if (a.start) {
        if (a.start === 'default') out.ok = s.view.walk.start();
        else { const [sx, sz] = a.start.replace('choose:', '').split(',').map(Number); out.ok = s.view.walk.start(sx, sz); }
        if (out.ok && a.yaw !== undefined) { s.view.walk.mode.state.yaw = a.yaw * Math.PI / 180; }
      } else out.ok = s.view.walk.enter(x, z, yaw);
      if (!out.ok) return out;
      if (a.pitch !== undefined) s.view.walk.mode.state.pitch = a.pitch * Math.PI / 180;
      const steps: any[] = [];
      for (const raw of (a.script ?? '').split(';').map((t: string) => t.trim()).filter(Boolean)) {
        if (raw === 'e') steps.push({ seconds: 0, interact: true });
        else if (raw.startsWith('look:')) { const [dy, dp] = raw.slice(5).split(',').map(Number); steps.push({ seconds: 0, yaw: dy, pitch: dp ?? 0 }); }
        else { const [k, t] = raw.split(':'); steps.push({ keys: k!.replace('R', '').toLowerCase(), run: k!.includes('R'), seconds: Number(t ?? 1) }); }
      }
      s.view.walk.script(steps);
      const w = s.view.walk.mode;
      out.state = { x: +w.state.x.toFixed(2), z: +w.state.z.toFixed(2), yaw: +w.state.yaw.toFixed(2), ground: +w.state.ground.toFixed(2), speed: +w.state.speed.toFixed(2), steps: w.footsteps.count, surface: w.footsteps.last };
      out.prompt = w.prompt; out.location = w.location; out.card = w.card && w.card.title;
      return out;
    }, { at: o.walkAt, yaw: o.walkYaw, pitch: o.walkPitch, script: o.walkScript, start: o.walkStart });
    logs.push(`[walk] ${JSON.stringify(res)}`);
    if (!res.ok) errors.push('[harness] could not enter walk mode');
    if (o.vjs) logs.push(`[vjs] ${JSON.stringify(await page.evaluate(o.vjs))}`);
  }
  if (o.walkDrop) {
    const res = await page.evaluate((a) => { const [x, y] = a.split(',').map(Number); return (window as any).__slope.view.walk.dropAtTile(x, y); }, o.walkDrop);
    logs.push(`[walk-drop] ${JSON.stringify(res)}`);
    if (!res) errors.push('[harness] could not open choose-start mode');
  }
  if (o.view === 'photo') {
    const res = await page.evaluate(async (a) => {
      const s = (window as any).__slope, loop = s.loop;
      if (a.from === 'ride') { const g = s.view.rideAuto(); if (!g) return { ok: false, why: 'no guest to ride' }; await new Promise((r) => setTimeout(r, 700)); }
      const ok = s.view.photo.enter();
      if (!ok) return { ok: false, why: 'enter refused' };
      const p: Record<string, unknown> = {};
      if (a.filter) p.filter = a.filter; if (a.frame) p.frame = a.frame; if (a.aspect) p.aspect = a.aspect;
      if (a.hour !== undefined) p.hour = a.hour; if (a.vignette !== undefined) p.vignette = a.vignette / 100;
      if (a.fov) p.fov = a.fov; if (a.scale) p.scale = a.scale;
      if (a.hero) s.view.photo.hero();
      if (a.orbit) { const [yaw, pitch, dist] = a.orbit.split(',').map(Number); Object.assign(s.view.photo.orbit, { yaw, pitch, dist }); }
      s.view.photo.set(p);
      if (a.freeze) loop.setSpeed(0);
      return { ok: true, settings: s.view.photo.settings, orbit: { ...s.view.photo.orbit }, mode: s.view.mode };
    }, { filter: o.photoFilter, frame: o.photoFrame, aspect: o.photoAspect, hour: o.photoHour, vignette: o.photoVignette, hero: !!o.photoHero, fov: o.photoFov, scale: o.photoScale, orbit: o.photoOrbit, freeze: !!o.freeze, from: o.photoFrom });
    logs.push(`[photo] ${JSON.stringify(res)}`);
    if (!(res as any).ok) errors.push(`[harness] photo mode: ${(res as any).why}`);
    if (o.vjs) logs.push(`[vjs] ${JSON.stringify(await page.evaluate(o.vjs))}`);
  }
  for (const step of (o.steps ?? '').split(';').map((x) => x.trim()).filter(Boolean)) {
    const i = step.indexOf(':'), kind = step.slice(0, i), arg = step.slice(i + 1);
    if (kind === 'key') await page.keyboard.press(arg as never);
    else if (kind === 'type') await page.keyboard.type(arg);
    else if (kind === 'move') { const [mx, my] = arg.split(',').map(Number); await page.mouse.move(mx!, my!); }
    else if (kind === 'wheel') { await page.mouse.wheel({ deltaY: Number(arg) }); }
    else if (kind === 'mouse') { const [mx, my] = arg.split(',').map(Number); await page.mouse.click(mx!, my!); }
    else if (kind === 'drag') { const [x1, y1, x2, y2] = arg.split(',').map(Number); await page.mouse.move(x1!, y1!); await page.mouse.down(); for (let k = 1; k <= 12; k++) { await page.mouse.move(x1! + (x2! - x1!) * k / 12, y1! + (y2! - y1!) * k / 12); await new Promise((r) => setTimeout(r, 30)); } await page.mouse.up(); }
    else if (kind === 'eval') logs.push(`[eval] ${JSON.stringify(await page.evaluate(arg))}`);
    else if (kind === 'tap') { const [tx, ty] = arg.split(',').map(Number); await page.touchscreen.tap(tx!, ty!); }
    else if (kind === 'hold') { const [tx, ty, ms] = arg.split(',').map(Number); const t = await page.touchscreen.touchStart(tx!, ty!); await new Promise((r) => setTimeout(r, ms ?? 600)); await t.end(); }
    else if (kind === 'tdrag') { const [x1, y1, x2, y2] = arg.split(',').map(Number); const t = await page.touchscreen.touchStart(x1!, y1!); for (let k = 1; k <= 10; k++) { await t.move(x1! + (x2! - x1!) * k / 10, y1! + (y2! - y1!) * k / 10); await new Promise((r) => setTimeout(r, 20)); } await t.end(); }
    else if (kind === 'pinch') { const [cx, cy, d1, d2] = arg.split(',').map(Number); const a = await page.touchscreen.touchStart(cx! - d1! / 2, cy!), b = await page.touchscreen.touchStart(cx! + d1! / 2, cy!); for (let k = 1; k <= 10; k++) { const d = d1! + (d2! - d1!) * k / 10; await a.move(cx! - d / 2, cy!); await b.move(cx! + d / 2, cy!); await new Promise((r) => setTimeout(r, 20)); } await a.end(); await b.end(); }
    else if (kind === 'wait') await new Promise((r) => setTimeout(r, Number(arg)));
    else if (kind === 'click') {
      const ok = await page.evaluate(clickByText, arg);
      if (!ok) logs.push(`[harness] click target not found: ${arg}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  await new Promise((r) => setTimeout(r, 2500));
  if (o.overlap) { const res = await page.evaluate(overlapReport); logs.push(`[overlap] ${w}x${h}: ${res}`); }
  if (o.view === 'photo' && o.photoSave) {
    const r = await page.evaluate(() => (window as any).__slope.view.photo.capture());
    mkdirSync('.weave/shots', { recursive: true });
    const pf = `.weave/shots/photo-export-${o.out ?? 'shot'}.png`;
    writeFileSync(pf, Buffer.from(r.base64, 'base64'));
    logs.push(`[photo-export] ${pf} ${r.w}x${r.h} clamped=${r.clamped} rawTransparentPx(before sky)=${r.rawTransparentPx} transparentPx=${r.transparentPx} skyTransparentPx=${r.skyTransparentPx}`);
    if (r.skyTransparentPx > 0 || r.transparentPx > 0) errors.push(`[harness] exported PNG has ${r.transparentPx} transparent pixels (${r.skyTransparentPx} in the sky region)`);
  }
  if (o.view) logs.push(`[view-final] ${JSON.stringify(await page.evaluate(() => (window as any).__slope.view.stats()))}`);
  mkdirSync('.weave/shots', { recursive: true });
  const file = `.weave/shots/${o.out ?? 'shot'}.png`;
  await page.screenshot({ path: file });
  if (o.local) await page.evaluate((ks: string[]) => { for (const k of ks) { try { localStorage.removeItem(k); } catch { /* blocked */ } } }, Object.keys(o.local));
  await page.close();
  return { file, errors, logs };
}


/** Runs in the page: find a clickable inside any shadow root by css selector (tutorial-id too) or by visible text/title/aria-label. */
function clickByText(arg: string): boolean {
  const all: Element[] = [];
  const walk = (r: Document | ShadowRoot | Element): void => { for (const e of Array.from(r.querySelectorAll('*'))) { all.push(e); if (e.shadowRoot) walk(e.shadowRoot); } };
  walk(document);
  const low = arg.toLowerCase();
  const byId = all.find((e) => (e as HTMLElement).dataset?.tutorialId === arg);
  let hit: Element | undefined = byId;
  if (!hit) hit = all.find((e) => { try { return e.matches(arg); } catch { return false; } });
  if (!hit) hit = all.find((e) => e.matches('button,summary,[role=button]') && !(e as HTMLElement).hidden && [(e as HTMLElement).innerText, e.getAttribute('title'), e.getAttribute('aria-label')].some((t) => t && t.toLowerCase().includes(low)));
  if (!hit) return false;
  (hit as HTMLElement).click();
  return true;
}

/** Runs in the page: bounding boxes of every visible top-level UI panel (shadow children) and the pairs that intersect. */
function overlapReport(): string {
  const ui = document.getElementById('ui');
  if (!ui) return 'no #ui';
  const boxes: Array<{ n: string; r: DOMRect }> = [];
  const add = (n: string, e: Element): void => { const r = e.getBoundingClientRect(); if (r.width > 2 && r.height > 2) boxes.push({ n, r }); };
  for (const c of Array.from(ui.children)) {
    const tag = c.tagName.toLowerCase();
    if (['st-spotlight', 'st-toast', 'st-save-load', 'st-pause-menu', 'st-main-menu', 'st-new-game', 'st-modal'].includes(tag)) continue; // transient modals may cover the rest
    if (tag === 'div') { for (const k of Array.from(c.children)) add(`${c.id}>${k.tagName.toLowerCase()}`, k); continue; }
    const sr = (c as HTMLElement).shadowRoot;
    const kids = sr ? Array.from(sr.children).filter((e) => e.tagName !== 'STYLE' && !e.classList.contains('layer')) : [];
    if (!kids.length) { add(tag, c); continue; }
    for (const k of kids) { if (k.getBoundingClientRect().width > 2) { if (tag !== 'st-dock') add(tag, k); if (tag === 'st-dock') for (const g of Array.from(k.children)) add(`${tag}/${(g as HTMLElement).className}`, g); if (tag === 'st-assistant') for (const g of Array.from(k.children)) add(`${tag}/${(g as HTMLElement).className}`, g); } }
  }
  const bad: string[] = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i]!, b = boxes[j]!;
    if (a.n.split('/')[0] === b.n.split('/')[0]) continue;
    if (a.r.left < b.r.right - 1 && b.r.left < a.r.right - 1 && a.r.top < b.r.bottom - 1 && b.r.top < a.r.bottom - 1) bad.push(`${a.n} [${Math.round(a.r.left)},${Math.round(a.r.top)},${Math.round(a.r.right)},${Math.round(a.r.bottom)}] x ${b.n} [${Math.round(b.r.left)},${Math.round(b.r.top)},${Math.round(b.r.right)},${Math.round(b.r.bottom)}]`);
  }
  return `${boxes.length} boxes; ` + (bad.length ? 'OVERLAPS: ' + bad.join(' | ') : 'no overlaps');
}
