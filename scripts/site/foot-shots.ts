/** `vite-node scripts/site/foot-shots.ts -- --tag before|after`: footer element screenshots of the built site at 1440 / 1024 / 390. */
import { mkdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { launch } from '../lib/harness';
import { createPagesServer } from '../lib/static-server';
const tag = process.argv.includes('--tag') ? process.argv[process.argv.indexOf('--tag') + 1]! : 'after';
mkdirSync('.weave/shots', { recursive: true });
const server = createPagesServer('dist-site', '/slopetycoon/'); await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/slopetycoon/`;
const br = await launch();
try {
  for (const [w, p] of [[1440, ''], [1024, ''], [390, ''], [1440, 'guide/money/'], [390, 'privacy/']] as Array<[number, string]>) {
    const page = await br.newPage(); await page.setViewport({ width: w, height: 900, deviceScaleFactor: 1 });
    await page.goto(base + p, { waitUntil: 'networkidle0' });
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const el = await page.$('footer'); await el!.screenshot({ path: `.weave/shots/foot-${tag}-${w}-${p.replace(/\W/g, '') || 'home'}.png` });
    console.log(w, p || 'home', 'overflow', ov); await page.close();
  }
} finally { await br.close(); server.close(); }
