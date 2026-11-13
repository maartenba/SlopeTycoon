/* Water seam: camera on a natural river / lake junction. vite-node scripts/shots/m8-junction-p.ts <prefix> <seed> [zoom] [size]; Q=low|med|high. Prints the junction count + MaterialGuard count. */
import { launch, shot, startServer } from '../lib/harness';
const prefix = process.argv[2] ?? 'm8-junction', seed = Number(process.argv[3] ?? 5), zoom = Number(process.argv[4] ?? 14), size = Number(process.argv[5] ?? 128);
const JS = `(()=>{${process.env.Q ? "__slope.view.setQuality('" + process.env.Q + "');" : ''}const st=document.createElement('style');st.textContent='#ui,st-toast{display:none!important}';document.head.appendChild(st);
const s=__slope,g=s.grid,N=g.size;s.loop.setSpeed(0);s.trees.group.visible=false;s.rocks.group.visible=false;const J=[];
for(let y=1;y<N-1;y++)for(let x=1;x<N-1;x++){if(g.tileType[y*N+x]!==2)continue;for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]])if(g.tileType[(y+dy)*N+x+dx]===6)J.push([x+dx,y+dy]);}
console.log('[stats] junctions '+J.length+' types '+[...new Set(Array.from(g.tileType))].join(','));
if(!J.length)return;const t=J[Math.floor(J.length/2)];const c=s.renderer.controls;c.target.set(t[0]+0.5,g.getCorner(t[0],t[1])*0.5,t[1]+0.5);console.log('[stats] at '+t);})()`;
const srv = await startServer(); const br = await launch();
try {
  const r = await shot(br, srv.url, { w: 1400, h: 900, size, seed, start: 'summer', hour: 12, zoom, ticks: 30, evalJs: JS, out: prefix } as never);
  for (const l of r.logs) if (l.includes('[stats]')) console.log(l);
  console.log(r.file, r.errors.filter((e) => !/GL Driver/.test(e)).length, 'errors');
} finally { await br.close(); srv.stop(); }
