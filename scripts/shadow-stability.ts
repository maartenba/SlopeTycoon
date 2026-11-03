/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate bodies poke the untyped window.__slope debug API */
/* Shadow temporal stability (docs/shadows.md "Temporal stability"): boots the real game on High in the SwiftShader harness and, for every captured frame, renders the
 * SAME frame a second time with the shadow strength at 0. The luma difference (shadows on - off) is the pure SHADOW SIGNAL: world-locked shadows move smoothly
 * (time, pan) or not at all, so any frame-to-frame change that is irregular is a missed frame / a jump.
 * Sweeps: time1 / time3 / time10 (camera still, game speed 1 / 3 / 10, guests + carriers + sun moving: judder = CV of the per-frame signal change and the worst frame / median),
 * pan (a slow target pan: oscillating shadow pixels, %), zoom (a 1 % zoom-out sweep: pop events on the signal).
 * Usage: vite-node scripts/shadow-stability.ts [--tag before] [--size 128] [--seed 5] [--hour 16] [--start summer] [--only time1,pan] [--frames 60] [--T 4]
 * Output: a markdown table on stdout + .weave/shots/shadow-stability-<tag>.json. Relative only (SwiftShader frame rate is far below 60 fps). */
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch, startServer } from './lib/harness';

function parseArgs(): Record<string, string> {
  const a = process.argv.slice(2), r: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) if (a[i]!.startsWith('--')) r[a[i]!.slice(2)] = a[i + 1] && !a[i + 1]!.startsWith('--') ? a[++i]! : '1';
  return r;
}
const a = parseArgs();
const W = Number(a.w ?? 960), H = Number(a.h ?? 600), tag = a.tag ?? 'run', size = Number(a.size ?? 128), seed = Number(a.seed ?? 5), hour = Number(a.hour ?? 16);
const start = a.start ?? 'summer', frames = Number(a.frames ?? 60), T = Number(a.T ?? 4), only = a.only ? a.only.split(',') : null;

async function sweep(cfg: { kind: string; frames: number; T: number; w: number; h: number }): Promise<any> {
  const s = (window as any).__slope, r = s.renderer, gl = r.webgl, canvas: HTMLCanvasElement = gl.domElement, c = r.controls;
  const W = canvas.width, H = canvas.height, N = W * H;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  const luma = (): Float32Array => { ctx.clearRect(0, 0, W, H); ctx.drawImage(canvas, 0, 0); const d = ctx.getImageData(0, 0, W, H).data, l = new Float32Array(N); for (let i = 0, p = 0; i < N; i++, p += 4) l[i] = 0.3 * d[p]! + 0.59 * d[p + 1]! + 0.11 * d[p + 2]!; return l; };
  if (!(window as any).__ssHooked) {
    const orig = gl.render.bind(gl);
    (window as any).__ssHook = null;
    (window as any).__ssRaw = orig;
    gl.render = (sc: unknown, cam: unknown): void => { orig(sc, cam); const h = (window as any).__ssHook; if (h) { (window as any).__ssHook = null; h(); } };
    (window as any).__ssHooked = true;
  }
  const raw = (window as any).__ssRaw as (sc: unknown, cam: unknown) => void;
  const P = r.shadows.uniforms.uShadowP.value;
  /** One game frame with shadows, then the same frame again without: returns the shadow signal (on - off, luma). */
  const grab = (): Promise<Float32Array> => new Promise((res) => {
    (window as any).__ssHook = (): void => {
      const on = luma(), x = P.x; P.x = 0; raw(r.scene, r.camera); const off = luma(); P.x = x;
      const sig = new Float32Array(N); for (let i = 0; i < N; i++) sig[i] = on[i]! - off[i]!;
      res(sig);
    };
  });
  const z0 = 3; c.zoomBy(z0 / c.zoom);
  const speed = cfg.kind.startsWith('time') ? Number(cfg.kind.slice(4)) : 0;
  s.loop.setSpeed(speed);
  const st = r.shadows.stats;
  await grab(); await grab();
  const p0 = st.passes, sp0 = st.staticPasses ?? 0, dp0 = st.dynPasses ?? 0, ms0 = st.totalMs ?? 0, t0 = performance.now();
  const x0 = c.target.x, y0 = c.target.z;
  let last: Float32Array | null = null;
  const ring: Float32Array[] = [], deltas: number[] = [];
  let osc = 0, oscFrames = 0;
  for (let k = 0; k < cfg.frames; k++) {
    if (cfg.kind === 'pan') { c.target.x = x0 + k * 0.05; c.target.z = y0 + k * 0.03; c.clampTarget?.(); }
    if (cfg.kind === 'zoom') c.zoomBy(0.992);
    const f = await grab();
    if (last) { let e = 0; for (let i = 0; i < N; i++) e += Math.abs(f[i]! - last[i]!); deltas.push(e / N); }
    last = f; ring.push(f); if (ring.length > 4) ring.shift();
    if (cfg.kind === 'pan' && ring.length === 4) {
      const [p, q, w, v] = ring as [Float32Array, Float32Array, Float32Array, Float32Array];
      for (let i = 0; i < N; i++) { const d1 = q[i]! - p[i]!, d2 = w[i]! - q[i]!, d3 = v[i]! - w[i]!; if (d1 * d2 < 0 && d2 * d3 < 0 && Math.abs(d1) >= cfg.T && Math.abs(d2) >= cfg.T && Math.abs(d3) >= cfg.T) osc++; }
      oscFrames++;
    }
  }
  const sec = (performance.now() - t0) / 1000;
  const mean = deltas.reduce((x, y) => x + y, 0) / Math.max(1, deltas.length);
  const sd = Math.sqrt(deltas.reduce((x, y) => x + (y - mean) * (y - mean), 0) / Math.max(1, deltas.length));
  const sorted = deltas.slice().sort((x, y) => x - y), med = sorted[sorted.length >> 1] ?? 0;
  // pop events (zoom): frames whose change jumps over 1.3 x the rolling median of the +-6 neighbours + 0.3
  let pops = 0;
  for (let i = 0; i < deltas.length; i++) { const nb: number[] = []; for (let j = Math.max(0, i - 6); j <= Math.min(deltas.length - 1, i + 6); j++) if (j !== i) nb.push(deltas[j]!); nb.sort((x, y) => x - y); if (deltas[i]! > 1.3 * (nb[nb.length >> 1] ?? 0) + 0.3) pops++; }
  s.loop.setSpeed(1);
  return {
    kind: cfg.kind, frames: deltas.length, meanDelta: +mean.toFixed(3), cv: +(sd / Math.max(1e-6, mean)).toFixed(3), worstOverMedian: +(Math.max(0, ...deltas) / Math.max(1e-6, med)).toFixed(2),
    zeroFrames: deltas.filter((d) => d < 0.02).length, oscPct: cfg.kind === 'pan' ? +(100 * osc / Math.max(1, oscFrames) / N).toFixed(4) : undefined, pops,
    passes: st.passes - p0, staticPasses: (st.staticPasses ?? 0) - sp0, dynPasses: (st.dynPasses ?? 0) - dp0, passMsTotal: +((st.totalMs ?? 0) - ms0).toFixed(0), wallSec: +sec.toFixed(1),
  };
}

const srv = await startServer(), br = await launch();
mkdirSync('.weave/shots', { recursive: true });
const out: any[] = [];
try {
  const page = await br.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem('slope.quality', 'high'); } catch { /* none */ } });
  await page.goto(`${srv.url}?${new URLSearchParams({ size: String(size), seed: String(seed), start, hints: '0' })}`, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => !!(window as any).__slope, { timeout: 90000 });
  await page.evaluate(async (o) => {
    const s = (window as any).__slope;
    s.populateDemo('medium'); s.spawnGuests(150, 'skiers');
    const loop = s.loop; if (loop.paused) loop.setSpeed(1);
    const t = loop.tickCount + 1500; let g = 0; while (loop.tickCount < t && g++ < 1e6) loop.advance(1);
    s.setHour(o.hour);
    const b = s.buildings.all().find((q: any) => q.type === 'baseLodge'), c = s.renderer.controls;
    if (b) c.target.set(b.x + b.w / 2, 0, b.y + b.h / 2);
  }, { hour });
  await new Promise((r) => setTimeout(r, 2500));
  const info = await page.evaluate(() => { const s = (window as any).__slope; return { quality: s.renderer.shadows.enabled, mem: s.renderer.webgl.info.memory }; });
  console.log(`shadows enabled: ${info.quality}; size ${size} seed ${seed} ${start} ${hour}:00; frames ${frames}; T ${T}`);
  for (const kind of ['time1', 'time3', 'time10', 'pan', 'zoom']) {
    if (only && !only.includes(kind)) continue;
    const r = await page.evaluate(sweep, { kind, frames, T, w: W, h: H });
    out.push(r);
    console.log(JSON.stringify(r));
  }
  out.push({ errors: errs.slice(0, 5) });
  await page.close();
} finally { await br.close(); srv.stop(); }
writeFileSync(`.weave/shots/shadow-stability-${tag}.json`, JSON.stringify(out, null, 1));
console.log('| sweep | frames | mean change | CV (judder) | worst/median | still frames | osc % | pops | shadow passes (static/dyn) | pass ms total |\n|---|---|---|---|---|---|---|---|---|---|');
for (const r of out) if (r.kind) console.log(`| ${r.kind} | ${r.frames} | ${r.meanDelta} | ${r.cv} | ${r.worstOverMedian} | ${r.zeroFrames} | ${r.oscPct ?? '-'} | ${r.pops} | ${r.passes} (${r.staticPasses}/${r.dynPasses}) | ${r.passMsTotal} |`);
