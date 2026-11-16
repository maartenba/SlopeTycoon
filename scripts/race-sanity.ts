/* eslint-disable @typescript-eslint/no-explicit-any -- runs inside the page against the untyped __slope debug handle */
/** `npm run race:sanity [-- --size 64 --seed 61 --shots 1 --out race]`: the 0.8.0 race course story end to end in the REAL page (dev server, Chrome SwiftShader).
 * Winter career game: the Start / Timing Hut are locked at level 1 (unlock at level 3); at level 3 the main run is repainted red, the course is refused (no huts, then no Timing Hut) with readable reasons,
 * both huts are placed beside the ends of the run (active), the run is marked as a course (gates drawn: 2 instanced meshes + 1 board = 3 draw calls), groomed, racers (the Racer guest type) arrive and lap the
 * course for two days, pay the course fee, the timing board shows a best time. Then save in the middle of the training, reload: every saved part identical, the course + the racers' laps are back, the gates
 * are drawn again, MaterialGuard 0, no console errors. Exit 1 on a failed check or console error. `--shots 1` writes .weave/shots/<out>-*.png (course overview, start hut, finish + board, racers on the run, night). */
import { launch, startServer } from './lib/harness';

const arg = (k: string, d: string): string => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1]! : d; };
const size = arg('size', '64'), seed = arg('seed', '61'), shots = arg('shots', '0') === '1', out = arg('out', 'race');
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

  // ---- the lock, the refusals, the huts ----
  const built = await page.evaluate(async () => { try {
    const s = (window as any).__slope, sim = s.sim, imp = (u: string): Promise<any> => (new Function('u', 'return import(u)') as any)(u);
    const { Layer } = await imp('/src/world/Networks.ts');
    s.loop.setSpeed(0);
    const o: any = { lockedStart: !!sim.progression.locked('building', 'startHut'), lockedTiming: !!sim.progression.locked('building', 'timingHut'), levelBefore: sim.progression.level };
    sim.progression.setLevel(3); sim.economy.earn('other', 400_000); // (the debug hook: as if earned, fires the normal level-up)
    o.unlocked = !sim.progression.locked('building', 'startHut') && !sim.progression.locked('building', 'timingHut');
    const n = sim.size, main = () => Array.from(sim.runIndex.runs() as any[]).sort((a: any, b: any) => b.dropM - a.dropM)[0];
    const run0 = main();
    o.blueFirst = run0.difficulty; o.dropM = Math.round(run0.dropM);
    const idOf = () => sim.names.pisteId(main());
    o.refusedBlue = sim.setRunCourse(idOf(), true);
    sim.networks.paint(Layer.Ski, run0.tiles.map((t: number) => ({ x: t % n, y: (t / n) | 0 })), 2); // red
    const r = main(); o.red = r.difficulty;
    o.refusedNoStart = sim.setRunCourse(idOf(), true);
    const put = (type: string, tiles: number[]): any => {
      for (const t of tiles) for (let k = 1; k <= 3; k++) for (let dy = -k; dy <= k; dy++) for (let dx = -k; dx <= k; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== k) continue;
        const b = s.debugPlace(type, (t % n) + dx, ((t / n) | 0) + dy, 0, true);
        if (b.ok) return sim.buildings.get(b.building.id);
      }
      return null;
    };
    const p = r.poly;
    const sh = put('startHut', [p[1], p[0], p[2]]);
    o.refusedNoTiming = sim.setRunCourse(idOf(), true);
    const th = put('timingHut', [p[p.length - 2], p[p.length - 1], p[p.length - 3]]);
    sim.refreshCoverage(undefined, true); sim.buildings.reevaluate();
    o.start = sh ? { id: sh.id, active: sh.active, reason: sh.reason, at: [sh.x, sh.y] } : null; o.timing = th ? { id: th.id, active: th.active, reason: th.reason, at: [th.x, th.y, th.w, th.h, th.rot] } : null;
    o.marked = sim.setRunCourse(idOf(), true);
    o.runId = idOf(); o.top = [p[0] % n, (p[0] / n) | 0]; o.bottom = [p[p.length - 1] % n, (p[p.length - 1] / n) | 0];
    o.courses = sim.race.courses().map((c: any) => ({ id: c.id, valid: c.valid, open: c.open, quality: c.quality, reason: c.reason }));
    return o;
  } catch (e: any) { return { error: String(e && e.stack || e) }; } });
  console.log(JSON.stringify(built));
  check('the Start Hut and the Timing Hut are locked at level 1 (unlock at level 3)', built.lockedStart && built.lockedTiming && built.levelBefore === 1, { lockedStart: built.lockedStart, lockedTiming: built.lockedTiming, level: built.levelBefore });
  check('level 3 unlocks both huts', built.unlocked === true);
  check('a blue run is refused with the readable reason', built.refusedBlue?.ok === false && built.refusedBlue?.reason === 'Needs a red or black run', built.refusedBlue);
  check('a red run without huts is refused (Start Hut, then Timing Hut)', built.refusedNoStart?.reason === 'Needs a Start Hut at the top' && built.refusedNoTiming?.reason === 'Needs a Timing Hut at the foot', { a: built.refusedNoStart, b: built.refusedNoTiming });
  check('both huts stand beside the run ends and are active', !!built.start?.active && !!built.timing?.active, { start: built.start, timing: built.timing });
  check('the run is marked as a race course (valid + open)', built.marked?.ok === true && built.courses.length === 1 && built.courses[0].valid && built.courses[0].open, built.courses);

  // ---- gates drawn, budget ----
  const view = await page.evaluate(async () => {
    const s = (window as any).__slope, v = s.raceCourseView; v.update(1);
    const meshes = v.group.children.filter((c: any) => c.isMesh);
    return { gates: v.gateCount, boards: v.boardCount, meshes: meshes.length, tris: v.triangles(), guard: s.materialGuard?.count ?? -1 };
  });
  console.log(JSON.stringify(view));
  check('gates are drawn: >= 5 gates, 3 meshes (2 instanced + 1 board), well under the triangle budget', view.gates >= 5 && view.meshes === 3 && view.boards === 1 && view.tris < 8000, view);

  // ---- racers train for two days ----
  const day = await page.evaluate(async () => {
    const s = (window as any).__slope, sim = s.sim, loop = s.loop;
    const RT = 14; // the Racer type index
    sim.guestSim.spawner.rateMult = 8;
    const st = sim.guestSim.store;
    let seen = 0, firstSeenTick = -1, bestSeen: any = null, best: any = null, onCourse = 0; const income0 = sim.economy.ledger.recreation ?? 0;
    const racers = (): number => { let n = 0; for (let i = 0; i < st.limit; i++) if (st.alive[i] && st.type[i] === RT) n++; return n; };
    loop.setSpeed(1);
    for (let k = 0; k < 480; k++) {
      if (k % 120 === 0) sim.runSettings.noteGroomed(sim.race.courses()[0].id, sim.game.date.year * 180 + sim.game.date.day); // the snowcat grooms it every night
      loop.advance(1); { const b = sim.race.bestMs(sim.race.courses()[0].id); if (b !== null && (bestSeen === null || b < bestSeen)) bestSeen = b; } const r = racers(); if (r > seen) seen = r; if (r > 0 && firstSeenTick < 0) firstSeenTick = k;
      if (k % 10 === 0) { let c = 0; for (let i = 0; i < st.limit; i++) if (st.alive[i] && st.type[i] === RT && sim.race.courseTiles().has(Math.floor(st.y[i]) * sim.size + Math.floor(st.x[i]))) c++; if (c > onCourse) onCourse = c; }
    }
    loop.setSpeed(0);
    const c = sim.race.courses()[0]; best = bestSeen;
    return { seen, laps: sim.race.total, income: Math.round((sim.economy.ledger.recreation ?? 0) - income0), best, racersToday: sim.race.racersToday(), onCourse, courseOpen: c.open, quality: c.quality };
  });
  console.log(JSON.stringify(day));
  check('racers arrive in winter (the Racer type, index 14) and lap the course', day.seen > 0 && day.laps >= 3, { seen: day.seen, laps: day.laps });
  check('racers pay the course fee (recreation income >= one fee)', day.income >= 20, day.income);
  check('racers were seen skiing ON the course tiles', day.onCourse > 0, day.onCourse);
  check('the timing board has a best time', typeof day.best === 'number' && day.best > 20000 && day.best < 200000, day.best);

  if (shots) {
    const focusRun = (zoom: number, yaw: number, at: 'mid' | 'top' | 'bottom' | 'start' | 'finish' = 'mid', dx = 0, dy = 0): Promise<any> => page.evaluate((zoom, yaw, at, dx, dy) => {
      const s = (window as any).__slope, c2 = s.renderer.controls, sim = s.sim, n = sim.size, c = sim.race.courses()[0], p = c.run.poly;
      const t = at === 'top' ? p[0] : at === 'bottom' ? p[p.length - 1] : p[p.length >> 1], hut = at === 'start' ? c.start : at === 'finish' ? c.timing : null;
      const x = (hut ? hut.x + hut.w / 2 : (t % n) + 0.5) + dx, z = (hut ? hut.y + hut.h / 2 : ((t / n) | 0) + 0.5) + dy;
      c2.target.set(x, s.grid.getCorner(Math.round(x), Math.round(z)) * 0.5, z); c2.zoom = 1; c2.zoomBy(zoom); c2.yaw = yaw; const u = document.getElementById('ui'); if (u) u.style.display = 'none'; s.raceCourseView.update(1); return 'ok';
    }, zoom, yaw, at, dx, dy);
    const shot = async (name: string): Promise<void> => { await sleep(2600); await page.screenshot({ path: `.weave/shots/${out}-${name}.png` }); };
    await page.evaluate(() => { // fell the trees around the course so the gates and huts read (the shots only; saved + reloaded consistently afterwards)
      const s = (window as any).__slope, sim = s.sim, n = sim.size, c = sim.race.courses()[0], touched: number[] = [];
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const t of c.run.poly) { x0 = Math.min(x0, t % n); x1 = Math.max(x1, t % n); y0 = Math.min(y0, (t / n) | 0); y1 = Math.max(y1, (t / n) | 0); }
      sim.props.removeInRect(x0 - 5, y0 - 5, x1 + 6, y1 + 6, touched); s.refreshProps(touched); s.setHour?.(11);
    });
    await focusRun(5, 0.785398); await shot('course');
    await focusRun(12, 0.785398, 'start'); await shot('start-hut');
    await focusRun(12, 0.785398, 'finish'); await shot('finish-board');
    await focusRun(20, 0, 'finish', 0, 0); await shot('board-a');
    await focusRun(20, 3.14159, 'finish', 0, 0); await shot('board-b');
    // racers on the run: step until at least two racers ski on the course, then freeze
    await page.evaluate(() => { const s = (window as any).__slope, sim = s.sim, st = sim.guestSim.store; s.loop.setSpeed(1); let g = 0, hit = 0; while (g++ < 1200 && hit < 2) { s.loop.advance(1); hit = 0; for (let i = 0; i < st.limit; i++) if (st.alive[i] && st.type[i] === 14 && sim.race.courseTiles().has(Math.floor(st.y[i]) * sim.size + Math.floor(st.x[i]))) hit++; } s.loop.setSpeed(0); (window as any).__hit = hit; });
    await focusRun(7, 0.785398); await shot('racers');
    await page.evaluate(() => { (window as any).__slope.setHour(21.5); }); await focusRun(8, 0.9, 'bottom'); await shot('night');
    await page.evaluate(() => { const s = (window as any).__slope; s.setHour?.(null); const u = document.getElementById('ui'); if (u) u.style.display = ''; });
  }

  // ---- save in the middle of the training, reload, compare ----
  const snapshot = (): Promise<any> => page.evaluate(async () => {
    const s = (window as any).__slope, sim = s.sim, imp = (u: string): Promise<any> => (new Function('u', 'return import(u)') as any)(u);
    const SS = await imp('/src/game/saveState.ts'); const h = SS.stateHash(sim); const col = SS.collectSave(sim);
    return { hash: h.hash, parts: h.parts, race: JSON.stringify(col.raceCourse), runs: JSON.stringify(col.runs), total: sim.race.total, courses: sim.runSettings.courseIds(), buildings: sim.buildings.all().map((b: any) => `${b.type}@${b.x},${b.y}`).join('|') };
  });
  await page.evaluate(() => { const s = (window as any).__slope; s.loop.setSpeed(1); for (let k = 0; k < 40; k++) s.loop.advance(1); s.loop.setSpeed(0); });
  const before = await snapshot();
  check('a course and lap records exist at save time', before.courses.length === 1 && before.total > 0 && before.race !== 'null', { courses: before.courses, total: before.total });
  const slot = await page.evaluate(async () => { const s = (window as any).__slope; const r = await s.saves.save(undefined, 'race-sanity'); return (await s.saves.list())[0]?.id ?? r; });
  check('saved to a slot', !!slot, slot);
  await page.goto(`${srv.url}?load=${encodeURIComponent(slot)}`, { waitUntil: 'load', timeout: 90000 });
  await ready();
  await page.evaluate(() => (window as any).__slope.loop.setSpeed(0));
  const after = await snapshot();
  check('buildings restored (both huts are back)', after.buildings === before.buildings && after.buildings.includes('startHut@') && after.buildings.includes('timingHut@'));
  const RUNTIME = new Set(['sys.guests', 'sys.ops', 'networks', 'lifts']);
  const diff = Object.keys(before.parts).filter((k) => before.parts[k] !== after.parts[k] && !RUNTIME.has(k));
  check('every saved part identical after reload', diff.length === 0, diff);
  check('the course flag and the racers\' laps came back', after.race === before.race && after.runs === before.runs && after.total === before.total && after.courses.length === 1, { race: after.race === before.race, total: after.total });
  const post = await page.evaluate(async () => {
    const s = (window as any).__slope, loop = s.loop, v = s.raceCourseView; v.update(1); const gates = v.gateCount, boards = v.boardCount;
    s.sim.guestSim.spawner.rateMult = 8;
    loop.setSpeed(1); const t = loop.tickCount + 600; let g = 0; while (loop.tickCount < t && g++ < 1e6) loop.advance(1);
    await new Promise((r) => setTimeout(r, 800)); s.materialGuard?.scan?.();
    return { guard: s.materialGuard?.count ?? -1, gates, boards, laps: s.sim.race.total };
  });
  check('the gates and the board are drawn again after the reload, training goes on', post.gates >= 5 && post.boards === 1 && post.laps >= before.total, post);
  check('MaterialGuard Render problems = 0 after reload', post.guard === 0, post);
  check('no console errors', errors.length === 0, [...new Set(errors)].slice(0, 8));
} finally { await br.close(); srv.stop(); }
console.log(fails.length ? `FAILED: ${fails.join('; ')}` : 'race sanity OK');
process.exit(fails.length ? 1 : 0);
