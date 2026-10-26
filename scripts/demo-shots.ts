/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate bodies poke the untyped window.__slope debug API */
/* Demo-scene QA: one page load, one sim timeline, several framings (day village, busy piste, gondola, lake, sunset, night + snowcat, summer).
 * usage: npm run demo:shots -- [--seed 61] [--size 64] [--tag name] [--only village,lake] [--w 1600 --h 1000]
 * Saves .weave/shots/demo-<tag>-<shot>.png (copy the good ones to docs/img/). */
import { mkdirSync } from 'node:fs';
import { launch, startServer } from './lib/harness';

const a: Record<string, string> = {};
for (let i = 2; i < process.argv.length; i++) if (process.argv[i]!.startsWith('--')) a[process.argv[i]!.slice(2)] = process.argv[i + 1] && !process.argv[i + 1]!.startsWith('--') ? process.argv[++i]! : '1';
const seed = a.seed ?? '61', size = a.size ?? '64', tag = a.tag ?? `s${seed}`;
const only = a.only ? new Set(a.only.split(',')) : null;
const W = Number(a.w ?? 1600), H = Number(a.h ?? 1000);

const srv = await startServer();
const br = await launch();
try {
  const page = await br.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  const errs: string[] = [];
  page.on('console', (m) => { const t = m.text(); if (/\[demo\]/.test(t)) console.log(t.slice(0, 300)); if (m.type() === 'error' || (/shader|THREE\./i.test(t) && m.type() !== 'log')) errs.push(t.slice(0, 300)); });
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 400)));
  await page.goto(`${srv.url}?demoscene=1&nomenu=1&demosize=${size}&demoseed=${seed}`, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => !!(window as any).__slope?.demo, { timeout: 120000 });
  await page.evaluate(() => {
    const s = (window as any).__slope;
    s.demo.hold = true; s.demo.seasonsEnabled = false;
    s.__frame = (id: string, zoom: number, yaw: number) => { const p = s.demoPois.find((q: any) => q.id === id || q.kind === id); const at = p?.at(); if (!at) return false; const c = s.renderer.controls; c.target.set(at.x, s.grid.getCorner(Math.round(at.x), Math.round(at.z)) * 0.5, at.z); const n = s.grid.size; c.yaw = Math.atan2(-(n / 2 - at.x), -(n / 2 - at.z)) + yaw; c.zoom = 1; c.zoomBy((s.grid.size * 0.75) / zoom); return true; };
    s.__runTo = (h: number) => { let n = 0; const hr = () => s.game.date.minute / 60; const start = hr(); const wrap = h <= start; let passed = !wrap; while (n++ < 1e6) { const x = hr(); if (!passed && x < start) passed = true; if (passed && x >= h) break; s.loop.advance(1); s.demoTopUp?.(); } };
  });
  mkdirSync('.weave/shots', { recursive: true });
  const take = async (name: string, js: string, wait = 1800): Promise<void> => {
    if (only && !only.has(name)) return;
    const ok = await page.evaluate(js);
    if (ok === false) console.log(`(skip ${name}: framing target missing)`);
    await new Promise((r) => setTimeout(r, wait));
    const file = `.weave/shots/demo-${tag}-${name}.png`;
    await page.screenshot({ path: file });
    const st = await page.evaluate(() => { const s = (window as any).__slope; const g = s.guestSim.store; return `hour=${(s.game.date.minute / 60).toFixed(1)} guests=${g.count} lifts=${s.sim.lifts.all().filter((l: any) => l.open).length}/${s.sim.lifts.all().length}`; });
    console.log(`saved ${file} ${st}`);
  };
  await take('wide', `window.__slope.__runTo(10.5); window.__slope.__frame('village', 44, 0.2)`);
  await take('village', `window.__slope.__runTo(11); window.__slope.__frame('village', 22, 0.2)`);
  await take('piste', `window.__slope.__runTo(12.5); window.__slope.__frame('piste0', 16, -0.3)`);
  await take('piste2', `window.__slope.__frame('piste1', 17, 0.6)`);
  await take('gondola', `window.__slope.__runTo(13); window.__slope.__frame('carrier3', 11, 0.5) || window.__slope.__frame('carrier2', 11, 0.5)`);
  await take('lake', `window.__slope.__frame('lake0', 20, -0.4)`);
  await take('train', `window.__slope.__frame('train', 14, 0.3)`);
  await take('skier', `window.__slope.__runTo(14); window.__slope.__frame('skier', 10, -0.2)`);
  await take('sunset', `window.__slope.__runTo(16.6); window.__slope.__frame('village', 24, 0.2)`);
  await take('night', `window.__slope.__runTo(20.5); window.__slope.__frame('village', 24, 0.2)`);
  await take('snowcat', `window.__slope.__runTo(23.5); window.__slope.__frame('cat', 12, 0.4) || window.__slope.__frame('piste0', 16, -0.3)`);
  await take('summer', `window.__slope.jumpSimToDay(120, 10); window.__slope.__runTo(11.5); window.__slope.__frame('village', 22, 0.2)`, 3000);
  await take('summer-lake', `window.__slope.__frame('lake0', 20, -0.4)`);
  console.log(errs.length ? `ERRORS:\n${errs.join('\n')}` : 'no errors');
} finally { await br.close(); srv.stop(); }
