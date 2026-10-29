/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate bodies poke the untyped window.__slope debug API */
/* Flicker measurement (docs/flicker.md): boots the real game in the SwiftShader harness, sweeps the camera (fine windows 0.1 deg apart at anchors over 360 deg for oscillation, a 2 deg yaw sweep and a 1 % zoom out/in sweep for popping)
 * and captures one frame per step IN the page (hooked into WebGLRenderer.render, so one game frame = one step like a smooth 60 fps motion).
 * Metrics: oscillating pixels (luma temporal derivative flips sign on 3 consecutive steps, each > T = temporal noise a smooth camera move can not produce),
 * popping events (frames whose number of strongly changed 16 px blocks jumps over the rolling median), still noise (identical camera, N frames).
 * Usage: npm run flicker -- [--only 64-winter-day] [--step 3 (pop sweep deg)] [--anchor 20 (fine windows every N deg)] [--zstep 0.015] [--kinds rotfine,rotpop,zoomfine,zoompop,still] [--T 10] [--w 960 --h 600] [--tag before] [--off trees,water,...] [--list]
 * Output: .weave/shots/flicker-<tag>-<scenario>-{rot,zoom}.png (heatmaps) + .weave/shots/flicker-<tag>.json + flicker-<tag>.md (not part of the default tests). */
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch, startServer } from './lib/harness';

interface Scenario { id: string; size: number; start: 'winter' | 'summer'; hour: number; seed: number; /** Phase 6: `river` digs a river from the best natural spring, `mid` rebuilds the first lift with a mid-station; the camera then looks at it. */ extra?: 'river' | 'mid' }
const SCENARIOS: Scenario[] = [
  { id: '64-winter-day', size: 64, start: 'winter', hour: 12, seed: 61 },
  { id: '64-summer-day', size: 64, start: 'summer', hour: 12, seed: 61 },
  { id: '128-winter-night', size: 128, start: 'winter', hour: 23, seed: 7 },
  { id: '128-summer-day', size: 128, start: 'summer', hour: 12, seed: 7 },
  { id: '256-winter-day', size: 256, start: 'winter', hour: 12, seed: 5 },
  { id: '256-summer-day', size: 256, start: 'summer', hour: 14, seed: 5 },
  { id: '64-summer-river', size: 64, start: 'summer', hour: 12, seed: 61, extra: 'river' },
  { id: '64-winter-mid', size: 64, start: 'winter', hour: 12, seed: 5, extra: 'mid' },
];

function parseArgs(): Record<string, string> {
  const a = process.argv.slice(2), r: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) if (a[i]!.startsWith('--')) r[a[i]!.slice(2)] = a[i + 1] && !a[i + 1]!.startsWith('--') ? a[++i]! : '1';
  return r;
}

/** Runs in the page. Returns the metrics + heatmap data URLs for one sweep kind. */
async function sweepInPage(cfg: { kind: 'rotfine' | 'rotpop' | 'zoomfine' | 'zoompop' | 'jitter' | 'sheet' | 'still'; step: number; zstep: number; w: number; h: number; T: number; off: string[]; zlo: number; zhi: number; zmid: number }): Promise<any> {
  const s = (window as any).__slope;
  const gl = s.renderer.webgl, canvas: HTMLCanvasElement = gl.domElement, c = s.renderer.controls;
  const W = canvas.width, H = canvas.height, N = W * H;
  const cv2 = document.createElement('canvas'); cv2.width = W; cv2.height = H;
  const ctx = cv2.getContext('2d', { willReadFrequently: true })!;
  if (!(window as any).__flHooked) {
    const orig = gl.render.bind(gl);
    (window as any).__flHook = null;
    gl.render = (sc: unknown, cam: unknown): void => { orig(sc, cam); const h = (window as any).__flHook; if (h) { (window as any).__flHook = null; h(); } };
    (window as any).__flHooked = true;
  }
  const grab = (): Promise<Uint8Array> => new Promise((res) => {
    (window as any).__flHook = (): void => {
      ctx.clearRect(0, 0, W, H); ctx.drawImage(canvas, 0, 0);
      const d = ctx.getImageData(0, 0, W, H).data, l = new Uint8Array(N);
      for (let i = 0, p = 0; i < N; i++, p += 4) { const a = d[p + 3]! / 255; l[i] = (0.3 * d[p]! + 0.59 * d[p + 1]! + 0.11 * d[p + 2]!) * a + 128 * (1 - a); }
      res(l);
    };
  });
  // feature bisect: hide whole layers
  const hidden: Array<{ o: any; v: boolean }> = [];
  for (const n of cfg.off) {
    const g = n === 'trees' ? s.trees.group : n === 'rocks' ? s.rocks.group : n === 'water' ? s.water.group : n === 'guests' ? s.guestRenderer.group : n === 'terrain' ? s.terrain.group : n === 'decor' ? s.villageDecor.group : n === 'nature' ? s.natureView.group : n === 'buildings' ? s.buildingsView?.group : null;
    if (g) { hidden.push({ o: g, v: g.visible }); g.visible = false; }
  }
  for (const n of cfg.off) if (/^\d+$/.test(n)) { const ch = s.renderer.scene.children[Number(n)]; if (ch) { hidden.push({ o: ch, v: ch.visible }); ch.visible = false; } }
  if (cfg.off.includes('list')) console.log('SCENE', s.renderer.scene.children.map((ch: any, i: number) => `${i}:${ch.type}:${ch.name || ''}:${ch.children?.length ?? 0}`).join(' | '));
  s.loop.setSpeed(0);
  const frames: number[] = [];
  const setZoom = (z: number): void => { c.zoomBy(z / c.zoom); };
  const steps: Array<() => void> = [];
  const labels: string[] = [];
  const segStart = new Set<number>(); // indices that start a new segment (the temporal ring restarts there)
  const wantOsc = cfg.kind === 'rotfine' || cfg.kind === 'zoomfine' || cfg.kind === 'still', wantPop = cfg.kind === 'rotpop' || cfg.kind === 'zoompop';
  const FINE = 5; // frames per fine window
  if (cfg.kind === 'rotfine') { // windows of 5 frames 0.1 deg apart at anchors every cfg.step deg: content moves < 1 px per frame, so a smooth render changes monotonically
    setZoom(cfg.zmid); const y0 = c.yaw;
    for (let a = 0; a < 360; a += cfg.step) { segStart.add(steps.length); for (let i = 0; i < FINE; i++) { steps.push(() => { c.yaw = y0 + (a + i * 0.1) * Math.PI / 180; }); labels.push(`${a}deg`); } }
  } else if (cfg.kind === 'rotpop') {
    setZoom(cfg.zmid); const y0 = c.yaw; segStart.add(0);
    for (let a = 0; a <= 360; a += cfg.step) { steps.push(() => { c.yaw = y0 + a * Math.PI / 180; }); labels.push(`${a}deg`); }
  } else if (cfg.kind === 'zoompop') {
    const zs: number[] = []; for (let z = cfg.zhi; z > cfg.zlo; z *= 1 - cfg.zstep) zs.push(z); const up = zs.slice().reverse();
    segStart.add(0); for (const z of zs) { steps.push(() => setZoom(z)); labels.push(`out z${z.toFixed(2)}`); }
    segStart.add(steps.length); for (const z of up) { steps.push(() => setZoom(z)); labels.push(`in z${z.toFixed(2)}`); }
  } else if (cfg.kind === 'sheet') { // 6 frames across the tree LOD threshold (visible height 28), kept for the contact sheet
    const vh1 = (c.camera.top - c.camera.bottom) * c.zoom, z0 = Math.min(cfg.zhi, Math.max(cfg.zlo, vh1 / 28));
    segStart.add(0); for (let i = 0; i < 6; i++) { steps.push(() => setZoom(i === 0 ? z0 * 1.1 : z0 / 1.1)); labels.push(`sheet${i}`); } // frame 0 below the threshold band, then zoom out once past it and keep still: the next frames show the cross-fade running (150 ms apart)
  } else if (cfg.kind === 'jitter') { // zoom wobbles +-2 % around every LOD threshold (tree 28 / 90, terrain macro 100, guest impostor 70, rocks 45): level flips must be ~0 with hysteresis
    const vh1 = (c.camera.top - c.camera.bottom) * c.zoom;
    for (const vh of [28, 45, 70, 90, 100]) { const z = vh1 / vh; if (z < cfg.zlo || z > cfg.zhi) continue; segStart.add(steps.length); for (let i = 0; i < 24; i++) { steps.push(() => setZoom(z * (1 + (i % 2 ? 0.02 : -0.02)))); labels.push(`thr${vh}`); } }
  } else if (cfg.kind === 'zoomfine') {
    for (let z = cfg.zhi; z > cfg.zlo; z *= 0.8) { segStart.add(steps.length); for (let i = 0; i < FINE; i++) { steps.push(() => setZoom(z * (1 - 0.001 * i))); labels.push(`z${z.toFixed(2)}`); } }
  } else { setZoom(cfg.zmid); segStart.add(0); for (let i = 0; i < 8; i++) { steps.push(() => undefined); labels.push(`still${i}`); } }
  const lodState = (): string => `${s.trees?.layers?.[0]?.activeLevel}|${s.terrain.lodActive ? 1 : 0}|${s.guestRenderer.far ? 1 : 0}|${s.rocks?.layer?.activeLevel}`;
  const kept: Uint8Array[] = [];
  let flips = 0, prevState = '';
  await grab(); // warm up (first frame after boot)
  steps[0]!();
  const ring: Uint8Array[] = [];
  const heat = new Uint16Array(N);
  let oscTotal = 0; const madPerFrame: number[] = [], oscPerFrame: number[] = [], blocksPerFrame: number[] = [], bigPerFrame: number[] = [];
  const BW = 16, BX = Math.ceil(W / BW), BY = Math.ceil(H / BW);
  let last: Uint8Array | null = null, stillDiff = 0;
  for (let k = 0; k < steps.length; k++) {
    steps[k]!();
    if (cfg.kind === 'sheet') await new Promise((r) => setTimeout(r, 150));
    if (segStart.has(k)) { ring.length = 0; last = null; }
    const f = await grab();
    { const st = lodState(); if (!segStart.has(k) && prevState && st !== prevState) flips++; prevState = st; }
    if (cfg.kind === 'sheet') kept.push(f);
    ring.push(f); if (ring.length > 4) ring.shift();
    if (last && wantPop) {
      const blocks = new Float32Array(BX * BY); let big = 0, still = 0;
      for (let i = 0; i < N; i++) {
        const d = Math.abs(f[i]! - last[i]!);
        if (d > 40) big++;
        if (d > cfg.T) still++;
        const bi = ((i / W | 0) / BW | 0) * BX + ((i % W) / BW | 0); blocks[bi] = (blocks[bi] ?? 0) + d;
      }
      let nb = 0, tot = 0; for (let b = 0; b < blocks.length; b++) { tot += blocks[b]!; if (blocks[b]! / (BW * BW) > 10) nb++; }
      madPerFrame.push(tot / N); bigPerFrame.push(big); blocksPerFrame.push(nb); stillDiff += still;
    } else if (last && cfg.kind === 'still') { let still = 0; for (let i = 0; i < N; i++) if (Math.abs(f[i]! - last[i]!) > cfg.T) still++; stillDiff += still; blocksPerFrame.push(0); }
    last = f;
    if (wantOsc && ring.length === 4) {
      const [a, b, cc, d] = ring as [Uint8Array, Uint8Array, Uint8Array, Uint8Array]; let osc = 0;
      for (let i = 0; i < N; i++) {
        const d1 = b[i]! - a[i]!, d2 = cc[i]! - b[i]!, d3 = d[i]! - cc[i]!;
        if (d1 * d2 < 0 && d2 * d3 < 0 && Math.abs(d1) >= cfg.T && Math.abs(d2) >= cfg.T && Math.abs(d3) >= cfg.T) { osc++; if (heat[i]! < 65535) heat[i]!++; }
      }
      oscTotal += osc; oscPerFrame.push(osc);
    }
    frames.push(k);
  }
  for (const h of hidden) h.o.visible = h.v;
  // pop events: block-change count spikes vs the rolling median of the +-6 neighbours
  const pops: Array<{ at: string; blocks: number; median: number; bigPx: number }> = [];
  const med = (v: number[]): number => { const q = v.slice().sort((x, y) => x - y); return q[q.length >> 1] ?? 0; };
  for (let i = 0; wantPop && i < madPerFrame.length; i++) {
    const nb: number[] = []; for (let j = Math.max(0, i - 6); j <= Math.min(madPerFrame.length - 1, i + 6); j++) if (j !== i) nb.push(madPerFrame[j]!);
    const m = med(nb);
    if (madPerFrame[i]! > 1.3 * m + 0.5) pops.push({ at: labels[i + 1]!, blocks: blocksPerFrame[i]!, median: +m.toFixed(2), bigPx: bigPerFrame[i]!, mad: +madPerFrame[i]!.toFixed(2) } as any);
  }
  let sheet: string | undefined;
  if (cfg.kind === 'sheet') {
    const tw = 320, th = 200, sc = document.createElement('canvas'); sc.width = tw * 6; sc.height = th * 2; const sx = sc.getContext('2d')!;
    const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H; const tx = tmp.getContext('2d')!;
    for (let i = 0; i < kept.length; i++) {
      const im = tx.createImageData(W, H), dm = tx.createImageData(W, H);
      for (let p = 0; p < N; p++) { const v = kept[i]![p]!; im.data[p * 4] = im.data[p * 4 + 1] = im.data[p * 4 + 2] = v; im.data[p * 4 + 3] = 255; const d = i ? Math.min(255, Math.abs(v - kept[i - 1]![p]!) * 6) : 0; dm.data[p * 4] = d; dm.data[p * 4 + 1] = d * 0.3; dm.data[p * 4 + 2] = d * 0.3; dm.data[p * 4 + 3] = 255; }
      tx.putImageData(im, 0, 0); sx.drawImage(tmp, i * tw, 0, tw, th);
      tx.putImageData(dm, 0, 0); sx.drawImage(tmp, i * tw, th, tw, th);
    }
    sheet = sc.toDataURL('image/png');
  }
  const n = Math.max(1, oscPerFrame.length);
  // heatmap png + 8x5 region grid
  const GX = 8, GY = 5, grid = new Array(GX * GY).fill(0);
  for (let i = 0; i < N; i++) if (heat[i]) grid[Math.floor((i / W | 0) / (H / GY)) * GX + Math.floor((i % W) / (W / GX))] += heat[i]!;
  const hc = document.createElement('canvas'); hc.width = W; hc.height = H; const hx = hc.getContext('2d')!;
  const im = hx.createImageData(W, H), base = ring[ring.length - 1] ?? new Uint8Array(N);
  for (let i = 0; i < N; i++) { const g = base[i]! * 0.45, v = Math.min(255, heat[i]! * 255 / Math.max(3, 0.06 * n)); im.data[i * 4] = Math.min(255, g + v); im.data[i * 4 + 1] = v ? g * 0.3 : g; im.data[i * 4 + 2] = v ? g * 0.3 : g; im.data[i * 4 + 3] = 255; }
  hx.putImageData(im, 0, 0);
    return {
    frames: frames.length, oscTotal, oscPerFrame: +(oscTotal / n).toFixed(1), oscPct: +(100 * oscTotal / n / N).toFixed(4),
    lodFlips: flips, popEvents: pops.length, pops: pops.slice(0, 12), stillPx: cfg.kind === 'still' ? +(stillDiff / Math.max(1, blocksPerFrame.length)).toFixed(1) : undefined,
    mads: madPerFrame.map((v) => +v.toFixed(2)), labels, grid, sheet, heat: hc.toDataURL('image/png'), W, H, draws: gl.info.render.calls, tris: gl.info.render.triangles, maxBlocks: Math.max(0, ...blocksPerFrame),
  };
}

const a = parseArgs();
if (a.list) { for (const s of SCENARIOS) console.log(s.id); process.exit(0); }
const W = Number(a.w ?? 960), H = Number(a.h ?? 600), tag = a.tag ?? 'run';
const only = a.only ? a.only.split(',') : null, off = a.off ? a.off.split(',') : [];
const srv = await startServer(), br = await launch();
mkdirSync('.weave/shots', { recursive: true });
const report: any[] = [];
try {
  for (const sc of SCENARIOS) {
    if (only && !only.some((o) => sc.id.includes(o))) continue;
    const page = await br.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    const errs: string[] = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); else if (m.text().startsWith('SCENE')) console.log(m.text()); });
    await page.goto(`${srv.url}?${new URLSearchParams({ size: String(sc.size), seed: String(sc.seed), start: sc.start, hints: '0' })}`, { waitUntil: 'load', timeout: 90000 });
    await page.waitForFunction(() => !!(window as any).__slope, { timeout: 90000 });
    await page.evaluate(async (o) => {
      const s = (window as any).__slope;
      s.populateDemo(o.extra === 'mid' ? 'starter' : 'medium'); s.spawnGuests(150, 'skiers');
      let focus: { x: number; y: number } | null = null;
      if (o.extra === 'river') { // the best natural spring, dug through the real tool path (level gate bypassed)
        const sim = s.sim; sim.progression.bypass++;
        const sites = sim.rivers.natural as Array<{ x: number; y: number }>;
        const PL = await (new Function('u', 'return import(u)') as any)('/src/world/RiverPlanner.ts');
        const best = sites.map((p) => ({ p, pl: PL.planRiver(sim.riverEnv(), p, null) })).filter((q) => q.pl.ok).sort((a, b) => b.pl.path.length - a.pl.path.length)[0];
        if (best && s.riverDebug.dig(best.p.x, best.p.y)) { const path = best.pl.path; focus = path[path.length >> 1]; }
        sim.progression.bypass--;
        console.log(`SCENE river ${best ? best.pl.path.length + ' tiles from ' + best.p.x + ',' + best.p.y : 'none'}`);
      }
      if (o.extra === 'mid') { // the first lift rebuilt with a mid-station (same terminals), like the sanity script
        const sim = s.sim, g = sim.grid, Lift = await (new Function('u', 'return import(u)') as any)('/src/sim/Lift.ts'), lt = s.liftTools.tool.o;
        const l0 = sim.lifts.all()[0];
        if (l0) {
          const bot = { x: l0.bottom.x, y: l0.bottom.y }, top = { x: l0.top.x, y: l0.top.y }, snap = structuredClone(l0), idx = sim.lifts.indexOf(l0.id);
          sim.progression.bypass++;
          Lift.demolishLift(sim.lifts, sim.economy, l0.id); s.liftTools.view.remove(l0.id);
          let ok = false;
          for (const u of [0.5, 0.45, 0.55, 0.4, 0.6, 0.35, 0.65]) {
            const mid = Lift.midSiteOnLine(g, bot, top, bot.x + 1 + (top.x - bot.x) * u, bot.y + 1 + (top.y - bot.y) * u);
            const out = Lift.placeLift({ ...lt.env, props: sim.props }, sim.props, 'gondola6', bot, top, true, true, [mid]);
            if (out.ok) { lt.onPlaced(out); focus = { x: mid.x, y: mid.y }; ok = true; break; }
          }
          if (!ok) { sim.lifts.reinsert(snap, idx); s.liftTools.view.add(sim.lifts.get(l0.id)); }
          sim.progression.bypass--;
          console.log(`SCENE mid-station ${ok ? 'built' : 'NOT built'}`);
        }
      }
      o.focus = focus;
      const loop = s.loop; if (loop.paused) loop.setSpeed(1);
      const t = loop.tickCount + 1500; let g = 0; while (loop.tickCount < t && g++ < 1e6) loop.advance(1);
      s.setHour(o.hour);
      const b = s.buildings.all().find((q: any) => q.type === 'baseLodge');
      const c = s.renderer.controls;
      if (o.focus) c.target.set(o.focus.x, 0, o.focus.y); else if (b) c.target.set(b.x + b.w / 2, 0, b.y + b.h / 2);
    }, { hour: sc.hour, extra: sc.extra ?? null, focus: null as { x: number; y: number } | null });
    await new Promise((r) => setTimeout(r, 2500));
    const minZoom = await page.evaluate(() => (window as any).__slope.renderer.controls.minZoom as number);
    const maxZoom = await page.evaluate(() => (window as any).__slope.renderer.controls.maxZoom as number);
    const base = { step: 0, zstep: Number(a.zstep ?? 0.015), w: W, h: H, T: Number(a.T ?? 10), off, zlo: minZoom, zhi: Math.min(maxZoom, 14), zmid: 3 };
    const res: any = { scenario: sc.id };
    for (const kind of ['rotfine', 'rotpop', 'zoomfine', 'zoompop', 'jitter', 'sheet', 'still'] as const) {
      if (a.kinds && !a.kinds.split(',').includes(kind)) continue;
      const t0 = Date.now();
      const r = await page.evaluate(sweepInPage, { ...base, kind, step: kind === 'rotfine' ? Number(a.anchor ?? 20) : Number(a.step ?? 3) });
      const png = `.weave/shots/flicker-${tag}-${sc.id}-${kind}.png`;
      writeFileSync(png, Buffer.from(r.heat.split(',')[1], 'base64'));
      if (r.sheet) { writeFileSync(`.weave/shots/flick-sheet-${tag}-${sc.id}.png`, Buffer.from(r.sheet.split(',')[1], 'base64')); delete r.sheet; }
      delete r.heat; r.png = png; r.sec = Math.round((Date.now() - t0) / 1000);
      res[kind] = r;
      console.log(`${sc.id} ${kind}: frames ${r.frames} osc/frame ${r.oscPerFrame} (${r.oscPct}%) pops ${r.popEvents} lodFlips ${r.lodFlips} still ${r.stillPx ?? '-'} ${r.sec}s`);
    }
    res.errors = errs.slice(0, 5);
    report.push(res);
    await page.close();
  }
} finally { await br.close(); srv.stop(); }

writeFileSync(`.weave/shots/flicker-${tag}.json`, JSON.stringify(report, null, 1));
const md: string[] = [`# Flicker report: ${tag}`, '', '| scenario | sweep | frames | osc px/frame | osc % | pop events | LOD flips | still px/frame |', '|---|---|---|---|---|---|---|---|'];
for (const r of report) for (const k of ['rotfine', 'rotpop', 'zoomfine', 'zoompop', 'jitter', 'still']) if (r[k]) md.push(`| ${r.scenario} | ${k} | ${r[k].frames} | ${r[k].oscPerFrame} | ${r[k].oscPct} | ${r[k].popEvents} | ${r[k].lodFlips} | ${r[k].stillPx ?? '-'} |`);
md.push('', '## Top offender regions (8x5 grid cells by oscillation count)');
for (const r of report) for (const k of ['rotfine', 'zoomfine', 'rotpop', 'zoompop']) if (r[k]) {
  const top = (r[k].grid as number[]).map((v, i) => ({ v, c: `col${i % 8}/row${Math.floor(i / 8)}` })).sort((x, y) => y.v - x.v).slice(0, 3).map((o) => `${o.c}=${o.v}`).join(', ');
  md.push(`- ${r.scenario} ${k}: ${top}; pops: ${(r[k].pops as any[]).slice(0, 5).map((p) => `${p.at}(mad ${p.mad} vs ${p.median}, ${p.blocks} blk)`).join(', ') || 'none'}`);
}
writeFileSync(`.weave/shots/flicker-${tag}.md`, md.join('\n') + '\n');
console.log(md.join('\n'));
