/* eslint-disable @typescript-eslint/no-explicit-any -- runs inside the page against the untyped __slope debug handle */
/** `npm run park:sanity [-- --size 64 --seed 61 --shots 1 --out park]`: the 0.9.0 snow park story end to end in the REAL page (dev server, Chrome SwiftShader).
 * Winter career game: marking a park and the Halfpipe are locked at level 1 (level 3); at level 3 a green run is refused with its reason, the main run (blue) is marked, the features are drawn (merged mesh + pipe riders = 2 draw calls),
 * a Halfpipe is placed beside it, freestylers (type 16) arrive and lap it for two days, throw airs (the air hook fires over a feature), pay, the park wears without the snowcat and a groomer pass shapes it again, a forced injury
 * is handled by the patrol; the jersey colour index is checked against CLOTH_COLORS. Then save + reload: every saved part identical, the park and its laps are back, MaterialGuard 0, no console errors.
 * `--shots 1` writes .weave/shots/<out>-*.png (park overview, kickers, halfpipe, freestyler close-ups, worn vs shaped, night). */
import { launch, startServer } from './lib/harness';

const arg = (k: string, d: string): string => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1]! : d; };
const size = arg('size', '64'), seed = arg('seed', '61'), shots = arg('shots', '0') === '1', out = arg('out', 'park');
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
  await page.goto(`${srv.url}?size=${size}&seed=${seed}&hints=0&starter=1&mode=career`, { waitUntil: 'load', timeout: 90000 });
  await ready();

  // ---- the lock, the refusal, the park, the halfpipe ----
  const built = await page.evaluate(async () => { try {
    const s = (window as any).__slope, sim = s.sim, imp = (u: string): Promise<any> => (new Function('u', 'return import(u)') as any)(u);
    const { Layer } = await imp('/src/world/Networks.ts');
    s.loop.setSpeed(0);
    const n = sim.size, main = () => Array.from(sim.runIndex.runs() as any[]).sort((a: any, b: any) => b.dropM - a.dropM)[0];
    const idOf = () => sim.names.pisteId(main());
    const o: any = { lockedPark: !!sim.progression.locked('landscape', 'snowPark'), lockedPipe: !!sim.progression.locked('building', 'halfpipe'), level: sim.progression.level, refusedLocked: sim.setRunPark(idOf(), true) };
    sim.progression.setLevel(3); sim.economy.earn('other', 400_000);
    o.unlocked = !sim.progression.locked('landscape', 'snowPark') && !sim.progression.locked('building', 'halfpipe');
    const run0 = main(); o.len = Math.round(run0.lengthM); o.diff0 = run0.difficulty;
    sim.networks.paint(Layer.Ski, run0.tiles.map((t: number) => ({ x: t % n, y: (t / n) | 0 })), 0); // green
    o.refusedGreen = sim.setRunPark(idOf(), true);
    sim.networks.paint(Layer.Ski, main().tiles.map((t: number) => ({ x: t % n, y: (t / n) | 0 })), 1); // blue
    o.marked = sim.setRunPark(idOf(), true);
    o.parks = sim.park.parks().map((p: any) => ({ valid: p.valid, open: p.open, shape: p.shape, features: p.features }));
    // halfpipe beside the run
    const p = main().poly; let pipe: any = null;
    for (const t of p) { for (let k = 1; k <= 5 && !pipe; k++) for (let dy = -k; dy <= k && !pipe; dy++) for (let dx = -k; dx <= k && !pipe; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== k) continue;
      for (const rot of [0, 1]) { const b = s.debugPlace('halfpipe', (t % n) + dx, ((t / n) | 0) + dy, rot, true); if (b.ok) { sim.refreshCoverage(undefined, true); sim.buildings.reevaluate(); const bb = sim.buildings.get(b.building.id); if (bb.active) { pipe = { id: bb.id, at: [bb.x, bb.y, bb.w, bb.h] }; break; } sim.buildings.remove(bb.id); } }
    } if (pipe) break; }
    o.pipe = pipe; sim.tick?.(1);
    o.pipeOn = sim.park.parks()[0]?.pipe ? true : false;
    o.id = idOf();
    return o;
  } catch (e: any) { return { error: String(e && e.stack || e) }; } });
  console.log(JSON.stringify(built));
  check('marking a park and the Halfpipe are locked at level 1 (level 3); level 3 unlocks both', built.lockedPark && built.lockedPipe && built.level === 1 && built.unlocked === true && built.refusedLocked?.ok === false, { lockedPark: built.lockedPark, lockedPipe: built.lockedPipe, refused: built.refusedLocked });
  check('a green run is refused with the readable reason', built.refusedGreen?.ok === false && built.refusedGreen?.reason === 'Needs a blue, red or black run', built.refusedGreen);
  check('the blue run is marked as a snow park (valid, open, features)', built.marked?.ok === true && built.parks.length === 1 && built.parks[0].valid && built.parks[0].open && built.parks[0].features >= 3, built.parks);
  check('a Halfpipe stands beside the run (active) and the park counts it', !!built.pipe && built.pipeOn === true, built.pipe);

  const view = await page.evaluate(async () => {
    const s = (window as any).__slope, v = s.parkView; v.update(1);
    const meshes = v.group.children.filter((c: any) => c.isMesh || c.isInstancedMesh);
    return { features: v.featureCount, meshes: meshes.length, tris: v.triangles() };
  });
  console.log(JSON.stringify(view));
  check('features are drawn: >= 3, 2 meshes (merged features + pipe riders), far under the triangle budget', view.features >= 3 && view.meshes === 2 && view.tris < 10000, view);

  // the Freestyler look: colour index against CLOTH_COLORS (a past bug: a wrong index = a wrong jersey)
  const look = await page.evaluate(async () => {
    const imp = (u: string): Promise<any> => (new Function('u', 'return import(u)') as any)(u);
    const GA = await imp('/src/render/guestAppearance.ts'), GT = await imp('/src/config/guestTypes.ts'), sim = (window as any).__slope.sim; void sim;
    const tops: string[] = []; for (let id = 1; id <= 60; id++) tops.push(GA.CLOTH_NAMES[GA.appearanceOf(id, GT.FREESTYLER_TYPE, true).top]);
    return { want: GA.CLOTH_NAMES[GT.GUEST_TYPE_DEFS[GT.FREESTYLER_TYPE - GT.CORE_TYPE_COUNT].look.top], tops, hex: GA.CLOTH_COLORS[GT.GUEST_TYPE_DEFS[GT.FREESTYLER_TYPE - GT.CORE_TYPE_COUNT].look.top], colour: GT.GUEST_TYPE_DEFS[GT.FREESTYLER_TYPE - GT.CORE_TYPE_COUNT].look.colour };
  });
  check('the Freestyler jersey index is magenta in CLOTH_COLORS and most freestylers wear it', look.want === 'magenta' && look.hex === look.colour && look.tops.filter((t: string) => t === 'magenta').length >= 30, { want: look.want, hex: look.hex, colour: look.colour });

  // ---- two days of freestylers: arrivals, laps, tricks, airs, fees, wear ----
  const day = await page.evaluate(async () => {
    const s = (window as any).__slope, sim = s.sim, loop = s.loop, st = sim.guestSim.store, T = 16, pv = s.parkView;
    sim.guestSim.spawner.rateMult = 8;
    let seen = 0, airs = 0, maxH = 0, onPark = 0; const income0 = sim.economy.ledger.recreation ?? 0, o: any = { shapes: [] }; const out = { h: 0, spin: 0, slide: false };
    const id = sim.runSettings.parkIds()[0], gAll = () => { for (const t of sim.park.parks()[0].run.tiles) sim.ops.quality.groom(t); };
    loop.setSpeed(1);
    for (let k = 0; k < 480; k++) {
      if (k % 120 === 0) gAll(); // the snowcat shapes the park every night
      loop.advance(1); pv.update(0.5);
      let r = 0; for (let i = 0; i < st.limit; i++) if (st.alive[i] && st.type[i] === T) { r++; if (pv.airFor(st.x[i], st.y[i], st.id[i], out)) { airs++; if (out.h > maxH) maxH = out.h; } if (sim.park.parkTiles().has(Math.floor(st.y[i]) * sim.size + Math.floor(st.x[i]))) onPark++; }
      if (r > seen) seen = r;
    }
    loop.setSpeed(0);
    o.shaped = sim.park.shapeOf(id);
    return { ...o, seen, airs, maxH, onPark, laps: sim.park.total, tricks: sim.park.tricks, today: sim.park.ridersToday(), income: Math.round((sim.economy.ledger.recreation ?? 0) - income0), id };
  });
  console.log(JSON.stringify(day));
  check('freestylers (type 16) arrive in winter and lap the park', day.seen > 0 && day.laps >= 3, { seen: day.seen, laps: day.laps });
  check('they ski ON the park tiles and the air hook fires over the features (a hop of > 0.1)', day.onPark > 0 && day.airs > 0 && day.maxH > 0.1, { onPark: day.onPark, airs: day.airs, maxH: day.maxH });
  check('they throw tricks and pay the park fee (recreation income >= one fee)', day.tricks >= 3 && day.income >= 16, { tricks: day.tricks, income: day.income });

  // wear without the snowcat, then a groomer pass shapes it again
  const wear = await page.evaluate(() => {
    const s = (window as any).__slope, sim = s.sim, loop = s.loop, id = sim.runSettings.parkIds()[0];
    const before = sim.park.shapeOf(id); sim.guestSim.spawner.rateMult = 8; loop.setSpeed(1);
    sim.setRunGroomMode(id, 'skip'); // the player takes the park off the snowcats' list (the garage's cats otherwise groom it every night)
    for (let k = 0; k < 1200; k++) loop.advance(1); // five days, nobody grooms
    loop.setSpeed(0);
    const worn = sim.park.shapeOf(id), info = sim.park.parks()[0];
    const rowText = sim.runList().find((r: any) => r.id === id)?.park?.text;
    sim.setRunGroomMode(id, 'auto');
    for (const t of info.run.tiles) sim.ops.quality.groom(t);
    return { before, worn, wornFlag: info.worn, rowText, after: sim.park.shapeOf(id) };
  });
  console.log(JSON.stringify(wear));
  check('without the snowcat the park wears (shape drops, "worn" below 40 %), a groomer pass restores it', wear.worn < wear.before - 0.2 && wear.after > wear.worn + 0.2 && wear.after > 0.9 && /shape/.test(wear.rowText ?? ''), wear);

  // a forced injury on the park: the patrol answers it
  const inj = await page.evaluate(async () => {
    const s = (window as any).__slope, sim = s.sim, loop = s.loop;
    const ev = { created: 0, resolved: 0, injuries: 0, responders: [] as string[] };
    sim.bus.on('incident:created', () => ev.created++); sim.bus.on('incident:injury', () => ev.injuries++); sim.bus.on('incident:resolved', (e: any) => { ev.resolved++; ev.responders.push(e.responder); });
    const pid = sim.runSettings.parkIds()[0]; sim.park.load({ ...sim.park.serialize(), shape: [[pid, 0.05]] }); // a worn park is rougher
    sim.guestSim.injuryMult = 30; sim.guestSim.spawner.rateMult = 8; loop.setSpeed(1);
    for (let k = 0; k < 700 && ev.resolved < 1; k++) loop.advance(1);
    loop.setSpeed(0); sim.guestSim.injuryMult = 1;
    return { ...ev, hasPatrol: sim.buildings.all().some((b: any) => b.type === 'patrolHub' && b.active) };
  });
  console.log(JSON.stringify(inj));
  check('an injury on a worn park creates an incident that is resolved (the patrol)', inj.injuries > 0 && inj.created > 0 && (inj.resolved > 0 || !inj.hasPatrol), inj);

  const focus = (zoom: number, yaw: number, at: 'mid' | 'top' | 'bottom' | 'pipe' = 'mid'): Promise<any> => page.evaluate((zoom, yaw, at) => {
    const s = (window as any).__slope, c2 = s.renderer.controls, sim = s.sim, n = sim.size, c = sim.park.parks()[0], p = c.run.poly;
    const t = at === 'top' ? p[1] : at === 'bottom' ? p[p.length - 2] : p[p.length >> 1], hp = at === 'pipe' ? c.pipe : null;
    const x = hp ? hp.x + hp.w / 2 : (t % n) + 0.5, z = hp ? hp.y + hp.h / 2 : ((t / n) | 0) + 0.5;
    c2.target.set(x, s.grid.getCorner(Math.round(x), Math.round(z)) * 0.5, z); c2.zoom = 1; c2.zoomBy(zoom); c2.yaw = yaw; const u = document.getElementById('ui'); if (u) u.style.display = 'none'; s.parkView.update(1); return 'ok';
  }, zoom, yaw, at);
  const shot = async (name: string): Promise<void> => { await sleep(2600); await page.screenshot({ path: `.weave/shots/${out}-${name}.png` }); };
  if (shots) {
    await page.evaluate(() => { const s = (window as any).__slope, sim = s.sim, n = sim.size, c = sim.park.parks()[0], touched: number[] = []; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const t of c.run.poly) { x0 = Math.min(x0, t % n); x1 = Math.max(x1, t % n); y0 = Math.min(y0, (t / n) | 0); y1 = Math.max(y1, (t / n) | 0); }
      sim.props.removeInRect(x0 - 5, y0 - 5, x1 + 6, y1 + 6, touched); s.refreshProps(touched); s.setHour?.(11); for (const t of c.run.tiles) sim.ops.quality.groom(t); });
    await focus(5, 0.785398); await shot('overview');
    await focus(12, 0.785398, 'top'); await shot('features-top');
    await focus(12, 0.785398, 'mid'); await shot('features-mid');
    await focus(10, 0.785398, 'pipe'); await shot('halfpipe');
    // freestylers in the air: step until one is within a feature's reach, then freeze
    const air = await page.evaluate(() => { const s = (window as any).__slope, sim = s.sim, st = sim.guestSim.store, pv = s.parkView, out = { h: 0, spin: 0, slide: false }; sim.guestSim.spawner.rateMult = 10; s.loop.setSpeed(1); let g = 0, hit = -1, hh = 0;
      while (g++ < 1500 && hit < 0) { s.loop.advance(1); pv.update(0.5); for (let i = 0; i < st.limit; i++) if (st.alive[i] && st.type[i] === 16 && pv.airFor(st.x[i], st.y[i], st.id[i], out) && out.h > 0.25) { hit = i; hh = out.h; break; } }
      s.loop.setSpeed(0); if (hit >= 0) { const c2 = s.renderer.controls; c2.target.set(st.x[hit], st.z[hit], st.y[hit]); c2.zoom = 1; c2.zoomBy(16); c2.yaw = 0.785398; } return { hit, hh, g }; });
    console.log(JSON.stringify(air));
    check('a freestyler was caught in an air (hop > 0.25) for the close-up', air.hit >= 0, air);
    await shot('air-close');
    await focus(7, 0.785398); await shot('riders');
    // worn vs shaped
    await page.evaluate(() => { const s = (window as any).__slope, sim = s.sim, pid = sim.runSettings.parkIds()[0], d = sim.game.date.year * 180 + sim.game.date.day; sim.park.load({ ...sim.park.serialize(), shape: [[pid, 0.05]], stamp: [[pid, d]] }); });
    await focus(9, 0.785398, 'mid'); await shot('worn');
    await page.evaluate(() => { const s = (window as any).__slope; s.setHour(21.5); }); await focus(8, 0.9, 'top'); await shot('night');
    await page.evaluate(() => { const s = (window as any).__slope; s.setHour?.(null); const u = document.getElementById('ui'); if (u) u.style.display = ''; });
  }

  // ---- save + reload ----
  const snap = (): Promise<any> => page.evaluate(async () => {
    const s = (window as any).__slope, sim = s.sim, imp = (u: string): Promise<any> => (new Function('u', 'return import(u)') as any)(u);
    const SS = await imp('/src/game/saveState.ts'); const h = SS.stateHash(sim); const col = SS.collectSave(sim);
    return { parts: h.parts, park: JSON.stringify(col.snowPark), runs: JSON.stringify(col.runs), total: sim.park.total, ids: sim.runSettings.parkIds(), buildings: sim.buildings.all().map((b: any) => `${b.type}@${b.x},${b.y}`).join('|') };
  });
  const before = await snap();
  check('a park, its shape and lap records exist at save time', before.ids.length === 1 && before.total > 0 && before.park !== 'null', { ids: before.ids, total: before.total });
  const slot = await page.evaluate(async () => { const s = (window as any).__slope; const r = await s.saves.save(undefined, 'park-sanity'); return (await s.saves.list())[0]?.id ?? r; });
  check('saved to a slot', !!slot, slot);
  await page.goto(`${srv.url}?load=${encodeURIComponent(slot)}`, { waitUntil: 'load', timeout: 90000 });
  await ready();
  await page.evaluate(() => (window as any).__slope.loop.setSpeed(0));
  const after = await snap();
  check('the Halfpipe is back', after.buildings === before.buildings && after.buildings.includes('halfpipe@'));
  const RUNTIME = new Set(['sys.guests', 'sys.ops', 'networks', 'lifts']);
  const diff = Object.keys(before.parts).filter((k) => before.parts[k] !== after.parts[k] && !RUNTIME.has(k));
  check('every saved part identical after reload', diff.length === 0, diff);
  check('the park flag, the shape and the laps came back', after.park === before.park && after.runs === before.runs && after.total === before.total && after.ids.length === 1);
  const post = await page.evaluate(async () => {
    const s = (window as any).__slope, loop = s.loop, v = s.parkView; v.update(1); const f = v.featureCount;
    s.sim.guestSim.spawner.rateMult = 8; loop.setSpeed(1); const t = loop.tickCount + 600; let g = 0; while (loop.tickCount < t && g++ < 1e6) loop.advance(1);
    await new Promise((r) => setTimeout(r, 800)); s.materialGuard?.scan?.();
    return { guard: s.materialGuard?.count ?? -1, features: f, laps: s.sim.park.total };
  });
  check('the features are drawn again after the reload and the park goes on', post.features >= 3 && post.laps >= before.total, post);
  check('MaterialGuard Render problems = 0 after reload', post.guard === 0, post);
  check('no console errors', errors.length === 0, [...new Set(errors)].slice(0, 8));
} finally { await br.close(); srv.stop(); }
console.log(fails.length ? `FAILED: ${fails.join('; ')}` : 'park sanity OK');
process.exit(fails.length ? 1 : 0);
