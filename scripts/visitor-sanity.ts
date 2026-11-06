/* eslint-disable @typescript-eslint/no-explicit-any -- runs inside the page against the untyped __slope debug handle */
/** `npm run visitor:sanity [-- --size 64 --seed 61 --shots 1]`: the rare high-country visitor end to end in the REAL page (dev server, Chrome SwiftShader).
 * Winter career game with a Ranger Station: a forced visit gives the news (ranger wording) + a Show me button whose camera target is 6-12 tiles off and not on it, the mesh is visible and walks,
 * footprints are drawn, the sound cue is mapped, a click on it and a photo with it in frame earn the two hidden achievements, it fades out, the footprints stay, the ranger follow-up news arrives, the footprints fade.
 * Then save, reload, every saved part identical, MaterialGuard 0, no console errors. `--shots 1` also writes .weave/shots/visitor-*.png (kept out of docs / site). Exit 1 on a failed check. */
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
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); else if (m.text().startsWith('{"en"')) console.log('PAGE', m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`[http ${r.status()}] ${r.url()}`); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${String(e)}`));
  const ready = async (): Promise<void> => { await page.waitForFunction(() => !!(window as any).__slope, { timeout: 90000 }); };
  await page.goto(`${srv.url}?size=${size}&seed=${seed}&start=winter&hints=0&starter=1&mode=career`, { waitUntil: 'load', timeout: 90000 });
  await ready();

  // ---- a Ranger Station, then force a visit ----
  const setup = await page.evaluate(async () => {
    const s = (window as any).__slope, sim = s.sim, imp = (u: string): Promise<any> => (new Function('u', 'return import(u)') as any)(u);
    const { findSite } = await imp('/src/tutorial/suggest.ts');
    s.loop.setSpeed(0); sim.progression.bypass++; sim.economy.earn('other', 500_000);
    const lc = sim.lifts.all()[0].bottom, site = findSite(sim, 'rangerStation', { x: lc.x, y: lc.y }, { rmax: 14 });
    const o = site ? s.debugPlace('rangerStation', site.x, site.y, site.rot, true) : { ok: false };
    if (o.ok) { // a road to its door, as the starter resort does
      const { NetKind } = await imp('/src/world/Networks.ts'); const nw = sim.networks, bb = sim.buildings.get(o.building.id), goal = new Set<number>();
      for (let x = bb.x - 1; x <= bb.x + bb.w; x++) for (let y = bb.y - 1; y <= bb.y + bb.h; y++) if (x < bb.x || y < bb.y || x >= bb.x + bb.w || y >= bb.y + bb.h) goal.add(nw.idxOf(x, y));
      const e = nw.roadEntry; const route = e ? nw.route(NetKind.Road, e, e, 0, (x: number, y: number) => goal.has(nw.idxOf(x, y))) : [];
      for (const t of route) nw.build(NetKind.Road, t.x, t.y);
    }
    sim.progression.bypass--; sim.buildings.reevaluate?.(); sim.refreshCoverage(undefined, true);
    const out: any = { station: !!o.ok && !!sim.buildings.get(o.building.id)?.active, enabled: sim.visitor.enabled, site, ok: o.ok, why: o.reasons ?? o.reason, bReason: o.ok ? sim.buildings.get(o.building.id)?.reason : null };
    s.setHour?.(10); const w = sim.weather.current; w.kind = 'clear'; w.intensity = 0; w.fog = 0; w.wind = 0.1;
    const spotted: any[] = []; sim.bus.on('visitor:spotted', (e: any) => spotted.push(e)); (window as any).__spotted = spotted;
    out.forced = sim.visitor.force();
    out.spotted = spotted[0] ?? null; out.visit = sim.visitor.visit ? { path: sim.visitor.visit.path, ranger: sim.visitor.visit.ranger } : null;
    return out;
  });
  console.log(JSON.stringify(setup));
  check('the visitor is on in a Career winter game', setup.enabled === true);
  check('a Ranger Station stands', setup.station === true);
  check('a forced visit started and announced itself', setup.forced === true && !!setup.spotted, setup.spotted);
  const sp = setup.spotted;
  const off = Math.hypot(sp.fx - setup.visit.path[0], sp.fy - setup.visit.path[1]);
  check('the Show me target is 6-12 tiles from where it was first seen', off >= 6 && off <= 12.01, off);

  const news = await page.evaluate(async () => {
    const imp = (u: string): Promise<any> => (new Function('u', 'return import(u)') as any)(u);
    const { formatEvent } = await imp('/src/ui/newsFormat.ts'); const s = (window as any).__slope, sp = (window as any).__spotted[0];
    const a = formatEvent('visitor:spotted', sp); const b = formatEvent('visitor:spotted', { ...sp, ranger: false });
    const { soundsForEvent } = await imp('/src/audio/eventSounds.ts');
    return { a: a?.text, label: a?.focus?.label, b: b?.text, sound: soundsForEvent('visitor:spotted', sp).map((c: any) => c.sfx), ranger: s.sim.visitor.visit.ranger };
  });
  check('news (ranger wording) with a Show me button', news.a === 'A yeti has been spotted! A ranger is investigating the area.' && news.label === 'Show me' && news.ranger === true, news);
  check('news without a ranger reads differently', news.b === 'Guests report a yeti up on the mountain. Nobody is free to investigate.');
  check('one quiet distant call is mapped to the event', news.sound.join() === 'distantCall', news.sound);

  // ---- the real Show me button in the real news panel ----
  await page.evaluate(() => { const s = (window as any).__slope; s.sim.visitor.visit.startMin -= 60; s.setHour?.(10); });
  await page.evaluate(() => { const n: any = document.querySelector('st-news'); (n?.shadowRoot?.querySelector('button') as HTMLElement | null)?.click(); });
  await sleep(600);
  const clicked = await page.evaluate(() => {
    const n: any = document.querySelector('st-news'); const sr: ShadowRoot | null = n?.shadowRoot ?? null; if (!sr) return { ok: false, why: 'no shadow' };
    const btn = [...sr.querySelectorAll('button.go')].find((b) => /Show me/.test(b.textContent ?? '')) as HTMLElement | undefined;
    if (!btn) return { ok: false, why: 'no button', rows: [...sr.querySelectorAll('.e')].map((e) => e.textContent).slice(0, 4) };
    btn.click(); return { ok: true };
  });
  check('the Show me button exists in the news panel', clicked.ok === true, clicked);
  await page.waitForFunction(() => !(window as any).__slope.renderer.controls.focusing, { timeout: 20000 }); await sleep(500);
  const cam = await page.evaluate(() => {
    const s = (window as any).__slope, c = s.renderer.controls, v = s.sim.visitor.visit, t = c.target;
    let mn = 1e9; for (let i = 0; i < v.path.length; i += 2) mn = Math.min(mn, Math.hypot(t.x - v.path[i], t.z - v.path[i + 1]));
    return { tx: t.x, tz: t.z, first: Math.hypot(t.x - v.path[0], t.z - v.path[1]), minToWalk: mn, fx: v.fx, fy: v.fy };
  });
  console.log(JSON.stringify(cam));
  check('the camera moved near the area (6-12 tiles from the first sighting) and is not on the visitor', cam.first >= 5.9 && cam.first <= 12.1 && cam.minToWalk > 1.5, cam);

  // ---- mesh + footprints + walk ----
  await sleep(500);
  const vis = await page.evaluate(async () => {
    const s = (window as any).__slope, v = s.visitorView, p0 = { x: v.pos.x, z: v.pos.z };
    const draws: any = {}; let meshes = 0; v.group.traverse((o: any) => { if (o.isMesh && o.visible) meshes++; });
    const verts = v.group.children.map((c: any) => c.geometry?.getAttribute('position')?.count ?? 0);
    s.loop.setSpeed(1); const t = s.loop.tickCount + 12; let g = 0; while (s.loop.tickCount < t && g++ < 1e6) s.loop.advance(1); s.loop.setSpeed(0);
    await new Promise((r) => setTimeout(r, 700));
    return { visible: v.visible, meshes, verts, moved: Math.hypot(v.pos.x - p0.x, v.pos.z - p0.z), prints: v.group.children[1].visible, calls: s.renderer.webgl.info.render.calls, draws };
  });
  console.log(JSON.stringify(vis));
  check('the visitor mesh is visible (one body mesh + one footprint mesh)', vis.visible === true && vis.meshes === 2, vis);
  check('it walks (position changed over a few sim hours)', vis.moved > 0.2, vis.moved);
  check('footprints are drawn', vis.prints === true && vis.verts[1] > 30, vis.verts);

  if (shots) {
    await page.evaluate(() => { const s = (window as any).__slope, v = s.visitorView; s.loop.setSpeed(0); s.renderer.controls.target.y = v.pos.y - 0.5; s.renderer.controls.focusOn(v.pos.x, v.pos.z, { duration: 0, zoom: 90 }); });
    await sleep(1500); await page.screenshot({ path: '.weave/shots/visitor-close.png' });
    await page.evaluate(() => { const s = (window as any).__slope, v = s.visitorView; s.renderer.controls.target.y = v.pos.y - 0.5; s.renderer.controls.focusOn(v.pos.x, v.pos.z, { duration: 0, zoom: 30 }); });
    await sleep(1500); await page.screenshot({ path: '.weave/shots/visitor-wide.png' });
  }

  // ---- click it: the first hidden achievement ----
  const pt = await page.evaluate(() => {
    const s = (window as any).__slope, v = s.visitorView, cam = s.renderer.controls.camera; s.renderer.controls.target.y = v.pos.y - 0.5; s.renderer.controls.focusOn(v.pos.x, v.pos.z, { duration: 0, zoom: 22 });
    cam.updateMatrixWorld(true); const q = v.pos.clone().project(cam); const r = s.renderer.webgl.domElement.getBoundingClientRect();
    return { x: r.left + ((q.x + 1) / 2) * r.width, y: r.top + ((1 - q.y) / 2) * r.height, before: s.sim.achievements.isUnlocked('rare-seen') };
  });
  await sleep(600);
  const pt2 = await page.evaluate(() => { const s = (window as any).__slope, v = s.visitorView, cam = s.renderer.controls.camera; cam.updateMatrixWorld(true); const q = v.pos.clone().project(cam); const r = s.renderer.webgl.domElement.getBoundingClientRect(); return { x: r.left + ((q.x + 1) / 2) * r.width, y: r.top + ((1 - q.y) / 2) * r.height }; });
  await page.mouse.click(pt2.x, pt2.y);
  await sleep(500);
  const seen = await page.evaluate(() => (window as any).__slope.sim.achievements.isUnlocked('rare-seen'));
  console.log(JSON.stringify({ pt2, dbg: await page.evaluate((p) => { const s = (window as any).__slope, v = s.visitorView; return { vis: v.visible, pos: v.pos.toArray(), el: document.elementFromPoint(p.x, p.y)?.tagName, mode: s.view.mode }; }, pt2) }));
  check('clicking the visitor earns the hidden "seen" achievement (locked before)', pt.before === false && seen === true, { before: pt.before, seen });

  // ---- photo with it in frame ----
  const ph = await page.evaluate(async () => {
    const s = (window as any).__slope, v = s.visitorView; s.renderer.controls.target.y = v.pos.y - 0.5; s.renderer.controls.focusOn(v.pos.x, v.pos.z, { duration: 0, zoom: 22 });
    await new Promise((r) => setTimeout(r, 500));
    const ok = s.view.photo.enter();
    await new Promise((r) => setTimeout(r, 800));
    return { entered: ok, inFrame: v.inFrame(s.renderer.camera), before: s.sim.achievements.isUnlocked('rare-photo') };
  });
  if (shots) { await sleep(800); await page.screenshot({ path: '.weave/shots/visitor-photo.png' }); }
  await page.keyboard.press('Enter'); await page.waitForFunction(() => (window as any).__slope.sim.achievements.isUnlocked('rare-photo'), { timeout: 20000 }).catch(() => {});
  const ph2 = await page.evaluate(() => { const s = (window as any).__slope; s.view.photo.exit(); return s.sim.achievements.isUnlocked('rare-photo'); });
  check('a photo with it in frame earns the hidden "photo" achievement (locked before)', ph.entered && ph.inFrame && ph.before === false && ph2 === true, { ...ph, after: ph2 });

  // ---- it leaves; footprints stay; ranger follow-up; footprints fade ----
  const leave = await page.evaluate(async () => {
    const s = (window as any).__slope, sim = s.sim, v = s.visitorView; s.view.photo.exit?.();
    const fol: any[] = []; sim.bus.on('visitor:followup', (e: any) => fol.push(e)); (window as any).__fol = fol;
    s.loop.setSpeed(0); const adv = (k: number): void => { const t = s.loop.tickCount + k; let g = 0; while (s.loop.tickCount < t && g++ < 1e6) s.loop.advance(1); };
    s.loop.setSpeed(1);
    const dur = sim.visitor.visit.durMin; adv(Math.ceil(dur / 6) + 4); await new Promise((r) => setTimeout(r, 700));
    const gone = { pose: sim.visitor.poseAt(), bodyVisible: v.group.children[0].visible, printsVisible: v.group.children[1].visible };
    adv(Math.ceil(3 * 60 / 6) + 2); await new Promise((r) => setTimeout(r, 300));
    const followed = fol.length; const text = (await (new Function('u', 'return import(u)') as any)('/src/ui/newsFormat.ts')).formatEvent('visitor:followup', fol[0])?.text;
    adv(240 * 3); await new Promise((r) => setTimeout(r, 700));
    return { gone, followed, text, tracksAfter: v.group.children[1].visible, visit: sim.visitor.visit };
  });
  console.log(JSON.stringify({ ...leave, visit: !!leave.visit }));
  check('it is gone after its time (no body) and the footprints stay', leave.gone.pose === null && leave.gone.bodyVisible === false && leave.gone.printsVisible === true, leave.gone);
  check('the ranger follow-up news arrives once', leave.followed === 1 && /footprints|tracks/.test(leave.text), { n: leave.followed, text: leave.text });
  check('the footprints fade away a few days later and the visit record clears', leave.tracksAfter === false && leave.visit === null, leave.tracksAfter);

  // ---- save, reload mid visit, compare ----
  await page.evaluate(() => { const s = (window as any).__slope; s.loop.setSpeed(0); s.sim.visitor.force(); s.loop.setSpeed(1); const t = s.loop.tickCount + 10; let g = 0; while (s.loop.tickCount < t && g++ < 1e6) s.loop.advance(1); s.loop.setSpeed(0); });
  await sleep(600);
  const snapshot = (): Promise<any> => page.evaluate(async () => {
    const s = (window as any).__slope, sim = s.sim, imp = (u: string): Promise<any> => (new Function('u', 'return import(u)') as any)(u);
    const SS = await imp('/src/game/saveState.ts'); const h = SS.stateHash(sim); const col = SS.collectSave(sim);
    return { hash: h.hash, parts: h.parts, visit: JSON.stringify(col.visitor), count: sim.visitor.count };
  });
  const before = await snapshot();
  const slot = await page.evaluate(async () => { const s = (window as any).__slope; const r = await s.saves.save(undefined, 'visitor-sanity'); return (await s.saves.list())[0]?.id ?? r; });
  check('saved to a slot', !!slot, slot);
  await page.goto(`${srv.url}?load=${encodeURIComponent(slot)}`, { waitUntil: 'load', timeout: 90000 });
  await ready();
  await page.evaluate(() => (window as any).__slope.loop.setSpeed(0));
  await sleep(1200);
  const after = await snapshot();
  const RUNTIME = new Set(['sys.guests', 'sys.ops', 'networks', 'lifts']);
  const diff = Object.keys(before.parts).filter((k) => before.parts[k] !== after.parts[k] && !RUNTIME.has(k));
  check('every saved part identical after reload', diff.length === 0, diff);
  check('the visit itself came back identical and is shown again', after.visit === before.visit && after.count === before.count, { count: after.count });
  const shownNow = await page.evaluate(() => { const s = (window as any).__slope, v = s.sim.visitor; console.log(JSON.stringify({ en: v.enabled, visit: !!v.visit, pose: v.poseAt(), now: s.game.date, start: v.visit?.startMin })); return s.visitorView.visible; });
  const post = await page.evaluate(async () => {
    const s = (window as any).__slope; s.loop.setSpeed(1);
    const t = s.loop.tickCount + 600; let g = 0; while (s.loop.tickCount < t && g++ < 1e6) s.loop.advance(1);
    await new Promise((r) => setTimeout(r, 900));
    return { guard: s.materialGuard?.count ?? -1, shown: s.visitorView.visible };
  });
  check('the visitor is drawn again right after the reload', shownNow === true, shownNow);
  check('MaterialGuard Render problems = 0', post.guard === 0, post);
  check('no console errors', errors.length === 0, [...new Set(errors)].slice(0, 8));
} finally { await br.close(); srv.stop(); }
console.log(fails.length ? `FAILED: ${fails.join('; ')}` : 'visitor sanity OK');
process.exit(fails.length ? 1 : 0);
