/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate bodies poke the untyped window.__slope debug API */
/* Lift-tower foot flicker check (docs/flicker.md "Pylon foot"): boots the demo resort, centres the camera on the foot of a lift tower and counts OSCILLATING pixels
 * (luma derivative flips sign 3x in a row, each step >= T) inside a small crop around it, for windows of 5 frames 0.1 deg of yaw apart (rot) and for 5 frames
 * with the game running at speed 3 (time: sun + carriers move, camera still) and a slow pan (pan). Same metric as `npm run flicker`, restricted to the crop.
 * Usage: npm run flicker:tower -- [--quality high|med|low] [--season winter|summer] [--size 64] [--seed 61] [--lift N] [--tower N] [--zooms 3,6,12] [--yaws 8] [--crop 120] [--T 8]
 *   [--shadows off (strength 0)] [--static off (freeze the static shadow map)] [--freeze 1 (hold the lift carriers still)] [--flat 1 (the flattest tower tile)] [--dump 1] [--bias k --nofs k (scale the receiver depth bias / normal offset)] [--off trees,guests,terrain,towerparts] [--out name]
 * Output: JSON + a heatmap per zoom `.weave/shots/flicker-tower-<out>-z<i>.png`, a crop shot `...-crop<i>.png`. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch, startServer } from './lib/harness';

function parseArgs(): Record<string, string> {
  const a = process.argv.slice(2), r: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) if (a[i]!.startsWith('--')) r[a[i]!.slice(2)] = a[i + 1] && !a[i + 1]!.startsWith('--') ? a[++i]! : '1';
  return r;
}
async function run(cfg: { yaws: number; zooms: number[]; T: number; off: string[]; crop: number; shadows: boolean; frozen: boolean; liftIdx: number; towerIdx: number; biasK: number; nofsK: number; dump: boolean; flat: boolean; noShadow: string[]; ystep: number; probe: boolean; freezeLifts: boolean }): Promise<any> {
  const s = (window as any).__slope, r = s.renderer, gl = r.webgl, canvas: HTMLCanvasElement = gl.domElement, c = r.controls;
  const W = canvas.width, H = canvas.height, cw = Math.min(cfg.crop, W), ch = Math.min(cfg.crop, H);
  const x0 = Math.floor((W - cw) / 2), y0 = Math.floor((H - ch) / 2), N = cw * ch;
  const cv2 = document.createElement('canvas'); cv2.width = W; cv2.height = H;
  const ctx = cv2.getContext('2d', { willReadFrequently: true })!;
  const orig = gl.render.bind(gl);
  gl.render = (sc: unknown, cam: unknown): void => { orig(sc, cam); const h = (window as any).__flHook; if (h) { (window as any).__flHook = null; h(); } };
  const grab = (): Promise<{ l: Uint8Array; img: ImageData }> => new Promise((res) => {
    (window as any).__flHook = (): void => {
      ctx.clearRect(0, 0, W, H); ctx.drawImage(canvas, 0, 0);
      const img = ctx.getImageData(x0, y0, cw, ch), d = img.data, l = new Uint8Array(N);
      for (let i = 0, p = 0; i < N; i++, p += 4) l[i] = 0.3 * d[p]! + 0.59 * d[p + 1]! + 0.11 * d[p + 2]!;
      res({ l, img });
    };
  });
  const lifts = s.sim.lifts.all().filter((l: any) => l.towers.length > 0);
  if (!lifts.length) return { error: 'no lift with towers' };
  let lift = lifts[Math.min(lifts.length - 1, cfg.liftIdx)], tw = lift.towers[Math.min(lift.towers.length - 1, cfg.towerIdx)];
  let spread = -1;
  if (cfg.flat) { // the tower whose tile is flattest: the footing cap is then (nearly) coplanar with the terrain: the z-fight suspect
    let best = 1e9;
    for (const l of lifts) for (const t of l.towers) { const q = s.grid.getCorners(Math.floor(t.x), Math.floor(t.z)) as number[]; const sp = Math.max(...q) - Math.min(...q); if (sp < best) { best = sp; lift = l; tw = t; } }
    spread = best;
  }
  c.target.set(tw.x, tw.groundY, tw.z); c.focusTween = null;
  for (const n of cfg.off) { const g = n === 'trees' ? s.trees.group : n === 'rocks' ? s.rocks.group : n === 'guests' ? s.guestRenderer.group : n === 'terrain' ? s.terrain.group : n === 'water' ? s.water.group : null; if (g) g.visible = false; }
  if (cfg.noShadow.length) { // bisect the CASTERS: stop selected meshes from casting (they stay visible)
    r.scene.traverse((o: any) => { if (!o.isMesh || !o.material || Array.isArray(o.material)) return;
      const m = o.material, pos = o.geometry.attributes.position;
      if (cfg.noShadow.includes('cable') && m.isMeshBasicMaterial && !m.transparent && !o.isInstancedMesh && pos && pos.count > 20 && !o.geometry.attributes.uv) o.userData.noShadow = true;
      if (cfg.noShadow.includes('lifts') && o.parent?.parent === s.liftTools?.view?.group) o.userData.noShadow = true; });
    const ents: any[] = [...(s.liftTools?.view?.entries?.values?.() ?? [])];
    console.log('LIFTDBG ents=' + ents.length + ' groupKids=' + (s.liftTools?.view?.group?.children?.length ?? -1) + ' towersTotal=' + ents.reduce((n: number, e: any) => n + e.towers.length, 0) + ' entry0kids=' + (ents[0]?.group?.children?.length ?? -1));
    if (cfg.noShadow.includes('towers')) for (const e of ents) for (const t of e.towers) t.mesh.userData.noShadow = true;
    if (cfg.noShadow.includes('cableE')) for (const e of ents) { if (e.cable) e.cable.userData.noShadow = true; if (e.cableNear) e.cableNear.userData.noShadow = true; }
    if (cfg.noShadow.includes('rest')) for (const e of ents) e.group.children.forEach((c: any) => { if (!e.towers.some((t: any) => t.mesh === c) && c !== e.cable && !c.children?.length) c.userData.noShadow = true; });
    if (cfg.noShadow.includes('carriers')) s.liftTools.view.group.traverse((o: any) => { if (o.userData.shadowDynamic) { o.userData.shadowDynamic = false; o.userData.noShadow = true; } });
    if (cfg.noShadow.includes('stations')) for (const e of ents) e.group.children.forEach((c: any) => { if (c.children?.length) c.userData.noShadow = true; });
    if (cfg.noShadow.includes('liftsAll') && s.liftTools?.view?.group) s.liftTools.view.group.traverse((o: any) => { o.userData.noShadow = true; });
    r.shadows.hasStatic = false; r.shadows.sig = 0;
  }
  if (!cfg.shadows) r.shadows.uniforms.uShadowP.value.x = 0, r.shadows.update = (): void => { r.shadows.uniforms.uShadowP.value.x = 0; };
  if (cfg.frozen) r.shadows.freezeStatic = true;
  if (cfg.biasK !== 1 || cfg.nofsK !== 1) { const u = r.shadows.update.bind(r.shadows); let base = 0, mine = -1; r.shadows.update = (...args: unknown[]): void => { (u as any)(...args); const P = r.shadows.uniforms.uShadowP.value; if (P.y !== mine) base = P.y; mine = base * cfg.biasK; P.y = mine; P.w *= cfg.nofsK; }; } // bisect: scale the receiver depth bias / normal offset
  if (cfg.freezeLifts) for (const l of s.sim.lifts.all()) l.open = false; // carriers animate on the render clock even with the sim paused: hold them still so the metric sees the shadows, not moving chairs
  s.loop.setSpeed(0);
  const yaw0 = c.yaw, out: any[] = [], heats: string[] = [], crops: string[] = [];
  const osc = (ring: Uint8Array[], heat: Uint16Array): number => {
    const [p, q, rr, t] = ring as [Uint8Array, Uint8Array, Uint8Array, Uint8Array]; let n = 0;
    for (let j = 0; j < N; j++) { const d1 = q[j]! - p[j]!, d2 = rr[j]! - q[j]!, d3 = t[j]! - rr[j]!; if (d1 * d2 < 0 && d2 * d3 < 0 && Math.abs(d1) >= cfg.T && Math.abs(d2) >= cfg.T && Math.abs(d3) >= cfg.T) { n++; heat[j]!++; } }
    return n;
  };
  const toPng = (img: ImageData | null, heat?: Uint16Array): string => { const hc = document.createElement('canvas'); hc.width = cw; hc.height = ch; const hx = hc.getContext('2d')!, im = hx.createImageData(cw, ch);
    for (let j = 0; j < N; j++) { const g = img ? 0.3 * img.data[j * 4]! + 0.59 * img.data[j * 4 + 1]! + 0.11 * img.data[j * 4 + 2]! : 0; if (!heat) { im.data[j * 4] = img!.data[j * 4]!; im.data[j * 4 + 1] = img!.data[j * 4 + 1]!; im.data[j * 4 + 2] = img!.data[j * 4 + 2]!; } else { const v = Math.min(255, heat[j]! * 60); im.data[j * 4] = Math.min(255, g * 0.6 + v); im.data[j * 4 + 1] = v ? 0 : g * 0.6; im.data[j * 4 + 2] = v ? 0 : g * 0.6; } im.data[j * 4 + 3] = 255; }
    hx.putImageData(im, 0, 0); return hc.toDataURL('image/png'); };
  for (const z of cfg.zooms) {
    c.zoomBy(z / c.zoom);
    if (cfg.probe) { const ents: any[] = [...(s.liftTools?.view?.entries?.values?.() ?? [])]; const rows: string[] = [];
      for (let f = 0; f < 6; f++) { await grab(); const e = ents[1]; const im = e.carriers; rows.push(`f${f} ver=${im.instanceMatrix.version} cnt=${im.count} m0=${Array.from(im.instanceMatrix.array.slice(12, 15) as number[]).map((v) => v.toFixed(4)).join(',')} dyn=${r.shadows.dyn.length} sp=${r.shadows.stats.staticPasses} dp=${r.shadows.stats.dynPasses} tick=${s.loop.tickCount}`); }
      console.log('LIFTDBG ' + rows.join(' | ')); }
    for (let w = 0; w < 6; w++) await grab(); // warm-up: the pose settles for a few frames after the target / zoom change
    const res: any = { zoom: z };
    for (const kind of ['rot', 'time', 'pan'] as const) {
      let tot = 0, wins = 0; const heat = new Uint16Array(N); let last: ImageData | null = null; const first: ImageData[] = [];
      const nwin = kind === 'rot' ? cfg.yaws : 2;
      for (let k = 0; k < nwin; k++) {
        const ring: Uint8Array[] = [], a = (360 / cfg.yaws) * k;
        if (kind === 'rot') { c.yaw = yaw0 + a * Math.PI / 180; await grab(); await grab(); }
        if (kind === 'time') { s.loop.setSpeed(3); await new Promise((r2) => setTimeout(r2, 300)); }
        for (let i = 0; i < 5; i++) {
          if (kind === 'rot') c.yaw = yaw0 + (a + i * cfg.ystep) * Math.PI / 180;
          else if (kind === 'pan') c.target.x = tw.x + (k * 0.5 + i * 0.01); // 0.01 tile (~ 0.4 px at zoom 12) per frame
          const f = await grab(); ring.push(f.l); last = f.img; if (kind === 'rot' && k === 0) first.push(f.img); if (ring.length > 4) ring.shift();
          if (ring.length === 4) { tot += osc(ring, heat); wins++; }
        }
        if (kind === 'time') s.loop.setSpeed(0);
        if (kind === 'pan') c.target.x = tw.x;
      }
      res[kind] = +(tot / Math.max(1, wins)).toFixed(1);
      if (kind === 'rot') { heats.push(toPng(last, heat)); crops.push(toPng(last)); if (cfg.dump) { for (let i = 0; i + 1 < first.length; i++) { const dimg = new ImageData(cw, ch); for (let j = 0; j < N * 4; j += 4) { const d = Math.abs(0.3 * (first[i]!.data[j]! - first[i + 1]!.data[j]!) + 0.59 * (first[i]!.data[j + 1]! - first[i + 1]!.data[j + 1]!) + 0.11 * (first[i]!.data[j + 2]! - first[i + 1]!.data[j + 2]!)) * 8; dimg.data[j] = dimg.data[j + 1] = dimg.data[j + 2] = Math.min(255, d); dimg.data[j + 3] = 255; } crops.push(toPng(dimg)); } } }
    }
    out.push(res);
  }
  const sh = r.shadows; return { out, heats, crops, shadow: { P: sh.uniforms.uShadowP.value.toArray(), half: sh.win?.half, texel: sh.win?.texel, sun: sh.win?.sunDir, heights: sh.heights, stats: { ...sh.stats } }, tower: { spread, x: tw.x, z: tw.z, groundY: tw.groundY, h: tw.headY - tw.groundY, kind: lift.kind }, region: [x0, y0, cw, ch] };
}

const a = parseArgs();
const season = (a.season ?? 'winter') as 'winter' | 'summer', size = Number(a.size ?? 64), seed = Number(a.seed ?? 61);
const srv = await startServer(), br = await launch();
mkdirSync('.weave/shots', { recursive: true });
try {
  const page = await br.newPage();
  page.on('console', (m) => { if (m.text().startsWith('LIFTDBG')) console.log(m.text()); });
  await page.setViewport({ width: 960, height: 600, deviceScaleFactor: 1 });
  if (a.quality) await page.evaluateOnNewDocument((v: string) => { try { localStorage.setItem('slope.quality', v); } catch { /* none */ } }, a.quality);
  await page.goto(`${srv.url}?${new URLSearchParams({ size: String(size), seed: String(seed), start: season, hints: '0' })}`, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => !!(window as any).__slope, { timeout: 90000 });
  await page.evaluate(() => {
    const s = (window as any).__slope;
    s.populateDemo('medium');
    const loop = s.loop; if (loop.paused) loop.setSpeed(1);
    const t = loop.tickCount + 1500; let g = 0; while (loop.tickCount < t && g++ < 1e6) loop.advance(1);
    s.setHour(14);
  });
  await new Promise((r) => setTimeout(r, 2500));
  const r = await page.evaluate(run, { yaws: Number(a.yaws ?? 8), zooms: (a.zooms ?? '3,6,12').split(',').map(Number), T: Number(a.T ?? 8), off: a.off ? a.off.split(',') : [], crop: Number(a.crop ?? 120), shadows: a.shadows !== 'off', frozen: a.static === 'off', liftIdx: Number(a.lift ?? 0), towerIdx: Number(a.tower ?? 1), biasK: Number(a.bias ?? 1), nofsK: Number(a.nofs ?? 1), dump: !!a.dump, flat: !!a.flat, noShadow: a.noshadow ? a.noshadow.split(",") : [], ystep: Number(a.ystep ?? 0.1), probe: !!a.probe, freezeLifts: !!a.freeze });
  if (r.error) throw new Error(r.error);
  r.heats.forEach((h: string, i: number) => writeFileSync(`.weave/shots/flicker-tower-${a.out ?? 'run'}-z${i}.png`, Buffer.from(h.split(',')[1]!, 'base64')));
  r.crops.forEach((h: string, i: number) => writeFileSync(`.weave/shots/flicker-tower-${a.out ?? 'run'}-crop${i}.png`, Buffer.from(h.split(',')[1]!, 'base64')));
  delete r.heats; delete r.crops;
  console.log(JSON.stringify(r));
  const tot = r.out.reduce((s: number, o: any) => s + o.rot + o.time + o.pan, 0);
  console.log(`TOTAL osc px/window (rot+time+pan, all zooms): ${tot.toFixed(1)}`);
  writeFileSync(`.weave/shots/flicker-tower-${a.out ?? 'run'}.json`, JSON.stringify(r));
} finally { await br.close(); srv.stop(); }
