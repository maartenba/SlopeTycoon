/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate bodies poke the untyped window.__slope debug API */
/* Desktop screenshot diff (M7.5, docs/mobile-ui.md): proves the phone work leaves the desktop UI untouched.
 *   npm run desktop:diff -- --out .weave/desktop/after            capture the key desktop screens at 1280x800 (non-touch)
 *   npm run desktop:diff -- --compare .weave/desktop/before .weave/desktop/after [--tol 0.0005]
 * The 3D canvas is hidden in the captures (it animates), the clock is paused and the FPS text is blanked, so only the UI chrome is compared.
 * compare = per-pixel diff in the browser (a channel delta > 6 counts); fails (exit 1) when more than `tol` (default 0.05 %) of the pixels differ in any shot. */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Page } from 'puppeteer-core';
import { launch, startServer } from './lib/harness';

const args = process.argv.slice(2);
const opt = (k: string): string | undefined => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const SHOTS: Array<{ id: string; setup: string }> = [
  { id: 'hud-default', setup: '' },
  { id: 'buildings-drawer', setup: `document.querySelector('st-dock').show('buildings')` },
  { id: 'landscape-drawer', setup: `document.querySelector('st-dock').show('landscape')` },
  { id: 'pricing-drawer', setup: `document.querySelector('st-dock').show('pricing')` },
  { id: 'statistics', setup: `document.querySelector('st-stats').open()` },
  { id: 'settings', setup: `document.querySelector('st-settings').open()` },
];

if (opt('compare') !== undefined) {
  const [a, b] = [args[args.indexOf('--compare') + 1]!, args[args.indexOf('--compare') + 2]!];
  const tol = Number(opt('tol') ?? 0.0005);
  const br = await launch();
  let bad = 0;
  try {
    const page = await br.newPage();
    await page.goto('about:blank');
    for (const f of readdirSync(a).filter((x) => x.endsWith('.png'))) {
      let other: Buffer;
      try { other = readFileSync(`${b}/${f}`); } catch { console.log(`MISSING ${f} in ${b}`); bad++; continue; }
      const r = await page.evaluate(async (x: string, y: string, t: number) => {
        const load = (s: string): Promise<ImageData> => new Promise((res, rej) => { const i = new Image(); i.onload = () => { const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const g = c.getContext('2d')!; g.drawImage(i, 0, 0); res(g.getImageData(0, 0, i.width, i.height)); }; i.onerror = rej; i.src = s; });
        const A = await load(x), B = await load(y);
        if (A.width !== B.width || A.height !== B.height) return { size: false, frac: 1, max: 255, n: 0, box: '' };
        let n = 0, max = 0, x1 = 1e9, y1 = 1e9, x2 = -1, y2 = -1;
        for (let k = 0; k < A.data.length; k += 4) { const d = Math.max(Math.abs(A.data[k]! - B.data[k]!), Math.abs(A.data[k + 1]! - B.data[k + 1]!), Math.abs(A.data[k + 2]! - B.data[k + 2]!)); if (d > max) max = d; if (d > t) { n++; const px = (k / 4) % A.width, py = Math.floor(k / 4 / A.width); if (px < x1) x1 = px; if (px > x2) x2 = px; if (py < y1) y1 = py; if (py > y2) y2 = py; } }
        return { size: true, frac: n / (A.width * A.height), max, n, box: n ? `${x1},${y1}-${x2},${y2}` : '' };
      }, `data:image/png;base64,${readFileSync(`${a}/${f}`).toString('base64')}`, `data:image/png;base64,${other.toString('base64')}`, 6);
      const ok = r.size && r.frac <= tol;
      if (!ok) bad++;
      console.log(`${ok ? 'SAME' : 'DIFF'}  ${f.padEnd(24)} ${(r.frac * 100).toFixed(4)} % of pixels differ (${r.n} px, max channel delta ${r.max}${r.box ? `, box ${r.box}` : ''})`);
    }
  } finally { await br.close(); }
  console.log(bad ? `${bad} desktop screen(s) differ more than ${(tol * 100).toFixed(3)} %` : `desktop unchanged (tolerance ${(tol * 100).toFixed(3)} % of the pixels)`);
  process.exitCode = bad ? 1 : 0;
} else {
  const out = opt('out') ?? '.weave/desktop/shots';
  mkdirSync(out, { recursive: true });
  const srv = await startServer();
  const br = await launch();
  try {
    const page: Page = await br.newPage();
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    await page.goto(`${srv.url}?size=64&seed=61&start=winter&hints=0`, { waitUntil: 'load', timeout: 90000 });
    await page.waitForFunction(() => !!(window as any).__slope?.view, { timeout: 90000 });
    await sleep(2500);
    await page.evaluate(() => {
      (window as any).__slope.loop.setSpeed(0);
      const st = document.createElement('style'); st.textContent = '#app canvas{visibility:hidden!important}#app{background:#243447}st-toast,st-assistant{display:none!important}'; document.head.appendChild(st);
    });
    for (const s of SHOTS) {
      await page.evaluate("document.querySelector('st-dock').show(null); for (const t of ['st-stats','st-settings']) { try { document.querySelector(t).close(); } catch {} }");
      await sleep(400);
      if (s.setup) await page.evaluate(s.setup);
      await sleep(s.id.endsWith('drawer') ? 4000 : 900); // building thumbnails are pre-rendered when the browser is idle: give them time so both runs show the same icons
      await page.evaluate(() => { document.querySelector('st-hud')?.shadowRoot?.querySelectorAll('.fps').forEach((e) => { (e as HTMLElement).style.visibility = 'hidden'; }); });
      if (s.id === 'buildings-drawer' || s.id === 'pricing-drawer') { // the UI must also be CLICKABLE (a pointer-events regression in a wrapper would not show in pixels): the first card / button is the topmost thing at its centre
        const hit = await page.evaluate(() => {
          const sr = document.querySelector('st-dock')!.shadowRoot!; const t = (sr.querySelector('.drawer .card') ?? sr.querySelector('.drawer .pane button, .drawer .pc button, .drawer button.closex')) as HTMLElement | null; if (!t) return 'no target';
          const r = t.getBoundingClientRect(); const e = t.classList.contains('card') ? sr.elementFromPoint(r.left + 40, r.top + 40) : sr.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return e && (e === t || t.contains(e)) && getComputedStyle(t).pointerEvents !== 'none' ? 'ok' : `blocked (pointer-events ${getComputedStyle(t).pointerEvents}, hit ${e?.tagName}.${e?.className})`;
        });
        console.log(`click check ${s.id}: ${hit}`);
        if (hit !== 'ok') process.exitCode = 1;
      }
      const buf = await page.screenshot();
      writeFileSync(`${out}/${s.id}.png`, buf);
      console.log(`saved ${out}/${s.id}.png`);
    }
  } finally { await br.close(); srv.stop(); }
}
