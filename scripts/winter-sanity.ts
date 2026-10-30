/* eslint-disable @typescript-eslint/no-explicit-any -- runs inside the page against the untyped __slope debug handle */
/** `npm run winter:sanity [-- --size 128 --seed 5 --shots 1]`: the Phase 6 M6.4 winter story end to end in the REAL page (dev server, Chrome SwiftShader).
 * A Small Hotel and a Luxury Hotel (with its heated pool) are placed on a road, plus a Coffee Stand on the footpath, a terrace, a ski school + kids ground, through the game's own placement rules (level gate bypassed);
 * the date is set to a December weekday outside the holidays and several days are run: both hotels have served guests, the pool steams (cold air), the stand sold cups, Seniors and School groups arrived.
 * Then save, reload from the slot, every saved part identical, MaterialGuard 0, no console errors. Exit 1 on any failed check or console error. `--shots 1` also writes .weave/shots/winter-*.png. */
import { launch, startServer } from './lib/harness';

const arg = (k: string, d: string): string => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1]! : d; };
const summerRun = arg('start', 'winter') === 'summer'; // `--start summer`: the same hotels in summer (no pool steam, no December class / senior checks), for the visual check
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
  await page.evaluateOnNewDocument(() => { const add = (): void => { const st = document.createElement('style'); st.textContent = 'st-toast{display:none!important}'; document.head.appendChild(st); }; if (document.head) add(); else document.addEventListener('DOMContentLoaded', add); });
  const ready = async (): Promise<void> => { await page.waitForFunction(() => !!(window as any).__slope, { timeout: 90000 }); };
  await page.goto(`${srv.url}?size=${size}&seed=${seed}${summerRun ? '&start=summer' : ''}&hints=0&starter=1&mode=career`, { waitUntil: 'load', timeout: 90000 });
  await ready();

  // ---- build ----
  const built = await page.evaluate(async () => {
    const s = (window as any).__slope, sim = s.sim, g = s.grid, imp = (u: string): Promise<any> => (new Function('u', 'return import(u)') as any)(u);
    const { Bot } = await imp('/src/game/bot.ts'), PB = await imp('/src/sim/PlaceBuilding.ts'), NK = (await imp('/src/world/Networks.ts')).NetKind;
    const out: any = { log: [] as string[], at: {} as Record<string, { x: number; y: number }> };
    s.loop.setSpeed(0);
    sim.progression.bypass++; sim.economy.earn('other', 9_000_000);
    const bot: any = new Bot(sim, { starter: false });
    const lodge = sim.buildings.all().find((q: any) => q.type === 'baseLodge');
    const ring: Array<{ x: number; y: number }> = [];
    for (let x = lodge.x; x < lodge.x + lodge.w; x++) ring.push({ x, y: lodge.y - 1 }, { x, y: lodge.y + lodge.h });
    for (let y = lodge.y; y < lodge.y + lodge.h; y++) ring.push({ x: lodge.x - 1, y }, { x: lodge.x + lodge.w, y });
    const find = (type: string, near: { x: number; y: number }): { x: number; y: number } | null => { let best = null, bd = 1e9; for (let y = 2; y < g.size - 4; y++) for (let x = 2; x < g.size - 4; x++) { if (PB.validatePlacement(sim.env, type, x, y, 0, true).reasons.length) continue; const d = Math.hypot(x - near.x, y - near.y); if (d < bd) { bd = d; best = { x, y }; } } return best; };
    const put = (type: string, near: { x: number; y: number }, path: 'road' | 'path' | null): any => {
      const q = find(type, near); if (!q) { out.log.push(`${type}: no valid site`); return null; }
      const o = s.debugPlace(type, q.x, q.y, 0, true); if (!o.ok) { out.log.push(`${type}: ${o.reasons?.join('|')}`); return null; }
      const b = o.building;
      if (path) { bot.ensure(path === 'road' ? NK.Road : NK.Path, b, path === 'road' ? [sim.networks.roadEntry] : ring); sim.buildings.reevaluate(); sim.refreshCoverage(undefined, true); }
      out.at[type] = { x: b.x, y: b.y }; return b;
    };
    put('luxuryHotel', lodge, 'road'); put('smallHotel', lodge, 'road'); put('coffeeStand', lodge, 'path'); put('heatedTerrace', lodge, 'path'); put('toilets', lodge, 'path');
    put('skiSchoolHQ', lodge, 'path'); put('kidsGround', lodge, 'path');
    s.buildingsView.sync?.(); s.refreshProps(Array.from({ length: g.chunksPerRow ** 2 }, (_, i) => i)); sim.refreshCoverage(undefined, true);
    sim.progression.bypass--;
    out.types = sim.buildings.all().filter((q: any) => ['luxuryHotel', 'smallHotel', 'coffeeStand', 'heatedTerrace', 'toilets', 'skiSchoolHQ', 'kidsGround'].includes(q.type)).map((q: any) => `${q.type}:${q.active ? 'on' : 'OFF'}`);
    return out;
  });
  console.log(JSON.stringify(built.log), JSON.stringify(built.types));
  for (const t of ['luxuryHotel', 'smallHotel', 'coffeeStand', 'heatedTerrace', 'skiSchoolHQ', 'kidsGround']) check(`${t} placed and active`, built.types.includes(`${t}:on`), built.types);
  const focus = (name: string, zoom = 1): Promise<void> => page.evaluate((at, zoom) => { const s = (window as any).__slope, c2 = s.renderer.controls, t0 = c2.target, cam = s.renderer.camera; const b = s.sim.buildings.all().find((q: any) => q.type === at); if (!b) return; const nx = b.x + b.w / 2, ny = s.grid.heights[b.y * s.grid.vsize + b.x] * 0.5, nz = b.y + b.h / 2; t0.set(nx, ny, nz); c2.zoom = 1; c2.zoomBy(zoom); c2.update(); }, name, zoom);

  // ---- a December weekday outside the holidays, then a few days of play ----
  await page.evaluate((v) => { (window as any).__summerRun = v; }, summerRun);
  const run = await page.evaluate(async () => {
    const s = (window as any).__slope, sim = s.sim, loop = s.loop, imp = (u: string): Promise<any> => (new Function('u', 'return import(u)') as any)(u);
    const { weekdayOf } = await imp('/src/sim/Clock.ts'), { isHoliday } = await imp('/src/sim/Pricing.ts'), { realMonthOfDay, calendarDayOfMonth } = await imp('/src/sim/calendar.ts');
    const { smokeIntensity } = await imp('/src/render/Smoke.ts');
    const adv = (k: number): void => { const t = loop.tickCount + k; let g = 0; while (loop.tickCount < t && g++ < 1e6) loop.advance(1); };
    let d0 = -1; for (let d = 120; d < 130; d++) { const w = weekdayOf({ year: sim.game.date.year, day: d }); if (w < 4 && !isHoliday(d) && calendarDayOfMonth(d) <= 3) { d0 = d; break; } }
    const info: any = { d0, month: d0 >= 0 ? realMonthOfDay(d0) : -1 };
    if (d0 >= 0 && !(window as any).__summerRun) sim.game.date.day = d0;
    loop.setSpeed(1);
    const arrived: Record<number, number> = {}; sim.bus.on('guest:arrived', (e: any) => { const k = s.guestSim.store.slotOf(e.id); if (k >= 0) { const t = s.guestSim.store.type[k]; arrived[t] = (arrived[t] ?? 0) + 1; } });
    let steamMax = 0, coldest = 99;
    for (let day = 0; day < 6; day++) {
      if (day < 3) { s.spawnGuests(120, 'mixed'); s.spawnGuests(60, 'skiers'); }
      for (let q = 0; q < 24; q++) { adv(10); const temp = sim.weather.current.valleyT; coldest = Math.min(coldest, temp); steamMax = Math.max(steamMax, smokeIntensity('luxuryHotel', true, temp, 12, 0)); }
    }
    const served: Record<string, number> = {};
    for (const b of sim.buildings.all()) { const it = sim.attractions.items.get(b.id); if (it) served[b.type] = (served[b.type] ?? 0) + it.stats.served; }
    return { info, arrived, served, steamMax, coldest, rating: sim.rating.stars, money: Math.round(sim.game.money), day: sim.game.date.day, guests: s.guestSim.store.count };
  });
  console.log(JSON.stringify(run));
  if (!summerRun) check('found a December weekday outside the holidays', run.info.d0 >= 0, run.info);
  for (const t of summerRun ? ['smallHotel', 'coffeeStand'] : ['luxuryHotel', 'smallHotel', 'coffeeStand']) check(`${t} served guests`, (run.served[t] ?? 0) > 0, run.served[t] ?? 0);
  if (!summerRun) check('the pool steams in the cold air (intensity > 0)', run.steamMax > 0, { steam: run.steamMax, coldest: run.coldest });
  if (!summerRun) check('Seniors arrived', (run.arrived[8] ?? 0) > 0, run.arrived[8] ?? 0);
  if (!summerRun) check('School groups arrived (one class = a teacher + children)', (run.arrived[9] ?? 0) > 0, run.arrived[9] ?? 0);
  if (shots) {
    await page.mouse.click(776, 235); // dismiss the level-up card
    await page.evaluate(() => { const s = (window as any).__slope; s.loop.setSpeed(0); s.setHour(12); });
    await focus('luxuryHotel', 2.2); await new Promise((r) => setTimeout(r, 2500)); await page.screenshot({ path: `.weave/shots/${summerRun ? 'summer' : 'winter'}-luxury-day4.png` });
    await page.evaluate(() => (window as any).__slope.setHour(21.5)); await new Promise((r) => setTimeout(r, 2500)); await page.screenshot({ path: `.weave/shots/${summerRun ? 'summer' : 'winter'}-luxury-night4.png` });
    await page.evaluate(() => (window as any).__slope.setHour(null));
  }

  // ---- save, reload, compare ----
  const snapshot = (): Promise<any> => page.evaluate(async () => {
    const s = (window as any).__slope, sim = s.sim, imp = (u: string): Promise<any> => (new Function('u', 'return import(u)') as any)(u);
    const SS = await imp('/src/game/saveState.ts'); const h = SS.stateHash(sim);
    return { hash: h.hash, parts: h.parts, rivers: sim.rivers.rivers.length, fish: sim.fishStock.tracked, buildings: sim.buildings.all().map((b: any) => b.type).sort().join(','), tick: s.loop.tickCount };
  });
  await page.evaluate(() => (window as any).__slope.loop.setSpeed(0));
  const before = await snapshot();
  const slot = await page.evaluate(async () => { const s = (window as any).__slope; const r = await s.saves.save(undefined, 'winter-sanity'); return (await s.saves.list())[0]?.id ?? r; });
  check('saved to a slot', !!slot, slot);
  await page.goto(`${srv.url}?load=${encodeURIComponent(slot)}`, { waitUntil: 'load', timeout: 90000 });
  await ready();
  await page.evaluate(() => (window as any).__slope.loop.setSpeed(0));
  const after = await snapshot();
  check('buildings restored', after.buildings === before.buildings);
  const RUNTIME = new Set(['sys.guests', 'sys.ops', 'networks']); // unsaved guest / lift runtime and the networks render counter (see phase6:sanity)
  const diff = Object.keys(before.parts).filter((k) => before.parts[k] !== after.parts[k] && !RUNTIME.has(k));
  check('every saved part identical after reload', diff.length === 0, diff);
  const post = await page.evaluate(async () => {
    const s = (window as any).__slope, loop = s.loop; loop.setSpeed(1);
    const t = loop.tickCount + 2400; let g = 0; while (loop.tickCount < t && g++ < 1e6) loop.advance(1);
    await new Promise((r) => setTimeout(r, 800)); s.materialGuard?.scan?.();
    return { guard: s.materialGuard?.count ?? -1 };
  });
  check('MaterialGuard Render problems = 0 after reload + 1 day', post.guard === 0, post);
  check('no console errors', errors.length === 0, [...new Set(errors)].slice(0, 8));
} finally { await br.close(); srv.stop(); }
console.log(fails.length ? `FAILED: ${fails.join('; ')}` : 'winter sanity OK');
process.exit(fails.length ? 1 : 0);
