/* M8 smooth planes / canopies / gliders IN THE REAL GAME: a second SkyActivity (the real class: real poses, real instancing) over the village meadow with three strips at different
 * cycle phases (plane rolling out / climbing / canopies out + landing) and one ramp with three gliders. vite-node scripts/shots/m8-sky-ingame-m.ts <prefix> <zoom> [quality low|medium|high] [yaw] [cx cy tile offset]
 * zoom 6 = iso view, 25+ = close. Prints console / shader errors and the MaterialGuard count (F3 "Render problems"). */
import { launch, shot, startServer } from '../lib/harness';
const prefix = process.argv[2] ?? 'm8-after-m-ig';
const zoom = Number(process.argv[3] ?? 6), q = process.argv[4] ?? 'high', yaw = Number(process.argv[5] ?? 0.5);
const U0 = process.argv[6] ?? '0.62', U1 = process.argv[7] ?? '0.82';
const JS = `(async()=>{
  const S=await import('/src/render/SkyActivity.ts');
  const s=__slope,a0=s.terrainInfo.villageAnchor,a={x:Math.round(a0.x),y:Math.round(a0.y+14)},gr=s.grid;
  s.trees.group.visible=false;s.rocks.group.visible=false;
  const hh=(x,y)=>gr.getCorner(Math.max(0,Math.min(gr.size,Math.round(x))),Math.max(0,Math.min(gr.size,Math.round(y))))*0.5+0.05;
  const centres=[0,1].map((i)=>({id:i+1,users:6,open:true,strip:{x:a.x-9,y:a.y-5+i*7,w:7,h:2}}));
  const ramps=[{id:50,users:3,open:true,x:a.x+7,y:a.y-6,w:2,h:2,landing:{x:a.x+12,y:a.y+6}}];
  const sa=new S.SkyActivity(hh,()=>centres,()=>ramps);
  s.renderer.scene.add(sa.group);
  // phases: u = ((tick + id*17) % 80) / 80 -> plane 1 rolls out (u .06), plane 2 climbs (.40), plane 3 is past the jump with canopies out (.75)
  const T=800; // one tick; each strip's id is picked so that its own phase is the wanted one
  const idFor=(u)=>{for(let id=1;id<400;id++){const v=((T+id*17)%80)/80;if(Math.abs(v-u)<0.007)return id;}return 1;};
  centres[0].id=idFor(+(${U0}));centres[1].id=idFor(+(${U1}));
  sa.update(T);
  window.__skyIG=sa;
  s.renderer.controls.target.set(a.x-3,hh(a.x,a.y)+1.5,a.y);
  console.log('[sky]',JSON.stringify(sa.drawn));
})()`;
const srv = await startServer(); const br = await launch();
try {
  const r = await shot(br, srv.url, { w: 1600, h: 1000, size: 128, seed: 5, start: 'summer', hour: 11, zoom, yaw, local: { 'slope.quality': q }, evalJs: JS, steps: 'wait:1200;eval:JSON.stringify(__slope.materialGuard.summary())', out: `${prefix}` });
  console.log(r.file, r.errors.filter((e) => !/GL Driver|beforeinstallprompt/.test(e)), r.logs.filter((l) => /\[sky\]|summary|problems|failed|\{"/i.test(l)).slice(0, 6));
} finally { await br.close(); srv.stop(); }
