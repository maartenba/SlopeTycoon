/* eslint-disable @typescript-eslint/no-explicit-any -- runs inside the page against the untyped __slope debug handle */
/** `npm run schirmbar:sanity [-- --size 64 --seed 61 --shots 1]`: the M7.8 story end to end in the REAL page (dev server, Chrome SwiftShader).
 * Career winter game with a chosen resort name (`?name=Hinterkogel`): the Schirmbar is locked at level 1, a site beside the lift station is accepted, the bar is placed beside the busiest ski line (unlock bypassed), a clear winter day is run: skiers stop
 * for a drink, income stays under the daily cap, the bar plays as a bar for the apres music (open + serving gate). A storm closes it with a reason and the shuttered mesh; the player switch closes it ("Closed by you")
 * and reopens it. The resort name is on the banner (a canvas texture) and a rename reaches the banner. Then save, reload from the slot, every saved part identical (observer parts too), the name and the switch restored,
 * MaterialGuard 0, no console errors. Exit 1 on a failed check or console error. `--shots 1` also writes .weave/shots/schirmbar-*.png. */
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
  await page.evaluateOnNewDocument(() => { const add = (): void => { const st = document.createElement('style'); st.textContent = 'st-toast{display:none!important}'; document.head.appendChild(st); }; if (document.head) add(); else document.addEventListener('DOMContentLoaded', add); });
  const ready = async (): Promise<void> => { await page.waitForFunction(() => !!(window as any).__slope, { timeout: 90000 }); };
  await page.goto(`${srv.url}?size=${size}&seed=${seed}&start=winter&hints=0&starter=1&mode=career&name=Hinterkogel`, { waitUntil: 'load', timeout: 90000 });
  await ready();

  // ---- the name, the lock, the build ----
  const built = await page.evaluate(async () => {
    const s = (window as any).__slope, sim = s.sim, imp = (u: string): Promise<any> => (new Function('u', 'return import(u)') as any)(u);
    const { findSite } = await imp('/src/tutorial/suggest.ts');
    s.loop.setSpeed(0);
    const out: any = { name: sim.resort.name, locked: sim.progression.locked('building', 'schirmbar'), month: sim.game.date.day };
    sim.progression.bypass++; sim.economy.earn('other', 500_000);
    const bottom = sim.lifts.all()[0].bottom;
    // watch where skiers really ski for a morning, then stand the bar beside the busiest ski line within reach of the lift station
    const loop = s.loop, st = s.guestSim.store, heat = new Map<number, number>();
    const adv = (k: number): void => { const t = loop.tickCount + k; let g = 0; while (loop.tickCount < t && g++ < 1e6) loop.advance(1); };
    loop.setSpeed(1); s.spawnGuests(150, 'skiers');
    for (let q = 0; q < 40; q++) { adv(2); for (let k = 0; k < st.limit; k++) if (st.alive[k] && st.act[k] === 5) { const key = Math.floor(st.y[k]) * sim.size + Math.floor(st.x[k]); heat.set(key, (heat.get(key) ?? 0) + 1); } }
    loop.setSpeed(0);
    let site: any = null;
    const ranked = [...heat].filter(([key]) => Math.hypot((key % sim.size) - bottom.x, Math.floor(key / sim.size) - bottom.y) <= 10).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    for (const [key] of ranked) { site = findSite(sim, 'schirmbar', { x: key % sim.size, y: Math.floor(key / sim.size) }, { rmax: 2 }); if (site) break; }
    if (!site) site = findSite(sim, 'schirmbar', { x: bottom.x, y: bottom.y }, { rmax: 5 });
    out.besideStation = !!findSite(sim, 'schirmbar', { x: bottom.x, y: bottom.y }, { rmax: 3 });
    out.heat = ranked.length; out.hot = ranked.slice(0, 3).map(([k, n]) => [k % sim.size, Math.floor(k / sim.size), n]); out.bottom = [bottom.x, bottom.y];
    const o = site ? s.debugPlace('schirmbar', site.x, site.y, site.rot, true) : { ok: false };
    sim.progression.bypass--;
    if (o.ok) { out.id = o.building.id; out.active = sim.buildings.get(o.building.id).active; out.reasons = o.reasons; const dx = Math.min(...sim.lifts.all().map((l: any) => Math.hypot(l.bottom.x - (o.building.x + 1), l.bottom.y - (o.building.y + 1)))); out.liftDist = Math.round(dx * 10) / 10; }
    s.setHour?.(11); const w = sim.weather.current; w.kind = 'clear'; w.intensity = 0; w.fog = 0; w.wind = 0.1;
    return out;
  });
  console.log(JSON.stringify(built));
  check('the resort name from ?name= is in the game', built.name === 'Hinterkogel', built.name);
  check('the Schirmbar is locked at level 1 in Career (unlock at level 2)', !!built.locked, built.locked);
  check('a site right beside the lift station is accepted (placement allows it)', built.besideStation === true, built.besideStation);
  check('a Schirmbar stands beside the busiest ski line with no road, path or power, and is active', !!built.id && built.active === true, built);
  const id = built.id as number;

  // ---- a clear winter day: skiers stop for a drink ----
  const day = await page.evaluate(async (id: number) => {
    const s = (window as any).__slope, sim = s.sim, loop = s.loop;
    const adv = (k: number): void => { const t = loop.tickCount + k; let g = 0; while (loop.tickCount < t && g++ < 1e6) loop.advance(1); };
    const clear = (): void => { const w = sim.weather.current; w.kind = 'clear'; w.intensity = 0; w.fog = 0; w.wind = 0.1; };
    loop.setSpeed(1);
    const d = s.guestSim.decider; let calls = 0, minD = 99; const orig = d.stopWithin.bind(d); d.stopWithin = (x: number, y: number, r: number) => { calls++; const b = d.stops[0]; if (b) minD = Math.min(minD, Math.hypot(b.x + b.w / 2 - x, b.y + b.h / 2 - y)); return orig(x, y, r); };
    for (let k = 0; k < 6; k++) { clear(); s.spawnGuests(60, 'skiers'); for (let q = 0; q < 8; q++) { clear(); adv(10); } }
    const a = sim.attractions.get(id);
    const gate = sim.attractions.servingNow(a) && a.open; // the same test the apres-music probe uses (open + serving)
    d.stopWithin = orig;
    return { calls, minD: Math.round(minD * 10) / 10, stops: s.guestSim.barStops, served: a.stats.served, revenue: Math.round(a.stats.revenue * 100) / 100, today: a.stats.today ?? 0, todayRev: a.stats.todayRev ?? 0, cap: a.spec.dailyCap, open: a.open, gate, hour: Math.floor(s.game.date.minute / 60), guests: s.guestSim.store.count };
  }, id);
  console.log(JSON.stringify(day));
  check('skiers stopped mid-descent (barStops > 0)', day.stops > 0, day.stops);
  check('the bar served guests and earned money', day.served > 0 && day.revenue > 0, { served: day.served, revenue: day.revenue });
  check('guests served today stay under the daily cap', day.today <= day.cap, { today: day.today, cap: day.cap });

  // ---- the open / closed switch and the shuttered mesh ----
  const sw = await page.evaluate((id: number) => {
    const s = (window as any).__slope, sim = s.sim, at = sim.attractions;
    s.loop.setSpeed(0); s.setHour?.(11);
    const tris = (): number => { s.buildingsView.sync(); const g = s.buildingsView.get(id); let n = 0; g.traverse((o: any) => { if (o.geometry) n += o.geometry.getAttribute('position').count / 3; }); return n; };
    const clear = (): void => { const w = sim.weather.current; w.kind = 'clear'; w.fog = 0; w.wind = 0.1; };
    clear(); at.refreshOpen(id); const openTris = tris(); const o1 = at.refreshOpen(id).open;
    const w = sim.weather.current; w.kind = 'storm'; w.wind = 1; const st = at.refreshOpen(id); const stormOpen = st.open, stormReason = st.reason; const stormGate = at.servingNow(st) && st.open; const stormTris = tris();
    clear(); at.refreshOpen(id);
    const byYou = at.setSchirmbarClosed(id, true); const youTris = tris();
    const back = at.setSchirmbarClosed(id, false); clear(); at.refreshOpen(id); const againTris = tris();
    w.kind = 'heavySnow'; w.wind = 0.1; const hs = at.refreshOpen(id).reason; clear(); w.wind = 0.5; const wind = at.refreshOpen(id).reason; w.wind = 0.1; at.refreshOpen(id);
    return { o1, openTris, storm: { open: stormOpen, reason: stormReason, tris: stormTris, gate: stormGate }, byYou, youTris, back, againTris, hs, wind };
  }, id);
  console.log(JSON.stringify(sw));
  check('clear winter day: open', sw.o1);
  check('storm: closed with the reason, no music gate, the shuttered (lighter) mesh', !sw.storm.open && sw.storm.reason === 'Closed: storm' && !sw.storm.gate && sw.storm.tris < sw.openTris, sw);
  check('the player switch closes it ("Closed by you") and shuts the mesh', sw.byYou?.open === false && sw.byYou.reason === 'Closed by you' && sw.youTris < sw.openTris, sw.byYou);
  check('switching it back opens it and restores the open mesh', sw.back?.open === true && Math.abs(sw.againTris - sw.openTris) < 1, sw.back);
  check('heavy snow and high wind give their own reasons', sw.hs === 'Closed: heavy snow' && sw.wind === 'Closed: high wind', { hs: sw.hs, wind: sw.wind });

  // ---- the resort name on the banner ----
  const banner = await page.evaluate((id: number) => {
    const s = (window as any).__slope, sim = s.sim;
    sim.attractions.refreshOpen(id); s.buildingsView.sync();
    const find = (): any => { const g = s.buildingsView.get(id); let m: any = null; g.traverse((o: any) => { if (o.isMesh && o.material?.map?.image?.width === 512) m = o; }); return m; };
    const read = (m: any): { w: number; h: number; red: number; light: number } => { const c = m.material.map.image, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let red = 0, light = 0; for (let i = 0; i < d.length; i += 4) { if (d[i] > 150 && d[i + 1] < 60) red++; else if (d[i] > 220 && d[i + 1] > 220) light++; } return { w: c.width, h: c.height, red, light }; };
    const m1 = find(); const r1 = m1 ? read(m1) : null; const n1 = s.buildingMeshes.bannerName;
    const set = sim.setResortName('<b>Sonnenjoch</b>  '); s.buildingsView.sync();
    const m2 = find(); const n2 = s.buildingMeshes.bannerName; const r2 = m2 ? read(m2) : null;
    sim.setResortName('Hinterkogel'); s.buildingsView.sync();
    return { n1, r1, set, n2, r2, same: !!m1 && !!m2 && m1.material !== m2.material };
  }, id);
  console.log(JSON.stringify(banner));
  check('the banner texture carries the resort name (red band with light lettering)', banner.n1 === 'Hinterkogel' && !!banner.r1 && banner.r1.red > 20000 && banner.r1.light > 300, banner.r1);
  check('a rename is sanitised and reaches the banner', banner.set === 'Sonnenjoch' && banner.n2 === 'Sonnenjoch' && banner.same, { set: banner.set, n2: banner.n2 });

  if (shots) {
    const focus = (zoom: number, yaw?: number): Promise<any> => page.evaluate((zoom, yaw) => { const s = (window as any).__slope, c2 = s.renderer.controls; const b = s.sim.buildings.all().find((q: any) => q.type === 'schirmbar'); c2.target.set(b.x + b.w / 2, s.grid.getCorner(Math.round(b.x), Math.round(b.y)) * 0.5, b.y + b.h / 2); c2.zoom = 1; c2.zoomBy(zoom); if (yaw !== undefined) c2.yaw = yaw; const u = document.getElementById('ui'); if (u) u.style.display = 'none'; return 'ok'; }, zoom, yaw);
    const frame = async (name: string, hour: number, state: 'open' | 'closed'): Promise<void> => {
      await page.evaluate((hour, state, id) => { const s = (window as any).__slope, sim = s.sim, w = sim.weather.current; s.loop.setSpeed(0); s.setHour?.(hour); if (state === 'open') { w.kind = 'clear'; w.wind = 0.1; w.fog = 0; sim.attractions.setSchirmbarClosed(id, false); } else sim.attractions.setSchirmbarClosed(id, true); sim.attractions.refreshOpen(id); s.buildingsView.sync(); }, hour, state, id);
      await focus(14); await sleep(1800); await page.screenshot({ path: `.weave/shots/schirmbar-${name}.png` });
      if (state === 'open') { await page.evaluate(() => { const at = (window as any).__slope.sim.attractions; if (!at.__sv) { at.__sv = at.servingNow; at.servingNow = () => true; } }); } // QA only: the bar serves in the shot even when the harness clock says it is not serving hours
      if (state === 'open') { await focus(4); await sleep(1500); await page.screenshot({ path: `.weave/shots/schirmbar-${name}-near.png` }); }
      if (state === 'open') console.log(`apres layer (${name}):`, JSON.stringify(await page.evaluate(() => { const a = (window as any).__slope.apresNotes; const sim = (window as any).__slope.sim, at = sim.attractions, b = sim.buildings.all().find((q: any) => q.type === 'schirmbar'), t = at.get(b.id); return { drawn: a.drawn, visible: a.mesh.visible, levels: a.levels.size, time: a.time, active: b.active, open: t?.open, serving: t ? at.servingNow(t) : null, q: (window as any).__slope.renderer.quality }; })));
    };
    await frame('open-noon', 12, 'open'); await frame('open-dusk', 17.2, 'open'); await frame('closed', 12, 'closed');
    await page.evaluate((id) => { (window as any).__slope.sim.attractions.setSchirmbarClosed(id, false); }, id);
  }

  // ---- save, reload, compare ----
  const snapshot = (): Promise<any> => page.evaluate(async () => {
    const s = (window as any).__slope, sim = s.sim, imp = (u: string): Promise<any> => (new Function('u', 'return import(u)') as any)(u);
    const SS = await imp('/src/game/saveState.ts'); const h = SS.stateHash(sim); const col = SS.collectSave(sim);
    return { hash: h.hash, parts: h.parts, name: sim.resort.name, observer: JSON.stringify(col.resort), closed: sim.attractions.all().filter((a: any) => a.spec.schirmbar).map((a: any) => a.playerClosed), buildings: sim.buildings.all().map((b: any) => b.type).sort().join(',') };
  });
  await page.evaluate((id: number) => { const s = (window as any).__slope; s.loop.setSpeed(0); s.sim.attractions.setSchirmbarClosed(id, true); s.sim.setResortName('Hinterkogel'); }, id);
  const before = await snapshot();
  const slot = await page.evaluate(async () => { const s = (window as any).__slope; const r = await s.saves.save(undefined, 'schirmbar-sanity'); return (await s.saves.list())[0]?.id ?? r; });
  check('saved to a slot', !!slot, slot);
  await page.goto(`${srv.url}?load=${encodeURIComponent(slot)}`, { waitUntil: 'load', timeout: 90000 });
  await ready();
  await page.evaluate(() => (window as any).__slope.loop.setSpeed(0));
  const after = await snapshot();
  check('buildings restored', after.buildings === before.buildings);
  const RUNTIME = new Set(['sys.guests', 'sys.ops', 'networks', 'lifts']);
  const diff = Object.keys(before.parts).filter((k) => before.parts[k] !== after.parts[k] && !RUNTIME.has(k));
  check('every saved part identical after reload', diff.length === 0, diff);
  check('the resort name and the Closed switch came back', after.name === 'Hinterkogel' && after.observer === before.observer && after.closed.join() === 'true', { name: after.name, closed: after.closed });
  const post = await page.evaluate(async () => {
    const s = (window as any).__slope, loop = s.loop; loop.setSpeed(1);
    const t = loop.tickCount + 2400; let g = 0; while (loop.tickCount < t && g++ < 1e6) loop.advance(1);
    await new Promise((r) => setTimeout(r, 800)); s.materialGuard?.scan?.();
    return { guard: s.materialGuard?.count ?? -1 };
  });
  check('MaterialGuard Render problems = 0 after reload + 1 day', post.guard === 0, post);
  check('no console errors', errors.length === 0, [...new Set(errors)].slice(0, 8));
} finally { await br.close(); srv.stop(); }
console.log(fails.length ? `FAILED: ${fails.join('; ')}` : 'schirmbar sanity OK');
process.exit(fails.length ? 1 : 0);
