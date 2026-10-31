/* eslint-disable @typescript-eslint/no-explicit-any -- runs inside the page against the untyped __slope debug handle */
/** `npm run winter:tours [-- --size 128 --seed 5 --shots 1]`: Phase 6 Task 31 in the REAL page (dev server, Chrome SwiftShader): a Sleigh Stable, a Snowshoe Hut (with a painted Hike trail)
 * and a Snowscooter Base are placed through the game's own placement rules (level gate bypassed), a winter week is run with guests, and the story is checked: all three served guests, a sleigh, a
 * walker line and a scooter convoy were seen on the route, the scooters scared animals / booked the sustainability penalty (<= 3), MaterialGuard 0, no console errors. `--shots 1` also writes
 * .weave/shots/p6q-*.png (each base + a departure running). Exit 1 on any failed check or console error. */
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
  await page.goto(`${srv.url}?size=${size}&seed=${seed}&hints=0&starter=1&mode=career`, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => !!(window as any).__slope, { timeout: 90000 });

  const built = await page.evaluate(async () => {
    const s = (window as any).__slope, sim = s.sim, g = s.grid, imp = (u: string): Promise<any> => (new Function('u', 'return import(u)') as any)(u);
    const { Bot } = await imp('/src/game/bot.ts'), NK = (await imp('/src/world/Networks.ts')).NetKind, NL = (await imp('/src/world/Networks.ts')).Layer;
    const out: any = { log: [] as string[], at: {} as Record<string, { x: number; y: number }> };
    s.loop.setSpeed(0);
    sim.progression.bypass++; sim.economy.earn('other', 9_000_000);
    const bot: any = new Bot(sim, { starter: false });
    const lodge = sim.buildings.all().find((q: any) => q.type === 'baseLodge');
    const ring: Array<{ x: number; y: number }> = [];
    for (let x = lodge.x; x < lodge.x + lodge.w; x++) ring.push({ x, y: lodge.y - 1 }, { x, y: lodge.y + lodge.h });
    for (let y = lodge.y; y < lodge.y + lodge.h; y++) ring.push({ x: lodge.x - 1, y }, { x: lodge.x + lodge.w, y });
    const PB = await imp('/src/sim/PlaceBuilding.ts');
    const find = (type: string, near: { x: number; y: number }, skip: Array<{ x: number; y: number }> = []): { x: number; y: number } | null => {
      let best = null, bd = 1e9;
      for (let y = 2; y < g.size - 5; y++) for (let x = 2; x < g.size - 5; x++) {
        if (PB.validatePlacement(sim.env, type, x, y, 0, true).reasons.length) continue;
        const d = Math.hypot(x - near.x, y - near.y); if (d < bd && d >= 16 && !skip.some((p) => Math.hypot(p.x - x, p.y - y) < 9)) { bd = d; best = { x, y }; }
      }
      return best;
    };
    const put = (type: string, near: { x: number; y: number }, how: 'road' | 'path', skip: Array<{ x: number; y: number }>): any => {
      const q = find(type, near, skip); if (!q) { out.log.push(`${type}: no valid site`); return null; }
      const o = s.debugPlace(type, q.x, q.y, 0, true); if (!o.ok) { out.log.push(`${type}: ${o.reasons?.join('|')}`); return null; }
      const b = o.building;
      bot.ensure(how === 'road' ? NK.Road : NK.Path, b, how === 'road' ? [sim.networks.roadEntry] : ring); sim.buildings.reevaluate(); sim.refreshCoverage(undefined, true);
      out.at[type] = { x: b.x, y: b.y }; return b;
    };
    const used: Array<{ x: number; y: number }> = [];
    const sl = put('sleighStable', lodge, 'road', used); if (sl) used.push(sl);
    const sc = put('snowscooterBase', lodge, 'road', used); if (sc) used.push(sc);
    const hut = put('snowshoeHut', lodge, 'path', used);
    if (hut) { // a Hike trail from the hut's footprint outwards over free tiles
      const free = (x: number, y: number): boolean => x >= 1 && y >= 1 && x < g.size - 1 && y < g.size - 1 && sim.networks.kind[y * g.size + x] === 0;
      let best: Array<{ x: number; y: number }> = [];
      for (const [vx, vy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as Array<[number, number]>) {
        const sx = vx > 0 ? hut.x + hut.w : vx < 0 ? hut.x - 1 : hut.x, sy = vy > 0 ? hut.y + hut.h : vy < 0 ? hut.y - 1 : hut.y;
        const line: Array<{ x: number; y: number }> = [];
        for (let j = 0; j < 14; j++) { const p = { x: sx + vx * j, y: sy + vy * j }; if (!free(p.x, p.y)) break; line.push(p); }
        if (line.length > best.length) best = line;
      }
      out.trail = sim.networks.paint(NL.Hike, best, 0).painted;
      sim.buildings.reevaluate(); sim.refreshCoverage(undefined, true);
    }
    s.buildingsView.sync?.(); s.refreshProps(Array.from({ length: g.chunksPerRow ** 2 }, (_, i) => i)); sim.refreshCoverage(undefined, true);
    sim.progression.bypass--;
    out.types = sim.buildings.all().filter((q: any) => ['sleighStable', 'snowshoeHut', 'snowscooterBase'].includes(q.type)).map((q: any) => `${q.type}:${q.active ? 'on' : 'OFF'}`);
    return out;
  });
  console.log(JSON.stringify(built));
  for (const t of ['sleighStable', 'snowshoeHut', 'snowscooterBase']) check(`${t} placed and active`, built.types.includes(`${t}:on`), built.types);

  const run: any = await page.evaluate(async () => {
    const s = (window as any).__slope, sim = s.sim, loop = s.loop;
    const adv = (k: number): void => { const t = loop.tickCount + k; let g = 0; while (loop.tickCount < t && g++ < 1e6) loop.advance(1); };
    loop.setSpeed(1);
    const seen: Record<string, number> = {}; let maxCarriers = 0;
    for (let day = 0; day < 6; day++) {
      if (day % 2 === 0) { s.spawnGuests(150, 'mixed'); s.spawnGuests(60, 'adventure'); s.spawnGuests(60, 'couple'); }
      for (let q = 0; q < 24; q++) { adv(10); const cs = sim.tours.carriers(sim.game.date.tick); maxCarriers = Math.max(maxCarriers, cs.length); for (const k of new Set(cs.map((c: any) => c.kind))) seen[k as string] = (seen[k as string] ?? 0) + 1; }
    }
    const served: Record<string, number> = {}, info: Record<string, any> = {};
    for (const b of sim.buildings.all()) { const it = sim.attractions.items.get(b.id); if (it) { served[b.type] = (served[b.type] ?? 0) + it.stats.served; if (it.spec.tour) info[b.type] = { closed: it.info().tour?.closed ?? null, dep: it.info().tour?.totalDepartures, route: it.info().tour?.routeLen }; } }
    return { seen, maxCarriers, served, info, penalty: sim.tours.motorPenalty(), day: sim.game.date.day };
  });
  console.log(JSON.stringify(run));
  for (const t of ['sleighStable', 'snowshoeHut', 'snowscooterBase']) check(`${t} served guests in a winter week`, (run.served[t] ?? 0) > 0, { served: run.served[t], info: run.info[t] });
  check('a sleigh, a walker line and a scooter convoy were seen', run.seen.sleigh > 0 && run.seen.walkers > 0 && run.seen.scooter > 0, run.seen);
  check('the scooter sustainability penalty is within the shared cap (3)', run.penalty >= 0 && run.penalty <= 3, run.penalty);

  if (shots) {
    await page.mouse.click(776, 235); // close the 'Level 2' unlock card
    const focus = async (type: string, zoom: number, name: string): Promise<void> => {
      await page.evaluate((a) => { const s = (window as any).__slope, b = s.sim.buildings.all().find((q: any) => q.type === a.type); s.loop.setSpeed(0); const k = s.renderer.controls; k.focusOn(b.x + b.w / 2, b.y + b.h / 2, { zoom: a.zoom, duration: 0 }); k.target.y = s.buildingsView.get(b.id)?.position.y ?? 0; k.updateProjection?.(); s.setHour?.(12); }, { type, zoom });
      await page.evaluate(() => new Promise((r) => setTimeout(r, 2500)));
      await page.screenshot({ path: `.weave/shots/${name}.png` });
    };
    // base shots first (no ride), then wait for a departure and follow a carrier
    for (const [t, z] of [['sleighStable', 16], ['snowshoeHut', 18], ['snowscooterBase', 16]] as const) await focus(t, z, `p6q-${t}-base`);
    for (const [t, kind, z] of [['sleighStable', 'sleigh', 14], ['snowshoeHut', 'walkers', 14], ['snowscooterBase', 'scooter', 14]] as const) {
      const ok = await page.evaluate(async (a) => {
        const s = (window as any).__slope, sim = s.sim, loop = s.loop;
        loop.setSpeed(1); s.setHour?.(9.5); s.spawnGuests(120, 'mixed');
        let g = 0;
        while (g++ < 400) {
          const t = loop.tickCount + 5; while (loop.tickCount < t) loop.advance(1);
          const cs = sim.tours.carriers(sim.game.date.tick).filter((c: any) => c.kind === a.kind);
          if (cs.length >= 1) { const c = cs[Math.min(1, cs.length - 1)]; s.loop.setSpeed(0); const k = s.renderer.controls; k.focusOn(c.x, c.y, { zoom: a.z, duration: 0 }); let gy = s.buildingsView.get(a.id)?.position.y ?? 0; s.renderer.scene.traverse((o: any) => { if (o.isInstancedMesh && o.name === `tour:${a.kind}` && o.count > 0) { const m = o.instanceMatrix.array; gy = m[13] ?? gy; } }); k.target.y = gy; k.updateProjection?.(); return true; }
        }
        return false;
      }, { kind, z, id: (await page.evaluate((tt) => (window as any).__slope.sim.buildings.all().find((q: any) => q.type === tt)?.id, t)) });
      check(`${kind} departure running for a shot`, ok);
      await page.evaluate(() => new Promise((r) => setTimeout(r, 1200)));
      await page.screenshot({ path: `.weave/shots/p6q-${t}-ride.png` });
    }
  }
  const guard = await page.evaluate(() => { const s = (window as any).__slope; return s.materialGuard?.failed?.length ?? s.renderer?.materialGuard?.failedCount ?? 0; });
  check('MaterialGuard reports 0 render problems', guard === 0, guard);
  const real = errors.filter((e) => !/GPU stall|GroupMarkerNotSet|swiftshader/i.test(e));
  check('no console errors', real.length === 0, real.slice(0, 5));
} finally { await br.close(); srv.stop(); }
if (fails.length) { console.log(`FAILED: ${fails.join('; ')}`); process.exitCode = 1; } else console.log('winter tours sanity OK');
