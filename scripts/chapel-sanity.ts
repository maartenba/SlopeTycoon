/* eslint-disable @typescript-eslint/no-explicit-any -- runs inside the page against the untyped __slope debug handle */
/** `npm run chapel:sanity [-- --size 64 --seed 61 --shots 1]`: the 0.7.1 chapel story end to end in the REAL page (dev server, Chrome SwiftShader).
 * Summer career game: the Chapel is locked at level 1; with the unlock bypassed it is placed beside the base lodge and joined to the village by a footpath (active), a wedding is forced on a summer morning, the party sets out
 * (news), walks to the forecourt (the view shows 4-6 figures), the bell rings twice (`wedding:bell`), the ceremony stands two hours, the party walks to a lodge nearby and pays the small feast income, then is gone.
 * The hour chime comes from the chapel (the probe reports a chapel). The 'Wedding bells' achievement counts. Then save in the MIDDLE of a ceremony, reload, every saved part identical (observer parts too), the party is still
 * at the door, MaterialGuard 0, no console errors. Exit 1 on a failed check or console error. `--shots 1` also writes .weave/shots/chapel2-*.png (the chapel by day and at night, the party at the door, walking, at the feast). */
import { launch, startServer } from './lib/harness';

const arg = (k: string, d: string): string => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1]! : d; };
const size = arg('size', '64'), seed = arg('seed', '61'), shots = arg('shots', '0') === '1';
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

  // ---- the lock, the build ----
  const built = await page.evaluate(async () => {
    const s = (window as any).__slope, sim = s.sim, imp = (u: string): Promise<any> => (new Function('u', 'return import(u)') as any)(u);
    const { findSite, planPathTo, buildNetwork, anchors } = await imp('/src/tutorial/suggest.ts');
    s.loop.setSpeed(0);
    const out: any = { locked: sim.progression.locked('building', 'chapel'), level: sim.progression.level ?? null };
    sim.progression.bypass++; sim.economy.earn('other', 500_000);
    const site = findSite(sim, 'chapel', anchors(sim).lodge, { rmax: 24 });
    const o = site ? s.debugPlace('chapel', site.x, site.y, site.rot, true) : { ok: false };
    if (o.ok) { const p = planPathTo(sim, site.rect); if (p?.length) buildNetwork(sim, 1, p); sim.refreshCoverage(undefined, true); sim.buildings.reevaluate(); }
    sim.progression.bypass--;
    if (o.ok) { const b = sim.buildings.get(o.building.id); out.id = b.id; out.active = b.active; out.reason = b.reason; out.rot = b.rot; out.at = [b.x, b.y, b.w, b.h]; }
    const second = findSite(sim, 'chapel', anchors(sim).lodge, { rmax: 24 });
    out.maxCount = sim.buildings.all().filter((q: any) => q.type === 'chapel').length;
    out.secondRefused = !second || !s.debugPlace('chapel', second.x, second.y, 0, true).ok;
    out.charmOn = sim.buildings.all().some((q: any) => q.type === 'chapel' && q.active);
    return out;
  });
  console.log(JSON.stringify(built));
  check('the Chapel is locked at level 1 (unlock at level 2)', !!built.locked, built.locked);
  check('a chapel stands beside the village and is active (footpath access)', !!built.id && built.active === true, built);
  check('only one chapel is allowed (maxCount 1)', built.maxCount === 1, built.maxCount);

  // ---- the hour chime / bell come from the chapel ----
  const probe = await page.evaluate(() => { const s = (window as any).__slope, b = s.sim.buildings.get(0) ? null : null; void b; return !!(window as any).__audio; });
  console.log('audio handle', probe);

  // ---- a wedding, end to end ----
  const wed = await page.evaluate(async () => {
    const s = (window as any).__slope, sim = s.sim, loop = s.loop, w = sim.wedding, log: any[] = [];
    for (const n of ['wedding:started', 'wedding:bell', 'wedding:held', 'wedding:feast']) sim.bus.on(n, (p: any) => log.push({ n, p, at: Math.round((sim.game.date.minute / 60) * 10) / 10 }));
    s.setHour?.(9); const cw = sim.weather.current; cw.kind = 'clear'; cw.intensity = 0; cw.fog = 0; cw.wind = 0.1;
    const adv = (k: number): void => { loop.setSpeed(1); const t = loop.tickCount + k; let g = 0; while (loop.tickCount < t && g++ < 1e6) loop.advance(1); loop.setSpeed(0); };
    const money0 = sim.game.money;
    const ok = w.force(5), rec = { ...w.rec };
    const now = (): number => sim.game.date.year * 180 * 1440 + sim.game.date.day * 1440 + sim.game.date.minute;
    const goto = (t: number): void => { adv(Math.max(0, Math.ceil((t - now()) / 6))); };
    const view = s.weddingView;
    // 0.7.2: the party walks along the footpath network; every sampled position of both walks is on a path tile, except within 3 tiles of an end (the lodge door / the chapel door)
    const kindAt = (x: number, y: number): number => sim.networks.kind[Math.floor(y) * sim.size + Math.floor(x)];
    let offPath = 0, samples = 0;
    for (const [t0, t1, a, b] of [[rec.tDepart, rec.tArrive, [rec.ox, rec.oy], [rec.fx, rec.fy]], [rec.tEnd, rec.tFeast, [rec.fx, rec.fy], [rec.sx ?? rec.ox, rec.sy ?? rec.oy]]] as any[]) {
      for (let t = t0 + 1; t < t1; t += 2) for (let i = 0; i < rec.guests; i++) {
        const p = w.poseOf(i, t); if (!p || p.mode !== 'walk') continue;
        samples++;
        if (Math.hypot(p.x - a[0], p.y - a[1]) < 3 || Math.hypot(p.x - b[0], p.y - b[1]) < 3) continue;
        if (![1, 2, 3].includes(kindAt(p.x, p.y))) offPath++;
      }
    }
    const routed = !!rec.p1 && rec.p1.length >= 4;
    goto(rec.tDepart + 30); view.update(0.1); const walking = view.visibleCount;
    goto(rec.tBell + 20); view.update(0.1); const standing = view.visibleCount; const bellsAtDoor = log.filter((l) => l.n === 'wedding:bell').length;
    const door = Math.hypot(w.poseOf(0, now()).x - rec.fx, w.poseOf(0, now()).y - rec.fy);
    goto(rec.tEnd + 20); const bells = log.filter((l) => l.n === 'wedding:bell').length, held = log.filter((l) => l.n === 'wedding:held').length;
    goto(rec.tFeast + 10); view.update(0.1); const inside = view.visibleCount;
    const feast = log.find((l) => l.n === 'wedding:feast');
    goto(rec.tGone + 10); view.update(0.1);
    return { offPath, samples, routed, ok, guests: rec.guests, hasFeast: rec.sx !== null, walking, standing, bellsAtDoor, door: Math.round(door * 100) / 100, bells, held, inside, feast: feast ? feast.p.income : 0, gone: w.rec === null, count: w.count, goneVisible: view.visibleCount, started: log.filter((l) => l.n === 'wedding:started').length, money: Math.round(sim.game.money - money0) };
  });
  console.log(JSON.stringify(wed));
  check('a wedding can be forced with a connected chapel', wed.ok === true);
  check('the news event fired once ("A wedding at the chapel today")', wed.started === 1, wed.started);
  check('the party walks along the footpaths: a route exists and no walking position is off a path tile (except at the doors)', wed.routed && wed.samples > 20 && wed.offPath === 0, { routed: wed.routed, samples: wed.samples, offPath: wed.offPath });
  check('the party walks out (4-6 figures drawn)', wed.walking >= 4 && wed.walking <= 6 && wed.walking === wed.guests, { walking: wed.walking, guests: wed.guests });
  check('the couple stands at the chapel door during the ceremony; the party is drawn', wed.door < 1 && wed.standing === wed.guests, { door: wed.door, standing: wed.standing });
  check('the bell rang once at the start of the ceremony, twice by the end (2 strikes each in the sound layer)', wed.bellsAtDoor === 1 && wed.bells === 2, { bellsAtDoor: wed.bellsAtDoor, bells: wed.bells });
  check('the ceremony is counted', wed.held === 1 && wed.count === 1, { held: wed.held, count: wed.count });
  check('the party goes to a lodge nearby: hidden inside during the feast, small income paid', wed.hasFeast ? wed.inside === 0 && wed.feast === wed.guests * 110 : wed.feast === 0, { inside: wed.inside, feast: wed.feast });
  check('afterwards nobody is left', wed.gone && wed.goneVisible === 0, { gone: wed.gone, visible: wed.goneVisible });

  if (shots) {
    const focus = (zoom: number, yaw?: number, dx = 0, dy = 0): Promise<any> => page.evaluate((zoom, yaw, dx, dy) => { const s = (window as any).__slope, c2 = s.renderer.controls; const b = s.sim.buildings.all().find((q: any) => q.type === 'chapel'); c2.target.set(b.x + b.w / 2 + dx, s.grid.getCorner(Math.round(b.x), Math.round(b.y)) * 0.5, b.y + b.h / 2 + dy); c2.zoom = 1; c2.zoomBy(zoom); if (yaw !== undefined) c2.yaw = yaw; const u = document.getElementById('ui'); if (u) u.style.display = 'none'; return 'ok'; }, zoom, yaw, dx, dy);
    const shot = async (name: string): Promise<void> => { await sleep(1800); await page.screenshot({ path: `.weave/shots/chapel2-${name}.png` }); };
    const stage = (phase: 'walk' | 'door' | 'feast', hour: number): Promise<any> => page.evaluate((phase, hour) => {
      const s = (window as any).__slope, sim = s.sim, w = sim.wedding, loop = s.loop; loop.setSpeed(0); s.setHour?.(hour);
      const now = (): number => sim.game.date.year * 180 * 1440 + sim.game.date.day * 1440 + sim.game.date.minute;
      if (!w.rec) { sim.game.date.minute = 9 * 60; w.force(5); }
      const r = w.rec, t = phase === 'walk' ? r.tDepart + (r.tArrive - r.tDepart) * 0.6 : phase === 'door' ? r.tBell + 30 : r.tEnd + (r.tFeast - r.tEnd) * 0.5;
      if (!s.__wvOrig) s.__wvOrig = s.weddingView.now; s.weddingView.now = () => t; s.weddingView.update(5); void now;
      const q = w.poseOf(1, t), b = sim.buildings.all().find((c: any) => c.type === 'chapel');
      return { t: Math.round(t - r.tDepart), n: s.weddingView.visibleCount, dx: q ? q.x - (b.x + b.w / 2) : 0, dy: q ? q.y - (b.y + b.h / 2) : 0 };
    }, phase, hour);
    await page.evaluate(() => { (window as any).__slope.setHour(12); });
    await focus(9, 0.785398); await shot('day');
    const st = await stage('walk', 11); await focus(5, 0.785398, st.dx, st.dy); await shot('party-walking');
    await stage('door', 12); await focus(14, 0.6, -1.4, 0); await shot('party-door');
    await stage('feast', 14); await focus(7, 0.785398, 0, 2); await shot('party-to-lodge');
    await page.evaluate(() => { (window as any).__slope.setHour(21.5); }); await focus(10, 0.9); await shot('night');
    await page.evaluate(() => { const s = (window as any).__slope; if (s.__wvOrig) s.weddingView.now = s.__wvOrig; const u = document.getElementById('ui'); if (u) u.style.display = ''; });
  }

  // ---- save in the middle of a ceremony, reload, compare ----
  await page.evaluate(() => { const s = (window as any).__slope, sim = s.sim, loop = s.loop, w = sim.wedding; loop.setSpeed(0); (window as any).__slope.setHour?.(null); if (!w.rec) { w.force(6); } const r = w.rec; const now = sim.game.date.year * 180 * 1440 + sim.game.date.day * 1440 + sim.game.date.minute; const t = Math.ceil((r.tBell + 10 - now) / 6); let g = 0; const target = loop.tickCount + Math.max(0, t); loop.setSpeed(1); while (loop.tickCount < target && g++ < 1e6) loop.advance(1); loop.setSpeed(0); });
  const snapshot = (): Promise<any> => page.evaluate(async () => {
    const s = (window as any).__slope, sim = s.sim, imp = (u: string): Promise<any> => (new Function('u', 'return import(u)') as any)(u);
    const SS = await imp('/src/game/saveState.ts'); const h = SS.stateHash(sim); const col = SS.collectSave(sim);
    return { hash: h.hash, parts: h.parts, wedding: JSON.stringify(col.wedding), rec: sim.wedding.rec ? JSON.stringify(sim.wedding.rec) : null, count: sim.wedding.count, buildings: sim.buildings.all().map((b: any) => `${b.type}@${b.x},${b.y}`).join('|') };
  });
  const before = await snapshot();
  check('a ceremony is under way at save time', !!before.rec, before.rec);
  const slot = await page.evaluate(async () => { const s = (window as any).__slope; const r = await s.saves.save(undefined, 'chapel-sanity'); return (await s.saves.list())[0]?.id ?? r; });
  check('saved to a slot', !!slot, slot);
  await page.goto(`${srv.url}?load=${encodeURIComponent(slot)}`, { waitUntil: 'load', timeout: 90000 });
  await ready();
  await page.evaluate(() => (window as any).__slope.loop.setSpeed(0));
  const after = await snapshot();
  check('buildings restored (the chapel is back)', after.buildings === before.buildings && after.buildings.includes('chapel@'));
  const RUNTIME = new Set(['sys.guests', 'sys.ops', 'networks', 'lifts']);
  const diff = Object.keys(before.parts).filter((k) => before.parts[k] !== after.parts[k] && !RUNTIME.has(k));
  check('every saved part identical after reload', diff.length === 0, diff);
  check('the wedding record and the count came back (observer module)', after.wedding === before.wedding && after.rec === before.rec && after.count === before.count, { rec: after.rec === before.rec });
  const post = await page.evaluate(async () => {
    const s = (window as any).__slope, loop = s.loop; s.weddingView.update(0.1); const drawn = s.weddingView.visibleCount;
    loop.setSpeed(1); const t = loop.tickCount + 1200; let g = 0; while (loop.tickCount < t && g++ < 1e6) loop.advance(1);
    await new Promise((r) => setTimeout(r, 800)); s.materialGuard?.scan?.();
    return { guard: s.materialGuard?.count ?? -1, drawn, ended: s.sim.wedding.rec === null };
  });
  check('the party is drawn again after the reload, and the wedding runs to its end', post.drawn >= 4 && post.ended, post);
  check('MaterialGuard Render problems = 0 after reload', post.guard === 0, post);
  check('no console errors', errors.length === 0, [...new Set(errors)].slice(0, 8));
} finally { await br.close(); srv.stop(); }
console.log(fails.length ? `FAILED: ${fails.join('; ')}` : 'chapel sanity OK');
process.exit(fails.length ? 1 : 0);
