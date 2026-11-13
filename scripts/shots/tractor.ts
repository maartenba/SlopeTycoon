/* eslint-disable @typescript-eslint/no-explicit-any -- runs inside the page against the untyped __slope debug handle */
/** `npx vite-node scripts/shots/tractor.ts -- [--q med] [--atmos high] [--tag a] [--size 64] [--seed 5]`: real-page screenshots of the summer farm tractors (docs/farm-work.md): a farm is placed
 * through the game's placement rules, the QA hook `__slope.farmWork.force` puts the tractors mid-trip (row, bales, load), and shots are taken at iso zoom 5-6 and close, printing draw calls /
 * triangles / MaterialGuard. Files: .weave/shots/tractor-<tag>-*.png (new tag every run: the image reader caches by path). Honest: SwiftShader, no GPU numbers. */
import { launch, startServer } from '../lib/harness';

const arg = (k: string, d: string): string => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1]! : d; };
const size = arg('size', '64'), seed = arg('seed', '5'), q = arg('q', 'med'), atmos = arg('atmos', 'high'), tag = arg('tag', 'x'), hour = Number(arg('hour', '10')), only = arg('only', '');
const srv = await startServer();
const br = await launch();
const errors: string[] = [];
try {
  const page = await br.newPage();
  await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument((quality: string) => { try { localStorage.setItem('slope.quality', quality); } catch { /* blocked */ } }, q);
  page.on('console', (m) => { if (m.type() === 'error' || /shader|webgl/i.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${String(e)}`));
  await page.goto(`${srv.url}?size=${size}&seed=${seed}&start=summer&hints=0&starter=1&mode=career`, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => !!(window as any).__slope, { timeout: 90000 });
  const placed = await page.evaluate(async (a) => {
    const s = (window as any).__slope, sim = s.sim, g = s.grid, imp = (u: string): Promise<any> => (new Function('u', 'return import(u)') as any)(u);
    const PB = await imp('/src/sim/PlaceBuilding.ts');
    s.loop.setSpeed(0); sim.progression.bypass++;
    s.atmos.level(a.atmos);
    const FP = await imp('/src/render/farmWorkPlan.ts');
    const lodge = sim.buildings.all().find((b: any) => b.type === 'baseLodge');
    const w0 = FP.buildWorkWorld(g, sim.buildings.all(), s.props);
    let best: any = null, bs = -1;
    for (let y = 6; y < g.size - 10; y += 2) for (let x = 6; x < g.size - 10; x += 2) {
      if (PB.validatePlacement(sim.env, 'alpineFarm', x, y, 0, true).reasons.length) continue;
      let sc = 0; for (let yy = y - 14; yy < y + 20; yy += 2) for (let xx = x - 14; xx < x + 20; xx += 2) if (xx >= 0 && yy >= 0 && xx < g.size && yy < g.size && FP.patchOk(w0, xx, yy, 1, 0, w0.hgt[(y + 3) * g.size + x + 3])) sc++;
      if (sc > bs && Math.hypot(x - lodge.x, y - lodge.y) > 8) { bs = sc; best = { x, y, sc }; }
    }
    const out: any = { site: best };
    if (best) { const o = s.debugPlace('alpineFarm', best.x, best.y, 0, true); out.ok = o.ok; out.reasons = o.reasons; if (o.ok) { sim.buildings.reevaluate(); sim.refreshCoverage(undefined, true); o.building.active = true; } }
    sim.progression.bypass--;
    s.buildingsView.sync?.();
    out.farm = sim.buildings.all().filter((b: any) => b.type === 'alpineFarm' && b.x === out.site.x).map((b: any) => ({ id: b.id, x: b.x, y: b.y, w: b.w, h: b.h, active: b.active }));
    return out;
  }, { atmos });
  console.log('placed', JSON.stringify(placed));
  if (!placed.ok) throw new Error('farm not placed');
  const f = placed.farm[0];
  const cam = async (zoom: number, tx: number, tz: number, yaw: number): Promise<void> => { await page.evaluate(async (a) => { const s = (window as any).__slope, c = s.renderer.controls, P = await (new Function('u', 'return import(u)') as any)('/src/world/Props.ts'); c.focusOn(a.tx, a.tz, { zoom: a.zoom, duration: 0 }); c.target.y = P.surfaceHeight(s.grid, a.tx, a.tz); c.yaw = a.yaw; }, { zoom, tx, tz, yaw }); };
  const settle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  await page.evaluate((h) => { (window as any).__slope.setHour(h); }, hour);
  const stats = async (label: string): Promise<void> => { const r = await page.evaluate((fid: number) => { const s = (window as any).__slope, i = s.renderer.webgl.info; return { calls: i.render.calls, tris: i.render.triangles, farm: s.farmWork.stats(), snap: s.farmWork.snapshot().filter((t: any) => t.farm === fid).map((t: any) => ({ i: t.idx, x: +t.x.toFixed(1), y: +t.y.toFixed(1), load: +t.load.toFixed(2), trip: t.onTrip, p: +t.presence.toFixed(2) })), guard: s.materialGuard.summary(), zoom: s.renderer.controls.zoom, tgt: [s.renderer.controls.target.x, s.renderer.controls.target.z] }; }, f.id); console.log(label, JSON.stringify(r)); };
  // baseline draw calls without tractors (force a winter day: zero tractors)
  await cam(5, f.x + 3, f.y + 3, 0.6);
  await page.evaluate(() => (window as any).__slope.farmWork.force({ day: 20, hour: 10 })); // 20 = mid winter (sim day 0 = 1 April)
  await settle(1500); await stats('winter (none)');
  const shotDefs: Array<[string, number, number, number, number, any]> = [
    ['iso5', 5, 3, 3, 0.6, { at: ['mowA', 'mowB'] }],
    ['iso6', 6, 3, 3, 2.2, { at: ['mowB', 'home'] }],
    ['close', 14, 0, 0, 0.7, { at: ['mowB', 'gate'] }],
    ['park', 10, 3, 3, 0.4, { at: ['unload', 'unload'] }],
  ];
  for (const [name, zoom, ox, oz, yaw, force] of shotDefs) {
    if (only && !only.split(',').includes(name)) continue;
    await page.evaluate((o) => { const fw = (window as any).__slope.farmWork; fw.force(null); fw.force({ day: 70, hour: 10, ...o }); }, force); // day 70 = mid June
    await settle(2500);
    const snap = await page.evaluate(() => (window as any).__slope.farmWork.snapshot());
    const mine = snap.filter((q: any) => q.farm === f.id), t = mine[0];
    const cx = name === 'close' && t ? t.x : mine.reduce((a: number, q: any) => a + q.x, 0) / Math.max(1, mine.length) + ox * 0, cz = name === 'close' && t ? t.y : mine.reduce((a: number, q: any) => a + q.y, 0) / Math.max(1, mine.length) + oz * 0;
    await cam(zoom, cx, cz, yaw); await settle(1200);
    await stats(name);
    await page.screenshot({ path: `.weave/shots/tractor-${tag}-${q}-${atmos}-${name}.png` });
  }
  // draw-call / triangle delta of the farm layers in the same frame: freeze the view's update, read the counts with and without its groups visible
  await page.evaluate(() => { const fw = (window as any).__slope.farmWork.view; fw.force({ day: 70, hour: 10, at: ['mowA', 'mowB'] }); });
  await settle(2500);
  const info = (): Promise<{ calls: number; tris: number }> => page.evaluate(() => new Promise<{ calls: number; tris: number }>((res) => requestAnimationFrame(() => requestAnimationFrame(() => { const i = (window as any).__slope.renderer.webgl.info.render; res({ calls: i.calls, tris: i.triangles }); }))));
  const on = await info();
  await page.evaluate(() => { const fw = (window as any).__slope.farmWork.view; fw.update = () => {}; fw.group.visible = false; fw.fx.visible = false; });
  await settle(800);
  const offI = await info();
  console.log('layers: with', JSON.stringify(on), 'without', JSON.stringify(offI), 'delta calls', on.calls - offI.calls, 'delta tris', on.tris - offI.tris);
  console.log('errors', errors.length, errors.slice(0, 5).join(' | '));
} finally { await br.close(); srv.stop(); }
