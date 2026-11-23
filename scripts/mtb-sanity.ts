/* eslint-disable @typescript-eslint/no-explicit-any -- runs inside the page against the untyped __slope debug handle */
/** `npm run mtb:sanity [-- --size 64 --seed 61 --shots 1 --out race3]` (also `race:sanity -- --summer 1`): the 0.8.2 downhill story in the REAL page (dev server, Chrome SwiftShader).
 * Summer career game at level 3: the main run's line is painted as a red MTB trail, refused without huts (readable trail wording), both huts placed beside its ends, the trail marked as a
 * downhill course (Runs tab row, gates drawn, 3 draw calls), Downhillers arrive, lap it, pay the fee, the board shows a time; a Downhill Race on a Saturday (trail closed, results); save mid-day,
 * reload: every saved part identical, the course + laps back, gates drawn again, MaterialGuard 0, no console errors. `--shots 1` writes .weave/shots/<out>-*.png. */
import { launch, startServer } from './lib/harness';

const arg = (k: string, d: string): string => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1]! : d; };
const size = arg('size', '64'), seed = arg('seed', '61'), shots = arg('shots', '0') === '1', out = arg('out', 'race3');
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
  await page.goto(`${srv.url}?size=${size}&seed=${seed}&hints=0&starter=1&mode=career&start=summer`, { waitUntil: 'load', timeout: 90000 });
  await ready();

  const built = await page.evaluate(async () => { try {
    const s = (window as any).__slope, sim = s.sim, imp = (u: string): Promise<any> => (new Function('u', 'return import(u)') as any)(u);
    const { Layer } = await imp('/src/world/Networks.ts');
    s.loop.setSpeed(0);
    sim.progression.setLevel(3); sim.economy.earn('other', 400_000);
    const n = sim.size, ski = Array.from(sim.runIndex.runs() as any[]).sort((a: any, b: any) => b.dropM - a.dropM)[0];
    sim.networks.paint(Layer.Mtb, ski.poly.map((t: number) => ({ x: t % n, y: (t / n) | 0 })), 2); // a red bike trail along the main run
    const tr = () => Array.from(sim.mtbRunIndex.runs() as any[]).sort((a: any, b: any) => b.dropM - a.dropM)[0];
    const idOf = () => sim.race.idOf(tr());
    const o: any = { season: sim.game.date.day, diff: tr().difficulty, dropM: Math.round(tr().dropM) };
    o.refusedNoStart = sim.setRunCourse(idOf(), true);
    const put = (type: string, tiles: number[]): any => {
      for (const t of tiles) for (let k = 1; k <= 3; k++) for (let dy = -k; dy <= k; dy++) for (let dx = -k; dx <= k; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== k) continue;
        const b = s.debugPlace(type, (t % n) + dx, ((t / n) | 0) + dy, 0, true);
        if (b.ok) return sim.buildings.get(b.building.id);
      }
      return null;
    };
    const p = tr().poly;
    const sh = put('startHut', [p[1], p[0], p[2]]);
    o.refusedNoTiming = sim.setRunCourse(idOf(), true);
    const th = put('timingHut', [p[p.length - 2], p[p.length - 1], p[p.length - 3]]);
    sim.refreshCoverage(undefined, true); sim.buildings.reevaluate();
    o.huts = !!sh?.active && !!th?.active;
    o.rows = sim.trailRows().map((r: any) => r.course.text);
    o.marked = sim.setRunCourse(idOf(), true);
    o.courses = sim.race.courses().map((c: any) => ({ id: c.id, mtb: c.mtb, valid: c.valid, open: c.open, quality: c.quality, name: sim.courseName(c) }));
    return o;
  } catch (e: any) { return { error: String(e && e.stack || e) }; } });
  console.log(JSON.stringify(built));
  check('the red bike trail is refused without huts, with the trail wording', built.refusedNoStart?.reason === 'Needs a Start Hut at the top' && built.refusedNoTiming?.reason === 'Needs a Timing Hut at the foot', { a: built.refusedNoStart, b: built.refusedNoTiming });
  check('both huts stand beside the trail ends and are active', built.huts === true);
  check('the trail is marked as a downhill course (valid + open, "Downhill 1")', built.marked?.ok === true && built.courses.length === 1 && built.courses[0].mtb && built.courses[0].valid && built.courses[0].open && built.courses[0].name === 'Downhill 1', built.courses);

  const view = await page.evaluate(() => { const s = (window as any).__slope, v = s.raceCourseView; v.update(1); return { gates: v.gateCount, boards: v.boardCount, meshes: v.group.children.filter((c: any) => c.isMesh).length, tris: v.triangles() }; });
  console.log(JSON.stringify(view));
  check('gates are drawn on the trail: 3 meshes, under the triangle budget', view.gates >= 5 && view.meshes === 3 && view.boards === 1 && view.tris < 8000, view);

  const day = await page.evaluate(async () => {
    const s = (window as any).__slope, sim = s.sim, loop = s.loop, st = sim.guestSim.store, DT = 15;
    sim.guestSim.spawner.rateMult = 10;
    let seen = 0, bestSeen: number | null = null; const income0 = sim.economy.ledger.recreation ?? 0;
    const riders = (): number => { let n = 0; for (let i = 0; i < st.limit; i++) if (st.alive[i] && st.type[i] === DT) n++; return n; };
    loop.setSpeed(1);
    for (let k = 0; k < 720; k++) { loop.advance(1); const b = sim.race.bestMs(sim.race.courses()[0].id); if (b !== null && (bestSeen === null || b < bestSeen)) bestSeen = b; const r = riders(); if (r > seen) seen = r; }
    loop.setSpeed(0);
    return { seen, laps: sim.race.total, income: Math.round((sim.economy.ledger.recreation ?? 0) - income0), best: bestSeen, ridersToday: sim.race.racersToday(true) };
  });
  console.log(JSON.stringify(day));
  check('downhillers (type 15) arrive in summer and lap the course', day.seen > 0 && day.laps >= 1, { seen: day.seen, laps: day.laps });
  check('downhillers pay the course fee and the board has a time', day.income >= 14 && typeof day.best === 'number' && day.best > 20000 && day.best < 200000, { income: day.income, best: day.best });

  const focusRun = (zoom: number, yaw: number, at: 'mid' | 'start' | 'finish' = 'mid'): Promise<any> => page.evaluate((zoom, yaw, at) => {
    const s = (window as any).__slope, c2 = s.renderer.controls, sim = s.sim, n = sim.size, c = sim.race.courses()[0], p = c.run.poly;
    const hut = at === 'start' ? c.start : at === 'finish' ? c.timing : null, t = p[p.length >> 1];
    const x = hut ? hut.x + hut.w / 2 : (t % n) + 0.5, z = hut ? hut.y + hut.h / 2 : ((t / n) | 0) + 0.5;
    c2.target.set(x, s.grid.getCorner(Math.round(x), Math.round(z)) * 0.5, z); c2.zoom = 1; c2.zoomBy(zoom); c2.yaw = yaw; const u = document.getElementById('ui'); if (u) u.style.display = 'none'; s.raceCourseView.update(1);
  }, zoom, yaw, at);
  const shot = async (name: string): Promise<void> => { await sleep(2600); await page.screenshot({ path: `.weave/shots/${out}-${name}.png` }); };
  if (shots) {
    await page.evaluate(() => { const s = (window as any).__slope, sim = s.sim, n = sim.size, c = sim.race.courses()[0], touched: number[] = []; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const t of c.run.poly) { x0 = Math.min(x0, t % n); x1 = Math.max(x1, t % n); y0 = Math.min(y0, (t / n) | 0); y1 = Math.max(y1, (t / n) | 0); } sim.props.removeInRect(x0 - 5, y0 - 5, x1 + 6, y1 + 6, touched); s.refreshProps(touched); s.setHour?.(11); });
    await focusRun(5, 0.785398); await shot('course');
    await focusRun(12, 0.785398, 'start'); await shot('start-hut');
    await focusRun(12, 0.785398, 'finish'); await shot('finish-board');
    await page.evaluate(() => { const s = (window as any).__slope, sim = s.sim, st = sim.guestSim.store; s.loop.setSpeed(1); let g = 0, hit = 0; while (g++ < 1500 && hit < 1) { s.loop.advance(1); hit = 0; for (let i = 0; i < st.limit; i++) if (st.alive[i] && st.type[i] === 15) hit++; } s.loop.setSpeed(0); });
    await focusRun(7, 0.785398); await shot('riders');
    await page.evaluate(() => { const u = document.getElementById('ui'); if (u) u.style.display = ''; (document.querySelector('st-operations') as any)?.refresh?.(); });
  }

  // ---- a Downhill Race on a Saturday: closed 10:00-14:00, results ----
  const rd0 = await page.evaluate(() => {
    const s = (window as any).__slope, sim = s.sim, c = sim.race.courses()[0], abs = () => sim.game.date.year * 180 + sim.game.date.day;
    let sat = abs() + 2; while ((((sat % 7) + 7) % 7) !== 5) sat++;
    return { id: c.id, sat, booked: sim.bookRaceDay(c.id, sat) };
  });
  check('a Downhill Race books on a summer Saturday', rd0.booked === null, rd0);
  const stepTo = (day: number, hour: number): Promise<any> => page.evaluate((day, hour) => {
    const s = (window as any).__slope, sim = s.sim, loop = s.loop; sim.guestSim.spawner.rateMult = 8; loop.setSpeed(1);
    let g = 0; const now = (): number => sim.game.date.year * 180 + sim.game.date.day + sim.game.date.minute / 1440;
    while (now() < day + hour / 24 && g++ < 6000) loop.advance(1);
    loop.setSpeed(0);
  }, day, hour);
  await stepTo(rd0.sat, 11.5);
  const live = await page.evaluate(() => { const sim = (window as any).__slope.sim, rd = sim.raceDay; return { session: !!rd.session, mtb: rd.session?.mtb, field: rd.session?.field, spectators: rd.session?.spectators.length ?? 0, closed: sim.openStatus.activeClosures(sim.safety.incidents.nowTick ?? 0).some((c: any) => c.reason === 'Race day') }; });
  check('10:00 the downhill race starts and the trail is closed ("Race day")', live.session && live.mtb === true && live.closed && live.field >= 20, live);
  if (shots) { await page.evaluate(() => { (window as any).__slope.setHour?.(11.5); const u = document.getElementById('ui'); if (u) u.style.display = 'none'; }); await focusRun(8, 0.785398, 'finish'); await shot('race-crowd'); }

  const snapshot0 = (): Promise<any> => page.evaluate(async () => {
    const s = (window as any).__slope, sim = s.sim, imp = (u: string): Promise<any> => (new Function('u', 'return import(u)') as any)(u);
    const SS = await imp('/src/game/saveState.ts'); const h = SS.stateHash(sim); const col = SS.collectSave(sim);
    return { parts: h.parts, race: JSON.stringify(col.raceCourse), runs: JSON.stringify(col.runs), total: sim.race.total, courses: sim.runSettings.courseIds(), buildings: sim.buildings.all().map((b: any) => `${b.type}@${b.x},${b.y}`).join('|') };
  });
  const before = await snapshot0();
  check('a downhill course, lap records and a running race exist at save time', before.courses.length === 1 && before.total > 0 && before.race.includes('"mtb":true'), { courses: before.courses, total: before.total });
  const slot = await page.evaluate(async () => { const s = (window as any).__slope; const r = await s.saves.save(undefined, 'mtb-sanity'); return (await s.saves.list())[0]?.id ?? r; });
  await page.goto(`${srv.url}?load=${encodeURIComponent(slot)}`, { waitUntil: 'load', timeout: 90000 });
  await ready();
  await page.evaluate(() => (window as any).__slope.loop.setSpeed(0));
  const after = await snapshot0();
  const RUNTIME = new Set(['sys.guests', 'sys.ops', 'networks', 'lifts']);
  const diff = Object.keys(before.parts).filter((k) => before.parts[k] !== after.parts[k] && !RUNTIME.has(k));
  check('every saved part identical after reload; buildings, course flag, laps and the running race are back', diff.length === 0 && after.buildings === before.buildings && after.race === before.race && after.runs === before.runs && after.total === before.total, diff);
  await stepTo(rd0.sat, 14.4);
  const done = await page.evaluate(() => { const sim = (window as any).__slope.sim, rd = sim.raceDay; return { session: !!rd.session, results: rd.results.length, last: rd.results[0] ?? null }; });
  console.log(JSON.stringify(done));
  check('14:00 the results are posted (time, field) and the trail opens again', !done.session && done.results === 1 && done.last.winnerMs > 20000 && done.last.mtb !== false, done);
  const post = await page.evaluate(async () => { const s = (window as any).__slope, v = s.raceCourseView; v.update(1); await new Promise((r) => setTimeout(r, 800)); s.materialGuard?.scan?.(); return { guard: s.materialGuard?.count ?? -1, gates: v.gateCount, boards: v.boardCount }; });
  check('gates drawn again after the reload, MaterialGuard Render problems = 0', post.gates >= 5 && post.boards === 1 && post.guard === 0, post);
  if (shots) { await page.evaluate(() => { (window as any).__slope.setHour?.(14.6); }); await focusRun(18, 0.785398, 'finish'); await shot('result-board'); }
  check('no console errors', errors.length === 0, [...new Set(errors)].slice(0, 8));
} finally { await br.close(); srv.stop(); }
console.log(fails.length ? `FAILED: ${fails.join('; ')}` : 'mtb sanity OK');
process.exit(fails.length ? 1 : 0);
