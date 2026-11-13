/* M8 hill shadows: vite-node scripts/shots/m8-hill-n.ts <prefix> [seed=5] [zoom=1.4] [size=128] [hour=8] [start=summer]. Q=low|med|high (default high). Prints the shadow-rig + hill stats. */
import { launch, shot, startServer } from '../lib/harness';
const prefix = process.argv[2] ?? 'm8-after-n-hill', seed = Number(process.argv[3] ?? 5), zoom = Number(process.argv[4] ?? 1.4), size = Number(process.argv[5] ?? 128), hour = Number(process.argv[6] ?? 8), start = process.argv[7] ?? 'summer';
const EV = `(async()=>{const s=__slope,r=s.renderer;s.view.setQuality('${process.env.Q ?? 'high'}');const st=document.createElement('style');st.textContent='#ui,st-toast{display:none!important}';document.head.appendChild(st);s.loop.setSpeed(0);await new Promise(x=>setTimeout(x,4500));const h=r.shadows.hill;if(h){h.flush();await new Promise(x=>setTimeout(x,2500));}console.log('[stats] strength '+r.shadows.stats.strength.toFixed(2)+' maps '+(h?h.mapsDone:-1)+' rows '+(h?h.rowsComputed:-1)+' extra '+r.shadows.stats.extraCells+' guard '+(s.materialGuard?JSON.stringify(s.materialGuard.summary?.()??''):''));})()`;
const srv = await startServer(); const br = await launch();
try {
  const r = await shot(br, srv.url, { w: 1400, h: 900, size, seed, start, hour, zoom, ticks: 30, evalJs: EV, out: prefix } as never);
  for (const l of r.logs) if (l.includes('[stats]')) console.log(l);
  console.log(r.file, r.errors.filter((e) => !/GL Driver/.test(e)).length, 'errors');
} finally { await br.close(); srv.stop(); }
