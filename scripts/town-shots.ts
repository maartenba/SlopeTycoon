/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate bodies poke the untyped window.__slope debug API */
/* Demo-town QA: per archetype a wide day shot, a close village shot, a feature shot (+ night / summer where relevant).
 * usage: npm run town:shots -- [--only alpine,family] [--tag t1] [--size 128] [--seed n] [--w 1600 --h 1000] [--shots wide,close,feature,night,summer]
 * Saves .weave/shots/towns-<tag>-<id>-<shot>.png */
import { mkdirSync } from 'node:fs';
import { launch, startServer } from './lib/harness';
import { TOWNS } from '../src/game/demoTowns';
import { TOWN_SEEDS } from '../src/config/townSeeds';

const a: Record<string, string> = {};
for (let i = 2; i < process.argv.length; i++) if (process.argv[i]!.startsWith('--')) a[process.argv[i]!.slice(2)] = process.argv[i + 1] && !process.argv[i + 1]!.startsWith('--') ? process.argv[++i]! : '1';
const tag = a.tag ?? 'a';
const only = a.only ? new Set(a.only.split(',')) : null;
const shots = new Set((a.shots ?? 'wide,close,feature,night,summer').split(','));
const W = Number(a.w ?? 1600), H = Number(a.h ?? 1000);

const srv = await startServer();
const br = await launch();
mkdirSync('.weave/shots', { recursive: true });
try {
  for (const t of TOWNS) {
    if (only && !only.has(t.id)) continue;
    const size = Number(a.size ?? t.size);
    const seed = Number(a.seed ?? (TOWN_SEEDS[t.id][size as 64 | 128 | 256] ?? [1])[0]);
    const page = await br.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    const errs: string[] = [];
    page.on('console', (m) => { const x = m.text(); if (/\[demo\]/.test(x)) console.log(x.slice(0, 400)); if (m.type() === 'error' || (/shader|THREE\./i.test(x) && m.type() !== 'log')) errs.push(x.slice(0, 300)); });
    page.on('pageerror', (e) => errs.push(String(e).slice(0, 400)));
    await page.goto(`${srv.url}?demoscene=1&nomenu=1&town=${t.id}&townseed=${seed}&demosize=${size}`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => !!(window as any).__slope?.demo, { timeout: 180000 });
    await page.evaluate(() => {
      const s = (window as any).__slope;
      s.demo.hold = true; s.demo.seasonsEnabled = false;
      s.__frame = (ids: string[], zoom: number, yaw: number, shift = 0) => { let p: any; for (const id of ids) { p = s.demoPois.find((q: any) => q.id === id || q.kind === id); if (p?.at()) break; } const at0 = p?.at(); if (!at0) return false; const mid = s.grid.size / 2; const at = { x: at0.x + (mid - at0.x) * shift, z: at0.z + (mid - at0.z) * shift }; const c = s.renderer.controls; c.target.set(at.x, s.grid.getCorner(Math.round(at.x), Math.round(at.z)) * 0.5, at.z); const n = s.grid.size; c.yaw = Math.atan2(-(n / 2 - at.x), -(n / 2 - at.z)) + yaw; c.zoom = 1; c.zoomBy((s.grid.size * 0.75) / zoom); return true; };
      s.__runTo = (h: number) => { let n = 0; const hr = () => s.game.date.minute / 60; const start = hr(); const wrap = h <= start; let passed = !wrap; while (n++ < 1e6) { const x = hr(); if (!passed && x < start) passed = true; if (passed && x >= h) break; s.loop.advance(1); s.demoTopUp?.(); } };
    });
    const take = async (name: string, js: string, wait = 1800): Promise<void> => {
      if (!shots.has(name)) return;
      const ok = await page.evaluate(js);
      if (ok === false) console.log(`(${t.id}: ${name}: framing target missing)`);
      await new Promise((r) => setTimeout(r, wait));
      const file = `.weave/shots/towns-${tag}-${t.id}-${name}.png`;
      await page.screenshot({ path: file });
      console.log(`saved ${file}`);
    };
    const sc = size / 128;
    await take('wide', `window.__slope.__runTo(${t.season === 'summer' ? 12 : 10.5}); window.__slope.__frame(['village'], ${Math.round(46 * Math.max(0.7, sc))}, 0.2, 0.22)`);
    await take('close', `window.__slope.__frame(['village'], ${Math.round(24 * Math.max(0.8, sc))}, 0.3)`);
    await take('feature', `window.__slope.__frame(['site-rink','site-festival','site-heli','site-altiport','site-beach','site-adventure','site-hut','farm','lake0','piste0'], 18, -0.3)`);
    await take('night', `window.__slope.__runTo(20.5); window.__slope.__frame(['village'], ${Math.round(26 * Math.max(0.8, sc))}, 0.2)`);
    if (t.season === 'winter') await take('summer', `window.__slope.jumpSimToDay(120, 10); window.__slope.__runTo(11.5); window.__slope.__frame(['village'], ${Math.round(30 * Math.max(0.8, sc))}, 0.2)`, 3000);
    console.log(`${t.id} seed ${seed} size ${size}: ${errs.length ? 'ERRORS ' + errs.join(' || ') : 'no errors'}`);
    await page.close();
  }
} finally { await br.close(); srv.stop(); }
