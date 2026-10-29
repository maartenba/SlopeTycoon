/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate bodies poke the untyped window.__slope debug API */
import type { Rig } from './rig';
import { sleep } from './rig';

type Reg = (id: string, fn: (r: Rig) => Promise<void>, only?: string[], extra?: string) => void;

/** Screen angle of a ground point east of the camera target about the target: for the twist direction check. */
async function ringAngle(r: Rig): Promise<number> {
  const c = await r.cam();
  const p = await r.project(c.tx + 6, c.tz);
  const o = await r.project(c.tx, c.tz);
  return Math.atan2(p.y - o.y, p.x - o.x);
}

export function registerAll(reg: Reg): void {
  reg('camera', async (r) => {
    const { w, h } = r.size;
    await r.resetView(2);
    let c0 = await r.cam();
    await r.swipe(w * 0.3, h * 0.5, w * 0.6, h * 0.35);
    let c1 = await r.cam();
    await r.check('one-finger drag pans the map (select tool)', Math.hypot(c1.tx - c0.tx, c1.tz - c0.tz) > 1, `moved ${Math.hypot(c1.tx - c0.tx, c1.tz - c0.tz).toFixed(2)} tiles`);
    await r.resetView(2);
    const ctr = await r.cam();
    const before = await r.project(ctr.tx, ctr.tz);
    await r.swipe(w * 0.3, h * 0.5, w * 0.5, h * 0.5, 10);
    const after = await r.project(ctr.tx, ctr.tz);
    await r.check('pan: the world follows the finger', Math.abs(after.x - before.x - w * 0.2) < w * 0.05 && Math.abs(after.y - before.y) < 15, `moved ${(after.x - before.x).toFixed(0)},${(after.y - before.y).toFixed(0)}px for ${(w * 0.2).toFixed(0)}px swipe; cam ${JSON.stringify(await r.cam())}`);

    await r.resetView(2);
    c0 = await r.cam();
    await r.two(w / 2, h / 2, 60, 200);
    c1 = await r.cam();
    await r.check('pinch out zooms in', c1.zoom > c0.zoom * 1.5, `zoom ${c0.zoom.toFixed(2)} -> ${c1.zoom.toFixed(2)}`);
    c0 = await r.cam();
    await r.two(w / 2, h / 2, 200, 70);
    c1 = await r.cam();
    await r.check('pinch in zooms out', c1.zoom < c0.zoom * 0.6, `zoom ${c0.zoom.toFixed(2)} -> ${c1.zoom.toFixed(2)}`);

    for (const [deg, label] of [[60, 'clockwise'], [-45, 'counter-clockwise']] as const) {
      await r.resetView(2);
      const y0 = (await r.cam()).yaw, ang0 = await ringAngle(r);
      await r.two(w / 2, h / 2, 140, 140, 0, deg * Math.PI / 180, [0, 0], 16);
      const y1 = (await r.cam()).yaw, ang1 = await ringAngle(r);
      const dy = y1 - y0;
      let sa = ang1 - ang0; while (sa > Math.PI) sa -= 2 * Math.PI; while (sa < -Math.PI) sa += 2 * Math.PI;
      const want = Math.abs(deg) * Math.PI / 180;
      await r.check(`twist ${label} ${deg} deg: yaw changes by the same amount`, Math.abs(Math.abs(dy) - want) < 0.2 * want + 0.05, `yaw delta ${(dy * 180 / Math.PI).toFixed(1)} deg`);
      await r.check(`twist ${label}: the map turns the same way as the fingers`, Math.sign(sa) === Math.sign(deg), `ground point screen angle delta ${(sa * 180 / Math.PI).toFixed(1)} deg`);
    }
    await r.resetView(2);
    c0 = await r.cam();
    await r.two(w / 2, h / 2, 140, 140, 0, Math.PI / 2, [0, 0], 16);
    c1 = await r.cam();
    await r.check('pure twist keeps the zoom (< 6%)', Math.abs(c1.zoom / c0.zoom - 1) < 0.06, `zoom x${(c1.zoom / c0.zoom).toFixed(3)}`);
    await r.resetView(2);
    c0 = await r.cam();
    await r.two(w / 2, h / 2, 100, 100, 0, 0, [90, 40], 30, 8);
    c1 = await r.cam();
    await r.check('two-finger drag pans', Math.hypot(c1.tx - c0.tx, c1.tz - c0.tz) > 0.8 && Math.abs(c1.zoom / c0.zoom - 1) < 0.05, `moved ${Math.hypot(c1.tx - c0.tx, c1.tz - c0.tz).toFixed(2)} zoom x${(c1.zoom / c0.zoom).toFixed(3)}`);
    await r.shot(`camera-${r.vp}`);
    void sleep;
  });

  reg('placement', async (r) => {
    const { w, h } = r.size;
    await r.s((s) => { s.economy.state.money = 9e6; });
    await r.resetView(2.5);
    const count = (): Promise<number> => r.s((s) => s.buildings.all().length);

    // find a valid spot by tapping candidate ground tiles around the lodge (real taps; the ghost validity is read from the tool)
    await r.s((s) => s.startPlacement('shop'));
    await sleep(300);
    await r.check('placement tool active, touch bar visible', (await r.tool()) === 'placement' && !!(await r.rect({ css: '[data-role=place]' })));
    let spot: { x: number; y: number } | null = null;
    for (const fy of [0.5, 0.42, 0.58, 0.35, 0.66]) for (const fx of [0.5, 0.35, 0.65, 0.2, 0.8]) {
      if (spot) break;
      const p = { x: w * fx, y: h * fy };
      await r.tap(p.x, p.y);
      if (await r.s((s) => { const i = s.placement.ghostInfo(); return i && i.valid; })) spot = p;
    }
    await r.check('a tap aims a valid ghost (no building placed yet)', !!spot && (await count()) === 1, `spot ${JSON.stringify(spot)}`);
    if (!spot) return;
    const n0 = await count();
    await r.tap(spot.x + 6, spot.y + 4); // second tap near the ghost
    await r.check('second tap near the ghost places the building', (await count()) === n0 + 1, `buildings ${n0} -> ${await count()}`);
    await r.shot(`placed-${r.vp}`);
    // two-finger tap undoes it
    await r.s((s) => s.tools.reset());
    await r.twoTap(w / 2, h / 2);
    await sleep(300);
    await r.check('two-finger tap = undo (building removed)', (await count()) === n0, `buildings ${await count()}`);
    // redo the placement via the Place button
    await r.s((s) => s.startPlacement('shop')); await sleep(200);
    await r.tap(spot.x, spot.y);
    await r.check('first tap only aims (count unchanged)', (await count()) === n0);
    const pb = await r.rect({ css: '[data-role=place]' });
    await r.check('Place button is >= 44 px', !!pb && pb.h >= 44 && pb.w >= 44, JSON.stringify(pb));
    if (pb) await r.tap(pb.x, pb.y);
    await sleep(200);
    await r.check('Place button places at the ghost', (await count()) === n0 + 1);
    // a pinch must not undo
    await r.s((s) => s.tools.reset());
    const n1 = await count();
    await r.two(w / 2, h / 2, 60, 220);
    await r.two(w / 2, h / 2, 200, 70);
    await sleep(300);
    await r.check('pinch does not undo', (await count()) === n1, `buildings ${await count()}`);
    // a slow near-still two-finger press (hold 600ms) -> not a tap -> no undo
    // long press cancels the tool
    await r.longPressMs(450);
    await r.s((s) => s.startPlacement('shop')); await sleep(200);
    await r.hold(w / 2, h / 2, 800);
    await sleep(200);
    await r.check('long press cancels the placement tool', (await r.tool()) === 'select', `tool ${await r.tool()}`);
    await r.check('long press placed nothing', (await count()) === n1);
    // select + long press shows the tile highlight (hover info); tap on a building selects it
    await r.resetView(2.5); await r.longPressMs(450);
    await r.s((s) => { s.overlays.hide(); });
    await r.hold(w * 0.3, h * 0.6, 800);
    const vis = await r.s((s) => s.overlays.group.visible);
    await r.check('long press in Select shows the hover highlight', vis === true);
    await r.longPressMs(4000);
    const shop = await r.s((s) => { const b = s.buildings.all().filter((q: any) => q.type === 'shop').pop(); return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : null; });
    const lp2 = await r.project(shop!.x, shop!.y);
    await r.tap(lp2.x, lp2.y);
    await sleep(400);
    const sel = await r.s((s) => s.selection().building !== null);
    await r.check('tap on a building selects it', !!sel);
    await r.shot(`select-${r.vp}`);
  });

  reg('walk', async (r) => {
    const { w, h } = r.size;
    const ok = await r.s((s) => { const b = s.buildings.all().find((q: any) => q.type === 'baseLodge'); return s.view.walk.enter(b.x + b.w / 2 + 6, b.y + b.h + 3.5, 0); });
    await sleep(800);
    await r.check('walk mode entered', ok === true && (await r.s((s) => s.view.mode)) === 'walk');
    const st = (): Promise<any> => r.s((s) => { const q = s.view.walk.mode.state; return { x: q.x, z: q.z, yaw: q.yaw, pitch: q.pitch, speed: q.speed, hop: q.hop }; });
    const joy = await r.rect({ css: '[data-role=joystick]' });
    await r.check('joystick visible, >= 100 px', !!joy && joy.w >= 100, JSON.stringify(joy));
    if (!joy) return;
    await r.shot(`walk-${r.vp}`);
    // forward / back / strafe
    const hold = async (dx: number, dy: number, ms: number): Promise<{ moved: number; dot: number; side: number }> => {
      const a = await st();
      const t = await r.page.touchscreen.touchStart(joy.x, joy.y);
      await t.move(joy.x + dx, joy.y + dy); await sleep(ms); await t.end(); await sleep(150);
      const b = await st();
      const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw), mx = b.x - a.x, mz = b.z - a.z, d = Math.hypot(mx, mz);
      return { moved: d, dot: d ? (mx * fx + mz * fz) / d : 0, side: d ? (mx * fz * -1 + mz * fx) / d : 0 };
    };
    let m = await hold(0, -45, 1500);
    await r.check('joystick up walks forward', m.moved > 0.3 && m.dot > 0.8, `moved ${m.moved.toFixed(2)} dot ${m.dot.toFixed(2)}`);
    m = await hold(0, 45, 1500);
    await r.check('joystick down walks backward', m.moved > 0.2 && m.dot < -0.8, `moved ${m.moved.toFixed(2)} dot ${m.dot.toFixed(2)}`);
    m = await hold(45, 0, 1500);
    await r.check('joystick right strafes (perpendicular)', m.moved > 0.2 && Math.abs(m.dot) < 0.55, `moved ${m.moved.toFixed(2)} dot ${m.dot.toFixed(2)} side ${m.side.toFixed(2)}`);
    const a2 = await st(); await sleep(700); const b2 = await st();
    await r.check('lifting the finger stops the walker (keys released)', Math.hypot(b2.x - a2.x, b2.z - a2.z) < 0.05, `drift ${Math.hypot(b2.x - a2.x, b2.z - a2.z).toFixed(3)}`);
    const held = await r.s((s) => [...s.view.walk.mode.constructor ? [] : []]);
    void held;
    // look drag on the map
    const y0 = await st();
    await r.swipe(w * 0.55, h * 0.4, w * 0.8, h * 0.45, 12);
    const y1 = await st();
    await r.check('one-finger drag on the map looks around (yaw changes)', Math.abs(y1.yaw - y0.yaw) > 0.15, `yaw ${y0.yaw.toFixed(2)} -> ${y1.yaw.toFixed(2)}`);
    await r.swipe(w * 0.6, h * 0.3, w * 0.6, h * 0.5, 10);
    const y2 = await st();
    await r.check('vertical drag changes pitch', Math.abs(y2.pitch - y1.pitch) > 0.05, `pitch ${y1.pitch.toFixed(2)} -> ${y2.pitch.toFixed(2)}`);
    // joystick + look at the same time (two fingers: one on the stick, one on the map)
    const a3 = await st();
    const tj = await r.page.touchscreen.touchStart(joy.x, joy.y); await tj.move(joy.x, joy.y - 45);
    const tl = await r.page.touchscreen.touchStart(w * 0.6, h * 0.4);
    for (let k = 1; k <= 8; k++) { await tl.move(w * 0.6 + k * 12, h * 0.4); await sleep(30); }
    await sleep(500); await tl.end(); await tj.end(); await sleep(150);
    const b3 = await st();
    await r.check('walk + look with two fingers at once', Math.hypot(b3.x - a3.x, b3.z - a3.z) > 0.4 && Math.abs(b3.yaw - a3.yaw) > 0.1, `moved ${Math.hypot(b3.x - a3.x, b3.z - a3.z).toFixed(2)}, yaw ${(b3.yaw - a3.yaw).toFixed(2)}`);
    // buttons
    const btn = async (role: string): Promise<{ x: number; y: number; w: number; h: number } | null> => r.rect({ css: `[data-role=${role}]`, tag: 'st-touch-controls' });
    for (const role of ['interact', 'hop', 'run', 'photo', 'pause']) { const b = await btn(role); await r.check(`walk button ${role} visible and >= 44 px`, !!b && b.w >= 44 && b.h >= 44, JSON.stringify(b)); }
    // hop
    const hop = async (): Promise<number> => r.s(() => new Promise<number>((res) => { let mx = 0; const t0 = performance.now(); const f = (): void => { mx = Math.max(mx, (window as any).__slope.view.walk.mode.state.hop); if (performance.now() - t0 < 1500) setTimeout(f, 4); else res(mx); }; f(); }));
    // open ground for the hop / run tests: south-west of the lodge, facing east along the open strip below it
    await r.s((s) => { const b = s.buildings.all().find((q: any) => q.type === 'baseLodge'); s.view.walk.exit(); s.view.walk.enter(b.x - 6, b.y + b.h + 3, -Math.PI / 2); });
    await sleep(700);
    const hb = await btn('hop');
    const hp = hop(); if (hb) await r.tap(hb.x, hb.y);
    await r.check('Hop button makes the walker hop', (await hp) > 0.05, `max hop ${(await hp).toFixed(2)}`);
    // run toggle: joystick forward faster
    const rb = await btn('run');
    const base = await hold(0, -45, 1200); const speed1 = (await st()).speed;
    if (rb) await r.tap(rb.x, rb.y);
    await sleep(100);
    const t = await r.page.touchscreen.touchStart(joy.x, joy.y); await t.move(joy.x, joy.y - 45); await sleep(1200); const speed2 = (await st()).speed; await t.end(); await sleep(150);
    await r.check('Run toggle raises the walking speed', speed2 > Math.max(speed1, 0.3) * 1.3, `speed ${speed1.toFixed(2)} -> ${speed2.toFixed(2)} (base moved ${base.moved.toFixed(2)})`);
    if (rb) await r.tap(rb.x, rb.y);
    // interact next to the lodge
    await r.s((s) => { const b = s.buildings.all().find((q: any) => q.type === 'baseLodge'); s.view.walk.exit(); s.view.walk.enter(b.x + b.w / 2, b.y + b.h + 1.6, 0); });
    await sleep(500);
    const ib = await btn('interact'); if (ib) await r.tap(ib.x, ib.y);
    await sleep(400);
    const card = await r.s((s) => { const q = s.view.walk.mode; return { card: q.card && q.card.title, prompt: q.prompt }; });
    await r.check('Interact (E) next to the lodge opens its card', !!card.card, JSON.stringify(card));
    await r.shot(`walk-interact-${r.vp}`);
    // pause
    const pb = await btn('pause');
    const p0 = await r.s((s) => s.loop.paused);
    if (pb) await r.tap(pb.x, pb.y);
    const p1 = await r.s((s) => s.loop.paused);
    await r.check('Pause button toggles the simulation', p0 !== p1, `paused ${p0} -> ${p1}`);
    if (pb) await r.tap(pb.x, pb.y);
    // photo button and exit
    const phb = await btn('photo'); if (phb) await r.tap(phb.x, phb.y);
    await sleep(500);
    await r.check('Photo button enters photo mode', (await r.s((s) => s.view.photo.active)) === true);
    await r.s((s) => s.view.photo.exit()); await sleep(300);
    const exitBtn = await r.rect({ tag: 'st-view-hud', css: 'button' });
    await r.check('walk exit button reachable (>= 44 px)', !!exitBtn && exitBtn.h >= 44, JSON.stringify(exitBtn));
    if (exitBtn) { await r.tap(exitBtn.x, exitBtn.y); await sleep(600); }
    await r.check('exit button returns to the map', (await r.s((s) => s.view.mode)) === 'iso', await r.s((s) => s.view.mode));
  });

  reg('ride-photo', async (r) => {
    const { w, h } = r.size;
    await r.s((s) => {
      s.spawnGuests(150, 'skiers');
      const loop = s.loop; if (loop.paused) loop.setSpeed(1);
      const t = loop.tickCount + 1500; let g = 0; while (loop.tickCount < t && g++ < 1e6) loop.advance(1);
    });
    let tries = 0, id = 0;
    while (!id && tries++ < 8) { id = await r.s((s) => s.view.rideAuto()); if (!id) await r.s((s) => { const l = s.loop; const t = l.tickCount + 300; while (l.tickCount < t) l.advance(1); }); }
    await sleep(900);
    await r.check('ride-along started', id > 0 && (await r.s((s) => s.view.mode)) === 'ride', `guest ${id}`);
    if (!id) return;
    await r.shot(`ride-${r.vp}`);
    const btn = (role: string): ReturnType<Rig['rect']> => r.rect({ css: `[data-role=${role}]`, tag: 'st-touch-controls' });
    for (const role of ['recentre', 'photo', 'pause']) { const b = await btn(role); await r.check(`ride button ${role} visible and >= 44 px`, !!b && b.w >= 44 && b.h >= 44, JSON.stringify(b)); }
    // drag look
    const look = (): Promise<{ y: number; p: number; fov: number }> => r.s((s) => ({ y: s.view.rig.lookYaw, p: s.view.rig.lookPitch, fov: s.view.rig.fov }));
    const l0 = await look();
    await r.swipe(w * 0.4, h * 0.4, w * 0.7, h * 0.4, 10);
    const l1 = await look();
    await r.check('ride: one-finger drag looks around', Math.abs(l1.y - l0.y) > 0.1, `lookYaw ${l0.y.toFixed(2)} -> ${l1.y.toFixed(2)}`);
    const rc = await btn('recentre'); if (rc) await r.tap(rc.x, rc.y);
    await sleep(300);
    const l2 = await look();
    await r.check('Recentre button resets the look', Math.abs(l2.y) < 0.01 && Math.abs(l2.p) < 0.01, JSON.stringify(l2));
    const f0 = (await look()).fov;
    await r.two(w / 2, h * 0.4, 60, 220);
    await sleep(500);
    const f1 = (await look()).fov;
    await r.check('ride: pinch changes the field of view', Math.abs(f1 - f0) > 2, `fov ${f0.toFixed(1)} -> ${f1.toFixed(1)}`);
    const pb = await btn('pause'); const p0 = await r.s((s) => s.loop.paused);
    if (pb) await r.tap(pb.x, pb.y);
    await r.check('ride: Pause button toggles', (await r.s((s) => s.loop.paused)) !== p0);
    if (pb) await r.tap(pb.x, pb.y);
    // next guest + exit buttons of the HUD
    const hudBtns = await r.s(() => { const hud = document.querySelector('st-view-hud') as any; return [...hud.shadowRoot.querySelectorAll('button')].filter((b: any) => b.offsetParent !== null).map((b: any) => { const q = b.getBoundingClientRect(); return { t: (b.title || b.textContent || '').trim(), w: q.width, h: q.height }; }); });
    await r.check('ride HUD buttons >= 44 px high', hudBtns.length >= 1 && hudBtns.every((b: any) => b.h >= 44), JSON.stringify(hudBtns));
    // photo from ride
    const phb = await btn('photo'); if (phb) await r.tap(phb.x, phb.y);
    await sleep(700);
    await r.check('Photo button enters photo mode from the ride', (await r.s((s) => s.view.photo.active)) === true);
    await r.shot(`photo-${r.vp}`);
    const o0 = await r.s((s) => ({ ...s.view.photo.orbit }));
    await r.swipe(w * 0.4, h * 0.4, w * 0.7, h * 0.5, 10);
    const o1 = await r.s((s) => ({ ...s.view.photo.orbit }));
    await r.check('photo: one-finger drag orbits', Math.abs(o1.yaw - o0.yaw) > 0.2, `yaw ${o0.yaw.toFixed(2)} -> ${o1.yaw.toFixed(2)}`);
    await r.two(w / 2, h * 0.4, 60, 220);
    const o2 = await r.s((s) => ({ ...s.view.photo.orbit }));
    await r.check('photo: pinch out dollies in', o2.dist < o1.dist * 0.8, `dist ${o1.dist.toFixed(1)} -> ${o2.dist.toFixed(1)}`);
    const o3a = await r.s((s) => ({ ...s.view.photo.orbit }));
    await r.two(w / 2, h * 0.4, 100, 100, 0, 0, [100, 40], 20, 8);
    const o3 = await r.s((s) => ({ ...s.view.photo.orbit }));
    await r.check('photo: two-finger drag pans the focus', Math.hypot(o3.fx - o3a.fx, o3.fz - o3a.fz) > 0.3, `focus moved ${Math.hypot(o3.fx - o3a.fx, o3.fz - o3a.fz).toFixed(2)}`);
    const sv = await btn('save'), ex = await btn('exit');
    await r.check('photo buttons Save / Exit visible >= 44 px', !!sv && !!ex && sv.h >= 44 && ex.h >= 44, JSON.stringify([sv, ex]));
    // capture: tap Save, expect a toast / gallery entry
    if (sv) await r.tap(sv.x, sv.y);
    await sleep(3000);
    const saved = await r.s(() => { const t = (document.querySelector('st-toast') as any)?.shadowRoot?.textContent ?? '', p = (document.querySelector('st-photo') as any)?.shadowRoot?.textContent ?? ''; return { toast: /Photo saved/.test(t), say: /Saved .*\.png/.test(p) }; });
    await r.check('Save button captures a photo (toast + status line)', saved.toast || saved.say, JSON.stringify(saved));
    const ex2 = await btn('exit'); if (ex2) await r.tap(ex2.x, ex2.y);
    await sleep(700);
    await r.check('photo Exit button leaves photo mode', (await r.s((s) => s.view.photo.active)) === false, await r.s((s) => s.view.mode));
  });

  reg('lift', async (r) => {
    const { h } = r.size;
    const liftCount = (): Promise<number> => r.s((s) => s.sim.lifts.all().length);
    await r.s((s, z) => { s.economy.state.money = 9e6; s.tools.reset(); const c = s.renderer.controls; c.target.set(32, 0, 44); c.yaw = 0.785398; c.zoom = 1; c.zoomBy(z); const g = s.touch.controller.gestures; g.cfg = { ...g.cfg, longPressMs: 4000, tapMs: 1500 }; }, Math.min(4, (h < 500 ? 0.65 * 1.5 : 1.5) * 844 / h));
    await sleep(500);
    const n0 = await liftCount();
    // keep both aim points clear of the HUD / top bar: shift the world down so the top station is below y = 330 (portrait) / 110 (landscape)
    const T0 = await r.project(28, 40);
    const want = h < 500 ? 100 : 330;
    const dx = r.size.w < 500 ? 100 - T0.x : 0; // portrait: keep clear of the right-hand HUD column (it grows when the goals card opens)
    if (T0.y < want || dx) { await r.s((s, a) => s.renderer.controls.panPixels(a.dx, a.dy), { dx, dy: Math.max(0, want - T0.y) }); await sleep(500); }
    const B = await r.project(36, 48), T = await r.project(28, 40);
    await r.s((s) => s.liftTools.start('chair4')); await sleep(300);
    await r.check('lift tool active, touch bar shows Place (no rotate buttons)', (await r.tool()) === 'lift' && !!(await r.rect({ css: '[data-role=place]' })) && !(await r.rect({ css: '[data-role=ghost-left]' })));
    await r.tap(B.x, B.y);
    await r.check('first tap only previews the bottom station', (await r.s((s) => s.liftTools.tool.stage)) === 'bottom' && (await r.s((s) => s.touch.controller.confirming)) === true);
    await r.tap(B.x + 3, B.y + 2);
    await r.check('second tap near it places the bottom station', (await r.s((s) => s.liftTools.tool.stage)) === 'top');
    await r.tap(T.x, T.y);
    await r.check('tapping the top only previews (no lift built yet) and the bar shows the cost', (await liftCount()) === n0 && (await r.s((s) => s.liftTools.tool.lastCheck?.ok)) === true, await r.s((s) => s.liftTools.tool.touchHint()));
    await r.tap(T.x + 90, T.y + 60); // a different spot: aims again, never builds
    await r.check('a tap far from the preview re-aims instead of building', (await liftCount()) === n0);
    await r.shot(`lift-aim-${r.vp}`);
    await r.tap(T.x, T.y);
    const pb = await r.rect({ css: '[data-role=place]' });
    if (pb) await r.tap(pb.x, pb.y);
    await sleep(400);
    await r.check('Place button builds the lift', (await liftCount()) === n0 + 1, `lifts ${n0} -> ${await liftCount()}`);
    await r.s((s) => s.tools.reset());
    await r.twoTap(r.size.w / 2, r.size.h / 2); await sleep(400);
    await r.check('two-finger tap undoes the lift', (await liftCount()) === n0, `lifts ${await liftCount()}`);
    // second variant: confirm with the second tap
    await r.s((s) => s.liftTools.start('chair4')); await sleep(200);
    await r.tap(B.x, B.y); await r.tap(B.x + 2, B.y + 2); await r.tap(T.x, T.y); await r.tap(T.x + 4, T.y + 3);
    await sleep(400);
    await r.check('second tap near the top preview builds the lift', (await liftCount()) === n0 + 1, `lifts ${await liftCount()} tool ${await r.tool()} stage ${await r.s((s) => s.liftTools.tool.stage)} hint ${await r.s((s) => s.liftTools.tool.touchHint())}`);
    // long press cancels
    await r.longPressMs(450);
    await r.s((s) => s.liftTools.start('chair4')); await sleep(200);
    await r.hold(r.size.w / 2, r.size.h * 0.55, 800);
    await r.check('long press cancels the lift tool', (await r.tool()) === 'select', await r.tool());
  }, undefined, 'starter=1');

  const strokesFn = async (r: Rig): Promise<void> => {
    const { w, h } = r.size;
    await r.s((s) => { s.economy.state.money = 9e6; });
    const measures: Record<string, string> = {
      piste: '(s) => { let n = 0; const L = s.sim.networks.layers; for (let i = 0; i < L.length; i++) if (L[i] & 1) n++; return n; }',
      mtb: '(s) => { let n = 0; const L = s.sim.networks.layers; for (let i = 0; i < L.length; i++) if (L[i] & 2) n++; return n; }',
      hike: '(s) => { let n = 0; const L = s.sim.networks.layers; for (let i = 0; i < L.length; i++) if (L[i] & 4) n++; return n; }',
      kind: '(s) => { let n = 0; const K = s.sim.networks.kind; for (let i = 0; i < K.length; i++) if (K[i]) n++; return n; }',
      height: '(s) => { let n = 0; const H = s.sim.grid.heights; for (let i = 0; i < H.length; i++) n += H[i] * ((i % 7) + 1); return n; }',
      trees: '(s) => s.props.treesPlanted',
      decor: '(s) => s.sim.landscape.decor.size',
    };
    const val = (m: string): Promise<number> => r.page.evaluate(`(${measures[m]})(window.__slope)`) as Promise<number>;
    const pick = async (drawer: string, card: string): Promise<boolean> => {
      await r.s((s) => s.tools.reset()); await sleep(150);
      for (let attempt = 0; attempt < 3 && !(await r.rect({ text: card, tag: 'st-dock', card: true })); attempt++) { // drawer closed (or another one open): open it; tapping an open drawer's button would close it
        if (!(await r.tapEl({ text: drawer, tag: 'st-dock' }))) return false;
        for (let k = 0; k < 8 && !(await r.rect({ text: card, tag: 'st-dock', card: true })); k++) await sleep(250);
      }
      if (!(await r.tapEl({ text: card, tag: 'st-dock', card: true }))) return false;
      await sleep(400);
      return true;
    };
    /** Stroke path: starts at the lodge / the nearest road tile (networks must start at an existing path, road or building) or in the open snow. */
    const DIRS: Array<[number, number]> = [[-70, 55], [70, 55], [-95, -5], [0, 90], [95, 0], [-40, 100]];
    const area = async (from: 'free' | 'lodge' | 'road' = 'free', dir = 0): Promise<Array<[number, number]>> => {
      if (from === 'free') return h < 500 ? r.line(w * 0.3, h * 0.45, w * 0.5, h * 0.55, 14) : r.line(w * 0.25, h * 0.5, w * 0.5, h * 0.56, 14);
      const t = await r.s((s, a) => {
        const b = s.buildings.all().find((q: any) => q.type === 'baseLodge'); const K = s.sim.networks.kind, size = s.sim.grid.size;
        if (a === 'lodge') return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
        let best: any = null, bd = 1e9; for (let i = 0; i < K.length; i++) if (K[i] === 2) { const x = i % size, y = Math.floor(i / size), d = Math.hypot(x - b.x, y - b.y); if (d < bd) { bd = d; best = { x: x + 0.5, y: y + 0.5 }; } }
        return best;
      }, from);
      let p = await r.project(t.x, t.y);
      if (p.y < h * 0.42) { await r.s((s, a) => s.renderer.controls.panPixels(0, a), h * 0.45 - p.y); await sleep(500); p = await r.project(t.x, t.y); } // keep the start clear of the HUD cards at the top
      return r.line(p.x, p.y + (from === 'lodge' ? 45 : 0), p.x + DIRS[dir]![0], p.y + (from === 'lodge' ? 45 : 0) + DIRS[dir]![1], 14);
    };
    const cases: Array<{ id: string; drawer: string; card: string; tool: string; m: string; from?: 'free' | 'lodge' | 'road' }> = [
      ...(r.winter ? [{ id: 'ski piste', drawer: 'Pistes & Trails', card: 'Ski piste', tool: 'network', m: 'piste' }] : []),
      ...(r.winter ? [] : [{ id: 'hiking trail', drawer: 'Pistes & Trails', card: 'Hiking trail', tool: 'network', m: 'hike', from: 'lodge' as const }]),
      ...(r.winter ? [] : [{ id: 'mtb trail', drawer: 'Pistes & Trails', card: 'MTB trail', tool: 'network', m: 'mtb', from: 'lodge' as const }]),
      ...(r.winter ? [{ id: 'footpath', drawer: 'Paths & Roads', card: 'Footpath', tool: 'network', m: 'kind', from: 'lodge' as const },
      { id: 'road', drawer: 'Paths & Roads', card: 'Road', tool: 'network', m: 'kind', from: 'road' as const },
      { id: 'terraform raise', drawer: 'Terrain', card: 'Raise', tool: 'terraform', m: 'height' }] : []),
    ];
    for (const c of cases) {
      await r.resetView(2);
      const ok = await pick(c.drawer, c.card);
      await r.check(`${c.id}: drawer card tap selects the tool`, ok && (await r.tool()) === c.tool, `tool ${await r.tool()}, tapped ${ok}, cards ${await r.page.evaluate(() => [...(document.querySelector('st-dock') as any).shadowRoot.querySelectorAll('.drawer .card')].map((b: any) => b.innerText.replace(/\\s+/g, ' ').slice(0, 14) + (b.classList.contains('active') ? '*' : '')).join('|'))}`);
      if (!ok) continue;
      const drawerShown = (): Promise<boolean> => r.page.evaluate(() => { const d = (document.querySelector('st-dock') as any).shadowRoot.querySelector('.drawer') as HTMLElement | null; return !!d && getComputedStyle(d).display !== 'none' && d.getBoundingClientRect().height > 10; });
      { // every touch screen: choosing a card tucks the drawer away (it would cover the map); the options button brings it back
        await sleep(400);
        await r.check(`${c.id}: the drawer tucks away after choosing a card on a short screen`, !(await drawerShown()) && (await r.tool()) === c.tool, `shown ${await drawerShown()} tool ${await r.tool()}`);
        const ob = await r.rect({ css: '[data-role=drawer]', tag: 'st-touch-controls' });
        await r.check(`${c.id}: options button visible and >= 44 px`, !!ob && ob.w >= 44 && ob.h >= 44, JSON.stringify(ob));
        if (ob) { await r.tap(ob.x, ob.y); await sleep(400); await r.check(`${c.id}: options button shows the drawer again`, await drawerShown()); await r.tap(ob.x, ob.y); await sleep(400); }
        await r.check(`${c.id}: options button hides it again`, !(await drawerShown()));
      }
      await r.longPressMs(4000);
      // pan mode (default): a one-finger drag pans, paints nothing
      const m0 = await val(c.m), c0 = await r.cam();
      await r.drag(await area(c.from), 16);
      const c1 = await r.cam();
      await r.check(`${c.id}: pan mode drag pans and paints nothing`, Math.hypot(c1.tx - c0.tx, c1.tz - c0.tz) > 0.8 && (await val(c.m)) === m0, `moved ${Math.hypot(c1.tx - c0.tx, c1.tz - c0.tz).toFixed(2)}, measure ${m0}->${await val(c.m)}`);
      // paint mode: toggle via the bar, the same drag paints and the camera stays
      const mb = await r.rect({ css: '[data-role=mode]', tag: 'st-touch-controls' });
      await r.check(`${c.id}: paint/pan toggle visible and >= 44 px`, !!mb && mb.w >= 44 && mb.h >= 44, JSON.stringify(mb));
      if (mb) await r.tap(mb.x, mb.y);
      await r.check(`${c.id}: toggle switches to paint mode`, (await r.s((s) => s.touch.controller.mode)) === 'paint');
      await r.recenter(2);
      await area(c.from); // (shifts the world clear of the HUD once)
      const c2 = await r.cam(), m1 = await val(c.m);
      let m2 = m1, pts: Array<[number, number]> = [];
      for (let d = 0; d < DIRS.length && m2 === m1; d++) { pts = await area(c.from, d); await r.drag(pts, 16); m2 = await val(c.m); }
      const c3 = await r.cam();
      await r.check(`${c.id}: paint mode drag paints (camera stays)`, m2 !== m1 && Math.hypot(c3.tx - c2.tx, c3.tz - c2.tz) < 0.05, `measure ${m1}->${m2}, camera moved ${Math.hypot(c3.tx - c2.tx, c3.tz - c2.tz).toFixed(3)} from ${JSON.stringify(pts[0])} toast ${await r.s(() => ((document.querySelector('st-toast') as any)?.shadowRoot?.textContent ?? '').replace(/\s+/g, ' ').slice(-120))}`);
      if (c.id === 'ski piste') await r.shot(`stroke-piste-${r.vp}`);
      // a pinch while painting cancels the stroke (no paint) and zooms
      const m3 = await val(c.m), z0 = (await r.cam()).zoom;
      await r.two(h < 500 ? w / 2 : w * 0.3, h < 500 ? h * 0.4 : h * 0.5, 60, 180);
      await r.check(`${c.id}: two fingers zoom instead of painting`, (await val(c.m)) === m3 && (await r.cam()).zoom > z0 * 1.3);
      // undo restores (button / two-finger tap)
      await r.twoTap(h < 500 ? w / 2 : w * 0.3, h < 500 ? h * 0.4 : h * 0.5); await sleep(300);
      await r.s((s) => { s.touch.controller.setMode('pan'); s.tools.reset(); });
    }
    // programmatic tools: plant + landscape pond (their drawers are covered by the drawer scenario)
    if (r.winter) {
      await r.resetView(2);
      await r.s((s) => { s.tools.activate('plant'); s.touch.controller.setMode('paint'); });
      await r.longPressMs(4000);
      const m0 = await val('trees'), c0 = await r.cam();
      await r.drag(await area(), 16);
      const c1 = await r.cam();
      await r.check('plant trees: paint mode drag paints (camera stays)', (await val('trees')) > m0 && Math.hypot(c1.tx - c0.tx, c1.tz - c0.tz) < 0.05, `trees ${m0}->${await val('trees')}`);
      await r.s((s) => { s.touch.controller.setMode('pan'); });
      const m1 = await val('trees');
      await r.drag(await area(), 16);
      const c2 = await r.cam();
      await r.check('plant trees: pan mode drag pans and plants nothing', (await val('trees')) === m1 && Math.hypot(c2.tx - c1.tx, c2.tz - c1.tz) > 0.8);
      await r.s((s) => s.tools.reset());
      // landscape: dig a pond by dragging a rectangle over open ground
      await r.s((s) => s.progression.unlockAll(true)); // Career gates ponds behind level 2
      const site = await r.s((s) => s.landscapeDebug.find(5));
      await r.s((s, a) => { const c = s.renderer.controls; c.target.set(a.x, s.grid.getCorner(a.x, a.y) * 0.5, a.y); c.yaw = 0.785398; c.zoom = 1; c.zoomBy(2.2); s.tools.activate('landscape'); s.landscapeTool.setMode('pond'); s.touch.controller.setMode('paint'); }, site);
      await sleep(600);
      let pa = await r.project(site.x - 1.5, site.y - 1.5);
      if (pa.y < h * 0.47) { await r.s((s, a) => s.renderer.controls.panPixels(0, a), h * 0.47 - pa.y); await sleep(500); pa = await r.project(site.x - 1.5, site.y - 1.5); } // phone portrait: the stats / goals cards cover the top 45 % of the screen; the rectangle must start clear of them
      const pb = await r.project(site.x + 2.5, site.y + 2.5);
      const ponds = (): Promise<number> => r.s((s) => s.sim.landscape.ponds.length);
      const pn0 = await ponds();
      await r.drag(r.line(pa.x, pa.y, pb.x, pb.y, 14), 16);
      await sleep(300);
      await r.check('landscape pond: paint mode drag digs a pond', (await ponds()) > pn0, `ponds ${pn0} -> ${await ponds()} at ${JSON.stringify(site)}, drag ${JSON.stringify([pa, pb].map((q) => [Math.round(q.x), Math.round(q.y)]))}`);
      await r.s((s) => s.tools.reset());
    }
  };
  reg('strokes', (r) => strokesFn(r));
  reg('trails', (r) => strokesFn(r), undefined, 'start=summer');

  reg('drawers', async (r) => {

    await r.resetView(2);
    const dock = (code: string): Promise<any> => r.page.evaluate(`(() => { const sr = document.querySelector('st-dock').shadowRoot; ${code} })()`);
    const state = async (): Promise<{ tool: string; b: number; cam: any }> => ({ tool: await r.tool(), b: await r.s((s) => s.buildings.all().length), cam: await r.cam() });
    // dock row: horizontal swipe scrolls it (phone: it overflows), nothing else happens
    const dr = await dock("const d = sr.querySelector('.dock'); const q = d.getBoundingClientRect(); return { l: d.scrollLeft, max: d.scrollWidth - d.clientWidth, x: q.left, y: q.top + q.height / 2, w: q.width };");
    if (dr.max > 10) {
      const s0 = await state();
      await r.swipe(dr.x + dr.w * 0.8, dr.y, dr.x + dr.w * 0.2, dr.y, 10);
      const dr2 = await dock("return sr.querySelector('.dock').scrollLeft;");
      const s1 = await state();
      await r.check('dock row scrolls sideways by swipe, nothing selected', dr2 > dr.l + 20 && s1.tool === s0.tool, `scrollLeft ${dr.l} -> ${dr2}`);
      await r.swipe(dr.x + dr.w * 0.2, dr.y, dr.x + dr.w * 0.9, dr.y, 10);
    } else await r.check('dock row fits (no scrolling needed)', true, `overflow ${dr.max}`);
    // buildings drawer: open, card rail scrolls by swipe (no placement), card tap selects, close button
    await r.tapEl({ text: 'Buildings', tag: 'st-dock' }); await sleep(600);
    const g0 = await dock("const g = sr.querySelector('.drawer .grid'); if (!g) return null; const q = g.getBoundingClientRect(); return { l: g.scrollLeft, max: g.scrollWidth - g.clientWidth, x: q.left, y: q.top + q.height / 2, w: q.width };");
    await r.check('buildings drawer open with a card rail', !!g0 && g0.max > 50, JSON.stringify(g0));
    if (g0) {
      const s0 = await state();
      await r.shot(`drawer-buildings-${r.vp}`);
      await r.swipe(g0.x + g0.w * 0.85, g0.y, g0.x + g0.w * 0.15, g0.y, 12);
      const g1 = await dock("return sr.querySelector('.drawer .grid').scrollLeft;");
      const s1 = await state();
      await r.check('card rail scrolls by swipe without selecting a card or touching the map', g1 > g0.l + 30 && s1.tool === s0.tool && s1.b === s0.b && Math.hypot(s1.cam.tx - s0.cam.tx, s1.cam.tz - s0.cam.tz) < 0.01, `scrollLeft ${g0.l} -> ${g1}, tool ${s1.tool}`);
      await r.swipe(g0.x + g0.w * 0.15, g0.y, g0.x + g0.w * 0.9, g0.y, 12);
    }
    const nb = await r.tapEl({ text: 'Caf', tag: 'st-dock', card: true }); await sleep(500);
    await r.check('card tap selects the building tool', nb && (await r.tool()) === 'placement', await r.tool());
    await r.s((s) => s.tools.reset()); await sleep(300);
    // close button of the drawer >= 44 px and works
    const x = await r.rect({ text: '\u2715', tag: 'st-dock' }) ?? await r.rect({ css: 'button[aria-label*=lose], button[title*=lose]', tag: 'st-dock' });
    await r.check('drawer close button >= 44 x 44', !!x && x.w >= 44 && x.h >= 44, JSON.stringify(x));
    if (x) { await r.tap(x.x, x.y); await sleep(400); }
    await r.check('drawer closes', (await dock("return !sr.querySelector('.drawer') || sr.querySelector('.drawer').offsetParent === null || sr.querySelector('.drawer').getBoundingClientRect().height < 5;")) === true);
    // Pistes drawer: vertical swipe scrolls the drawer body (phone) and never paints
    await r.s((s) => s.tools.reset());
    await r.tapEl({ text: 'Pistes & Trails', tag: 'st-dock' }); await sleep(600);
    await r.tapEl({ text: 'Ski piste', tag: 'st-dock', card: true }); await sleep(400);
    await r.s((s) => { s.touch.controller.setMode('paint'); }); // even in paint mode a swipe that starts on the drawer must not paint
    const body = await dock("const b = sr.querySelector('.drawer .body'); if (!b) return null; const q = b.getBoundingClientRect(); return { top: b.scrollTop, max: b.scrollHeight - b.clientHeight, x: q.left + q.width / 2, y: q.top + q.height / 2, h: q.height };");
    const pre = await state();
    const piste0 = await r.s((s) => { let n = 0; const L = s.sim.networks.layers; for (let i = 0; i < L.length; i++) if (L[i] & 1) n++; return n; });
    if (body && body.max > 10) {
      await r.swipe(body.x, body.y + body.h * 0.35, body.x, body.y - body.h * 0.35, 10);
      const b2 = await dock("return sr.querySelector('.drawer .body').scrollTop;");
      await r.check('drawer body scrolls vertically by swipe', b2 > body.top + 15, `scrollTop ${body.top} -> ${b2}`);
    } else await r.check('drawer body needs no vertical scroll here', true, JSON.stringify(body));
    const post = await state();
    const piste1 = await r.s((s) => { let n = 0; const L = s.sim.networks.layers; for (let i = 0; i < L.length; i++) if (L[i] & 1) n++; return n; });
    await r.check('swiping the drawer neither paints nor pans the map', piste1 === piste0 && Math.hypot(post.cam.tx - pre.cam.tx, post.cam.tz - pre.cam.tz) < 0.01, `piste ${piste0}->${piste1}`);
    await r.shot(`drawer-pistes-${r.vp}`);
    // every dock drawer opens and has no horizontal page overflow
    for (const name of ['Lifts', 'Paths & Roads', 'Terrain', 'Finance', 'Operations', 'Marketing']) {
      await r.s((s) => s.tools.reset());
      const ok = await r.tapEl({ text: name, tag: 'st-dock', scroll: true }); await sleep(700);
      const over = await r.ev<number>('document.documentElement.scrollWidth - innerWidth');
      await r.check(`${name}: opens by tap, page does not overflow`, ok && over <= 0, `overflow ${over}`);
      await r.tapEl({ text: name, tag: 'st-dock', scroll: true }); await sleep(300);
      await r.s(() => { for (const k of ['Escape']) window.dispatchEvent(new KeyboardEvent('keydown', { key: k })); });
    }
  });

  reg('ui', async (r) => {
    const { w, h } = r.size;
    await r.resetView(2);
    const noSpan = (l: string[]): string[] => l.filter((x) => !x.startsWith('span'));
    const clean = async (label: string, within?: string): Promise<void> => { const l = noSpan(await r.smallTargets(44, within)); await r.check(`${label}: every button / input / option is >= 44 px`, l.length === 0, l.slice(0, 6).join(' | ')); };
    const esc = async (): Promise<void> => { await r.s(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); }); await sleep(400); };
    const menu = async (item: string): Promise<boolean> => {
      if (!(await r.tapEl({ text: 'Menu', tag: 'st-topbar', scroll: true }))) return false;
      await sleep(700);
      const ok = await r.tapEl({ text: item, tag: 'st-main-menu', scroll: true }); await sleep(900);
      return ok;
    };
    await clean('HUD (speed, top bar, dock)');
    // speed / pause
    const speedBtn = async (t: string): Promise<boolean> => r.tapEl({ text: t, tag: 'st-speed-control' });
    await speedBtn('3×'); await sleep(200);
    await r.check('3× button sets the speed', (await r.s((s) => s.loop.speed)) === 2, `speed index ${await r.s((s) => s.loop.speed)}`);
    await speedBtn('10×'); await sleep(200);
    await r.check('10× button sets the speed', (await r.s((s) => s.loop.speed)) === 3);
    await r.tapEl({ css: 'button', tag: 'st-speed-control', nth: 0 }); await sleep(200);
    await r.check('Pause button pauses', (await r.s((s) => s.loop.paused)) === true);
    await speedBtn('1×'); await sleep(200);
    await r.check('1× button resumes at normal speed (Pause is not a toggle; there is no Space key on touch)', (await r.s((s) => s.loop.speed)) === 1 && (await r.s((s) => s.loop.paused)) === false);
    await r.tapEl({ text: 'Skip to', tag: 'st-speed-control' }); await sleep(500);
    const menuBtn = await r.rect({ css: '.menu button', tag: 'st-speed-control' });
    await r.check('Skip-to menu opens with >= 44 px items', !!menuBtn && menuBtn.h >= 44, JSON.stringify(menuBtn));
    await esc(); await r.tap(w * 0.5, h * 0.3);
    await r.shot(`hud-${r.vp}`);
    // tooltips: holding a finger on a labelled control shows its title
    const und = await r.rect({ css: '[data-role=undo]', tag: 'st-touch-controls' });
    if (und) {
      await r.s((s) => { s.touch.tips.holdMs = 500; });
      await r.hold(und.x, und.y, 900);
      const tip = await r.ev<string>("document.querySelector('.touch-tip')?.textContent ?? ''");
      await r.check('holding a button shows its tooltip bubble', /Undo/.test(tip), tip);
      await r.shot(`touchtip-${r.vp}`);
      await sleep(2800);
      await r.check('the tooltip bubble goes away by itself', (await r.ev<string>("document.querySelector('.touch-tip')?.textContent ?? ''")) === '');
      await r.s((s) => { s.touch.tips.holdMs = 6000; });
    }
    // Pause menu
    await r.check('Menu opens', await menu('Settings'));
    // Settings dialog
    await clean('Settings');
    const sc = await r.s(() => { const root = (document.querySelector('st-settings') as any).shadowRoot; const els = [...root.querySelectorAll('*')].filter((e: any) => e.scrollHeight > e.clientHeight + 20 && ['auto', 'scroll'].includes(getComputedStyle(e).overflowY)); const e: any = els[0]; if (!e) return null; const q = e.getBoundingClientRect(); return { top: e.scrollTop, max: e.scrollHeight - e.clientHeight, x: q.left + q.width / 2, y: q.top + q.height / 2, h: q.height }; });
    await r.check('settings body is scrollable', !!sc && sc.max > 20, JSON.stringify(sc));
    if (sc) {
      await r.swipe(sc.x, sc.y + sc.h * 0.3, sc.x, sc.y - sc.h * 0.3, 10);
      const top2 = await r.s(() => { const root = (document.querySelector('st-settings') as any).shadowRoot; const e: any = [...root.querySelectorAll('*')].filter((x: any) => x.scrollHeight > x.clientHeight + 20 && ['auto', 'scroll'].includes(getComputedStyle(x).overflowY))[0]; return e.scrollTop; });
      await r.check('settings body scrolls by swipe', top2 > sc.top + 30, `scrollTop ${sc.top} -> ${top2}`);
      await r.swipe(sc.x, sc.y - sc.h * 0.3, sc.x, sc.y + sc.h * 0.45, 10); await r.swipe(sc.x, sc.y - sc.h * 0.3, sc.x, sc.y + sc.h * 0.45, 10); await sleep(300); // back to the top
    }
    // st-select by touch
    const sel = await r.rect({ css: 'st-select', tag: 'st-settings' });
    await r.check('settings has a visible st-select', !!sel);
    if (sel) {
      const v0 = await r.s(() => ((document.querySelector('st-settings') as any).shadowRoot.querySelector('st-select') as any).value);
      await r.tap(sel.x, sel.y); await sleep(400);
      const cur = await r.s(() => ((document.querySelector('st-settings') as any).shadowRoot.querySelector('st-select') as any).selectedIndex);
      const opt = await r.rect({ css: 'li[role=option]', tag: 'st-select', nth: cur === 0 ? 1 : 0 });
      await r.check('st-select opens its list with >= 44 px options', !!opt && opt.h >= 44, JSON.stringify(opt));
      if (opt) { await r.shot(`select-open-${r.vp}`); await r.tap(opt.x, opt.y); await sleep(400); }
      const v1 = await r.s(() => ((document.querySelector('st-settings') as any).shadowRoot.querySelector('st-select') as any).value);
      await r.check('tapping an option changes the st-select value', v1 !== v0, `${v0} -> ${v1}`);
    }
    // toggle + slider by touch (snapshots of every toggle / slider: the visible one flips / moves)
    const snap = (q: string): Promise<string> => r.s((s, a) => [...(document.querySelector('st-settings') as any).shadowRoot.querySelectorAll(a)].map((i: any) => (i.type === 'checkbox' ? Number(i.checked) : i.value)).join(','), q);
    const tg = await r.rect({ css: 'label.chk', tag: 'st-settings', scroll: true });
    await r.check('settings has a visible toggle row', !!tg);
    if (tg) {
      const t0 = await snap('label.chk input');
      await r.tap(tg.x, tg.y); await sleep(300);
      await r.check('tapping a toggle row flips it', (await snap('label.chk input')) !== t0);
      await r.tap(tg.x, tg.y); await sleep(300);
    }
    const rg = await r.rect({ css: 'input[type=range]', tag: 'st-settings', scroll: true });
    await r.check('settings has a visible slider', !!rg);
    if (rg) {
      const a = await snap('input[type=range]');
      const at = await r.inputAt(rg.x, rg.y), first = at?.value ?? 0, lo = at?.min ?? 0, hi = at?.max ?? 100;
      const toRight = first < (lo + hi) / 2; // drag towards the far end so the value surely changes
      await r.swipe(rg.x + (toRight ? -1 : 1) * rg.w * 0.4, rg.y, rg.x + (toRight ? 1 : -1) * rg.w * 0.4, rg.y, 10);
      await r.check('dragging a slider changes its value', (await snap('input[type=range]')) !== a, `${a} -> ${await snap('input[type=range]')}`);
    }
    await r.shot(`settings-${r.vp}`);
    await esc(); await esc();
    // New game / Save / Help dialogs
    for (const [item, tag] of [['New game', 'st-new-game'], ['Save game', 'st-save-load'], ['Help & keys', 'st-help'], ['Trophies', 'st-trophies'], ['About', 'st-modal']] as const) {
      const ok = await menu(item);
      await r.check(`Menu > ${item} opens`, ok);
      await clean(item);
      await r.shot(`dialog-${item.replace(/\W/g, '')}-${r.vp}`);
      if (item === 'Save game') {
        const inp = await r.rect({ css: 'input[type=text], input:not([type])', tag });
        if (inp) { await r.tap(inp.x, inp.y); await r.page.keyboard.type('Touch hello Test', { delay: 30 }); await sleep(200); const v = await r.s(() => { const roots = [document.querySelector('st-save-load') as any]; const i = roots[0].shadowRoot.querySelector('input[type=text], input:not([type])'); return i?.value; }); await r.check('text input takes a tap + typing (letters like h, o, m, p, v, i are not hotkeys while typing)', /Touch hello Test/.test(String(v)), String(v)); }
        else await r.check('save dialog has a name field', false);
      }
      await esc(); await esc();
      void tag;
    }
  });

  reg('title', async (r) => {
    const { w, h } = r.size;
    await sleep(2000);
    await r.shot(`title-${r.vp}`);
    const noSpan = (l: string[]): string[] => l.filter((x) => !x.startsWith('span'));
    const mm = await r.rect({ css: 'button', tag: 'st-main-menu' });
    await r.check('title screen shows the main menu', !!mm);
    const small = noSpan(await r.smallTargets(44));
    await r.check('title screen: every button >= 44 px', small.length === 0, small.slice(0, 5).join(' | '));
    const over = await r.ev<number>('document.documentElement.scrollWidth - innerWidth');
    await r.check('title screen does not overflow horizontally', over <= 0, `overflow ${over}`);
    // swipe on the title (page must not scroll / bounce)
    await r.swipe(w / 2, h * 0.7, w / 2, h * 0.2, 8);
    await r.check('swiping the title screen does not scroll the page', (await r.ev<number>('scrollY')) === 0);
    const ng = await r.tapEl({ text: 'New game', tag: 'st-main-menu' }) || await r.tapEl({ text: 'New', tag: 'st-main-menu' });
    await sleep(900);
    await r.check('New Game button opens the dialog by tap', ng && !!(await r.rect({ css: 'button', tag: 'st-new-game' })));
    const small2 = noSpan(await r.smallTargets(44));
    await r.check('New Game dialog: every control >= 44 px', small2.length === 0, small2.slice(0, 5).join(' | '));
    await r.shot(`title-newgame-${r.vp}`);
    // the start button boots a game
    const start = await r.rect({ css: 'button.primary', tag: 'st-new-game' }) ?? await r.rect({ text: 'Start', tag: 'st-new-game' });
    await r.check('New Game dialog has a visible Start button', !!start, JSON.stringify(start));
    if (start) {
      await r.tap(start.x, start.y);
      let booted = false;
      for (let i = 0; i < 90 && !booted; i++) { await sleep(1000); booted = await r.ev<boolean>('!!window.__slope && !!window.__slope.view').catch(() => false); }
      await r.check('Start boots a game from the title screen', booted);
      if (booted) { await sleep(2500); await r.shot(`title-started-${r.vp}`); }
    }
  });

  reg('page', async (r) => {
    const { w, h } = r.size;
    await r.resetView(2);
    await r.ev('window.__marker = 42');
    const vv = (): Promise<{ scale: number; sx: number; sy: number; w: number; h: number }> => r.ev('({ scale: visualViewport.scale, sx: scrollX, sy: scrollY, w: innerWidth, h: innerHeight })');
    const meta = await r.ev<string>("document.querySelector('meta[name=viewport]').content");
    await r.check('viewport meta forbids user scaling', /user-scalable=no/.test(meta) && /initial-scale=1/.test(meta), meta);
    const css = await r.ev<{ canvas: string; body: string; html: string; os: string }>("({ canvas: getComputedStyle(document.querySelector('#app canvas')).touchAction, body: getComputedStyle(document.body).touchAction, html: getComputedStyle(document.documentElement).touchAction, os: getComputedStyle(document.documentElement).overscrollBehaviorY })");
    await r.check('canvas touch-action none, page manipulation, overscroll none', css.canvas === 'none' && /manipulation|none/.test(css.body + css.html) && css.os === 'none', JSON.stringify(css));
    // pull-to-refresh: a long swipe down from the very top on the map and on the HUD
    await r.swipe(w * 0.5, 4, w * 0.5, h * 0.6, 14);
    await r.swipe(w * 0.2, 2, w * 0.2, h * 0.5, 14);
    await sleep(500);
    await r.check('swipe down from the top edge does not reload or scroll', (await r.ev<number>('window.__marker')) === 42 && (await vv()).sy === 0);
    // double tap on the map and on a HUD panel: no zoom of the page
    await r.tap(w * 0.5, h * 0.55); await r.tap(w * 0.5, h * 0.55);
    const hud = await r.rect({ css: '.panel', tag: 'st-hud' });
    if (hud) { await r.tap(hud.x, hud.y); await r.tap(hud.x, hud.y); }
    const v1 = await vv();
    await r.check('double tap does not zoom the page', v1.scale === 1 && v1.sx === 0 && v1.sy === 0, JSON.stringify(v1));
    // pinch on a UI panel (not the map): the page does not scale
    if (hud) await r.two(hud.x, hud.y + 10, 40, 160);
    await r.check('pinch over the HUD does not scale the page', (await vv()).scale === 1);
    // page cannot be scrolled sideways / down by dragging empty UI
    await r.swipe(w * 0.9, h * 0.5, w * 0.1, h * 0.5, 10);
    await r.swipe(w * 0.5, h * 0.9, w * 0.5, h * 0.1, 10);
    const v2 = await vv();
    await r.check('page does not scroll', v2.sx === 0 && v2.sy === 0 && (await r.ev<number>('document.documentElement.scrollWidth - innerWidth')) <= 0, JSON.stringify(v2));
    // long press on text must not select it or open a context menu
    if (hud) await r.hold(hud.x, hud.y, 900);
    await r.check('long press on UI text selects nothing', (await r.ev<string>('String(getSelection())')) === '');
    const ctx = await r.ev<boolean>("new Promise((res) => { const c = document.querySelector('#app canvas'); const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); c.dispatchEvent(ev); res(ev.defaultPrevented); })");
    await r.check('canvas contextmenu is suppressed', ctx === true);
    // orientation change / resize relayout
    const lay = async (label: string): Promise<void> => {
      const info = await r.ev<{ cw: number; ch: number; iw: number; ih: number; over: number; out: string[] }>(`(() => { const c = document.querySelector('#app canvas'); const out = []; const ui = document.getElementById('ui'); for (const k of ui.children) { const sr = k.shadowRoot; const els = sr ? [...sr.children].filter((e) => e.tagName !== 'STYLE' && !e.classList.contains('layer')) : [k]; for (const e of els) { const q = e.getBoundingClientRect(); if (q.width > 2 && q.height > 2 && (q.right > innerWidth + 2 || q.left < -2 || q.bottom > innerHeight + 2 || q.top < -2)) out.push(k.tagName.toLowerCase() + ' ' + [q.left, q.top, q.right, q.bottom].map(Math.round).join(',')); } } return { cw: c.clientWidth, ch: c.clientHeight, iw: innerWidth, ih: innerHeight, over: document.documentElement.scrollWidth - innerWidth, out }; })()`);
      await r.check(`${label}: canvas fills the window, no horizontal overflow`, info.cw === info.iw && info.ch === info.ih && info.over <= 0, JSON.stringify({ cw: info.cw, ch: info.ch, iw: info.iw, ih: info.ih, over: info.over }));
      await r.check(`${label}: no HUD panel hangs outside the window`, info.out.length === 0, info.out.slice(0, 4).join(' | '));
    };
    await lay('initial');
    const rotated = { width: h, height: w };
    await r.page.setViewport({ ...rotated, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    await sleep(1500);
    await r.shot(`rotated-${r.vp}`);
    await lay('after rotating');
    // the camera aspect follows (a world point stays on screen) and touch still works afterwards
    const c0 = await r.cam();
    await r.swipe(rotated.width * 0.3, rotated.height * 0.5, rotated.width * 0.6, rotated.height * 0.5, 10);
    const c1 = await r.cam();
    await r.check('pan still works after rotating', Math.hypot(c1.tx - c0.tx, c1.tz - c0.tz) > 0.5);
    await r.page.setViewport({ width: w, height: h, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    await sleep(1500);
    await lay('after rotating back');
    // a smaller window (split screen / keyboard): 320 x 480
    await r.page.setViewport({ width: 320, height: 480, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    await sleep(1500);
    await r.shot(`small-${r.vp}`);
    await lay('320x480');
    await r.page.setViewport({ width: w, height: h, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  });
}
