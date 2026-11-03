/* M8 lane G: water bed / shore close-ups. vite-node scripts/shots/m8-water-g.ts <prefix> [seed=5] [zoom=30] [size=128] [pick=0] [winter=0]
 * Centres on the pick-th water cluster tile (a lake / pond); logs concave corner count. -> .weave/shots/<prefix>.png */
import { launch, shot, startServer } from '../lib/harness';
const prefix = process.argv[2] ?? 'm8-after-g-water', seed = Number(process.argv[3] ?? 5), zoom = Number(process.argv[4] ?? 30), size = Number(process.argv[5] ?? 128), pick = Number(process.argv[6] ?? 0), winter = process.argv[7] === '1', dig = process.argv[8] === 'dig';
const HIDE = "(()=>{const s=document.createElement('style');s.textContent='#ui,st-toast{display:none!important}';document.head.appendChild(s);})()";
const DIG = `(()=>{const s=__slope,L=s.landscapeDebug;const p=L.find(4,0)||L.find(3,0);if(!p){console.log('[stats] no pond site');return;}console.log('[stats] dig '+L.dig(p.x,p.y,4)+' at '+p.x+','+p.y);const q=L.find(4,0);for(let i=0;i<30;i++){const r=L.find(3,i);if(r&&Math.abs(r.x-p.x)>=3&&Math.abs(r.x-p.x)<=5&&Math.abs(r.y-p.y)>=3&&Math.abs(r.y-p.y)<=6){console.log('[stats] dig2 '+L.dig(r.x,r.y,3));break;}}})()`;
const FIND = `(()=>{const s=__slope;s.loop.setSpeed(0);__slope.trees.group.visible=false;const g=s.grid;const N=g.size;const W=[];for(let y=1;y<N-1;y++)for(let x=1;x<N-1;x++){if(g.tileType[y*N+x]!==2) continue;W.push([x,y]);}
console.log('[stats] water tiles '+W.length);if(!W.length)return;
// prefer a tile with a land diagonal neighbour (concave corner) when pick>0
const isW=(x,y)=>g.tileType[y*N+x]===2;let cc=[];for(const [x,y] of W){for(const [dx,dy] of [[1,1],[1,-1],[-1,1],[-1,-1]]){if(!isW(x+dx,y+dy)&&isW(x+dx,y)&&isW(x,y+dy))cc.push([x+dx,y+dy]);}}
console.log('[stats] concave '+cc.length);const t=${pick}>0&&cc.length?cc[(${pick}-1)%cc.length]:W[Math.floor(W.length/2)];const c=s.renderer.controls;let sx=0,sy=0,n=0;for(const w of W)if(Math.hypot(w[0]-t[0],w[1]-t[1])<9){sx+=w[0];sy+=w[1];n++;}const cx=${pick}>0?t[0]:sx/n,cy=${pick}>0?t[1]:sy/n;c.target.set(cx+0.5+${Number(process.env.DX||0)},g.getCorner(Math.round(cx),Math.round(cy))*0.5,cy+0.5+${Number(process.env.DY||0)});if(c.update)c.update(1);console.log('[stats] at '+t);})()`;
const srv = await startServer(); const br = await launch();
try {
  const r = await shot(br, srv.url, { w: 1400, h: 900, size, seed, start: winter ? undefined : 'summer', hour: 12, zoom, ticks: 30, evalJs: `${HIDE};${dig ? DIG + ';' : ''}${FIND}`, out: prefix } as never);
  for (const l of r.logs) if (l.includes('[stats]')) console.log(l);
  console.log(r.file, r.errors.filter((e) => !/GL Driver/.test(e)).length, 'errors');
} finally { await br.close(); srv.stop(); }
