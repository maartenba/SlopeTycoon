/* Boot-splash screenshots (docs/visual-qa.md): `npm run boot:shots`. Uses the dev-only `?bootdelay=ms` pause between boot stages and `?bootfail=1`.
 * Writes .weave/shots/load-*.png (desktop + phone). */
import { launch, startServer } from './lib/harness';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const srv = await startServer();
const br = await launch();
try {
  for (const [name, w, h] of [['desktop', 1280, 800], ['phone', 390, 844]] as const) {
    const page = await br.newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => console.log('[pageerror]', String(e)));
    await page.goto(`${srv.url}?bootdelay=4000`, { waitUntil: 'domcontentloaded' });
    const t0 = Date.now();
    for (const [label, at] of [['module', 2000], ['fonts', 6000], ['renderer-slowhint', 10000]] as const) {
      await sleep(Math.max(0, at - (Date.now() - t0)));
      await page.screenshot({ path: `.weave/shots/load-${name}-${label}.png` });
      console.log(name, label, await page.evaluate(() => `${document.getElementById('splash-bar')?.getAttribute('aria-valuenow')} | ${document.getElementById('splash-text')?.textContent}`));
    }
    await sleep(3000);
    await page.screenshot({ path: `.weave/shots/load-${name}-world.png` });
    console.log(name, 'world', await page.evaluate(() => `${document.getElementById('splash-bar')?.getAttribute('aria-valuenow')} | ${document.getElementById('splash-text')?.textContent}`));
    await page.close();
    const e = await br.newPage();
    await e.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await e.goto(`${srv.url}?bootfail=1`, { waitUntil: 'load' });
    await sleep(1500);
    await e.screenshot({ path: `.weave/shots/load-${name}-error.png` });
    await e.close();
    const r = await br.newPage();
    await r.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await r.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await r.goto(`${srv.url}?bootdelay=4000`, { waitUntil: 'domcontentloaded' });
    await sleep(1500);
    await r.screenshot({ path: `.weave/shots/load-${name}-reduced.png` });
    await r.close();
  }
} finally { await br.close(); srv.stop(); }
