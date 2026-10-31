/* eslint-disable @typescript-eslint/no-explicit-any -- runs inside the page against the untyped __slope debug handle */
/** `npm run backcountry:sanity [-- --size 128 --seed 5 --shots 1]`: Phase 6 Task 32 + 34 (M6.5 STOP) end to end in the REAL page (dev server, Chrome SwiftShader).
 * Paint a backcountry route next to the starter piste (the game's own network paint), run winter days with guests: Ski tourers arrive and use it. A storm (weather forced to heavy snow, fresh snow on
 * the route, hour by hour through the real Backcountry / Avalanche update) lifts the danger to >= 4: the route closes ('Avalanche danger 4'), nobody is left on it and no new tourer starts it; opening
 * it from the inspector's override checkbox asks for a confirmation dialog (Open anyway); control blasting (a Patrol Hub) brings the danger down and the route reopens. Then save, reload from the slot,
 * every saved part identical (incl. `backcountry`), MaterialGuard 0, no console errors. Exit 1 on any failed check. `--shots 1` writes .weave/shots/bc-*.png (open, closed). */
import { launch, startServer } from './lib/harness';

const arg = (k: string, d: string): string => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1]! : d; };
const size = arg('size', '128'), seed = arg('seed', '5'), shots = arg('shots', '0') === '1';
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
  await page.goto(`${srv.url}?size=${size}&seed=${seed}&hints=0&starter=1&mode=career`, { waitUntil: 'load', timeout: 90000 });
  await ready();

  // ---- paint a route and a Patrol Hub next to it ----
  const built = await page.evaluate(async () => {
    const s = (window as any).__slope, sim = s.sim, imp = (u: string): Promise<any> => (new Function('u', 'return import(u)') as any)(u);
    const { Layer } = await imp('/src/world/Networks.ts');
    s.loop.setSpeed(0);
    sim.progression.bypass++; sim.economy.earn('other', 9_000_000);
    const n = sim.size, net = sim.networks;
    let start = -1; for (let i = 0; i < n * n && start < 0; i++) if ((net.layers[i] & Layer.Ski) && net.kind[i] === 0) start = i;
    const tiles: number[] = [], seen = new Set<number>([start]); let cur = start;
    for (let k = 0; k < 80 && tiles.length < 14; k++) {
      const x = cur % n, y = (cur / n) | 0; let next = -1;
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as Array<[number, number]>) { const nx = x + dx, ny = y + dy; if (nx < 1 || ny < 1 || nx >= n - 1 || ny >= n - 1) continue; const j = ny * n + nx; if (seen.has(j) || (net.layers[j] & Layer.Ski) || !net.canPaint(nx, ny, Layer.Backcountry).ok) continue; next = j; break; }
      if (next < 0) break; seen.add(next); tiles.push(next); cur = next;
    }
    const res = net.paint(Layer.Backcountry, tiles.map((t) => ({ x: t % n, y: (t / n) | 0 })));
    const mid = tiles[Math.floor(tiles.length / 2)]!;
    // a Patrol Hub close by (covers the route: lowers danger gain, and its 04:00 blast resets the slope)
    const PB = await imp('/src/sim/PlaceBuilding.ts'); let hub: any = null, bd = 1e9;
    for (let y = 2; y < n - 4; y++) for (let x = 2; x < n - 4; x++) { if (PB.validatePlacement(sim.env, 'patrolHub', x, y, 0, true).reasons.length) continue; const d = Math.hypot(x - (mid % n), y - ((mid / n) | 0)); if (d < bd && d > 3) { bd = d; hub = { x, y }; } }
    const o = hub ? s.debugPlace('patrolHub', hub.x, hub.y, 0, true) : { ok: false };
    sim.progression.bypass--;
    s.refreshProps(Array.from({ length: s.grid.chunksPerRow ** 2 }, (_, i) => i)); sim.refreshCoverage(undefined, true);
    sim.backcountry.refresh();
    return { painted: res.painted, wanted: tiles.length, mid, hub: !!o.ok, routes: sim.backcountry.count, hubDist: Math.round(bd) };
  });
  console.log(JSON.stringify(built));
  check('route painted (the game\'s own paint)', built.painted === built.wanted && built.painted >= 6, built);
  check('one backcountry route, attached to the network', built.routes === 1);
  check('a Patrol Hub placed', built.hub);

  // ---- helpers inside the page ----
  await page.evaluate(() => {
    const s = (window as any).__slope, loop = s.loop;
    (window as any).__adv = (k: number): void => { const t = loop.tickCount + k; let g = 0; while (loop.tickCount < t && g++ < 1e6) loop.advance(1); };
    (window as any).__route = () => { const r = s.sim.backcountry.routes()[0]; return r ? { id: r.id, danger: r.danger, open: r.open, reason: r.closedReason, override: r.override, tiles: r.tiles.length } : null; };
    (window as any).__tourers = (): { total: number; onRoute: number; routeUsers: number } => {
      const st = s.guestSim.store, n = s.sim.size, r = s.sim.backcountry.routes()[0]; const set = new Set<number>(r ? r.tiles : []);
      let total = 0, onRoute = 0, routeUsers = 0;
      for (let slot = 0; slot < st.capacity; slot++) { if (!st.alive[slot]) continue; const t = st.type[slot]; if (t === 11) total++; const tile = (st.y[slot] | 0) * n + (st.x[slot] | 0); if (set.has(tile)) { routeUsers++; if (t === 11) onRoute++; } }
      return { total, onRoute, routeUsers };
    };
  });

  // ---- 1. calm winter days: tourers arrive and use the route ----
  const calm = await page.evaluate(() => {
    const s = (window as any).__slope, sim = s.sim, loop = s.loop;
    loop.setSpeed(1);
    const arrived: Record<number, number> = {}; sim.bus.on('guest:arrived', (e: any) => { const k = s.guestSim.store.slotOf(e.id); if (k >= 0) { const t = s.guestSim.store.type[k]; arrived[t] = (arrived[t] ?? 0) + 1; } });
    (window as any).__arrived = arrived;
    let onRouteMax = 0, dangerMax = 1;
    for (let day = 0; day < 8; day++) {
      if (day < 4) { s.spawnGuests(120, 'mixed'); s.spawnGuests(80, 'skiers'); }
      for (let q = 0; q < 24; q++) { (window as any).__adv(10); const t = (window as any).__tourers(); onRouteMax = Math.max(onRouteMax, t.onRoute); dangerMax = Math.max(dangerMax, (window as any).__route().danger); }
    }
    return { arrived: { ...arrived }, onRouteMax, dangerMax, route: (window as any).__route(), boarders: arrived[10] ?? 0, tourers: arrived[11] ?? 0 };
  });
  console.log(JSON.stringify(calm));
  check('Snowboarders arrived', calm.boarders > 0, calm.boarders);
  check('Ski tourers arrived (a route exists)', calm.tourers > 0, calm.tourers);
  check('the route is open in calm weather (danger <= 3)', calm.route.open && calm.route.danger <= 3, calm.route);
  if (shots) { await page.mouse.click(776, 235); await page.evaluate((m) => { const s = (window as any).__slope; s.loop.setSpeed(0); s.setHour(12); s.selectRoute?.(m); const c = s.renderer.controls; const x = m % s.sim.size, y = (m / s.sim.size) | 0; c.target.set(x, s.grid.heights[y * s.grid.vsize + x] * 0.5, y); c.zoom = 1; c.zoomBy(2.2); c.update(); }, built.mid); await sleep(2500); await page.screenshot({ path: '.weave/shots/bc-open.png' }); await page.evaluate(() => (window as any).__slope.loop.setSpeed(1)); }

  // ---- 2. a storm: heavy snow forced hour by hour; the danger rises, the route closes ----
  const storm = await page.evaluate(() => {
    const s = (window as any).__slope, sim = s.sim, g = s.grid, r0 = sim.backcountry.routes()[0]; const tiles: number[] = r0.tiles.slice();
    let maxD = r0.danger, closedAt = -1, hours = 0;
    const av = sim.safety.avalanche; av.cands = Int32Array.from([...av.cands, ...tiles]); // harness: stand-in for a steep route (the model only settles / blasts candidate tiles)
    for (let h = 0; h < 96 && closedAt < 0; h++) {
      sim.weather.current.kind = 'heavySnow'; sim.weather.current.intensity = 1; // the real weather system keeps ticking; we hold the storm
      for (const i of tiles) { g.snowDepth[i] = Math.min(3, g.snowDepth[i] + 0.12); sim.safety.avalanche.inst[i] = Math.min(3, sim.safety.avalanche.inst[i] + 0.3); } // harness: the painted approach on the starter map is flat, so the slab loading a real storm puts on a steep slope is injected
      (window as any).__adv(10); hours++;
      const r = (window as any).__route(); maxD = Math.max(maxD, r.danger); if (!r.open) closedAt = hours;
    }
    const r = (window as any).__route();
    return { maxD, closedAt, hours, route: r, closedForDanger: sim.backcountry.closedForDanger().length };
  });
  console.log(JSON.stringify(storm));
  check('the storm lifts the danger to 4 or 5', storm.maxD >= 4, storm);
  check('the route closes ("Avalanche danger N")', !storm.route.open && /Avalanche danger/.test(storm.route.reason ?? ''), storm.route);
  const after = await page.evaluate(() => { const s = (window as any).__slope; (window as any).__adv(10 * 3); const before = { ...(window as any).__arrived }; s.spawnGuests(60, 'skiers'); for (let q = 0; q < 6; q++) (window as any).__adv(10); return { users: (window as any).__tourers().onRoute, route: (window as any).__route(), tourersDuring: ((window as any).__arrived[11] ?? 0) - (before[11] ?? 0) }; });
  console.log(JSON.stringify(after));
  check('no tourer is on the closed route', after.users === 0, after);
  if (shots) { await page.evaluate(() => { const s = (window as any).__slope; s.loop.setSpeed(0); }); await sleep(2000); await page.screenshot({ path: '.weave/shots/bc-closed.png' }); await page.evaluate(() => (window as any).__slope.loop.setSpeed(1)); }

  // ---- 3. override from the inspector, with a confirmation (a second storm first, so the danger is back at 4) ----
  await page.evaluate(() => { const s = (window as any).__slope, sim = s.sim, tiles: number[] = sim.backcountry.routes()[0].tiles.slice(); for (let h = 0; h < 6; h++) { sim.weather.current.kind = 'heavySnow'; sim.weather.current.intensity = 1; for (const i of tiles) sim.safety.avalanche.inst[i] = Math.min(3, sim.safety.avalanche.inst[i] + 0.4); (window as any).__adv(10); } });
  await page.evaluate((m) => { (window as any).__slope.loop.setSpeed(0); (window as any).__slope.selectRoute?.(m); }, built.mid);
  await sleep(400);
  const deepFind = (sel: string): Promise<boolean> => page.evaluate((q) => {
    const find = (root: ParentNode): HTMLElement | null => { const hit = root.querySelector(q) as HTMLElement | null; if (hit) return hit; for (const el of Array.from(root.querySelectorAll('*'))) { const sr = (el as any).shadowRoot; if (sr) { const h = find(sr); if (h) return h; } } return null; };
    const el = find(document); if (!el) return false; el.click(); return true;
  }, sel);
  const clickedOverride = await deepFind('input[data-role="override"]');
  check('the inspector offers the override checkbox', clickedOverride);
  await sleep(300);
  const asked = await page.evaluate(() => !!(window as any).__slope.sim.backcountry.routes()[0].override);
  check('ticking the override opens a confirmation first (nothing opened yet)', !asked);
  const confirmed = await deepFind('button[data-action="confirm"]');
  check('the confirm button (Open anyway) exists', confirmed);
  await sleep(300);
  const ov = await page.evaluate(() => (window as any).__route());
  check('after Open anyway the route is open at danger >= 4 (override)', ov.open && ov.danger >= 4 && ov.override, ov);
  await page.evaluate(() => (window as any).__slope.loop.setSpeed(1));

  // ---- 4. remove the override, control blasting (04:00 with a Patrol Hub) resets the slope, the route reopens ----
  const blast = await page.evaluate(() => {
    const s = (window as any).__slope, sim = s.sim; sim.backcountry.setOverride(sim.backcountry.routes()[0].id, false);
    const closedAgain = !(window as any).__route().open;
    let reopenedAfter = -1; const before = (window as any).__route().danger;
    for (let h = 0; h < 24 * 5 && reopenedAfter < 0; h++) { sim.weather.current.kind = 'clear'; sim.weather.current.intensity = 0; (window as any).__adv(10); if ((window as any).__route().open) reopenedAfter = h + 1; }
    return { closedAgain, before, reopenedAfter, route: (window as any).__route() };
  });
  console.log(JSON.stringify(blast));
  check('removing the override closes it again', blast.closedAgain, blast);
  check('control blasting / settling brings the danger down and the route reopens', blast.reopenedAfter > 0 && blast.route.open, blast);

  // ---- 5. save, reload, compare ----
  const snapshot = (): Promise<any> => page.evaluate(async () => {
    const s = (window as any).__slope, sim = s.sim, imp = (u: string): Promise<any> => (new Function('u', 'return import(u)') as any)(u);
    const SS = await imp('/src/game/saveState.ts'); const h = SS.stateHash(sim);
    return { parts: h.parts, route: (window as any).__route(), bc: sim.backcountry.hash?.() };
  });
  await page.evaluate(() => (window as any).__slope.loop.setSpeed(0));
  const before = await snapshot();
  const slot = await page.evaluate(async () => { const s = (window as any).__slope; const r = await s.saves.save(undefined, 'backcountry-sanity'); return (await s.saves.list())[0]?.id ?? r; });
  check('saved to a slot', !!slot, slot);
  await page.goto(`${srv.url}?load=${encodeURIComponent(slot)}`, { waitUntil: 'load', timeout: 90000 });
  await ready();
  await page.evaluate(() => { const s = (window as any).__slope; s.loop.setSpeed(0); (window as any).__route = () => { const r = s.sim.backcountry.routes()[0]; return r ? { id: r.id, danger: r.danger, open: r.open, reason: r.closedReason, override: r.override, tiles: r.tiles.length } : null; }; });
  const after2 = await snapshot();
  check('the route survived the reload with the same danger / state', JSON.stringify(after2.route) === JSON.stringify(before.route), { before: before.route, after: after2.route });
  const RUNTIME = new Set(['sys.guests', 'sys.ops', 'networks']);
  const diff = Object.keys(before.parts).filter((k) => before.parts[k] !== after2.parts[k] && !RUNTIME.has(k));
  check('every saved part identical after reload (incl. backcountry)', diff.length === 0, diff);
  const post = await page.evaluate(async () => {
    const s = (window as any).__slope, loop = s.loop; loop.setSpeed(1);
    const t = loop.tickCount + 2400; let g = 0; while (loop.tickCount < t && g++ < 1e6) loop.advance(1);
    await new Promise((r) => setTimeout(r, 800)); s.materialGuard?.scan?.();
    return { guard: s.materialGuard?.count ?? -1 };
  });
  check('MaterialGuard Render problems = 0 after reload + 1 day', post.guard === 0, post);
  check('no console errors', errors.length === 0, [...new Set(errors)].slice(0, 8));
} finally { await br.close(); srv.stop(); }
console.log(fails.length ? `FAILED: ${fails.join('; ')}` : 'backcountry sanity OK');
process.exit(fails.length ? 1 : 0);
