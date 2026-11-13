/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate bodies poke the untyped window.__slope debug API */
/* M8 off-screen tree casters: static shadow pass with the extras on vs off (High, budget lifted so the cast density stays 1). vite-node scripts/shots/m8-extras-n.ts [seed=5] [zoom=3] [hour=16]. Relative numbers (SwiftShader). */
import { launch, startServer } from '../lib/harness';
const seed = process.argv[2] ?? '5', zoom = Number(process.argv[3] ?? 3), hour = Number(process.argv[4] ?? 16);
const srv = await startServer(), br = await launch();
try {
  const page = await br.newPage();
  await page.setViewport({ width: 960, height: 600, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem('slope.quality', 'high'); } catch { /* none */ } });
  await page.goto(`${srv.url}?${new URLSearchParams({ size: process.env.SIZE ?? '128', seed, start: 'summer', hints: '0' })}`, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => !!(window as any).__slope, { timeout: 90000 });
  const r = await page.evaluate(async (o) => {
    const s = (window as any).__slope, r = s.renderer, c = r.controls, sh = r.shadows;
    s.loop.setSpeed(0); s.setHour(o.hour); sh.heavyTriBudget = 1e9; sh.measureSync = true;
    c.zoomBy(o.zoom / c.zoom); c.target.set(Number(o.tx), 0, Number(o.tx));
    const out: any[] = [];
    for (const on of [false, true]) {
      sh.extraCasters = on;
      const p0 = sh.stats.staticPasses; let guard = 0;
      while (sh.stats.staticPasses === p0 && guard++ < 200) await new Promise((x) => setTimeout(x, 100));
      await new Promise((x) => setTimeout(x, 800));
      out.push({ extras: on, cells: sh.stats.extraCells, calls: sh.stats.calls, tris: sh.stats.triangles, ms: Math.round(sh.stats.ms), density: sh.stats.density });
    }
    const dbg: any[] = [];
    for (const l of s.trees.layers.slice(0, 2)) { const ls = (l as any).levels; dbg.push({ shown: (l as any).shown, lv: ls.map((lv: any) => ({ cells: lv.cells.length, built: lv.cells.filter((c: any) => c.mesh).length, vis: lv.cells.filter((c: any) => c.mesh?.visible).length, cnt: lv.cells.filter((c: any) => c.mesh && c.mesh.count > 0).length })) }); }
    out.push(dbg, (sh as any).extraProviders.length);
    return out;
  }, { zoom, hour, tx: process.env.TX ?? '20' });
  console.log(JSON.stringify(r));
} finally { await br.close(); srv.stop(); }
