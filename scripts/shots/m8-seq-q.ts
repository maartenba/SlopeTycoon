/* eslint-disable @typescript-eslint/no-explicit-any -- runs inside the page against the untyped __slope debug handle */
/**
 * Frame sequences for the flicker hunt (docs/graphics-m8.md "weak spots"): `npx vite-node scripts/shots/m8-seq-q.ts -- --scn traffic-day|traffic-night|traffic-winter|cows|farm|junction [--tag a] [--n 60] [--dt 0.0333] [--w 960 --h 540] [--q high]`.
 * Steps the real game with `__slope.frameStep` (virtual clock, deterministic) under a slow camera orbit and writes PNGs to .weave/seq/<tag>/<scn>/fNNN.png; run
 * `scripts/promo/flickerStats.py .weave/seq/<tag>` on the folder. cows: `--dt 0.25 --n 6` is the close cow gallery. Honest: SwiftShader, no GPU numbers.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch, startServer } from '../lib/harness';
const arg = (k: string, d: string): string => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1]! : d; };
const scn = arg('scn', 'traffic-day'), tag = arg('tag', 'x'), N = Number(arg('n', '60')), DT = Number(arg('dt', String(1 / 30))), W = Number(arg('w', '960')), H = Number(arg('h', '540')), Q = arg('q', 'high');
const SPEED = Number(arg('speed', '1')), TRACK = arg('track', '0') === '1';
const PRE = arg('pre', ''), HIDE = arg('hide', ''), STATICN = Number(arg('static', '0'));
const zoomA = Number(arg('zoom', '0')), orbit = Number(arg('orbit', '1'));
const winter = scn.endsWith('winter'), night = scn.endsWith('night'), seed = scn === 'junction' ? 5 : 5;
const dir = `.weave/seq/${tag}/${scn}${STATICN ? '-static' : ''}`; mkdirSync(dir, { recursive: true });
const srv = await startServer(); const br = await launch(); const errors: string[] = [];
try {
  const page = await br.newPage(); await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument((q: string) => { try { localStorage.setItem('slope.quality', q); localStorage.setItem('slope.consent.analytics', 'denied'); } catch { /* blocked */ } }, Q);
  page.on('console', (m) => { if (m.type() === 'error' || /shader|webgl/i.test(m.text())) errors.push(m.text()); if (m.text().includes('[stats]')) console.log(m.text()); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${String(e)}`));
  const start = winter ? 'winter' : 'summer';
  await page.goto(`${srv.url}?size=128&seed=${seed}&start=${start}&hints=0&starter=1&mode=career&stepmode=1`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => !!(window as any).__slope, { timeout: 120000 });
  const setup = await page.evaluate(async (a) => {
    const s = (window as any).__slope, g = s.grid, sim = s.sim, imp = (u: string): Promise<any> => (new Function('u', 'return import(u)') as any)(u);
    const st = document.createElement('style'); st.textContent = '#ui,st-toast{display:none!important}'; document.head.appendChild(st);
    s.loop.setSpeed(0); s.setHour(a.night ? 23 : 12);
    const c = s.renderer.controls; const out: any = {};
    const P = await imp('/src/world/Props.ts');
    const look = (x: number, z: number, zoom: number): void => { c.focusOn(x, z, { zoom, duration: 0 }); c.target.y = P.surfaceHeight(g, x, z); };
    let orbitC = { x: 0, z: 0, y: 0 };
    if (a.scn.startsWith('traffic')) {
      const a0 = s.terrainInfo.villageAnchor, ay = a0.y + 16, ax = a0.x; s.trees.group.visible = false; s.rocks.group.visible = false;
      const mkv = (id: number, kind: number, dir: number, lane: number, pos: number, sp: number, brake: number): any => {
        const x0 = ax - 20, x1 = ax + 20, y = ay + lane; const pts = dir > 0 ? [x0, y, x1, y] : [x1, y, x0, y];
        return { id, kind, mode: 0, pts, cum: [0, 40], dist: pos, speed: sp, riders: [], group: 0, dest: 0, alt: 0, _pos: pos, _sp: sp, _brake: brake, _dir: dir };
      };
      const fake: any[] = [];
      for (let i = 0; i < 18; i++) { const dir = i % 2 ? 1 : -1; fake.push(mkv(11 + i * 17, i % 7 === 3 ? 1 : 0, dir, (i % 2 ? 0.45 : -0.45) + (i % 3) * 0.02, 2 + (i * 2.1) % 36, 0.5 + (i % 4) * 0.12, i % 3 === 0 ? 1 : 0)); }
      const pitch = a.night ? 1 : 1;
      s.vehicleRenderer.vehicles = () => fake;
      Object.defineProperty(s.loop, 'alpha', { get: () => 1, configurable: true });
      out.fake = fake.length; void pitch;
      (window as any).__fake = fake;
      orbitC = { x: ax, z: ay, y: 0 };
      look(ax, ay, a.zoom || 9);
    } else if (a.scn === 'junction') {
      const N = g.size, J: number[][] = [];
      for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) { if (g.tileType[y * N + x] !== 2) continue; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as Array<[number, number]>) if (g.tileType[(y + dy) * N + x + dx] === 6) J.push([x + dx, y + dy]); }
      const t = J[Math.floor(J.length / 2)]!; s.trees.group.visible = false; s.rocks.group.visible = false; orbitC = { x: t[0]! + 0.5, z: t[1]! + 0.5, y: 0 }; look(orbitC.x, orbitC.z, a.zoom || 14); out.j = t;
    } else if (a.scn === 'cowgallery') { // forced cows (+ sheep, goats) at a close zoom, like m8-cows-p.ts
      const a0 = s.terrainInfo.villageAnchor, ap = { x: a0.x + 7, y: a0.y + 19 }; s.trees.group.visible = false; s.rocks.group.visible = false;
      const an = [0, 1, 2].map((i) => ({ id: 3 + i * 5, species: 'cow', x: ap.x + i * 0.9, y: ap.y + (i % 2) * 0.6, heading: 0.5 * i, hidden: false, mode: 2, phase: i })).concat([0, 1].map((i) => ({ id: 40 + i, species: 'sheep', x: ap.x + 0.5 + i * 0.7, y: ap.y + 1.6, heading: 0.3 * i, hidden: false, mode: 2, phase: i })), [0, 1].map((i) => ({ id: 60 + i, species: 'goat', x: ap.x + 2 + i * 0.6, y: ap.y + 1.6, heading: 0.9 + i, hidden: false, mode: 2, phase: i })));
      const orig = s.natureView.update.bind(s.natureView); s.natureView.update = (dt: number, _an: any, _cx: number, _cz: number, vh: number, d: any) => orig(dt, an, ap.x, ap.y, Math.min(vh, 12), d);
      orbitC = { x: ap.x + 1.2, z: ap.y + 0.8, y: 0 }; look(orbitC.x, orbitC.z, a.zoom || 5);
    } else { // cows / farm: place an Alpine Farm like scripts/shots/tractor.ts
      const PB = await imp('/src/sim/PlaceBuilding.ts'), FP = await imp('/src/render/farmWorkPlan.ts');
      sim.progression.bypass++;
      const lodge = sim.buildings.all().find((b: any) => b.type === 'baseLodge'); const w0 = FP.buildWorkWorld(g, sim.buildings.all(), s.props);
      let best: any = null, bs = -1;
      for (let y = 6; y < g.size - 10; y += 2) for (let x = 6; x < g.size - 10; x += 2) {
        if (PB.validatePlacement(sim.env, 'alpineFarm', x, y, 0, true).reasons.length) continue;
        let sc = 0; for (let yy = y - 14; yy < y + 20; yy += 2) for (let xx = x - 14; xx < x + 20; xx += 2) if (xx >= 0 && yy >= 0 && xx < g.size && yy < g.size && FP.patchOk(w0, xx, yy, 1, 0, w0.hgt[(y + 3) * g.size + x + 3])) sc++;
        if (sc > bs && Math.hypot(x - lodge.x, y - lodge.y) > 8) { bs = sc; best = { x, y }; }
      }
      const o = s.debugPlace('alpineFarm', best.x, best.y, 0, true); if (o.ok) { sim.buildings.reevaluate(); sim.refreshCoverage(undefined, true); o.building.active = true; }
      sim.progression.bypass--; s.buildingsView.sync?.(); out.farm = best;
      const farm = sim.buildings.all().find((b: any) => b.type === 'alpineFarm');
      s.loop.setSpeed(1); let n = 0; while (n++ < 400) s.loop.advance(1); s.loop.setSpeed(0);
      s.farmWork.force({ day: 70, hour: 10, at: ['mowA', 'mowB'] });
      orbitC = { x: farm.x + 3, z: farm.y + 3, y: 0 }; look(orbitC.x, orbitC.z, a.zoom || (a.scn === 'cows' ? 12 : 6));
      out.cows = s.natureView.meshes.get('cow')?.count;
      if (a.track) { const tr = s.farmWork.snapshot().find((q: any) => q.onTrip); if (tr) { orbitC = { x: tr.x, z: tr.y, y: 0 }; look(tr.x, tr.y, a.zoom || 8); out.track = tr; } }
    }
    (window as any).__orbit = orbitC;
    return out;
  }, { scn, night, zoom: zoomA, track: TRACK });
  console.log('[stats] setup', JSON.stringify(setup));
  await page.evaluate(async (a) => {
    const s = (window as any).__slope, c = s.renderer.controls, o = (window as any).__orbit, P = await (new Function('u', 'return import(u)') as any)('/src/world/Props.ts');
    const y0 = c.yaw, r = a.scn.startsWith('cow') ? 0.4 : 2; s.frameStepRate = 1;
    s.frameCam = (t: number): void => {
      c.focusTween = null; const k = a.orbit; c.target.set(o.x + Math.sin(t * 0.5) * r * k * 0.5, P.surfaceHeight(s.grid, o.x, o.z), o.z + Math.cos(t * 0.5) * r * k * 0.5); c.yaw = y0 + t * 0.12 * k;
      const f = (window as any).__fake; if (f) for (const v of f) { // synthetic traffic: constant cruise, some slow down at t = 0.4 s steps (tick-like speed steps) and stop for a second
        const base = v._sp; let sp = base;
        if (v._brake) { const ph = (t + v.id * 0.37) % 3.0; sp = ph < 0.8 ? base : ph < 1.6 ? base * 0.55 : ph < 2.2 ? 0 : base * 0.5; sp = Math.round(sp * 20) / 20; }
        v._pos = (v._pos + sp * 0.5 / 30) % 38; v.speed = sp; v.dist = v._pos - sp; // render adds speed * alpha(=1)
      }
    };
    s.frameStep(0.1, 30); // preroll: builds settle and the camera zoom tween lands
    // A/B toggles of the flicker hunt: --hide trees,rocks,buildings,tractors,cows,vehicles  --pre "js" (e.g. __slope.renderer.setShadows(false))
    for (const h of String(a.hide).split(',').filter(Boolean)) {
      const set = (v: boolean): void => { if (h === 'buildings') { for (const b of s.sim.buildings.all()) { const gg = s.buildingsView.get(b.id); if (gg) gg.visible = v; } return; } const m: any = { trees: s.trees.group, rocks: s.rocks.group, cows: s.natureView.group, tractors: s.farmWork.view.group, vehicles: s.vehicleRenderer.group }; if (m[h]) m[h].visible = v; };
      if (h === 'tractors') { for (const o of [s.farmWork.view.group, s.farmWork.view.fx]) Object.defineProperty(o, 'visible', { get: () => false, set: () => undefined }); continue; }
      const prev = s.frameCam; s.frameCam = (t: number) => { prev(t); set(false); };
    }
    if (a.speed > 1) s.loop.setSpeed(a.speed >= 3 ? 2 : 1);
    if (a.track) { const tr = s.farmWork.snapshot().find((q: any) => q.onTrip); if (tr) { const O = (window as any).__orbit; O.x = tr.x + Math.cos(tr.yaw) * 2.5; O.z = tr.y + Math.sin(tr.yaw) * 2.5; c.target.set(O.x, P.surfaceHeight(s.grid, O.x, O.z), O.z); c.focusOn(O.x, O.z, { zoom: a.zoom || 8, duration: 0 }); s.frameStep(0.1, 5); } else console.log('[stats] no tractor on trip'); }
    if (a.pre) (0, eval)(a.pre);
  }, { scn, orbit, hide: HIDE, pre: PRE, speed: SPEED, track: TRACK, zoom: zoomA });
  const snaps: any[] = [];
  for (let i = 0; i < N; i++) {
    await page.evaluate((dt: number, i: number) => { (window as any).__slope.frameStep(i === 0 ? 0 : dt, 1); }, DT, i);
    await page.screenshot({ path: `${dir}/f${String(i).padStart(3, '0')}.png` });
    if (scn === 'farm') snaps.push(await page.evaluate(() => (window as any).__slope.farmWork.snapshot()));
  }
  const info = await page.evaluate(() => { const s = (window as any).__slope, i = s.renderer.webgl.info; return { calls: i.render.calls, tris: i.render.triangles, guard: s.materialGuard.check(), fx: s.vehicleRenderer.fxLayer?.count, vehicles: s.vehicleRenderer.group.children.length, cows: s.natureView.meshes.get('cow')?.count }; });
  console.log('[stats] frame info', JSON.stringify(info));
  await page.evaluate(() => (window as any).__slope.frameStepEnd());
  if (snaps.length) writeFileSync(`${dir}/tractors.json`, JSON.stringify({ dt: DT, speed: SPEED, snaps }));
  console.log('errors', errors.filter((e) => !/GL Driver/.test(e)).slice(0, 6));
} finally { await br.close(); srv.stop(); }
