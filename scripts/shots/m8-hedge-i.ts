/* M8 lane I: close-up of village shrubs / hedges (winter snow caps). vite-node scripts/shots/m8-hedge-i.ts <prefix> [summer|winter] [zoom=12] [kind=shrub] -> .weave/shots/<prefix>.png */
import { launch, shot, startServer } from '../lib/harness';
const prefix = process.argv[2] ?? 'm8-after-i-hedge', season = process.argv[3] ?? 'winter', zoom = Number(process.argv[4] ?? 12), kind = process.argv[5] ?? 'shrub';
const AIM = `(()=>{const s=__slope;s.loop.setSpeed(0);s.trees.group.visible=false;const it=s.villageDecor.items.filter(i=>i.kind==='${kind}');console.log('[stats] items '+it.length);if(!it.length)return;const a=it[Math.floor(it.length/2)];const c=s.renderer.controls;c.maxZoom=80;c.zoom=1;c.zoomBy(${zoom});c.target.set(a.x,s.grid.getCorner(Math.round(a.x),Math.round(a.z))*0.5,a.z);if(c.update)c.update(1);const st=document.createElement('style');st.textContent='#ui,st-toast{display:none!important}';document.head.appendChild(st);})()`;
const srv = await startServer(); const br = await launch();
try {
  const r = await shot(br, srv.url, { w: 1200, h: 800, size: 128, seed: 5, start: season === 'summer' ? 'summer' : undefined, hour: 12, zoom: 1, ticks: 1500, extra: 'starter=1', evalJs: AIM, out: prefix } as never);
  for (const l of r.logs) if (l.includes('[stats]')) console.log(l);
  console.log(r.file, r.errors.filter((e) => !/GL Driver|beforeinstallprompt/.test(e)).length, 'errors');
} finally { await br.close(); srv.stop(); }
