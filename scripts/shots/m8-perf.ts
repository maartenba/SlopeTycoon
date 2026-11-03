/* M8 iso perf baseline (docs/graphics-audit.md): draw calls / triangles (renderer.info) + JS update ms + SwiftShader rAF frame ms (RELATIVE ONLY) in the iso default view,
 * per map size and graphics preset, demo resort + 300 skiers. vite-node scripts/shots/m8-perf.ts [--quick]  (quick = 128 only). Run on an idle machine. */
import { launch, shot, startServer } from '../lib/harness';
const quick = process.argv.includes('--quick');
const measure = (q: string, zoom: number): string => `(async()=>{const s=__slope,r=s.renderer,gl=r.webgl.getContext();s.view.setQuality('${q}');const sleep=(ms)=>new Promise(x=>setTimeout(x,ms));
s.spawnGuests(300,'skiers');s.loop.setSpeed(1);r.controls.zoom=1;r.controls.zoomBy(${zoom});await sleep(3500);
const N=40;let t0=performance.now();for(let i=0;i<N;i++)r.onFrame(1/60);const cpu=(performance.now()-t0)/N;
const px=new Uint8Array(4);const med=(a)=>a.slice().sort((x,y)=>x-y)[a.length>>1];const calls=[],tris=[],ms=[];
for(let i=0;i<9;i++){const t=performance.now();r.onFrame(1/60);r.webgl.render(r.scene,r.camera);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);ms.push(performance.now()-t);const info=r.webgl.info.render;calls.push(info.calls);tris.push(info.triangles);}
console.log('[m8] '+JSON.stringify({calls:med(calls),tris:med(tris),updateMs:+cpu.toFixed(2),rafMedianMs:+med(ms).toFixed(0),guests:s.guestSim.store.count}));})()`;
const srv = await startServer(); const br = await launch();
try {
  console.log('| size | zoom | preset | draw calls | triangles | JS update ms | SwiftShader frame+finish ms (RELATIVE) | guests |\n|---|---|---|---|---|---|---|---|');
  for (const size of quick ? [128] : [64, 128, 256]) for (const zoom of [1.5, 3]) for (const q of ['low', 'med', 'high']) {
    const res = await shot(br, srv.url, { size, seed: size === 256 ? 7 : size === 128 ? 5 : 61, start: 'winter', hour: 11, w: 1280, h: 800, out: `m8-perf-${size}-${zoom}-${q}`, pre: "__slope.populateDemo('medium')", ticks: 1200, target: 'lodge', zoom, evalJs: measure(q, zoom) });
    const line = res.logs.find((l) => l.includes('[m8] '));
    const m = line ? JSON.parse(line.slice(line.indexOf('[m8] ') + 5)) : null;
    console.log(m ? `| ${size} | ${zoom} | ${q} | ${m.calls} | ${(m.tris / 1e6).toFixed(2)} M | ${m.updateMs} | ${m.rafMedianMs} | ${m.guests} |` : `| ${size} | ${zoom} | ${q} | n/a |`);
  }
} finally { await br.close(); srv.stop(); }
