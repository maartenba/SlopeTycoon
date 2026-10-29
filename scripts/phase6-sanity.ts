/* eslint-disable @typescript-eslint/no-explicit-any -- runs inside the page against the untyped __slope debug handle */
/** `npm run phase6:sanity [-- --size 64 --seed 61 --shots 1]`: Phase 6 (rivers / springs / suspension bridge / mid-stations) end to end in the REAL page (dev server, Chrome SwiftShader).
 * Digs a river from a natural spring, bridges it with a footpath, a hiking trail and (over a pond) the suspension footbridge, adds a mid-station to a gondola, rides it in ride-along,
 * saves, reloads from the slot and asserts every record + the sim stateHash restored identically; then runs the restored game on and checks MaterialGuard ("Render problems") = 0.
 * Exit 1 on any failed check or console error. `--shots 1` also writes .weave/shots/phase6-*.png. */
import { launch, startServer } from './lib/harness';

const arg = (k: string, d: string): string => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1]! : d; };
const size = arg('size', '64'), seed = arg('seed', '5'), shots = arg('shots', '0') === '1';
const srv = await startServer();
const br = await launch();
const errors: string[] = [], fails: string[] = [];
const check = (name: string, ok: boolean, info?: unknown): void => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info === undefined ? '' : ' ' + JSON.stringify(info)}`); if (!ok) fails.push(name); };
const BOOT = `size=${size}&seed=${seed}&start=${arg('start', 'winter')}&hints=0`;
try {
  const page = await br.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`[http ${r.status()}] ${r.url()}`); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${String(e)}`));
  const ready = async (): Promise<void> => { await page.waitForFunction(() => !!(window as any).__slope, { timeout: 90000 }); };
  await page.goto(`${srv.url}?${BOOT}`, { waitUntil: 'load', timeout: 90000 });
  await ready();

  // ---- build (all through the same planners / tools the game uses) ----
  const built = await page.evaluate(async () => {
    const s = (window as any).__slope, sim = s.sim, imp = (u: string): Promise<any> => (new Function('u', 'return import(u)') as any)(u);
    const [SP, Net, Lift, Riv, GR] = await Promise.all([imp('/src/world/StrokePlan.ts'), imp('/src/world/Networks.ts'), imp('/src/sim/Lift.ts'), imp('/src/world/RiverPlanner.ts'), imp('/src/world/Grid.ts')])
    void GR;
    const out: any = { log: [] };
    sim.economy.earn('other', 5_000_000);
    out.log.push('buildings ' + sim.buildings.all().map((b: any) => b.type + '@' + b.x + ',' + b.y).join(' '));
    s.loop.setSpeed(0);
    const ST = await imp('/src/game/starterResort.ts');
    const rep = ST.buildStarterResort(sim, { lifts: 1, liftKind: 'gondola6', funds: 5_000_000 }); out.log.push('starter ' + JSON.stringify(rep.failures));
    s.buildingsView.sync(); for (const l of sim.lifts.all()) s.liftTools.view.add(l);
    s.refreshProps(Array.from({ length: sim.grid.chunksPerRow ** 2 }, (_, i) => i)); sim.refreshCoverage(undefined, true);
    sim.progression.bypass++; // the level-gated unlocks (river 2, suspension 3, chair6d 3) are tested elsewhere; this run is about the buildings
    // 1. river from a natural spring (the real tool path, with undo + chunk refresh)
    const sites = sim.rivers.natural as Array<{ x: number; y: number }>;
    out.naturalSprings = sites.length;
    let river: any = null;
    const plans = sites.map((sp) => ({ sp, p: Riv.planRiver(sim.riverEnv(), { x: sp.x, y: sp.y }, null) }));
    for (const { sp, p } of plans) out.log.push(`spring ${sp.x},${sp.y}: ${p.ok ? 'ok len ' + p.path.length : p.reason}`);
    const best = plans.filter((q) => q.p.ok).sort((a, b) => b.p.path.length - a.p.path.length)[0];
    if (best && s.riverDebug.dig(best.sp.x, best.sp.y)) river = sim.rivers.rivers[sim.rivers.rivers.length - 1];
    out.river = river ? { id: river.id, len: river.path.length, src: river.source } : null;
    const n = sim.networks, g = sim.grid;
    // 2. bridges. The natural-spring river is the real thing; the footpath / trail stay where the real terrain allows it. The bridged river + the gorge are carved into the map like the unit-test
    // fixtures (setCornerUnchecked marks the chunks dirty, the terrain mesh rebuilds), props removed from the arena, because random terrain is rarely a place a 7-tile gorge fits.
    const nChunks = g.chunksPerRow ** 2;
    const allChunks = Array.from({ length: nChunks }, (_, i) => i);
    const carved: number[] = [];
    for (const [x0, y0, x1, y1] of [[14, 23, 34, 43], [43, 11, 63, 23]] as const) sim.props.removeInRect(x0, y0, x1, y1, carved);
    // Arenas: free dry rectangles found on this map (no water, no occupancy, clear of buildings and lift corridors) are carved like the unit-test fixtures.
    const free = (x0: number, y0: number, w: number, h: number): boolean => {
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const i = g.tileIndex(x, y); const t = g.tileType[i]; if (t === 2 || t === 5 || t === 6 || g.occupancy.flags[i] !== 0) return false; }
      for (const l of sim.lifts.all()) { const lx0 = Math.min(l.bottom.x, l.top.x) - 5, lx1 = Math.max(l.bottom.x, l.top.x) + 5, ly0 = Math.min(l.bottom.y, l.top.y) - 5, ly1 = Math.max(l.bottom.y, l.top.y) + 5; if (x0 < lx1 && x0 + w > lx0 && y0 < ly1 && y0 + h > ly0) return false; }
      for (const b of sim.buildings.all()) if (x0 - 6 < b.x && x0 + w + 6 > b.x && y0 - 6 < b.y && y0 + h + 6 > b.y) return false;
      return true;
    };
    const find = (w: number, h: number, not?: { x: number; y: number; w: number; h: number }): { x: number; y: number } | null => {
      for (let y = 3; y < g.size - h - 3; y++) for (let x = 3; x < g.size - w - 3; x++) if (free(x, y, w, h) && !(not && x < not.x + not.w + 2 && x + w + 2 > not.x && y < not.y + not.h + 2 && y + h + 2 > not.y)) return { x, y };
      return null;
    };
    const RW = 17, RH = 20, GW = 19, GH = 11;
    const ra = ((): { x: number; y: number } | null => { for (let x = 3; x < g.size - RW - 3; x++) if (free(x, 3, RW, RH)) return { x, y: 3 }; return null; })(), ga = ra ? find(GW, GH, { ...ra, w: RW, h: RH }) : null;
    out.log.push(`arenas river ${JSON.stringify(ra)} gorge ${JSON.stringify(ga)}`);
    if (!ra || !ga) { out.log.push('no free arena on this map: try another --seed'); return out; }
    for (const [x0, y0, w, h] of [[ra.x, ra.y, RW, RH], [ga.x, ga.y, GW, GH]] as const) { sim.props.removeInRect(x0 - 1, Math.max(0, y0 - 3), x0 + w, y0 + h, carved); for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) g.tileType[g.tileIndex(x, y)] = 0; }
    const cx = ra.x + 8, ry = ra.y;
    // the arena falls NORTH (the river ends at the map edge three tiles above it: a river must end in a lake, a stream or at the edge)
    const yS = ry + RH; // the high (south) end
    for (let vy = 0; vy <= yS; vy++) for (let vx = cx - 8; vx <= cx + 9; vx++) g.setCornerUnchecked(vx, vy, 26 - ((yS - vy) >> 1) + (yS - vy < 5 && vx !== cx && vx !== cx + 1 ? 5 : 0));
    const spEnv = sim.riverEnv();
    const R2 = await imp('/src/world/Rivers.ts');
    const sy = yS - 3;
    const spl = R2.planSpring(spEnv, sim.rivers, cx, sy); out.log.push('player spring ' + (spl.ok ? 'ok' : spl.reason));
    if (spl.ok) R2.applySpring(spEnv, sim.rivers, spl);
    const rp = Riv.planRiver(sim.riverEnv(), { x: cx, y: sy }, null); out.log.push('arena river ' + (rp.ok ? 'len ' + rp.path.length + ' end ' + rp.end : rp.reason));
    if (rp.ok) { const ap = Riv.applyRiver(sim.riverEnv(), sim.rivers, rp); out.arena = ap.ok; out.arenaLen = rp.path.length; out.log.push('arena path ' + rp.path.map((q: any) => q.x + ',' + q.y).join(' ')); }
    const row = (a: number, b: number, y: number): any[] => Net.lineTiles({ x: a, y }, { x: b, y });
    const fy = sy - 8, hy = sy - 12;
    n.buildSegment(Net.NetKind.Path, row(cx - 6, cx - 4, fy));
    const foot = SP.planStroke(n, g, 'path', row(cx - 4, cx + 4, fy)); out.log.push('foot ' + (foot.ok ? foot.bridges.map((b: any) => b.kind) : foot.reason));
    if (foot.ok && foot.bridges.length === 1) { SP.buildStroke(n, 'path', foot); out.foot = { kind: foot.bridges[0].kind, over: foot.bridges[0].overStream }; }
    n.paint(Net.Layer.Hike, row(cx - 6, cx - 4, hy), 0);
    const hk2 = SP.planTrailStroke(n, g, 'hike', Net.interpolateStroke(row(cx - 4, cx + 4, hy)));
    out.log.push('hike ' + (hk2.ok ? hk2.bridges.map((b: any) => b.kind + b.overStream) : hk2.reason));
    if (hk2.ok && hk2.bridges.length === 1) { SP.buildTrailStroke(n, 'hike', hk2); out.hike = { kind: hk2.bridges[0].kind, over: hk2.bridges[0].overStream }; }
    // 3. suspension footbridge: a 7-tile gorge (dry, bed at 4, shores at 10, banks at 12)
    const gx = ga.x, gy = ga.y, py = gy + 5;
    for (let vy = gy; vy <= gy + GH; vy++) for (let vx = gx; vx <= gx + GW; vx++) g.setCornerUnchecked(vx, vy, 12);
    for (let vy = gy; vy <= gy + GH; vy++) for (let vx = gx + 8; vx <= gx + 15; vx++) g.setCornerUnchecked(vx, vy, vx === gx + 8 || vx === gx + 15 ? 10 : 4);
    n.buildSegment(Net.NetKind.Path, row(gx + 1, gx + 6, py));
    const sus = SP.planStroke(n, g, 'path', row(gx + 4, gx + 17, py)); out.log.push('suspension ' + (sus.ok ? sus.bridges.map((b: any) => b.kind + b.span.length) : sus.reason));
    if (sus.ok && sus.bridges.length === 1) { SP.buildStroke(n, 'path', sus); out.pond = { kind: sus.bridges[0].kind, span: sus.bridges[0].span.length }; }
    out.arenaAt = { river: ra, gorge: ga, cx, fy, hy, py };
    s.refreshProps(allChunks);
    // 4. a mid-station on a lift of the demo resort (the same call the Add mid-station tool makes: undo-wrapped setMidStations, then onMidChanged)
    const lt = s.liftTools.tool.o;
    let lift: any = null;
    for (const l0 of sim.lifts.all().slice()) { // replace a demo lift by a gondola between the same terminals, then Add mid-station (undo-free equivalent of the tool): guests already route over its stations
      const bot = { x: l0.bottom.x, y: l0.bottom.y }, top = { x: l0.top.x, y: l0.top.y };
      const snapshot = structuredClone(l0), index = sim.lifts.indexOf(l0.id);
      Lift.demolishLift(sim.lifts, sim.economy, l0.id); s.liftTools.view.remove(l0.id);
      for (const kind of [l0.kind, 'gondola6', 'chair4d', 'chair6d']) {
        for (const u of [0.5, 0.45, 0.55, 0.4, 0.6, 0.35, 0.65]) {
          const mid = Lift.midSiteOnLine(g, bot, top, bot.x + 1 + (top.x - bot.x) * u, bot.y + 1 + (top.y - bot.y) * u);
          const o = Lift.placeLift({ ...lt.env, props: sim.props }, sim.props, kind, bot, top, true, true, [mid]);
          if (o.ok) { lt.onPlaced(o); lift = sim.lifts.get(o.lift.id); break; }
          out.log.push(`${kind} ${l0.id}@${u}: ${o.reasons.join('|').slice(0, 70)}`);
        }
        if (lift) break;
      }
      if (lift) break;
      sim.lifts.reinsert(snapshot, index); s.liftTools.view.add(sim.lifts.get(l0.id));
    }
    out.lift = lift ? { id: lift.id, kind: lift.kind, stations: lift.stations.length } : null;
    sim.progression.bypass--;
    return out;
  });
  console.log(JSON.stringify(built.log));
  check('natural springs exist', built.naturalSprings > 0, built.naturalSprings);
  check('river dug from a natural spring', !!built.river, built.river);
  check('footpath bridge over the river', built.foot?.over === true, built.foot);
  check('hiking trail bridge over the river', built.hike?.over === true, built.hike);
  check('suspension footbridge over a gorge', built.pond?.kind === 'suspensionFoot', built.pond);
  check('a lift with a mid-station (3 stations)', built.lift?.stations === 3, built.lift);

  // ---- run it, ride a gondola in ride-along ----
  const ride = await page.evaluate(async (lid: number, kind: string) => {
    const s = (window as any).__slope, loop = s.loop;
    const imp = (u: string): Promise<any> => (new Function('u', 'return import(u)') as any)(u);
    const fam = (await imp('/src/config/lifts.ts')).LIFTS[kind].family;
    const st = s.guestSim.store;
    const onLift = (): number => { let n = 0; for (let i = 0; i < st.limit; i++) if (st.alive[i] && st.state[i] === 5 && st.liftId[i] === lid) n++; return n; };
    const adv = (k: number): void => { const t = loop.tickCount + k; let g = 0; while (loop.tickCount < t && g++ < 1e6) loop.advance(1); };
    loop.setSpeed(1);
    s.spawnGuests(120, 'mixed');
    let tries = 0, id = 0;
    while (onLift() === 0 && tries++ < 1500) { adv(20); if (tries % 100 === 0) s.spawnGuests(40, 'mixed'); }
    id = s.view.rideLift(fam);
    const first = (() => { const k = st.slotOf(s.view.stats().target || id); return { lift: k >= 0 ? st.liftId[k] : -1, state: k >= 0 ? st.state[k] : -1 }; })();
    adv(30);
    const stats = s.view.stats(); const L = s.sim.lifts.get(lid);
    return { id, tries, fam, ridingLift: first.lift, wanted: lid, riders: s.view.liftRiders(fam), mode: stats.mode, state: first.state, target: stats.target, lift: L ? { open: L.open, active: L.activeMode, why: L.closedReason ?? null } : null };
  }, built.lift?.id ?? -1, built.lift?.kind ?? 'gondola6');
  check('ride-along on a mid-station lift', !!ride.id && ride.mode !== 'iso' && ride.ridingLift === ride.wanted, ride);
  if (shots) await page.screenshot({ path: '.weave/shots/phase6-ride.png' });
  await page.evaluate(() => (window as any).__slope.view.stop?.());

  // ---- save, reload, compare ----
  const snapshot = (): Promise<any> => page.evaluate(async () => {
    const s = (window as any).__slope, sim = s.sim, imp = (u: string): Promise<any> => (new Function('u', 'return import(u)') as any)(u);
    const SS = await imp('/src/game/saveState.ts');
    const h = SS.stateHash(sim);
    const fp = (d: any): Record<string, number> => { const o: Record<string, number> = {}; for (const k of Object.keys(d ?? {})) { const t = JSON.stringify(d[k], (_k, v) => (ArrayBuffer.isView(v) ? Array.from(v as any) : v)) ?? ''; let x = 0; for (let i = 0; i < t.length; i++) x = (Math.imul(x, 31) + t.charCodeAt(i)) | 0; o[k] = x; } return o; };
    const mods: any = {}; for (const m of SS.SAVE_MODULES) if (m.key === 'core' || m.key === 'networks') { mods[m.key] = fp(m.serialize(sim)); const d: any = m.serialize(sim); if (m.key === 'core') mods.loopRaw = JSON.stringify(d.loop); else mods.netVersion = d.version; }
    const n = sim.networks;
    return { hash: h.hash, parts: h.parts, mods, rivers: sim.rivers.rivers.length, springs: sim.rivers.springs.length, bridges: n.liveBridges().map((b: any) => `${b.kind}:${b.span.length}`).sort().join(','), lifts: sim.lifts.all().map((l: any) => `${l.id}:${l.kind}:${l.stations?.length ?? 2}`).join(','), tick: s.loop.tickCount };
  });
  await page.evaluate(() => (window as any).__slope.loop.setSpeed(0));
  const before = await snapshot();
  console.log('before', JSON.stringify({ ...before, parts: undefined, mods: undefined }));
  const slot = await page.evaluate(async () => { const s = (window as any).__slope; s.loop.setSpeed(0); const r = await s.saves.save(undefined, 'phase6-sanity'); return (await s.saves.list())[0]?.id ?? r; });
  check('saved to a slot', !!slot, slot);
  await page.goto(`${srv.url}?load=${encodeURIComponent(slot)}`, { waitUntil: 'load', timeout: 90000 });
  await ready();
  await page.evaluate(() => (window as any).__slope.loop.setSpeed(0));
  const after = await snapshot();
  console.log('after ', JSON.stringify({ ...after, parts: undefined, mods: undefined }));
  check('rivers restored', after.rivers === before.rivers && after.springs === before.springs);
  check('bridges restored', after.bridges === before.bridges, after.bridges);
  check('lifts (incl. mid-stations) restored', after.lifts === before.lifts, after.lifts);
  const diff = Object.keys(before.parts).filter((k) => before.parts[k] !== after.parts[k]);
  const fields = diff.flatMap((k) => Object.keys(before.mods[k] ?? {}).filter((f) => before.mods[k][f] !== after.mods[k]?.[f]).map((f) => `${k}.${f}`));
  // networks.version is a render-invalidation counter that the restore bumps once (Networks.load -> changed()); it is the only field allowed to differ
  // sys.guests / sys.ops hold runtime that is not saved by design (queues, riders on a lift at the moment of the save: `guestSim.resetRuntime()` on load), so a save taken mid-ride cannot hash the same there
  const RUNTIME = new Set(['sys.guests', 'sys.ops']);
  const real = fields.filter((f) => f !== 'networks.version'), world = diff.filter((k: string) => k !== 'networks' && !RUNTIME.has(k));
  check('every saved part identical after reload (modulo the networks.version render counter and the unsaved guest / lift-ops runtime)', real.length === 0 && world.length === 0 && after.mods.netVersion >= before.mods.netVersion, { diff, fields, loop: [before.mods.loopRaw, after.mods.loopRaw], netVersion: [before.mods.netVersion, after.mods.netVersion] });
  // the restored game runs on and renders clean
  const post = await page.evaluate(async () => {
    const s = (window as any).__slope, loop = s.loop;
    loop.setSpeed(1);
    const t = loop.tickCount + 2400; let g = 0; while (loop.tickCount < t && g++ < 1e6) loop.advance(1);
    await new Promise((r) => setTimeout(r, 800));
    s.materialGuard?.scan?.();
    return { guard: s.materialGuard?.count ?? -1, riders: s.view.liftRiders('gondola') };
  });
  check('MaterialGuard Render problems = 0 after reload + 1 day', post.guard === 0, post);
  if (shots) await page.screenshot({ path: '.weave/shots/phase6-reloaded.png' });
  check('no console errors', errors.length === 0, [...new Set(errors)].slice(0, 8));
} finally { await br.close(); srv.stop(); }
console.log(fails.length ? `FAILED: ${fails.join('; ')}` : 'phase6 sanity OK');
process.exit(fails.length ? 1 : 0);
