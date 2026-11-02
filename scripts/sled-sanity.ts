/* eslint-disable @typescript-eslint/no-explicit-any -- runs inside the page against the untyped __slope debug handle */
/** `npm run sled:sanity [-- --size 128 --seed 5 --shots 1]`: Phase 7 M7.3 in the REAL page (dev server, Chrome SwiftShader): a Sled Rental is placed through the game's own placement rules (level gate bypassed), a gentle
 * ramp is carved and a Sled run painted from the hut, a winter week runs with guests, and the story is checked: the run is a safe route, sleds were seen on it, the hut served guests and earned money, Sledders arrived,
 * the SledRunView draws the run (one mesh). Then the same for an Alpine Coaster in summer (rail + cars). Then save, reload from the slot, every saved part identical (incl. the painted layers), MaterialGuard 0,
 * no console errors. `--shots 1` also writes .weave/shots/sled-*.png. Exit 1 on any failed check or console error. */
import { launch, startServer } from './lib/harness';

const arg = (k: string, d: string): string => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1]! : d; };
const size = arg('size', '128'), seed = arg('seed', '5'), shots = arg('shots', '0') === '1';
const srv = await startServer();
const br = await launch();
const errors: string[] = [], fails: string[] = [];
const check = (name: string, ok: boolean, info?: unknown): void => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info === undefined ? '' : ' ' + JSON.stringify(info)}`); if (!ok) fails.push(name); };
try {
  const page = await br.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`[http ${r.status()}] ${r.url()}`); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${String(e)}`));
  const ready = async (): Promise<void> => { await page.waitForFunction(() => !!(window as any).__slope, { timeout: 90000 }); };
  await page.goto(`${srv.url}?size=${size}&seed=${seed}&hints=0&starter=1&mode=career`, { waitUntil: 'load', timeout: 90000 });
  await ready();

  /** Place a base through the game's rules near the lodge, carve a gentle ramp away from it and paint the track. */
  const build = (type: string, layer: 'Sled' | 'Coaster', how: 'road' | 'path', step: number, skipAt: Array<{ x: number; y: number }>): Promise<any> => page.evaluate(async (a) => {
    const s = (window as any).__slope, sim = s.sim, g = s.grid, imp = (u: string): Promise<any> => (new Function('u', 'return import(u)') as any)(u);
    const { Bot } = await imp('/src/game/bot.ts'), NK = (await imp('/src/world/Networks.ts')).NetKind, NL = (await imp('/src/world/Networks.ts')).Layer, PB = await imp('/src/sim/PlaceBuilding.ts');
    const out: any = { log: [] as string[] };
    s.loop.setSpeed(0);
    sim.progression.bypass++; sim.economy.earn('other', 9_000_000);
    const bot: any = new Bot(sim, { starter: false });
    const lodge = sim.buildings.all().find((q: any) => q.type === 'baseLodge');
    const ring: Array<{ x: number; y: number }> = [];
    for (let x = lodge.x; x < lodge.x + lodge.w; x++) ring.push({ x, y: lodge.y - 1 }, { x, y: lodge.y + lodge.h });
    for (let y = lodge.y; y < lodge.y + lodge.h; y++) ring.push({ x: lodge.x - 1, y }, { x: lodge.x + lodge.w, y });
    const free = (x: number, y: number): boolean => x >= 2 && y >= 2 && x < g.size - 2 && y < g.size - 2 && g.occupancy.flags[y * g.size + x] === 0 && sim.networks.kind[y * g.size + x] === 0 && sim.networks.layers[y * g.size + x] === 0 && g.tileType[y * g.size + x] === 0;
    let best: any = null, bd = 1e9;
    for (let y = 4; y < g.size - 6; y++) for (let x = 4; x < g.size - 6; x++) {
      if (PB.validatePlacement(sim.env, a.type, x, y, 0, true).reasons.length) continue;
      const d = Math.hypot(x - lodge.x, y - lodge.y); if (d < 14 || d >= bd || a.skip.some((p: any) => Math.hypot(p.x - x, p.y - y) < 18)) continue;
      // needs a free 16-tile corridor leaving one side (checked against the footprint 3x2 / 4x3)
      for (const [vx, vy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as Array<[number, number]>) {
        const w = a.type === 'alpineCoaster' ? 4 : 3, h = a.type === 'alpineCoaster' ? 3 : 2;
        const sx = vx > 0 ? x + w : vx < 0 ? x - 1 : x, sy = vy > 0 ? y + h : vy < 0 ? y - 1 : y;
        let ok = true; for (let j = 0; j < 16 && ok; j++) for (let k = -1; k <= 1 && ok; k++) { const px = vx ? sx + vx * j : sx + k, py = vy ? sy + vy * j : sy + k; if (!free(px, py)) ok = false; }
        if (ok) { bd = d; best = { x, y, vx, vy, sx, sy }; break; }
      }
    }
    if (!best) { out.log.push('no valid site'); sim.progression.bypass--; return out; }
    const o = s.debugPlace(a.type, best.x, best.y, 0, true);
    if (!o.ok) { out.log.push(o.reasons?.join('|')); sim.progression.bypass--; return out; }
    const b = o.building;
    bot.ensure(a.how === 'road' ? NK.Road : NK.Path, b, a.how === 'road' ? [sim.networks.roadEntry] : ring);
    // ramp: the vertex rows across the corridor fall `step` half-steps per tile away from the hut
    const len = 16, base = 12;
    for (let j = 0; j <= len; j++) for (let k = -1; k <= 2; k++) {
      const px = best.vx ? best.sx + best.vx * j + (best.vx < 0 ? 1 : 0) : best.sx + k, py = best.vy ? best.sy + best.vy * j + (best.vy < 0 ? 1 : 0) : best.sy + k;
      g.setCornerUnchecked(px, py, Math.max(0, base + (len - j) * a.step));
    }
    const line = Array.from({ length: len }, (_, j) => ({ x: best.sx + best.vx * j, y: best.sy + best.vy * j }));
    out.painted = sim.networks.paint(NL[a.layer], line).painted;
    sim.buildings.reevaluate(); sim.refreshCoverage(undefined, true);
    s.buildingsView.sync?.(); s.refreshProps(Array.from({ length: g.chunksPerRow ** 2 }, (_, i) => i));
    sim.progression.bypass--;
    out.id = b.id; out.at = { x: b.x, y: b.y, w: b.w, h: b.h }; out.active = b.active; sim.tick(1); out.route = sim.tours.route(b.id).length; out.line = line;
    return out;
  }, { type, layer, how, step, skip: skipAt });

  const hut = await build('sledRental', 'Sled', 'path', 1, []);
  console.log(JSON.stringify({ ...hut, line: undefined }));
  check('sled hut placed and active', !!hut.id && hut.active === true, hut.log);
  check('sled run painted (16 tiles) and routed (8+)', hut.painted === 16 && hut.route >= 8, { painted: hut.painted, route: hut.route });

  const run: any = await page.evaluate(async (id) => {
    const s = (window as any).__slope, sim = s.sim, loop = s.loop;
    const adv = (k: number): void => { const t = loop.tickCount + k; let g = 0; while (loop.tickCount < t && g++ < 1e6) loop.advance(1); };
    loop.setSpeed(1);
    let seen = 0, maxCarriers = 0; const types = new Set<number>();
    sim.bus.on('guest:arrived', (e: any) => { const sl = sim.guestSim.store.slotOf(e.id); if (sl >= 0) types.add(sim.guestSim.store.type[sl]); });
    for (let day = 0; day < 6; day++) {
      if (day % 2 === 0) { s.spawnGuests(120, 'mixed'); s.spawnGuests(80, 'couple'); s.spawnGuests(60, 'family'); }
      for (let q = 0; q < 24; q++) { adv(10); const cs = sim.tours.carriers(sim.game.date.tick).filter((c: any) => c.kind === 'sled'); maxCarriers = Math.max(maxCarriers, cs.length); if (cs.length) seen++; }
    }
    const it = sim.attractions.items.get(id), t = it.info().tour;
    return { seen, maxCarriers, served: it.stats.served, revenue: it.stats.revenue, tour: { closed: t.closed, dep: t.totalDepartures, riders: t.totalRiders, route: t.routeLen, lift: t.liftServed }, sledders: types.has(12), view: { tiles: s.sledRunView.tiles, stakes: s.sledRunView.stakes, tris: s.sledRunView.triangles, meshes: s.sledRunView.group.children.length }, day: sim.game.date.day };
  }, hut.id);
  console.log(JSON.stringify(run));
  check('the run is open (not closed / unsafe) in winter', run.tour.closed === null || run.tour.dep > 0, run.tour);
  check('sleds were seen on the run', run.seen > 0 && run.maxCarriers > 0, { seen: run.seen, max: run.maxCarriers });
  check('the hut served guests and earned money', run.served > 0 && run.revenue > 0, { served: run.served, revenue: run.revenue });
  check('the SledRunView draws the run (one mesh, stakes)', run.view.meshes === 1 && run.view.tiles.sled >= 16 && run.view.stakes >= 4, run.view);
  check('Sledders arrived (type 12)', run.sledders, null);

  if (shots) {
    await page.mouse.click(776, 235).catch(() => undefined);
    const look = async (x: number, y: number, zoom: number, name: string, hour = 12): Promise<void> => {
      await page.evaluate((a) => { const s = (window as any).__slope; s.loop.setSpeed(0); s.setHour?.(a.hour); const k = s.renderer.controls; k.focusOn(a.x, a.y, { zoom: a.zoom, duration: 0 }); k.updateProjection?.(); }, { x, y, zoom, hour });
      await page.evaluate(() => new Promise((r) => setTimeout(r, 2500)));
      await page.screenshot({ path: `.weave/shots/${name}.png` });
    };
    const mid = hut.line[8];
    await look(hut.at.x + 2, hut.at.y + 1, 14, 'sled-hut');
    await look(mid.x, mid.y, 6, 'sled-run2');
    // a departure running
    const ok = await page.evaluate(async () => {
      const s = (window as any).__slope, sim = s.sim, loop = s.loop; loop.setSpeed(1); s.setHour?.(10.2); s.spawnGuests(160, 'mixed');
      let g = 0;
      while (g++ < 500) { const t = loop.tickCount + 5; while (loop.tickCount < t) loop.advance(1); const cs = sim.tours.carriers(sim.game.date.tick).filter((c: any) => c.kind === 'sled'); if (cs.length) { loop.setSpeed(0); const k = s.renderer.controls; k.focusOn(cs[0].x, cs[0].y, { zoom: 5, duration: 0 }); k.updateProjection?.(); return true; } }
      return false;
    });
    check('a sled departure running for a shot', ok);
    await page.evaluate(() => new Promise((r) => setTimeout(r, 1500)));
    await page.screenshot({ path: '.weave/shots/sled-ride2.png' });
  }

  // ---- summer: the alpine coaster ----
  await page.evaluate(async () => { const s = (window as any).__slope; s.loop.setSpeed(0); const { seasonOf } = await (new Function('u', 'return import(u)') as any)('/src/sim/Clock.ts'); let d = 0; while (seasonOf({ day: d }) !== 'summer') d++; (window as any).__summerDay = d + 8; s.sim.game.date.day = d + 8; });
  const co = await build('alpineCoaster', 'Coaster', 'road', 2, [{ x: hut.at.x, y: hut.at.y }]);
  check('coaster station placed and active, rail painted and routed (10+)', !!co.id && co.active === true && co.route >= 10, { log: co.log, route: co.route, painted: co.painted });
  if (co.id) {
    const cr: any = await page.evaluate(async (id) => {
      const s = (window as any).__slope, sim = s.sim, loop = s.loop;
      const adv = (k: number): void => { const t = loop.tickCount + k; let g = 0; while (loop.tickCount < t && g++ < 1e6) loop.advance(1); };
      sim.game.date.day = (window as any).__summerDay; loop.setSpeed(1); let seen = 0;
      for (let day = 0; day < 4; day++) { if (day % 2 === 0) { s.spawnGuests(150, 'mixed'); s.spawnGuests(80, 'adventure'); } for (let q = 0; q < 24; q++) { adv(10); if (sim.tours.carriers(sim.game.date.tick).some((c: any) => c.kind === 'coaster')) seen++; } }
      const it = sim.attractions.items.get(id);
      return { seen, served: it.stats.served, revenue: it.stats.revenue, closed: it.info().tour.closed, rail: s.sledRunView.tiles.coaster, season: sim.game.date.day };
    }, co.id);
    console.log(JSON.stringify(cr));
    check('the coaster served guests in summer, cars were seen, the rail is drawn', cr.served > 0 && cr.seen > 0 && cr.rail >= 10, cr);
    if (shots) {
      await page.evaluate((a) => { const s = (window as any).__slope; s.loop.setSpeed(0); s.setHour?.(12); const k = s.renderer.controls; k.focusOn(a.x, a.y, { zoom: 6, duration: 0 }); k.updateProjection?.(); }, { x: co.line[8].x, y: co.line[8].y });
      await page.evaluate(() => new Promise((r) => setTimeout(r, 2500)));
      await page.screenshot({ path: '.weave/shots/sled-coaster2.png' });
    }
  }

  // ---- save, reload, compare ----
  const snapshot = (): Promise<any> => page.evaluate(async () => {
    const s = (window as any).__slope, sim = s.sim, imp = (u: string): Promise<any> => (new Function('u', 'return import(u)') as any)(u);
    const SS = await imp('/src/game/saveState.ts'); const h = SS.stateHash(sim);
    let sled = 0, coaster = 0; const a = sim.networks.layers; for (let i = 0; i < a.length; i++) { if (a[i] & 16) sled++; if (a[i] & 32) coaster++; }
    return { hash: h.hash, parts: h.parts, sled, coaster, buildings: sim.buildings.all().map((b: any) => b.type).sort().join(','), tick: s.loop.tickCount };
  });
  await page.evaluate(() => (window as any).__slope.loop.setSpeed(0));
  const before = await snapshot();
  const slot = await page.evaluate(async () => { const s = (window as any).__slope; const r = await s.saves.save(undefined, 'sled-sanity'); return (await s.saves.list())[0]?.id ?? r; });
  check('saved to a slot', !!slot, slot);
  await page.goto(`${srv.url}?load=${encodeURIComponent(slot)}`, { waitUntil: 'load', timeout: 90000 });
  await ready();
  await page.evaluate(() => (window as any).__slope.loop.setSpeed(0));
  const after = await snapshot();
  check('buildings restored', after.buildings === before.buildings);
  check('the painted sled run / coaster rail survived the reload', after.sled === before.sled && after.coaster === before.coaster && before.sled >= 16, { before: [before.sled, before.coaster], after: [after.sled, after.coaster] });
  const RUNTIME = new Set(['sys.guests', 'sys.ops', 'networks']); // unsaved guest / lift runtime and the networks render counter (see phase6:sanity)
  const diff = Object.keys(before.parts).filter((k) => before.parts[k] !== after.parts[k] && !RUNTIME.has(k));
  check('every saved part identical after reload', diff.length === 0, diff);
  const post = await page.evaluate(async () => {
    const s = (window as any).__slope, loop = s.loop; loop.setSpeed(1);
    const t = loop.tickCount + 2400; let g = 0; while (loop.tickCount < t && g++ < 1e6) loop.advance(1);
    await new Promise((r) => setTimeout(r, 800)); s.materialGuard?.scan?.();
    return { guard: s.materialGuard?.count ?? -1, meshes: s.sledRunView.group.children.length };
  });
  check('MaterialGuard Render problems = 0 after reload + 1 day, run still drawn', post.guard === 0 && post.meshes === 1, post);
  const real = errors.filter((e) => !/GPU stall|GroupMarkerNotSet|swiftshader/i.test(e));
  check('no console errors', real.length === 0, [...new Set(real)].slice(0, 8));
} finally { await br.close(); srv.stop(); }
console.log(fails.length ? `FAILED: ${fails.join('; ')}` : 'sled sanity OK');
if (fails.length) process.exitCode = 1;
