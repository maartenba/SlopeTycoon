/* Magic Carpet on a real slope (the model gallery is flat, so it never showed the tilt bug). Places a Ski School HQ + a Magic Carpet on the first 1x6 site with a 1..2 half-step rise (128 / seed 5, winter) and shoots it.
 * vite-node scripts/shots/carpet-slope.ts <prefix> [zoom=6] [legacy]   `legacy` re-applies the pre-fix seat (flat on the lowest corner) to reproduce the old look. Tests: tests/render/magicCarpetSeat.test.ts. */
import { launch, shot, startServer } from '../lib/harness';
const prefix = process.argv[2] ?? 'carpet-slope', zoom = Number(process.argv[3] ?? 6), legacy = process.argv[4] === 'legacy';
const PLACE = `(()=>{const s=__slope,g=s.grid;let best=null;const a=s.terrainInfo.villageAnchor;for(let d=0;d<30;d++){const o=s.debugPlace('skiSchoolHQ',a.x+(d%6)*3-6,a.y+Math.floor(d/6)*3-6,0,true);if(o.ok){console.log('HQ',d);break;}}
for(let y=10;y<g.size-12&&!best;y++)for(let x=10;x<g.size-12&&!best;x++){
 let mn=1e9,mx=-1e9;for(let vy=y;vy<=y+6;vy++)for(let vx=x;vx<=x+1;vx++){const c=g.getCorner(vx,vy);mn=Math.min(mn,c);mx=Math.max(mx,c);}
 if(mx-mn>=1&&mx-mn<=2){const o=s.debugPlace('magicCarpet',x,y,0,false);if(o.ok){best={x,y};}else{(window.__r=window.__r||{})[1]=1;}}
}
if(!best){console.log('NOCARPET',JSON.stringify(window.__r));return;}
const y=g.getCorner(best.x,best.y)*0.5;s.renderer.controls.target.set(best.x+0.5,y,best.y+3);window.__carpet=best;console.log('CARPET',JSON.stringify(best));})()`;
const LEGACY = `;(()=>{const s=__slope,b=s.buildings.all().find(b=>b.type==='magicCarpet');s.buildingsView.sync();const g=s.buildingsView.get(b.id);const gr=s.grid;let m=1e9;for(let vy=b.y;vy<=b.y+b.h;vy++)for(let vx=b.x;vx<=b.x+b.w;vx++)m=Math.min(m,gr.getCorner(vx,vy));g.rotation.set(0,-(b.rot%4)*Math.PI/2,0);g.position.y=m*0.5;})()`;
const srv = await startServer(); const br = await launch();
try {
  const r = await shot(br, srv.url, { w: 1600, h: 1000, size: 128, seed: 5, start: 'winter', hour: 12, zoom, evalJs: PLACE + (legacy ? LEGACY : ''), out: prefix });
  console.log(r.file, r.logs.filter((l) => /CARPET/.test(l)).join(' '), r.errors.filter((e) => !/GL Driver|beforeinstallprompt/.test(e)).length);
} finally { await br.close(); srv.stop(); }
