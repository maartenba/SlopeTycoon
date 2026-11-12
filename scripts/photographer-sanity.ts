/* eslint-disable @typescript-eslint/no-explicit-any -- runs inside the page against the untyped __slope debug handle */
/** `npm run photographer:sanity [-- --size 64 --seed 11 --shots 1]`: Photographers (docs/photographers.md) end to end in the REAL page (dev server, Chrome SwiftShader).
 * Summer career game: a hiking trail to a ridge, a Viewpoint on it, a day with a special sunset (found with the sim's own roll, forced on the render side with `__slope.atmos.force`), clear weather,
 * photographers spawned in the late afternoon: they hike to the viewpoint, take their shots (`photo:taken`, the shutter when the camera is near), leave. Then save, reload, every saved part identical,
 * MaterialGuard 0, no console errors. Exit 1 on a failed check. `--shots 1` writes .weave/shots/photog-*.png. */
import { launch, startServer } from './lib/harness';

const arg = (k: string, d: string): string => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1]! : d; };
const size = arg('size', '64'), seed = arg('seed', '11'), shots = arg('shots', '0') === '1';
const srv = await startServer();
const br = await launch();
const errors: string[] = [], fails: string[] = [];
const check = (name: string, ok: boolean, info?: unknown): void => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info === undefined ? '' : ' ' + JSON.stringify(info)}`); if (!ok) fails.push(name); };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
try {
  const page = await br.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`[http ${r.status()}] ${r.url()}`); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${String(e)}`));
  const ready = async (): Promise<void> => { await page.waitForFunction(() => !!(window as any).__slope, { timeout: 90000 }); };
  await page.goto(`${srv.url}?size=${size}&seed=${seed}&start=summer&hints=0&starter=1&mode=career`, { waitUntil: 'load', timeout: 90000 });
  await ready();

  const built = await page.evaluate(async () => {
    const s = (window as any).__slope, sim = s.sim, imp = (u: string): Promise<any> => (new Function('u', 'return import(u)') as any)(u);
    const { Layer } = await imp('/src/world/Networks.ts');
    s.loop.setSpeed(0); sim.progression.bypass++; sim.economy.earn('other', 500_000);
    const n = sim.size, cond = sim.cond, lodge = sim.buildings.all().find((b: any) => b.type === 'baseLodge');
    let amin = Infinity, amax = -Infinity; for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const a = cond.altitude(x, y); amin = Math.min(amin, a); amax = Math.max(amax, a); }
    // cheapest walk from beside the lodge to the highest tile within reach (cost 1 + 6 |dh| a step), painted as a hiking trail
    const dist = new Float64Array(n * n).fill(Infinity), prev = new Int32Array(n * n).fill(-1), open: number[] = [];
    let start = (lodge.y + lodge.h) * n + lodge.x, bd0 = Infinity; for (let t = 0; t < n * n; t++) if (sim.networks.kind[t] === 1) { const d = (t % n - lodge.x) ** 2 + (((t / n) | 0) - lodge.y) ** 2; if (d < bd0) { bd0 = d; start = t; } } // a footpath tile beside the lodge: the trail starts where guests can walk
     dist[start] = 0; open.push(start);
    while (open.length) { let k = 0; for (let i = 1; i < open.length; i++) if (dist[open[i]!]! < dist[open[k]!]!) k = i; const i = open.splice(k, 1)[0]!; const x = i % n, y = (i / n) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) { const nx = x + dx, ny = y + dy; if (nx < 1 || ny < 1 || nx >= n - 1 || ny >= n - 1) continue; const j = ny * n + nx; const t = sim.grid.tileType[sim.grid.tileIndex(nx, ny)]; if (t === 2 || t === 3 || (sim.cond.hikeOk[j] !== 1 && sim.networks.kind[j] !== 1) || (sim.networks.kind[j] !== 1 && sim.grid.occupancy.flags[sim.grid.occupancy.index(nx, ny)] !== 0)) continue; const d = dist[i]! + 1 + 6 * Math.abs(cond.altitude(nx, ny) - cond.altitude(x, y)); if (d < dist[j]! && d < n * 2.2) { dist[j] = d; prev[j] = i; open.push(j); } } }
    let top = start, best = -Infinity; for (let i = 0; i < n * n; i++) if (dist[i]! < Infinity && cond.altitude(i % n, (i / n) | 0) > best) { best = cond.altitude(i % n, (i / n) | 0); top = i; }
    const route: any[] = []; for (let i: number = top; i >= 0; i = prev[i]!) route.push({ x: i % n, y: (i / n) | 0 }); route.reverse();
    const painted = sim.networks.paint(Layer.Hike, route).painted; sim.buildings.reevaluate(); sim.refreshCoverage(undefined, true); sim.openStatus.evaluate();
    s.loop.setSpeed(1); { const t = s.loop.tickCount + 60; let g = 0; while (s.loop.tickCount < t && g++ < 1e6) s.loop.advance(1); } s.loop.setSpeed(0); // the nav graph refreshes on a tick
    const gr = s.guestSim.graph(); let cut = route.findIndex((p: any) => !gr.standable(1, p.y * n + p.x)); if (cut < 0) cut = route.length; void ([cut, JSON.stringify(route[cut]), cut < route.length ? [sim.grid.tileType[sim.grid.tileIndex(route[cut].x, route[cut].y)], sim.grid.occupancy.flags[sim.grid.occupancy.index(route[cut].x, route[cut].y)], sim.cond.hikeOk[route[cut].y * n + route[cut].x], sim.networks.layers[route[cut].y * n + route[cut].x]] : null]); route.length = Math.max(cut, 2); // the trail guests can really walk
    let vp: any = null;
    const cands = route.map((p: any) => p.y * n + p.x).filter((t: number) => { const r = (cond.altitude(t % n, (t / n) | 0) - amin) / (amax - amin); return r > 0.3; }).reverse();
    outer: for (const t of cands) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const o = s.debugPlace('viewpoint', (t % n) + dx, ((t / n) | 0) + dy, 0, true); if (o.ok) { sim.buildings.reevaluate(); if (sim.buildings.get(o.building.id).active) { vp = o.building; break outer; } sim.buildings.remove(o.building.id); sim.refreshCoverage(undefined, true); } }
    sim.progression.bypass--; sim.buildings.reevaluate(); sim.refreshCoverage(undefined, true); sim.openStatus.evaluate();
    (window as any).__trailStart = route[0];
    return { painted, walkable: route.length, vp: vp ? { id: vp.id, x: vp.x, y: vp.y, active: sim.buildings.get(vp.id).active } : null, lodge: { x: lodge.x, y: lodge.y } };
  });
  console.log(JSON.stringify(built));
  check('a hiking trail and a Viewpoint stand', built.painted > 10 && !!built.vp && built.vp.active, built);

  // a day with a special sunset (the sim's own roll), clear weather, late afternoon
  const setup = await page.evaluate(async () => {
    const s = (window as any).__slope, sim = s.sim, imp = (u: string): Promise<any> => (new Function('u', 'return import(u)') as any)(u);
    const { photoDay } = await imp('/src/sim/guests/PhotoLight.ts'), { seasonOf } = await imp('/src/sim/Clock.ts');
    let day = -1, pd: any = null;
    for (let d = 40; d < 80; d++) { const se = seasonOf({ year: sim.game.date.year, day: d }); const p = photoDay(sim.seed, sim.game.date.year * 180 + d, d, se, 'clear'); if (se === 'summer' && p.dusk >= 0.6) { day = d; pd = p; break; } }
    sim.game.date.day = day; sim.game.date.minute = Math.round((pd.sunset - 4.5) * 60);
    sim.weather.current.kind = 'clear'; sim.weather.current.intensity = 0; sim.weather.current.wind = 0.1;
    s.atmos.force({ special: 1 });
    const loop = s.loop, st = s.guestSim.store;
    (window as any).__photos = []; sim.bus.on('photo:taken', (e: any) => (window as any).__photos.push({ ...e }));
    (window as any).__adv = (k: number): void => { const t = loop.tickCount + k; let g = 0; while (loop.tickCount < t && g++ < 1e6) loop.advance(1); };
    for (let k = 0; k < 60 && sim.game.date.minute / 60 < pd.sunset - 2.7; k++) { (window as any).__adv(1); sim.weather.current.kind = 'clear'; sim.weather.current.intensity = 0; } // warm up: the decider refreshes, the clear day is rolled
    const idx = 13;
    const pt = (window as any).__trailStart; // the foot of the new hiking trail
    for (let k = 0; k < 14; k++) st.add({ x: pt.x + 0.5, y: pt.y + 0.5, z: sim.guestSim.world.groundAt(pt.x, pt.y), type: idx, skill: 1, budget: 150, group: 1, mode: 0, overnight: false, leaveDay: 99, tick: sim.game.rng.int(0, 5) });
    return { day, dusk: pd.dusk, sunset: pd.sunset, spawned: 14 };
  });
  console.log(JSON.stringify(setup));
  check('found a special-sunset day', setup.day >= 0, setup);
  let sawShot = false, atShot = 0;
  for (let q = 0; q < 70 && !sawShot; q++) { await page.evaluate(() => { const s = (window as any).__slope; s.loop.setSpeed(1); (window as any).__adv(5); s.sim.weather.current.kind = 'clear'; s.sim.weather.current.intensity = 0; }); sawShot = (await page.evaluate(() => (window as any).__photos.length)) > 0; atShot = q }
  console.log(JSON.stringify(await page.evaluate(() => { const st = (window as any).__slope.guestSim.store, o: any[] = []; for (let i = 0; i < st.limit; i++) if (st.alive[i] && st.type[i] === 13) o.push([st.state[i], st.act[i], st.eve[i], Math.round(st.x[i]), Math.round(st.y[i]), st.timer[i]]); return { o: o.slice(0, 4), min: (window as any).__slope.sim.game.date.minute / 60, ph: (window as any).__slope.guestSim.decider.photoDay }; })));
  const photos = await page.evaluate(() => (window as any).__photos);
  console.log(JSON.stringify({ firstAfterSteps: atShot, n: photos.length, first: photos[0] }));
  check('photographers reached the viewpoint and took photos (photo:taken)', photos.length > 0, photos.length);
  if (photos.length) { check('the light was a special one (q >= 0.6)', photos[0].q >= 0.6, photos[0].q); check('the shots happen at the viewpoint', photos[0].spot === built.vp!.id, photos[0]); }
  if (shots && photos.length) {
    await page.evaluate((p: any) => { const s = (window as any).__slope, c = s.renderer.controls; s.loop.setSpeed(0); s.setHour(s.sim.game.date.minute / 60); c.target.set(p.x, s.grid.heights[Math.floor(p.y) * s.grid.vsize + Math.floor(p.x)] * 0.5, p.y); c.zoom = 1; c.zoomBy(2.6); c.update(); }, photos[0]);
    await sleep(2500); await page.screenshot({ path: '.weave/shots/photog-viewpoint.png' });
  }
  // let the rest finish: everyone leaves again
  await page.evaluate(() => { (window as any).__slope.setHour(null); });
  for (let q = 0; q < 40; q++) await page.evaluate(() => { const s = (window as any).__slope; s.loop.setSpeed(1); (window as any).__adv(10); s.sim.weather.current.kind = 'clear'; });
  const left = await page.evaluate(() => { const st = (window as any).__slope.guestSim.store; let n = 0; for (let i = 0; i < st.limit; i++) if (st.alive[i] && st.type[i] === 13) n++; return n; });
  check('photographers leave again by night', left === 0, left);
  const shutters = await page.evaluate(() => (window as any).__shutters ?? 0);
  console.log(JSON.stringify({ shutterClicksNearCamera: shutters }));

  const snapshot = (): Promise<any> => page.evaluate(async () => {
    const s = (window as any).__slope, imp = (u: string): Promise<any> => (new Function('u', 'return import(u)') as any)(u);
    const SS = await imp('/src/game/saveState.ts'); const h = SS.stateHash(s.sim);
    return { hash: h.hash, parts: h.parts, buzz: s.sim.photoBuzz.serialize() };
  });
  await page.evaluate(() => (window as any).__slope.loop.setSpeed(0));
  const before = await snapshot();
  const slot = await page.evaluate(async () => { const s = (window as any).__slope; const r = await s.saves.save(undefined, 'photog-sanity'); return (await s.saves.list())[0]?.id ?? r; });
  check('saved to a slot', !!slot, slot);
  await page.goto(`${srv.url}?load=${encodeURIComponent(slot)}`, { waitUntil: 'load', timeout: 90000 });
  await ready();
  await page.evaluate(() => (window as any).__slope.loop.setSpeed(0));
  const after = await snapshot();
  const RUNTIME = new Set(['sys.guests', 'sys.ops', 'networks']);
  const diff = Object.keys(before.parts).filter((k) => before.parts[k] !== after.parts[k] && !RUNTIME.has(k));
  check('every saved part identical after reload', diff.length === 0, diff);
  check('the photo buzz survived the reload', JSON.stringify(before.buzz) === JSON.stringify(after.buzz), { before: before.buzz, after: after.buzz });
  const post = await page.evaluate(async () => { const s = (window as any).__slope; s.loop.setSpeed(1); const t = s.loop.tickCount + 2400; let g = 0; while (s.loop.tickCount < t && g++ < 1e6) s.loop.advance(1); await new Promise((r) => setTimeout(r, 800)); s.materialGuard?.scan?.(); return { guard: s.materialGuard?.count ?? -1 }; });
  check('MaterialGuard Render problems = 0 after reload + 1 day', post.guard === 0, post);
  check('no console errors', errors.length === 0, [...new Set(errors)].slice(0, 8));
} finally { await br.close(); srv.stop(); }
console.log(fails.length ? `FAILED: ${fails.join('; ')}` : 'photographer sanity OK');
process.exit(fails.length ? 1 : 0);
