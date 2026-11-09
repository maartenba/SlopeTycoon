/* eslint-disable @typescript-eslint/no-explicit-any -- page code */
/** Real-page determinism check for `__slope.frameStep` (M7.6.1): two fresh boots of the same game, the same 30 virtual frames each (dt 1/12, sim at 2x),
 * must end in the same `stateHash` and produce byte-identical canvas pixels (SHA-256 of every frame's PNG, folded). `npx vite-node scripts/promo/determinism.ts [--frames 30] [--w 640 --h 360]` (exit 1 on a difference). */
import { launch, startServer } from '../lib/harness';

const arg = (k: string, d = ''): string => { const i = process.argv.indexOf(`--${k}`); return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : d; };
const N = Number(arg('frames', '30')), W = Number(arg('w', '640')), H = Number(arg('h', '360'));
const srv = await startServer(); const br = await launch(); let bad = false;
async function once(): Promise<{ hash: string; px: string; tick: number; per: string[] }> {
  const page = await br.newPage(); await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem('slope.quality', 'high'); localStorage.setItem('slope.consent.analytics', 'denied'); } catch { /* ignore */ } });
  await page.goto(`${srv.url}?size=64&seed=61&start=winter&hints=0&mode=career`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => !!(window as any).__slope, { timeout: 120000 });
  const r = await page.evaluate(async (n: number) => {
    const s = (window as any).__slope; s.populateDemo('small'); s.spawnGuests(40, 'skiers'); s.loop.setSpeed(0);
    s.frameStepRate = 2; const c: HTMLCanvasElement = s.renderer.webgl.domElement; const per: string[] = []; let all = '';
    for (let i = 0; i < n; i++) {
      s.frameStep(1 / 12, 1);
      const b: Blob = await new Promise((res) => c.toBlob((x) => res(x!), 'image/png')); const d = new Uint8Array(await crypto.subtle.digest('SHA-256', await b.arrayBuffer()));
      const h = Array.from(d.slice(0, 6)).map((x) => x.toString(16).padStart(2, '0')).join(''); per.push(h); all += h;
    }
    const fin = s.frameClock.t; s.frameStepEnd();
    const d2 = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(all)));
    return { hash: s.frameHash(), px: Array.from(d2.slice(0, 8)).map((x) => x.toString(16).padStart(2, '0')).join(''), tick: s.loop.tickCount, per, fin };
  }, N);
  await page.close(); return r;
}
try {
  const a = await once(), b = await once();
  console.log(`run A: stateHash ${a.hash} tick ${a.tick} pixels ${a.px}`); console.log(`run B: stateHash ${b.hash} tick ${b.tick} pixels ${b.px}`);
  const diff = a.per.map((x, i) => (x === b.per[i] ? -1 : i)).filter((i) => i >= 0);
  bad = a.hash !== b.hash || a.px !== b.px; console.log(bad ? `DIFFERENT (frames differing: ${diff.join(',') || 'none'})` : `IDENTICAL: ${N} frames, same stateHash, byte-identical pixels`);
} finally { await br.close(); srv.stop(); }
process.exitCode = bad ? 1 : 0;
