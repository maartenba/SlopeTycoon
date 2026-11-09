/* eslint-disable @typescript-eslint/no-explicit-any -- page code */
/** Real-page frame-step determinism check (7.6.1): two independent boots of the same game, 30 frames each with `__slope.frameStep(1/12, 1)` at sim rate 2, camera orbit as a pure
 * function of the virtual clock. Every frame's pixels (SHA-256 of the canvas PNG) and the final `stateHash` must be identical. Exit 1 when not.
 *   npx vite-node scripts/promo/frameCheck.ts [--w 640 --h 360] [--frames 30] [--hour 17.2] */
import { launch, startServer } from '../lib/harness';
const arg = (k: string, d = ''): string => { const i = process.argv.indexOf(`--${k}`); return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : d; };
const W = Number(arg('w', '640')), H = Number(arg('h', '360')), N = Number(arg('frames', '30')), hour = Number(arg('hour', '17.2'));
const srv = await startServer(); const br = await launch();
async function run(tag = ''): Promise<{ pix: string[]; hash: string; tick: number }> {
  const page = await br.newPage(); await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem('slope.quality', 'high'); localStorage.setItem('slope.consent.analytics', 'denied'); } catch { /* ignore */ } });
  await page.goto(`${srv.url}?size=64&seed=61&start=winter&hints=0&starter=0&mode=career&stepmode=1`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => !!(window as any).__slope, { timeout: 120000 });
  const r = await page.evaluate(async (n: number, h: number, pre: string) => {
    const s = (window as any).__slope; s.populateDemo('medium'); if (!/noguests/.test(pre)) s.spawnGuests(60, 'skiers'); if (pre) (0, eval)(pre); s.setHour(h); s.atmos.force({ hour: h, special: 1, fog: 0.2 });
    const c = s.renderer.controls; const x0 = c.target.x, z0 = c.target.z, y0 = c.yaw;
    s.frameStepRate = 2; s.frameCam = (t: number): void => { c.focusTween = null; c.target.set(x0 + Math.sin(t) * 3, c.target.y, z0 + Math.cos(t) * 3); c.yaw = y0 + t * 0.2; };
    s.frameStep(0, 6); // preroll: terrain / prop builds settle (no sim time passes)
    const pix: string[] = [];
    for (let i = 0; i < n; i++) {
      s.frameStep(i === 0 ? 0 : 1 / 12, 1);
      const gl: HTMLCanvasElement = s.renderer.webgl.domElement; const cv = document.createElement('canvas'); cv.width = gl.width; cv.height = gl.height; const cx = cv.getContext('2d', { alpha: false })!; cx.fillStyle = '#456'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(gl, 0, 0); const b: Blob = await new Promise((res) => cv.toBlob((x) => res(x!), 'image/png'));
      if (i === 5) (window as any).__dump = await new Promise<string>((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.readAsDataURL(b); });
      const d = await crypto.subtle.digest('SHA-256', await b.arrayBuffer()); pix.push(Array.from(new Uint8Array(d)).slice(0, 8).map((v) => v.toString(16).padStart(2, '0')).join(''));
    }
    const out = { pix, hash: s.frameHash(), tick: s.loop.tickCount }; s.frameStepEnd(); return out;
  }, N, hour, arg('pre'));
  if (tag) { const du: string = await page.evaluate(() => (window as any).__dump); (await import('node:fs')).writeFileSync(`.weave/promo/fc-${tag}.png`, Buffer.from(du.split(',')[1]!, 'base64')); }
  await page.close(); return r;
}
try {
  const a = await run('a'), b = await run('b');
  const same = a.pix.filter((p, i) => p === b.pix[i]).length;
  console.log(`[frameCheck] run A hash ${a.hash} tick ${a.tick}; run B hash ${b.hash} tick ${b.tick}; identical frames ${same}/${N}`);
  const distinct = new Set(a.pix).size; console.log(`[frameCheck] distinct frames in A: ${distinct}/${N} (the scene really moves)`);
  if (a.hash !== b.hash || same !== N || distinct < N / 2) { console.log('[frameCheck] FAIL'); process.exitCode = 1; } else console.log('[frameCheck] PASS: same stateHash, byte-identical pixels');
} finally { await br.close(); srv.stop(); }
