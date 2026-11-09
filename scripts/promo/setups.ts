/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate bodies poke the untyped window.__slope debug handle */
/** Scene staging for the promo storyboard (scripts/promo/stage.ts). Each setup id in `promo/scenes.json` maps to a page-side step here.
 * Everything goes through the game's own APIs (demo resort builder, placement rules with the Career unlock bypass, river / landscape tools, events, weather,
 * atmosphere forcing, `jumpSimToDay`). No sim hooks were added: what cannot be staged is listed in docs/promo-video.md. */
import type { Page } from 'puppeteer-core';

export interface StageInfo { failed: string[]; notes: Record<string, unknown> }

/** Jump the sim to a real calendar date + hour (instant snow / weather settle). */
async function setDate(page: Page, month: number, dom: number, hour: number): Promise<void> {
  await page.evaluate(async (a) => {
    const P = (window as any).__promo, s = (window as any).__slope;
    const { simDayOf } = await P.imp('/src/sim/calendar.ts');
    s.jumpSimToDay(simDayOf(a.month, a.dom), a.hour);
  }, { month, dom, hour });
}

export async function runSetups(page: Page, sc: any): Promise<StageInfo> {
  const info: StageInfo = { failed: [], notes: {} };
  const st = sc.start ?? {};
  // 1 sim tick = 10 game minutes (150 ticks a day): start ~1.7 h early so a crowd spawned now has settled by the scene hour
  const early = (sc.setups ?? []).some((x: string) => String(x).startsWith('guests')) ? 1.7 : 0;
  if (st.month !== undefined) await setDate(page, st.month, st.dom ?? 1, (st.hour ?? 10) - early);
  for (const id of sc.setups ?? []) {
    const [kind, a1, a2] = String(id).split(':');
    try {
      const r = await page.evaluate(async (kind2: string, a: string | undefined, b: string | undefined) => {
        const P = (window as any).__promo, s = (window as any).__slope, sim = s.sim; const out: any = { log: [] };
        sim.progression.bypass = Math.max(1, sim.progression.bypass);
        if (kind2 === 'base-large') {
          const r = s.populateDemo('large'); P.report = r; P.pistes = r.pisteMids;
          out.placed = r.placed; out.lifts = r.lifts; out.failures = r.failures;
        } else if (kind2 === 'guests') {
          s.spawnGuests(Number(a), (b as any) ?? 'mixed'); P.adv(10);
        } else if (kind2 === 'crowd') { s.spawnGuests(Number(a), (b as any) ?? 'mixed');
        } else if (kind2 === 'run-in') { P.adv(Number(a)); }
        else if (kind2 === 'lift-draw' || kind2 === 'run-paint') { out.log.push('still shows the finished build; the animated build needs the 7.6.1 frame-step hook + a staged-build mode'); }
        else if (kind2 === 'apres') {
          const bar = await P.place('apresBar', 'baseLodge', 24); out.bar = !!bar;
          // a Schirmbar beside the busiest ski line: the tile row nearest the red run mid-point that accepts one (the real placement rules)
          const { findSite } = await P.imp('/src/tutorial/suggest.ts');
          let sb: any = null;
          const bottoms = sim.lifts.all().map((l: any) => l.bottom);
          for (const bt of bottoms) { for (const [dx, dy] of [[4, -6], [-4, -6], [6, -3], [-6, -3], [3, -10], [0, -8]]) { const site = findSite(sim, 'schirmbar', { x: bt.x + dx, y: bt.y + dy }, { rmax: 4 }); if (site) { const o = s.debugPlace('schirmbar', site.x, site.y, site.rot, true); if (o.ok) { sb = o.building; break; } } } if (sb) break; }
          out.schirmbar = !!sb; if (sb) P.schirmbar = sb;
          P.refresh();
          const at = sim.attractions; if (!at.__sv) { at.__sv = at.servingNow; at.servingNow = () => true; } // QA only: the bars serve in the still whatever the harness clock says
          s.events.start('christmasMarket'); // bunting, flags + the street dressing
          s.spawnGuests(70, 'mixed'); P.adv(6);
        } else if (kind2 === 'grooming-night') {
          s.setHour(null); out.groomers = sim.ops.grooming?.vehiclesOf ? 1 : 0;
        } else if (kind2 === 'river') {
          // the village stream (natural Stream tiles) nearest the lodge with a few stream tiles around it; a dug river would only reach the map edge on this seed (8 tiles)
          const lodge = P.bld('baseLodge'); const st: any[] = [];
          const W = await P.imp('/src/world/Streams.ts');
          for (const way of W.waterways(sim.terrainInfo.streams, sim.rivers.rivers)) {
            const f = sim.flow.get(way.id);
            way.path.forEach((p: any, k: number) => { if (f && f.cls[k] >= 1) st.push({ x: p.x, y: p.y, cls: f.cls[k], d: Math.hypot(p.x - lodge.x, p.y - lodge.y), way: way.id }); });
          }
          st.sort((p1, p2) => p1.d - p2.d);
          out.briskTiles = st.length; P.river = st.slice(0, 12); out.nearest = st.slice(0, 3).map((q) => [q.x, q.y, Math.round(q.d)]);
          out.riverAt = P.river[0] ?? null;
        } else if (kind2 === 'rafting') {
          const b = P.river?.length ? await P.place('raftingBase', 'river', 14) : null; out.rafting = !!b;
          if (b) { const g = s.grid; let cleared = 0; for (let y = b.y - 9; y < b.y + b.h + 9; y++) for (let x = b.x - 9; x < b.x + b.w + 9; x++) if (x > 1 && y > 1 && x < g.size - 1 && y < g.size - 1 && g.tileType[y * g.size + x] === 4) { g.tileType[y * g.size + x] = 0; cleared++; } out.clearedForest = cleared; } // QA staging: a clearing around the remote base so it reads from the air
          P.refresh();
        } else if (kind2 === 'skystrip') {
          for (const t of ['grassStrip', 'skydiveCentre', 'landingField']) { const b = await P.place(t, 'baseLodge', 40); out[t] = !!b; }
          out.log.push(...P.log);
          const top = sim.lifts.all()[0].top; let ramp: any = null;
          const tiles = sim.networks.pisteComponents().flatMap((c: any) => c.tiles).map((i: number) => ({ x: i % sim.size, y: (i / sim.size) | 0 })).sort((p1: any, p2: any) => Math.hypot(p1.x - top.x, p1.y - top.y) - Math.hypot(p2.x - top.x, p2.y - top.y));
          for (const t of tiles.slice(0, 400)) { for (const [dx, dy] of [[2, 0], [-3, 0], [0, 2], [0, -3]]) { const o = s.debugPlace('launchRamp', t.x + dx, t.y + dy, 0, true); if (o.ok) { sim.buildings.reevaluate(); sim.refreshCoverage(undefined, true); if (o.building.active) { ramp = o.building; break; } sim.buildings.remove(o.building.id); } } if (ramp) break; }
          out.launchRamp = !!ramp; P.refresh();
          s.spawnGuests(260, 'mixed'); P.adv(4);
          // QA only (render side, like the Schirmbar serving override): the demo crowd rarely jumps, so the sky centres / ramps report a few users for the still
          const sa = s.skyActivity; if (!sa.__c) { sa.__c = sa.centres; sa.__r = sa.ramps; sa.centres = () => Array.from(sa.__c()).map((c: any) => ({ ...c, users: Math.max(c.users, 4), open: true })); sa.ramps = () => Array.from(sa.__r()).map((r: any) => ({ ...r, users: Math.max(r.users, 3), open: true })); }
          let best = { t: 0, n: 0 }; s.skyActivity.far = false; s.skyActivity.lastTick = -1;
          for (let q = 0; q < 900; q++) { P.adv(1); P.clearWeather(); const tick = s.loop.tickCount; s.skyActivity.lastTick = -1; s.skyActivity.update(tick); const d = s.skyActivity.drawn; const n = d.canopies * 2 + d.gliders * 2 + d.planes; if (n > best.n) best = { t: tick, n, ...d }; if (d.canopies >= 2 && d.planes >= 1 && (d.gliders >= 1 || q > 450)) break; }
          out.sky = best; P.skyTick = best.t;
        } else if (kind2 === 'concert') {
          out.concert = s.events.start('mountainConcertSummer', 2); // dressing is built on the next render frame (tick untouched)
        } else if (kind2 === 'almabtrieb') {
          out.alm = s.events.start('almabtrieb'); P.adv(4);
        } else if (kind2 === 'sled' || kind2 === 'coaster') {
          const t = kind2 === 'sled' ? { type: 'sledRental', layer: 'Sled', how: 'path', step: 1 } : { type: 'alpineCoaster', layer: 'Coaster', how: 'road', step: 2 };
          const g = s.grid, { Bot } = await P.imp('/src/game/bot.ts'), W = await P.imp('/src/world/Networks.ts'), PB = await P.imp('/src/sim/PlaceBuilding.ts');
          const bot: any = new Bot(sim, { starter: false });
          const lodge = P.bld('baseLodge');
          const free = (x: number, y: number): boolean => x >= 2 && y >= 2 && x < g.size - 2 && y < g.size - 2 && g.occupancy.flags[y * g.size + x] === 0 && sim.networks.kind[y * g.size + x] === 0 && sim.networks.layers[y * g.size + x] === 0 && g.tileType[y * g.size + x] === 0;
          let best: any = null, bd = 1e9; const len0 = 16; const best0 = (v: number, s0: number, j: number, k: number): number => s0 + (v ? v * j : k);
          for (let pass = 0; pass < 3 && !best; pass++) { const natOnly = pass === 0;  // pass 0: the hill already falls fast enough (nothing carved); pass 1: it mostly falls, the missing fall is cut into it
          for (let y = 4; y < g.size - 6; y++) for (let x = 4; x < g.size - 6; x++) {
            if (PB.validatePlacement(sim.env, t.type, x, y, 0, true).reasons.length) continue;
            const d = Math.hypot(x - lodge.x, y - lodge.y); if (d < 14 || d >= bd) continue;
            for (const [vx, vy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as Array<[number, number]>) {
              const w = t.type === 'alpineCoaster' ? 4 : 3, h = t.type === 'alpineCoaster' ? 3 : 2;
              const sx = vx > 0 ? x + w : vx < 0 ? x - 1 : x, sy = vy > 0 ? y + h : vy < 0 ? y - 1 : y;
              let ok = true; for (let j = 0; j < 16 && ok; j++) for (let k = -1; k <= 1 && ok; k++) { const px = vx ? sx + vx * j : sx + k, py = vy ? sy + vy * j : sy + k; if (!free(px, py)) ok = false; }
              if (ok) {
                // natural fall along the corridor centre (half-steps per tile): the rail needs `step` a tile; when the hill already falls that fast nothing is carved (a carved ramp is a giant grey wall from the air)
                let nat = true; for (let j = 0; j < len0; j++) { const ax = best0(vx, sx, j, 0), ay = best0(vy, sy, j, 0), bx = best0(vx, sx, j + 1, 0), by = best0(vy, sy, j + 1, 0); if (g.getCorner(ax, ay) - g.getCorner(bx, by) < t.step) nat = false; }
                let fall = 0; for (let j = 0; j < len0; j++) fall += g.getCorner(best0(vx, sx, j, 0), best0(vy, sy, j, 0)) - g.getCorner(best0(vx, sx, j + 1, 0), best0(vy, sy, j + 1, 0));
                if (natOnly ? !nat : fall < len0 * t.step * (pass === 1 ? 0.3 : -99)) continue; if (d > (t.type === 'sledRental' ? 27 : 42)) continue;
                bd = d; best = { x, y, vx, vy, sx, sy, nat }; break;
              }
            }
          }
          }
          if (!best) { out.log.push(`${t.type}: no valid site`); }
          else {
            const o = s.debugPlace(t.type, best.x, best.y, 0, true);
            if (!o.ok) out.log.push(o.reasons?.join('|'));
            else {
              const b = o.building; const ring: any[] = [];
              for (let x = lodge.x; x < lodge.x + lodge.w; x++) ring.push({ x, y: lodge.y - 1 }, { x, y: lodge.y + lodge.h });
              for (let y = lodge.y; y < lodge.y + lodge.h; y++) ring.push({ x: lodge.x - 1, y }, { x: lodge.x + lodge.w, y });
              bot.ensure(t.how === 'road' ? W.NetKind.Road : W.NetKind.Path, b, t.how === 'road' ? [sim.networks.roadEntry] : ring);
              const len = 16;
              if (!best.nat) { // cut only what is missing: the rail height never exceeds the hill and falls `step` per tile
                let prev = 1e9;
                for (let j = 0; j <= len; j++) {
                  const cx = best.vx ? best.sx + best.vx * j + (best.vx < 0 ? 1 : 0) : best.sx, cy = best.vy ? best.sy + best.vy * j + (best.vy < 0 ? 1 : 0) : best.sy;
                  const nat = g.getCorner(cx, cy); const h = Math.max(0, Math.min(nat, prev - t.step)); prev = h;
                  for (let k = -1; k <= 2; k++) { const px = best.vx ? cx : cx + k, py = best.vy ? cy : cy + k; if (g.getCorner(px, py) > h) g.setCornerUnchecked(px, py, h); }
                }
              }
              const line = Array.from({ length: len }, (_, j) => ({ x: best.sx + best.vx * j, y: best.sy + best.vy * j }));
              out.natural = !!best.nat; out.painted = sim.networks.paint(W.Layer[t.layer], line).painted;
              P.refresh(); sim.tick(1); out.active = b.active; out.at = { x: b.x, y: b.y };
              s.spawnGuests(150, 'mixed'); s.spawnGuests(60, 'adventure'); P.adv(8);
            }
          }
        } else out.log.push(`unknown setup ${kind2}`);
        return out;
      }, kind!, a1, a2);
      info.notes[id] = r;
    } catch (e) { info.failed.push(`${id}: ${String(e).slice(0, 160)}`); }
  }
  return info;
}

/** Apply a camera keyframe (date / hour / weather overrides first), return what was set. */
export async function shootKey(page: Page, sc: any, k: any): Promise<unknown> {
  if (k.month !== undefined) await setDate(page, k.month, k.dom ?? 1, k.hour ?? sc.start?.hour ?? 10);
  else if (k.hour !== undefined) await page.evaluate((h: number) => { const s = (window as any).__slope; s.jumpSimToDay(s.sim.game.date.day, h); }, k.hour); // same day, new hour (night)
  if (k.worn) await page.evaluate(() => { const s = (window as any).__slope, sim = s.sim, q = sim.ops.quality; for (let i = 0; i < sim.size * sim.size; i++) if (sim.networks.pisteAt(i % sim.size, (i / sim.size) | 0)) q.state[i] = 5; }); // a hard day of skiing: the snowcats have work
  if (k.advance) await page.evaluate((n: number) => { const P = (window as any).__promo; P.adv(n); P.freeze(); }, k.advance);
  return page.evaluate(async (scene: any, key: any) => {
    const P = (window as any).__promo, s = (window as any).__slope;
    const hour = key.visualHour ?? key.hour ?? scene.start?.hour;
    if (s.view?.mode && s.view.mode !== 'iso' && key.view !== 'lift' && key.view !== 'ride') { try { s.view.exit?.(); } catch { /* ignore */ } }
    if (key.weather) P.weather(key.weather, key.weather === 'clear' ? 0 : 1, 0.1, 0);
    else if (scene.weather) P.weather(scene.weather.kind, scene.weather.intensity ?? (scene.weather.kind === 'clear' ? 0 : 1), scene.weather.wind ?? 0.1, scene.weather.fog ?? 0);
    s.lighting.disableNight = false;
    s.atmos.force({ ...(scene.atmos ?? {}), hour });
    let cam: any;
    if (key.view === 'lift' || key.view === 'ride') {
      const loop = s.loop; if (loop.paused) loop.setSpeed(1);
      let id = 0, tries = 0;
      if (key.view === 'lift') { while (!s.view.liftRiders(key.family ?? 'chair') && tries++ < 600) P.adv(5); id = s.view.rideLift(key.family ?? 'chair'); let g2 = 0; while (id && g2++ < 300) { const p = s.view.liftProgress(id); if (p > 0.35 && p < 0.65) break; P.adv(2); id = s.view.rideLift(key.family ?? 'chair'); } }
      else { while (!s.view.skiers() && tries++ < 400) P.adv(5); id = s.view.rideAuto(); }
      cam = { ok: !!id, view: key.view, id };
    } else cam = await P.cam(key);
    s.loop.setSpeed(0);
    await new Promise((r) => setTimeout(r, 1200));
    const { sunTimes } = await P.imp('/src/sim/Daylight.ts'); const t = sunTimes(s.sim.game.date.day), a = s.atmos.state();
    return { ...cam, cats: s.sim.ops.grooming.cats.length, hour, sun: [+t.sunrise.toFixed(1), +t.sunset.toFixed(1)], glow: +(a.glow ?? 0).toFixed(2), alp: +(a.alpenglow ?? 0).toFixed(2), fog: +(a.fog ?? 0).toFixed(2), stars: +(a.stars ?? 0).toFixed(2), guests: s.guestSim.store.count };
  }, sc, k);
}
