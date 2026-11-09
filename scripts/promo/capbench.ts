/* eslint-disable @typescript-eslint/no-explicit-any -- page code */
/** Capture-method benchmark (7.6.2): ms per frame of render + capture for each path, at 2560x1440 and 1280x720. `npx vite-node scripts/promo/capbench.ts` */
import { launch, startServer } from '../lib/harness';
import { createServer } from 'node:http';
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const srv = await startServer(); const br = await launch();
// tiny local frame sink for the POST method
const sink = createServer((rq, rs) => { const ch: Buffer[] = []; rq.on('data', (c) => ch.push(c)); rq.on('end', () => { rs.setHeader('Access-Control-Allow-Origin', '*'); rs.setHeader('Access-Control-Allow-Headers', '*'); rs.end('ok'); }); });
await new Promise<void>((r) => sink.listen(0, '127.0.0.1', r)); const sinkPort = (sink.address() as any).port;
const rows: any[] = [];
try {
  for (const [W, H] of [[1280, 720], [2560, 1440]] as Array<[number, number]>) {
    const page = await br.newPage(); await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument(() => { localStorage.setItem('slope.quality', 'high'); localStorage.setItem('slope.consent.analytics', 'denied'); });
    await page.goto(`${srv.url}?size=128&seed=5&start=winter&hints=0&starter=0&mode=career`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => !!(window as any).__slope, { timeout: 120000 });
    await page.evaluate(() => { (window as any).__slope.populateDemo('large'); (window as any).__slope.spawnGuests(80, 'skiers'); });
    await sleep(2000);
    const N = 6;
    const time = async (name: string, fn: (i: number) => Promise<unknown>): Promise<void> => { await fn(0); const t0 = Date.now(); for (let i = 0; i < N; i++) await fn(i); rows.push({ W, H, name, msPerFrame: Math.round((Date.now() - t0) / N) }); console.log(`[bench] ${W}x${H} ${name}: ${Math.round((Date.now() - t0) / N)} ms/frame`); };
    await time('render only (frameStep, no capture)', () => page.evaluate(() => (window as any).__slope.frameStep(1 / 12, 1)));
    await time('page.screenshot png', async () => { await page.evaluate(() => (window as any).__slope.frameStep(1 / 12, 1)); await page.screenshot({ type: 'png' }); });
    await time('page.screenshot jpeg 95', async () => { await page.evaluate(() => (window as any).__slope.frameStep(1 / 12, 1)); await page.screenshot({ type: 'jpeg', quality: 95 }); });
    await time('canvas.toDataURL jpeg 95 (returned as string)', async () => (await page.evaluate(() => { (window as any).__slope.frameStep(1 / 12, 1); return (window as any).__slope.renderer.webgl.domElement.toDataURL('image/jpeg', 0.95).length; })));
    await time('canvas.toBlob jpeg 95 -> base64 string', async () => (await page.evaluate(async () => { (window as any).__slope.frameStep(1 / 12, 1); const c = (window as any).__slope.renderer.webgl.domElement as HTMLCanvasElement; const b: Blob = await new Promise((r) => c.toBlob((x) => r(x!), 'image/jpeg', 0.95)); const u = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s).length; })));
    await time('canvas.toBlob jpeg 95 -> fetch POST to local sink', async () => (await page.evaluate(async (port: number) => { (window as any).__slope.frameStep(1 / 12, 1); const c = (window as any).__slope.renderer.webgl.domElement as HTMLCanvasElement; const b: Blob = await new Promise((r) => c.toBlob((x) => r(x!), 'image/jpeg', 0.95)); await fetch(`http://127.0.0.1:${port}/f`, { method: 'POST', body: b, mode: 'cors' }); return b.size; }, sinkPort)));
    await time('canvas.toBlob png -> fetch POST', async () => (await page.evaluate(async (port: number) => { (window as any).__slope.frameStep(1 / 12, 1); const c = (window as any).__slope.renderer.webgl.domElement as HTMLCanvasElement; const b: Blob = await new Promise((r) => c.toBlob((x) => r(x!), 'image/png')); await fetch(`http://127.0.0.1:${port}/f`, { method: 'POST', body: b, mode: 'cors' }); return b.size; }, sinkPort)));
    await time('readPixels RGBA -> POST raw', async () => (await page.evaluate(async (port: number) => { (window as any).__slope.frameStep(1 / 12, 1); const w = (window as any).__slope.renderer.webgl as any; const gl = w.getContext(); const W2 = gl.drawingBufferWidth, H2 = gl.drawingBufferHeight; const px = new Uint8Array(W2 * H2 * 4); gl.readPixels(0, 0, W2, H2, gl.RGBA, gl.UNSIGNED_BYTE, px); await fetch(`http://127.0.0.1:${port}/f`, { method: 'POST', body: px, mode: 'cors' }); return px.length; }, sinkPort)));
    const wc = await page.evaluate(async () => { const out: any = { enc: typeof (window as any).VideoEncoder }; if (out.enc === 'function') { try { for (const codec of ['avc1.640033', 'avc1.64002A', 'avc1.4d0034', 'vp09.00.40.08']) { const r = await (window as any).VideoEncoder.isConfigSupported({ codec, width: 1280, height: 720 }); out[codec] = r.supported; } } catch (e) { out.err = String(e); } } return out; });
    console.log('[bench] webcodecs', JSON.stringify(wc));
    if (wc.enc === 'function') {
      await time('WebCodecs VideoEncoder (avc1 / vp9) chunks -> POST', async () => (await page.evaluate(async (port: number, w2: number, h2: number) => {
        const S = (window as any).__slope; const w: any = window; const c: HTMLCanvasElement = S.renderer.webgl.domElement;
        if (!w.__enc) { const chunks: Blob[] = []; const codec = [ 'avc1.640033', 'avc1.64002A', 'vp09.00.40.08'].find(() => true)!; let ok = codec; for (const cd of ['avc1.640033', 'avc1.4d0034', 'vp09.00.40.08']) { try { if ((await w.VideoEncoder.isConfigSupported({ codec: cd, width: w2, height: h2 })).supported) { ok = cd; break; } } catch { /* next */ } }
          const enc = new w.VideoEncoder({ output: (ch: any) => { const b = new Uint8Array(ch.byteLength); ch.copyTo(b); chunks.push(new Blob([b])); }, error: (e: any) => console.log('enc err ' + e) }); enc.configure({ codec: ok, width: w2, height: h2, bitrate: 40e6, framerate: 12, latencyMode: 'quality' }); w.__enc = { enc, chunks, n: 0, ok }; }
        S.frameStep(1 / 12, 1); const vf = new w.VideoFrame(c, { timestamp: w.__enc.n++ * 83333 }); w.__enc.enc.encode(vf, { keyFrame: w.__enc.n % 30 === 1 }); vf.close(); await w.__enc.enc.flush(); const b = w.__enc.chunks.pop(); await fetch(`http://127.0.0.1:${port}/f`, { method: 'POST', body: b, mode: 'cors' }); return b.size;
      }, sinkPort, W, H)));
    }
    await page.close();
  }
  console.log(JSON.stringify(rows));
} finally { await br.close(); srv.stop(); sink.close(); }
