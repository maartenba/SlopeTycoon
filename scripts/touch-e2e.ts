/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate bodies poke the untyped window.__slope debug API */
/* Touch end-to-end (docs/touch.md, "Verified matrix"): drives the REAL game in Chrome (SwiftShader) with a touch-emulated page (hasTouch + isMobile,
 * puppeteer touchscreen = CDP Input.dispatchTouchEvent) and asserts outcomes through `window.__slope` state. Gated: not part of `npm test`.
 *   npm run touch:e2e [-- --only camera,walk --viewport phone|land|tablet --keep 1]
 * Failure screenshots: .weave/shots/touch2-FAIL-<viewport>-<group>-<n>.png; a final pass/fail matrix is printed; exit code 1 when anything failed. */
import type { Page } from 'puppeteer-core';
import { launch, startServer } from './lib/harness';
import { Rig, VIEWPORTS, results, sleep } from './touch-e2e/rig';
import { registerAll } from './touch-e2e/scenarios';

const args = process.argv.slice(2);
const opt = (k: string): string | undefined => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const ONLY = opt('only')?.split(',');
const VPS = (opt('viewport') ?? 'phone,land,tablet').split(',');

type Scenario = (r: Rig) => Promise<void>;
const scenarios: Array<{ id: string; fn: Scenario; only?: string[]; extra?: string }> = [];
const scenario = (id: string, fn: Scenario, only?: string[], extra?: string): void => { scenarios.push({ id, fn, only, extra }); };

async function bootPage(browser: any, base: string, vp: string, extra = '', bare = false): Promise<Rig> {
  const { w, h } = VIEWPORTS[vp]!;
  const page: Page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const rig = new Rig(page, vp, base);
  const qp = new URLSearchParams(bare ? 'touch=1&touchhold=6000' : 'size=64&seed=61&start=winter&hints=0&touch=1&touchhold=6000');
  for (const [k, v] of new URLSearchParams(extra.replace(/^&/, ''))) qp.set(k, v);
  const q = `?${qp}`;
  rig.winter = qp.get('start') !== 'summer';
  await page.goto(`${base}${q}`, { waitUntil: 'load', timeout: 90000 });
  if (!bare) await page.waitForFunction(() => !!(window as any).__slope?.view, { timeout: 90000 });
  else await sleep(5000);
  await sleep(1500);
  return rig;
}

registerAll(scenario);

const srv = await startServer();
const br = await launch();
try {
  for (const vp of VPS) {
    for (const sc of scenarios) {
      if (ONLY && !ONLY.includes(sc.id)) continue;
      if (sc.only && !sc.only.includes(vp)) continue;
      console.log(`== ${vp} / ${sc.id}`);
      const rig = await bootPage(br, srv.url, vp, sc.extra ? `&${sc.extra}` : '', sc.id === 'title');
      rig.group = sc.id;
      try { await Promise.race([sc.fn(rig), new Promise((_, rej) => setTimeout(() => rej(new Error('scenario timed out (5 min)')), 300000))]); } catch (e) { await rig.check('scenario crashed', false, String((e as Error).stack ?? e).slice(0, 400)); }
      const bad = rig.errors.filter((e) => !/favicon|GPU stall/i.test(e));
      await rig.check('no console errors / page errors', bad.length === 0, bad.slice(0, 2).join(' | ').slice(0, 300));
      await rig.page.close().catch(() => undefined);
    }
  }
} finally { try { await br.close(); } catch { /* already gone */ } srv.stop(); }

console.log('\n==== touch e2e matrix ====');
const groups = [...new Set(results.map((r) => `${r.group}`))];
for (const g of groups) {
  const rs = results.filter((r) => r.group === g);
  console.log(`${rs.every((r) => r.pass) ? 'PASS' : 'FAIL'}  ${g.padEnd(14)} ${rs.filter((r) => r.pass).length}/${rs.length}`);
  for (const r of rs.filter((x) => !x.pass)) console.log(`      x [${r.vp}] ${r.name}: ${r.detail}`);
}
const failed = results.filter((r) => !r.pass).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exitCode = failed ? 1 : 0;
