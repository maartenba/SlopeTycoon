/* eslint-disable @typescript-eslint/no-explicit-any -- runs inside the page against the untyped __slope debug handle */
/** `npm run visitor:models [-- --tag NAME --size 64 --seed 61]`: contact sheet of the three rare-visitor model variants in the REAL page (close walk, idle, wave, iso zoom, treeline zoom)
 * -> .weave/shots/<tag>-<model>-<view>.png and .weave/shots/<tag>-sheet.png. Use a NEW --tag every time (the image read tool caches by path). */
import { launch, startServer } from './lib/harness';
import fs from 'node:fs';

const arg = (k: string, d: string): string => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1]! : d; };
const tag = arg('tag', 'visitor-models'), size = arg('size', '64'), seed = arg('seed', '61');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const srv = await startServer(), br = await launch();
const files: Record<string, string[]> = {};
try {
  for (const model of ['plush', 'shaggy', 'bigfoot']) {
    const page = await br.newPage();
    await page.setViewport({ width: 640, height: 640, deviceScaleFactor: 1 });
    const errs: string[] = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto(`${srv.url}?size=${size}&seed=${seed}&start=winter&hints=0&starter=1&mode=career&visitorModel=${model}`, { waitUntil: 'load', timeout: 90000 });
    await page.waitForFunction(() => !!(window as any).__slope, { timeout: 90000 });
    await page.evaluate(() => { const s = (window as any).__slope; s.loop.setSpeed(0); s.setHour?.(11); const w = s.sim.weather.current; w.kind = 'clear'; w.intensity = 0; w.fog = 0; w.wind = 0; s.sim.visitor.force(60 * 10); const st = document.createElement('style'); st.textContent = '#ui{display:none!important}'; document.head.append(st); });
    files[model] = [];
    const views: Array<[string, number, number]> = [['walk-close', 0.3, 5], ['walk-close2', 0.3135, 5], ['idle-close', 0.0, 5], ['wave-close', 1, 5], ['iso', 0.3, 18], ['treeline', 0.45, 34]];
    for (const [name, frac, zoom] of views) {
      await page.evaluate((fr: number, z: number, nm: string) => {
        const s = (window as any).__slope, v = s.sim.visitor.visit, D = v.durMin;
        let el = D * fr;
        if (nm === 'idle-close') { const m = 2; void m; el = D * 0.0; }
        v.startMin = s.sim.game ? 0 : 0;
        const now = s.game.date.year * 180 * 1440 + s.game.date.day * 1440 + s.game.date.minute; v.startMin = now - el;
        if (nm === 'idle-close') { // find a moment inside a pause
          for (let e = 0; e < D; e += 3) { v.startMin = now - e; const p = s.sim.visitor.poseAt(now); if (p && p.mode === 'idle' && p.modeT > 0.35 && p.modeT < 0.55) break; }
        }
        if (nm === 'wave-close') v.startMin = now - (D - 40);
      }, frac, zoom, name);
      await sleep(600);
      await page.evaluate((z: number) => { const s = (window as any).__slope, v = s.visitorView; s.visitorView.group.children[0].scale.setScalar(z < 10 ? 2.4 : 1); s.renderer.controls.target.y = v.pos.y; s.renderer.controls.focusOn(v.pos.x, v.pos.z, { duration: 0, zoom: z }); }, zoom);
      await sleep(1600);
      const f = `.weave/shots/${tag}-${model}-${name}.png`; await page.screenshot({ path: f, clip: { x: 120, y: 120, width: 400, height: 400 } }); files[model]!.push(f);
    }
    const info = await page.evaluate(() => { const s = (window as any).__slope; return { pose: s.visitorView.lastPose, guard: s.materialGuard?.failed?.length ?? s.materialGuard?.failures ?? null }; });
    console.log(model, JSON.stringify(info), errs.length ? errs.slice(0, 3) : 'no errors');
    await page.close();
  }
  // sheet
  const rows = Object.entries(files).map(([m, fs_]) => `<div class=r><b>${m}</b>${fs_.map((f) => `<img src="data:image/png;base64,${fs.readFileSync(f).toString('base64')}">`).join('')}</div>`).join('');
  const sp = await br.newPage(); await sp.setViewport({ width: 1920, height: 1080 });
  await sp.setContent(`<style>body{margin:0;background:#222;color:#fff;font:20px sans-serif}.r{display:flex;align-items:center;gap:4px;margin:4px}.r b{width:90px}.r img{width:300px;height:300px;object-fit:cover}</style>${rows}`);
  await sp.screenshot({ path: `.weave/shots/${tag}-sheet.png`, fullPage: true });
  console.log('sheet', `.weave/shots/${tag}-sheet.png`);
} finally { await br.close(); srv.stop(); }
