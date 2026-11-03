/* M8 8.8: draw calls + triangles per top-level scene child in the iso frame (attribution of call deltas between two trees). vite-node scripts/shots/m8-calls.ts [low|med|high] */
import { launch, shot, startServer } from '../lib/harness';
const q = process.argv[2] ?? 'low';
const JS = `(async()=>{const s=__slope,r=s.renderer;s.view.setQuality('${q}');const sleep=(ms)=>new Promise(x=>setTimeout(x,ms));s.spawnGuests(300,'skiers');s.loop.setSpeed(1);r.controls.zoom=1;r.controls.zoomBy(1.5);await sleep(3500);
const frame=()=>{r.onFrame(1/60);r.webgl.render(r.scene,r.camera);const i=r.webgl.info.render;return [i.calls,i.triangles];};
for(let i=0;i<4;i++)frame();const base=frame();const out={total:base};
for(const c of r.scene.children){if(!c.visible)continue;c.visible=false;frame();const f=frame();c.visible=true;const d=[base[0]-f[0],base[1]-f[1]];if(d[0]||d[1])out[(c.name||c.type)+'#'+r.scene.children.indexOf(c)]=d;}
console.log('[calls] '+JSON.stringify(out));})()`;
const srv = await startServer(); const br = await launch();
try {
  const r = await shot(br, srv.url, { size: 128, seed: 5, start: 'winter', hour: 11, w: 1280, h: 800, out: 'm8-calls', pre: "__slope.populateDemo('medium')", ticks: 1200, target: 'lodge', zoom: 1.5, evalJs: JS });
  console.log(r.logs.find((l) => l.includes('[calls]'))?.replace(/.*\[calls\] /, '') ?? 'n/a');
} finally { await br.close(); srv.stop(); }
