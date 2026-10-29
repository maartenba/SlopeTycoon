/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate bodies poke the untyped window.__slope debug API */
/* Quick building-region flicker check (docs/flicker.md "Building snow"): winter lodge, windows of 5 frames 0.1 deg apart at several yaws / zooms,
 * counts oscillating pixels (luma derivative flips sign 3x, each step >= T) inside the central region (= the lodge) only. ~1 min.
 * Usage: npm run flicker:building -- [--season winter|summer] [--size 64] [--seed 61] [--T 8] [--yaws 8] [--zooms 2,3.5,6] [--off terrain,trees,...] [--out name] */
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch, startServer } from './lib/harness';

function parseArgs(): Record<string, string> {
  const a = process.argv.slice(2), r: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) if (a[i]!.startsWith('--')) r[a[i]!.slice(2)] = a[i + 1] && !a[i + 1]!.startsWith('--') ? a[++i]! : '1';
  return r;
}
async function run(cfg: { yaws: number; zooms: number[]; T: number; off: string[]; rw: number; rh: number }): Promise<any> {
  const s = (window as any).__slope, gl = s.renderer.webgl, canvas: HTMLCanvasElement = gl.domElement, c = s.renderer.controls;
  const W = canvas.width, H = canvas.height;
  const x0 = Math.floor((W - cfg.rw) / 2), y0 = Math.floor((H - cfg.rh) / 2), N = cfg.rw * cfg.rh;
  const cv2 = document.createElement('canvas'); cv2.width = W; cv2.height = H;
  const ctx = cv2.getContext('2d', { willReadFrequently: true })!;
  const orig = gl.render.bind(gl);
  gl.render = (sc: unknown, cam: unknown): void => { orig(sc, cam); const h = (window as any).__flHook; if (h) { (window as any).__flHook = null; h(); } };
  const grab = (): Promise<{ l: Uint8Array; img: ImageData }> => new Promise((res) => {
    (window as any).__flHook = (): void => {
      ctx.clearRect(0, 0, W, H); ctx.drawImage(canvas, 0, 0);
      const img = ctx.getImageData(x0, y0, cfg.rw, cfg.rh), d = img.data, l = new Uint8Array(N);
      for (let i = 0, p = 0; i < N; i++, p += 4) l[i] = 0.3 * d[p]! + 0.59 * d[p + 1]! + 0.11 * d[p + 2]!;
      res({ l, img });
    };
  });
  for (const n of cfg.off) {
    if (n.startsWith('lodge')) { // lodge | lodge:<child index> | lodge:list
      const lb = s.buildings.all().find((q: any) => q.type === 'baseLodge'), grp = s.buildingsView.get(lb.id);
      const [, k, rng] = n.split(':');
      if (k !== undefined && rng) { const g = grp.children[Number(k)].geometry, tot = g.index ? g.index.count : g.attributes.position.count, [fa, fb] = rng.startsWith('x') ? [0, 1] : rng.split('-').map(Number); const a0 = Math.floor(tot * fa! / 3) * 3, b0 = Math.floor(tot * fb! / 3) * 3; if (rng.startsWith('x')) { const [xa, xb] = rng.slice(1).split('-').map(Number); const old = g.index ? Array.from(g.index.array as ArrayLike<number>) : Array.from({ length: tot }, (_, q) => q); const keep = old.filter((_, q) => Math.floor(q / 3) < xa! || Math.floor(q / 3) >= xb!); g.setIndex(keep); console.log('LODGE excl tris', xa, xb); continue; } g.setDrawRange(a0, b0 - a0); console.log('LODGE range', a0, b0, tot); continue; }
      if (k === 'tris') { const ch = grp.children[0], pos = ch.geometry.attributes.position, nor = ch.geometry.attributes.normal, idx = ch.geometry.index; const rows: string[] = [];
        for (const [lo, hi] of [[0, 40], [350, 365], [380, 407]] as const) { const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; const ns = new Set<string>(); for (let t = lo; t < hi; t++) for (let q = 0; q < 3; q++) { const i = idx ? idx.getX(t * 3 + q) : t * 3 + q; const v = [pos.getX(i), pos.getY(i), pos.getZ(i)]; for (let c = 0; c < 3; c++) { mn[c] = Math.min(mn[c]!, v[c]!); mx[c] = Math.max(mx[c]!, v[c]!); } if (q === 0) ns.add([nor.getX(i), nor.getY(i), nor.getZ(i)].map((x) => x.toFixed(1)).join(',')); }
          rows.push(`tris ${lo}-${hi}: min(${mn.map((x) => x.toFixed(2))}) max(${mx.map((x) => x.toFixed(2))}) normals ${[...ns].join(' ')}`); }
        console.log('LODGE ' + rows.join('\nLODGE ')); } else if (k === 'coplanar') { // same-plane same-direction triangles (AABB overlap area > 1e-4) across all layers: z-fight suspects
        const tris: any[] = [];
        grp.children.forEach((ch: any, ci: number) => { const pos = ch.geometry.attributes.position, nor = ch.geometry.attributes.normal, idx = ch.geometry.index; const n = idx ? idx.count : pos.count;
          for (let t = 0; t < n; t += 3) { const ii = [0, 1, 2].map((q) => idx ? idx.getX(t + q) : t + q); const i0 = ii[0]!; const nx = nor.getX(i0), ny = nor.getY(i0), nz = nor.getZ(i0);
            const d = pos.getX(i0) * nx + pos.getY(i0) * ny + pos.getZ(i0) * nz; const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (const i of ii) { const v = [pos.getX(i), pos.getY(i), pos.getZ(i)]; for (let q = 0; q < 3; q++) { mn[q] = Math.min(mn[q]!, v[q]!); mx[q] = Math.max(mx[q]!, v[q]!); } }
            tris.push({ ci, t: t / 3, n: [nx, ny, nz], d, mn, mx }); } });
        const out = new Map<string, number>();
        for (let i = 0; i < tris.length; i++) for (let j = i + 1; j < tris.length; j++) { const A = tris[i], B = tris[j];
          if (Math.abs(A.n[0] * B.n[0] + A.n[1] * B.n[1] + A.n[2] * B.n[2] - 1) > 1e-3 || Math.abs(A.d - B.d) > 2e-3) continue;
          let area = 1, dims = 0; for (let q = 0; q < 3; q++) { const o = Math.min(A.mx[q], B.mx[q]) - Math.max(A.mn[q], B.mn[q]); if (o < -1e-4) { area = -1; break; } if (o > 1e-4) { area *= o; dims++; } }
          if (area < 0 || dims < 2 || area < 1e-4) continue;
          const key = `plane n=(${A.n.map((v: number) => v.toFixed(2))}) d=${A.d.toFixed(3)} y[${Math.max(A.mn[1], B.mn[1]).toFixed(2)}] x[${Math.max(A.mn[0], B.mn[0]).toFixed(2)},${Math.min(A.mx[0], B.mx[0]).toFixed(2)}] z[${Math.max(A.mn[2], B.mn[2]).toFixed(2)},${Math.min(A.mx[2], B.mx[2]).toFixed(2)}] layers ${A.ci}/${B.ci}`;
          out.set(key, (out.get(key) ?? 0) + 1); }
        console.log('LODGE ' + [...out.keys()].slice(0, 60).join('\nLODGE '));
      } else if (k === 'dump') { // low (y<0.3) triangles of the wood layer past the porch line, grouped by plane
        const ch = grp.children[0], pos = ch.geometry.attributes.position, nor = ch.geometry.attributes.normal, idx = ch.geometry.index; const n = idx ? idx.count : pos.count; const rows = new Map<string, number>();
        for (let t = 0; t < n; t += 3) { const ii = [0, 1, 2].map((q) => idx ? idx.getX(t + q) : t + q); const ys = ii.map((i) => pos.getY(i)), zs = ii.map((i) => pos.getZ(i)); if (Math.max(...ys) > 0.3 || Math.min(...zs) < 1.2) continue;
          const i0 = ii[0]!, nd = pos.getX(i0) * nor.getX(i0) + pos.getY(i0) * nor.getY(i0) + pos.getZ(i0) * nor.getZ(i0); const key = `tri#${t / 3} n=(${nor.getX(i0).toFixed(1)},${nor.getY(i0).toFixed(1)},${nor.getZ(i0).toFixed(1)}) d=${nd.toFixed(3)} x[${Math.min(...ii.map((i) => pos.getX(i))).toFixed(2)},${Math.max(...ii.map((i) => pos.getX(i))).toFixed(2)}] y[${Math.min(...ys).toFixed(3)},${Math.max(...ys).toFixed(3)}] z[${Math.min(...zs).toFixed(2)},${Math.max(...zs).toFixed(2)}]`; rows.set(key, 1); }
        console.log('LODGE ' + [...rows.keys()].join('\nLODGE '));
      } else if (k === 'flat') { // up-facing triangles within 0.06 of the ground plane (z-fight suspects vs the terrain)
        const rows: string[] = [];
        grp.children.forEach((ch: any, ci: number) => { const pos = ch.geometry.attributes.position, idx = ch.geometry.index; const n = idx ? idx.count : pos.count; let cnt = 0, minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9; const ys = new Set<string>();
          for (let t = 0; t < n; t += 3) { const v = [0, 1, 2].map((q) => { const i = idx ? idx.getX(t + q) : t + q; return [pos.getX(i), pos.getY(i), pos.getZ(i)]; });
            if (v.every((p3) => Math.abs(p3[1]! - 0) < 0.06) && Math.abs(v[0]![1]! - v[1]![1]!) < 1e-4 && Math.abs(v[0]![1]! - v[2]![1]!) < 1e-4) { cnt++; ys.add(v[0]![1]!.toFixed(3)); for (const p3 of v) { minX = Math.min(minX, p3[0]!); maxX = Math.max(maxX, p3[0]!); minZ = Math.min(minZ, p3[2]!); maxZ = Math.max(maxZ, p3[2]!); } } }
          rows.push(`child${ci}: ${cnt} flat tris y=${[...ys].join(',')} x[${minX.toFixed(2)},${maxX.toFixed(2)}] z[${minZ.toFixed(2)},${maxZ.toFixed(2)}]`); });
        console.log('LODGE ' + rows.join(' | ') + ' pos.y=' + grp.position.y);
      } else if (k === 'list') console.log('LODGE', grp.children.map((ch: any, i: number) => `${i}:${ch.type}:${ch.name}:${ch.material?.type}:${ch.material?.color?.getHexString?.()}`).join(' | '));
      else if (k !== undefined) grp.children[Number(k)].visible = false; else grp.visible = false;
      continue;
    }
    const g = n === 'trees' ? s.trees.group : n === 'rocks' ? s.rocks.group : n === 'water' ? s.water.group : n === 'guests' ? s.guestRenderer.group : n === 'terrain' ? s.terrain.group : n === 'decor' ? s.villageDecor.group : n === 'nature' ? s.natureView.group : null;
    if (g) g.visible = false;
  }
  s.loop.setSpeed(0);
  const yaw0 = c.yaw, out: any[] = [];
  let lastImg: ImageData | null = null; const heats: string[] = [];
  for (const z of cfg.zooms) {
    c.zoomBy(z / c.zoom);
    let tot = 0, wins = 0; const heat = new Uint16Array(N);
    for (let k = 0; k < cfg.yaws; k++) {
      const a = (360 / cfg.yaws) * k; const ring: Uint8Array[] = [];
      for (let i = 0; i < 5; i++) {
        c.yaw = yaw0 + (a + i * 0.1) * Math.PI / 180;
        const f = await grab(); ring.push(f.l); lastImg = f.img; if (ring.length > 4) ring.shift();
        if (ring.length === 4) {
          const [p, q, r, t] = ring as [Uint8Array, Uint8Array, Uint8Array, Uint8Array];
          for (let j = 0; j < N; j++) {
            const d1 = q[j]! - p[j]!, d2 = r[j]! - q[j]!, d3 = t[j]! - r[j]!;
            if (d1 * d2 < 0 && d2 * d3 < 0 && Math.abs(d1) >= cfg.T && Math.abs(d2) >= cfg.T && Math.abs(d3) >= cfg.T) { tot++; heat[j]!++; }
          }
          wins++;
        }
      }
    }
    { const hc = document.createElement('canvas'); hc.width = cfg.rw; hc.height = cfg.rh; const hx = hc.getContext('2d')!, im = hx.createImageData(cfg.rw, cfg.rh);
      for (let j = 0; j < N; j++) { const v = Math.min(255, heat[j]! * 60), g = 0.3 * lastImg!.data[j * 4]! * 0.6; im.data[j * 4] = Math.min(255, g + v); im.data[j * 4 + 1] = v ? 0 : g; im.data[j * 4 + 2] = v ? 0 : g; im.data[j * 4 + 3] = 255; }
      hx.putImageData(im, 0, 0); heats.push(hc.toDataURL('image/png')); }
    out.push({ zoom: z, oscPerWindow: +(tot / wins).toFixed(1), oscPct: +(100 * tot / wins / N).toFixed(4) });
  }
  return { heats, out, region: [x0, y0, cfg.rw, cfg.rh] };
}

const a = parseArgs();
const season = (a.season ?? 'winter') as 'winter' | 'summer', size = Number(a.size ?? 64), seed = Number(a.seed ?? 61);
const srv = await startServer(), br = await launch();
mkdirSync('.weave/shots', { recursive: true });
try {
  const page = await br.newPage();
  page.on('console', (m) => { if (m.text().startsWith('LODGE')) console.log(m.text()); });
  await page.setViewport({ width: 960, height: 600, deviceScaleFactor: 1 });
  await page.goto(`${srv.url}?${new URLSearchParams({ size: String(size), seed: String(seed), start: season, hints: '0' })}`, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => !!(window as any).__slope, { timeout: 90000 });
  await page.evaluate(() => {
    const s = (window as any).__slope;
    s.populateDemo('medium');
    const loop = s.loop; if (loop.paused) loop.setSpeed(1);
    const t = loop.tickCount + 1500; let g = 0; while (loop.tickCount < t && g++ < 1e6) loop.advance(1);
    s.setHour(12);
    const b = s.buildings.all().find((q: any) => q.type === 'baseLodge');
    if (b) s.renderer.controls.target.set(b.x + b.w / 2, 0, b.y + b.h / 2);
  });
  await new Promise((r) => setTimeout(r, 2500));
  const r = await page.evaluate(run, { yaws: Number(a.yaws ?? 8), zooms: (a.zooms ?? '2,3.5,6').split(',').map(Number), T: Number(a.T ?? 8), off: a.off ? a.off.split(',') : [], rw: Number(a.rw ?? 300), rh: Number(a.rh ?? 220) });
  r.heats.forEach((h: string, i: number) => writeFileSync(`.weave/shots/flicker-building-${a.out ?? 'run'}-z${i}.png`, Buffer.from(h.split(',')[1]!, 'base64'))); delete r.heats;
  console.log(JSON.stringify(r));
  const tot = r.out.reduce((s: number, o: any) => s + o.oscPerWindow, 0);
  console.log(`TOTAL osc px/window (sum over zooms): ${tot.toFixed(1)}`);
  writeFileSync(`.weave/shots/flicker-building-${a.out ?? 'run'}.json`, JSON.stringify(r));
} finally { await br.close(); srv.stop(); }
