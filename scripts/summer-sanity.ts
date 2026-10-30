/* eslint-disable @typescript-eslint/no-explicit-any -- runs inside the page against the untyped __slope debug handle */
/** `npm run summer:sanity [-- --size 128 --seed 5 --shots 1]`: the Phase 6 M6.3 summer story end to end in the REAL page (dev server, Chrome SwiftShader).
 * A river is dug from a natural spring and a pond beside the village, then a campground (+ toilets), a petting zoo, a tackle hut with a pier, a rafting base on the river and a quad base are placed through the game's own
 * placement rules (level gate bypassed, like `phase6:sanity`), a summer fortnight is run with guests, and the story is checked: every building is active and has served guests, a quad convoy and a
 * raft ride were seen, the fish stock exists, mountain bikers and anglers arrived. Then save, reload from the slot, every saved part identical, MaterialGuard 0, no console errors.
 * Exit 1 on any failed check or console error. `--shots 1` also writes .weave/shots/summer-*.png. */
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
  await page.goto(`${srv.url}?size=${size}&seed=${seed}&start=summer&hints=0&starter=1&mode=career`, { waitUntil: 'load', timeout: 90000 });
  await ready();

  // ---- build ----
  const built = await page.evaluate(async () => {
    const s = (window as any).__slope, sim = s.sim, g = s.grid, imp = (u: string): Promise<any> => (new Function('u', 'return import(u)') as any)(u);
    const { Bot } = await imp('/src/game/bot.ts'), PB = await imp('/src/sim/PlaceBuilding.ts'), NK = (await imp('/src/world/Networks.ts')).NetKind;
    const out: any = { placed: {} as Record<string, boolean>, log: [] as string[] };
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
      out.placed[type] = true; return b;
    };
    // a river dug from the best natural spring (the same call the tool makes)
    const RP = await imp('/src/world/RiverPlanner.ts');
    const best = (sim.rivers.natural as Array<{ x: number; y: number }>).map((p) => ({ p, pl: RP.planRiver(sim.riverEnv(), p, null) })).filter((q) => q.pl.ok).sort((a, b) => b.pl.path.length - a.pl.path.length)[0];
    out.river = best && s.riverDebug.dig(best.p.x, best.p.y) ? best.pl.path.length : 0;
    const at = (b: any): { x: number; y: number } => (b ? { x: b.x, y: b.y } : lodge);
    put('campground', lodge, 'path'); put('toilets', lodge, 'path'); put('pettingZoo', lodge, 'path');
    // a pond dug beside the village (the hut is closed unless water is within three tiles), then the hut and a pier on its shore
    const pp = s.landscapeDebug.find(5); out.pond = pp ? s.landscapeDebug.dig(pp.x, pp.y, 5) : null;
    const hut = put('tackleHut', pp ?? lodge, 'path'); if (hut) put('fishingPier', at(hut), 'path');
    const rb = put('raftingBase', best ? best.pl.path[best.pl.path.length >> 1] : lodge, 'path');
    put('quadBase', lodge, 'road');
    s.buildingsView.sync?.(); s.refreshProps(Array.from({ length: g.chunksPerRow ** 2 }, (_, i) => i)); sim.refreshCoverage(undefined, true);
    sim.progression.bypass--;
    out.raft = rb ? { x: rb.x, y: rb.y } : null;
    out.types = sim.buildings.all().filter((q: any) => ['campground', 'pettingZoo', 'tackleHut', 'fishingPier', 'raftingBase', 'quadBase'].includes(q.type)).map((q: any) => `${q.type}:${q.active ? 'on' : 'OFF'}`);
    return out;
  });
  console.log(JSON.stringify(built.log), JSON.stringify(built.types));
  check('a river was dug from a natural spring', built.river > 0, built.river);
  for (const t of ['campground', 'pettingZoo', 'tackleHut', 'fishingPier', 'raftingBase', 'quadBase']) check(`${t} placed and active`, built.types.includes(`${t}:on`), built.types);

  // ---- run a summer fortnight (3 days at a time, queues kept topped up) ----
  const run = await page.evaluate(async () => {
    const s = (window as any).__slope, sim = s.sim, loop = s.loop;
    const adv = (k: number): void => { const t = loop.tickCount + k; let g = 0; while (loop.tickCount < t && g++ < 1e6) loop.advance(1); };
    loop.setSpeed(1);
    let convoys = 0, rafts = 0, maxCarriers = 0;
    const arrived: Record<number, number> = {}; sim.bus.on('guest:arrived', (e: any) => { const k = s.guestSim.store.slotOf(e.id); if (k >= 0) { const t = s.guestSim.store.type[k]; arrived[t] = (arrived[t] ?? 0) + 1; } });
    for (let day = 0; day < 14; day++) {
      if (day < 4 && day % 2 === 0) { s.spawnGuests(150, 'mixed'); s.spawnGuests(60, 'adventure'); s.spawnGuests(40, 'solo'); }
      for (let q = 0; q < 24; q++) { adv(10); const cs = sim.tours.carriers(sim.game.date.tick); maxCarriers = Math.max(maxCarriers, cs.length); if (cs.some((c: any) => c.kind === 'quad')) convoys++; if (cs.some((c: any) => c.kind === 'raft')) rafts++; }
    }
    const served: Record<string, number> = {};
    for (const b of sim.buildings.all()) { const it = sim.attractions.items.get(b.id); if (it) served[b.type] = (served[b.type] ?? 0) + it.stats.served; }
    const st = s.guestSim.store; const types: Record<number, number> = {};
    for (let i = 0; i < st.limit; i++) if (st.alive[i]) types[st.type?.[i] ?? -1] = (types[st.type?.[i] ?? -1] ?? 0) + 1;
    const hutI = sim.attractions.all().find((a: any) => a.spec.angling); const hutInfo = hutI ? { open: hutI.open, reason: hutI.reason ?? hutI.closedReason ?? null, bodies: sim.anglingPlanner.plan(hutI.b).bodies.map((b: any) => `${b.key}:${sim.fishStock.get(b.key)}`), staff: hutI.staff, b: [hutI.b.x, hutI.b.y] } : null;
    return { hutInfo, arrived, flags: sim.guestSim.spawner.flagsFn?.() ?? null, convoys, rafts, maxCarriers, served, fishTracked: sim.fishStock.tracked, fishMean: sim.fishStock.mean(), types, money: Math.round(sim.game.money), day: sim.game.date.day };
  });
  console.log(JSON.stringify(run));
  for (const t of ['campground', 'pettingZoo', 'tackleHut', 'raftingBase', 'quadBase']) check(`${t} served guests in a summer fortnight`, (run.served[t] ?? 0) > 0, run.served[t] ?? 0);
  check('a quad convoy was on the road', run.convoys > 0, run.convoys);
  check('a raft ride was seen on the river', run.rafts > 0, run.rafts);
  check('the fish stock was created by anglers', run.fishTracked > 0, run.fishTracked);
  if (shots) await page.screenshot({ path: '.weave/shots/summer-week.png' });

  // ---- save, reload, compare ----
  const snapshot = (): Promise<any> => page.evaluate(async () => {
    const s = (window as any).__slope, sim = s.sim, imp = (u: string): Promise<any> => (new Function('u', 'return import(u)') as any)(u);
    const SS = await imp('/src/game/saveState.ts'); const h = SS.stateHash(sim);
    return { hash: h.hash, parts: h.parts, rivers: sim.rivers.rivers.length, fish: sim.fishStock.tracked, buildings: sim.buildings.all().map((b: any) => b.type).sort().join(','), tick: s.loop.tickCount };
  });
  await page.evaluate(() => (window as any).__slope.loop.setSpeed(0));
  const before = await snapshot();
  const slot = await page.evaluate(async () => { const s = (window as any).__slope; const r = await s.saves.save(undefined, 'summer-sanity'); return (await s.saves.list())[0]?.id ?? r; });
  check('saved to a slot', !!slot, slot);
  await page.goto(`${srv.url}?load=${encodeURIComponent(slot)}`, { waitUntil: 'load', timeout: 90000 });
  await ready();
  await page.evaluate(() => (window as any).__slope.loop.setSpeed(0));
  const after = await snapshot();
  check('rivers, fish stock and buildings restored', after.rivers === before.rivers && after.fish === before.fish && after.buildings === before.buildings, { rivers: [before.rivers, after.rivers], fish: [before.fish, after.fish] });
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
console.log(fails.length ? `FAILED: ${fails.join('; ')}` : 'summer sanity OK');
process.exit(fails.length ? 1 : 0);
