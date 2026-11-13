/* Cow animation check: a few cows forced into the nature view, close zoom; prints MaterialGuard problems (the cow shader patch compiles). vite-node scripts/shots/m8-cows-p.ts <prefix> [zoom] [yaw] */
import { launch, shot, startServer } from '../lib/harness';
const prefix = process.argv[2] ?? 'm8-after-p-cows', zoom = Number(process.argv[3] ?? 5), yaw = Number(process.argv[4] ?? 0.6);
const JS = `(()=>{const st=document.createElement('style');st.textContent='#ui,st-toast{display:none!important}';document.head.appendChild(st);
const s=__slope,a0=s.terrainInfo.villageAnchor,a={x:a0.x,y:a0.y+16};s.trees.group.visible=false;s.rocks.group.visible=false;s.loop.setSpeed(0);
const cows=[0,1,2,3].map(i=>({id:3+i*5,species:'cow',x:a.x+i*0.9,y:a.y+(i%2)*0.6,heading:0.5*i,hidden:false,mode:2,phase:i}));
const orig=s.natureView.update.bind(s.natureView);s.natureView.update=(dt,an,cx,cz,vh,d)=>orig(dt,cows,a.x,a.y,Math.min(vh,12),d);
s.renderer.controls.target.set(a.x+1.4,s.grid.getCorner(Math.round(a.x),Math.round(a.y))*0.5+0.2,a.y+0.3);
setTimeout(()=>console.log('[stats] MaterialGuard problems '+s.materialGuard.check()+' cowCount '+s.natureView.meshes.get('cow').count),2500);})()`;
const srv = await startServer(); const br = await launch();
try {
  const r = await shot(br, srv.url, { w: 1400, h: 900, size: 128, seed: 5, start: 'summer', hour: 12, zoom, yaw, evalJs: JS, out: prefix } as never);
  for (const l of r.logs) if (l.includes('[stats]')) console.log(l);
  console.log(r.file, r.errors.filter((e) => !/GL Driver/.test(e)));
} finally { await br.close(); srv.stop(); }
