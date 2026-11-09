/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate bodies poke the untyped window.__slope debug handle */
/** Promo storyboard stager (M7.6, docs/promo-video.md). Reads `promo/scenes.json`, boots the REAL game once per scene (dev server, Chrome SwiftShader),
 * stages the scene with the page-side library below (demo resort + extras through the game's own placement rules, date / hour / weather / atmosphere forcing,
 * guests, resort name 'Alpenglow'), and shoots one hero still per camera keyframe into `.weave/promo/storyboard/`.
 *   npx vite-node scripts/promo/stage.ts [--only 03,07] [--tag v1] [--w 2560 --h 1440] [--draft] [--probe 1]
 * `--draft` = 1280x720 (quick iteration). Stills are named `<NN>-<id>-<a|b|c>-<tag>.png` (use a new --tag every run: the image read tool caches by path).
 * No wildlife encounters are forced. Exit 1 when a scene could not be staged. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { launch, startServer } from '../lib/harness';
import { installLib } from './lib';
import { runSetups, shootKey } from './setups';

const arg = (k: string, d = ''): string => { const i = process.argv.indexOf(`--${k}`); return i > 0 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith('--') ? process.argv[i + 1]! : i > 0 ? '1' : d; };
const draft = arg('draft') === '1';
const W = Number(arg('w', draft ? '1280' : '2560')), H = Number(arg('h', draft ? '720' : '1440'));
const tag = arg('tag', 'v1'), only = arg('only').split(',').filter(Boolean);
const OUT = '.weave/promo/storyboard';
mkdirSync(OUT, { recursive: true });
const manifest = JSON.parse(readFileSync(arg('manifest', 'promo/scenes.json'), 'utf8')) as { scenes: any[] };

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const failures: string[] = [];
const timings: Array<{ scene: string; key: string; msPerFrame: number; shotMs?: number }> = [];

const srv = await startServer();
const br = await launch();
try {
  for (const sc of manifest.scenes) {
    if (only.length && !only.includes(sc.n)) continue;
    const t0 = Date.now();
    const page = await br.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    const errs: string[] = [];
    page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || (/shader|webgl|THREE\./i.test(t) && m.type() !== 'log' && m.type() !== 'info' && !/GPU stall/i.test(t))) errs.push(t.slice(0, 200)); if (/\[promo\]/.test(t)) console.log(t); });
    page.on('pageerror', (e) => errs.push(`[pageerror] ${String(e)}`));
    await page.evaluateOnNewDocument(() => { try { localStorage.setItem('slope.quality', 'high'); localStorage.setItem('slope.consent.analytics', 'denied'); } catch { /* ignore */ } });
    if (sc.endCard) {
      // procedural end card: the real logo dev page (/?uikit=logo-full, Lilita One) on the game's night-sky gradient + plain type
      await page.goto(`${srv.url}?uikit=logo-full`, { waitUntil: 'load', timeout: 120000 });
      await sleep(2500);
      await page.evaluate((c: any) => {
        const root = document.createElement('div');
        root.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2.2vh;background:radial-gradient(120% 90% at 50% 20%,#27456e 0%,#142238 55%,#0a1220 100%);color:#fff;font-family:Nunito,system-ui,sans-serif;text-align:center';
        const logo = Array.from(document.querySelectorAll('svg,img,canvas')).find((e) => (e as HTMLElement).getBoundingClientRect().width > 100) as HTMLElement | undefined;
        if (logo) { const clone = logo.cloneNode(true) as HTMLElement; clone.style.cssText = 'width:46vw;max-height:40vh;height:auto'; root.appendChild(clone); }
        const l1 = document.createElement('div'); l1.textContent = c.line1; l1.style.cssText = 'font:700 5.2vh Nunito,system-ui,sans-serif;letter-spacing:.02em';
        const l2 = document.createElement('div'); l2.textContent = c.line2; l2.style.cssText = 'font:400 4vh Lilita One,Nunito,system-ui,sans-serif;color:#9fd0ff';
        root.append(l1, l2); document.body.appendChild(root);
      }, sc.endCard);
      await sleep(800);
      const file = `${OUT}/${sc.n}-${sc.id}-a-${tag}.png`;
      await page.screenshot({ path: file }); console.log(`[promo] ${sc.n} ${sc.id} a: ${file}`);
      await page.close(); continue;
    }
    const m = sc.map ?? { size: 128, seed: 5 };
    const q = new URLSearchParams({ size: String(m.size), seed: String(m.seed), start: sc.start?.season ?? 'winter', hints: '0', mode: 'career', name: 'Alpenglow', starter: '0' });
    await page.goto(`${srv.url}?${q}`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => !!(window as any).__slope, { timeout: 120000 });
    await page.evaluate(installLib);
    // the scene's staging code lives in scripts/promo/setups.ts (page-side functions keyed by setup id)
    const info = await runSetups(page, sc);
    if (info.failed?.length) failures.push(`${sc.n} ${sc.id}: ${info.failed.join('; ')}`);
    if (arg('eval')) console.log('[promo] eval', JSON.stringify(await page.evaluate(arg('eval'))));
    await page.evaluate(() => (window as any).__promo.hideUi());
    const keys: any[] = sc.camera?.keys ?? [{ at: 'lodge', zoom: 4 }];
    const names = 'abcdef';
    for (let i = 0; i < keys.length; i++) {
      if (arg('probe') === '1' && i > 0) break;
      const k = keys[i];
      const r = await shootKey(page, sc, k);
      await sleep(2500);
      // render cost: rAF frames the real render loop manages in 6 s at this resolution (SwiftShader, the whole page; the frame-step capture adds the PNG encode on top)
      const ms = await page.evaluate(() => new Promise<number>((res) => { let n = 0; const t0 = performance.now(); const f = (): void => { n++; if (performance.now() - t0 < 6000) requestAnimationFrame(f); else res((performance.now() - t0) / n); }; requestAnimationFrame(f); }));
      timings.push({ scene: sc.n, key: names[i]!, msPerFrame: Math.round(ms) });
      const file = `${OUT}/${sc.n}-${sc.id}-${names[i]}-${tag}.png`;
      const ts = Date.now(); await page.screenshot({ path: file }); timings[timings.length - 1]!.shotMs = Date.now() - ts;
      console.log(`[promo] ${sc.n} ${sc.id} ${names[i]}: ${file} cam=${JSON.stringify(r)} errors=${errs.length}`);
    }
    if (errs.length) console.log(`[promo] ${sc.n} errors:`, [...new Set(errs)].slice(0, 5).join(' | '));
    console.log(`[promo] ${sc.n} ${sc.id} staged ${JSON.stringify(Object.fromEntries(Object.entries(info.notes ?? {}).map(([k, v]: any) => [k, k === 'base-large' ? { failures: v.failures } : v])))} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    await page.close();
  }
  writeFileSync(`${OUT}/stage-${tag}.log.json`, JSON.stringify({ tag, W, H, failures, timings }, null, 1));
} finally { await br.close(); srv.stop(); }
if (failures.length) { console.log('[promo] FAILURES\n' + failures.join('\n')); process.exitCode = 1; }
