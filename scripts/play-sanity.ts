/* eslint-disable @typescript-eslint/no-explicit-any -- runs inside the page against the untyped __slope debug handle */
/** `npm run play:sanity [-- --size 64 --seed 5 --years 2]`: a fresh Career New Game in the REAL page (dev server, Chrome SwiftShader), played by the headless bot for N simulated years
 * through the real game loop (renderer, UI, audio wiring all live). Logs every console error / warning / page error, MaterialGuard problems and sampled FPS (SwiftShader: relative only). Exit 1 on error-level logs. */
import { launch, startServer } from './lib/harness';

const arg = (k: string, d: string): string => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1]! : d; };
const size = arg('size', '64'), seed = arg('seed', '5'), years = Number(arg('years', '2'));
const srv = await startServer();
const br = await launch();
const errors: string[] = [], warns: string[] = [];
try {
  const page = await br.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error') errors.push(t); else if (m.type() === 'warn') warns.push(t); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${String(e)}`));
  page.on('requestfailed', (r) => errors.push(`[requestfailed] ${r.url()}`));
  await page.goto(`${srv.url}?size=${size}&seed=${seed}&hints=0`, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => !!(window as unknown as { __slope?: unknown }).__slope, { timeout: 90000 });
  await page.evaluate(async () => {
    const w = window as unknown as { __slope: any; __bot?: unknown };
    const mod = await (new Function('u', 'return import(u)') as (u: string) => Promise<any>)('/src/game/bot.ts');
    w.__bot = new mod.Bot(w.__slope.sim);
    w.__slope.sim.bus.on('finance:monthClosed', () => (w.__bot as any).snapshotMonth());
    w.__slope.loop.setSpeed(0);
  });
  const fps = async (): Promise<number> => page.evaluate(() => new Promise<number>((res) => { let n = 0; const t0 = performance.now(); const f = (): void => { n++; if (performance.now() - t0 > 1500) res((n * 1000) / (performance.now() - t0)); else requestAnimationFrame(f); }; requestAnimationFrame(f); }));
  const days = years * 180, samples: string[] = [];
  for (let d = 0; d < days; d += 15) {
    const info = await page.evaluate((n) => {
      const w = window as unknown as { __slope: any; __bot: any };
      const s = w.__slope;
      for (let i = 0; i < n; i++) { w.__bot.daily(); for (let k = 0; k < 240; k++) s.loop.stepOnce(); }
      s.materialGuard?.scan?.();
      return { day: Math.round(s.loop.tickCount / 240), date: s.sim ? s.game.date.year + '/' + s.game.date.day : '', money: Math.round(s.game.money), guests: s.guestSim.store.count, lifts: s.sim.lifts.all().length, guard: s.materialGuard?.count ?? -1 };
    }, 15);
    if (((d + 15) % 90) === 0) { const f = await fps(); samples.push(`day ${d + 15}: ${JSON.stringify(info)} fps ${f.toFixed(1)}`); console.log(samples[samples.length - 1]); }
    else await new Promise((r) => setTimeout(r, 200));
  }
  console.log(`MaterialGuard: ${await page.evaluate(() => (window as any).__slope.materialGuard.report?.() ?? (window as any).__slope.materialGuard.count)}`);
  await page.screenshot({ path: `.weave/shots/play-sanity-${size}.png` });
  console.log(`console errors (${errors.length}):`, JSON.stringify([...new Set(errors)].slice(0, 20)));
  console.log(`console warnings (${warns.length}):`, JSON.stringify([...new Set(warns)].slice(0, 20)));
} finally { await br.close(); srv.stop(); }
process.exit(errors.length ? 1 : 0);
