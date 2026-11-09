/* eslint-disable @typescript-eslint/no-explicit-any -- runs in the page against the untyped __slope handle */
/** Page-side film library (M7.6.2): installed after `installLib`. Turns a manifest shot into `__slope.frameCam` (camera path + hour / weather / date timelines as a pure function of the
 * virtual clock) and offers the canvas capture paths. Camera maths lives in src/render/PromoCamera.ts (unit tested). */
export function installFilm(): void {
  const w = window as any; const P = w.__promo; const S = (): any => w.__slope;
  /** world position + ground height for an anchor key part `{ at, dx, dz, h }` */
  P.pt = async (k: any, H: { heightAt: any }): Promise<[number, number, number]> => {
    const s = S(); const a = P.anchor(k.at ?? 'map'); if (!a) throw new Error(`no anchor ${k.at}`);
    const x = a.x + (k.dx ?? 0), z = a.z + (k.dz ?? 0);
    return [x, H.heightAt(s.grid, x, z) + (k.h ?? 0), z];
  };
  /** Prepare a shot (already staged): resolve anchors, install the camera / timeline function. `shot.mode` = iso | free. */
  P.prepShot = async (shot: any, scene: any): Promise<any> => {
    const s = S(); const C = await P.imp('/src/render/PromoCamera.ts'), H = await P.imp('/src/render/Picking.ts'), Sky = await P.imp('/src/render/SkyActivity.ts'), Cal = await P.imp('/src/sim/calendar.ts');
    const keys: any[] = []; const ctl = s.renderer.controls; ctl.focusTween = null; if (ctl.yaw0 === undefined) ctl.yaw0 = ctl.yaw;
    const free = shot.mode === 'free';
    const looks: any[] = [];
    for (const k of shot.keys) {
      if (free) {
        const p = await P.pt(k, H); const l = k.look?.track ? [0, 0, 0] as [number, number, number] : await P.pt(k.look, H);
        keys.push({ t: k.t, ease: k.ease, v: [p[0], p[1], p[2], l[0], l[1], l[2], k.fov ?? 40] });
      } else {
        const a = P.anchor(k.at ?? 'map'); if (!a) throw new Error(`no anchor ${k.at}`);
        keys.push({ t: k.t, ease: k.ease, v: [a.x + (k.dx ?? 0), a.z + (k.dz ?? 0), Math.log(Math.max(0.2, k.zoom ?? 3)), k.yaw ?? 0] });
      }
      looks.push(k.look);
    }
    // the sky tracks: a strip / ramp pose as a function of the sim tick (SkyActivity's own pure functions)
    const track = (name: string): number[] | null => {
      const sa = s.skyActivity; const tick = s.sim.game.date.tick + s.loop.alpha; // the sky draws with game.date.tick + alpha (main.ts)
      if (name === 'plane') { const v = Array.from(sa.centres()).find((c: any) => c.open && c.strip) as any; if (!v) return null; const st = v.strip, u = ((tick + v.id * 17) % Sky.SKY_CYCLE) / Sky.SKY_CYCLE; const q = Sky.planePose(u, st.x + st.w / 2, st.y + st.h / 2, st.w >= st.h ? 0 : Math.PI / 2); return [q.x, q.z + H.heightAt(s.grid, q.x, q.y), q.y]; }
      if (name === 'canopy') { const v = Array.from(sa.centres()).find((c: any) => c.open && c.strip) as any; if (!v) return null; const st = v.strip, cx = st.x + st.w / 2, cy = st.y + st.h / 2, ax = st.w >= st.h ? 0 : Math.PI / 2, u0 = ((tick + v.id * 17) % Sky.SKY_CYCLE) / Sky.SKY_CYCLE; const q = Sky.canopyPose(u0, 0, cx, cy, ax); if (!q) { const e = Sky.planePose(Sky.JUMP_AT, cx, cy, ax); return [e.x, e.z + H.heightAt(s.grid, e.x, e.y), e.y]; } return [q.x, q.z + H.heightAt(s.grid, q.x, q.y), q.y]; }
      if (name === 'glider') { const r = Array.from(sa.ramps()).find((c: any) => c.open && c.landing) as any; if (!r) return null; const rx = r.x + r.w / 2, ry = r.y + r.h / 2, rz = H.heightAt(s.grid, rx, ry), lz = H.heightAt(s.grid, r.landing.x, r.landing.y); const u = ((tick + r.id * 29) % Sky.GLIDE_CYCLE) / Sky.GLIDE_CYCLE; const q = Sky.gliderPose(u, { x: rx, y: ry }, r.landing, rz, lz); return [q.x, q.z, q.y]; }
      return null;
    };
    const hourTl: Array<[number, number]> = shot.hour ?? [[0, scene.start?.hour ?? 10]];
    const wxTl: any[] = shot.weather ?? [];
    const dayTl: any[] = shot.days ?? [];
    let lastHour = NaN, wxIdx = -1, lastDay = -1;
    const atmos0 = { ...(scene.atmos ?? {}), ...(shot.atmos ?? {}) };
    s.lighting.disableNight = false;
    P.shotState = { track, keys };
    s.frameCam = (t: number): void => {
      const hour = C.sampleScalar(hourTl, t);
      if (dayTl.length) {
        const d0 = dayTl[0], d1 = dayTl[dayTl.length - 1];
        const f = Math.min(1, Math.max(0, t / Math.max(1e-6, d1.t - d0.t))); const day = Math.floor(Cal.simDayOf(d0.month, d0.dom) + (Cal.simDayOf(d1.month, d1.dom) - Cal.simDayOf(d0.month, d0.dom)) * f);
        if (day !== lastDay && (lastDay < 0 || day - lastDay >= (shot.dayStep ?? 3))) { lastDay = day; s.jumpSimToDay(day, hour); P.clearWeather?.(); }
      }
      if (Math.abs(hour - lastHour) > 1e-4) { lastHour = hour; s.setHour(hour); s.atmos.force({ ...atmos0, hour }); }
      for (let i = wxTl.length - 1; i >= 0; i--) if (t >= wxTl[i].t) { if (i !== wxIdx) { wxIdx = i; const q = wxTl[i]; P.weather(q.kind, q.kind === 'clear' ? 0 : (q.intensity ?? 1), q.wind ?? 0.1, q.fog ?? 0); } break; }
      const v = C.samplePath(keys, t, shot.spline !== false);
      if (free && s.renderer.viewMode.mode !== 'ride') { // the followed guest left (a ride rig must stay active for the free camera): take any other one, keep the sim running at the shot's rate
        const st = s.guestSim.store; let pick = 0; for (let i = 0; i < st.limit && !pick; i++) if (st.alive[i]) pick = st.id[i];
        if (pick) { s.view.ride(pick); s.loop.setSpeed(1); s.loop.timeScale = s.frameStepRate; }
      }
      if (free && shot.follow) { // follow the sled group from behind: camera behind the tail carrier, looking at the leader (carriers read at the fractional tick, see main.ts tourVehicles.update)
        const f = shot.follow, tick = s.loop.tickCount + s.loop.alpha; const list: any[] = Array.from(s.sim.tours.carriers(tick, [], 64)).filter((c: any) => c.kind === f.kind);
        if (list.length) {
          list.sort((a: any, b: any) => a.back - b.back); const lead = list[0], tail = list[list.length - 1];
          const hd = lead.heading, dx = Math.cos(hd), dz = Math.sin(hd);
          const px = tail.x - dx * f.back - dz * (f.side ?? 0), pz = tail.y - dz * f.back + dx * (f.side ?? 0), lx = lead.x + dx * (f.ahead ?? 2), lz = lead.y + dz * (f.ahead ?? 2);
          (P.followLog ??= []).push([t, H.heightAt(s.grid, lead.x, lead.y)]); const py = H.heightAt(s.grid, px, pz) + (f.h ?? 1.3), ly = H.heightAt(s.grid, lx, lz) + (f.lookH ?? 0.5);
          const a = C.lookAngles([px, py, pz], [lx, ly, lz]); P.lastFollow = [px, py, pz, a.yaw, a.pitch, f.fov ?? 55]; s.view.freeCam(...P.lastFollow); return;
        }
        if (P.lastFollow) { s.view.freeCam(...P.lastFollow); return; } // ride over: hold the last pose
      }
      if (free) {
        const p = [v[0], v[1], v[2]]; const g = H.heightAt(s.grid, p[0], p[2]) + 0.7; if (p[1] < g) p[1] = g;
        let l = [v[3], v[4], v[5]];
        const trk = looks.map((k) => k?.track).find(Boolean); if (trk) { const q = track(trk); if (q) l = q; }
        const a = C.lookAngles(p, l);
        s.view.freeCam(p[0], p[1], p[2], a.yaw, a.pitch, v[6]);
      } else {
        const c = s.renderer.controls; const gy = H.heightAt(s.grid, v[0], v[1]);
        c.focusTween = null; c.target.set(v[0], gy, v[1]); c.zoom = 1; c.zoomBy(Math.exp(v[2])); c.yaw = c.yaw0 + v[3] * Math.PI / 180; c.updateProjection?.();
      }
    };
    return { keys: keys.length, free };
  };
  /** Advance the sim until the sky cycle is at phase `u` (plane or glider), so the jump / launch happens on cue. */
  P.cue = (c: any): any => {
    const s = S(), sa = s.skyActivity; let n = 0; const loop = s.loop;
    for (let i = 0; i < 400; i++) {
      const tick = loop.tickCount;
      if (c.tour) { // a sled group leaves on cue (carriers are view-only: nothing in the sim reads the ride list): p0 = share of the out-and-back already done, so the whole group is on the way down
      const st: any = Array.from(s.sim.tours.st.values()).find((q: any) => q.def.vehicle === c.tour && q.plan.ok); if (!st) return { ok: false };
      const D = c.ticks ?? 10, tick = loop.tickCount; st.rides.push({ start: tick - (c.p0 ?? 0.6) * D, end: tick - (c.p0 ?? 0.6) * D + D, riders: 8 }); return { ok: true, tiles: st.plan.tiles.length };
    }
    if (c.sky === 'plane') { const v: any = Array.from(sa.centres()).find((q: any) => q.strip); if (!v) return { ok: false }; const u = ((tick + v.id * 17) % 80) / 80; if (Math.abs(u - c.u) < 0.013) return { ok: true, n, u }; }
      else { const r: any = Array.from(sa.ramps()).find((q: any) => q.landing); if (!r) return { ok: false }; const u = ((tick + r.id * 29) % 120) / 120; if (Math.abs(u - c.u) < 0.013) return { ok: true, n, u }; }
      P.adv(1); n++;
    }
    return { ok: false, n };
  };
  // ---- capture paths (page side). `port` = the Node frame sink. Called in the same task as the render, so no preserveDrawingBuffer is needed. ----
  /** The game's sky is a CSS gradient BEHIND the transparent WebGL canvas (Lighting.skyElement): composite it into a 2D canvas so the capture has the sky (same task as the render). */
  P.comp = (gl: HTMLCanvasElement): HTMLCanvasElement => {
    if (!P.cc || P.cc.width !== gl.width || P.cc.height !== gl.height) { P.cc = document.createElement('canvas'); P.cc.width = gl.width; P.cc.height = gl.height; P.cx = P.cc.getContext('2d', { alpha: false }); }
    const cx: CanvasRenderingContext2D = P.cx; const g = cx.createLinearGradient(0, 0, 0, gl.height); const bg = gl.parentElement!.style.background;
    const re = /rgba?\((\d+),\s*(\d+),\s*(\d+)[^)]*\)\s*([\d.]+)%/g; let m: RegExpExecArray | null, n = 0;
    while ((m = re.exec(bg))) { g.addColorStop(Math.min(1, Number(m[4]) / 100), `rgb(${m[1]},${m[2]},${m[3]})`); n++; }
    if (!n) { g.addColorStop(0, '#1b2a44'); g.addColorStop(1, '#1b2a44'); }
    cx.fillStyle = g; cx.fillRect(0, 0, gl.width, gl.height); cx.drawImage(gl, 0, 0);
    return P.cc;
  };
  P.grab = async (file: string, fmt: string, q: number, port: number, step: [number, number]): Promise<number> => {
    const s = S(); s.frameStep(step[0], step[1]);
    const c: HTMLCanvasElement = P.comp(s.renderer.webgl.domElement);
    if (fmt === 'webcodecs') {
      const E = P.enc; const vf = new (w as any).VideoFrame(c, { timestamp: Math.round(E.n * 1e6 / E.fps) }); E.enc.encode(vf, { keyFrame: E.n % 60 === 0 }); vf.close(); E.n++;
      if (E.n % 8 === 0) await E.enc.flush();
      return 0;
    }
    const b: Blob = await new Promise((r) => c.toBlob((x) => r(x!), fmt === 'png' ? 'image/png' : 'image/jpeg', q));
    const rs = await fetch(`http://127.0.0.1:${port}/f?name=${encodeURIComponent(file)}`, { method: 'POST', body: b });
    if (!rs.ok) throw new Error('sink ' + rs.status);
    return b.size;
  };
  P.encStart = async (port: number, file: string, W: number, H: number, fps: number, bitrate: number): Promise<string> => {
    const codec = 'avc1.640033'; const E: any = { n: 0, fps }; const W2 = w as any;
    const cfg = { codec, width: W, height: H, bitrate, framerate: fps, latencyMode: 'quality', avc: { format: 'annexb' } };
    if (!(await W2.VideoEncoder.isConfigSupported(cfg)).supported) throw new Error('H.264 encode not supported at ' + W + 'x' + H);
    E.chain = Promise.resolve();
    E.enc = new W2.VideoEncoder({ output: (ch: any) => { const b = new Uint8Array(ch.byteLength); ch.copyTo(b); E.chain = E.chain.then(() => fetch(`http://127.0.0.1:${port}/f?name=${encodeURIComponent(file)}&append=1`, { method: 'POST', body: b })); }, error: (e: any) => console.log('enc err ' + e) });
    E.enc.configure(cfg); P.enc = E; return codec;
  };
  P.encEnd = async (): Promise<number> => { await P.enc.enc.flush(); await P.enc.chain; return P.enc.n; };
}
