/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate pokes the untyped window.__slope debug API */
/* Debug helper: open the demo scene and print console / crash events for N seconds. usage: vite-node scripts/demo-debug.ts "query" seconds */
import { launch, startServer } from './lib/harness';
const q = process.argv[2] ?? 'demoscene=1&nomenu=1&demosize=64';
const secs = Number(process.argv[3] ?? 20);
const srv = await startServer();
const br = await launch();
try {
  const page = await br.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('console', (m) => console.log(`[${m.type()}] ${m.text().slice(0, 400)}`));
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 600)));
  page.on('error', (e) => console.log('[CRASH]', String(e)));
  page.on('framenavigated', (f) => console.log('[nav]', f.url()));
  await page.goto(`${srv.url}?${q}`, { waitUntil: 'load', timeout: 90000 });
  for (let i = 0; i < secs; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try { console.log(i, await page.evaluate(() => { const s = (window as any).__slope; return s ? `tick=${s.loop.tickCount} guests=${s.guestSim.store.count} cam=${s.demo?.camera?.current()?.kind}` : 'no slope'; })); } catch (e) { console.log('eval failed', String(e).slice(0, 100)); }
  }
} finally { await br.close(); srv.stop(); }
