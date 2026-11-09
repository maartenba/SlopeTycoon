/* eslint-disable @typescript-eslint/no-explicit-any -- runs in the page against the untyped __slope handle */
/** Installed into the page once: `window.__promo` = the staging library (all calls go through the game's real APIs). */
export function installLib(): void {
  const w = window as any;
  const S = (): any => w.__slope;
  const imp = (u: string): Promise<any> => (new Function('u', 'return import(u)') as any)(u);
  const P: any = {};
  P.imp = imp;
  P.log = [] as string[];
  P.adv = (n: number): void => { const loop = S().loop; const was = loop.paused; if (was) loop.setSpeed(1); const t = loop.tickCount + n; let g = 0; while (loop.tickCount < t && g++ < 1e6) loop.advance(1); if (was) loop.setSpeed(0); };
  P.freeze = (): void => S().loop.setSpeed(0);
  P.refresh = (): void => { const s = S(); s.sim.buildings.reevaluate(); s.sim.refreshCoverage(undefined, true); s.buildingsView.sync?.(); s.refreshProps(Array.from({ length: s.grid.chunksPerRow ** 2 }, (_, i) => i)); };
  P.clearWeather = (): void => { const wx = S().sim.weather.current; wx.kind = 'clear'; wx.intensity = 0; wx.fog = 0; wx.wind = 0.1; };
  P.weather = (k: string, intensity = 1, wind = 0.1, fog = 0): void => { const wx = S().sim.weather.current; wx.kind = k; wx.intensity = intensity; wx.wind = wind; wx.fog = fog; };
  P.lift = (kindPrefix: string): any => S().sim.lifts.all().find((l: any) => String(l.kind).startsWith(kindPrefix));
  P.bld = (type: string): any => S().sim.buildings.all().find((b: any) => b.type === type);
  P.centre = (b: any): { x: number; z: number } => ({ x: b.x + b.w / 2, z: b.y + b.h / 2 });
  P.anchor = (name: string): { x: number; z: number } | null => {
    const s = S(), sim = s.sim;
    if (name === 'map') return { x: sim.size / 2, z: sim.size / 2 };
    const m = /^(lift|bottom|top):(\w+)$/.exec(name);
    if (m) { const l = P.lift(m[2]!); if (!l) return null; const pt = m[1] === 'top' ? l.top : l.bottom; return { x: pt.x, z: pt.y }; }
    if (name.startsWith('mid:')) { const l = P.lift(name.slice(4)); return l ? { x: (l.top.x + l.bottom.x) / 2, z: (l.top.y + l.bottom.y) / 2 } : null; }
    if (name.startsWith('piste:')) { const r = P.pistes?.[Number(name.slice(6))]; return r ? { x: r.x, z: r.y } : null; }
    if (name.startsWith('pos:')) { const [x, z] = name.slice(4).split(',').map(Number); return { x: x!, z: z! }; }
    if (name === 'skyact') { const b = P.bld('grassStrip') ?? P.bld('skydiveCentre'); return b ? P.centre(b) : null; }
    if (name === 'snowcat') { const cs = s.sim.ops.grooming.cats; const c = cs.find((q: any) => !q.done) ?? cs[0]; return c ? { x: c.x, z: c.y } : null; }
    { const m3 = /^sled:([\d.]+)$/.exec(name); if (m3 && P.sledLine) { const q = P.sledLine, f = Number(m3[1]) * (q.len - 1); return { x: q.sx + q.vx * f + 0.5, z: q.sy + q.vy * f + 0.5 }; } }
    if (name === 'river') { const r = P.river; if (!r || !r.length) return null; const m2 = r[0]; return { x: m2.x, z: m2.y }; }
    if (name === 'concertStage' || name === 'dressing') {
      const g = s.festivalDressing.group, box = new s.THREE.Box3().setFromObject(g); if (box.isEmpty()) return null;
      return { x: (box.min.x + box.max.x) / 2, z: (box.min.z + box.max.z) / 2 };
    }
    const b = P.bld(name); if (b) return P.centre(b);
    return null;
  };
  /** Camera pose: { at, dx, dz, zoom (x over min zoom), yaw (deg offset from default or absolute 'abs'), } */
  P.cam = async (k: any): Promise<any> => {
    const s = S(), c = s.renderer.controls; let a = P.anchor(k.at ?? 'map');
    for (let i = 0; i < 12 && !a; i++) { await new Promise((r) => setTimeout(r, 500)); a = P.anchor(k.at ?? 'map'); } // dressing / sky meshes appear on a render frame
    if (!a) return { ok: false, why: `no anchor ${k.at}` };
    const x = a.x + (k.dx ?? 0), z = a.z + (k.dz ?? 0);
    const gy = s.grid.getCorner(Math.max(0, Math.min(s.grid.size, Math.round(x))), Math.max(0, Math.min(s.grid.size, Math.round(z)))) * 0.5; // ground height under the target (the iso view projects the target point)
    c.focusTween = null; c.target.set(x, typeof gy === 'number' ? gy : 0, z);
    c.zoom = 1; c.zoomBy(k.zoom ?? 3);
    if (k.yaw !== undefined) c.yaw = (k.yawAbs ? 0 : c.yaw0 ?? (c.yaw0 = c.yaw)) + k.yaw * Math.PI / 180;
    c.updateProjection?.();
    return { ok: true, x, z };
  };
  P.hideUi = (): void => { const u = document.getElementById('ui'); if (u) u.style.display = 'none'; const st = document.createElement('style'); st.textContent = 'st-toast{display:none!important} body>div[style*="z-index: 21"]{display:none!important}'; document.head.appendChild(st); };
  /** Place a building through the real rules near an anchor; a site that ends up inactive (no road / path) is taken back and the next one tried (up to 10). */
  P.place = async (type: string, nearName: string, rmax = 30, extra: any = {}): Promise<any> => {
    const s = S(), sim = s.sim; const anchor = P.anchor(nearName) ?? P.anchor('baseLodge'); if (!anchor) return null;
    const { findSite } = await imp('/src/tutorial/suggest.ts'), { BUILDINGS } = await imp('/src/config/buildings.ts');
    const { Bot } = await imp('/src/game/bot.ts'), W = await imp('/src/world/Networks.ts');
    const tried: any[] = []; const bot: any = new Bot(sim, { starter: false });
    for (let n = 0; n < 10; n++) {
      const site = findSite(sim, type, { x: anchor.x, y: anchor.z }, { rmax, route: extra.route ?? (BUILDINGS[type]?.access === 'road' ? 'road' : undefined), ...extra, avoid: (r: any) => tried.some((t) => r.x < t.x + t.w + 1 && t.x < r.x + r.w + 1 && r.y < t.y + t.h + 1 && t.y < r.y + r.h + 1) });
      if (!site) { P.log.push(`${type}: no site (${n} tried)`); return null; }
      const o = s.debugPlace(type, site.x, site.y, site.rot, true);
      if (!o.ok) { tried.push({ x: site.x, y: site.y, w: 3, h: 3 }); continue; }
      const b = o.building;
      sim.buildings.reevaluate(); sim.refreshCoverage(undefined, true);
      if (!b.active) { try { bot.ensure(W.NetKind.Road, b, [sim.networks.roadEntry]); sim.buildings.reevaluate(); sim.refreshCoverage(undefined, true); } catch { /* ignore */ } }
      if (b.active) return b;
      P.log.push(`${type}: ${b.reason ?? 'inactive'} at ${b.x},${b.y}: removed`);
      tried.push({ x: b.x, y: b.y, w: b.w, h: b.h }); sim.buildings.remove(b.id); sim.buildings.reevaluate();
    }
    return null;
  };
  w.__promo = P;
}

