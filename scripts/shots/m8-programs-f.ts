/* M8 lane F: number of compiled shader programs after N frames on each tier (Low / Med must not gain any). vite-node scripts/shots/m8-programs-f.ts */
import { launch, shot, startServer } from '../lib/harness';
const srv = await startServer(); const br = await launch();
try {
  for (const q of ['low', 'med', 'high']) {
    const r = await shot(br, srv.url, { size: 64, seed: 5, start: 'winter', hour: 11, w: 800, h: 500, out: `m8-programs-${q}`, ticks: 300, evalJs: `(async()=>{const s=__slope,r=s.renderer;s.view.setQuality('${q}');await new Promise(x=>setTimeout(x,3500));console.info('[programs] ${q} '+r.webgl.info.programs.length+' '+r.webgl.info.programs.map(p=>p.name).sort().join(','));})()` });
    console.log(r.logs.find((l) => l.includes('[programs]'))?.replace(/.*\[programs\] /, '').slice(0, 300));
  }
} finally { await br.close(); srv.stop(); }
