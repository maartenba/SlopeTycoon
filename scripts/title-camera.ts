/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate bodies poke the untyped window.__slope debug API */
/* Title-screen camera smoothness (docs/flicker.md "Title camera"): boots the live title demo on the chosen quality in the SwiftShader harness and logs, for every
 * game frame over N seconds, dt, the camera pose actually rendered (position, look target, yaw, zoom) and whether a static shadow pass ran. Reports the jerk of the
 * SCREEN-SPACE motion of the look target and of a ground point (velocity change per frame, normalised by dt so it is frame-rate independent), the worst
 * frame, the dt spikes and the static passes. Relative numbers only (SwiftShader fps is low).
 * Usage: vite-node scripts/title-camera.ts [--secs 30] [--quality high|med|low] [--demosize 64] [--tag x] [--fixed 1 (fixed dt 1/60, virtual time: isolates the path from frame time)] */
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch, startServer } from './lib/harness';

const a: Record<string, string> = {};
{ const v = process.argv.slice(2); for (let i = 0; i < v.length; i++) if (v[i]!.startsWith('--')) a[v[i]!.slice(2)] = v[i + 1] && !v[i + 1]!.startsWith('--') ? v[++i]! : '1'; }
const secs = Number(a.secs ?? 30), quality = a.quality ?? 'high', tag = a.tag ?? 'run', fixed = !!a.fixed;
const srv = await startServer(), br = await launch();
try {
  const page = await br.newPage();
  await page.setViewport({ width: Number(a.w ?? 640), height: Number(a.h ?? 400), deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument((q: string) => { try { localStorage.setItem('slope.quality', q); } catch { /* none */ } }, quality);
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
  await page.goto(`${srv.url}?demoscene=1&nomenu=1&demosize=${a.demosize ?? 64}${a.seed ? `&demoseed=${a.seed}` : ''}`, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => !!(window as any).__slope?.demo, { timeout: 120000 });
  await new Promise((r) => setTimeout(r, 3000));
  const log: any[] = await page.evaluate((cfg: { secs: number; fixed: boolean; fdt: number }) => new Promise<any[]>((resolve) => {
    const s = (window as any).__slope, r = s.renderer, rows: any[] = [];
    const st = r.shadows.stats;
    const prev = r.onFrame;
    let t0 = -1, last = performance.now(), vt = 0, sp = st.staticPasses ?? 0;
    r.onFrame = (dtReal: number): void => {
      const now = performance.now();
      const dt = cfg.fixed ? cfg.fdt : dtReal;
      prev?.(dt);
      vt += dt;
      if (t0 < 0) t0 = vt;
      const c = r.controls, cam = r.camera, k = st.staticPasses ?? 0;
      rows.push({ t: vt - t0, dt, wall: (now - last) / 1000, x: c.target.x, y: c.target.y, z: c.target.z, yaw: c.yaw, zoom: c.zoom, cx: cam.position.x, cy: cam.position.y, cz: cam.position.z, sp: k - sp, kind: s.demo?.camera?.current()?.kind });
      sp = k; last = now;
      if (vt - t0 >= cfg.secs) { r.onFrame = prev; resolve(rows); }
    };
  }), { secs, fixed, fdt: Number(a.dt ?? 1 / 30) });
  // screen-space of the look target (orthographic: centre) is constant, so measure a fixed WORLD point instead: the ground point under the view centre is the target itself; use
  // the projected position of the target relative to the previous frame's pose = the apparent camera velocity. Jerk = change of per-second velocity between frames.
  const shadowWhy = await page.evaluate(() => ({ ...(window as any).__slope.renderer.shadows.stats.why })), shadowStaticMs = await page.evaluate(() => { const st = (window as any).__slope.renderer.shadows.stats; return st.staticMsTotal / Math.max(1, st.staticPasses); });
  const V = (i: number): number[] => { const p = log[i - 1], q = log[i], dt = Math.max(1e-4, q.dt); return [(q.cx - p.cx) / dt, (q.cy - p.cy) / dt, (q.cz - p.cz) / dt, (q.yaw - p.yaw) / dt, (q.zoom - p.zoom) / dt, (q.y - p.y) / dt]; };
  const names = ['cam.x', 'cam.y', 'cam.z', 'yaw', 'zoom', 'target.y'];
  const acc: number[][] = [];
  for (let i = 2; i < log.length; i++) { const v0 = V(i - 1), v1 = V(i), dt = Math.max(1e-4, log[i].dt); acc.push(v1.map((v, j) => (v - v0[j]!) / dt)); }
  const stats = names.map((n, j) => { const xs = acc.map((r) => Math.abs(r[j]!)).sort((p, q) => p - q); const m = (xs[Math.floor(xs.length / 2)] ?? 0); return { n, med: m, p99: xs[Math.floor(xs.length * 0.99)] ?? 0, max: xs[xs.length - 1] ?? 0 }; });
  const dts = log.map((r) => r.wall).sort((p, q) => p - q);
  const out = { tag, quality, fixed, frames: log.length, secs: log[log.length - 1].t, dtMedian: dts[Math.floor(dts.length / 2)], dtP99: dts[Math.floor(dts.length * 0.99)], dtMax: dts[dts.length - 1], staticPasses: log.reduce((s, r) => s + r.sp, 0), why: shadowWhy, staticMsAvg: shadowStaticMs, staticFrames: log.filter((r) => r.sp > 0).length, maxRun: (() => { let m = 0, c = 0; for (const r of log) { c = r.sp > 0 ? c + 1 : 0; m = Math.max(m, c); } return m; })(), accel: stats, shots: Array.from(new Set(log.map((r) => r.kind))) };
  console.log(JSON.stringify(out, null, 1));
  mkdirSync('.weave/shots', { recursive: true });
  writeFileSync(`.weave/shots/title-camera-${tag}.json`, JSON.stringify({ out, log }));
} finally { await br.close(); srv.stop(); }
