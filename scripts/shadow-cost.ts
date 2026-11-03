/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate bodies poke the untyped window.__slope debug API */
/* Shadow pass cost (docs/shadows.md "Cost"): High, 128 / seed 5 (default), zoom 3, demo resort + 150 skiers, game speed 1. `rig.measureSync` finishes the GL queue after every pass, so the
 * per-pass ms are real rasteriser times (SwiftShader here: RELATIVE ONLY, no GPU). Prints the average cost of the old (one pass, throttled) and the new (static + dynamic) design and the
 * modelled cost per second at 60 fps. Usage: vite-node scripts/shadow-cost.ts [--secs 20] [--size 128] [--zoom 3] [--hour 16] [--start summer]  (run it from a checkout of either design) */
import { launch, startServer } from './lib/harness';
function parseArgs(): Record<string, string> { const a = process.argv.slice(2), r: Record<string, string> = {}; for (let i = 0; i < a.length; i++) if (a[i]!.startsWith('--')) r[a[i]!.slice(2)] = a[i + 1] && !a[i + 1]!.startsWith('--') ? a[++i]! : '1'; return r; }
const a = parseArgs(), size = Number(a.size ?? 128), zoom = Number(a.zoom ?? 3), hour = Number(a.hour ?? 16), secs = Number(a.secs ?? 20);
const srv = await startServer(), br = await launch();
try {
  const page = await br.newPage();
  await page.setViewport({ width: 960, height: 600, deviceScaleFactor: 1 });
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem('slope.quality', 'high'); } catch { /* none */ } });
  await page.goto(`${srv.url}?${new URLSearchParams({ size: String(size), seed: String(a.seed ?? 5), start: a.start ?? 'summer', hints: '0' })}`, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => !!(window as any).__slope, { timeout: 90000 });
  const r = await page.evaluate(async (o) => {
    const s = (window as any).__slope, r = s.renderer, c = r.controls;
    s.populateDemo('medium'); s.spawnGuests(150, 'skiers');
    const loop = s.loop; if (loop.paused) loop.setSpeed(1);
    const t = loop.tickCount + 1500; let g = 0; while (loop.tickCount < t && g++ < 1e6) loop.advance(1);
    s.setHour(o.hour);
    const b = s.buildings.all().find((q: any) => q.type === 'baseLodge'); if (b) c.target.set(b.x + b.w / 2, 0, b.y + b.h / 2);
    c.zoomBy(o.zoom / c.zoom); loop.setSpeed(1);
    const sh = r.shadows; sh.measureSync = true;
    await new Promise((x) => setTimeout(x, 3000));
    const st = sh.stats, s0 = { p: st.passes, sp: st.staticPasses ?? 0, dp: st.dynPasses ?? 0, tm: st.totalMs, sm: st.staticMsTotal ?? 0, dm: st.dynMsTotal ?? 0, cm: st.copyMsTotal ?? 0 };
    let frames = 0; const orig = r.webgl.render.bind(r.webgl); r.webgl.render = (sc: any, cam: any) => { orig(sc, cam); frames++; };
    const t0 = performance.now(); await new Promise((x) => setTimeout(x, o.secs * 1000));
    const sec = (performance.now() - t0) / 1000;
    const d = { passes: st.passes - s0.p, staticPasses: (st.staticPasses ?? 0) - s0.sp, dynPasses: (st.dynPasses ?? 0) - s0.dp, totalMs: st.totalMs - s0.tm, staticMs: (st.staticMsTotal ?? 0) - s0.sm, dynMs: (st.dynMsTotal ?? 0) - s0.dm, copyMs: (st.copyMsTotal ?? 0) - s0.cm };
    return { sec, frames, ...d, lastStaticTris: st.triangles, lastStaticCalls: st.calls, dynCalls: st.dynCalls, dynTris: st.dynTriangles, half: st.half, mem: st.memMB, density: st.density, dynRoots: st.dynRoots };
  }, { hour, zoom, secs });
  console.log(JSON.stringify(r));
  if (r.staticPasses !== undefined && r.staticPasses + r.dynPasses === r.passes && r.dynPasses > 0) {
    const sMs = r.staticMs / Math.max(1, r.staticPasses), dMs = r.dynMs / Math.max(1, r.dynPasses), cMs = r.copyMs / Math.max(1, r.dynPasses);
    console.log(`NEW: static ${sMs.toFixed(1)} ms/pass (${r.lastStaticCalls} calls ${(r.lastStaticTris / 1e3).toFixed(0)}k tris), dynamic ${dMs.toFixed(1)} ms/frame (incl. GPU copy ${cMs.toFixed(1)} ms; ${r.dynCalls} calls ${r.dynTris} tris), sun-step static rate at 1x ~ 9.6 Hz: modelled per second at 60 fps = ${(9.6 * sMs + 60 * dMs).toFixed(0)} ms`);
  } else console.log(`OLD: ${(r.totalMs / Math.max(1, r.passes)).toFixed(1)} ms/pass (${r.lastStaticCalls} calls ${(r.lastStaticTris / 1e3).toFixed(0)}k tris); modelled per second at 60 fps (10 Hz) = ${(10 * r.totalMs / Math.max(1, r.passes)).toFixed(0)} ms`);
  console.log('errors:', errs.slice(0, 3));
} finally { await br.close(); srv.stop(); }
