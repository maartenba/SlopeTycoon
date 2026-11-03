/* M8 lane I: ground-level (walk) shots of rocks. vite-node scripts/shots/m8-rock-i.ts <prefix> [summer|winter] [pick=0] [dist=3] -> .weave/shots/<prefix>.png */
import { launch, shot, startServer } from '../lib/harness';
const prefix = process.argv[2] ?? 'm8-after-i-rock', season = process.argv[3] ?? 'summer', pick = Number(process.argv[4] ?? 0), dist = Number(process.argv[5] ?? 3);
const start = season === 'summer' ? 'summer' as never : undefined;
const FIND = `(()=>{const s=__slope,P=s.props,g=s.grid;const out=[];const cs=16;for(let cy=0;cy<P.chunksPerRow;cy++)for(let cx=0;cx<P.chunksPerRow;cx++){const c=P.propsInChunk(cx,cy);for(let i=0;i<c.kind.length;i++)if(c.kind[i]===2&&c.tx[i]>12&&c.tx[i]<g.size-12&&c.ty[i]>14&&c.ty[i]<g.size-12&&g.tileType[c.ty[i]*g.size+c.tx[i]]===0)out.push([c.tx[i],c.ty[i]]);}out.sort((a,b)=>g.getCorner(a[0],a[1])-g.getCorner(b[0],b[1]));console.log('[stats] rocks '+out.length+' '+JSON.stringify(out.slice(${pick},${pick}+1)));})()`;
const srv = await startServer(); const br = await launch();
try {
  const f = await shot(br, srv.url, { w: 400, h: 300, size: 128, seed: 5, start, hour: 11, ticks: 5, evalJs: FIND, out: `${prefix}-probe` } as never);
  const line = f.logs.find((l) => l.includes('[stats] rocks')) ?? ''; console.log(line);
  const m = /\[\[(\d+),(\d+)\]\]/.exec(line); if (!m) throw new Error('no rock');
  const rx = Number(m[1]), ry = Number(m[2]);
  const r = await shot(br, srv.url, { w: 1600, h: 1000, size: 128, seed: 5, start, hour: 11, ticks: 600, view: 'walk', walkAt: `${rx},${ry + dist}`, walkYaw: 0, walkPitch: -8, out: prefix } as never);
  console.log(r.file, r.errors.filter((e) => !/GL Driver|beforeinstallprompt/.test(e)).length, 'errors');
} finally { await br.close(); srv.stop(); }
